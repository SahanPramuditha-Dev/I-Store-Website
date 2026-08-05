import gzip
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.services.backup_service as backup_service


def _write_sqlite_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT)")
    conn.execute("INSERT INTO items (name) VALUES ('ok')")
    conn.commit()
    conn.close()


def _compress_to_gz(src: Path, dst: Path) -> None:
    with gzip.open(dst, "wb") as fout, src.open("rb") as fin:
        fout.write(fin.read())


def test_recover_database_from_latest_valid_backup(tmp_path, monkeypatch):
    live_db = tmp_path / "istore.db"
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()

    # Create a valid SQLite backup archive
    valid_db = tmp_path / "valid.sqlite"
    _write_sqlite_db(valid_db)
    gz_backup = backup_dir / "manual_2026_08_02_195010.sqlite.gz"
    _compress_to_gz(valid_db, gz_backup)
    gz_backup.with_suffix(gz_backup.suffix + ".sha256").write_text(backup_service._sha256(gz_backup), encoding="utf-8")

    # Create a corrupted live DB file
    live_db.write_bytes(b"not a sqlite file")

    monkeypatch.setattr(backup_service.settings, "sqlite_file", str(live_db))
    monkeypatch.setattr(backup_service.settings, "backup_folder", str(backup_dir))

    result = backup_service.recover_database_from_latest_valid_backup()

    assert result is not None
    assert result["status"] == "recovered"
    assert result["restored"] == gz_backup.name
    assert live_db.exists()
    assert backup_service._is_valid_sqlite_database(live_db)
