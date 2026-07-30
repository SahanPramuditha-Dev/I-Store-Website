import io
import gzip
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List

from sqlalchemy.orm import Session
from sqlalchemy import text, func

from app.config import settings
from app.services.storage import STORAGE_PREFIX_BACKUPS

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Retention table spec
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class RetentionSpec:
    table: str
    created_col: str
    id_col: str
    default_days: int


_LOG_SPECS: List[RetentionSpec] = [
    RetentionSpec(table="activity_logs",        created_col="created_at", id_col="id", default_days=90),
    RetentionSpec(table="audit_logs",           created_col="created_at", id_col="id", default_days=180),
    RetentionSpec(table="security_audit_logs",  created_col="created_at", id_col="id", default_days=180),
    RetentionSpec(table="login_attempts",       created_col="attempted_at", id_col="id", default_days=60),
    RetentionSpec(table="notifications",        created_col="created_at", id_col="id", default_days=60),
]


def _retention_days(spec: RetentionSpec) -> Optional[int]:
    mapping = {
        "activity_logs": settings.log_retention_days_activity,
        "audit_logs": settings.log_retention_days_audit,
        "security_audit_logs": settings.log_retention_days_security_audit,
        "login_attempts": settings.log_retention_days_login_attempts,
        "notifications": settings.log_retention_days_notifications,
    }
    days = mapping.get(spec.table, spec.default_days)
    if days is None or days <= 0:
        return None
    return int(days)


def _now_utc() -> datetime:
    return datetime.utcnow()


@dataclass
class PruneTableResult:
    table: str
    retention_days: Optional[int]
    cutoff_utc: Optional[str]
    rows_total_before: int = 0
    rows_to_prune: int = 0
    rows_pruned: int = 0
    archived: bool = False
    archive_key: Optional[str] = None
    archive_size_bytes: int = 0
    error: Optional[str] = None


@dataclass
class PruneSummary:
    started_at_utc: str = field(default_factory=lambda: _now_utc().isoformat())
    finished_at_utc: Optional[str] = None
    results: Dict[str, PruneTableResult] = field(default_factory=dict)

    def total_pruned(self) -> int:
        return sum(r.rows_pruned for r in self.results.values())

    def total_archive_bytes(self) -> int:
        return sum(r.archive_size_bytes for r in self.results.values())


# ---------------------------------------------------------------------------
# Archive helpers (best-effort, safe)
# ---------------------------------------------------------------------------
def _chunked_select_for_archive(
    db: Session, spec: RetentionSpec, cutoff_ts: datetime, batch_size: int = 500, max_rows: int = 50_000
):
    """Yield list[dict] rows in batches; returns a generator to keep memory bounded."""
    offset = 0
    total_yielded = 0
    while True:
        sql = text(
            f"SELECT * FROM {spec.table} WHERE {spec.created_col} < :cutoff "
            f"ORDER BY {spec.id_col} ASC LIMIT :limit OFFSET :offset"
        )
        rows = db.execute(sql, {"cutoff": cutoff_ts, "limit": batch_size, "offset": offset}).mappings().all()
        if not rows:
            return
        batch = [dict(r) for r in rows]
        offset += len(batch)
        total_yielded += len(batch)
        yield batch
        if total_yielded >= max_rows or len(batch) < batch_size:
            return


def _archive_pruned_rows(db: Session, spec: RetentionSpec, cutoff: datetime) -> PruneTableResult:
    """Best-effort archive. Never prevents the prune step from running."""
    result = PruneTableResult(table=spec.table, retention_days=_retention_days(spec), cutoff_utc=cutoff.isoformat())
    try:
        from app.services.storage import get_storage_service

        storage = get_storage_service()
        stamp = cutoff.strftime("%Y%m%dT%H%M%SZ")
        key = f"{STORAGE_PREFIX_BACKUPS}/log-archives/{cutoff.strftime('%Y-%m')}/{spec.table}-before-{stamp}.jsonl.gz"

        buf = io.BytesIO()
        count = 0
        with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=6) as gz:
            for batch in _chunked_select_for_archive(db, spec, cutoff):
                for row in batch:
                    for k, v in list(row.items()):
                        if isinstance(v, (datetime,)):
                            row[k] = v.isoformat()
                        elif isinstance(v, bytes):
                            row[k] = None  # don't bloat archives with BLOB columns
                    gz.write((json.dumps(row, separators=(",", ":"), default=str) + "\n").encode("utf-8"))
                    count += 1
        if count == 0:
            return result
        payload = buf.getvalue()
        upload_key = None
        backend = getattr(storage, "backend_name", "local")
        try:
            if backend == "r2":
                # Use underlying S3 client API directly to bypass UploadFile requirement.
                client = storage._client()
                client.put_object(
                    Bucket=storage.bucket,
                    Key=key,
                    Body=payload,
                    ContentType="application/gzip",
                    CacheControl="public, max-age=31536000, immutable",
                )
                upload_key = key
            else:
                dest = getattr(storage, "base_dir") / key
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(payload)
                upload_key = key
        except Exception as up_exc:
            logger.warning("log archive upload failed for %s: %s", spec.table, up_exc)
            upload_key = None
        if upload_key:
            result.archived = True
            result.archive_key = upload_key
            result.archive_size_bytes = len(payload)
        result.rows_to_prune = count
    except Exception as exc:
        logger.warning("log archive skipped for %s: %s", spec.table, exc)
        result.error = f"archive: {exc}"
    return result


# ---------------------------------------------------------------------------
# Core pruning logic
# ---------------------------------------------------------------------------
def _counts(db: Session, spec: RetentionSpec, cutoff: Optional[datetime]) -> tuple[int, int]:
    total_row = db.execute(text(f"SELECT COUNT(*) FROM {spec.table}")).first()
    total = int(total_row[0]) if total_row else 0
    if cutoff is None:
        return total, 0
    prune_row = db.execute(
        text(f"SELECT COUNT(*) FROM {spec.table} WHERE {spec.created_col} < :cutoff"),
        {"cutoff": cutoff},
    ).first()
    prune_n = int(prune_row[0]) if prune_row else 0
    return total, prune_n


def prune_table(db: Session, spec: RetentionSpec, force_days: Optional[int] = None) -> PruneTableResult:
    days = force_days if force_days is not None else _retention_days(spec)
    cutoff = None
    if days is not None:
        cutoff = _now_utc() - timedelta(days=days)
    result = PruneTableResult(
        table=spec.table,
        retention_days=days,
        cutoff_utc=cutoff.isoformat() if cutoff else None,
    )
    try:
        total, to_prune = _counts(db, spec, cutoff)
        result.rows_total_before = total
        result.rows_to_prune = to_prune
    except Exception as exc:
        result.error = f"count: {exc}"
        logger.warning("log prune count failed for %s: %s", spec.table, exc)
        return result

    if cutoff is None or to_prune == 0:
        return result

    if settings.log_archive_before_delete:
        arc_result = _archive_pruned_rows(db, spec, cutoff)
        result.archived = arc_result.archived
        result.archive_key = arc_result.archive_key
        result.archive_size_bytes = arc_result.archive_size_bytes
        if arc_result.error and not result.error:
            result.error = arc_result.error

    try:
        delete_sql = text(f"DELETE FROM {spec.table} WHERE {spec.created_col} < :cutoff")
        db.execute(delete_sql, {"cutoff": cutoff})
        db.commit()
        result.rows_pruned = to_prune
    except Exception as exc:
        db.rollback()
        logger.error("log prune DELETE failed for %s: %s", spec.table, exc)
        if not result.error:
            result.error = f"delete: {exc}"
        else:
            result.error = f"{result.error}; delete: {exc}"
    return result


def run_log_retention(db: Session, force_days: Optional[Dict[str, int]] = None) -> PruneSummary:
    """Run prune across all known log tables. Returns summary for audit logging."""
    force_days = force_days or {}
    summary = PruneSummary()
    for spec in _LOG_SPECS:
        days = force_days.get(spec.table)
        summary.results[spec.table] = prune_table(db, spec, force_days=days)
    summary.finished_at_utc = _now_utc().isoformat()
    logger.info(
        "log retention complete: pruned=%d rows, archive_bytes=%d",
        summary.total_pruned(),
        summary.total_archive_bytes(),
    )
    return summary


# ---------------------------------------------------------------------------
# Public list helper (for admins)
# ---------------------------------------------------------------------------
def list_log_sizes(db: Session) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    now = _now_utc()
    for spec in _LOG_SPECS:
        days = _retention_days(spec)
        cutoff = (now - timedelta(days=days)).isoformat() if days else None
        total, older = _counts(db, spec, now - timedelta(days=days) if days else None)
        out[spec.table] = {
            "total_rows": total,
            "rows_older_than_cutoff": older,
            "retention_days": days,
            "cutoff_utc": cutoff,
        }
    return out
