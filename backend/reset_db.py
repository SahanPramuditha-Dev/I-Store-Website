import sqlite3
import shutil
import os
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "database" / "istore.db"
BACKUP_DIR = BASE_DIR / "database" / "backups"

def reset_database():
    if not DB_PATH.exists():
        print(f"[ERROR] Database file not found at {DB_PATH}")
        return

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = BACKUP_DIR / f"istore_before_clean_reset_{timestamp}.db"
    
    print(f"Creating safety backup at: {backup_file}")
    shutil.copy2(DB_PATH, backup_file)
    print("✓ Safety backup completed.")

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Tables to preserve
    PRESERVED_TABLES = {
        "users",
        "roles",
        "permissions",
        "role_permissions",
        "user_permission_overrides",
        "app_settings",
        "security_settings",
        "label_templates",
        "number_sequences",
        "alembic_version",
        "sqlite_sequence",
    }

    # Fetch all table names
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    all_tables = [row[0] for row in cursor.fetchall() if not row[0].startswith("sqlite_")]

    tables_to_clear = [t for t in all_tables if t not in PRESERVED_TABLES]

    cursor.execute("PRAGMA foreign_keys = OFF;")
    
    cleared_count = 0
    for table in tables_to_clear:
        try:
            cursor.execute(f"DELETE FROM \"{table}\";")
            cleared_count += 1
            print(f"  ✓ Cleared table: {table}")
        except Exception as e:
            print(f"  ! Error clearing {table}: {e}")

    cursor.execute("PRAGMA foreign_keys = ON;")
    conn.commit()

    # Vacuum database to shrink file size
    cursor.execute("VACUUM;")
    conn.close()

    print(f"\n[SUCCESS] Successfully reset {cleared_count} operational tables!")
    print("User accounts (including Owner Bandara and Admin), roles, and settings have been preserved.")
    print("You may now log in and add fresh production data.")

if __name__ == "__main__":
    reset_database()
