# Setup

This guide sets up I Store for local development on Windows PowerShell. Adjust paths if your checkout is elsewhere.

## Prerequisites

- Python 3.13 or a compatible Python 3 version
- Node.js and npm
- Git
- Optional: Firebase service account JSON if cloud backup is required

## Backend Setup

```powershell
cd "C:\D\Projects\Python\I Store\V1\backend"
py -3.13 -m venv .venv
.\.venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
alembic upgrade head
python -m uvicorn app.main:app --reload --port 8000
```

If `.venv` already exists, activate it and run `pip install -r requirements.txt` only when dependencies change.

## Frontend Setup

```powershell
cd "C:\D\Projects\Python\I Store\V1\frontend"
npm install
npm run dev
```

The Vite app runs at `http://127.0.0.1:5173`.

## Environment Variables

Important backend variables:

```text
APP_ENV=development
SECRET_KEY=change-this-secret
SQLITE_FILE=C:\path\to\istore.db
SQLITE_URL=sqlite:///C:/path/to/istore.db
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,null
AUTO_MIGRATE_ENABLED=false
BACKUP_BEFORE_MIGRATE=true
BACKUP_FOLDER=C:\path\to\backups
BACKUP_SCHEDULE_ENABLED=true
BACKUP_SCHEDULE_HOUR=23
BACKUP_SCHEDULE_MINUTE=59
BACKUP_SCHEDULE_TIMEZONE=UTC
FIREBASE_BACKUP_ENABLED=false
FIREBASE_SERVICE_ACCOUNT=C:\path\to\serviceAccountKey.json
FIREBASE_BUCKET=your-bucket.appspot.com
```

Do not commit real `.env` files or Firebase service account keys.

## First-Run Setup

1. Start the backend.
2. Open the frontend website.
3. Complete the owner bootstrap flow.
4. Configure the store profile. The software is I Store; the default shop name can be I Point.
5. Configure roles, permissions, print profile, backup destination, and business rules.

## Database Migration Instructions

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

Before applying migrations to production data, create and verify a backup.

## Common Setup Errors

- `ModuleNotFoundError`: the backend virtual environment is not active.
- `sqlite readonly` or backup write failures: check folder permissions for the configured app data and backup directories.
- CORS failures: include the frontend origin in `CORS_ORIGINS`.
- Login returns setup-required: create the owner user through `/auth/bootstrap/owner`.
- Blank page or API errors: confirm backend `:8000` and frontend `:5173` are running.
