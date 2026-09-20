"""Regression coverage for the supported empty-database installation path."""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path


def test_clean_database_upgrades_to_single_head(tmp_path):
    backend_dir = Path(__file__).resolve().parents[1]
    db_path = tmp_path / "fresh.sqlite"
    env = os.environ.copy()
    env["SQLITE_FILE"] = str(db_path)

    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
        cwd=backend_dir,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        assert connection.execute("SELECT version_num FROM alembic_version").fetchall() == [
            ("20260914_0021",)
        ]


def test_application_first_run_creates_complete_current_schema(tmp_path):
    backend_dir = Path(__file__).resolve().parents[1]
    db_path = tmp_path / "first-run.sqlite"
    env = os.environ.copy()
    env["SQLITE_FILE"] = str(db_path)
    env["DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"

    code = """
from app.migrations import migrate
migrate()
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=backend_dir,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr

    code = """
import json
import sqlite3
from app.database import Base
import app.models

connection = sqlite3.connect(r'%s')
actual = {
    row[0]: {
        col[1] for col in connection.execute('PRAGMA table_info("' + row[0] + '")')
    }
    for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%%'"
    )
}
expected = {table.name: {column.name for column in table.columns} for table in Base.metadata.tables.values()}
print(json.dumps({
    'missing_tables': sorted(set(expected) - set(actual)),
    'missing_columns': {
        table: sorted(columns - actual[table])
        for table, columns in expected.items()
        if table in actual and columns - actual[table]
    },
}))
""" % str(db_path).replace("\\", "\\\\")
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=backend_dir,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    comparison = __import__("json").loads(result.stdout.strip().splitlines()[-1])
    assert comparison == {"missing_tables": [], "missing_columns": {}}
