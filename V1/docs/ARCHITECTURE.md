# Architecture

I Store is a web application for a mobile phone repair and retail shop.

```text
React frontend
  -> FastAPI backend
    -> SQLite local database
      -> local backup artifacts
        -> optional Firebase Storage upload
```

## React Frontend

The frontend lives in `frontend/src`.

- `pages/`: operational screens such as POS, Repairs, Inventory, Warranty, Returns/Refunds, Reports, Settings, and Permission Management.
- `components/`: shared layout, UI primitives, repair board, settings panels, and table/layout helpers.
- `lib/api.js`: API communication layer.
- `lib/rbac.js`: frontend permission visibility helpers.

The frontend should remain usable in a shop workflow: compact screens, predictable navigation, internal scrolling tables, and fast repeated actions.

## FastAPI Backend

The backend lives in `backend/app`.

- `main.py`: app bootstrap, router registration, runtime schema safety, middleware, error handling, health endpoint.
- `routers/`: route groups for auth, access control, POS, inventory, repairs, reports, backup, warranty, returns, settings, expenses, labels, search, notifications, and finance/audit workflows.
- `services/`: business rules for backup, warranty, returns, numbering, access/security, notifications, labels, and advances.
- `models.py`: SQLAlchemy models.
- `schemas.py`: Pydantic request/response schemas.

Backend route permissions are authoritative. Frontend permission hiding improves UX but does not replace backend enforcement.

## SQLite-First Database Strategy

SQLite is the live operational database. POS checkout, stock mutations, repair workflow, invoices, reports, RBAC, warranties, returns, and audit logs read and write locally.

Runtime database location is configured by `SQLITE_FILE` and `SQLITE_URL`. By default, `backend/app/config.py` places the database in the OS user app data directory under `iStore/istore.db`.

## Firebase Backup-Only Role

Firebase Storage is optional and used only for backup artifacts. Firestore, if enabled, stores lightweight backup metadata such as file name, checksum, size, device name, and app version.

Firebase must not become the live database for POS, inventory, repairs, customers, reports, or authorization.

## Offline-First Design

Normal shop operations must work without internet:

- Login/session checks use local SQLite.
- POS and repair billing write local invoices and stock movements.
- Inventory and reports query local SQLite.
- Backup upload failures must not block local work.

## Module Overview

- Auth and RBAC: owner bootstrap, login, PIN login, sessions, roles, permissions, user overrides.
- POS and invoices: product sales, repair billing, reservation settlement, split payment, advances, reprints, voids.
- Inventory: products, suppliers, serials, stock movements, GRN, stock take, price adjustments, discounts.
- Repairs: ticket lifecycle, estimates, technician assignment, billing, job cards, repair parts.
- Warranty: warranty rules, auto-created records, lookup, claims, replacements.
- Returns/refunds: returns, refunds, exchanges, store credit, damaged stock.
- Reports: sales, repairs, inventory, expenses, outstanding payments, audit exports.
- Backup/restore: backup records, restore requests, approvals, checksums, emergency snapshots.

## Data Flow Examples

POS checkout:

```text
Cashier submits cart
  -> /pos/checkout
    -> permission check
    -> invoice number allocation
    -> sale + sale items
    -> payment records
    -> stock movements
    -> warranty records when applicable
    -> audit/invoice events
```

Restore workflow:

```text
Owner requests restore
  -> verify backup and checksum
  -> create restore request
  -> approval
  -> emergency pre-restore backup
  -> execute restore
  -> restore audit event
```
