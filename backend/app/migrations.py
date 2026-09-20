from pathlib import Path
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import inspect
from app.services.backup_service import create_backup, restore_backup
from app.database import Base, SessionLocal, engine
import app.models  # noqa: F401 - register the complete current schema
from app.config import settings


def _alembic_config() -> Config:
    alembic_ini = Path(__file__).resolve().parents[1] / "alembic.ini"
    alembic_cfg = Config(str(alembic_ini))
    alembic_cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
    return alembic_cfg


def get_migration_status() -> dict[str, object]:
    """Return migration state without changing the database."""
    try:
        alembic_cfg = _alembic_config()
        script = ScriptDirectory.from_config(alembic_cfg)
        heads = list(script.get_heads())
        with SessionLocal() as db:
            context = MigrationContext.configure(db.connection())
            current = list(context.get_current_heads())
        return {
            "status": "current" if current and set(current) == set(heads) else "pending",
            "current_revisions": current,
            "head_revisions": heads,
            "pending": not current or set(current) != set(heads),
        }
    except Exception as exc:
        return {
            "status": "unavailable",
            "current_revisions": [],
            "head_revisions": [],
            "pending": None,
            "message": str(exc),
        }


def migrate() -> None:
    alembic_cfg = _alembic_config()
    heads = ScriptDirectory.from_config(alembic_cfg).get_heads()
    if len(heads) != 1:
        raise RuntimeError(f"Expected one Alembic head, found {len(heads)}: {', '.join(heads)}")

    # Replaying years of historical migrations is appropriate for an existing
    # database, but a genuinely empty installation should be created directly
    # from the current, complete metadata and then stamped.  This prevents an
    # old partial baseline from becoming the schema of a brand-new shop.
    existing_tables = {
        name for name in inspect(engine).get_table_names() if name != "alembic_version"
    }
    if not existing_tables:
        Base.metadata.create_all(bind=engine)
        command.stamp(alembic_cfg, "head")
        return

    command.upgrade(alembic_cfg, "head")


def migrate_with_rollback(create_safety_backup: bool = True) -> dict[str, object]:
    backup_payload: dict[str, object] | None = None
    try:
        # An empty installation has no database to snapshot.  Attempting a
        # backup first prevented first-run Alembic initialization.
        live_db_exists = Path(settings.sqlite_file).exists()
        if create_safety_backup and live_db_exists:
            with SessionLocal() as db:
                backup_payload = create_backup(db, is_auto=False, trigger="pre-migration")
        migrate()
        return {"status": "migrated", "backup": backup_payload.get("filename") if backup_payload else None}
    except Exception as exc:
        if backup_payload and backup_payload.get("filename"):
            try:
                with SessionLocal() as db:
                    restore_backup(db, str(backup_payload["filename"]))
                return {"status": "rolled_back", "reason": str(exc)}
            except Exception as restore_exc:
                return {
                    "status": "rollback_failed",
                    "reason": str(exc),
                    "restore_error": str(restore_exc),
                    "backup": backup_payload.get("filename"),
                }
        return {"status": "failed", "reason": str(exc)}
