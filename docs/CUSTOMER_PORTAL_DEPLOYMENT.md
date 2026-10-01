# Customer portal integration plan and release gate

## Authority and mapping

The Business and License Platform owns the tenant and shop lifecycle. Its
`portal_branch_mappings` table links one platform shop to one ERP organization,
one ERP branch, and one public portal store reference. IDs in the platform and
ERP are independent; equal numbers do not establish identity. A new mapping is
disabled until an administrator activates it. Duplicate ERP branches and portal
store references are rejected.

For each activated mapping, configure the ERP's
`CLOUDFLARE_PORTAL_ORGANIZATION_ID`, `CLOUDFLARE_PORTAL_BRANCH_ID`, and
`CLOUDFLARE_PORTAL_STORE_REF` from the mapping record. Configure the Worker's
`PC_BRIDGE_STORE_REF` to the same portal reference. Use one Worker configuration
per branch until multi-branch credential routing exists. ERP sync and printed
links require an explicit matching organization and branch. Worker bill uploads
and OTP delivery require its configured store reference.

## Rollout plan

1. Apply `backend/migrations/20260925_portal_branch_mappings.sql` in the
   licensing platform's production database. Back up the database first.
2. For each shop, use `PUT /admin/shops/{shop_id}/portal-mapping` with the ERP
   organization ID, ERP branch ID, and unique portal store reference. Start with
   `is_active=false`. Verify the ERP IDs from the ERP database; do not infer them
   from licensing IDs.
3. Check each mapping against the ERP and Worker settings. For local SQLite
   databases, run `backend/scripts/verify_portal_mapping.py` from the licensing
   project with `--platform-db`, `--erp-db`, `--shop-id`, and
   `--worker-store-ref`. Production PostgreSQL data requires an equivalent
   read-only query or a sanitized export before activation.
4. Provision D1 and Worker secrets, including `POS_API_BASE_URL` and
   `POS_PORTAL_API_TOKEN` for private customer actions. Set HTTPS origins and verify
   that the PC bridge reports ready. Keep `PORTAL_ENABLED=false` until the
   deployed staging receipt to OTP to private bill flow passes, including an
   attempted cross-branch read and a revocation.
5. Activate the mapping and enable portal access for that branch. Monitor failed
   sync, delivery, and cross-store rejection events. Deactivate the mapping and
   disable portal access if the identity or delivery route changes unexpectedly.

## Legacy inbound webhook

The legacy Supabase webhook and pull are separately opt-in. Set a random
`PORTAL_WEBHOOK_SECRET` of at least 32 characters and explicit
`PORTAL_WEBHOOK_ORGANIZATION_ID`, `PORTAL_WEBHOOK_BRANCH_ID`, and
`PORTAL_WEBHOOK_STORE_REF` values. Its
payload must carry the matching `store_id`. Polling also requires this mapping
and filters every query and ingested record by store. Leave these paths unused
if the legacy inbound flow is unnecessary.

## Release criteria

Local backend, Worker, desktop, and WhatsApp tests pass; CI passes on the
target commit; the mapping is unique and active; live ERP and licensing records
match; Worker settings match; and the deployed customer flow and denial cases
pass. This repository cannot establish those live conditions by itself.

## Environment check, 1 October 2026

Vercel ERP and licensing health checks and the portal API forwarding return
HTTP 200. The Cloudflare Worker is deployed with the correct Vercel origin,
`ENVIRONMENT=staging`, and `PORTAL_ENABLED=false`. D1 migrations are current.

The real desktop ERP was found at
`%LOCALAPPDATA%/iStore/tenants/IPOINT/database/istore.db`. Its organization 1
is I Point Electronics (`ipoint`) and branch 1 is `IPOINT-KT`. The cached
license names tenant `IPOINT` and shop `IPOINT-KT`. These match production
licensing tenant 8 and shop 9. An **inactive** production mapping now connects
shop 9 to organization 1, branch 1 and Worker store `i-store`. A mapping-table
snapshot was saved before the change and the preparation was audit logged.
This mapping refers to the desktop tenant database, not the empty Neon ERP.
The desktop database has no sales; D1 has no receipt rows, and the bridge's
last known state is offline. Customer access must remain disabled.

## Extended private ERP API

The ERP implements private `/portal/*` endpoints for bill detail and JSON
download, warranty and repair records, appointment requests/changes/cancellation,
feedback, and repair/warranty/resend requests. Every call validates the Worker
bearer token, mapped active organization and branch, receipt/customer HMACs,
and the local reconciliation checkpoint. Deleted or reassigned receipts fail
closed. Portal repair/warranty routes retain signed license entitlement and
capability checks. Requests are persisted for staff review; they do not claim
that a physical repair was received, a warranty claim approved, an appointment
confirmed, or a WhatsApp message sent.

Staff managers review requests in Settings → Customer Portal → Customer
requests. `/portal-requests` uses staff authentication and an explicit branch.
Customer appointment changes return to pending review. JSON invoice exports
contain customer bill fields, not internal staff/audit records. The existing
portal print function also provides browser Save PDF.

Before enabling the optional live services:

1. Back up the target ERP database and apply Alembic migration
   `20261001_0023` (portal service request inbox).
2. Configure `POS_PORTAL_API_TOKEN` on both the ERP and Worker, at least
   32 random characters. Worker `POS_API_BASE_URL` must reach the **same ERP
   tenant database** that generated the receipt, through HTTPS. Do not point
   I Point's desktop receipts at the empty Neon backend.
3. Configure ERP `CLOUDFLARE_RECEIPT_IDENTITY_KEY` with the exact Worker
   `RECEIPT_TOKEN_SECRET`; it is distinct from the POS receipt-link signing
   key. Customer HMAC input is `storeRef:947...` (digits, no plus sign), and
   receipt HMAC input is `storeRef:invoiceRef`, both SHA-256 hex.
4. Set the explicit ERP organization/branch/store environment values. Desktop
   `.portal-sync.env` belongs inside the selected `ISTORE_DATA_ROOT`; a tenant
   no longer falls back to a shared installation's portal credentials.
5. Test the real receipt → WhatsApp OTP → private bill flow, cross-customer
   and cross-branch denials, expiry, revocation, and offline sender behavior.
   Then activate the licensing mapping and enable customer access.

The optional service panel is shown only when the Worker has HTTPS ERP proxy
configuration and a service token. D1 bills keep working without this proxy
when the shop PC is offline. Neither a passing synthetic test nor a successful
code deployment confirms real WhatsApp delivery.

Use `CLOUDFLARE_PORTAL_URL=https://i-store-customer-portal-one.vercel.app`
for printed customer links and `CLOUDFLARE_PORTAL_API_URL` for the HTTPS
Worker host used by `/internal/bills`. Separating them avoids issuing a receipt
link on a host whose browser origin the Worker rejects.
