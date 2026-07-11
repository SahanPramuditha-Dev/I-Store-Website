import logging
import os
import sys
from pydantic import BaseModel
from pathlib import Path

logger = logging.getLogger("istore.config")

_ON_VERCEL: bool = bool(os.getenv("VERCEL"))


def _env_bool(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}

def get_user_data_dir():
    if _ON_VERCEL:
        path = Path("/tmp/iStore")
    elif sys.platform == "win32":
        root = Path(os.environ.get("APPDATA", "~")).expanduser()
        path = root / "iStore"
    elif sys.platform == "darwin":
        root = Path("~/Library/Application Support").expanduser()
        path = root / "iStore"
    else:
        root = Path("~/.config").expanduser()
        path = root / "iStore"
    
    try:
        path.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return path

DATA_DIR = get_user_data_dir()
DB_FILE = DATA_DIR / "istore.db"
BACKUP_DIR = DATA_DIR / "backups"
LOG_DIR = DATA_DIR / "logs"

# Ensure folders exist
try:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    pass

class Settings(BaseModel):
    app_name: str = os.getenv("APP_NAME", "i Store API")
    env: str = os.getenv("APP_ENV", "development")
    secret_key: str = os.getenv("SECRET_KEY", "change-this-secret")
    algorithm: str = os.getenv("ALGORITHM", "HS256")
    access_token_expire_minutes: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", str(60 * 8)))
    sqlite_file: str = os.getenv("SQLITE_FILE", str(DB_FILE))
    sqlite_url: str = os.getenv("SQLITE_URL", f"sqlite:///{DB_FILE.as_posix()}")
    backup_folder: str = os.getenv("BACKUP_FOLDER", str(BACKUP_DIR))
    cors_origins: list[str] = [
        o.strip()
        for o in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173",
        ).split(",")
        if o.strip()
    ]
    backup_keep_auto: int = int(os.getenv("BACKUP_KEEP_AUTO", "10"))
    backup_keep_local: int = int(os.getenv("BACKUP_KEEP_LOCAL", os.getenv("BACKUP_KEEP_AUTO", "10")))
    backup_meta_history_keep: int = int(os.getenv("BACKUP_META_HISTORY_KEEP", "200"))
    backup_encrypt: bool = _env_bool("BACKUP_ENCRYPT", "true" if os.getenv("APP_ENV", "development").lower() == "production" else "false")
    backup_encryption_passphrase: str = os.getenv("BACKUP_ENCRYPTION_PASSPHRASE", "")
    allow_direct_restore: bool = _env_bool("ALLOW_DIRECT_RESTORE", "false")
    firebase_backup_enabled: bool = os.getenv("FIREBASE_BACKUP_ENABLED", "false").lower() == "true"
    firebase_store_metadata: bool = os.getenv("FIREBASE_STORE_METADATA", "true").lower() == "true"
    firebase_metadata_collection: str = os.getenv("FIREBASE_METADATA_COLLECTION", "backup_metadata")
    firebase_prune_remote_keep: int = int(os.getenv("FIREBASE_PRUNE_REMOTE_KEEP", "30"))
    firebase_service_account: str = os.getenv("FIREBASE_SERVICE_ACCOUNT", "")
    firebase_bucket: str = os.getenv("FIREBASE_BUCKET", "")
    app_version: str = os.getenv("APP_VERSION", "v2.4.1")
    db_schema_version: str = os.getenv("DB_SCHEMA_VERSION", "local")
    device_name: str = os.getenv("DEVICE_NAME", os.getenv("COMPUTERNAME", os.getenv("HOSTNAME", "local-device")))
    # On Vercel, always auto-create tables at startup because the /tmp SQLite
    # database is ephemeral and starts empty on every new container.
    auto_migrate_enabled: bool = os.getenv("AUTO_MIGRATE_ENABLED", "true" if _ON_VERCEL else "false").lower() == "true"
    # Never run a pre-migration backup on Vercel — the /tmp database is
    # ephemeral so a backup would always fail or be meaningless.
    backup_before_migrate: bool = os.getenv("BACKUP_BEFORE_MIGRATE", "false" if _ON_VERCEL else "true").lower() == "true"
    allow_runtime_schema_sync: bool = _env_bool("ALLOW_RUNTIME_SCHEMA_SYNC", "true" if _ON_VERCEL else ("false" if os.getenv("APP_ENV", "development").lower() == "production" else "true"))
    # Disable the cron-style scheduler on Vercel (stateless, no persistent process).
    backup_schedule_enabled: bool = os.getenv("BACKUP_SCHEDULE_ENABLED", "false" if _ON_VERCEL else "true").lower() == "true"
    backup_schedule_hour: int = int(os.getenv("BACKUP_SCHEDULE_HOUR", "23"))
    backup_schedule_minute: int = int(os.getenv("BACKUP_SCHEDULE_MINUTE", "59"))
    backup_schedule_timezone: str = os.getenv("BACKUP_SCHEDULE_TIMEZONE", "UTC")
    allow_test_admin_bootstrap: bool = os.getenv("ALLOW_TEST_ADMIN_BOOTSTRAP", "false").lower() == "true"
    seed_demo_data: bool = os.getenv("SEED_DEMO_DATA", "false").lower() == "true"
    test_owner_bootstrap_password: str = os.getenv("TEST_OWNER_BOOTSTRAP_PASSWORD", "")
    test_admin_bootstrap_password: str = os.getenv("TEST_ADMIN_BOOTSTRAP_PASSWORD", "")

    @property
    def is_production(self) -> bool:
        return self.env.lower() == "production"

    def model_post_init(self, __context):
        if not self.is_production:
            return

        # On Vercel the env-vars are set in the dashboard. A missing/weak var
        # should log a warning rather than crashing the process so the app
        # still starts up and returns useful API errors instead of a cold 500.
        _raise = not _ON_VERCEL

        if self.secret_key.strip() in {"", "change-this-secret"} or len(self.secret_key.strip()) < 32:
            msg = "Production SECRET_KEY must be set to a strong non-default value."
            if _raise:
                raise RuntimeError(msg)
            logger.warning(f"[config] {msg}")

        if any(origin.lower() == "null" for origin in self.cors_origins):
            # Always hard-fail for null CORS — this is a CORS bypass risk.
            raise RuntimeError("Production CORS_ORIGINS must not include null.")

        if not self.backup_encrypt:
            msg = "Production backups must be encrypted. Set BACKUP_ENCRYPT=true."
            if _raise:
                raise RuntimeError(msg)
            logger.warning(f"[config] {msg}")

        if not self.backup_encryption_passphrase.strip():
            msg = "Production BACKUP_ENCRYPTION_PASSPHRASE is required."
            if _raise:
                raise RuntimeError(msg)
            logger.warning(f"[config] {msg}")

        if self.allow_direct_restore:
            raise RuntimeError("Production ALLOW_DIRECT_RESTORE must remain disabled. Use approved restore requests.")

settings = Settings()
