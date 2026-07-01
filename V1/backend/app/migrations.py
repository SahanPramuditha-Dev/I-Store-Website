from pathlib import Path
from alembic import command
from alembic.config import Config
from app.config import settings


def migrate() -> None:
    alembic_ini = Path(__file__).resolve().parents[1] / "alembic.ini"
    alembic_cfg = Config(str(alembic_ini))
    
    # Ensure the script location is correctly set
    alembic_cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
    
    command.upgrade(alembic_cfg, "head")
