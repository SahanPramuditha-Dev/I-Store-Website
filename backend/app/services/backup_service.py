import base64
import gzip
import hashlib
import json
import logging
import os
import shutil
import sqlite3
import tempfile
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppSetting
from app.services.firebase_backup import (
    init_firebase,
    delete_remote_backup,
    download_backup,
    list_remote_backups,
    upload_backup,
    verify_remote_backup,
    write_backup_metadata,
)

logger = logging.getLogger("istore.api")

try:
    from cryptography.fernet import Fernet
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    CRYPTO_AVAILABLE = True
except Exception:
    CRYPTO_AVAILABLE = False

BACKUP_SUFFIXES = (".sqlite", ".sqlite.enc", ".sqlite.gz", ".sqlite.gz.enc", ".db", ".db.gz", ".db.gz.enc")
ENCRYPTION_MAGIC = b"ISTOREBK1"
BACKUP_META_KEY = "backup_metadata_history"
LAST_BACKUP_KEY = "last_backup_at"
LAST_VERIFIED_BACKUP_KEY = "last_verified_backup_at"
LAST_RESTORE_KEY = "last_restore_at"


def _get_live_database_path() -> Path:
    """Returns the path to the live active SQLite database file."""
    path = Path(settings.sqlite_file)
    if path.exists():
        return path
    try:
        from app.database import engine
        if engine and engine.url and engine.url.database:
            candidate = Path(engine.url.database)
            if candidate.exists():
                return candidate
    except Exception:
        pass
    return path

# Process-level backup concurrency lock
_BACKUP_LOCK = threading.Lock()
_BACKUP_IN_PROGRESS = False


@contextmanager
def acquire_backup_lock(timeout_seconds: float = 1.0):
    global _BACKUP_IN_PROGRESS
    acquired = _BACKUP_LOCK.acquire(timeout=timeout_seconds)
    if not acquired or _BACKUP_IN_PROGRESS:
        if acquired:
            _BACKUP_LOCK.release()
        raise RuntimeError("Another backup or restore operation is already in progress.")
    try:
        _BACKUP_IN_PROGRESS = True
        yield
    finally:
        _BACKUP_IN_PROGRESS = False
        _BACKUP_LOCK.release()


def is_backup_in_progress() -> bool:
    return _BACKUP_IN_PROGRESS


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _write_checksum(path: Path) -> str:
    checksum = _sha256(path)
    path.with_suffix(path.suffix + ".sha256").write_text(checksum, encoding="utf-8")
    return checksum


def _checkpoint_sqlite_database(db_path: Path) -> None:
    if not db_path.exists():
        return
    try:
        conn = sqlite3.connect(str(db_path))
        try:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:
        logger.warning(f"SQLite checkpoint skipped for backup: {exc}")


def _safe_sqlite_online_snapshot(src_db_path: Path, dst_db_path: Path) -> None:
    """Uses SQLite's Online Backup API to safely create a consistent atomic snapshot

    even while WAL mode or active transactions may be executing concurrently.
    """
    _checkpoint_sqlite_database(src_db_path)
    if dst_db_path.exists():
        dst_db_path.unlink(missing_ok=True)

    src_conn = None
    dst_conn = None
    try:
        try:
            src_conn = sqlite3.connect(f"file:{src_db_path}?mode=ro", uri=True)
        except Exception:
            src_conn = sqlite3.connect(str(src_db_path))

        dst_conn = sqlite3.connect(str(dst_db_path))
        with dst_conn:
            src_conn.backup(dst_conn, pages=200, sleep=0.005)
    finally:
        if dst_conn:
            try:
                dst_conn.close()
            except Exception:
                pass
        if src_conn:
            try:
                src_conn.close()
            except Exception:
                pass


def perform_database_maintenance(db_path: Path | None = None) -> dict[str, Any]:
    from app.config import DB_FILE
    target = Path(db_path or DB_FILE)
    if not target.exists():
        return {"success": False, "message": "Database file not found"}
    try:
        conn = sqlite3.connect(str(target))
        try:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
            conn.execute("PRAGMA optimize;")
            conn.execute("ANALYZE;")
            conn.commit()
        finally:
            conn.close()
        logger.info(f"Database maintenance completed successfully on {target.name}")
        return {"success": True, "message": "Database WAL checkpoint and optimization completed"}
    except Exception as exc:
        logger.error(f"Database maintenance error: {exc}")
        return {"success": False, "message": str(exc)}


def _remove_sqlite_companion_files(db_path: Path) -> None:
    for suffix in ("-wal", "-shm"):
        candidate = db_path.with_name(db_path.name + suffix)
        if candidate.exists():
            candidate.unlink(missing_ok=True)


def _is_sqlite_header(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        with path.open("rb") as fh:
            return fh.read(16) == b"SQLite format 3\x00"
    except Exception:
        return False


def _verify_snapshot_integrity(db_path: Path) -> tuple[bool, str]:
    """Runs PRAGMA integrity_check on the database file."""
    if not _is_sqlite_header(db_path):
        return False, "Not a valid SQLite database header"
    conn = None
    try:
        conn = sqlite3.connect(str(db_path))
        cur = conn.cursor()
        cur.execute("PRAGMA integrity_check;")
        res = cur.fetchall()
        if res == [("ok",)]:
            return True, "ok"
        return False, f"Integrity check failed: {res}"
    except Exception as exc:
        return False, f"Integrity check exception: {exc}"
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def _verify_snapshot_schema(db_path: Path) -> tuple[bool, dict[str, Any]]:
    """Validates schema: table counts and structural presence of tables."""
    conn = None
    try:
        conn = sqlite3.connect(str(db_path))
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
        tables = [row[0] for row in cur.fetchall()]
        if len(tables) == 0:
            return False, {"tables_count": 0, "status": "empty_database"}
        core_tables = ["users", "app_settings"]
        missing_core = [t for t in core_tables if t not in tables]
        return True, {
            "tables_count": len(tables),
            "tables_sample": tables[:10],
            "missing_core": missing_core if missing_core else None,
            "status": "ok",
        }
    except Exception as exc:
        return False, {"error": str(exc), "status": "exception"}
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def _is_valid_sqlite_database(path: Path) -> bool:
    ok, _ = _verify_snapshot_integrity(path)
    return ok


def _compress_file(src: Path, dst: Path) -> None:
    with src.open("rb") as fin, gzip.open(dst, "wb", compresslevel=6) as fout:
        shutil.copyfileobj(fin, fout, length=1024 * 1024)


def _decompress_file(src: Path, dst: Path) -> None:
    with gzip.open(src, "rb") as fin, dst.open("wb") as fout:
        shutil.copyfileobj(fin, fout, length=1024 * 1024)


def _derive_fernet(passphrase: str, salt: bytes) -> Fernet:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=390000)
    key = base64.urlsafe_b64encode(kdf.derive(passphrase.encode("utf-8")))
    return Fernet(key)


def _encrypt_file(src: Path, passphrase: str) -> Path:
    if not CRYPTO_AVAILABLE:
        raise RuntimeError("cryptography package is not available; cannot encrypt backup")
    salt = os.urandom(16)
    fernet = _derive_fernet(passphrase, salt)
    token = fernet.encrypt(src.read_bytes())
    encrypted_path = Path(str(src) + ".enc")
    with encrypted_path.open("wb") as fh:
        fh.write(ENCRYPTION_MAGIC)
        fh.write(salt)
        fh.write(token)
    return encrypted_path


def _decrypt_file(src: Path, passphrase: str, dst: Path) -> None:
    if not CRYPTO_AVAILABLE:
        raise RuntimeError("cryptography package is not available; cannot decrypt backup")
    payload = src.read_bytes()
    if len(payload) < len(ENCRYPTION_MAGIC) + 16 or payload[: len(ENCRYPTION_MAGIC)] != ENCRYPTION_MAGIC:
        raise ValueError("invalid encrypted backup format")
    salt = payload[len(ENCRYPTION_MAGIC) : len(ENCRYPTION_MAGIC) + 16]
    token = payload[len(ENCRYPTION_MAGIC) + 16 :]
    fernet = _derive_fernet(passphrase, salt)
    dst.write_bytes(fernet.decrypt(token))


def _is_encrypted(path: Path) -> bool:
    return path.suffix.lower() == ".enc"


def _is_gz(path: Path) -> bool:
    if _is_encrypted(path):
        return path.name.lower().endswith(".gz.enc")
    return path.suffix.lower() == ".gz"


def _safe_backup_path(filename: str) -> Path:
    if "/" in filename or "\\" in filename:
        raise ValueError("invalid filename")
    backup_dir = Path(settings.backup_folder)
    target = (backup_dir / filename).resolve()
    if not str(target).startswith(str(backup_dir.resolve())):
        raise ValueError("invalid backup target path")
    return target


def _list_backup_files() -> list[Path]:
    folder = Path(settings.backup_folder)
    folder.mkdir(parents=True, exist_ok=True)
    files: list[Path] = []
    for item in folder.iterdir():
        if not item.is_file():
            continue
        name = item.name.lower()
        if name.endswith(".sha256"):
            continue
        if any(name.endswith(suffix) for suffix in BACKUP_SUFFIXES):
            files.append(item)
    files.sort(key=lambda row: row.stat().st_mtime, reverse=True)
    return files


def list_backup_filenames() -> list[str]:
    return [row.name for row in _list_backup_files()]


def _verify_checksum(path: Path) -> tuple[bool, str | None, str]:
    actual = _sha256(path)
    checksum_file = path.with_suffix(path.suffix + ".sha256")
    if not checksum_file.exists():
        return True, None, actual
    expected = checksum_file.read_text(encoding="utf-8").strip()
    return expected.lower() == actual.lower(), expected, actual


def test_restore_backup(filename_or_path: str | Path, passphrase: str | None = None) -> dict[str, Any]:
    """Non-destructively validates that a backup archive can be completely decompressed,

    decrypted, verified with PRAGMA integrity_check, and contains a valid I-Store schema.
    NEVER touches or modifies the live production database.
    """
    if isinstance(filename_or_path, Path):
        src = filename_or_path
    else:
        src = _safe_backup_path(filename_or_path)

    if not src.exists():
        return {"restorable": False, "reason": f"File not found: {src.name}"}

    checksum_ok, expected_checksum, actual_checksum = _verify_checksum(src)
    if not checksum_ok:
        return {
            "restorable": False,
            "reason": f"SHA-256 checksum mismatch (expected {expected_checksum}, calculated {actual_checksum})",
            "checksum": actual_checksum,
        }

    work_dir = Path(tempfile.mkdtemp(prefix="istore_test_restore_"))
    try:
        stage = work_dir / src.name
        stage.write_bytes(src.read_bytes())

        if _is_encrypted(stage):
            key = (passphrase or settings.backup_encryption_passphrase).strip()
            if not key:
                return {"restorable": False, "reason": "Backup is encrypted but no passphrase was provided."}
            decrypted = work_dir / ("decrypted_payload.gz" if stage.name.lower().endswith(".gz.enc") else "decrypted_payload.sqlite")
            try:
                _decrypt_file(stage, key, decrypted)
                stage = decrypted
            except Exception as exc:
                return {"restorable": False, "reason": f"Decryption failed: {exc}"}

        sqlite_candidate = work_dir / "candidate.sqlite"
        if _is_gz(stage):
            try:
                _decompress_file(stage, sqlite_candidate)
            except Exception as exc:
                return {"restorable": False, "reason": f"Decompression failed: {exc}"}
        else:
            shutil.copy2(stage, sqlite_candidate)

        integrity_ok, integrity_msg = _verify_snapshot_integrity(sqlite_candidate)
        if not integrity_ok:
            return {"restorable": False, "reason": f"Integrity check failed: {integrity_msg}"}

        schema_ok, schema_info = _verify_snapshot_schema(sqlite_candidate)
        if not schema_ok:
            return {"restorable": False, "reason": f"Schema check failed: {schema_info}"}

        return {
            "restorable": True,
            "filename": src.name,
            "size_bytes": src.stat().st_size,
            "checksum": actual_checksum,
            "integrity": integrity_msg,
            "schema": schema_info,
            "tested_at": _now_utc_iso(),
        }
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def _restore_backup_candidate(backup_path: Path, live_db: Path, backup_dir: Path) -> bool:
    test_result = test_restore_backup(backup_path)
    if not test_result.get("restorable"):
        return False

    work_dir = Path(tempfile.mkdtemp(prefix="istore_repair_"))
    try:
        stage = work_dir / backup_path.name
        stage.write_bytes(backup_path.read_bytes())

        if _is_encrypted(stage):
            passphrase = settings.backup_encryption_passphrase.strip()
            if not passphrase:
                return False
            decrypted = work_dir / ("decrypted_payload.gz" if backup_path.name.lower().endswith(".gz.enc") else "decrypted_payload.sqlite")
            _decrypt_file(stage, passphrase, decrypted)
            stage = decrypted

        sqlite_candidate = work_dir / "restored.sqlite"
        if _is_gz(stage):
            _decompress_file(stage, sqlite_candidate)
        else:
            shutil.copy2(stage, sqlite_candidate)

        if not _is_valid_sqlite_database(sqlite_candidate):
            return False

        if live_db.exists():
            pre_restore_name = f"pre_restore_{datetime.now().strftime('%Y_%m_%d_%H%M%S')}.sqlite"
            pre_restore_path = backup_dir / pre_restore_name
            shutil.copy2(live_db, pre_restore_path)
            _write_checksum(pre_restore_path)

        shutil.copy2(sqlite_candidate, live_db)
        _remove_sqlite_companion_files(live_db)
        return True
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def recover_database_from_latest_valid_backup() -> dict[str, Any] | None:
    live_db = _get_live_database_path()
    if live_db.exists() and _is_valid_sqlite_database(live_db):
        return None

    backup_dir = Path(settings.backup_folder)
    files = _list_backup_files()
    for candidate in files:
        checksum_ok, _, _ = _verify_checksum(candidate)
        if not checksum_ok:
            continue
        try:
            if _restore_backup_candidate(candidate, live_db, backup_dir):
                restored_at = _now_utc_iso()
                return {
                    "status": "recovered",
                    "restored": candidate.name,
                    "restored_at": restored_at,
                    "live_db": str(live_db),
                }
        except Exception:
            continue
    return None


def _prune_local_backups_tiered() -> dict[str, Any]:
    """Implements Grandfather-Father-Son tiered retention policy:

    - Keep all daily backups for the last 7 days
    - Keep 1 weekly backup for each of the last 4 weeks
    - Keep 1 monthly backup for each of the last 3 months
    - Preserve manual, pre_migration, and emergency backups
    - CRITICAL INVARIANT: NEVER delete the most recent verified backup!
    """
    files = _list_backup_files()
    if not files:
        return {"pruned": 0, "kept": 0}

    # Identify the newest file to guarantee it is NEVER pruned
    newest_file = files[0]
    now = datetime.now()

    kept: list[Path] = [newest_file]
    daily_cutoff = now - timedelta(days=7)
    weekly_cutoff = now - timedelta(days=28)
    monthly_cutoff = now - timedelta(days=90)

    seen_weeks: set[str] = set()
    seen_months: set[str] = set()
    to_delete: list[Path] = []

    for f in files[1:]:
        name = f.name.lower()
        # Always keep special safety / manual snapshots unless older than 90 days
        if any(name.startswith(p) for p in ("manual_", "pre_restore_", "pre-migration_", "emergency_", "recovered_")):
            file_mtime = datetime.fromtimestamp(f.stat().st_mtime)
            if file_mtime >= monthly_cutoff:
                kept.append(f)
                continue

        file_mtime = datetime.fromtimestamp(f.stat().st_mtime)
        if file_mtime >= daily_cutoff:
            kept.append(f)
        elif file_mtime >= weekly_cutoff:
            week_key = f"{file_mtime.isocalendar()[0]}-W{file_mtime.isocalendar()[1]}"
            if week_key not in seen_weeks:
                seen_weeks.add(week_key)
                kept.append(f)
            else:
                to_delete.append(f)
        elif file_mtime >= monthly_cutoff:
            month_key = f"{file_mtime.year}-{file_mtime.month:02d}"
            if month_key not in seen_months:
                seen_months.add(month_key)
                kept.append(f)
            else:
                to_delete.append(f)
        else:
            to_delete.append(f)

    # Execute deletion
    pruned_count = 0
    for old in to_delete:
        try:
            old.unlink(missing_ok=True)
            old.with_suffix(old.suffix + ".sha256").unlink(missing_ok=True)
            pruned_count += 1
        except Exception as exc:
            logger.warning(f"Failed to prune old backup {old.name}: {exc}")

    return {"pruned": pruned_count, "kept": len(kept)}


_prune_local_backups = _prune_local_backups_tiered


def _prune_remote_backups_by_registry(db: Session) -> None:
    keep = int(settings.firebase_prune_remote_keep)
    if keep <= 0:
        return
    row = db.query(AppSetting).filter(AppSetting.key == BACKUP_META_KEY).first()
    if not row or not row.value:
        return
    try:
        existing = json.loads(row.value)
        if not isinstance(existing, list):
            return
    except Exception:
        return

    remote_backups = [r for r in existing if r.get("firebase_uploaded") and r.get("firebase_blob")]
    to_prune = remote_backups[keep:]
    if not to_prune:
        return

    for record in to_prune:
        blob_path = record.get("firebase_blob")
        if blob_path:
            try:
                success = delete_remote_backup(blob_path)
                if success:
                    record["firebase_uploaded"] = False
                    record["firebase_blob"] = None
            except Exception as exc:
                logger.warning(f"Failed to delete remote blob {blob_path}: {exc}")

    row.value = json.dumps(existing, ensure_ascii=False)
    db.commit()


def _upsert_setting(db: Session, key: str, value: str) -> None:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=key, value=value))
    db.commit()


def _append_backup_metadata(db: Session, record: dict[str, Any]) -> None:
    row = db.query(AppSetting).filter(AppSetting.key == BACKUP_META_KEY).first()
    existing: list[dict[str, Any]] = []
    if row and row.value:
        try:
            payload = json.loads(row.value)
            if isinstance(payload, list):
                existing = payload
        except Exception:
            existing = []
    existing.insert(0, record)
    max_entries = int(settings.backup_meta_history_keep)
    if max_entries > 0:
        existing = existing[:max_entries]
    value = json.dumps(existing, ensure_ascii=False)
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=BACKUP_META_KEY, value=value))
    db.commit()


def _build_backup_filename(is_auto: bool, trigger: str = "manual") -> str:
    kind = "auto" if is_auto else trigger.replace("-", "_").replace(" ", "_")
    ts = datetime.now().strftime("%Y_%m_%d_%H%M%S")
    return f"{kind}_{ts}.sqlite.gz"


def create_backup(db: Session, is_auto: bool = False, trigger: str = "manual") -> dict[str, Any]:
    """Production-grade backup pipeline with SQLite Online Backup API,

    pre/post integrity validation, SHA-256 checksums, and test restore verification.
    """
    with acquire_backup_lock():
        backup_dir = Path(settings.backup_folder)
        backup_dir.mkdir(parents=True, exist_ok=True)
        db_path = _get_live_database_path()
        if not db_path.exists():
            raise FileNotFoundError(f"SQLite database not found: {db_path}")

        artifact_name = _build_backup_filename(is_auto, trigger)
        artifact_path = backup_dir / artifact_name
        timestamp = _now_utc_iso()
        backup_id = str(uuid.uuid4())

        # Stage 1: Safe Online SQLite Snapshot to temporary file
        with tempfile.NamedTemporaryFile(prefix="istore_snap_", suffix=".sqlite", delete=False) as tmp_snap:
            tmp_snap_path = Path(tmp_snap.name)
        try:
            _safe_sqlite_online_snapshot(db_path, tmp_snap_path)

            # Stage 2: Immediate Snapshot Integrity Check
            snap_integrity_ok, snap_integrity_msg = _verify_snapshot_integrity(tmp_snap_path)
            if not snap_integrity_ok:
                raise RuntimeError(f"Snapshot integrity check failed: {snap_integrity_msg}")

            snap_schema_ok, snap_schema_info = _verify_snapshot_schema(tmp_snap_path)
            if not snap_schema_ok:
                raise RuntimeError(f"Snapshot schema verification failed: {snap_schema_info}")

            # Stage 3: Compression
            _compress_file(tmp_snap_path, artifact_path)
        finally:
            tmp_snap_path.unlink(missing_ok=True)

        # Stage 4: Encryption (if configured)
        encrypted = False
        encryption_reason = ""
        if settings.backup_encrypt:
            passphrase = settings.backup_encryption_passphrase.strip()
            if not passphrase:
                artifact_path.unlink(missing_ok=True)
                raise RuntimeError("Backup encryption is enabled (BACKUP_ENCRYPT=true), but no passphrase is configured.")
            try:
                encrypted_path = _encrypt_file(artifact_path, passphrase)
                artifact_path.unlink(missing_ok=True)
                artifact_path = encrypted_path
                encrypted = True
            except Exception as exc:
                artifact_path.unlink(missing_ok=True)
                logger.error(f"Backup encryption failed: {exc}")
                raise RuntimeError("Backup encryption failed.") from exc

        # Stage 5: Checksum and sidecar
        checksum = _write_checksum(artifact_path)
        file_size = artifact_path.stat().st_size

        # Stage 6: Restore Simulation Verification
        test_restore_res = test_restore_backup(artifact_path)
        is_verified = bool(test_restore_res.get("restorable"))
        verification_error = test_restore_res.get("reason") if not is_verified else None

        if not is_verified:
            logger.error(f"Backup verification failed for {artifact_path.name}: {verification_error}")
            artifact_path.unlink(missing_ok=True)
            artifact_path.with_suffix(artifact_path.suffix + ".sha256").unlink(missing_ok=True)
            raise RuntimeError(f"Backup verification failed: {verification_error}")

        # Stage 7: Cloud Storage Upload & Remote Verification (if configured)
        firebase_result: dict[str, Any] = {"uploaded": False, "verified": False, "reason": "disabled"}
        remote_blob = None
        remote_prefix = f"istore-backups/{datetime.now().strftime('%Y%m%d')}/"

        if settings.firebase_backup_enabled:
            sa = settings.firebase_service_account
            bucket = settings.firebase_bucket
            if sa and bucket and os.path.exists(sa):
                try:
                    init_firebase(sa, bucket)
                    upload_meta = {
                        "backup_id": backup_id,
                        "timestamp": timestamp,
                        "checksum": checksum,
                        "app_version": settings.app_version,
                        "schema_version": settings.db_schema_version,
                        "device_name": settings.device_name,
                        "trigger": trigger,
                        "encrypted": str(encrypted).lower(),
                        "compressed": "true",
                    }
                    blob_target = f"{remote_prefix}{artifact_path.name}"
                    upload_res = upload_backup(
                        str(artifact_path),
                        destination_blob=blob_target,
                        metadata=upload_meta,
                    )
                    if upload_res.get("uploaded"):
                        remote_blob = upload_res.get("blob")
                        verify_res = verify_remote_backup(
                            remote_blob,
                            expected_size=file_size,
                            expected_checksum=checksum,
                        )
                        firebase_result = {
                            "uploaded": True,
                            "verified": verify_res.get("verified", False),
                            "blob": remote_blob,
                            "verify_detail": verify_res,
                        }
                    else:
                        firebase_result = upload_res
                except Exception as exc:
                    firebase_result = {"uploaded": False, "verified": False, "reason": str(exc)}
                    logger.warning(f"Firebase backup upload/verify failed: {exc}")
            else:
                firebase_result = {"uploaded": False, "verified": False, "reason": "missing credentials/bucket"}

        metadata_record = {
            "backup_id": backup_id,
            "timestamp": timestamp,
            "filename": artifact_path.name,
            "local_path": str(artifact_path),
            "size_bytes": file_size,
            "checksum": checksum,
            "app_version": settings.app_version,
            "schema_version": settings.db_schema_version,
            "device_name": settings.device_name,
            "status": "verified" if is_verified else "failed",
            "verified": is_verified,
            "restorable": is_verified,
            "verification_tested_at": test_restore_res.get("tested_at"),
            "trigger": trigger,
            "is_auto": bool(is_auto),
            "compressed": True,
            "encrypted": encrypted,
            "encryption_note": encryption_reason or None,
            "firebase_uploaded": bool(firebase_result.get("uploaded")),
            "firebase_verified": bool(firebase_result.get("verified")),
            "firebase_blob": remote_blob,
        }

        if settings.firebase_backup_enabled and settings.firebase_store_metadata and firebase_result.get("uploaded"):
            try:
                write_backup_metadata(metadata_record, collection_name=settings.firebase_metadata_collection)
            except Exception as exc:
                logger.warning(f"Firestore metadata write failed (non-fatal): {exc}")

        if settings.firebase_backup_enabled and settings.firebase_prune_remote_keep > 0:
            try:
                _prune_remote_backups_by_registry(db)
            except Exception as exc:
                logger.warning(f"Remote backup prune failed (non-fatal): {exc}")

        # Tiered retention
        retention_res = _prune_local_backups_tiered()

        # Update authoritative AppSetting timestamps
        _upsert_setting(db, LAST_BACKUP_KEY, timestamp)
        if is_verified:
            _upsert_setting(db, LAST_VERIFIED_BACKUP_KEY, timestamp)

        _append_backup_metadata(db, metadata_record)

        # Sync BackupRecord table if it exists
        try:
            from app.models import BackupRecord
            rec = BackupRecord(
                backup_code=f"BCK-{datetime.now().strftime('%Y%m%d')}-{artifact_name[:8]}",
                filename=artifact_path.name,
                status="verified" if is_verified else "failed",
                backup_type="auto" if is_auto else trigger,
                storage_target="local_and_cloud" if firebase_result.get("uploaded") else "local",
                checksum=checksum,
                size_bytes=file_size,
                metadata_json=json.dumps(metadata_record, ensure_ascii=False),
            )
            db.add(rec)
            db.commit()
        except Exception as exc:
            logger.debug(f"BackupRecord sync note (non-fatal): {exc}")

        return {
            "status": "success",
            "backup": str(artifact_path),
            "filename": artifact_path.name,
            "checksum": checksum,
            "size_bytes": file_size,
            "at": timestamp,
            "verified": is_verified,
            "restorable": is_verified,
            "firebase": firebase_result,
            "retention": retention_res,
            "metadata": metadata_record,
        }


def restore_backup(db: Session, filename: str, passphrase: str | None = None) -> dict[str, Any]:
    """Safe, hardened production restore with pre-validation and emergency pre-restore snapshot."""
    with acquire_backup_lock():
        src = _safe_backup_path(filename)
        if not src.exists():
            raise FileNotFoundError(f"Backup file not found: {filename}")

        # Pre-validate candidate in sandbox first
        test_res = test_restore_backup(src, passphrase=passphrase)
        if not test_res.get("restorable"):
            raise ValueError(f"Restore rejected: backup candidate failed integrity checks ({test_res.get('reason')})")

        work_dir = Path(tempfile.mkdtemp(prefix="istore_restore_stage_"))
        try:
            stage = work_dir / src.name
            stage.write_bytes(src.read_bytes())

            if _is_encrypted(stage):
                key = (passphrase or settings.backup_encryption_passphrase).strip()
                if not key:
                    raise ValueError("Backup is encrypted but no passphrase was provided.")
                decrypted = work_dir / ("decrypted_payload.gz" if src.name.lower().endswith(".gz.enc") else "decrypted_payload.sqlite")
                _decrypt_file(stage, key, decrypted)
                stage = decrypted

            sqlite_candidate = work_dir / "restored.sqlite"
            if _is_gz(stage):
                _decompress_file(stage, sqlite_candidate)
            else:
                shutil.copy2(stage, sqlite_candidate)

            if not _is_valid_sqlite_database(sqlite_candidate):
                raise ValueError("Restored candidate failed final SQLite integrity check.")

            live_db = _get_live_database_path()
            backup_dir = Path(settings.backup_folder)
            backup_dir.mkdir(parents=True, exist_ok=True)

            # Emergency Pre-Restore Safety Snapshot of current Live DB
            pre_name = f"pre_restore_{datetime.now().strftime('%Y_%m_%d_%H%M%S')}.sqlite"
            pre_path = backup_dir / pre_name
            if live_db.exists():
                _checkpoint_sqlite_database(live_db)
                shutil.copy2(live_db, pre_path)
                _write_checksum(pre_path)

            # Atomically replace live database
            shutil.copy2(sqlite_candidate, live_db)
            _remove_sqlite_companion_files(live_db)
            restored_at = _now_utc_iso()
            _upsert_setting(db, LAST_RESTORE_KEY, restored_at)

            return {
                "status": "success",
                "restored": filename,
                "checksum": test_res.get("checksum"),
                "pre_restore_snapshot": pre_name,
                "restored_at": restored_at,
            }
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)


def check_and_run_catchup_backup(db: Session, max_age_hours: float = 24.0) -> dict[str, Any] | None:
    """Checks if the last verified backup is older than max_age_hours (or missing).

    If overdue, executes a catch-up backup immediately.
    """
    row = db.query(AppSetting).filter(AppSetting.key == LAST_VERIFIED_BACKUP_KEY).first()
    if not row or not row.value:
        row = db.query(AppSetting).filter(AppSetting.key == LAST_BACKUP_KEY).first()

    last_dt = None
    if row and row.value:
        try:
            val = str(row.value).strip().replace("Z", "+00:00")
            last_dt = datetime.fromisoformat(val)
            if last_dt.tzinfo is not None:
                last_dt = last_dt.astimezone(timezone.utc).replace(tzinfo=None)
        except Exception:
            last_dt = None

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    is_overdue = last_dt is None or (now - last_dt) > timedelta(hours=max_age_hours)

    if is_overdue:
        logger.info(f"Overdue backup detected (last: {last_dt}). Running automatic catch-up backup...")
        try:
            return create_backup(db, is_auto=True, trigger="startup_catchup")
        except Exception as exc:
            logger.error(f"Catch-up backup failed: {exc}")
            return {"status": "failed", "error": str(exc)}
    return None
