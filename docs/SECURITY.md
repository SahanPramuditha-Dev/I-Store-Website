# Security

I Store is a web application, but it still handles money, stock, customer data, staff permissions, and restore operations. Security controls must be enforced in the backend.

## Authentication Approach

- First-run owner bootstrap creates the first owner account.
- Login uses username/password.
- PIN login is supported for workstation-style access when configured.
- Bearer tokens are used for authenticated API calls.
- Session records support visibility and termination workflows.

Current tests assert that default weak accounts such as `admin/admin123` are not created automatically.

## Password Hashing

Passwords and PINs must be stored only as hashes. The backend uses passlib/bcrypt dependencies. Never log plain-text passwords or PINs.

## RBAC

Role-based access control is stored locally in SQLite:

- `roles`
- `permissions`
- `role_permissions`
- `user_permission_overrides`
- `permission_change_logs`

Backend routes must enforce permissions with `require_permission(...)` or module access dependencies. Permission-sensitive UI should also hide unavailable actions, but backend checks remain authoritative.

## Permission Management

Permission changes should require:

- A reason.
- Additional confirmation for sensitive permission changes.
- Audit/permission change log entries.
- Session revocation when access is downgraded.

## Owner Role Protection

The owner role is protected:

- Locked owner role should not be edited or deleted.
- Last owner user cannot be deactivated, demoted, or deleted.
- Self-lockout from access-control permissions must be blocked.

## Audit Logging

Sensitive actions should create audit/security/activity records. This includes:

- Login/logout and failed login attempts.
- Permission changes.
- Invoice voids, refunds, returns, and exchanges.
- Stock adjustments, GRN cancellation, stock take posting.
- Backup and restore requests, approvals, and execution.
- Repair status changes and assignment changes.

Audit records should be append-only from the UI perspective.

## Session Management

Sessions can be listed and force-terminated through access-control routes. Downgrading user permissions should invalidate affected sessions so stale access is not retained.

## Production Security Checklist

- Set a strong `SECRET_KEY`.
- Use `APP_ENV=production`.
- Disable development-only bootstrap helpers.
- Keep `ALLOW_TEST_ADMIN_BOOTSTRAP=false`.
- Keep real `.env` files and Firebase keys out of Git.
- Restrict filesystem permissions for the SQLite database and backup directory.
- Verify backup checksums and restore approvals.
- Run migrations only after a verified backup.
- Confirm CORS origins are limited to expected frontend origins.
- Do not expose the FastAPI server publicly without HTTPS, strong secrets, restricted CORS, and operational monitoring.

## Debug Endpoint Policy

Debug endpoints and scripts are development-only. The `/debug-db` route is registered only in development and requires admin access. Do not enable debug routes in production, and do not commit temporary debug scripts.
