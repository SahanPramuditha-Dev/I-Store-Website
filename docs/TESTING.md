# Testing

I Store currently has meaningful backend pytest coverage. Frontend automated tests are not configured in `frontend/package.json` yet, so frontend validation is currently build plus manual QA.

## Backend Tests

Run all backend tests:

```powershell
cd backend
.\.venv\Scripts\activate
python -m pytest -q
```

The backend tests use temporary SQLite databases through `backend/tests/conftest.py` and bootstrap an owner user for authenticated flows.

Important backend test files:

- `test_access_control_contract.py`: RBAC, owner protection, permission overrides, session force logout.
- `test_advance_payments_workflow.py`: reservation and repair advance payment flows.
- `test_audit_hardening_workflows.py`: owner bootstrap, no weak default admin, repair/POS integration, stock take, backup restore, numbering.
- `test_expenses_and_repair_workflow.py`: expenses and repair status rules.
- `test_inventory_grn_workflow.py`: GRN detail, cancellation, purchase order cancellation integrity.
- `test_pos_billing_contract_endpoints.py`: POS checkout, repair billing, reservation settlement, invoice/payment endpoints.
- `test_returns_refunds_management.py`: returns, refunds, exchanges, store credit, inventory updates.
- `test_search_hub.py`: global search across operational categories.
- `test_smoke_and_pos.py`: health and POS return stock consistency.
- `test_warranty_auto_applied.py`: warranty rules, auto-created warranties, lookup, claims.

## Frontend Tests

No frontend test runner is currently configured. Until Vitest/React Testing Library or another runner is added, run:

```powershell
cd frontend
npm run build
```

Recommended future structure:

```text
frontend/src/__tests__/
  Login.test.jsx
  POS.test.jsx
  Repairs.test.jsx
  PermissionManagement.test.jsx
```

## Manual QA Checklist

- First-run owner bootstrap.
- Login/logout and session termination.
- Permission-based sidebar and action visibility.
- POS checkout, split payment, invoice reprint, void restrictions.
- Stock deduction and movement ledger after sales.
- Repair creation, status transitions, estimate approval, billing, delivery.
- Warranty auto-creation and lookup by invoice, serial/IMEI, and warranty number.
- Returns, refunds, exchanges, damaged stock, and store credit.
- GRN receive and cancellation.
- Stock take draft, review, post, and movement records.
- Backup create, checksum verification, restore request, approval, execute.
- Reports and exports for sales, inventory, repairs, expenses, and audit.

## Critical Workflow Test Cases

POS:

- Product checkout deducts stock exactly once.
- Split payments create payment records.
- Repair invoice supports labor plus spare parts.
- Reservation settlement applies advances.
- Void/refund actions require permission and audit logging.

Repairs:

- Invalid status jumps are rejected.
- Technician assignment persists.
- Delivered repair creates warranty.
- Repair part consumption deducts stock.

Inventory:

- GRN increases only received quantity.
- GRN cancellation reverses stock once.
- Stock take does not change quantity until posted.
- Manual adjustments require movement records.

Warranty:

- Product rule overrides category rule.
- Category rule fallback works.
- GRN does not create customer warranty.
- Warranty claim can be inspected, approved, and resolved.

Returns and Refunds:

- Return lookup only exposes eligible invoice items.
- Refund approval and mark-paid workflow works.
- Exchange deducts replacement stock.
- Store credit can be issued and applied.

Backup and Restore:

- Backup file is created.
- Restore request persists in normalized tables.
- Approval and execution are audited.
- Emergency backup is created before restore.

## Missing Tests Still Needed

- Frontend login flow test.
- Frontend POS cart behavior test.
- Frontend repair creation flow test.
- Frontend permission hiding test.
- Frontend warranty lookup test.
- Frontend returns/refunds modal test.
- Responsive layout smoke test.
- Dedicated backend soft-delete behavior tests across all major models.
- Dedicated audit log assertions for every sensitive endpoint group.
