import io
import os
import uuid
import logging
import mimetypes
from pathlib import Path
from dataclasses import dataclass
from typing import Optional, Tuple, Union

from fastapi import UploadFile
from starlette.datastructures import UploadFile as StarletteUploadFile

from app.config import settings
from app.database import UPLOADS_DIR

logger = logging.getLogger("istore.storage")

ALLOWED_IMAGE_EXT = {"png", "jpg", "jpeg", "webp", "gif", "bmp"}
ALLOWED_DOC_EXT = {"pdf", "txt", "csv", "doc", "docx", "xls", "xlsx"}
ALLOWED_EXT = ALLOWED_IMAGE_EXT | ALLOWED_DOC_EXT
DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB

IMAGE_MAX_WIDTH = 1600
IMAGE_QUALITY_WEBP = 82
IMAGE_QUALITY_JPEG = 82

STORAGE_PREFIX_PRODUCTS = "products"
STORAGE_PREFIX_INVOICES = "invoices"
STORAGE_PREFIX_REPORTS = "reports"
STORAGE_PREFIX_BACKUPS = "backups"
STORAGE_PREFIX_ATTACHMENTS = "attachments"

try:
    from PIL import Image
    PIL_AVAILABLE = True
except Exception:
    PIL_AVAILABLE = False


@dataclass
class StoredFile:
    url: str
    storage_key: str
    size_bytes: int
    content_type: str
    storage_backend: str  # "local" | "r2"
    original_filename: str


def validate_file(
    file: Union[UploadFile, StarletteUploadFile],
    max_size_bytes: int = DEFAULT_MAX_SIZE_BYTES,
    allowed_ext: Optional[set] = None,
) -> Tuple[bool, str]:
    allowed = allowed_ext or ALLOWED_EXT
    filename = (file.filename or "").strip()
    if not filename:
        return False, "File has no name"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in allowed:
        return False, f"Unsupported file type: .{ext}. Allowed: {sorted(allowed)}"
    size = getattr(file, "size", None)
    if size is not None and size > max_size_bytes:
        return False, f"File too large: {size} bytes > {max_size_bytes} bytes"
    return True, ext


def _optimize_image(
    raw_bytes: bytes, filename: str, target_ext: str, max_width: int = IMAGE_MAX_WIDTH
) -> Tuple[bytes, str, str]:
    final_ext = target_ext.lower()
    if not PIL_AVAILABLE:
        ctype = mimetypes.types_map.get(f".{final_ext}", "application/octet-stream")
        return raw_bytes, final_ext, ctype
    try:
        src = Image.open(io.BytesIO(raw_bytes))
        src.load()
        is_animated = getattr(src, "is_animated", False)
        if is_animated:
            ctype = mimetypes.types_map.get(f".{final_ext}", "application/octet-stream")
            return raw_bytes, final_ext, ctype
        out_ext = final_ext
        if final_ext in {"jpg", "jpeg", "png"}:
            out_ext = "webp"
        src_format = src.format or out_ext.upper()
        if out_ext in {"jpg", "jpeg"}:
            save_kwargs = {"format": "JPEG", "quality": IMAGE_QUALITY_JPEG, "optimize": True, "progressive": True}
        elif out_ext == "webp":
            save_kwargs = {"format": "WEBP", "quality": IMAGE_QUALITY_WEBP, "method": 6}
        else:
            save_kwargs = {"format": src_format, "optimize": True}
        width, height = src.size
        if width > max_width:
            ratio = max_width / float(width)
            new_height = max(1, int(float(height) * ratio))
            src = src.resize((max_width, new_height), Image.LANCZOS)
        if out_ext in {"jpg", "jpeg"} and src.mode not in ("RGB", "L"):
            src = src.convert("RGB")
        if out_ext == "webp" and src.mode not in ("RGB", "RGBA"):
            src = src.convert("RGB")
        out_buf = io.BytesIO()
        src.save(out_buf, **save_kwargs)
        out_bytes = out_buf.getvalue()
        if len(out_bytes) > 0 and len(out_bytes) < len(raw_bytes):
            ctype = mimetypes.types_map.get(f".{out_ext}", "application/octet-stream")
            return out_bytes, out_ext, ctype
    except Exception as exc:
        logger.debug("Image optimization skipped (%s): %s", filename, exc)
    ctype = mimetypes.types_map.get(f".{final_ext}", "application/octet-stream")
    return raw_bytes, final_ext, ctype


class StorageService:
    """Unified Storage Service supporting R2 / S3 Cloud Object Storage & Local Filesystem Fallback"""
    
    def __init__(self) -> None:
        self.r2_enabled = bool(
            settings.r2_access_key
            and settings.r2_secret_key
            and settings.r2_bucket
            and settings.r2_endpoint
        )
        self.local_base_dir = Path(UPLOADS_DIR)
        self.local_base_dir.mkdir(parents=True, exist_ok=True)
        self._boto3_client = None

    def _get_r2_client(self):
        if not self.r2_enabled:
            return None
        if self._boto3_client is None:
            import boto3
            self._boto3_client = boto3.client(
                "s3",
                endpoint_url=settings.r2_endpoint.rstrip("/"),
                aws_access_key_id=settings.r2_access_key,
                aws_secret_access_key=settings.r2_secret_key,
                region_name="auto",
            )
        return self._boto3_client

    async def upload(
        self,
        file: Union[UploadFile, StarletteUploadFile, bytes],
        filename: Optional[str] = None,
        prefix: str = STORAGE_PREFIX_PRODUCTS,
        content_type: Optional[str] = None,
        optimize: bool = True,
    ) -> StoredFile:
        raw_bytes: bytes
        orig_name: str
        if isinstance(file, (UploadFile, StarletteUploadFile)):
            orig_name = filename or Path(file.filename or "file").name
            raw_bytes = await file.read()
            c_type = file.content_type
        else:
            orig_name = filename or "file.bin"
            raw_bytes = file
            c_type = content_type

        ext = orig_name.rsplit(".", 1)[-1].lower() if "." in orig_name else "bin"
        c_type = c_type or mimetypes.types_map.get(f".{ext}", "application/octet-stream")

        final_bytes = raw_bytes
        final_ext = ext
        if optimize and ext in ALLOWED_IMAGE_EXT:
            final_bytes, final_ext, c_type = _optimize_image(raw_bytes, orig_name, ext)

        key = f"{prefix}/{uuid.uuid4().hex}.{final_ext}"

        if self.r2_enabled:
            client = self._get_r2_client()
            extra = {"ContentType": c_type, "CacheControl": "public, max-age=31536000, immutable"}
            client.put_object(Bucket=settings.r2_bucket, Key=key, Body=final_bytes, **extra)
            url = self.get_url(key)
            backend = "r2"
        else:
            dest = self.local_base_dir / key
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(final_bytes)
            url = f"/uploads/{key}"
            backend = "local"

        return StoredFile(
            url=url,
            storage_key=key,
            size_bytes=len(final_bytes),
            content_type=c_type,
            storage_backend=backend,
            original_filename=orig_name,
        )

    def delete(self, storage_key: str) -> bool:
        clean_key = storage_key.lstrip("/\\").replace("uploads/", "", 1)
        if self.r2_enabled:
            try:
                client = self._get_r2_client()
                client.delete_object(Bucket=settings.r2_bucket, Key=clean_key)
                return True
            except Exception as exc:
                logger.warning("R2 delete failed for %s: %s", storage_key, exc)
                return False
        else:
            try:
                dest = self.local_base_dir / clean_key
                if dest.exists():
                    dest.unlink()
                    return True
            except Exception as exc:
                logger.warning("Local delete failed for %s: %s", storage_key, exc)
            return False

    def get_url(self, storage_key: str) -> str:
        clean_key = storage_key.lstrip("/\\").replace("uploads/", "", 1)
        if self.r2_enabled:
            if settings.r2_public_base_url:
                return f"{settings.r2_public_base_url.rstrip('/')}/{clean_key}"
            return f"{settings.r2_endpoint.rstrip('/')}/{settings.r2_bucket}/{clean_key}"
        return f"/uploads/{clean_key}"

    async def backup(self, backup_file_bytes: bytes, filename: str) -> StoredFile:
        return await self.upload(
            file=backup_file_bytes,
            filename=filename,
            prefix=STORAGE_PREFIX_BACKUPS,
            content_type="application/octet-stream",
            optimize=False,
        )

storage_service = StorageService()
