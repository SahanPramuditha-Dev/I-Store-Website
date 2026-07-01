# Database

I Store uses SQLite as the primary operational database, accessed through SQLAlchemy models and managed with Alembic migrations.

## SQLite Location

The backend reads these settings from `backend/app/config.py`:

- `SQLITE_FILE`: path to the SQLite database file.
- `SQLITE_URL`: SQLAlchemy SQLite URL.

Default location is the OS user app data directory:

```text
Windows: %APPDATA%\iStore\istore.db
macOS: ~/Library/Application Support/iStore/istore.db
Linux: ~/.config/iStore/istore.db
```

The `database/` folder is for local development data only and should not contain committed production databases.

## SQLAlchemy Models Overview

Core model groups in `backend/app/models.py` include:

- Users, roles, permissions, sessions, login attempts, security audit logs.
- Customers and suppliers.
- Inventory items, categories, brands, serials, stock movements, GRN, stock take, discounts, price adjustments.
- Repair tickets, repair history, repair estimates, repair part usage.
- Sales, sale items, invoice payments, invoice audit events, product reservations, advance payments.
- Returns, return items, refunds, exchanges, store credits, damaged stock.
- Warranty rules, records, claims, events, replacements, supplier warranty records.
- Expenses, purchase orders, supplier ledger entries.
- Reports/audit support, daily closings, notifications, labels, backup records, restore requests, number sequences.

## Alembic Migration Workflow

Migration config lives in `backend/alembic.ini`; current migrations live in `backend/alembic/versions`.

Apply migrations:

```powershell
cd backend
.\.venv\Scripts\activate
alembic upgrade head
```

Create a migration:

```powershell
alembic revision -m "describe_change"
```

Do not delete migration files. If a legacy migration chain exists, keep bridge migrations that preserve upgrade compatibility.

## Backup Before Migration Rule

Before any production migration:

1. Create a local backup.
2. Verify checksum.
3. Confirm the backup can be found in backup history.
4. Apply migration.
5. Smoke test login, POS, inventory, repairs, and reports.

When `AUTO_MIGRATE_ENABLED=true`, `BACKUP_BEFORE_MIGRATE=true` should remain enabled.

## Important Tables

- `users`, `roles`, `permissions`, `role_permissions`, `user_permission_overrides`
- `auth_sessions`, `security_audit_logs`, `permission_change_logs`, `audit_logs`
- `customers`, `suppliers`
- `inventory_items`, `inventory_serials`, `stock_movements`
- `goods_received_notes`, `goods_received_note_items`
- `repair_tickets`, `repair_history`, `repair_estimates`
- `sales`, `sale_items`, `invoice_payments`, `invoice_audit_events`
- `returns`, `return_items`, `refund_payments`, `store_credits`, `exchange_records`
- `warranty_rules`, `warranty_records`, `warranty_claims`
- `backup_records`, `restore_requests`, `restore_approvals`, `restore_audit_events`
- `number_sequences`

## Soft-Delete Policy

Business records should use soft-delete fields where present, such as `is_deleted`, `deleted_at`, `deleted_by`, and `delete_reason`. Hard deletes should be avoided for records tied to money, stock, warranty, audit, or customer history.

## Numbering and Sequence Strategy

Business documents use sequence-backed numbering for invoices, returns, warranties, payments, reservations, and related workflows. Number generation must be atomic enough to avoid duplicate operational document numbers.

## Stock Movement Integrity Rule

Every stock quantity mutation must create a corresponding stock movement row. This includes POS sales, repair part usage, returns, exchanges, GRN receives, GRN cancellation, stock take posting, and manual adjustments. Inventory quantity and stock movement history must reconcile.
