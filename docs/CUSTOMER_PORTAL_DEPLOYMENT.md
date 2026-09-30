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

## Environment check, 30 September 2026

ERP and licensing Vercel production frontends and backend health endpoints
return HTTP 200. The customer portal production Vercel site now forwards
`/api/*` to the Cloudflare Worker; `/api/config` returns JSON. A verified
licensing database backup was taken before applying the mapping migration on
26 September. The production mapping table still has zero rows, including zero
active rows. Licensing shop 9 is `I Point`.

The ERP backend's connected Neon database now has `organizations`, `branches`,
and `sales` tables in `public`, but a read-only join found **zero organization
rows**. There is no ERP organization or branch identity to map yet. Do not
invent identifiers or activate a licensing mapping until the real ERP records
exist and their ownership is confirmed.

The deployed Worker reports `ENVIRONMENT=staging` and `PORTAL_ENABLED=false`.
The D1 bill path is self-contained after receipt and OTP verification. Worker
code on the customer portal main branch permits this D1 path without ERP proxy
configuration, but that code has not been deployed to Cloudflare as of this
check. Extended `/api/portal/*` routes still expect private ERP `/portal/*`
endpoints with ownership validation; those ERP endpoints are not implemented.
They must stay unavailable until implemented and tested.

Do not set `PORTAL_ENABLED=true` until the real ERP organization and branch,
licensing mapping, POS sync outbox, WhatsApp delivery bridge, Worker origin, and
receipt-to-OTP-to-private-bill denial tests have all been verified in staging.
