"""
migrate_hybrid.py
=================
In-place SQLite migration: adds Phase 1–3 Hybrid Local-First columns
to all tables that extend BaseHybridModel, without touching existing data.

Safe to run multiple times (idempotent). Creates a timestamped backup
before making any changes.

Usage:
    python migrate_hybrid.py [--db PATH]
    python migrate_hybrid.py --db database/istore.db
"""

import argparse
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

# ── Configuration ──────────────────────────────────────────────────────────

# Default db path relative to project root
DEFAULT_DB = Path(__file__).resolve().parents[1] / "database" / "istore.db"

# Tables that inherit BaseHybridModel and need hybrid columns.
# Format: table_name → list of (column_name, column_def)
HYBRID_TABLES = {
    "users":              None,  # populated below
    "products":           None,
    "categories":         None,
    "brands":             None,
    "units":              None,
    "attributes":         None,
    "attribute_values":   None,
    "suppliers":          None,
    "grn_items":          None,
    "grn_headers":        None,
    "inventory_items":    None,
    "sales":              None,
    "sale_items":         None,
    "sale_payments":      None,
    "customers":          None,
    "warranty_records":   None,
    "repairs":            None,
    "repair_tickets":     None,
    "repair_items":       None,
    "notifications":      None,
    "purchase_orders":    None,
    "expenses":           None,
    "expense_categories": None,
    "supplier_payments":  None,
}

# Columns added by BaseHybridModel mixin
BASE_HYBRID_COLUMNS = [
    ("uuid",         "TEXT"),
    ("store_id",     "TEXT"),
    ("device_id",    "TEXT"),
    ("sync_status",  "TEXT DEFAULT 'synced'"),
    ("sync_version", "INTEGER DEFAULT 1"),
    ("is_deleted",   "INTEGER DEFAULT 0"),
    ("deleted_at",   "TEXT"),
]

# Populate table → columns map
for t in HYBRID_TABLES:
    HYBRID_TABLES[t] = BASE_HYBRID_COLUMNS

# ── Helpers ────────────────────────────────────────────────────────────────

def get_existing_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    cur = conn.execute(f"PRAGMA table_info('{table}')")
    return {row[1] for row in cur.fetchall()}


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    cur = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    )
    return cur.fetchone() is not None


def add_missing_columns(conn: sqlite3.Connection, table: str, columns: list) -> list[str]:
    """Add missing columns. Returns list of columns that were added."""
    existing = get_existing_columns(conn, table)
    added = []
    for col_name, col_def in columns:
        if col_name not in existing:
            sql = f"ALTER TABLE {table} ADD COLUMN {col_name} {col_def}"
            conn.execute(sql)
            added.append(col_name)
            print(f"    + {table}.{col_name}  [{col_def}]")
    return added


def create_inventory_ledger(conn: sqlite3.Connection):
    """Create the immutable inventory_ledger table if it doesn't exist."""
    if table_exists(conn, "inventory_ledger"):
        print("  ✓  inventory_ledger — already exists")
        return
    print("  +  Creating inventory_ledger table...")
    conn.execute("""
        CREATE TABLE inventory_ledger (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid           TEXT UNIQUE NOT NULL,
            product_id     INTEGER REFERENCES products(id),
            product_uuid   TEXT,
            movement_type  TEXT NOT NULL,
            quantity_delta INTEGER NOT NULL,
            quantity_after INTEGER,
            reference_type TEXT,
            reference_id   INTEGER,
            reference_uuid TEXT,
            unit_cost      REAL,
            notes          TEXT,
            store_id       TEXT,
            device_id      TEXT,
            created_by     INTEGER REFERENCES users(id),
            created_at     TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ledger_product   ON inventory_ledger(product_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ledger_uuid      ON inventory_ledger(uuid)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ledger_created   ON inventory_ledger(created_at)")
    print("  ✓  inventory_ledger created")


def create_sync_outbox(conn: sqlite3.Connection):
    """Create the sync_outbox table if it doesn't exist."""
    if table_exists(conn, "sync_outbox"):
        print("  ✓  sync_outbox — already exists")
        return
    print("  +  Creating sync_outbox table...")
    conn.execute("""
        CREATE TABLE sync_outbox (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid         TEXT UNIQUE NOT NULL,
            entity_type  TEXT NOT NULL,
            entity_uuid  TEXT NOT NULL,
            operation    TEXT NOT NULL,
            payload      TEXT NOT NULL,
            device_id    TEXT,
            store_id     TEXT,
            status       TEXT NOT NULL DEFAULT 'pending',
            attempts     INTEGER NOT NULL DEFAULT 0,
            error_msg    TEXT,
            created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
            processed_at TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_outbox_status ON sync_outbox(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_outbox_entity ON sync_outbox(entity_type, entity_uuid)")
    print("  ✓  sync_outbox created")


def backfill_uuids(conn: sqlite3.Connection, table: str):
    """Backfill NULL uuids for existing rows using rowid as seed."""
    if not table_exists(conn, table):
        return
    cur = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE uuid IS NULL")
    count = cur.fetchone()[0]
    if count == 0:
        return
    print(f"    ↳ backfilling {count} NULL uuids in {table}...")
    # Use a deterministic UUID from the table name + rowid for reproducibility
    conn.execute(f"""
        UPDATE {table}
        SET uuid = lower(hex(randomblob(4))) || '-' ||
                   lower(hex(randomblob(2))) || '-4' ||
                   substr(lower(hex(randomblob(2))),2) || '-' ||
                   substr('89ab', abs(random()) % 4 + 1, 1) ||
                   substr(lower(hex(randomblob(2))),2) || '-' ||
                   lower(hex(randomblob(6)))
        WHERE uuid IS NULL
    """)


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="I-Store hybrid schema migration")
    parser.add_argument("--db", default=str(DEFAULT_DB), help="Path to istore.db")
    parser.add_argument("--dry-run", action="store_true", help="Show changes without applying")
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"[ERROR] Database not found: {db_path}")
        sys.exit(1)

    # Validate SQLite magic bytes
    with open(db_path, "rb") as f:
        magic = f.read(16)
    if not magic.startswith(b"SQLite format 3"):
        print(f"[ERROR] Not a valid SQLite file: {db_path}")
        sys.exit(1)

    print(f"\n  I-Store Hybrid Schema Migration")
    print(f"  Database: {db_path} ({db_path.stat().st_size // 1024} KB)")
    print()

    if args.dry_run:
        print("  [DRY RUN — no changes will be made]\n")

    # ── Backup ──────────────────────────────────────────────────────────────
    if not args.dry_run:
        ts  = datetime.now().strftime("%Y%m%d_%H%M%S")
        bak = db_path.with_suffix(f".pre-hybrid.{ts}.bak")
        shutil.copy2(db_path, bak)
        print(f"  ✓  Backup created: {bak.name}\n")

    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=OFF")

    total_added = 0

    try:
        # ── Add hybrid columns to each table ────────────────────────────────
        print("  Migrating tables...")
        for table, columns in HYBRID_TABLES.items():
            if not table_exists(conn, table):
                print(f"  ⚠  {table} — table not found (skip)")
                continue

            added = [] if args.dry_run else add_missing_columns(conn, table, columns)

            if args.dry_run:
                existing = get_existing_columns(conn, table)
                missing  = [c for c, _ in columns if c not in existing]
                if missing:
                    print(f"  ⚠  {table}: would add → {', '.join(missing)}")
                else:
                    print(f"  ✓  {table}: up to date")
            else:
                if added:
                    total_added += len(added)
                    backfill_uuids(conn, table)
                else:
                    print(f"  ✓  {table}: up to date")

        # ── Create new tables ────────────────────────────────────────────────
        print()
        print("  Ensuring new tables exist...")
        if not args.dry_run:
            create_inventory_ledger(conn)
            create_sync_outbox(conn)
        else:
            for t in ("inventory_ledger", "sync_outbox"):
                if table_exists(conn, t):
                    print(f"  ✓  {t}: exists")
                else:
                    print(f"  ⚠  {t}: would be created")

        if not args.dry_run:
            conn.commit()

        print()
        if args.dry_run:
            print("  [Dry run complete — no changes made]")
        else:
            print(f"  ✅  Migration complete! {total_added} column(s) added.")
            print(f"      Run the backend again — startup should be error-free.")

    except Exception as e:
        conn.rollback()
        print(f"\n  [ERROR] Migration failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        conn.execute("PRAGMA foreign_keys=ON")
        conn.close()

    print()


if __name__ == "__main__":
    main()
