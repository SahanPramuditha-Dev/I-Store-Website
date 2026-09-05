"""Small, idempotent SQLite schema synchronizer for desktop upgrades.

SQLAlchemy's ``create_all`` creates new tables but intentionally does not add
new columns to existing tables. Desktop installations can span many releases,
so add columns represented by the current ORM metadata before startup services
query them. Existing rows and tables are never removed or rewritten.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from sqlalchemy.dialects import sqlite

from app.database import Base
import app.models  # noqa: F401 - registers every ORM table with Base.metadata


def _quoted(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def sync_schema(database_path: str | Path) -> list[str]:
    path = Path(database_path)
    if not path.exists():
        return []

    added: list[str] = []
    with sqlite3.connect(str(path)) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        for table in Base.metadata.sorted_tables:
            if table.name not in tables:
                continue
            existing = {
                row[1]
                for row in connection.execute(
                    f"PRAGMA table_info({_quoted(table.name)})"
                )
            }
            for column in table.columns:
                if column.name in existing:
                    continue
                column_type = column.type.compile(dialect=sqlite.dialect()) or "TEXT"
                default_clause = ""
                if column.server_default is not None:
                    default_value = str(column.server_default.arg)
                    default_clause = f" DEFAULT {default_value}"
                connection.execute(
                    f"ALTER TABLE {_quoted(table.name)} "
                    f"ADD COLUMN {_quoted(column.name)} {column_type}{default_clause}"
                )
                added.append(f"{table.name}.{column.name}")
        connection.commit()
    return added
