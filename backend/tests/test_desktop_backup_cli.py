"""Desktop backup must include WAL commits without importing the web app."""
import sqlite3
import subprocess
import sys
from contextlib import closing
from pathlib import Path


def test_desktop_backup_includes_live_wal(tmp_path):
    source = tmp_path / "source.db"
    destination = tmp_path / "backup.db"
    with closing(sqlite3.connect(source)) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA wal_autocheckpoint=0")
        db.execute("CREATE TABLE proof(value TEXT)")
        db.execute("INSERT INTO proof VALUES ('committed WAL data')")
        db.commit()
        assert Path(str(source) + "-wal").exists()
        subprocess.run([sys.executable, str(Path(__file__).parents[1] / "desktop_server.py"), "--backup-sqlite", str(source), str(destination)], check=True, timeout=20)
        with closing(sqlite3.connect(destination)) as backup:
            assert backup.execute("SELECT value FROM proof").fetchone()[0] == "committed WAL data"
            assert backup.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
