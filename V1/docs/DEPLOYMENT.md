# Deployment

I Store is deployed as a web application with a React frontend, FastAPI backend, and SQLite database storage.

## Frontend Deployment

Build the frontend:

```powershell
cd frontend
npm install
npm run build
```

Deploy `frontend/dist` to a static host such as Vercel, Netlify, Cloudflare Pages, or your own web server.

## Backend Deployment

Run the backend with Uvicorn behind HTTPS:

```powershell
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Local Database Preservation

The runtime SQLite database should live outside the source tree in the OS app data directory. Application updates must not overwrite it.

Before shipping an update that changes database schema:

1. Create a backup.
2. Apply Alembic migrations.
3. Verify login, POS, repairs, inventory, warranty, returns, and reports.

## App Update Strategy

- Keep migrations backward-aware and data-preserving.
- Run migration smoke tests against a copied production-like database.
- Use backup-before-migration in production.
- Avoid destructive migrations unless a manual export and restore path exists.

## Migration During Update

`AUTO_MIGRATE_ENABLED` can run migrations on startup, but production updates should keep `BACKUP_BEFORE_MIGRATE=true`. If the pre-migration backup fails, migration should not proceed.

## Rollback Strategy

Rollback requires both application version and database state awareness:

- If no migration ran, reinstall the prior app version.
- If migration ran, restore the pre-migration backup after verifying checksum.
- Keep a copy of released application versions and matching migration notes.

## Production Environment Settings

Recommended production settings:

```text
APP_ENV=production
SECRET_KEY=<strong-random-secret>
CORS_ORIGINS=https://your-frontend-domain.com
AUTO_MIGRATE_ENABLED=false
BACKUP_BEFORE_MIGRATE=true
BACKUP_ENCRYPT=true
BACKUP_ENCRYPTION_PASSPHRASE=<strong-backup-passphrase>
BACKUP_SCHEDULE_ENABLED=true
FIREBASE_BACKUP_ENABLED=<true only when configured>
ALLOW_TEST_ADMIN_BOOTSTRAP=false
SEED_DEMO_DATA=false
```

Restrict access to `.env`, SQLite databases, backups, and Firebase service account files.
