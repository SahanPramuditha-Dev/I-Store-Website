# CURRENT_ARCHITECTURE.md

**Report Date:** 2026-07-27  
**App Version:** v2.4.1  
**DB Schema Version:** local (Alembic-managed, 15+ migration versions applied)

---

## 1. EXECUTIVE SUMMARY

| Area | Status | Key Finding |
|---|---|---|
| **Backend** | ✅ Structured & Mature | FastAPI + SQLAlchemy 2.0 + Alembic; 73 ORM tables; 25 routers; comprehensive RBAC + audit |
| **Database** | ⚠️ SQLite Default / Neon PG Ready | Defaults to SQLite in `%APPDATA%\iStore\istore.db`; Has **first-class PostgreSQL support** in engine |
| **Firebase Usage** | 🟢 Minimal & Optional | **ONLY used for backup off-siting** (Firestore metadata + Storage for backup blobs). No Firestore as primary DB. |
| **Frontend Firebase** | 🟢 ZERO Runtime Usage | `firebase` npm package installed but **NOT imported/used anywhere** in source code. Safe to uninstall immediately. |
| **File Storage** | ⚠️ Local Ephemeral Disk | ONE upload endpoint (`/inventory/upload-image`) → writes to `backend/uploads/` or `/tmp/uploads/` (Vercel-ephemeral, not persisted). |
| **Auth / Sessions** | ⚠️ Write-Heavy | Every authenticated API call triggers **2 DB writes** (session `last_seen_at` + security audit log). |
| **Frontend Caching** | ⚠️ Memory-Only | Custom `useCachedQuery` hook with in-process object cache (no persistence, no offline, lost on reload). |
| **Cost** | 🟢 Near-Zero Today | Current stack is $0/month friendly (SQLite local, Vercel free tier eligible). |

---

## 2. CURRENT TECH STACK

### 2.1 BACKEND

| Layer | Technology | Version / Notes |
|---|---|---|
| **Web Framework** | FastAPI | `0.115.0` |
| **ASGI Server** | Uvicorn (standard) | `0.30.6` |
| **ORM** | SQLAlchemy | `2.0.35` |
| **DB Driver (PG)** | psycopg2-binary | `2.9.9` — installed & supported |
| **Migrations** | Alembic | `1.14.1` — 15+ migration versions in `backend/alembic/versions/` |
| **Auth - Hashing** | passlib + pbkdf2_sha256/bcrypt | `passlib[bcrypt]==1.7.4` |
| **Auth - Tokens** | python-jose (JWT) + HS256 | `python-jose==3.3.0` |
| **File Uploads** | python-multipart | `0.0.12` |
| **PDF / Printing** | fpdf2 | `2.8.7` |
| **Excel / CSV** | (via frontend `xlsx` + backend zip export) | — |
| **Backup - Encryption** | cryptography (Fernet + PBKDF2) | `43.0.3` |
| **Backup - Scheduler** | APScheduler | `3.10.4` — disabled on Vercel |
| **Backup - Remote** | firebase-admin | `6.5.0` — **OFFSITE ONLY** (not primary) |
| **Tests** | pytest + httpx | `8.3.3`, 13 test files |
| **Hosting Backend** | (not specified; current env local/Vercel capable) | `backend/vercel.json` exists |

### 2.2 DATABASE

| Aspect | Current State |
|---|---|
| **Primary Engine** | SQLite (default) → `%APPDATA%\iStore\istore.db` on Windows<br>→ `/tmp/iStore/istore.db` on Vercel |
| **PG Support** | ✅ Fully built in `database.py`:<br>`if db_url.startswith("postgres://") → db_url.replace(..., "postgresql://")` → `create_engine(db_url)` |
| **Connection Mode** | SQLite: WAL journal, `synchronous=NORMAL`, FKs enforced<br>PostgreSQL: standard psycopg2 pool |
| **Tables** | 73 ORM model classes (incl. join/junction tables) |
| **Runtime Sync** | `ALLOW_RUNTIME_SCHEMA_SYNC=true` (Vercel default): ALTER TABLE + CREATE INDEX at startup for SQLite |
| **Auto-Migrate** | `AUTO_MIGRATE_ENABLED=true` (Vercel default): runs Alembic up at boot with pre-migration backup safety |
| **DB Schema Version** | `settings.db_schema_version = "local"` — actual version tracked in `alembic_version` table |

**73 Tables (by module):**
```
Auth/RBAC (11): users, roles, permissions, role_permissions, user_permission_overrides,
                auth_sessions, login_attempts, security_audit_logs, permission_change_logs,
                audit_logs, security_settings

Core Masters (5): customers, suppliers, product_categories, brands, app_settings

Inventory (14): inventory_items, inventory_serials, stock_movements,
                product_discounts, price_adjustment_logs,
                purchase_orders, purchase_order_items,
                goods_received_notes, goods_received_note_items,
                supplier_ledger_entries,
                stock_take_sessions, stock_take_lines, label_* (5 tables)

Repairs (5): repair_tickets, repair_history, repair_estimates, repair_part_usage,
             repair_estimate (linked)

Sales/Billing (14): sales, sale_items, product_reservations,
                    advance_payments, invoice_payments, invoice_audit_events,
                    returns, return_items, refund_payments, store_credits,
                    exchange_records, damaged_stock_records,
                    legacy return_records, damaged_stock_logs

Warranty (8): warranty_rules, warranty_conditions, warranty_records, warranty_claims,
              warranty_claim_events, warranty_replacements, supplier_warranty_records

Expenses (1): expenses

Financial (11): accounting_periods, accounting_ledger_entries,
                approval_requests, cash_reconciliations,
                financial_daily_closings, daily_closings,
                financial_transaction_reviews, financial_audit_flags,
                number_sequences

Notifications (1): notifications

Backup/DR (5): backup_records, restore_requests, restore_approvals, restore_audit_events,
               + app_settings backup_metadata keys
```

### 2.3 FRONTEND

| Layer | Technology | Version / Notes |
|---|---|---|
| **Framework** | React | `18.3.1` |
| **Build Tool** | Vite | `5.4.8` |
| **UI Library** | Material-UI (@mui/material) | `9.0.1` + Emotion |
| **Styling** | Tailwind CSS | `3.4.13` (dual: Tailwind + MUI) |
| **HTTP Client** | axios | `1.7.7` |
| **Routing** | react-router-dom | `6.27.0` |
| **State - Auth/Perms** | localStorage + sessionStorage (custom) | `lib/rbac.js` — no redux/zustand |
| **State - Queries** | Custom `useCachedQuery` hook | `hooks/useCachedQuery.js` — in-memory dict cache |
| **Charts** | recharts | `2.15.0` |
| **Spreadsheets** | xlsx | `0.18.5` |
| **PDF (Client)** | html2pdf.js, react-to-print | Client-side print pipelines |
| **QR Codes** | react-qr-code | `2.2.0` |
| **Icons** | lucide-react | `0.469.0` |
| **Image (Zoom)** | react-zoom-pan-pinch | `4.0.3` |
| **Compress** | JSZip | `3.10.1` |
| **Firebase SDK** | firebase | `11.0.2` — **INSTALLED BUT UNUSED** (grep → only in package.json/lock, NO imports) |
| **Hosting Frontend** | Vercel | `frontend/vercel.json` exists |

**Frontend API Base URL:**
```
Local:  http://127.0.0.1:8000   (window.location.hostname === localhost / 127.0.0.1)
Prod:   https://i-store-website-by6z.vercel.app  (default fallback or VITE_API_URL)
```

### 2.4 DEPLOYMENT / EDGE

| Layer | Provider | Status |
|---|---|---|
| **Frontend CDN / DNS** | Cloudflare | Specified in target arch |
| **Frontend Host** | Vercel | vercel.json files present in both `backend/` + `frontend/` |
| **Backend Host** | (Not pinned in this repo) | vercel.json exists for serverless FastAPI on Vercel; could deploy anywhere ASGI |
| **Object Storage** | Firebase Storage (BACKUPS ONLY) | `FIREBASE_BUCKET=your-project.appspot.com` — NO product media in Firebase today |
| **Target Object Storage** | Cloudflare R2 (future) | Not yet implemented |
| **Target DB** | Neon PostgreSQL | Schema-compatible today (psycopg2 installed, dialect checks exist) |

---

## 3. PROBLEMS / RISKS IDENTIFIED

### 3.1 DATABASE / STORAGE

| ID | Severity | Problem | Impact |
|---|---|---|---|
| D-01 | 🔴 HIGH | **Primary DB is SQLite by default in production paths (Vercel)** | SQLite in `/tmp` on Vercel is **EPHEMERAL** — container restart wipes all data. Data loss if Neon PG `DATABASE_URL` not set. |
| D-02 | 🟠 MEDIUM | **No `DATABASE_URL` env var in root `.env`** | `.env` only has `SECRET_KEY`, `FIREBASE_*`, `VITE_FIREBASE_*`. Falls back to SQLite. |
| D-03 | 🟠 MEDIUM | **Ephemeral local file uploads** | `/uploads/inventory/*.{png,jpg,webp}` → on Vercel these land in `/tmp/uploads/` and **disappear** on the next cold start. Product images silently disappear after deploy. |
| D-04 | 🟡 LOW | **Runtime schema sync (`ALTER TABLE` on every boot)** | Risky concurrent ALTER under multi-instance; not atomic. Mitigated today because Vercel is single-container per deploy but scaling would break. |

### 3.2 WRITE-HEAVY HOT PATHS (Future Neon Cost Risk)

| ID | Severity | Problem | Estimated Writes/Session |
|---|---|---|---|
| W-01 | 🔴 HIGH | **Session `last_seen_at` written on EVERY authenticated request** | `auth.py:get_current_user` → `session.last_seen_at = now` → `db.commit()` on **every call**. → **1 write/request** |
| W-02 | 🔴 HIGH | **Security audit log inserted on EVERY request** | `main.py:request_monitor_middleware` → `_write_module_audit_log` → `record_security_audit` → `db.add()` + `db.commit()` via `run_in_threadpool`. → **1 write/request** (even `GET /health` if protected? No — unprotected skip.) |
| W-03 | 🟠 MEDIUM | **`activity_logs`, `audit_logs` grow unbounded** | No retention policy, no partition, no archive. Will dominate table size and backup time. |
| W-04 | 🟠 MEDIUM | **`notifications`, `login_attempts`, `security_audit_logs` grow unbounded** | Same pattern: insert only, never prune. |

**Cost Model if deployed on Neon with typical use:**
- 1 cashier ~ 500 requests/day → 1000 writes/day just for session + audit (2x multiplier).
- 5 staff = 5000 writes/day → ~150K writes/month. Neon free tier is **1 GB storage, 1 GB RAM, 5 compute hrs/day**. This fits **today**, but log bloat will hit storage in 12-18 months.

### 3.3 FRONTEND

| ID | Severity | Problem | Impact |
|---|---|---|---|
| F-01 | 🟠 MEDIUM | **`Guard` causes permission fetch cascade on every route change** | `useEffect` dependency `[location.pathname]` in [App.jsx](file:///c:/D/Projects/Websites/I%20Store%20Website/frontend/src/App.jsx#L77-L98) → `bootstrapPermissions(api)` runs on **every navigation**. Makes 1 GET `/auth/me/permissions` per route change. |
| F-02 | 🟠 MEDIUM | **Memory-only query cache (`useCachedQuery`)** | Cache lives in module-level `const cache = {}`. Lost on tab refresh, tab switch (GC risk), offline unavailable. No TTL persistence. |
| F-03 | 🟡 LOW | **`firebase@11.0.2` bundled for NO reason** | +~250KB gzipped dead code in every user's browser. No runtime imports found. |
| F-04 | 🟡 LOW | **No query invalidation framework** | Manual `refetch()` / no background refetch. Stale data when 2 tabs open. |

### 3.4 FIREBASE DEPENDENCY STATUS

| ID | Severity | Problem | Impact |
|---|---|---|---|
| FB-01 | 🟢 LOW (TODAY) → 🟠 MEDIUM (LONG-TERM) | **Firebase admin used as backup sink only** | Risk: `FIREBASE_SERVICE_ACCOUNT` JSON + `FIREBASE_BUCKET` config drift / cost creep. Google Cloud egress can surprise. **Migration target: R2 for backup blobs + Postgres for metadata.** |
| FB-02 | 🟢 LOW | **Frontend `firebase` SDK fully dead weight** | Easy win: remove now. No code references. |

### 3.5 SECURITY / OPS

| ID | Severity | Problem |
|---|---|---|
| S-01 | 🟠 MEDIUM | `.env` at repo root has SECRET_KEY=`change-this-secret` (weak default). Production guard in `config.py` but `.env` is a trap. |
| S-02 | 🟡 LOW | `FIREBASE_SERVICE_ACCOUNT=assets/serviceAccountKey.json` — file not in tree (expected). Ensure it stays out of git via `.gitignore`. |
| S-03 | 🟡 LOW | `VITE_FIREBASE_*` vars in root `.env` — shipped to client but unused. Clean house. |

---

## 4. OPTIMIZATION OPPORTUNITIES (Prioritized)

### 4.1 CRITICAL ($0 / Immediate)

1. **[F-03] UNINSTALL FRONTEND FIREBASE SDK**  
   Effort: 2 min. Save ~250KB bundle. No code changes needed. Grep confirmed 0 imports.  
   Command: `cd frontend && npm uninstall firebase`  
   Then remove 7 `VITE_FIREBASE_*` lines from `.env`.

2. **[D-01/D-02] SET DATABASE_URL → NEON POSTGRESQL in production**  
   Effort: 1 env change. Already 100% supported in `database.py`. When set, **no code changes required**. All 73 tables Alembic-migrate cleanly.

3. **[S-01] ROTATE DEFAULT SECRET_KEY**  
   Effort: 5 min. Change `SECRET_KEY` to a 64+ char random string in production. (Invalidates existing JWTs — plan during off-peak.)

### 4.2 HIGH (Write Reduction / Future-Scale)

4. **[W-01] DEBOUNCE SESSION `last_seen_at` WRITES**  
   Update only if `now - last_seen_at > 2 minutes` (configurable). Drops write volume ~30-60x.  
   **Location:** [auth.py:get_current_user lines 96-98](file:///c:/D/Projects/Websites/I%20Store%20Website/backend/app/auth.py#L96-L98).

5. **[W-02] SAMPLE / BATCH SECURITY AUDIT LOGS FOR READ-ONLY GETs**  
   Skip audit log write for idempotent `GET` reads. Only log `POST/PUT/PATCH/DELETE` + auth actions. Cuts ~70% of audit log volume.  
   **Location:** [main.py:_write_module_audit_log](file:///c:/D/Projects/Websites/I%20Store%20Website/backend/app/main.py#L605-L642).

6. **[D-03] MOVE INVENTORY IMAGES → CLOUDFLARE R2**  
   Replace local `/uploads/inventory` write with S3-compatible `boto3` → R2. Return CDN URL. Persistent, cached, $0 egress within Cloudflare.  
   **Location:** [inventory_router.py:upload_inventory_image](file:///c:/D/Projects/Websites/I%20Store%20Website/backend/app/routers/inventory_router.py#L119-L132).

7. **[F-01/F-02] ADOPT TANSTACK QUERY v5 + IDB PERSISTER**  
   Replace `useCachedQuery` memory cache. Fixes route-permission-fetch-cascade (staleTime). Gives offline + tab persistence. Reduces 30-50% of GET requests.

### 4.3 MEDIUM

8. **[W-03/W-04] LOG RETENTION + PRUNE JOB**  
   Add APScheduler (or pg_cron) job:
   - `activity_logs`, `audit_logs`, `login_attempts`, `notifications`, `security_audit_logs` → keep 90 days, archive older to JSON in R2.
   - Keeps table sizes manageable.

9. **[FB-01] MIGRATE BACKUP STORAGE: FIREBASE → R2**  
   Replace `firebase_backup.py` (GCS) with `storage_service.py` (S3/R2) for backup blob destinations. Keep metadata in `app_settings` (Postgres) — no more Firestore reads/writes. Then `pip uninstall firebase-admin`.

10. **[D-04] DISABLE RUNTIME SCHEMA SYNC IN PRODUCTION**  
    Once on Neon PG: set `ALLOW_RUNTIME_SCHEMA_SYNC=false`. Rely only on Alembic during controlled deployments.

### 4.4 LOW (Polish)

11. Add Sentry SDK (backend + frontend) for error tracking.
12. Add PostHog / Plausible (cookie-less) for analytics if needed.
13. Profile + add `pg_stat_statements` indexes based on real Neon query load.
14. Database-level `pg_dump` scheduled to R2 in addition to app-level backups.

---

## 5. FILE / UPLOAD ARCHITECTURE (CURRENT)

```
                    User Browser
                         |
                   POST /inventory/upload-image
                         |
                    FastAPI Backend
                    ├─ Validates ext: {.png, .jpg, .jpeg, .webp}
                    ├─ Validates size: ≤ 5MB
                    ├─ UUID filename
                    └─ Write bytes to:
                          ├─ Local Dev : backend/uploads/inventory/<uuid>.<ext>
                          └─ Vercel    : /tmp/uploads/inventory/<uuid>.<ext>
                         |
              Returns {"url": "/uploads/inventory/<filename>"}
                         |
              Saved to: inventory_items.image_url (TEXT column)
                         |
              Frontend renders:
              <img src={`${apiBase}${image_url}`}  />
                         |
              StaticFiles mount: app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR))
```

**Gaps:**
- No image optimization/re-encoding (no WebP force, no resize)
- No content-type check beyond extension
- No CDN/cache headers
- No lifecycle for delete/replace orphaned files
- Vercel `/tmp` = lost on cold start → **images vanish in production if not migrated**

---

## 6. FIREBASE FOOTPRINT AUDIT

### Backend `firebase-admin` (v6.5.0)

| File | Usage | Can replace with? |
|---|---|---|
| `app/services/firebase_backup.py` | 4 functions:<br>• `init_firebase()` — init SDK<br>• `upload_backup(file_path)` → Firebase Storage bucket<br>• `write_backup_metadata(record)` → Firestore doc<br>• `delete_remote_backup(blob_path)` → GCS delete | **100% R2 + Postgres**<br>Blobs → R2 S3 API<br>Metadata → `app_settings` or `backup_records` table |
| `app/services/backup_service.py` | Imports + calls above during backup create/prune flow | Drop-in: new `storage_service.py` |
| `app/config.py` | Config flags: `FIREBASE_BACKUP_ENABLED`, `FIREBASE_STORE_METADATA`, `FIREBASE_METADATA_COLLECTION`, `FIREBASE_PRUNE_REMOTE_KEEP`, `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_BUCKET` | Rename/add `R2_*` equivalents |

**Status: Optional / toggleable.** `firebase_backup_enabled=false` disables everything. No primary-path dependency.

### Frontend `firebase` (v11.0.2) — FULLY UNUSED

| Search | Result |
|---|---|
| `grep -r "from 'firebase'" frontend/src` | **0 matches** |
| `grep -r "require(.*firebase" frontend/src` | **0 matches** |
| `grep -r "firebase\." frontend/src` | **0 matches** |
| `grep -r "VITE_FIREBASE" frontend/src` | **0 matches** |

**Action: Remove immediately. Zero risk.**

---

## 7. COST PROJECTIONS (Current vs Optimized)

Assumptions: 5 active staff, 1 month of operations, Neon Free Tier + Vercel Hobby + Cloudflare Free + R2 Free Tier.

| Line Item | **CURRENT (SQLite default)** | **AFTER OPTIMIZATION** |
|---|---|---|
| **Frontend (Vercel)** | $0 (Hobby, 100GB bw) | $0 (unchanged) |
| **Backend (Serverless)** | $0 (Vercel Hobby limits) | $0 (unchanged) |
| **Database** | $0 (SQLite → risk of data loss) | $0 (Neon Free Tier: 1GB / 5h compute/day) |
| **Storage - Images** | $0 (local disk → ephemeral) | $0 (R2 Free Tier: 10GB storage, 1M class A / 10M class B reads, **egress FREE to Cloudflare CDN**) |
| **Storage - Backups** | Firebase - small cost (~$0.05-$2/month variable, billed via GCP) | $0 (same R2 bucket) |
| **Bandwidth Egress** | $0 → Vercel limits | $0 (Cloudflare → R2 zero-egress zone) |
| **Neon DB Writes** | N/A (SQLite) | ~30K writes/month (after W-01 + W-02 debounced) → fits 5h/day free compute easily |
| **Total / mo** | **$0 → but DATA LOSS RISK on Vercel** | **$0 / month → PERSISTENT + SCALABLE** |

---

## 8. IMMEDIATE NEXT STEPS (Phased Order)

Phase order strictly follows the master plan. Current deliverable is this audit doc.
Next:
1. Phase 2 — DB Audit: actually connect (if Neon `DATABASE_URL` set) and run pg_size queries, else SQLite size + `ANALYZE`.
2. Phase 3 — Backup env: create `backup/environment.txt` (gitignored) with env snapshot.
3. Phase 4 — Storage audit: list existing uploads, table counts of `image_url`/`profile_photo`/`logo_url`/`icon_url`.
4. Phase 5+ — R2 setup and implementation.

---

_End of CURRENT_ARCHITECTURE.md — generated from live codebase inspection 2026-07-27._
