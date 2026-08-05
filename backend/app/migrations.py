from pathlib import Path
from alembic import command
from alembic.config import Config
from app.config import settings
from app.services.backup_service import create_backup, restore_backup
from app.database import SessionLocal


def migrate() -> None:
    alembic_ini = Path(__file__).resolve().parents[1] / "alembic.ini"
    alembic_cfg = Config(str(alembic_ini))

    # Ensure the script location is correctly set
    alembic_cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))

    command.upgrade(alembic_cfg, "head")


def migrate_with_rollback() -> dict[str, object]:
    backup_payload: dict[str, object] | None = None
    try:
        with SessionLocal() as db:
            backup_payload = create_backup(db, is_auto=False, trigger="pre-migration")
        migrate()
        return {"status": "migrated"}
    except Exception as exc:
        if backup_payload and backup_payload.get("filename"):
            with SessionLocal() as db:
                restore_backup(db, str(backup_payload["filename"]))
            return {"status": "rolled_back", "reason": str(exc)}
        return {"status": "failed", "reason": str(exc)}
