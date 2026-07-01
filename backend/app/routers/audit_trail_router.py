import json
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_permission
from app.database import get_db
from app.models import (
    ActivityLog,
    AppSetting,
    InventoryItem,
    RepairHistory,
    RepairTicket,
    RestoreApproval,
    RestoreRequest,
    ReturnRecord,
    Sale,
    SecurityAuditLog,
    StockMovement,
    User,
)
from app.services.security_service import canonical_role_name, get_request_device_info, get_request_ip, record_security_audit
from app.utils.time import utcnow

router = APIRouter(prefix="/audit-trail", tags=["audit-trail"])

ARCHIVED_IDS_KEY = "audit_trail_archived_event_ids_v1"
ARCHIVED_META_KEY = "audit_trail_archived_meta_v1"
REPORT_EXPORT_HISTORY_KEY = "export_center_history"
ARCHIVED_MAX = 50_000

TRACKED_MODULES = [
    "Login/Auth",
    "POS/Billing",
    "Repairs",
    "Inventory",
    "Customers",
    "Suppliers",
    "Expenses",
    "Warranty",
    "Returns",
    "Reports",
    "Settings",
    "Backup & Restore",
    "Access Control",
]


class ArchiveEventsIn(BaseModel):
    event_ids: list[str]
    reason: str | None = None


class AuditExportIn(BaseModel):
    export_format: str = "CSV"
    row_count: int = 0
    date_from: str | None = None
    date_to: str | None = None
    filters: dict[str, Any] | None = None


def _parse_dt(value: str | None, end_exclusive: bool = False) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid datetime: {value}") from exc
    if end_exclusive and "T" not in str(value):
        return parsed + timedelta(days=1)
    return parsed


def _coerce_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except Exception:
        return None


def _safe_json(value: str | None) -> Any:
    if value in (None, ""):
        return None
    try:
        return json.loads(value)
    except Exception:
        return value


def _to_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _format_invoice_id(sale_id: int | None) -> str | None:
    if sale_id is None:
        return None
    return f"INV-{int(sale_id):05d}"


def _role_key_for_user(user: User | None) -> str:
    if not user:
        return "system"
    assigned_name = user.assigned_role.name if getattr(user, "assigned_role", None) else None
    return canonical_role_name(assigned_name or user.role)


def _role_label_for_user(user: User | None) -> str:
    if not user:
        return "System"
    assigned = getattr(user, "assigned_role", None)
    if assigned and assigned.display_name:
        return assigned.display_name
    return str(user.role or "Staff")


def _is_owner_or_admin(user: User) -> bool:
    return _role_key_for_user(user) in {"owner", "admin"}


def _require_owner_or_admin(user: User) -> None:
    if not _is_owner_or_admin(user):
        raise HTTPException(status_code=403, detail="Only Owner/Admin can view full audit trail")


def _normalize_status(raw: str | None) -> str:
    value = str(raw or "").strip().lower()
    if value in {"failed", "failure", "error"}:
        return "Failed"
    if value in {"blocked", "locked"}:
        return "Blocked"
    if value in {"warning", "warn"}:
        return "Warning"
    return "Success"


def _normalize_action(raw_action: str | None, module: str | None = None, source: str | None = None) -> str:
    text = str(raw_action or "").strip().lower()
    module_text = str(module or "").lower()
    source_text = str(source or "").lower()

    if text in {"failed_login", "blocked_login"}:
        return "Failed Login"
    if "logout" in text:
        return "Logout"
    if text == "login":
        return "Login"
    if "permission" in text or "role" in text:
        return "Permission Change"
    if "void" in text:
        return "Void Invoice"
    if "refund" in text or "return" in text:
        return "Refund"
    if text == "restore":
        return "Restore Performed"
    if text == "create" and "backup" in module_text:
        return "Backup Created"
    if "backup" in text and "create" in text:
        return "Backup Created"
    if "restore" in text:
        return "Restore Performed"
    if "soft" in text and "delete" in text:
        return "Soft Delete"
    if text == "delete" or "delete" in text:
        return "Delete"
    if text in {"update", "edit", "modify"}:
        if "repair" in module_text and source_text == "repair_history":
            return "Repair Status Change"
        return "Edit"
    if "adjust" in text:
        return "Stock Adjustment"
    if "print" in text:
        return "Print"
    if "export" in text:
        return "Export"
    if text in {"view", "read"}:
        return "View"
    if text in {"create", "add", "insert"}:
        return "Create"
    return (raw_action or "Activity").strip() or "Activity"


def _normalize_module(raw_module: str | None, action: str, source: str, target_type: str | None = None) -> str:
    source_text = str(source or "").lower()
    module_text = str(raw_module or "").lower()
    target_text = str(target_type or "").lower()
    action_text = str(action or "").lower()

    if source_text == "security_audit":
        module_map = {
            "dashboard": "Reports",
            "pos": "POS/Billing",
            "repairs": "Repairs",
            "inventory": "Inventory",
            "customers": "Customers",
            "suppliers": "Suppliers",
            "expenses": "Expenses",
            "warranty": "Warranty",
            "returns": "Returns",
            "reports": "Reports",
            "settings": "Settings",
            "backup": "Backup & Restore",
            "audit_logs": "Access Control",
            "financial_audit": "Reports",
            "labels": "Inventory",
        }
        if target_text in module_map:
            return module_map[target_text]
        if action_text in {"login", "logout", "failed login"}:
            return "Login/Auth"
        if "permission" in action_text or target_text in {"role", "permission", "session", "security_settings"}:
            return "Access Control"
        if "restore" in action_text or "backup" in action_text:
            return "Backup & Restore"
        if target_text in {"user"} and "delete" in action_text:
            return "Access Control"
        return "Settings"

    if source_text == "login_attempt":
        return "Login/Auth"

    if source_text == "stock_movement":
        return "Inventory"

    if source_text == "repair_history":
        return "Repairs"

    if source_text == "sale_event":
        if action_text == "refund":
            return "Returns"
        return "POS/Billing"

    if source_text == "return_event":
        return "Returns"

    if source_text == "restore_request":
        return "Backup & Restore"

    if "auth" in module_text or "login" in module_text:
        return "Login/Auth"
    if "sale" in module_text or "invoice" in module_text or "pos" in module_text:
        return "POS/Billing"
    if "repair" in module_text:
        return "Repairs"
    if "inventory" in module_text or "stock" in module_text:
        return "Inventory"
    if "customer" in module_text:
        return "Customers"
    if "supplier" in module_text or "purchase" in module_text:
        return "Suppliers"
    if "expense" in module_text:
        return "Expenses"
    if "warranty" in module_text:
        return "Warranty"
    if "return" in module_text or "refund" in module_text:
        return "Returns"
    if "report" in module_text or "export" in module_text:
        return "Reports"
    if "setting" in module_text:
        return "Settings"
    if "backup" in module_text or "restore" in module_text:
        return "Backup & Restore"
    if "access" in module_text or "permission" in module_text or "role" in module_text:
        return "Access Control"
    return "Settings"


def _infer_severity(action: str, module: str, status: str, detail: str | None = None) -> str:
    detail_text = str(detail or "").lower()
    action_text = str(action).lower()
    module_text = str(module).lower()
    status_text = str(status).lower()
    if status_text in {"failed", "blocked"}:
        return "Critical"
    if action_text in {"failed login", "permission change", "void invoice", "delete", "soft delete", "restore performed"}:
        return "Critical"
    if "backup" in module_text and "fail" in detail_text:
        return "Critical"
    if action_text in {"stock adjustment", "repair status change", "refund", "edit"}:
        return "Warning"
    return "Info"


def _sensitive_reason(action: str, module: str, status: str, detail: str | None = None) -> str | None:
    action_text = str(action).lower()
    module_text = str(module).lower()
    status_text = str(status).lower()
    detail_text = str(detail or "").lower()

    if action_text == "failed login" or status_text in {"failed", "blocked"} and module_text == "login/auth":
        return "Failed login attempt"
    if action_text == "permission change":
        return "Permission change"
    if action_text == "void invoice":
        return "Invoice void"
    if module_text == "inventory" and ("reduction" in action_text or action_text == "stock adjustment"):
        return "Stock reduction/adjustment"
    if action_text == "restore performed":
        return "Database restore"
    if action_text in {"delete", "soft delete"} and module_text in {"access control", "settings"}:
        return "User deletion"
    if module_text == "backup & restore" and (status_text in {"failed", "blocked"} or "fail" in detail_text):
        return "Backup failure"
    return None


def _load_archived_meta(db: Session) -> dict[str, dict[str, Any]]:
    row = db.query(AppSetting).filter(AppSetting.key == ARCHIVED_META_KEY).first()
    if row and row.value:
        try:
            parsed = json.loads(row.value)
            if isinstance(parsed, dict):
                normalized: dict[str, dict[str, Any]] = {}
                for event_id, meta in parsed.items():
                    event_key = str(event_id).strip()
                    if not event_key:
                        continue
                    if isinstance(meta, dict):
                        normalized[event_key] = meta
                    else:
                        normalized[event_key] = {"archived_at": None}
                if normalized:
                    return normalized
        except Exception:
            pass

    # Legacy compatibility: prior builds stored archived ids as a list.
    legacy = db.query(AppSetting).filter(AppSetting.key == ARCHIVED_IDS_KEY).first()
    if not legacy or not legacy.value:
        return {}
    try:
        parsed_legacy = json.loads(legacy.value)
    except Exception:
        return {}
    if not isinstance(parsed_legacy, list):
        return {}
    output: dict[str, dict[str, Any]] = {}
    for item in parsed_legacy:
        key = str(item or "").strip()
        if not key:
            continue
        output[key] = {"archived_at": None}
    return output


def _save_archived_meta(db: Session, archived_map: dict[str, dict[str, Any]]) -> None:
    sortable = []
    for event_id, meta in (archived_map or {}).items():
        ts = str((meta or {}).get("archived_at") or "")
        sortable.append((event_id, meta, ts))
    sortable.sort(key=lambda row: row[2], reverse=True)
    trimmed = sortable[:ARCHIVED_MAX]

    payload_map = {str(event_id): (meta or {}) for event_id, meta, _ in trimmed}
    payload_ids = [str(event_id) for event_id, _, _ in trimmed]

    row = db.query(AppSetting).filter(AppSetting.key == ARCHIVED_META_KEY).first()
    if row:
        row.value = json.dumps(payload_map)
    else:
        db.add(AppSetting(key=ARCHIVED_META_KEY, value=json.dumps(payload_map)))

    # Keep legacy list in sync for backwards compatibility.
    legacy = db.query(AppSetting).filter(AppSetting.key == ARCHIVED_IDS_KEY).first()
    if legacy:
        legacy.value = json.dumps(payload_ids)
    else:
        db.add(AppSetting(key=ARCHIVED_IDS_KEY, value=json.dumps(payload_ids)))
    db.commit()


def _find_related_activity(
    activity_by_entity: dict[tuple[str, int], list[ActivityLog]],
    entity_types: list[str],
    entity_id: int | None,
    around_ts: datetime | None = None,
) -> ActivityLog | None:
    if entity_id is None:
        return None
    pool: list[ActivityLog] = []
    for entity_type in entity_types:
        key = (str(entity_type).lower(), int(entity_id))
        pool.extend(activity_by_entity.get(key, []))
    if not pool:
        return None
    pool.sort(key=lambda row: row.created_at or datetime.min, reverse=True)
    if around_ts:
        window_start = around_ts - timedelta(hours=8)
        window_end = around_ts + timedelta(hours=8)
        windowed = [row for row in pool if row.created_at and window_start <= row.created_at <= window_end]
        if windowed:
            return windowed[0]
    return pool[0]


def _build_security_context_map(security_rows: list[SecurityAuditLog]) -> dict[int, list[SecurityAuditLog]]:
    by_user: dict[int, list[SecurityAuditLog]] = {}
    for row in security_rows:
        if not row.user_id:
            continue
        by_user.setdefault(int(row.user_id), []).append(row)
    for user_id in by_user:
        by_user[user_id].sort(key=lambda row: row.created_at or datetime.min, reverse=True)
    return by_user


def _nearest_security_context(
    by_user: dict[int, list[SecurityAuditLog]],
    user_id: int | None,
    event_ts: datetime | None,
) -> tuple[str | None, str | None]:
    if not user_id:
        return None, None
    rows = by_user.get(int(user_id)) or []
    if not rows:
        return None, None
    if event_ts is None:
        row = rows[0]
        return row.ip_address, row.device_info
    nearest = min(
        rows,
        key=lambda row: abs(((row.created_at or event_ts) - event_ts).total_seconds()),
    )
    return nearest.ip_address, nearest.device_info


def _parse_old_new_from_note(note: str | None) -> tuple[str | None, str | None]:
    text = str(note or "")
    lower = text.lower()
    if "changed from" not in lower or " to " not in lower:
        return None, None
    try:
        after_from = text.split("from", 1)[1]
        old_value = after_from.split("to", 1)[0].strip(" .:-")
        new_value = after_from.split("to", 1)[1].strip(" .:-")
        return old_value or None, new_value or None
    except Exception:
        return None, None


@router.get("/events", dependencies=[Depends(require_permission("audit.view"))])
def audit_trail_events(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    user: str | None = Query(default=None),
    role: str | None = Query(default=None),
    module: str | None = Query(default=None),
    action: str | None = Query(default=None),
    status: str | None = Query(default=None),
    search: str | None = Query(default=None),
    invoice_id: str | None = Query(default=None),
    repair_ticket_id: str | None = Query(default=None),
    product_sku: str | None = Query(default=None),
    customer_name: str | None = Query(default=None),
    only_sensitive: bool = Query(default=False),
    include_archived: bool = Query(default=False),
    limit: int = Query(default=2000, ge=100, le=5000),
    source_limit: int = Query(default=10000, ge=1000, le=50000),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    _require_owner_or_admin(current)

    start_dt = _parse_dt(date_from)
    end_dt = _parse_dt(date_to, end_exclusive=True)
    user_filter = str(user or "").strip().lower()
    role_filter = canonical_role_name(role) if role else ""
    module_filter = str(module or "").strip().lower()
    action_filter = str(action or "").strip().lower()
    status_filter = str(status or "").strip().lower()
    search_filter = str(search or "").strip().lower()
    invoice_filter = str(invoice_id or "").strip().lower()
    repair_filter = str(repair_ticket_id or "").strip().lower()
    sku_filter = str(product_sku or "").strip().lower()
    customer_filter = str(customer_name or "").strip().lower()

    archived_meta = _load_archived_meta(db)
    archived_ids = set(archived_meta.keys())
    now = utcnow()

    sales_lookup_rows = (
        db.query(Sale.id, Sale.customer_id)
        .order_by(Sale.created_at.desc())
        .limit(source_limit)
        .all()
    )
    invoice_map = {int(row[0]): _format_invoice_id(int(row[0])) for row in sales_lookup_rows}

    repair_lookup_rows = (
        db.query(RepairTicket.id, RepairTicket.ticket_no)
        .order_by(RepairTicket.created_at.desc())
        .limit(source_limit)
        .all()
    )
    repair_map = {int(row[0]): (row[1] or f"REP-{int(row[0]):05d}") for row in repair_lookup_rows}

    inventory_lookup_rows = (
        db.query(InventoryItem.id, InventoryItem.sku, InventoryItem.name)
        .order_by(InventoryItem.id.desc())
        .limit(source_limit)
        .all()
    )
    inventory_map = {
        int(row[0]): {
            "sku": str(row[1] or ""),
            "name": str(row[2] or f"Item #{int(row[0])}"),
        }
        for row in inventory_lookup_rows
    }

    events: list[dict[str, Any]] = []

    activity_q = db.query(ActivityLog).options(joinedload(ActivityLog.user))
    if start_dt:
        activity_q = activity_q.filter(ActivityLog.created_at >= start_dt)
    if end_dt:
        activity_q = activity_q.filter(ActivityLog.created_at < end_dt)
    activity_rows = activity_q.order_by(ActivityLog.created_at.desc()).limit(source_limit).all()
    activity_by_entity: dict[tuple[str, int], list[ActivityLog]] = {}
    for activity_row in activity_rows:
        if activity_row.entity_id is None:
            continue
        key = (str(activity_row.entity_type or "").lower(), int(activity_row.entity_id))
        activity_by_entity.setdefault(key, []).append(activity_row)

    for row in activity_rows:
        actor = row.user
        role_key = _role_key_for_user(actor)
        role_label = _role_label_for_user(actor)
        action_label = _normalize_action(row.action, module=row.entity_type, source="activity_log")
        module_label = _normalize_module(row.entity_type, action_label, source="activity_log")
        status_label = "Success"
        target_record = f"{row.entity_type or 'Record'} #{row.entity_id}" if row.entity_id is not None else str(row.entity_type or "Record")

        related_invoice = None
        related_repair = None
        related_sku = None
        related_customer = None

        entity_type_lower = str(row.entity_type or "").lower()
        if entity_type_lower in {"sale", "sales"} and row.entity_id is not None:
            related_invoice = invoice_map.get(int(row.entity_id))
            target_record = related_invoice or target_record
        elif entity_type_lower in {"repairticket", "repair", "repairs"} and row.entity_id is not None:
            related_repair = repair_map.get(int(row.entity_id))
            target_record = related_repair or target_record
        elif entity_type_lower in {"inventoryitem", "inventory", "stockmovement"} and row.entity_id is not None:
            info = inventory_map.get(int(row.entity_id), {})
            related_sku = str(info.get("sku") or "")
            target_record = related_sku or info.get("name") or target_record
        elif entity_type_lower in {"customer", "customers"} and row.entity_id is not None:
            related_customer = f"Customer #{row.entity_id}"
            target_record = related_customer

        severity = _infer_severity(action_label, module_label, status_label, row.description)
        sensitive = _sensitive_reason(action_label, module_label, status_label, row.description)
        events.append(
            {
                "event_id": f"activity:{row.id}",
                "actor_user_id": actor.id if actor else None,
                "timestamp": _to_iso(row.created_at),
                "user": actor.full_name if actor and actor.full_name else (actor.username if actor else "System"),
                "role": role_label,
                "role_key": role_key,
                "action": action_label,
                "module": module_label,
                "target_record": target_record,
                "old_value": _safe_json(row.old_value),
                "new_value": _safe_json(row.new_value),
                "ip_address": None,
                "device_info": None,
                "status": status_label,
                "severity": severity,
                "is_sensitive": bool(sensitive),
                "alert_reason": sensitive,
                "detail": row.description or "",
                "related": {
                    "invoice_id": related_invoice,
                    "repair_ticket_id": related_repair,
                    "product_sku": related_sku,
                    "customer_name": related_customer,
                    "record_type": row.entity_type,
                    "record_id": row.entity_id,
                },
                "source": "activity_log",
                "archived": f"activity:{row.id}" in archived_ids,
                "archived_info": archived_meta.get(f"activity:{row.id}"),
            }
        )

    security_q = db.query(SecurityAuditLog).options(joinedload(SecurityAuditLog.user))
    if start_dt:
        security_q = security_q.filter(SecurityAuditLog.created_at >= start_dt)
    if end_dt:
        security_q = security_q.filter(SecurityAuditLog.created_at < end_dt)
    security_rows = security_q.order_by(SecurityAuditLog.created_at.desc()).limit(source_limit).all()

    for row in security_rows:
        actor = row.user
        role_key = _role_key_for_user(actor)
        role_label = _role_label_for_user(actor)
        status_label = _normalize_status(row.result)
        action_label = _normalize_action(row.action, module=row.target_type, source="security_audit")
        module_label = _normalize_module(row.target_type, action_label, source="security_audit", target_type=row.target_type)
        target_ref = str(row.target_ref or "").strip()
        target_record = target_ref or (f"{row.target_type or 'Record'} #{row.target_id}" if row.target_id is not None else (row.target_type or "Security Event"))
        metadata = _safe_json(row.metadata_json)
        related_invoice = None
        related_repair = None
        related_sku = None
        related_customer = None
        if target_ref and target_ref.lower().startswith("inv-"):
            related_invoice = target_ref
        severity = _infer_severity(action_label, module_label, status_label, row.detail)
        sensitive = _sensitive_reason(action_label, module_label, status_label, row.detail)
        user_name = actor.full_name if actor and actor.full_name else (actor.username if actor else (target_ref or "Unknown"))
        events.append(
            {
                "event_id": f"security:{row.id}",
                "actor_user_id": actor.id if actor else row.user_id,
                "timestamp": _to_iso(row.created_at),
                "user": user_name,
                "role": role_label,
                "role_key": role_key,
                "action": action_label,
                "module": module_label,
                "target_record": target_record,
                "old_value": None,
                "new_value": metadata,
                "ip_address": row.ip_address,
                "device_info": row.device_info,
                "status": status_label,
                "severity": severity,
                "is_sensitive": bool(sensitive),
                "alert_reason": sensitive,
                "detail": row.detail or "",
                "related": {
                    "invoice_id": related_invoice,
                    "repair_ticket_id": related_repair,
                    "product_sku": related_sku,
                    "customer_name": related_customer,
                    "record_type": row.target_type,
                    "record_id": row.target_id,
                },
                "source": "security_audit",
                "archived": f"security:{row.id}" in archived_ids,
                "archived_info": archived_meta.get(f"security:{row.id}"),
            }
        )

    security_by_user = _build_security_context_map(security_rows)

    movement_q = db.query(StockMovement).options(joinedload(StockMovement.item))
    if start_dt:
        movement_q = movement_q.filter(StockMovement.created_at >= start_dt)
    if end_dt:
        movement_q = movement_q.filter(StockMovement.created_at < end_dt)
    movement_rows = movement_q.order_by(StockMovement.created_at.desc()).limit(source_limit).all()

    for row in movement_rows:
        item = row.item
        related_activity = None
        ref_type = str(row.reference_type or "").lower()
        if ref_type in {"sale", "sales", "sale_void"} and row.reference_id:
            related_activity = _find_related_activity(activity_by_entity, ["sale", "sales"], int(row.reference_id), around_ts=row.created_at)
        elif ref_type in {"repair", "repair_ticket"} and row.reference_id:
            related_activity = _find_related_activity(activity_by_entity, ["repairticket", "repair", "repairs"], int(row.reference_id), around_ts=row.created_at)
        elif row.item_id is not None:
            related_activity = _find_related_activity(activity_by_entity, ["inventoryitem", "inventory", "stockmovement"], int(row.item_id), around_ts=row.created_at)
        actor = related_activity.user if related_activity and getattr(related_activity, "user", None) else None
        actor_user_id = actor.id if actor else None
        actor_name = actor.full_name if actor and actor.full_name else (actor.username if actor else "System")
        actor_role = _role_label_for_user(actor) if actor else "System"
        actor_role_key = _role_key_for_user(actor) if actor else "system"
        event_ts = related_activity.created_at if related_activity and related_activity.created_at else row.created_at
        ip_address, device_info = _nearest_security_context(security_by_user, actor_user_id, event_ts)
        sku = str((item.sku if item else "") or "")
        item_name = str((item.name if item else f"Item #{row.item_id}") or f"Item #{row.item_id}")
        if str(row.movement_type or "").upper() == "ADJUSTMENT":
            action_label = "Stock Adjustment"
        elif int(row.quantity or 0) < 0:
            action_label = "Stock Reduction"
        else:
            action_label = "Create"
        module_label = _normalize_module("inventory", action_label, source="stock_movement")
        status_label = "Success"
        detail = row.note or f"{row.movement_type} movement"
        severity = _infer_severity(action_label, module_label, status_label, detail)
        sensitive = _sensitive_reason(action_label, module_label, status_label, detail)
        target_record = sku or item_name
        events.append(
            {
                "event_id": f"movement:{row.id}",
                "actor_user_id": actor_user_id,
                "timestamp": _to_iso(event_ts),
                "user": actor_name,
                "role": actor_role,
                "role_key": actor_role_key,
                "action": action_label,
                "module": module_label,
                "target_record": target_record,
                "old_value": _safe_json(related_activity.old_value) if related_activity and related_activity.old_value else None,
                "new_value": {
                    "movement_type": row.movement_type,
                    "quantity_delta": row.quantity,
                    "reference_type": row.reference_type,
                    "reference_id": row.reference_id,
                },
                "ip_address": ip_address,
                "device_info": device_info,
                "status": status_label,
                "severity": severity,
                "is_sensitive": bool(sensitive),
                "alert_reason": sensitive,
                "detail": detail,
                "related": {
                    "invoice_id": _format_invoice_id(row.reference_id) if str(row.reference_type or "").lower() in {"sale", "sales"} else None,
                    "repair_ticket_id": repair_map.get(int(row.reference_id)) if str(row.reference_type or "").lower() in {"repair", "repair_ticket"} and row.reference_id else None,
                    "product_sku": sku,
                    "customer_name": None,
                    "record_type": "StockMovement",
                    "record_id": row.id,
                },
                "source": "stock_movement",
                "archived": f"movement:{row.id}" in archived_ids,
                "archived_info": archived_meta.get(f"movement:{row.id}"),
            }
        )

    repair_history_q = (
        db.query(RepairHistory, RepairTicket)
        .join(RepairTicket, RepairTicket.id == RepairHistory.repair_id)
    )
    if start_dt:
        repair_history_q = repair_history_q.filter(RepairHistory.created_at >= start_dt)
    if end_dt:
        repair_history_q = repair_history_q.filter(RepairHistory.created_at < end_dt)
    repair_history_rows = repair_history_q.order_by(RepairHistory.created_at.desc()).limit(source_limit).all()

    for history, ticket in repair_history_rows:
        related_activity = _find_related_activity(activity_by_entity, ["repairticket", "repair", "repairs"], int(history.repair_id), around_ts=history.created_at)
        actor = related_activity.user if related_activity and getattr(related_activity, "user", None) else None
        actor_user_id = actor.id if actor else None
        actor_name = actor.full_name if actor and actor.full_name else (actor.username if actor else "System")
        actor_role = _role_label_for_user(actor) if actor else "System"
        actor_role_key = _role_key_for_user(actor) if actor else "system"
        event_ts = related_activity.created_at if related_activity and related_activity.created_at else history.created_at
        ip_address, device_info = _nearest_security_context(security_by_user, actor_user_id, event_ts)
        old_status, parsed_new_status = _parse_old_new_from_note(history.note)
        new_status = parsed_new_status or history.status
        action_label = "Repair Status Change"
        module_label = "Repairs"
        status_label = "Success"
        detail = history.note or "Repair workflow status updated"
        severity = _infer_severity(action_label, module_label, status_label, detail)
        sensitive = _sensitive_reason(action_label, module_label, status_label, detail)
        repair_ref = ticket.ticket_no if ticket and ticket.ticket_no else f"REP-{history.repair_id:05d}"
        events.append(
            {
                "event_id": f"repair_history:{history.id}",
                "actor_user_id": actor_user_id,
                "timestamp": _to_iso(event_ts),
                "user": actor_name,
                "role": actor_role,
                "role_key": actor_role_key,
                "action": action_label,
                "module": module_label,
                "target_record": repair_ref,
                "old_value": old_status or (_safe_json(related_activity.old_value) if related_activity and related_activity.old_value else None),
                "new_value": new_status,
                "ip_address": ip_address,
                "device_info": device_info,
                "status": status_label,
                "severity": severity,
                "is_sensitive": bool(sensitive),
                "alert_reason": sensitive,
                "detail": detail,
                "related": {
                    "invoice_id": None,
                    "repair_ticket_id": repair_ref,
                    "product_sku": None,
                    "customer_name": None,
                    "record_type": "RepairHistory",
                    "record_id": history.id,
                },
                "source": "repair_history",
                "archived": f"repair_history:{history.id}" in archived_ids,
                "archived_info": archived_meta.get(f"repair_history:{history.id}"),
            }
        )

    sales_q = db.query(Sale).options(joinedload(Sale.customer))
    if start_dt:
        sales_q = sales_q.filter(Sale.created_at >= start_dt)
    if end_dt:
        sales_q = sales_q.filter(Sale.created_at < end_dt)
    sale_rows = sales_q.order_by(Sale.created_at.desc()).limit(source_limit).all()
    for sale in sale_rows:
        if not (bool(sale.is_voided) or bool(sale.is_return)):
            continue
        related_activity = _find_related_activity(activity_by_entity, ["sale", "sales"], int(sale.id), around_ts=sale.created_at)
        actor = related_activity.user if related_activity and getattr(related_activity, "user", None) else None
        actor_user_id = actor.id if actor else None
        actor_name = actor.full_name if actor and actor.full_name else (actor.username if actor else "System")
        actor_role = _role_label_for_user(actor) if actor else "System"
        actor_role_key = _role_key_for_user(actor) if actor else "system"
        event_ts = related_activity.created_at if related_activity and related_activity.created_at else sale.created_at
        ip_address, device_info = _nearest_security_context(security_by_user, actor_user_id, event_ts)
        invoice_no = _format_invoice_id(sale.id)
        action_label = "Void Invoice" if sale.is_voided else "Refund"
        module_label = "POS/Billing" if sale.is_voided else "Returns"
        status_label = "Success"
        detail = sale.void_reason or ("Invoice marked as return" if sale.is_return else "Invoice updated")
        severity = _infer_severity(action_label, module_label, status_label, detail)
        sensitive = _sensitive_reason(action_label, module_label, status_label, detail)
        events.append(
            {
                "event_id": f"sale_event:{sale.id}",
                "actor_user_id": actor_user_id,
                "timestamp": _to_iso(event_ts),
                "user": actor_name,
                "role": actor_role,
                "role_key": actor_role_key,
                "action": action_label,
                "module": module_label,
                "target_record": invoice_no or f"Sale #{sale.id}",
                "old_value": _safe_json(related_activity.old_value) if related_activity and related_activity.old_value else {"total": sale.total, "is_voided": False},
                "new_value": _safe_json(related_activity.new_value) if related_activity and related_activity.new_value else {"total": sale.total, "is_voided": bool(sale.is_voided), "is_return": bool(sale.is_return)},
                "ip_address": ip_address,
                "device_info": device_info,
                "status": status_label,
                "severity": severity,
                "is_sensitive": bool(sensitive),
                "alert_reason": sensitive,
                "detail": detail,
                "related": {
                    "invoice_id": invoice_no,
                    "repair_ticket_id": None,
                    "product_sku": None,
                    "customer_name": sale.customer.name if sale.customer else None,
                    "record_type": "Sale",
                    "record_id": sale.id,
                },
                "source": "sale_event",
                "archived": f"sale_event:{sale.id}" in archived_ids,
                "archived_info": archived_meta.get(f"sale_event:{sale.id}"),
            }
        )

    returns_q = db.query(ReturnRecord).options(
        joinedload(ReturnRecord.staff_user),
        joinedload(ReturnRecord.approved_by),
        joinedload(ReturnRecord.refund_approved_by),
    )
    if start_dt:
        returns_q = returns_q.filter(ReturnRecord.created_at >= start_dt)
    if end_dt:
        returns_q = returns_q.filter(ReturnRecord.created_at < end_dt)
    return_rows = returns_q.order_by(ReturnRecord.created_at.desc()).limit(source_limit).all()

    for row in return_rows:
        decision_lower = str(row.decision_status or "").lower()
        action_label = "Refund" if str(row.decision_status or "").lower() in {"refunded", "closed"} else "Create"
        module_label = "Returns"
        if decision_lower in {"rejected", "failed"}:
            status_label = "Failed"
        elif decision_lower in {"pending inspection", "pending approval"}:
            status_label = "Warning"
        else:
            status_label = "Success"
        actor = getattr(row, "refund_approved_by", None) or getattr(row, "approved_by", None) or getattr(row, "staff_user", None)
        actor_user_id = actor.id if actor else None
        ip_address, device_info = _nearest_security_context(security_by_user, actor_user_id, row.created_at)
        detail = row.return_reason or row.inspection_note or row.decision_status or "Return activity"
        severity = _infer_severity(action_label, module_label, status_label, detail)
        sensitive = _sensitive_reason(action_label, module_label, status_label, detail)
        events.append(
            {
                "event_id": f"return_event:{row.id}",
                "actor_user_id": actor_user_id,
                "timestamp": _to_iso(row.created_at),
                "user": actor.full_name if actor and actor.full_name else (actor.username if actor else "System"),
                "role": _role_label_for_user(actor),
                "role_key": _role_key_for_user(actor),
                "action": action_label,
                "module": module_label,
                "target_record": row.return_code or f"RET-{row.id:05d}",
                "old_value": None,
                "new_value": {
                    "product_name": row.product_name,
                    "quantity": row.quantity,
                    "refund_amount": row.refund_amount,
                    "status": row.decision_status,
                },
                "ip_address": ip_address,
                "device_info": device_info,
                "status": status_label,
                "severity": severity,
                "is_sensitive": bool(sensitive),
                "alert_reason": sensitive,
                "detail": detail,
                "related": {
                    "invoice_id": _format_invoice_id(row.original_sale_id),
                    "repair_ticket_id": None,
                    "product_sku": row.sku_barcode,
                    "customer_name": row.customer_name,
                    "record_type": "ReturnRecord",
                    "record_id": row.id,
                },
                "source": "return_event",
                "archived": f"return_event:{row.id}" in archived_ids,
                "archived_info": archived_meta.get(f"return_event:{row.id}"),
            }
        )

    restore_rows = (
        db.query(RestoreRequest)
        .options(
            joinedload(RestoreRequest.backup_record),
            joinedload(RestoreRequest.requested_by),
            joinedload(RestoreRequest.executed_by),
        )
        .order_by(RestoreRequest.requested_at.desc())
        .limit(source_limit)
        .all()
    )
    restore_ids = [row.id for row in restore_rows]
    approvals = []
    if restore_ids:
        approvals = (
            db.query(RestoreApproval)
            .options(joinedload(RestoreApproval.decided_by))
            .filter(RestoreApproval.restore_request_id.in_(restore_ids))
            .order_by(RestoreApproval.decided_at.desc())
            .all()
        )
    latest_approval_by_request: dict[int, RestoreApproval] = {}
    for approval in approvals:
        if approval.restore_request_id not in latest_approval_by_request:
            latest_approval_by_request[approval.restore_request_id] = approval

    restore_status_labels = {
        "pending_approval": "Pending Approval",
        "approved": "Approved",
        "rejected": "Rejected",
        "executed": "Executed",
        "failed": "Failed",
    }

    for row in restore_rows:
        status_key = str(row.status or "").strip().lower()
        status_value = restore_status_labels.get(status_key)
        if not status_value:
            continue
        ts_dt = row.executed_at or row.requested_at
        if start_dt and ts_dt and ts_dt < start_dt:
            continue
        if end_dt and ts_dt and ts_dt >= end_dt:
            continue
        action_label = "Restore Performed" if status_key in {"executed", "failed"} else "Create"
        module_label = "Backup & Restore"
        if status_key in {"failed", "rejected"}:
            status_label = "Failed"
        elif status_key in {"pending_approval", "approved"}:
            status_label = "Warning"
        else:
            status_label = "Success"

        latest_approval = latest_approval_by_request.get(row.id)
        actor = row.executed_by or (latest_approval.decided_by if latest_approval else None) or row.requested_by
        detail = row.execution_result or row.reason or f"Restore request {status_value.lower()}"
        severity = _infer_severity(action_label, module_label, status_label, detail)
        sensitive = _sensitive_reason(action_label, module_label, status_label, detail)
        request_id = row.request_code or str(row.id)
        event_id = f"restore_request:{request_id}"
        events.append(
            {
                "event_id": event_id,
                "actor_user_id": actor.id if actor else None,
                "timestamp": _to_iso(ts_dt),
                "user": actor.full_name if actor and actor.full_name else (actor.username if actor else "System"),
                "role": _role_label_for_user(actor),
                "role_key": _role_key_for_user(actor),
                "action": action_label,
                "module": module_label,
                "target_record": row.backup_record.filename if row.backup_record else "Backup Restore Request",
                "old_value": None,
                "new_value": {
                    "request_id": request_id,
                    "status": status_value,
                    "filename": row.backup_record.filename if row.backup_record else None,
                },
                "ip_address": None,
                "device_info": None,
                "status": status_label,
                "severity": severity,
                "is_sensitive": bool(sensitive),
                "alert_reason": sensitive,
                "detail": str(detail or ""),
                "related": {
                    "invoice_id": None,
                    "repair_ticket_id": None,
                    "product_sku": None,
                    "customer_name": None,
                    "record_type": "BackupRestoreRequest",
                    "record_id": request_id,
                },
                "source": "restore_request",
                "archived": event_id in archived_ids,
                "archived_info": archived_meta.get(event_id),
            }
        )

    report_history_row = db.query(AppSetting).filter(AppSetting.key == REPORT_EXPORT_HISTORY_KEY).first()
    report_history = []
    if report_history_row and report_history_row.value:
        try:
            parsed_history = json.loads(report_history_row.value)
            if isinstance(parsed_history, list):
                report_history = [entry for entry in parsed_history if isinstance(entry, dict)]
        except Exception:
            report_history = []

    for idx, row in enumerate(report_history):
        ts = row.get("generated_at")
        ts_dt = _coerce_dt(ts) if ts else None
        if start_dt and ts_dt and ts_dt < start_dt:
            continue
        if end_dt and ts_dt and ts_dt >= end_dt:
            continue
        export_format = str(row.get("format") or "CSV").upper()
        action_label = "Print" if export_format == "PRINT" else "Export"
        module_label = "Reports"
        status_label = _normalize_status(str(row.get("status") or "success"))
        detail = row.get("notes") or f"{export_format} export from report center"
        severity = _infer_severity(action_label, module_label, status_label, detail)
        sensitive = _sensitive_reason(action_label, module_label, status_label, detail)
        event_id = f"report_export_history:{idx}"
        events.append(
            {
                "event_id": event_id,
                "actor_user_id": None,
                "timestamp": ts if isinstance(ts, str) else _to_iso(ts_dt),
                "user": row.get("generated_by") or "System",
                "role": "Staff",
                "role_key": "staff",
                "action": action_label,
                "module": module_label,
                "target_record": row.get("report_name") or "Report Export",
                "old_value": None,
                "new_value": {
                    "report_key": row.get("report_key"),
                    "format": export_format,
                    "status": row.get("status"),
                    "file_size": row.get("file_size"),
                },
                "ip_address": None,
                "device_info": None,
                "status": status_label,
                "severity": severity,
                "is_sensitive": bool(sensitive),
                "alert_reason": sensitive,
                "detail": detail,
                "related": {
                    "invoice_id": None,
                    "repair_ticket_id": None,
                    "product_sku": None,
                    "customer_name": None,
                    "record_type": "ReportExportHistory",
                    "record_id": idx,
                },
                "source": "report_export_history",
                "archived": event_id in archived_ids,
                "archived_info": archived_meta.get(event_id),
            }
        )

    for item in events:
        if item.get("ip_address") or item.get("device_info"):
            continue
        actor_user_id = item.get("actor_user_id")
        ts_dt = _coerce_dt(item.get("timestamp"))
        try:
            normalized_user_id = int(actor_user_id) if actor_user_id is not None else None
        except Exception:
            normalized_user_id = None
        ip_address, device_info = _nearest_security_context(security_by_user, normalized_user_id, ts_dt)
        if ip_address and not item.get("ip_address"):
            item["ip_address"] = ip_address
        if device_info and not item.get("device_info"):
            item["device_info"] = device_info

    def _matches_filters(item: dict[str, Any]) -> bool:
        if item.get("timestamp"):
            dt = _coerce_dt(item.get("timestamp"))
            if start_dt and dt and dt < start_dt:
                return False
            if end_dt and dt and dt >= end_dt:
                return False
        if user_filter and user_filter not in str(item.get("user") or "").lower():
            return False
        if role_filter and canonical_role_name(item.get("role_key")) != role_filter:
            return False
        if module_filter and module_filter not in str(item.get("module") or "").lower():
            return False
        if action_filter and action_filter not in str(item.get("action") or "").lower():
            return False
        if status_filter and status_filter != str(item.get("status") or "").lower():
            return False

        related = item.get("related") or {}
        if invoice_filter and invoice_filter not in str(related.get("invoice_id") or "").lower():
            return False
        if repair_filter and repair_filter not in str(related.get("repair_ticket_id") or "").lower():
            return False
        if sku_filter and sku_filter not in str(related.get("product_sku") or "").lower():
            return False
        if customer_filter and customer_filter not in str(related.get("customer_name") or "").lower():
            return False

        if only_sensitive and not bool(item.get("is_sensitive")):
            return False

        if search_filter:
            hay = " ".join(
                [
                    str(item.get("user") or ""),
                    str(item.get("role") or ""),
                    str(item.get("action") or ""),
                    str(item.get("module") or ""),
                    str(item.get("target_record") or ""),
                    str(item.get("detail") or ""),
                    str(item.get("status") or ""),
                    str(related.get("invoice_id") or ""),
                    str(related.get("repair_ticket_id") or ""),
                    str(related.get("product_sku") or ""),
                    str(related.get("customer_name") or ""),
                ]
            ).lower()
            if search_filter not in hay:
                return False

        return True

    filtered = [row for row in events if _matches_filters(row)]
    filtered.sort(key=lambda row: _coerce_dt(row.get("timestamp")) or datetime.min, reverse=True)
    if not include_archived:
        filtered = [row for row in filtered if not row.get("archived")]
    total_after_filters = len(filtered)
    truncated = total_after_filters > limit
    if truncated:
        filtered = filtered[:limit]

    today_key = now.date().isoformat()
    todays_activities = 0
    failed_login_attempts = 0
    stock_changes = 0
    invoice_voids = 0
    permission_changes = 0
    deleted_records = 0
    security_alerts = []

    module_counts = {name: 0 for name in TRACKED_MODULES}
    action_counts: dict[str, int] = {}

    for row in filtered:
        ts = row.get("timestamp")
        if ts and str(ts).startswith(today_key):
            todays_activities += 1
        action_name = str(row.get("action") or "")
        module_name = str(row.get("module") or "")

        module_counts[module_name] = module_counts.get(module_name, 0) + 1
        action_counts[action_name] = action_counts.get(action_name, 0) + 1

        if action_name == "Failed Login":
            failed_login_attempts += 1
        if module_name == "Inventory" and action_name in {"Stock Adjustment", "Stock Reduction"}:
            stock_changes += 1
        if action_name == "Void Invoice":
            invoice_voids += 1
        if action_name == "Permission Change":
            permission_changes += 1
        if action_name in {"Delete", "Soft Delete"}:
            deleted_records += 1
        if row.get("is_sensitive"):
            security_alerts.append(row)

    security_alerts = security_alerts[:200]

    return {
        "summary": {
            "todays_activities": todays_activities,
            "failed_login_attempts": failed_login_attempts,
            "stock_changes": stock_changes,
            "invoice_voids": invoice_voids,
            "permission_changes": permission_changes,
            "deleted_records": deleted_records,
        },
        "rows": filtered,
        "security_alerts": security_alerts,
        "module_counts": module_counts,
        "action_counts": action_counts,
        "tracked_modules": TRACKED_MODULES,
        "meta": {
            "generated_at": _to_iso(now),
            "total_events_collected": len(events),
            "total_events_after_filters": total_after_filters,
            "returned_rows": len(filtered),
            "truncated": bool(truncated),
            "archived_events_count": len(archived_ids),
            "include_archived": bool(include_archived),
            "owner_admin_only": True,
            "limit": int(limit),
            "source_limit": int(source_limit),
        },
    }


@router.post("/archive", dependencies=[Depends(require_permission("audit.archive"))])
def archive_audit_events(
    payload: ArchiveEventsIn,
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    _require_owner_or_admin(current)
    event_ids = [str(item).strip() for item in (payload.event_ids or []) if str(item).strip()]
    if not event_ids:
        raise HTTPException(status_code=400, detail="event_ids is required")
    archived_map = _load_archived_meta(db)
    archived_at = _to_iso(utcnow())
    actor = {
        "user_id": current.id,
        "username": current.username,
        "full_name": current.full_name,
        "role": canonical_role_name(current.role),
    }
    for event_id in event_ids:
        archived_map[event_id] = {
            "archived_at": archived_at,
            "archived_by": actor,
            "reason": str(payload.reason or "").strip() or None,
        }
    _save_archived_meta(db, archived_map)
    record_security_audit(
        db=db,
        action="edit",
        user_id=current.id,
        target_type="audit_logs",
        target_ref="archive",
        detail=f"Archived {len(event_ids)} audit event(s)",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
        metadata={
            "event_ids": event_ids[:200],
            "total_events": len(event_ids),
            "reason": str(payload.reason or "").strip() or None,
        },
    )
    return {
        "ok": True,
        "archived_count": len(event_ids),
        "total_archived": len(archived_map),
    }


@router.post("/export", dependencies=[Depends(require_permission("audit.export"))])
def log_audit_export(
    payload: AuditExportIn,
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    _require_owner_or_admin(current)
    export_format = str(payload.export_format or "CSV").strip().upper()
    if export_format not in {"CSV", "PDF", "PRINT"}:
        raise HTTPException(status_code=400, detail="export_format must be CSV, PDF, or PRINT")
    action = "print" if export_format == "PRINT" else "export"
    record_security_audit(
        db=db,
        action=action,
        user_id=current.id,
        target_type="audit_logs",
        target_ref=f"audit_trail_{export_format.lower()}",
        detail=f"Audit trail exported as {export_format}",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
        metadata={
            "format": export_format,
            "row_count": int(payload.row_count or 0),
            "date_from": payload.date_from,
            "date_to": payload.date_to,
            "filters": payload.filters or {},
        },
    )
    return {"ok": True, "logged": True}
