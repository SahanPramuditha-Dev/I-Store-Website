"""Private Cloudflare R2 backup storage using its S3-compatible API."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

from app.config import settings


def _enable_system_trust_store() -> None:
    """Use the Windows CA store without ever disabling TLS verification.

    Antivirus HTTPS scanners such as AVG install their signing root in the
    Windows store.  Python's bundled CA file cannot see that root, so a valid
    locally inspected connection otherwise fails before R2 authentication.
    """
    if sys.platform != "win32":
        return
    try:
        import truststore  # type: ignore

        truststore.inject_into_ssl()
    except ImportError:  # pragma: no cover - dependency is packaged on Windows
        pass


def _client():
    _enable_system_trust_store()
    try:
        import boto3  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("boto3 is required for Cloudflare R2 backups") from exc
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint,
        aws_access_key_id=settings.r2_access_key,
        aws_secret_access_key=settings.r2_secret_key,
        region_name="auto",
    )


def is_r2_backup_ready() -> bool:
    return bool(
        settings.r2_backup_enabled
        and settings.r2_access_key
        and settings.r2_secret_key
        and settings.r2_bucket
        and settings.r2_endpoint
    )


def upload_backup(file_path: str, object_key: str, metadata: dict[str, Any]) -> dict[str, Any]:
    if not is_r2_backup_ready():
        return {"uploaded": False, "verified": False, "reason": "r2-not-configured"}
    path = Path(file_path)
    clean_metadata = {str(key): str(value) for key, value in metadata.items() if value is not None}
    try:
        _client().upload_file(
            str(path),
            settings.r2_bucket,
            object_key,
            ExtraArgs={"ContentType": "application/octet-stream", "Metadata": clean_metadata},
        )
        return {"uploaded": True, "object_key": object_key, "size": path.stat().st_size}
    except Exception as exc:
        return {"uploaded": False, "verified": False, "reason": str(exc)}


def verify_backup(object_key: str, expected_size: int, expected_checksum: str) -> dict[str, Any]:
    if not is_r2_backup_ready():
        return {"verified": False, "reason": "r2-not-configured"}
    try:
        head = _client().head_object(Bucket=settings.r2_bucket, Key=object_key)
        metadata = head.get("Metadata") or {}
        actual_checksum = metadata.get("checksum") or metadata.get("sha256")
        if int(head.get("ContentLength", -1)) != int(expected_size):
            return {"verified": False, "reason": "remote size mismatch"}
        if not actual_checksum or actual_checksum.lower() != expected_checksum.lower():
            return {"verified": False, "reason": "remote checksum metadata mismatch"}
        return {"verified": True, "object_key": object_key, "size": expected_size}
    except Exception as exc:
        return {"verified": False, "reason": str(exc)}


def list_remote_backups(prefix: str | None = None) -> list[dict[str, Any]]:
    if not is_r2_backup_ready():
        return []
    clean_prefix = (prefix or settings.r2_backup_prefix).strip("/") + "/"
    rows: list[dict[str, Any]] = []
    token = None
    try:
        while True:
            args: dict[str, Any] = {"Bucket": settings.r2_bucket, "Prefix": clean_prefix}
            if token:
                args["ContinuationToken"] = token
            page = _client().list_objects_v2(**args)
            for item in page.get("Contents") or []:
                key = str(item.get("Key") or "")
                if not key or key.endswith("/"):
                    continue
                rows.append(
                    {
                        "provider": "r2",
                        "blob_name": key,
                        "filename": os.path.basename(key),
                        "size_bytes": int(item.get("Size") or 0),
                        "created_at": item.get("LastModified").isoformat() if item.get("LastModified") else None,
                    }
                )
            if not page.get("IsTruncated"):
                break
            token = page.get("NextContinuationToken")
        rows.sort(key=lambda row: row.get("created_at") or "", reverse=True)
        return rows
    except Exception:
        return []


def download_backup(object_key: str, destination_path: str) -> dict[str, Any]:
    if not is_r2_backup_ready():
        return {"success": False, "reason": "r2-not-configured"}
    try:
        destination = Path(destination_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        _client().download_file(settings.r2_bucket, object_key, str(destination))
        return {"success": True, "destination": str(destination), "size": destination.stat().st_size}
    except Exception as exc:
        return {"success": False, "reason": str(exc)}


def prune_remote_backups(prefix: str, keep: int) -> dict[str, int]:
    rows = list_remote_backups(prefix)
    keep_count = max(1, int(keep))
    removed = 0
    for row in rows[keep_count:]:
        try:
            _client().delete_object(Bucket=settings.r2_bucket, Key=row["blob_name"])
            removed += 1
        except Exception:
            continue
    return {"kept": min(len(rows), keep_count), "removed": removed}
