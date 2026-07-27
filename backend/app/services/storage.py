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

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
ALLOWED_IMAGE_EXT = {"png", "jpg", "jpeg", "webp", "gif", "bmp"}
ALLOWED_DOC_EXT = {"pdf", "txt", "csv", "doc", "docx", "xls", "xlsx"}
ALLOWED_EXT = ALLOWED_IMAGE_EXT | ALLOWED_DOC_EXT
DEFAULT_MAX_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB

IMAGE_MAX_WIDTH = 1600  # px — auto-downscale if Pillow available
IMAGE_QUALITY_WEBP = 82
IMAGE_QUALITY_JPEG = 82

STORAGE_PREFIX_PRODUCTS = "products"
STORAGE_PREFIX_INVOICES = "invoices"
STORAGE_PREFIX_REPORTS = "reports"
STORAGE_PREFIX_BACKUPS = "backups"
STORAGE_PREFIX_USERS = "users"

# ---------------------------------------------------------------------------
# Optional: Pillow for image optimization
# ---------------------------------------------------------------------------
try:
    from PIL import Image  # type: ignore

    PIL_AVAILABLE = True
except Exception:  # pragma: no cover - optional dep
    PIL_AVAILABLE = False


# ---------------------------------------------------------------------------
# Dataclass for upload results
# ---------------------------------------------------------------------------
@dataclass
class StoredFile:
    url: str
    storage_key: str
    size_bytes: int
    content_type: str
    storage_backend: str  # "local" | "r2"
    original_filename: str


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Image optimization helper (best-effort, no-op if Pillow missing)
# ---------------------------------------------------------------------------
def _optimize_image(
    raw_bytes: bytes, filename: str, target_ext: str, max_width: int = IMAGE_MAX_WIDTH
) -> Tuple[bytes, str, str]:
    """
    Best-effort image optimization. Returns (bytes_out, final_ext, final_content_type).
    If Pillow is missing or the image can't be decoded, returns input unchanged.
    Non-animated JPG/PNG → WebP to save ~30-50% bytes.
    Animated GIFs → passed through untouched to preserve animation.
    """
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
        if out_ext == "jpg":
            out_ext = "jpg"
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


# ---------------------------------------------------------------------------
# Local Storage Backend (default — for dev + fallback)
# ---------------------------------------------------------------------------
class LocalStorageService:
    backend_name = "local"

    def __init__(self, base_dir: Path, mount_path: str = "/uploads") -> None:
        self.base_dir = Path(base_dir)
        self.mount_path = mount_path.rstrip("/")
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _target_dir(self, prefix: str) -> Path:
        target = self.base_dir / prefix
        target.mkdir(parents=True, exist_ok=True)
        return target

    async def upload_file(
        self,
        file: Union[UploadFile, StarletteUploadFile],
        prefix: str = STORAGE_PREFIX_PRODUCTS,
        optimize_images: bool = True,
        max_size_bytes: int = DEFAULT_MAX_SIZE_BYTES,
    ) -> StoredFile:
        ok, info = validate_file(file, max_size_bytes=max_size_bytes)
        if not ok:
            raise ValueError(info)
        ext = info
        raw = await file.read()
        filename = Path(file.filename or "file").name
        final_bytes = raw
        final_ext = ext
        ctype = file.content_type or mimetypes.types_map.get(f".{ext}", "application/octet-stream")
        if optimize_images and ext in ALLOWED_IMAGE_EXT:
            final_bytes, final_ext, ctype = _optimize_image(raw, filename, ext)
        key = f"{prefix}/{uuid.uuid4().hex}.{final_ext}"
        dest = self.base_dir / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(final_bytes)
        return StoredFile(
            url=f"{self.mount_path}/{key}",
            storage_key=key,
            size_bytes=len(final_bytes),
            content_type=ctype,
            storage_backend=self.backend_name,
            original_filename=filename,
        )

    def delete_file(self, storage_key: str) -> bool:
        try:
            dest = self.base_dir / storage_key.lstrip("/\\")
            if dest.exists():
                dest.unlink()
                return True
        except Exception as exc:
            logger.warning("Local delete failed for %s: %s", storage_key, exc)
        return False

    def generate_url(self, storage_key: str) -> str:
        return f"{self.mount_path}/{storage_key.lstrip('/')}"


# ---------------------------------------------------------------------------
# Cloudflare R2 Storage Backend (S3-compatible via boto3)
# ---------------------------------------------------------------------------
class R2StorageService:
    backend_name = "r2"

    def __init__(
        self,
        access_key: str,
        secret_key: str,
        bucket: str,
        endpoint: str,
        public_base_url: Optional[str] = None,
    ) -> None:
        self.access_key = access_key
        self.secret_key = secret_key
        self.bucket = bucket
        self.endpoint = endpoint.rstrip("/")
        self.public_base_url = public_base_url.rstrip("/") if public_base_url else None
        self._client = None
        self._boto3_ok = False
        try:
            import boto3  # type: ignore

            self._boto3 = boto3
            self._boto3_ok = True
        except Exception as exc:  # pragma: no cover
            logger.warning("boto3 not importable, R2 unavailable: %s", exc)
            self._boto3 = None

    def _client(self):
        if not self._boto3_ok:
            raise RuntimeError("boto3 is not installed — pip install boto3 to use R2")
        if self._client is None:
            self._client = self._boto3.client(
                "s3",
                endpoint_url=self.endpoint,
                aws_access_key_id=self.access_key,
                aws_secret_access_key=self.secret_key,
                region_name="auto",
            )
        return self._client

    async def upload_file(
        self,
        file: Union[UploadFile, StarletteUploadFile],
        prefix: str = STORAGE_PREFIX_PRODUCTS,
        optimize_images: bool = True,
        max_size_bytes: int = DEFAULT_MAX_SIZE_BYTES,
    ) -> StoredFile:
        ok, info = validate_file(file, max_size_bytes=max_size_bytes)
        if not ok:
            raise ValueError(info)
        ext = info
        raw = await file.read()
        filename = Path(file.filename or "file").name
        final_bytes = raw
        final_ext = ext
        ctype = file.content_type or mimetypes.types_map.get(f".{ext}", "application/octet-stream")
        if optimize_images and ext in ALLOWED_IMAGE_EXT:
            final_bytes, final_ext, ctype = _optimize_image(raw, filename, ext)
        key = f"{prefix}/{uuid.uuid4().hex}.{final_ext}"
        client = self._client()
        extra = {"ContentType": ctype, "CacheControl": "public, max-age=31536000, immutable"}
        if final_ext in ALLOWED_IMAGE_EXT or final_ext in {"pdf"}:
            extra["CacheControl"] = "public, max-age=31536000, immutable"
        client.put_object(Bucket=self.bucket, Key=key, Body=final_bytes, **extra)
        url = self.generate_url(key)
        return StoredFile(
            url=url,
            storage_key=key,
            size_bytes=len(final_bytes),
            content_type=ctype,
            storage_backend=self.backend_name,
            original_filename=filename,
        )

    def delete_file(self, storage_key: str) -> bool:
        try:
            client = self._client()
            client.delete_object(Bucket=self.bucket, Key=storage_key.lstrip("/\\") or storage_key)
            return True
        except Exception as exc:
            logger.warning("R2 delete failed for %s: %s", storage_key, exc)
            return False

    def generate_url(self, storage_key: str) -> str:
        key = storage_key.lstrip("/")
        if self.public_base_url:
            return f"{self.public_base_url}/{key}"
        return f"{self.endpoint}/{self.bucket}/{key}"


# ---------------------------------------------------------------------------
# Factory — choose backend from environment
# ---------------------------------------------------------------------------
_local_service: Optional[LocalStorageService] = None
_r2_service: Optional[R2StorageService] = None


def is_r2_configured() -> bool:
    return bool(
        settings.r2_access_key
        and settings.r2_secret_key
        and settings.r2_bucket
        and settings.r2_endpoint
    )


def get_storage_service() -> Union[R2StorageService, LocalStorageService]:
    """
    Return R2 storage service if env vars are set AND boto3 loads,
    otherwise return the existing local storage backend for 100%
    backward compatibility + local-dev zero-config experience.
    """
    global _local_service, _r2_service
    if is_r2_configured():
        if _r2_service is None:
            _r2_service = R2StorageService(
                access_key=settings.r2_access_key,
                secret_key=settings.r2_secret_key,
                bucket=settings.r2_bucket,
                endpoint=settings.r2_endpoint,
                public_base_url=settings.r2_public_base_url,
            )
        return _r2_service
    if _local_service is None:
        _local_service = LocalStorageService(base_dir=UPLOADS_DIR, mount_path="/uploads")
    return _local_service
