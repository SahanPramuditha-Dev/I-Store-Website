import json
import importlib
import logging
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request, Depends, HTTPException
from fastapi.exceptions import RequestValidationError
from app.database import SessionLocal, get_db
from fastapi.responses import Response, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.core.limiter import limiter
from sqlalchemy import text
from sqlalchemy import inspect as sa_inspect
from app.database import Base, engine
import app.models  # noqa: F401  # ensure model metadata is registered
from app.routers.auth_router import router as auth_router
from app.routers.dashboard_router import router as dashboard_router
from app.routers.repair_router import router as repair_router
from app.routers.inventory_router import router as inventory_router
from app.routers.pos_router import router as pos_router
from app.routers.analytics_ai_router import router as analytics_ai_router
from app.routers.ai_router import router as ai_router
from app.routers.invoices_router import router as invoices_router
from app.routers.payments_router import router as payments_router
from app.routers.customer_router import router as customer_router
from app.routers.report_router import router as report_router
from app.routers.backup_router import router as backup_router
from app.routers.settings_router import router as settings_router
from app.routers.purchase_router import router as purchase_router
from app.routers.expenses_router import router as expenses_router
from app.routers.search_router import router as search_router
from app.routers.ledger_router import router as ledger_router
from app.routers.notification_router import router as notification_router
from app.routers.returns_router import router as returns_router
from app.routers.warranty_router import router as warranty_router
from app.routers.financial_audit_router import router as financial_audit_router
from app.routers.labels_router import router as labels_router
from app.routers.audit_trail_router import router as audit_trail_router
from app.routers.advance_router import router as advance_router
from app.routers.access_router import router as access_router
from app.routers.print_center_router import router as print_center_router
from app.routers.catalog_router import router as catalog_router
from app.config import settings
from app.auth import require_admin, require_module_access, require_permission

from app.utils.api_errors import (
    ApiError,
    ERROR_INTERNAL_SERVER_ERROR,
    map_http_error_code,
)
from app.services.security_service import (
    ensure_development_test_admin,
    get_request_device_info,
    get_request_ip,
    record_security_audit,
)
BACKUP_SCHEDULER_AVAILABLE = True
try:
    from app.services.backup_scheduler import init_backup_scheduler, shutdown_backup_scheduler
except Exception:
    BACKUP_SCHEDULER_AVAILABLE = False
    # Scheduler is optional in local/dev when apscheduler is not installed.
    def init_backup_scheduler():
        return None

    def shutdown_backup_scheduler():
        return None

_log_handlers: list[logging.Handler] = [logging.StreamHandler()]
if os.getenv("PYTEST_CURRENT_TEST") is None and not os.getenv("VERCEL"):
    _log_handlers.append(logging.FileHandler(os.getenv("ISTORE_BACKEND_LOG_FILE", "backend.log"), encoding="utf-8", delay=True))
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=_log_handlers,
    force=True,
)
logger = logging.getLogger("istore.api")


def _run_startup_tasks() -> None:
    try:
        from app.services.backup_service import recover_database_from_latest_valid_backup

        recovery_result = recover_database_from_latest_valid_backup()
        if recovery_result:
            logger.warning(
                f"Database recovered from valid backup: {recovery_result.get('restored')}"
            )

        if settings.auto_migrate_enabled:
            # Import migrate lazily to avoid import-time errors when running
            # in development environments where a local `alembic` folder may
            # shadow the installed alembic package.
            try:
                from app.migrations import migrate_with_rollback
            except Exception:
                migrate_with_rollback = None
            migrate_allowed = True
            if settings.backup_before_migrate:
                from app.services.backup_service import create_backup

                try:
                    with SessionLocal() as db:
                        create_backup(db, is_auto=False, trigger="pre-migration")
                    logger.info("Pre-migration backup completed successfully.")
                except Exception as backup_error:
                    migrate_allowed = False
                    logger.error(f"Pre-migration backup failed; migration skipped for safety: {backup_error}")
            if migrate_allowed and migrate_with_rollback:
                try:
                    result = migrate_with_rollback()
                    if result.get("status") == "rolled_back":
                        logger.error(f"Alembic migration failed and was rolled back: {result.get('reason')}")
                    else:
                        logger.info("Alembic migration completed.")
                except Exception as migration_error:
                    logger.error(f"Alembic migration failed: {migration_error}")

        try:
            Base.metadata.create_all(bind=engine)
            try:
                from sync_schema import sync_schema
                from app.config import DB_FILE
                sync_schema(DB_FILE)
            except Exception as sync_err:
                logger.warning(f"Automatic schema column sync warning: {sync_err}")



            from app.services.warranty_service import ensure_warranty_defaults
            from app.services.labels_service import ensure_label_defaults
            from app.services.security_service import ensure_security_defaults
            with SessionLocal() as _db:
                ensure_warranty_defaults(_db)
                ensure_label_defaults(_db)

            with SessionLocal() as _db:
                ensure_security_defaults(_db)
                ensure_development_test_admin(_db)
        except Exception as db_init_error:
            logger.error(f"Database sync/initialization failed during startup: {db_init_error}")

        # Initialize backup scheduler
        init_backup_scheduler()
        if not BACKUP_SCHEDULER_AVAILABLE:
            logger.warning("Backup scheduler disabled (missing optional dependency: apscheduler).")

        logger.info("Application startup complete.")
    except Exception as e:
        logger.error(f"Startup failed: {e}")
        import traceback
        logger.error(traceback.format_exc())
        # Keep API alive even if a non-critical startup step fails.
        # This prevents full process crash loops in local/dev.
        logger.warning("Continuing startup in degraded mode.")


def _run_shutdown_tasks() -> None:
    try:
        shutdown_backup_scheduler()
        from app.services.backup_service import perform_database_maintenance
        perform_database_maintenance()
        logger.info("Application shutdown complete.")
    except Exception as e:
        import traceback
        logger.error(f"Shutdown error: {e}")
        logger.error(traceback.format_exc())
        logger.warning("Shutdown completed with errors.")


@asynccontextmanager
async def app_lifespan(_app: FastAPI):
    _run_startup_tasks()
    try:
        yield
    finally:
        _run_shutdown_tasks()


app = FastAPI(title="i Store API", lifespan=app_lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
from app.database import UPLOADS_DIR  # noqa: E402 - centralized path
FAVICON_PATH = Path(__file__).resolve().parents[2] / "frontend" / "public" / "favicon.ico"
DEV_CORS_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1):\d+$" if settings.env.lower() != "production" else None


def _is_allowed_cors_origin(origin: str | None) -> bool:
    if not origin:
        return False
    if origin in set(settings.cors_origins):
        return True
    if DEV_CORS_ORIGIN_REGEX and re.match(DEV_CORS_ORIGIN_REGEX, origin):
        return True
    return False


def _cors_error_headers(request: Request) -> dict[str, str]:
    origin = request.headers.get("origin")
    if not _is_allowed_cors_origin(origin):
        return {}
    return {
        "Access-Control-Allow-Origin": str(origin),
        "Access-Control-Allow-Credentials": "true",
    }


def _safe_user_id(user) -> int | None:
    if user is None:
        return None
    # Read from instance dict first to avoid detached-instance attribute loads.
    user_id = getattr(user, "__dict__", {}).get("id")
    if user_id is not None:
        return int(user_id)
    try:
        identity = sa_inspect(user).identity
        if identity and identity[0] is not None:
            return int(identity[0])
    except Exception:
        return None
    return None


def _safe_request_log(message: str) -> None:
    """
    Avoid crashing request flow when stdout pipe is detached (WinError 233),
    which can happen if the backend launcher console is closed.
    """
    try:
        print(message)
    except OSError:
        logger.info(message)


def _sqlite_table_exists(db, table_name: str) -> bool:
    try:
        inspector = sa_inspect(db.bind)
        return inspector.has_table(table_name)
    except Exception:
        try:
            db.execute(text(f"SELECT 1 FROM {table_name} LIMIT 1"))
            return True
        except Exception:
            return False


        db.execute(text("CREATE INDEX IF NOT EXISTS idx_security_audit_logs_action ON security_audit_logs (action)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_security_audit_logs_target_type ON security_audit_logs (target_type)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_security_audit_logs_user_id ON security_audit_logs (user_id)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales (created_at)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_sales_customer_id ON sales (customer_id)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_sales_repair_ticket_id ON sales (repair_ticket_id)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_sales_reservation_id ON sales (reservation_id)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_sales_invoice_type ON sales (invoice_type)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_sales_invoice_status ON sales (invoice_status)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_sales_customer_created_at ON sales (customer_id, created_at)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_sales_is_return_created_at ON sales (is_return, created_at)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_sales_payment_status_created_at ON sales (payment_status, created_at)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_sale_items_line_type ON sale_items (line_type)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_invoice_payments_payment_number ON invoice_payments (payment_number)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_invoice_payments_reference_number ON invoice_payments (reference_number)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_invoice_audit_events_invoice_id ON invoice_audit_events (invoice_id)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_invoice_audit_events_created_at ON invoice_audit_events (created_at)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_repair_tickets_status ON repair_tickets (status)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_repair_tickets_customer_id ON repair_tickets (customer_id)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_repair_tickets_imei ON repair_tickets (imei)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_repair_tickets_status_created_at ON repair_tickets (status, created_at)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_repair_tickets_customer_created_at ON repair_tickets (customer_id, created_at)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_inventory_items_barcode ON inventory_items (barcode)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_inventory_items_sku ON inventory_items (sku)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements (created_at)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_activity_logs_module_action_created_at ON activity_logs (entity_type, action, created_at)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses (expense_date)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses (status)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_goods_received_notes_is_cancelled ON goods_received_notes (is_cancelled)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_goods_received_notes_cancelled_at ON goods_received_notes (cancelled_at)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_warranty_rules_rule_type_priority ON warranty_rules (rule_type, priority)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_warranty_records_status_end_date ON warranty_records (status, end_date)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_warranty_records_invoice_item_id ON warranty_records (invoice_item_id)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_warranty_records_warranty_number ON warranty_records (warranty_number)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_warranty_claims_decision_status ON warranty_claims (decision_status)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_warranty_claims_claim_number ON warranty_claims (claim_number)"))

        db.execute(text("""
            CREATE TABLE IF NOT EXISTS stolen_device_blacklists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                imei VARCHAR UNIQUE NOT NULL,
                device_model VARCHAR,
                reason VARCHAR,
                reported_by VARCHAR,
                created_at DATETIME
            )
        """))
        try:
            db.execute(text("ALTER TABLE inventory_serials ADD COLUMN imei2 VARCHAR"))
        except Exception:
            pass
        try:
            db.execute(text("ALTER TABLE repair_tickets ADD COLUMN imei2 VARCHAR"))
        except Exception:
            pass
        try:
            db.execute(text("ALTER TABLE warranty_records ADD COLUMN imei2 VARCHAR"))
        except Exception:
            pass
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_inventory_serials_imei2 ON inventory_serials (imei2)"))

        db.commit()


def ensure_tables_exist() -> None:
    """
    Ensure newly introduced ORM tables exist for local/dev SQLite databases.
    Safe to call repeatedly.
    """
    from app.database import engine as current_engine
    if "users" not in Base.metadata.tables:
        import app.models as models_module
        importlib.reload(models_module)
    Base.metadata.create_all(bind=current_engine)


def ensure_security_schema_columns() -> None:
    """
    Runtime migration for auth/rbac columns on existing deployments.
    """
    required_user_columns = {
        "role_id": "INTEGER",
        "pin_hash": "TEXT",
        "phone_number": "TEXT",
        "email": "TEXT",
        "profile_photo": "TEXT",
        "notes": "TEXT",
        "failed_login_count": "INTEGER DEFAULT 0",
        "account_locked_until": "DATETIME",
        "last_login_at": "DATETIME",
        "last_password_change_at": "DATETIME",
        "is_deleted": "BOOLEAN DEFAULT 0",
        "deleted_at": "DATETIME",
        "created_at": "DATETIME",
        "updated_at": "DATETIME",
    }
    with SessionLocal() as db:
        if not _sqlite_table_exists(db, "users"):
            return
        try:
            inspector = sa_inspect(db.bind)
            existing = {col["name"] for col in inspector.get_columns("users")}
        except Exception:
            existing = set()
        for column, col_type in required_user_columns.items():
            if column not in existing:
                type_str = col_type
                is_postgres = db.bind.dialect.name == "postgresql"
                if is_postgres:
                    if "DATETIME" in col_type.upper():
                        type_str = type_str.upper().replace("DATETIME", "TIMESTAMP")
                    if "BOOLEAN DEFAULT 1" in col_type.upper():
                        type_str = type_str.upper().replace("BOOLEAN DEFAULT 1", "BOOLEAN DEFAULT TRUE")
                    if "BOOLEAN DEFAULT 0" in col_type.upper():
                        type_str = type_str.upper().replace("BOOLEAN DEFAULT 0", "BOOLEAN DEFAULT FALSE")
                db.execute(text(f"ALTER TABLE users ADD COLUMN {column} {type_str}"))
        db.commit()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=DEV_CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Request-ID"],
    expose_headers=["Content-Disposition", "Content-Type", "X-Total-Count"]
)

app.include_router(auth_router)
app.include_router(dashboard_router, dependencies=[Depends(require_module_access("dashboard"))])
app.include_router(repair_router, dependencies=[Depends(require_module_access("repairs"))])
app.include_router(inventory_router, dependencies=[Depends(require_module_access("inventory"))])
app.include_router(pos_router, dependencies=[Depends(require_module_access("pos"))])
app.include_router(invoices_router, dependencies=[Depends(require_module_access("pos"))])
app.include_router(payments_router, dependencies=[Depends(require_module_access("pos"))])
app.include_router(customer_router, dependencies=[Depends(require_module_access("customers"))])
app.include_router(report_router, dependencies=[Depends(require_module_access("reports"))])
app.include_router(backup_router, dependencies=[Depends(require_module_access("backup"))])
app.include_router(settings_router, dependencies=[Depends(require_module_access("settings"))])
app.include_router(purchase_router, dependencies=[Depends(require_module_access("suppliers"))])
app.include_router(expenses_router, dependencies=[Depends(require_module_access("expenses"))])
app.include_router(search_router, dependencies=[Depends(require_module_access("search"))])
app.include_router(ledger_router, dependencies=[Depends(require_module_access("financial_audit"))])
app.include_router(notification_router, dependencies=[Depends(require_module_access("notifications"))])
app.include_router(returns_router, dependencies=[Depends(require_module_access("returns"))])
app.include_router(warranty_router, dependencies=[Depends(require_module_access("warranty"))])
app.include_router(financial_audit_router, dependencies=[Depends(require_module_access("financial_audit"))])
app.include_router(labels_router, dependencies=[Depends(require_module_access("labels"))])
app.include_router(audit_trail_router, dependencies=[Depends(require_module_access("audit_logs"))])
from app.routers.analytics_ai_router import router as analytics_ai_router

app.include_router(catalog_router, dependencies=[Depends(require_module_access("inventory"))])
app.include_router(advance_router)
app.include_router(access_router)
app.include_router(print_center_router)
app.include_router(analytics_ai_router)
app.include_router(ai_router)
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")


def _write_module_audit_log(request: Request, status_code: int, elapsed_ms: float) -> None:
    module = getattr(request.state, "audit_module", None)
    action = getattr(request.state, "audit_action", None)
    if not module or not action:
        return
    method = str(request.method or "").upper()
    path = str(request.url.path or "")
    status = int(status_code)
    is_successful_read = (
        (method in {"GET", "HEAD"})
        and (200 <= status < 400)
        and not path.startswith("/auth/")
    )
    if is_successful_read:
        return
    user_id = (
        getattr(request.state, "audit_user_id", None)
        or getattr(request.state, "current_user_id", None)
        or _safe_user_id(getattr(request.state, "current_user", None))
    )
    target_ref = path
    if request.url.query:
        target_ref = f"{target_ref}?{request.url.query[:250]}"
    result = "success" if 200 <= status < 400 else "failed"
    detail = f"{method} {path} -> {status}"
    metadata = {
        "method": method,
        "path": path,
        "query": request.url.query or None,
        "status_code": status,
        "elapsed_ms": float(elapsed_ms),
    }
    try:
        with SessionLocal() as db:
            record_security_audit(
                db=db,
                action=str(action),
                user_id=user_id,
                target_type=str(module),
                target_ref=target_ref,
                detail=detail,
                ip_address=get_request_ip(request),
                device_info=get_request_device_info(request),
                result=result,
                metadata=metadata,
            )
    except Exception as log_error:
        logger.warning(f"Failed to write module audit log: {log_error}")

@app.middleware("http")
async def request_monitor_middleware(request: Request, call_next):
    _safe_request_log(f"--> [REQ] {request.method} {request.url.path}")
    start = time.perf_counter()
    try:
        response = await call_next(request)
        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
        _safe_request_log(f"<-- [RES] {request.method} {request.url.path} - {response.status_code} ({elapsed_ms}ms)")
        await run_in_threadpool(_write_module_audit_log, request, response.status_code, elapsed_ms)
        return response
    except Exception as e:
        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
        await run_in_threadpool(_write_module_audit_log, request, 500, elapsed_ms)
        _safe_request_log(f"!!! [ERR] {request.method} {request.url.path} - {str(e)}")
        raise

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    error_id = uuid.uuid4().hex[:12]
    logger.exception(f"Unhandled server error [{error_id}] on {request.method} {request.url.path}")
    headers = _cors_error_headers(request)
    return JSONResponse(
        content={
            "success": False,
            "error_code": ERROR_INTERNAL_SERVER_ERROR,
            "message": "Internal server error",
            "meta": {
                "error_id": error_id,
                "detail": f"{type(exc).__name__}: {str(exc)}",
            },
        },
        status_code=500,
        headers=headers,
    )


@app.exception_handler(ApiError)
async def api_error_handler(request: Request, exc: ApiError):
    headers = _cors_error_headers(request)
    return JSONResponse(
        status_code=int(exc.status_code),
        headers=headers,
        content={
            "success": False,
            "error_code": str(exc.error_code),
            "message": str(exc.message),
            "meta": {"details": exc.details} if exc.details is not None else {},
        },
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    headers = _cors_error_headers(request)
    error_code = map_http_error_code(int(exc.status_code), exc.detail)
    message = str(exc.detail or "Request failed")
    return JSONResponse(
        status_code=int(exc.status_code),
        headers=headers,
        content={
            "success": False,
            "error_code": error_code,
            "message": message,
            "meta": {},
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    headers = _cors_error_headers(request)
    return JSONResponse(
        status_code=422,
        headers=headers,
        content={
            "success": False,
            "error_code": "VALIDATION_FAILED",
            "message": "Request validation failed",
            "meta": {"errors": exc.errors()},
        },
    )

if settings.env.lower() == "development":
    @app.get('/debug-db')
    def debug_db(db: SessionLocal = Depends(get_db), _=Depends(require_admin)):
        from app.models import RepairTicket
        count = db.query(RepairTicket).count()
        return {
            "count": count,
            "env": settings.env
        }

@app.get('/health')
def health():
    return {"status": "ok"}


@app.get('/system/diagnostics', dependencies=[Depends(require_permission("system.view"))])
def system_diagnostics(db=Depends(get_db)):
    from app.models import AppSetting, BackupRecord, SecurityAuditLog

    inspector = sa_inspect(engine)
    alembic_version = None
    if "alembic_version" in inspector.get_table_names():
        row = db.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).first()
        alembic_version = row[0] if row else None
    last_backup = db.query(AppSetting).filter(AppSetting.key == "last_backup_at").first()
    latest_backup = db.query(BackupRecord).order_by(BackupRecord.created_at.desc()).first() if "backup_records" in inspector.get_table_names() else None
    last_audit = db.query(SecurityAuditLog).order_by(SecurityAuditLog.created_at.desc()).first() if "security_audit_logs" in inspector.get_table_names() else None
    return {
        "app_version": settings.app_version,
        "environment": settings.env,
        "db_schema_version": settings.db_schema_version,
        "alembic_version": alembic_version,
        "runtime_schema_sync": bool(settings.allow_runtime_schema_sync),
        "auto_migrate_enabled": bool(settings.auto_migrate_enabled),
        "backup": {
            "last_backup_at": last_backup.value if last_backup else None,
            "latest_status": latest_backup.status if latest_backup else None,
            "latest_filename": latest_backup.filename if latest_backup else None,
            "encryption_required": bool(settings.backup_encrypt),
        },
        "security": {
            "direct_restore_enabled": bool(settings.allow_direct_restore),
            "cors_origins": settings.cors_origins,
        },
        "last_security_audit_at": last_audit.created_at.isoformat() if last_audit and last_audit.created_at else None,
    }


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    if FAVICON_PATH.exists():
        return FileResponse(FAVICON_PATH)
    return Response(status_code=204)
