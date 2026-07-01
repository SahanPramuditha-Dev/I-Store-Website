# API

The backend API is a FastAPI application served from `backend/app/main.py`.

Base development URL:

```text
http://127.0.0.1:8000
```

Health check:

```text
GET /health
```

## Authentication

Most routes require a bearer token:

```http
Authorization: Bearer <access_token>
```

Login uses form data:

```text
POST /auth/login
content-type: application/x-www-form-urlencoded
username=<username>&password=<password>
```

First-run owner bootstrap:

```text
GET /auth/bootstrap/status
POST /auth/bootstrap/owner
```

## Response Format

Successful responses are route-specific JSON payloads. Errors are normalized by the global handlers:

```json
{
  "success": false,
  "error_code": "VALIDATION_FAILED",
  "message": "Request validation failed",
  "meta": {
    "errors": []
  }
}
```

Unhandled errors return a generic message with an `error_id` in `meta`.

## Main Route Groups

- `/auth`: bootstrap, login, PIN login, logout, current user, sessions, staff, password reset.
- `/access`: roles, permission catalog, role permissions, user overrides, session force logout, simulation, permission history.
- `/dashboard`: dashboard summaries.
- `/customers`: customer CRUD and history.
- `/inventory`: products, suppliers, stock adjustments, movements, analytics, serials, categories, brands, GRN, discounts, stock take.
- `/purchase`: purchase orders, reconciliation, receive, cancel.
- `/pos`: sales, checkout, repair checkout, reservation checkout, returns, product search, barcode lookup, available advances/credits.
- `/invoices`: invoice list/detail, invoice number lookup, void, reprint, A4/thermal print rendering.
- `/payments`: payment creation, invoice payments, split payment.
- `/repairs`: repair CRUD, status workflow, cancellation, technician assignment, billing summary, invoices, part consumption, job card PDF.
- `/returns`, `/refunds`, `/store-credits`, `/damaged-stock`: returns/refunds/exchange workflow.
- `/warranty`: warranty dashboard, records, lookup, claims, rules, conditions, reports.
- `/expenses`: expense lifecycle and summary.
- `/reports`: operational reports and exports.
- `/backup`: backup creation, history, restore requests, approvals, execution, export, scheduler status.
- `/settings`: store profile, business preferences, employees, access-control compatibility routes, print profile, integrations.
- `/search`: global search and suggestions.
- `/audit-trail`, `/financial-audit`, `/labels`, `/notifications`, `/ledger`: supporting operational modules.

## RBAC Enforcement

Backend permission dependencies are mandatory for sensitive routes. Examples include:

- `pos.checkout`
- `pos.refund`
- `pos.void_invoice`
- `returns.approve`
- `returns.refund`
- `access.manage_permissions`
- `access.force_logout`

Frontend RBAC visibility is not a security boundary.

## Important Endpoint Examples

Create a POS checkout:

```text
POST /pos/checkout
```

Create a repair invoice:

```text
POST /repairs/{repair_id}/create-invoice
```

Lookup warranty:

```text
GET /warranty/lookup?serial=<serial>
GET /warranty/lookup?invoice=<invoice_number>
GET /warranty/lookup?warranty_number=<warranty_number>
```

Create backup:

```text
POST /backup/create
```

Restore request workflow:

```text
POST /backup/restore/request
POST /backup/restore/requests/{request_id}/approve
POST /backup/restore/requests/{request_id}/execute
```
