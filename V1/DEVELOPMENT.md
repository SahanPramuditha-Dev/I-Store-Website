# Development

## Workflow

1. Pull the latest branch.
2. Start backend and frontend.
3. Make focused changes in the relevant module.
4. Add or update tests for affected business behavior.
5. Run backend tests and frontend build before handing off.

Suggested commands:

```powershell
cd backend
.\.venv\Scripts\activate
python -m pytest -q
```

```powershell
cd frontend
npm run build
```

## Code Organization

- `backend/app/routers`: HTTP route contracts and dependency enforcement.
- `backend/app/services`: business rules, backup, numbering, warranties, returns, and security workflows.
- `backend/app/models.py`: SQLAlchemy models.
- `backend/app/schemas.py`: request/response schemas.
- `backend/alembic/versions`: current migration chain.
- `frontend/src/pages`: top-level screens.
- `frontend/src/components`: shared UI and layout components.
- `frontend/src/lib`: API helpers, RBAC helpers, and frontend utilities.

## Branch and Commit Suggestions

- Use short feature branches such as `feature/returns-audit` or `fix/grn-cancel-stock`.
- Keep commits scoped to one behavior when practical.
- Include migration, backend, frontend, and docs changes in the same branch when they are part of one feature.

## Coding Conventions

- Keep SQLite as the operational source of truth.
- Backend permissions must be enforced with dependencies such as `require_permission(...)`; frontend hiding is only a usability layer.
- Data-changing workflows should write audit/security/activity logs when they affect money, stock, access, backup/restore, or customer records.
- Stock changes must create `StockMovement` rows.
- Prefer service-layer functions for reusable business rules.
- Keep UI dense, predictable, and suitable for repeated shop operations.

## API Conventions

- Protected routes require bearer token authentication.
- Use explicit HTTP status codes for validation, conflicts, and permission failures.
- Structured errors use `success`, `error_code`, `message`, and `meta`.
- Prefer stable route groups: `/auth`, `/access`, `/pos`, `/inventory`, `/repairs`, `/returns`, `/warranty`, `/backup`, `/settings`, `/reports`.

## UI Conventions

- Use the shared layout and primitive components where possible.
- Keep permission-sensitive actions hidden or disabled based on frontend RBAC, but keep backend checks authoritative.
- Use compact tables, clear filters, and visible empty/loading/error states.
- Avoid workflows that require internet access for normal POS, repair, or inventory operations.

## Add a New Page or Module

1. Add the page in `frontend/src/pages`.
2. Add navigation and route registration in `frontend/src/App.jsx` and layout components as needed.
3. Add frontend permission gating in `frontend/src/lib/rbac.js` if the page is permission-controlled.
4. Add backend route(s) under `backend/app/routers`.
5. Include the router in `backend/app/main.py`.
6. Add tests under `backend/tests` for business rules and API contract.

## Add a Backend Route

1. Define schemas if needed.
2. Add the endpoint to the correct router.
3. Add `Depends(require_permission("module.action"))` for protected actions.
4. Keep transaction boundaries explicit for multi-step workflows.
5. Add audit logging for sensitive changes.
6. Add or update pytest coverage.

## Add a Migration

1. Change SQLAlchemy models.
2. Create a migration with Alembic.
3. Review upgrade and downgrade logic.
4. Confirm migrations do not delete live data unexpectedly.
5. Run `alembic upgrade head` against a disposable database.
6. Document operational impact in `docs/DATABASE.md` if the workflow changes.
