"""
sync_schema.py
==============
Automated Schema Synchronizer: Compares SQLAlchemy declarative models in app.models
against the target SQLite database (database/istore.db) and automatically adds
any missing tables or missing columns without touching existing data.
"""

import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))

import sqlite3
from sqlalchemy import create_engine, inspect, text
from app.config import settings
from app.database import Base
import app.models  # Import all models to populate Base.metadata

def sync_schema(db_path: Path):
    if not db_path.exists():
        print(f"[ERROR] Database file not found at {db_path}")
        return

    db_url = f"sqlite:///{db_path.as_posix()}"
    print(f"\n[sync-schema] Inspecting database: {db_path}")
    engine = create_engine(db_url)
    
    # 1. Create any missing tables
    Base.metadata.create_all(bind=engine)
    print("  ✓ Ensured all model tables exist.")

    # 2. Inspect existing columns and add any missing columns
    inspector = inspect(engine)
    total_added = 0

    with engine.begin() as conn:
        for table_name, table in Base.metadata.tables.items():
            if not inspector.has_table(table_name):
                continue
            
            existing_cols = {col["name"]: col for col in inspector.get_columns(table_name)}
            
            for col in table.columns:
                col_name = col.name
                if col_name not in existing_cols:
                    # Determine SQLite type representation
                    col_type_str = str(col.type).upper()
                    if "VARCHAR" in col_type_str or "STRING" in col_type_str or "TEXT" in col_type_str or "UUID" in col_type_str:
                        type_repr = "TEXT"
                    elif "INTEGER" in col_type_str or "BOOLEAN" in col_type_str:
                        type_repr = "INTEGER"
                    elif "FLOAT" in col_type_str or "DECIMAL" in col_type_str or "NUMERIC" in col_type_str:
                        type_repr = "REAL"
                    elif "DATETIME" in col_type_str or "TIMESTAMP" in col_type_str or "DATE" in col_type_str:
                        type_repr = "DATETIME"
                    else:
                        type_repr = "TEXT"

                    # Handle default values if needed
                    default_suffix = ""
                    if col.default is not None and col.default.is_scalar:
                        default_val = col.default.arg
                        if isinstance(default_val, bool):
                            default_suffix = f" DEFAULT {1 if default_val else 0}"
                        elif isinstance(default_val, (int, float)):
                            default_suffix = f" DEFAULT {default_val}"
                        elif isinstance(default_val, str):
                            default_suffix = f" DEFAULT '{default_val}'"

                    alter_query = f"ALTER TABLE {table_name} ADD COLUMN {col_name} {type_repr}{default_suffix}"
                    try:
                        conn.execute(text(alter_query))
                        print(f"    + Added missing column: {table_name}.{col_name} [{type_repr}]")
                        total_added += 1
                    except Exception as e:
                        print(f"    ✗ Failed to add {table_name}.{col_name}: {e}")

    print(f"\n[sync-schema] ✅ Complete! {total_added} missing column(s) added to {db_path.name}.\n")

if __name__ == "__main__":
    target_db = Path(__file__).resolve().parents[1] / "database" / "istore.db"
    sync_schema(target_db)
