import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.migrations as migrations


def test_migrate_with_rollback_restores_backup_on_failure(monkeypatch):
    backup_payload = {"filename": "rollback.sqlite.gz"}
    restore_calls = []

    class DummySession:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    def fake_backup(db, is_auto=False, trigger="manual"):
        return backup_payload

    def fake_restore(db, filename):
        restore_calls.append(filename)
        return {"status": "success", "restored": filename}

    def fake_migrate():
        raise RuntimeError("migration failed")

    monkeypatch.setattr(migrations, "create_backup", fake_backup)
    monkeypatch.setattr(migrations, "restore_backup", fake_restore)
    monkeypatch.setattr(migrations, "migrate", fake_migrate)
    monkeypatch.setattr(migrations, "SessionLocal", lambda: DummySession())

    result = migrations.migrate_with_rollback()

    assert result["status"] == "rolled_back"
    assert restore_calls == [backup_payload["filename"]]
