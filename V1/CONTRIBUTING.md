# Contributing

I Store is an offline-first desktop application. Changes should protect local business data, keep SQLite as the live source of truth, and preserve the Electron desktop workflow.

## Contribution Rules

- Do not remove migrations, package lock files, production templates, or required assets.
- Do not introduce Firebase as a live operational database. Firebase Storage is backup-only.
- Keep backend permission checks in the API, even when the frontend hides UI.
- Add or update tests for workflows that affect money, stock, warranties, returns, access control, or backup/restore.
- Avoid committing local databases, logs, backups, caches, virtual environments, or build outputs.

## Coding Style

- Backend: FastAPI routers under `backend/app/routers`, business logic under `backend/app/services`, models in `backend/app/models.py`, schemas in `backend/app/schemas.py`.
- Frontend: page-level views under `frontend/src/pages`, shared layout/components under `frontend/src/components`, API helpers under `frontend/src/lib`.
- Prefer explicit validation and clear error responses over implicit behavior.
- Keep UI copy operational and concise; this is workstation software, not a marketing site.

## Pull Request Checklist

- Backend tests pass with `python -m pytest -q` from `backend/`.
- Frontend production build passes with `npm run build` from `frontend/`.
- Any database schema change has an Alembic migration.
- Data-changing endpoints enforce RBAC permissions and write audit events where appropriate.
- Stock mutations create stock movement records.
- Backup/restore and migration changes preserve the backup-before-risky-operation rule.
- Documentation is updated when setup, API, deployment, database, security, or testing behavior changes.
