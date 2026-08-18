import logging
import os
from datetime import datetime
from typing import Any

logger = logging.getLogger("istore.api")

try:
    from firebase_admin import credentials, firestore, initialize_app, storage
    FIREBASE_AVAILABLE = True
except Exception:
    FIREBASE_AVAILABLE = False

_app = None


def init_firebase(service_account_path: str, bucket_name: str) -> bool:
    global _app
    if not FIREBASE_AVAILABLE:
        logger.debug("firebase-admin package is not available.")
        return False
    if not service_account_path or not bucket_name:
        return False
    if not os.path.exists(service_account_path):
        logger.warning(f"Firebase service account file not found: {service_account_path}")
        return False

    try:
        if _app is None:
            cred = credentials.Certificate(service_account_path)
            _app = initialize_app(cred, {"storageBucket": bucket_name})
        return True
    except Exception as exc:
        logger.warning(f"Firebase initialization failed: {exc}")
        return False


def is_firebase_ready() -> bool:
    return _app is not None and FIREBASE_AVAILABLE


def upload_backup(file_path: str, destination_blob: str | None = None, metadata: dict | None = None) -> dict[str, Any]:
    if _app is None:
        return {"uploaded": False, "reason": "firebase-not-configured"}
    try:
        bucket = storage.bucket()
        blob_path = destination_blob or f"istore-backups/{datetime.now().strftime('%Y%m%d')}/{os.path.basename(file_path)}"
        blob = bucket.blob(blob_path)
        if metadata:
            blob.metadata = {str(k): str(v) for k, v in metadata.items() if v is not None}
        blob.upload_from_filename(file_path)
        blob.reload()
        return {
            "uploaded": True,
            "blob": blob.name,
            "size": blob.size,
            "updated": blob.updated.isoformat() if blob.updated else None,
            "md5_hash": blob.md5_hash,
        }
    except Exception as exc:
        logger.error(f"Firebase upload failed for {file_path}: {exc}")
        return {"uploaded": False, "reason": str(exc)}


def verify_remote_backup(blob_path: str, expected_size: int | None = None, expected_checksum: str | None = None) -> dict[str, Any]:
    """Verifies that a remote blob exists and matches expected parameters."""
    if _app is None or not blob_path:
        return {"verified": False, "reason": "firebase-not-configured"}
    try:
        bucket = storage.bucket()
        blob = bucket.blob(blob_path)
        if not blob.exists():
            return {"verified": False, "reason": "remote blob does not exist"}
        blob.reload()
        actual_size = blob.size
        size_match = expected_size is None or actual_size == expected_size
        meta = blob.metadata or {}
        stored_sha = meta.get("checksum") or meta.get("sha256")
        checksum_match = True
        if expected_checksum and stored_sha:
            checksum_match = expected_checksum.lower() == stored_sha.lower()

        if not size_match:
            return {"verified": False, "reason": f"size mismatch (expected {expected_size}, got {actual_size})"}
        if not checksum_match:
            return {"verified": False, "reason": f"checksum mismatch (expected {expected_checksum}, got {stored_sha})"}

        return {
            "verified": True,
            "blob": blob.name,
            "size": actual_size,
            "metadata": meta,
            "updated": blob.updated.isoformat() if blob.updated else None,
        }
    except Exception as exc:
        logger.error(f"Firebase blob verification failed for {blob_path}: {exc}")
        return {"verified": False, "reason": str(exc)}


def download_backup(blob_path: str, destination_path: str) -> dict[str, Any]:
    """Downloads a backup blob from Firebase Cloud Storage to a local file path."""
    if _app is None or not blob_path:
        return {"success": False, "reason": "firebase-not-configured"}
    try:
        bucket = storage.bucket()
        blob = bucket.blob(blob_path)
        if not blob.exists():
            return {"success": False, "reason": "remote blob does not exist"}
        os.makedirs(os.path.dirname(os.path.abspath(destination_path)), exist_ok=True)
        blob.download_to_filename(destination_path)
        return {
            "success": True,
            "destination": destination_path,
            "size": os.path.getsize(destination_path) if os.path.exists(destination_path) else 0,
        }
    except Exception as exc:
        logger.error(f"Firebase download failed for {blob_path}: {exc}")
        return {"success": False, "reason": str(exc)}


def list_remote_backups(prefix: str = "istore-backups/") -> list[dict[str, Any]]:
    """Lists remote backup blobs in Firebase Cloud Storage."""
    if _app is None:
        return []
    try:
        bucket = storage.bucket()
        blobs = bucket.list_blobs(prefix=prefix)
        results = []
        for b in blobs:
            if b.name.endswith("/"):
                continue
            meta = b.metadata or {}
            results.append({
                "blob_name": b.name,
                "filename": os.path.basename(b.name),
                "size_bytes": b.size,
                "created_at": b.time_created.isoformat() if b.time_created else None,
                "updated_at": b.updated.isoformat() if b.updated else None,
                "checksum": meta.get("checksum") or meta.get("sha256"),
                "app_version": meta.get("app_version"),
                "trigger": meta.get("trigger"),
                "encrypted": meta.get("encrypted") == "true",
            })
        results.sort(key=lambda x: x.get("created_at") or "", reverse=True)
        return results
    except Exception as exc:
        logger.error(f"Failed to list remote Firebase backups: {exc}")
        return []


def write_backup_metadata(record: dict, collection_name: str = "backup_metadata") -> dict[str, Any]:
    if _app is None:
        return {"stored": False, "reason": "firebase-not-configured"}
    try:
        db = firestore.client()
        backup_id = str(record.get("backup_id", "")).strip()
        doc = db.collection(collection_name).document(backup_id) if backup_id else db.collection(collection_name).document()
        payload = {k: v for k, v in record.items() if v is not None}
        doc.set(payload)
        return {"stored": True, "doc_id": doc.id}
    except Exception as exc:
        logger.warning(f"Firestore metadata write failed: {exc}")
        return {"stored": False, "reason": str(exc)}


def delete_remote_backup(blob_path: str) -> bool:
    if _app is None or not blob_path:
        return False
    try:
        bucket = storage.bucket()
        blob = bucket.blob(blob_path)
        blob.delete()
        return True
    except Exception as exc:
        logger.warning(f"Failed to delete remote blob {blob_path}: {exc}")
        return False
