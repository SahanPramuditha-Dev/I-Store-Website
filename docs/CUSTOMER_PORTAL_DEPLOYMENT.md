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

## Environment check, 26 September 2026

The Cloudflare dashboard shows the deployed Worker has D1 and its core receipt,
OTP, bridge, and Turnstile settings. It reports `ENVIRONMENT=staging` and
`PORTAL_ENABLED=false`. `POS_API_BASE_URL` and `POS_PORTAL_API_TOKEN` are not
present in the live Worker settings, so customer actions requiring the ERP API
cannot work there yet. Do not enable customer access until those settings point
to the correct ERP deployment and the full flow has been tested.

Vercel's licensing backend production deployment is ready at commit `06e7189`
(24 September 2026). Its Production and Preview configuration includes the
Supabase `POSTGRES_URL` connection. The connected production Supabase database
is available. A verified database backup was taken and the mapping migration
was applied on 26 September 2026; the new table contains zero rows. The mapping
API still requires a successful licensing backend deployment. The Vercel
customer portal site is ready at commit `cd3e44f` from 22 August 2026; it is
separate from the Cloudflare Worker API. Deploy the tested licensing code before
creating or activating branch mappings.

The ERP Vercel backend project's connected Neon database did not expose
`organizations` or `branches` in its `public` schema during the read-only check.
The production licensing shop is `I Point` (shop ID 9), but no matching ERP
organization or branch ID has been verified. Also, the Worker expects private
ERP `/portal/*` API routes authenticated with `POS_PORTAL_API_TOKEN`; those
routes and token validation are not implemented in the ERP backend yet. Keep
portal access disabled until the ERP API contract and identity mapping are
implemented and tested end to end.
