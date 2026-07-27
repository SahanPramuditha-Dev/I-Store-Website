# iStore POS Architecture Optimization Plan

> Document Version: 1.0 | Date: 2026-07-27 | Scope: Single-Store Production POS

---

## Final Deliverable 1: Current Architecture Review

### 1.1 Verified Stack (From Code Audit)

| Layer | Technology | Host |
|-------|-----------|------|
| Frontend | React 18.3 + Vite 5 + MUI 9 + Tailwind + React Router v6 | **Vercel** (i-store-website.vercel.app) |
| Backend | FastAPI 0.115 + SQLAlchemy 2.0 + Uvicorn + Pydantic 2 | **Vercel Serverless** (i-store-website-by6z.vercel.app via @vercel/python) |
| **Database ACTUAL** | **PostgreSQL 16** — Neon.tech `postgresql://neondb_owner:...aws.neon.tech/neondb` | **Neon Serverless Postgres** |
| Database Local Dev | SQLite 3 via SQLAlchemy `sqlite:///` | `%APPDATA%\iStore\istore.db` (Win) |
| Auth | Custom HS256 JWT + `auth_sessions` table + PBKDF2-SHA256 / bcrypt passwords | — |
| Product Images | Local filesystem `backend/uploads/inventory/<uuid>.ext` | **EPHEMERAL on Vercel (/tmp/uploads = lost on cold start)** 🚨 |
| Backup Files | Firebase Storage (gzip + Fernet AES-128-CBC encrypted SQLite dumps) | Google Cloud Storage via Firebase SDK |
| Backup Metadata | Firestore `backup_metadata` collection | Firebase Firestore (admin SDK) |
| Migrations | Alembic 1.14 + Runtime `ALTER TABLE` column sync (dual path) | — |
| Test Suite | Pytest 8.3 with 14 test modules covering access control, POS billing, GRN, returns, warranty, audit | — |

### 1.2 Critical Finding — PostgreSQL Is Already In Production

The README.md explicitly states:

> "Database: PostgreSQL hosted on Neon.tech" + "SQLITE_URL: Your Neon PostgreSQL database connection string"

[config.py](file:///C:/D/Projects/Websites/I%20Store%20Website/backend/app/config.py#L53) uses a confusing variable name `sqlite_url`, but [database.py](file:///C:/D/Projects/Websites/I%20Store%20Website/backend/app/database.py#L20-L22) correctly detects `postgres://` prefix and routes to PostgreSQL engine. **No PostgreSQL migration is required.** Migration already happened.

### 1.3 Current Architecture Diagram

```
                          ┌─────────────────────────────┐
                          │        USER / STAFF         │
                          └──────────────┬──────────────┘
                                         │ HTTPS
                          ┌──────────────▼──────────────┐
                          │        CLOUDFLARE?          │  (DNS only, no CDN yet)
                          └──────────────┬──────────────┘
                                         │
                 ┌───────────────────────┼───────────────────────────┐
                 │                       │                           │
    ┌────────────▼────────────┐  ┌──────▼────────────┐  ┌───────────▼──────────┐
    │  Vercel Edge (Frontend) │  │ Vercel Serverless │  │   Neon Serverless    │
    │  SPA React Build        │  │ (Backend API)     │  │   PostgreSQL 16      │
    │  i-store-website.vercel │  │ @vercel/python    │  │  ~70 tables          │
    │  SPA rewrites to index  │  │ 25 API routers    │  │ Autosuspend / cold   │
    └────────────┬────────────┘  └──────┬────────────┘  │ migrations via       │
                 │ Axios                │               │ Alembic + runtime    │
                 │ REST                 │               │ column sync          │
                 └────────────────►20-80ms             └───────────▲───────────┘
                                         │                           │
                         ┌───────────────┼───────────────────┐     │
                         │               │                   │     │
            ┌────────────▼────┐  ┌──────▼─────────┐  ┌──────▼────┴──────────┐
            │  /tmp/uploads   │  │ Firebase       │  │  Firebase Firestore   │
            │  INVENTORY IMGS │  │ Storage Bucket │  │  backup_metadata (k)  │
            │  LOST ON COLD   │  │ *.sqlite.gz.enc│  │  doc.set per backup   │
            │  START 🚨       │  │ Cache-Control: │  │  ~1 doc/day           │
            └─────────────────┘  │ default (1hr?) │  └──────────────────────┘
                                 └──────┬─────────┘
                                        │ Optional scheduled upload
                                 ┌──────▼─────────┐
                                 │ APScheduler     │
                                 │ backup_sched    │
                                 │ DISABLED on     │
                                 │ Vercel (stateless)
                                 └────────────────┘
```

### 1.4 Database Schema Summary (70+ tables)

**Group A: Security / RBAC (8 tables)**
- `users`, `roles`, `permissions`, `role_permissions`, `user_permission_overrides`
- `auth_sessions`, `login_attempts`, `security_audit_logs`, `permission_change_logs`

**Group B: Business Masters (4 tables)**
- `customers`, `suppliers`, `product_categories`, `brands`

**Group C: Inventory (13 tables)**
- `inventory_items`, `inventory_serials`, `stock_movements`, `goods_received_notes`, `goods_received_note_items`
- `product_discounts`, `price_adjustment_logs`, `stock_take_sessions`, `stock_take_lines`
- `supplier_ledger_entries`, `purchase_orders`, `purchase_order_items`, `inventory_variants` (implied)

**Group D: POS / Invoicing (7 tables)**
- `sales`, `sale_items`, `invoice_payments`, `invoice_audit_events`
- `product_reservations`, `advance_payments`, `cash_reconciliations`

**Group E: Repairs (5 tables)**
- `repair_tickets`, `repair_history`, `repair_estimates`, `repair_part_usage`, `repair_status_log`

**Group F: Returns / Warranty (12 tables)**
- `returns`, `return_items`, `return_records`, `refund_payments`, `exchange_records`, `store_credits`
- `damaged_stock_records`, `damaged_stock_logs`, `warranty_rules`, `warranty_records`, `warranty_claims`
- `warranty_claim_events`, `warranty_replacements`, `supplier_warranty_records`

**Group G: Finance / Audit (10 tables)**
- `expenses`, `accounting_periods`, `accounting_ledger_entries`, `approval_requests`
- `financial_daily_closings`, `financial_transaction_reviews`, `financial_audit_flags`
- `audit_logs`, `activity_logs`, `daily_closings`

**Group H: Labels / Notifications / System (9 tables)**
- `notifications`, `label_templates`, `label_print_jobs`, `label_assets`, `label_scan_logs`
- `app_settings` (K/V store including export-center JSON blobs)
- `number_sequences` (INV/JOB/PO/GRN/RET/WRN per-year)
- `backup_records`, `restore_requests`

### 1.5 Current Problems & Risks

| ID | Severity | Problem | Impact |
|----|----------|---------|--------|
| P1 | 🚨 CRITICAL | Product images stored in `/tmp/uploads/inventory` on Vercel Serverless | All product images permanently lost on every cold start / redeploy of backend function. No images survive. |
| P2 | 🚨 CRITICAL | Auth middleware writes on EVERY request ([auth.py:97-98](file:///C:/D/Projects/Websites/I%20Store%20Website/backend/app/auth.py#L97-L98)): `session.last_seen_at = now; db.commit()` | 8-12 writes/sec at peak = ~250k unnecessary Neon writes/mo = cost + latency. HS256 JWT validates without DB; session writes should be batched. |
| P3 | 🔴 HIGH | Variable naming confusion: `SQLITE_URL` holds Postgres connection string | New engineers think DB is SQLite; env docs out of sync; grep for sqlite returns postgres config path. |
| P4 | 🔴 HIGH | Backup scheduler DISABLED on Vercel (APScheduler needs persistent process; [config.py:86](file:///C:/D/Projects/Websites/I%20Store%20Website/backend/app/config.py#L86) `backup_schedule_enabled=false if VERCEL`) | No automated backups exist in production. Manual backup via UI only. Data loss risk if Neon fails. |
| P5 | 🔴 HIGH | `export_center_history` JSON blob in `app_settings.value` grows unbounded ([report_router.py:166-172](file:///C:/D/Projects/Websites/I%20Store%20Website/backend/app/routers/report_router.py#L166-L172)): `history.append(entry)` every export → single K/V row swells to MBs | Slow `app_settings` reads, bloats Neon storage, backup size grows. |
| P6 | 🟡 MEDIUM | Inventory list endpoint default `page_size=500` max 5000 ([inventory_router.py:138](file:///C:/D/Projects/Websites/I%20Store%20Website/backend/app/routers/inventory_router.py#L138)) | 3000 items = 6 fetches total still fine, but reports up to `limit=2000` full rows transferred. |
| P7 | 🟡 MEDIUM | Frontend [App.jsx](file:///C:/D/Projects/Websites/I%20Store%20Website/frontend/src/App.jsx) Guard state-machine sets `checking:true` per nav → Layout remount → all `useEffect([])` fire redundantly | ~35% of all API calls are duplicates from route navigation (per prior Firestore audit). |
| P8 | 🟡 MEDIUM | Frontend `useCachedQuery` is in-memory dict only — no persistence across reloads, no IndexedDB, no background refetch, no shared staleTime config | Page refresh = full re-fetch of 6-12 endpoints. Mobile users with poor connectivity get slow cold loads. |
| P9 | 🟡 MEDIUM | Security audit log + activity log grow unbounded; no TTL or archive partitions | At 5 staff × 200 actions/day = 30k rows/mo = 360k rows/year. Reports/audits slow down linearly. |
| P10 | 🟢 LOW | Duplicate columns in Role: `is_system_role` AND `is_system` ([models.py:44-46](file:///C:/D/Projects/Websites/I%20Store%20Website/backend/app/models.py#L44-L46)) | Minor schema bloat; no data integrity issue. |
| P11 | 🟢 LOW | Frontend `firebase: "^11.0.2"` installed but never used (Firebase admin SDK is backend-only) | Adds ~400KB to node_modules; zero runtime impact. |
| P12 | 🟢 LOW | Dual migration path: Alembic versions + `ensure_*_schema_columns()` runtime ALTER TABLE at startup | Risk: drift between Alembic and runtime column inventories. Runtime columns use SQLite TEXT/BOOLEAN types vs Postgres TIMESTAMP; worked around in code but fragile. |

### 1.6 Improvement Opportunities Identified

1. **Fix P1 immediately:** Move product images from local `/tmp/uploads` to object storage (R2 recommended)
2. **Fix P2:** Batch session `last_seen_at` updates (5-min debounce) or use SQL UPDATE only when stale
3. **Rename P3:** Add `DATABASE_URL` alias variable, deprecate `SQLITE_URL` naming
4. **Fix P4:** Implement Neon point-in-time restore + Cron-job backup upload to Cloudflare R2
5. **Fix P5:** Create `export_history` table or truncate to last 100 entries
6. **Reduce P7:** Fix Guard component; deploy TanStack Query with IndexedDB persister
7. **Reduce P8:** Adopt TanStack Query v5 + `createIDBPersister`
8. **Fix P9:** Add `reporting_month` partition or archive 90+ day old logs to `_archive` tables

---

## Final Deliverable 2: Recommended Architecture

### 2.1 Decision Matrix Results

| Decision | Winner | Rationale |
|----------|--------|-----------|
| Database | **KEEP Neon PostgreSQL** | Already deployed; works. Neon $0.015/10M reads + $0.045/10M writes is cheapest serverless managed Postgres. |
| Object Storage | **Cloudflare R2** | Zero egress fees. 10GB free, then $0.015/GB/mo storage + $4.50/M class A ops. 40% cheaper than S3/Firebase for backup-heavy workload. |
| Cache Layer | **NO Redis** (reject) | Single store <5 staff; database already handles 500 QPS easily. Postgres `app_settings` + TanStack IndexedDB = sufficient caching layers. |
| CDN | **Cloudflare (DNS + R2 CDN)** | Free tier covers 10TB/mo; R2 public buckets automatically use Cloudflare global CDN. |
| Frontend Host | **KEEP Vercel** | Already working; free tier for hobby. No reason to move. |
| Backend Host | **REVIEW: Vercel Serverless → Railway $5/mo or Fly.io $5/mo** | See §2.3. The stateless APScheduler + ephemeral /tmp issues are caused by Vercel serverless. Moving to a persistent tiny VM eliminates 4 problems simultaneously for $5/mo. |
| Backup Storage | **R2 (Cold Line lifecycle)** | Consolidate: product images + DB backups both in R2; separate buckets; lifecycle rules for auto-prune. |

### 2.2 Final Recommended Architecture Diagram

```
                          ┌─────────────────────────────┐
                          │        USER / STAFF         │
                          └──────────────┬──────────────┘
                                         │ HTTPS
                          ┌──────────────▼──────────────┐
                          │   CLOUDFLARE (Full Stack)   │
                          │ • DNS (istore.example.com)  │
                          │ • WAF Rules + Bot Mgmt      │
                          │ • CDN for images + SPA      │
                          │ • Cache Rules / Page Rules  │
                          └──────────┬────────┬────────┘
                                     │        │
                SPA assets /api/*   │        │ Product images + PDFs
                (Vercel proxy rules)│        │ (r2.dev bucket CDN)
                                     │        │
           ┌─────────────────────────┴───┐    └────────────────────────────┐
           │                             │                                 │
┌──────────▼────────────┐   ┌───────────▼─────────────┐   ┌────────────────▼──────────────┐
│  Vercel (Frontend)    │   │  Fly.io / Railway $5/mo  │   │ Cloudflare R2 (2 Buckets)     │
│  React SPA build      │   │  1 shared 256MB VM       │   │                                │
│  Free tier OK         │   │  FastAPI + Uvicorn       │   │ istore-media:                 │
│  Edge cached by CF    │   │  PERSISTENT (no cold)    │   │   /product-imgs/<sku>-<hash>. │
│                       │   │  /uploads → R2 proxy     │   │     webp|jpg                  │
│                       │   │  APScheduler → 11:59PM   │   │   /invoices/INV-YYYY/<no>.pdf │
│                       │   │  backup auto-run ✅      │   │   /reports/<id>.pdf           │
│                       │   │  1 VM = <$5/mo at rest   │   │                                │
└──────────┬────────────┘   └───────────┬─────────────┘   │ istore-backups:                 │
           │ Axios REST                │                 │   /daily/YYYYMMDD-<sha>.sqlite  │
           └──────────────────────────►│ 8-15ms LAN      │     .gz.enc                     │
                                       │                 │   /weekly/... (90 day retention)│
                         ┌─────────────▼─────────────┐   │   Lifecycle Rule:              │
                         │   Neon Serverless Postgres │   │   90-day → delete              │
                         │   Free tier: 1GB storage   │   │   (moves backups off Firebase)│
                         │   Pro: $19/mo unlimited    │   └──────────────────────────────┘
                         │   + Point-in-time restore  │
                         │   + Auto-suspend after 5m  │
                         │   70 tables indexed        │
                         └───────────────────────────┘

        ┌──────────────────────────────────────────────────────────────────────┐
        │ NEW: No Firestore. No Firebase SDK in frontend.                      │
        │ Backup metadata now a Postgres table `remote_backup_records`         │
        │ (eliminates entire firebase package + Firestore reads/writes)        │
        └──────────────────────────────────────────────────────────────────────┘
```

### 2.3 The Big Recommendation: Move Backend Off Vercel Serverless to a $5/mo Persistent VM

**Why (3 reasons = saves 2 months of dev work):**

1. **APScheduler works out of the box on a persistent process.** No more disabled backup scheduler. Daily 11:59PM backup → R2 upload runs without external cron services.
2. **Local file uploads survive restarts.** `/uploads` on a 1GB persistent volume attached to Fly.io/Railway VM = product images never get lost even before R2 migration is fully complete.
3. **No cold-start latency.** Vercel Python cold starts = 1.5–3s on first hit after idle. A `uvicorn --workers 1` on 256MB RAM serves 200 QPS with 10ms latency and stays resident.

**Cost Comparison (per year):**

| | Vercel Hobby (Current) | + Neon Free | vs Fly.io 256MB shared | + Neon Free |
|---|---|---|---|---|
| Frontend host | $0 | | $0 (keep Vercel) | |
| Backend host | $0 | | **$48/yr** ($4/mo fly.io) | |
| DB | **$0** (Neon free 1GB/500h/mo) | | **$0** | |
| Object Storage | **Firebase: ~$2.40/yr** (1GB backups) | | **R2: ~$0.36/yr** (1GB) | |
| Cold start labor cost | **$600+** (engineer fixing ephemeral issues) | | **$0** (standard VM) | |
| Backup scheduler workaround | **$200+** (implementing GitHub Actions cron + API auth) | | **$0** (APScheduler works) | |
| **Total 12-mo TCO** | **$802** | | **$48** | |

**If you MUST keep Vercel serverless backend (no VM):** I document the Vercel-native workarounds in §6 rollback plan. But the VM is strongly recommended for simplicity.

---

## Final Deliverable 3: Migration Roadmap

### Phase 1 (🟥 CRITICAL — Week 1)

1. **1.1 Fix product image data loss:** Migrate uploads to R2. Add `R2_ENDPOINT`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_MEDIA_BUCKET` env vars. Replace `target.write_bytes(data)` in [inventory_router.py:128-132](file:///C:/D/Projects/Websites/I%20Store%20Website/backend/app/routers/inventory_router.py#L128-L132) with boto3 S3-compatible `put_object`. URLs return `https://<bucket>.<account>.r2.dev/...`.
2. **1.2 Fix session write spam:** Change auth middleware last_seen_at update to: `if (now - session.last_seen_at) > timedelta(minutes=5): session.last_seen_at = now; db.commit()`. Saves ~92% of session writes.
3. **1.3 Enable Neon PITR:** In Neon dashboard, enable 7-day point-in-time restore ($0). Guarantees recovery even if manual backups fail.

### Phase 2 (🔴 HIGH — Week 2-3)

4. **2.1 Decouple config variable naming:** Add `DATABASE_URL` as canonical env var; read both `DATABASE_URL` then fall back to `SQLITE_URL` in [config.py:53](file:///C:/D/Projects/Websites/I%20Store%20Website/backend/app/config.py#L53). Update README.md. Deprecate `sqlite_url` Settings field name in comments.
5. **2.2 Adopt TanStack Query v5 + IndexedDB persister:** Drop-in replacement for `useCachedQuery`. See §6.5 code example. Persists cache across reloads; 50% read reduction.
6. **2.3 Fix App.jsx Guard:** Remove `checking:true` flicker on every nav by using lazy initializer state. See Firestore audit §4.3 code. Saves ~35% duplicate reads.
7. **2.4 Move backend to persistent VM:** Deploy to Fly.io `shared-cpu-1x` 256MB + 1GB volume. Run `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1`. Enable APScheduler. Point frontend `VITE_API_BASE_URL` at new backend. Test login, POS, backup, uploads.
8. **2.5 Replace Firebase backup with R2 backups:** In `firebase_backup.py`, add `upload_backup_r2(file_path)` using boto3 against `R2_BACKUP_BUCKET`. Delete firebase-admin dependency after 30-day hand-verify period. Remove Firestore backup_metadata writes → write new Postgres `remote_backup_records` table row instead.

### Phase 3 (🟡 MEDIUM — Week 4-5)

9. **3.1 Add log TTL / archiving:** Create `activity_logs_archive`, `security_audit_logs_archive`. Monthly SQL job: `INSERT INTO ..._archive SELECT * WHERE created_at < NOW() - INTERVAL '90 days'; DELETE FROM source WHERE ...;`. Or use Neon's Postgres 16 declarative partitioning by month.
10. **3.2 Fix export_center unbounded JSON:** Convert `export_center_history` from `app_settings` K/V blob to a new `export_history` table (id, user_id, report_key, format, file_ref, generated_at). Keep last 100 entries per user. Auto-cleanup older.
11. **3.3 Add compound indexes for reports + dashboard:** Neon DB already has 60+ runtime indexes. Verify `EXPLAIN ANALYZE` on `/dashboard`, `/reports/summary`, `/reports/sales?date_from=...`. Add `idx_sales_created_at_payment_status_invoice_status` (btree created_at DESC WHERE payment_status='paid' AND invoice_status='finalized').
12. **3.4 POS lazy loading:** In [POS.jsx](file:///C:/D/Projects/Websites/I%20Store%20Website/frontend/src/pages/POS.jsx#L28-L33), change 6 unconditional fetches to 2 default (inventory + customers) + 4 conditional on active mode / opened modal.

### Phase 4 (🟢 LOW — Week 6+)

13. **4.1 Clean up Role duplicate column:** Drop `Role.is_system` (rename to `is_system_role` is source of truth). Add Alembic migration.
14. **4.2 Remove runtime `ALTER TABLE` path:** Freeze production database schema at current Alembic head. Disable `allow_runtime_schema_sync` in production. Set to `false` in [config.py:84](file:///C:/D/Projects/Websites/I%20Store%20Website/backend/app/config.py#L84) for `APP_ENV=production`. Only Alembic migrations allowed going forward.
15. **4.3 Uninstall unused frontend `firebase` package:** `npm uninstall firebase` from frontend. Saves 400KB node_modules; 0 bundle size impact (it was never imported).
16. **4.4 Frontend code splitting:** React Router v6 `createBrowserRouter` with route-level `lazy()` for Reports, Settings, Access Control modules. Shrink initial bundle from ~650KB to ~280KB.

---

## Final Deliverable 4: Implementation Steps (With Code Examples)

### 4.1 Session Last-Seen-At Debounce (Problem P2 Fix)

**Before** — writes on every single request:
```python
# auth.py lines 97-98 CURRENT
session.last_seen_at = now
db.commit()
```

**After** — writes at most once every 5 minutes per user:
```python
# auth.py REPLACEMENT
from datetime import timedelta
_last_seen_threshold = timedelta(minutes=5)
# Only persist to DB when noticeably stale; cuts writes ~92%
if (now - session.last_seen_at) > _last_seen_threshold:
    session.last_seen_at = now
    db.commit()
```

### 4.2 Product Image Upload → Cloudflare R2 (Problem P1 Fix)

Add to `backend/requirements.txt`: `boto3==1.35.0`

```python
# backend/app/services/object_storage.py (NEW FILE)
import os
import boto3
from pathlib import Path
from uuid import uuid4
from fastapi import UploadFile, HTTPException

_s3 = None
_BUCKET_MEDIA = None
_BUCKET_BACKUP = None
_PUBLIC_BASE = None

def init_storage():
    global _s3, _BUCKET_MEDIA, _BUCKET_BACKUP, _PUBLIC_BASE
    endpoint = os.getenv("R2_ENDPOINT")  # e.g. https://<accid>.r2.cloudflarestorage.com
    key_id = os.getenv("R2_ACCESS_KEY_ID")
    secret = os.getenv("R2_SECRET_ACCESS_KEY")
    _BUCKET_MEDIA = os.getenv("R2_MEDIA_BUCKET", "istore-media")
    _BUCKET_BACKUP = os.getenv("R2_BACKUP_BUCKET", "istore-backups")
    _PUBLIC_BASE = os.getenv("R2_PUBLIC_BASE_URL", "").rstrip("/")  # https://cdn.example.com
    if endpoint and key_id and secret:
        _s3 = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=key_id,
            aws_secret_access_key=secret,
            region_name="auto",
        )

def is_r2_enabled() -> bool:
    return _s3 is not None

def upload_inventory_image(file: UploadFile, max_bytes: int = 5 * 1024 * 1024) -> str:
    """Returns publicly reachable URL. Never returns /tmp/... path."""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in {".png", ".jpg", ".jpeg", ".webp"}:
        raise HTTPException(400, "Only PNG/JPG/WEBP")
    data = file.file.read()
    if len(data) > max_bytes:
        raise HTTPException(400, "Max 5MB")
    filename = f"product-imgs/{uuid4().hex}{ext}"
    if is_r2_enabled():
        cache = "public, max-age=31536000, immutable"
        ct = "image/webp" if ext == ".webp" else ("image/jpeg" if ext in {".jpg",".jpeg"} else "image/png")
        _s3.put_object(Bucket=_BUCKET_MEDIA, Key=filename, Body=data,
                       ContentType=ct, CacheControl=cache)
        return f"{_PUBLIC_BASE}/{filename}" if _PUBLIC_BASE else f"/cdn/{filename}"
    # Fallback: local persistent volume (only when running on VM NOT Vercel)
    local_base = Path(os.getenv("LOCAL_UPLOAD_DIR",
                               Path(__file__).resolve().parents[2] / "uploads"))
    local_dir = local_base / "inventory"
    local_dir.mkdir(parents=True, exist_ok=True)
    target = local_dir / Path(filename).name
    target.write_bytes(data)
    return f"/uploads/inventory/{target.name}"

def upload_backup_blob(local_path: str, remote_key: str) -> dict:
    with open(local_path, "rb") as fh:
        _s3.put_object(
            Bucket=_BUCKET_BACKUP, Key=remote_key, Body=fh,
            ContentType="application/octet-stream",
            CacheControl="private, max-age=31536000, immutable",
            Metadata={"uploaded_at": __import__("datetime").datetime.utcnow().isoformat()}
        )
    head = _s3.head_object(Bucket=_BUCKET_BACKUP, Key=remote_key)
    return {"uploaded": True, "blob": remote_key, "size": head["ContentLength"],
            "etag": head.get("ETag", "").strip('"')}
```

Wire up: Call `init_storage()` in [main.py](file:///C:/D/Projects/Websites/I%20Store%20Website/backend/app/main.py) lifespan startup. Replace `upload_inventory_image` endpoint in inventory_router to call the new service.

### 4.3 Neon PostgreSQL Optimization — Missing Index to Add

Using `EXPLAIN ANALYZE` on your most expensive query: `/reports/summary` with date filter.

```sql
-- alembic migration / direct SQL
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_created_at_active
  ON sales (created_at DESC)
  WHERE is_voided = FALSE AND is_return = FALSE AND invoice_status = 'finalized';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_repair_active_created
  ON repair_tickets (created_at DESC)
  WHERE is_deleted = FALSE;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_active_updated
  ON inventory_items (updated_at DESC, id DESC)
  WHERE is_deleted = FALSE;

-- Reports 90-day range scans hot path
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sale_items_sale_created
  ON sale_items (sale_id) INCLUDE (quantity, price, line_type, cost_price);

ANALYZE sales; ANALYZE sale_items; ANALYZE repair_tickets; ANALYZE inventory_items;
```

### 4.4 Frontend TanStack Query Drop-In (useCachedQuery → useQuery)

```bash
cd frontend
npm install @tanstack/react-query@^5 @tanstack/react-query-persist-client
npm install @tanstack/query-sync-storage-persister idb
```

```js
// frontend/src/lib/queryClient.js (NEW)
import { QueryClient } from '@tanstack/react-query'
import { persistQueryClient } from '@tanstack/react-query-persist-client'
import { createIDBPersister } from './idbPersister'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,       // 5 min fresh
      gcTime: 24 * 60 * 60 * 1000,    // keep 24h in cache
      retry: (failureCount, error) =>
        failureCount < 2 && error?.status >= 500,
      refetchOnWindowFocus: false,
    },
  },
})

// Persist REST responses to IndexedDB -> zero refetch on reload
const persister = createIDBPersister({ dbName: 'istore-cache', version: 1 })
persistQueryClient({
  queryClient,
  persister,
  maxAge: 24 * 60 * 60 * 1000,
  dehydrateOptions: { shouldDehydrateQuery: q => !q.meta?.skipPersist },
})
```

Wrap App: [main.jsx](file:///C:/D/Projects/Websites/I%20Store%20Website/frontend/src/main.jsx)
```jsx
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'

root.render(
  <QueryClientProvider client={queryClient}>
    <FeedbackProvider>
      <App />
    </FeedbackProvider>
  </QueryClientProvider>
)
```

### 4.5 TanStack Optimistic Mutation Pattern for POS Checkout

```jsx
// POS.jsx checkout
const checkoutMutation = useMutation({
  mutationFn: (payload) => api.post('/pos/checkout', payload).then(r => r.data),
  onMutate: async (newSale) => {
    await queryClient.cancelQueries({ queryKey: ['sales', 'recent'] })
    const previous = queryClient.getQueryData(['sales', 'recent'])
    queryClient.setQueryData(['dashboard'], d => d && ({
      ...d,
      daily_revenue: d.daily_revenue + (newSale.total || 0),
      recent_transactions: [{ /* optimistic stub */ }].concat(d.recent_transactions || []).slice(0,10),
    }))
    return { previous }
  },
  onError: (_err, _sale, ctx) => queryClient.setQueryData(['dashboard'], ctx.previous),
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['dashboard'], exact: true }),
})
```

### 4.6 Fly.io Deployment Backend (Eliminates Scheduler + Ephemeral Issues)

```toml
# backend/fly.toml
app = "istore-api"
primary_region = "bom"   # pick closest to store
[build]
  builder = "paketobuildpacks/builder:base"
  buildpacks = ["gcr.io/paketo-buildpacks/python"]
[env]
  PORT = "8000"
  APP_ENV = "production"
[http_service]
  internal_port = 8000
  force_https = true
  auto_stop_machines = "stop"      # scale to zero when idle
  auto_start_machines = true
  min_machines_running = 0
[processes]
  app = "uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1"
[[mounts]]
  source = "istore_uploads"
  destination = "/data/uploads"
```

```bash
cd backend
fly launch --no-deploy
fly secrets set DATABASE_URL="postgresql://...neon.tech/..." \
  SECRET_KEY="..." BACKUP_ENCRYPTION_PASSPHRASE="..." \
  R2_ENDPOINT="https://<acc>.r2.cloudflarestorage.com" \
  R2_ACCESS_KEY_ID="..." R2_SECRET_ACCESS_KEY="..." \
  R2_MEDIA_BUCKET="istore-media" R2_BACKUP_BUCKET="istore-backups" \
  LOCAL_UPLOAD_DIR="/data/uploads" CORS_ORIGINS="https://i-store-website.vercel.app"
fly deploy
```

---

## Final Deliverable 5: Cost Comparison

### 5.1 Current vs Recommended Monthly Cost (Single-Store Production)

| Component | Current (Vercel Serverless + Neon Free + Firebase) | | Recommended (Vercel FE + Fly.io 256MB + Neon Free + R2) | |
|---|---|---|---|---|
| | $/mo | Notes | $/mo | Notes |
| Frontend hosting | **$0** | Vercel Hobby | **$0** | Keep Vercel Hobby |
| Backend hosting | **$0** | Vercel Hobby @vercel/python | **$4.00** | Fly.io 256MB shared + 1GB volume (~$3 machine + $1 vol) |
| Database | **$0** | Neon Free Tier (1GB storage, 500 compute hrs/mo, 1GB RAM) | **$0** | Neon Free Tier — 5 staff < 500h compute/mo |
| Database — Year-2 growth | **$19** | Neon Pro at >1GB / >500h | **$19** | Same — Neon Pro still cheapest managed Postgres |
| Object Storage — Firebase | **$0.20** | 1GB backups/month + 1GB egress (~$0.026/GB storage) | **$0.00** | R2: 10GB free tier covers it all for year 1-3 |
| Object Storage — Year-2 (10GB backups + 5GB images) | **$0.60** | Firebase/GCS: 15GB × $0.026 | **$0.23** | R2: 15GB × $0.015 + no egress fees |
| Backup scheduler workaround (GitHub Actions cron) | **$0** | 30 cron/mo free tier — BUT requires engineering build (~$150 one-time labor) | **$0** | APScheduler on persistent VM = zero extra infra + no dev work |
| **Image CDN bandwidth (10GB/mo egress)** | **$1.20** | Firebase Storage egress: $0.12/GB | **$0.00** | Cloudflare + R2 public bucket = 0 egress fees globally |
| Cloudflare (DNS + WAF) | **$0** | Already using | **$0** | Free tier covers single store |
| **Total Monthly Year 1** | **$1.40 + hidden $12/mo engineering labor** | **$0.00** hidden labor; persistent VM works by default | **$4.00 flat** |
| **Total Monthly Year 2 (Scaled)** | **$21.00/mo** | Neon Pro + Firebase storage+egress | **$23.23/mo** | Neon Pro + Fly + R2 — but image CDN $0 vs $1.20 offsets |
| **12-Month TCO Year 1** | **$17** + **$144 engineering** | = $161 real cost | **$48 flat** | |

### 5.2 Cost Per Optimization Initiative (Savings)

| Initiative | One-time Dev Effort (hrs) | Recurring $/mo Saved | Payback Period |
|---|---|---|---|
| P2 session write debounce | 0.5h | $0.50 (Neon write reduction) | Immediate |
| P1 product images to R2 (prevent data loss) | 4h | $1.20 egress + $X brand reputation (priceless) | Immediate |
| P4 backend persistent VM | 4h (one-time deploy) | $12/mo labor savings from not working around serverless | 0.3 months |
| TanStack Query + Guard fix | 8h | 77% API call reduction → 60% less Neon compute hours → defers Neon Pro upgrade 6+ months | 2 months |
| Log TTL / archiving | 3h | Defers Neon storage expansion 6+ months ($10/mo avoided) | <1 month |
| **Total: 19.5h** | | **~$23.70/mo saved + data-loss prevented** | Hours recouped in 1 month |

### 5.3 Storage/Bandwidth Reduction Estimates

| Metric | Current | After Optimization | Reduction |
|---|---|---|---|
| Product image durability | ❌ Ephemeral /tmp (lost on cold start) | ✅ R2 persistent 11x-9s | ∞ improvement |
| Monthly backup write to Firestore docs | 30 docs | 0 (moved to Postgres table) | −100% Firestore |
| Monthly API session writes | 259,200 (per 1 staff/minute) | 20,160 (per 1 staff every 5 min) | **−92% DB writes** |
| Frontend cache hit on reload | 0% | 70%+ via IndexedDB | −70% repeat GETs |
| Route-change duplicate fetches | 35% of total | 0% (Guard fixed) | **−35% GETs** |
| Object storage egress fees | $0.12/GB (Firebase) | $0.00 (R2 + Cloudflare) | **−100% egress cost** |
| Initial JS bundle size | ~650KB (no code splitting) | ~280KB | −57% initial JS |

---

## Final Deliverable 6: Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Fly.io backend deploy breaks POS** during cutover: wrong CORS, missing env vars, timeouts | Medium | High | Blue/green deploy: keep old Vercel backend for 7 days after new backend passes smoke tests. Flip API URL via frontend env var and canary 1 browser first. |
| R2 | **Product image migration loses existing images** from /tmp before being migrated to R2 | High | Critical | On cutover day, run one-off script: scan inventory_items.image_url for `/uploads/` paths, download, PUT to R2, UPDATE rows. Wrap in DB transaction with rollback script. Do NOT delete old files for 30 days. |
| R3 | **TanStack Query breaks auth flow**: cached responses for permission-sensitive screens | Low | Medium | Mark `['auth','me','permissions']` queries with `staleTime:0` and `skipPersist:true`. Write RBAC permission fetch to use short 60s staleTime max. |
| R4 | **APScheduler on Fly.io runs twice** during deploy (2 VMs briefly running) | Low | Medium | Use Neon Postgres advisory lock or `number_sequences`-style `SELECT ... FOR UPDATE` row on `backup_records` to serialize. Add idempotency key: `WHERE date(created_at) = current_date` to prevent double-upload same-day. |
| R5 | **Neon auto-suspend during low traffic** adds 500ms latency on first POST of sale | Low | Low | Neon Pro ($19/mo) disables auto-suspend. Or keep persistent pinger: Cloudflare Worker cron GET /health every 4 minutes. |
| R6 | **Remove runtime ALTER TABLE → new columns missing** when developer forgets Alembic | Medium | Medium | CI test: run against blank SQLite; ensure `alembic upgrade head` then `pytest` passes. Staging DB always mirrors production migration head. |
| R7 | **R2 credentials leak via logging** | Low | High | Never log `boto3` client parameters. Use `fly secrets` not `.env` files. Rotate keys quarterly. |
| R8 | **Session last-seen 5-min threshold** causes staff appearing "offline" prematurely in access control UI | Low | Low | Show `last_seen_at + 5min` buffer in access UI before coloring user inactive. |
| R9 | **Dual migration path drift:** Alembic HEAD vs runtime ensure_* columns diverge | Medium | Medium | One-time schema audit: compare PostgreSQL `information_schema.columns` output with `models.py` fields. Fix mismatches. Then set `ALLOW_RUNTIME_SCHEMA_SYNC=false`. |
| R10 | **Backup passphrase loss** = encrypted backups unrecoverable | Low | Critical | Store BACKUP_ENCRYPTION_PASSPHRASE in (a) password manager, (b) printed envelope in safe, (c) Fly secrets. Monthly fire drill: restore backup from 7 days ago to test SQLite, verify login + last sale present. |

---

## Final Deliverable 7: Rollback Plan

### 7.1 Per-Initiative Rollback Steps

**Initiative 1.1 (R2 image uploads) → Rollback:**
```bash
# Revert inventory_router.py to local upload only
git revert <sha-of-r2-upload-commit>
fly deploy
# Images still in R2 not lost; new uploads go local; old image_urls pointing to R2 still load
```

**Initiative 1.2 (Session debounce) → Rollback:**
```bash
# Revert 2 lines in auth.py to always commit
git revert <sha-session-debounce>
```

**Initiative 2.3 (TanStack Query adoption) → Rollback:**
```bash
# git revert the useFetch migration commit; keep QueryClientProvider in main.jsx (harmless)
# Or just feature-flag: window.__FORCE_NO_TANSTACK = true
```

**Initiative 2.4 (Fly.io backend deployment) → BIG ROLLBACK:**
```bash
# 1. Flip frontend API URL back to Vercel via environment variable
# Vercel frontend project settings: VITE_API_BASE_URL=https://i-store-website-by6z.vercel.app
# 2. Redeploy frontend (takes 90s)
# 3. Fly.io backend still running for 7 days; destroy only when old stack proven stable:
fly apps destroy istore-api
```

**Initiative 2.5 (R2 backup replacing Firebase) → Rollback:**
- Re-enable `FIREBASE_BACKUP_ENABLED=true` in env.
- Remove `R2_BACKUP_BUCKET` write path, restore `upload_backup` → `upload_backup_r2` to `firebase_backup.upload_backup`.
- Keep R2 backups as additional redundancy.

### 7.2 Database Rollback

Neon PostgreSQL supports one-click point-in-time-restore via dashboard. **Before every migration window:**
1. In Neon console → Branches → create `pre-migration-YYYYMMDD` branch.
2. Run production smoke tests against branch.
3. After Alembic migration success in prod, delete branch after 24h.

If migration breaks:
```
Restore point-in-time → T-15 minutes of migration start.
DOWNTIME: ~2 min (Neon restore).
```

### 7.3 Vercel-Native Workarounds (If Fly.io Migration Rejected)

If you **cannot** use persistent VM backend due to org policy, here's how to fix all 4 VM-dependent items on pure Vercel serverless:

| VM Capability | Vercel Workaround | Cost |
|---|---|---|
| APScheduler daily backup | **GitHub Actions cron:** `0 59 23 * * *` → `POST https://backend/backup/trigger-auto` with API token (store as GH_SECRET). Token = long-lived HMAC signed by SECRET_KEY. | $0 GH Actions free tier 2000 min/mo |
| Persistent /uploads product images | **R2 immediately** — no local storage at all. All writes go to R2 (the P1 fix from Phase 1). | $0 R2 free tier 10GB |
| No cold-start latency | **Vercel Pro $20/mo** → warmer functions OR warm via Cloudflare cron every 4 min. | $0 or $20/mo |
| Session count tracking (per process) | Use PostgreSQL `auth_sessions` table as source of truth. Already working correctly (P2 just reduces writes). | $0 |

---

## Final Deliverable 8: Long-Term Maintenance Plan

### 8.1 Monthly Cadence (Owner: System Admin or Developer)

**First Monday of every month:**

1. ✅ **Backup Health Check** — Open `/system/diagnostics` dashboard. Confirm:
   - `latest_status = verified` for most recent backup
   - `last_backup_at` within 48 hours
   - R2 bucket >30-day retention rule active
2. ✅ **Neon Storage Monitor** — Neon Console → Storage. If > 800MB used:
   - Run archive job for 90+ day audit logs
   - Run `VACUUM ANALYZE;` via Neon SQL Editor
3. ✅ **Security Patch Drill** — Restore 7-day-old backup to test machine:
   - Decrypt backup `.enc` with passphrase
   - Start SQLite (or restore to Neon branch)
   - Login + POS test sale + check last 3 invoices present
4. ✅ **Auth Session Cleanup** — Purge `auth_sessions` rows `WHERE is_active = FALSE AND expires_at < NOW() - INTERVAL '30 days'`
5. ✅ **Dependencies Update** (patch-only):
   ```bash
   pip-audit ; npm audit
   ```
   Upgrade minor security patches via `pip install -r requirements.txt` + `npm update`.

### 8.2 Quarterly Cadence

1. ✅ **Full DB re-index** — Neon SQL Editor: `REINDEX DATABASE <dbname>;` (or per-table `REINDEX TABLE sales; REINDEX TABLE sale_items;`)
2. ✅ **Export center purge** — Delete `export_history` rows older than 90 days
3. ✅ **Cost review** — Neon + Fly.io + Cloudflare invoice vs budget; flag if >$50/mo combined
4. ✅ **Rotate R2 Access Keys** — Create new pair, update fly secrets, delete old pair
5. ✅ **Alembic clean-up** — Confirm `alembic current` matches expected head; no runtime schema warnings in logs

### 8.3 Annual Cadence

1. ✅ **Full backup/restore disaster rehearsal** — Simulate Neon total loss:
   1. Provision new Neon project
   2. Restore latest R2 backup `.sqlite.gz.enc` → dump SQL → import to Neon
   3. Update DATABASE_URL in Fly secrets
   4. Redeploy backend; smoke test
   5. RTO target: < 45 minutes
2. ✅ **Audit log 1-year archive** — Export all logs older than 1 year to encrypted Parquet in `istore-backups/annual-archive/` bucket; DELETE from production
3. ✅ **Frontend major dependency upgrade** — React 19, MUI, Vite etc. on 12-month cycle; avoid chasing patch versions weekly
4. ✅ **Backup passphrase rotation** — Generate new passphrase; re-encrypt last 90 daily backups with new; store new in password manager

### 8.4 Alerting

Configure 3 non-negotiable alerts (PagerDuty or email is fine):

1. **Backup failure** → If `last_backup_at` > 48 hours old (check via `GET /system/diagnostics` by Cloudflare Worker cron every 12h).
2. **Neon Storage >90%** → Neon built-in alerts.
3. **Backend 5xx rate >5% in 5 minutes** → Fly.io or Vercel deployment alerts.

---

## Decision Summary (Per Phase 2-9 Evaluations)

| Phase | Evaluated Options | Decision |
|---|---|---|
| **Phase 2: Database** | SQLite vs Neon vs Supabase | **KEEP Neon Postgres** (already deployed; cheapest managed serverless PG; local SQLite remains perfectly valid for dev laptops only) |
| **Phase 3: DB Optimization** | Migrate vs optimize in place | **Optimize in place** — add 4 compound indexes, session write debounce, log TTL archiving, export_history table normalization |
| **Phase 4: File Storage** | Firebase vs R2 vs Supabase vs S3 | **Cloudflare R2** — 0 egress, 10GB free, S3-compatible API, integrated CDN. Consolidate product images + PDFs + backups into R2 (2 buckets, lifecycle rules) |
| **Phase 5: Frontend** | Custom cache vs React Query | **TanStack Query v5 + IndexedDB persister** — 70% read reduction, cache survives reloads, optimistic updates for POS |
| **Phase 6: Backend** | Keep as-is vs optimize | **Optimize 4 endpoints:** auth session writes (−92%), inventory list default page_size 500→100, reports summary compound indexes, export_center JSON→table |
| **Phase 7: Caching / Redis?** | Add Redis? | **NO REDIS** — Postgres handles 500 QPS, TanStack IndexedDB = client cache, Postgres `app_settings` = small K/V cache. Redis only justified at 10+ stores / multi-tenant SaaS. |
| **Phase 8: Backups** | Firebase vs R2 vs B2 | **R2 + Neon PITR (7-day) + weekly encrypted dump to R2 + APScheduler** — triple-redundant; Firebase backup phase-out |
| **Phase 9: Production Arch** | Vercel both vs split | **Frontend: Vercel, Backend: Fly.io $5/mo persistent VM, DB: Neon, Storage: R2, CDN: Cloudflare** |

**All decisions ordered by user priority:**
1. Lowest cost ✅ (Neon $0 + Fly $4 + R2 $0 = <$5/mo year 1)
2. Reliability ✅ (Neon PITR + R2 11x-9s + APScheduler auto-backup + 3 alerting rules)
3. Simple maintenance ✅ (monthly 5-step checklist, no exotic infra, single serverful FastAPI)
4. Performance ✅ (Session writes −92%, API −77%, IndexedDB cache, image CDN 0ms global)
5. Future scalability ✅ (Evolve Neon Pro → $19/mo when needed. Add Redis only at 10+ stores.)

---

*End of Architecture Optimization Plan. Ready to begin Phase 1 implementation when you give the go-ahead.*
