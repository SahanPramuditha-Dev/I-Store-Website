# I Store

I Store is a web-based management system for mobile phone repair and retail shops. It combines POS billing, repair workflow management, inventory control, warranty handling, returns/refunds, reporting, access control, and local backup/restore in one browser-based application.

Branding note: **I Store** is the software name. **I Point** is the default configurable shop/business name used in store profile and print layouts.

## Tech Stack

- Frontend: React, Vite, Tailwind CSS, Material UI, Recharts
- Backend: Python FastAPI, SQLAlchemy, Alembic, SQLite
- Backup: local SQLite backups with optional Firebase Storage upload
- Database: SQLite-first local database

## Main Features

- Login, owner bootstrap, role-based access control, sessions, and audit logging
- POS checkout for products, repair invoices, reservations, split payments, advances, and store credit
- Inventory catalog, suppliers, stock movements, GRN, serial/IMEI tracking, stock take, discounts, and price adjustments
- Repair tickets, technician assignment, status workflow, estimates, parts usage, job cards, and billing
- Warranty rules, auto-created warranty records, warranty lookup, and claims
- Returns, refunds, exchanges, damaged stock, and store credit
- Reports for sales, repairs, inventory, expenses, audit, outstanding payments, and exports
- Backup/restore with checksum validation and optional Firebase Storage redundancy

## Quick Start

Prerequisites:

- Python 3.13 or a compatible Python 3 version
- Node.js and npm
- Git

Backend:

```powershell
cd "C:\D\Projects\Python\I Store\V1\backend"
py -3.13 -m venv .venv
.\.venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
alembic upgrade head
python -m uvicorn app.main:app --reload --port 8000
```

Frontend:

```powershell
cd "C:\D\Projects\Python\I Store\V1\frontend"
npm install
npm run dev
```

Development URLs:

- Frontend: `http://127.0.0.1:5173`
- Backend: `http://127.0.0.1:8000`
- Health check: `http://127.0.0.1:8000/health`

On first run, create the owner account through the bootstrap flow. Do not rely on default `admin/admin123` credentials; current tests assert that no default admin account is created.

## Production Build

Build the frontend:

```powershell
cd frontend
npm run build
```

Deploy the built frontend with any static web host and run the FastAPI backend behind HTTPS.

## Folder Structure

```text
backend/        FastAPI application, SQLAlchemy models, routers, services, Alembic migrations, tests
frontend/       React/Vite frontend application
assets/         Shared local assets and optional Firebase service account location
database/       Local development database area; do not commit live production data
docs/           Architecture, API, database, security, backup, deployment, and testing docs
```

## Database Notes

SQLite is the primary operational database. The backend resolves the runtime database path from `SQLITE_FILE`/`SQLITE_URL`; by default it uses the OS app data directory (`iStore/istore.db`). Alembic migrations live under `backend/alembic` and must not be removed.

## Backup Notes

Backups are local first. Firebase Storage is optional and used only for backup artifacts. Firestore, when enabled, stores lightweight backup metadata only. Firebase is not a live operational database for POS, repairs, inventory, reports, or authorization.

## Documentation

- [Setup](SETUP.md)
- [Development](DEVELOPMENT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Database](docs/DATABASE.md)
- [API](docs/API.md)
- [Security](docs/SECURITY.md)
- [Backup and Restore](docs/BACKUP_RESTORE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Testing](docs/TESTING.md)
- [Contributing](CONTRIBUTING.md)
