import base64
import gzip
import hashlib
import json
import logging
import os
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppSetting
from app.services.firebase_backup import (
    init_firebase,
    delete_remote_backup,
    upload_backup,
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
LAST_RESTORE_KEY = "last_restore_at"


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


def _verify_checksum(path: Path) -> tuple[bool, str | None, str]:
    actual = _sha256(path)
    checksum_file = path.with_suffix(path.suffix + ".sha256")
    if not checksum_file.exists():
        return True, None, actual
    expected = checksum_file.read_text(encoding="utf-8").strip()
    return expected == actual, expected, actual


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


def _prune_local_backups() -> None:
    keep = int(settings.backup_keep_local)
    if keep <= 0:
        return
    files = _list_backup_files()
    for old in files[keep:]:
        try:
            old.unlink(missing_ok=True)
            old.with_suffix(old.suffix + ".sha256").unlink(missing_ok=True)
        except Exception as exc:
            logger.warning(f"Failed to prune backup file {old.name}: {exc}")


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


def _build_backup_filename(is_auto: bool) -> str:
    kind = "auto" if is_auto else "manual"
    ts = datetime.now().strftime("%Y_%m_%d_%H%M%S")
    return f"{kind}_{ts}.sqlite.gz"


def create_backup(db: Session, is_auto: bool = False, trigger: str = "manual") -> dict[str, Any]:
    backup_dir = Path(settings.backup_folder)
    backup_dir.mkdir(parents=True, exist_ok=True)
    db_path = Path(settings.sqlite_file)
    if not db_path.exists():
        raise FileNotFoundError(f"SQLite database not found: {db_path}")

    artifact_name = _build_backup_filename(is_auto)
    artifact_path = backup_dir / artifact_name

    with tempfile.NamedTemporaryFile(prefix="istore_snapshot_", suffix=".sqlite", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    shutil.copy2(db_path, tmp_path)
    _compress_file(tmp_path, artifact_path)
    tmp_path.unlink(missing_ok=True)

    encrypted = False
    encryption_reason = ""
    if settings.backup_encrypt:
        passphrase = settings.backup_encryption_passphrase.strip()
        if not passphrase:
            artifact_path.unlink(missing_ok=True)
            raise RuntimeError("Backup encryption is enabled, but no encryption passphrase is configured.")
        try:
            encrypted_path = _encrypt_file(artifact_path, passphrase)
            artifact_path.unlink(missing_ok=True)
            artifact_path = encrypted_path
            encrypted = True
        except Exception as exc:
            artifact_path.unlink(missing_ok=True)
            logger.warning(f"Backup encryption failed: {exc}")
            raise RuntimeError("Backup encryption failed.") from exc

    checksum = _write_checksum(artifact_path)
    file_size = artifact_path.stat().st_size
    timestamp = _now_utc_iso()
    backup_id = str(uuid.uuid4())

    firebase_result: dict[str, Any] = {"uploaded": False, "reason": "disabled"}
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
                firebase_result = upload_backup(
                    str(artifact_path),
                    destination_blob=f"{remote_prefix}{artifact_path.name}",
                    metadata=upload_meta,
                )
                if firebase_result.get("uploaded"):
                    remote_blob = firebase_result.get("blob")
            except Exception as exc:
                firebase_result = {"uploaded": False, "reason": str(exc)}
                logger.warning(f"Firebase backup upload failed: {exc}")
        else:
            firebase_result = {"uploaded": False, "reason": "missing credentials/bucket"}

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
        "status": "success",
        "trigger": trigger,
        "is_auto": bool(is_auto),
        "compressed": True,
        "encrypted": encrypted,
        "encryption_note": encryption_reason or None,
        "firebase_uploaded": bool(firebase_result.get("uploaded")),
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

    _prune_local_backups()
    _upsert_setting(db, LAST_BACKUP_KEY, timestamp)
    _append_backup_metadata(db, metadata_record)

    return {
        "status": "success",
        "backup": str(artifact_path),
        "filename": artifact_path.name,
        "checksum": checksum,
        "size_bytes": file_size,
        "at": timestamp,
        "firebase": firebase_result,
        "metadata": metadata_record,
    }


def restore_backup(db: Session, filename: str) -> dict[str, Any]:
    src = _safe_backup_path(filename)
    if not src.exists():
        raise FileNotFoundError(f"backup not found: {filename}")

    checksum_ok, expected, actual = _verify_checksum(src)
    if not checksum_ok:
        raise ValueError("backup checksum mismatch")

    work_dir = Path(tempfile.mkdtemp(prefix="istore_restore_"))
    try:
        stage = work_dir / "stage"
        stage.write_bytes(src.read_bytes())

        if _is_encrypted(stage):
            passphrase = settings.backup_encryption_passphrase.strip()
            if not passphrase:
                raise ValueError("backup is encrypted but no passphrase is configured")
            decrypted = work_dir / ("decrypted_payload.gz" if src.name.lower().endswith(".gz.enc") else "decrypted_payload.sqlite")
            _decrypt_file(stage, passphrase, decrypted)
            stage = decrypted

        sqlite_candidate = work_dir / "restored.sqlite"
        if _is_gz(stage):
            _decompress_file(stage, sqlite_candidate)
        else:
            shutil.copy2(stage, sqlite_candidate)

        live_db = Path(settings.sqlite_file)
        backup_dir = Path(settings.backup_folder)
        pre_name = f"pre_restore_{datetime.now().strftime('%Y_%m_%d_%H%M%S')}.sqlite"
        pre_path = backup_dir / pre_name
        shutil.copy2(live_db, pre_path)
        _write_checksum(pre_path)

        shutil.copy2(sqlite_candidate, live_db)
        restored_at = _now_utc_iso()
        _upsert_setting(db, LAST_RESTORE_KEY, restored_at)

        return {
            "status": "success",
            "restored": filename,
            "checksum": actual,
            "expected_checksum": expected,
            "pre_restore_snapshot": pre_name,
            "restored_at": restored_at,
        }
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
