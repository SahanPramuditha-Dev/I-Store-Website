import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy import event
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import settings

UPLOADS_DIR = Path(__file__).resolve().parents[1] / "uploads"
if os.getenv("VERCEL"):
    UPLOADS_DIR = Path("/tmp/uploads")
try:
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    pass

db_url = settings.sqlite_url
is_sqlite = db_url.startswith("sqlite")

if is_sqlite:
    engine = create_engine(db_url, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def set_sqlite_pragmas(dbapi_connection, _):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()
else:
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    engine = create_engine(db_url)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
