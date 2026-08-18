import gzip
import sqlite3
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.services.backup_service as backup_service
from app.services.backup_service import (
    acquire_backup_lock,
    check_and_run_catchup_backup,
    create_backup,
    perform_database_maintenance,
    restore_backup,
    test_restore_backup as run_test_restore,
)


def _init_mock_istore_db(db_path: Path):
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, role TEXT);")
    conn.execute("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);")
    conn.execute("CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL);")
    conn.execute("INSERT INTO users (username, role) VALUES ('admin', 'Owner');")
    conn.execute("INSERT INTO app_settings (key, value) VALUES ('company_name', 'I-Store');")
    conn.execute("INSERT INTO products (name, price) VALUES ('iPhone 15', 999.0);")
    conn.commit()
    conn.close()


def test_online_backup_and_test_restore_pipeline(tmp_path, monkeypatch):
    db_path = tmp_path / "live_istore.sqlite"
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()

    _init_mock_istore_db(db_path)

    monkeypatch.setattr(backup_service.settings, "sqlite_file", str(db_path))
    monkeypatch.setattr(backup_service.settings, "backup_folder", str(backup_dir))
    monkeypatch.setattr(backup_service.settings, "backup_encrypt", False)
    monkeypatch.setattr(backup_service.settings, "backup_encryption_passphrase", "")
    monkeypatch.setattr(backup_service.settings, "firebase_backup_enabled", False)

    class MockDB:
        def query(self, *args):
            class Query:
                def filter(self, *args):
                    return self
                def first(self):
                    return None
            return Query()
        def add(self, item):
            pass
        def commit(self):
            pass

    mock_session = MockDB()

    # Step 1: Create verified backup
    result = create_backup(mock_session, is_auto=False, trigger="manual")
    assert result["status"] == "success"
    assert result["verified"] is True
    assert result["restorable"] is True
    assert Path(result["backup"]).exists()
    assert Path(result["backup"]).with_suffix(Path(result["backup"]).suffix + ".sha256").exists()

    # Step 2: Test Sandbox Restore on created artifact
    test_res = run_test_restore(Path(result["backup"]))
    assert test_res["restorable"] is True
    assert test_res["integrity"] == "ok"
    assert test_res["schema"]["tables_count"] >= 3

    # Step 3: Production restore validation
    restore_res = restore_backup(mock_session, Path(result["backup"]).name)
    assert restore_res["status"] == "success"
    assert "pre_restore_snapshot" in restore_res


def test_backup_locking_prevents_concurrency():
    with acquire_backup_lock():
        assert backup_service.is_backup_in_progress() is True
        with pytest.raises(RuntimeError) as exc_info:
            with acquire_backup_lock(timeout_seconds=0.1):
                pass
        assert "already in progress" in str(exc_info.value)

    assert backup_service.is_backup_in_progress() is False


def test_retention_protects_latest_verified_backup(tmp_path, monkeypatch):
    backup_dir = tmp_path / "retention_backups"
    backup_dir.mkdir()
    monkeypatch.setattr(backup_service.settings, "backup_folder", str(backup_dir))

    # Create 10 fake old backup files
    for i in range(10):
        f = backup_dir / f"auto_2026_01_{i+1:02d}_000000.sqlite.gz"
        f.write_bytes(b"dummy")
        f.with_suffix(f.suffix + ".sha256").write_text("fake_sha", encoding="utf-8")

    res = backup_service._prune_local_backups_tiered()
    assert res["kept"] >= 1
    # Check that at least the newest backup exists
    remaining = list(backup_dir.glob("*.sqlite.gz"))
    assert len(remaining) >= 1
