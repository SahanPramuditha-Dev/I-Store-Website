import gzip
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.services.backup_service as backup_service


@pytest.mark.parametrize("encrypted", [False])
def test_create_backup_captures_wal_data(tmp_path, monkeypatch, encrypted):
    db_path = tmp_path / "test.sqlite"
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT)")
    conn.execute("INSERT INTO items (name) VALUES ('wal-row')")
    conn.commit()
    conn.close()

    monkeypatch.setattr(backup_service.settings, "sqlite_file", str(db_path))
    monkeypatch.setattr(backup_service.settings, "backup_folder", str(backup_dir))
    monkeypatch.setattr(backup_service.settings, "backup_encrypt", False)
    monkeypatch.setattr(backup_service.settings, "backup_encryption_passphrase", "")
    monkeypatch.setattr(backup_service.settings, "backup_keep_local", 3)
    monkeypatch.setattr(backup_service, "_upsert_setting", lambda *args, **kwargs: None)
    monkeypatch.setattr(backup_service, "_append_backup_metadata", lambda *args, **kwargs: None)
    monkeypatch.setattr(backup_service, "_prune_local_backups", lambda: None)
    monkeypatch.setattr(backup_service, "_prune_remote_backups_by_registry", lambda *args, **kwargs: None)

    fake_db = object()
    result = backup_service.create_backup(fake_db, is_auto=False, trigger="test")

    backup_path = Path(result["backup"])
    assert backup_path.exists()

    with gzip.open(backup_path, "rb") as fh:
        restored_bytes = fh.read()

    restored_db = tmp_path / "restored.sqlite"
    restored_db.write_bytes(restored_bytes)

    restored_conn = sqlite3.connect(restored_db)
    try:
        rows = restored_conn.execute("SELECT name FROM items WHERE name = 'wal-row'").fetchall()
    finally:
        restored_conn.close()

    assert rows == [("wal-row",)]
