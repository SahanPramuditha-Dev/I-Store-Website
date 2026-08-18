from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import and_, func, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_permission
from app.constants import REPAIR_STATUS_CANCELLED, REPAIR_STATUS_DELIVERED
from app.database import get_db
from app.models import AppSetting, InventoryItem, Notification, RepairTicket, Sale, WarrantyRecord
from app.utils.time import utcnow

router = APIRouter(prefix="/notifications", tags=["notifications"])
_RUNTIME_SCHEMA_READY = False


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1]
    try:
        return _normalize_naive_utc(datetime.fromisoformat(text))
    except Exception:
        return None


def _normalize_naive_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is not None and value.utcoffset() is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _sqlite_table_exists(db: Session, table_name: str) -> bool:
    from sqlalchemy import inspect as sa_inspect
    try:
        inspector = sa_inspect(db.bind)
        return inspector.has_table(table_name)
    except Exception:
        try:
            db.execute(text(f"SELECT 1 FROM {table_name} LIMIT 1"))
            return True
        except Exception:
            return False


def _ensure_runtime_schema(db: Session) -> None:
    global _RUNTIME_SCHEMA_READY
    if _RUNTIME_SCHEMA_READY:
        return

    from sqlalchemy import inspect as sa_inspect
    required_columns = {
        "notifications": {
            "read_at": "DATETIME",
            "is_acknowledged": "BOOLEAN DEFAULT 0",
            "acknowledged_at": "DATETIME",
            "acknowledged_by_user_id": "INTEGER",
            "is_archived": "BOOLEAN DEFAULT 0",
            "archived_at": "DATETIME",
            "archived_by_user_id": "INTEGER",
            "severity": "TEXT DEFAULT 'medium'",
            "source_module": "TEXT",
            "escalation_level": "INTEGER DEFAULT 0",
            "due_at": "DATETIME",
        },
        "sales": {
            "invoice_no": "TEXT",
            "amount_paid": "REAL DEFAULT 0",
            "balance_due": "REAL DEFAULT 0",
            "payment_status": "TEXT DEFAULT 'paid'",
            "is_return": "BOOLEAN DEFAULT 0",
            "paid": "BOOLEAN DEFAULT 1",
            "is_voided": "BOOLEAN DEFAULT 0",
        },
    }

    try:
        inspector = sa_inspect(db.bind)
        for table_name, cols in required_columns.items():
            if not _sqlite_table_exists(db, table_name):
                continue
            existing = {col["name"] for col in inspector.get_columns(table_name)}
            for column, col_type in cols.items():
                if column not in existing:
                    type_str = col_type
                    if "DATETIME" in col_type.upper():
                        type_str = col_type.upper().replace("DATETIME", "TIMESTAMP")
                    db.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column} {type_str}"))
        db.commit()
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.warning(f"Runtime schema migration warning: {e}")
    _RUNTIME_SCHEMA_READY = True


import re


def _clean_human_message(msg: str | None) -> str:
    if not msg:
        return ""

    def _replace_iso(m):
        raw = m.group(0)
        try:
            dt = datetime.fromisoformat(raw)
            return dt.strftime("%b %d, %Y at %I:%M %p")
        except Exception:
            return raw

    return re.sub(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?", _replace_iso, str(msg))


def _cleanup_existing_duplicates_and_messages(db: Session) -> None:
    all_open = (
        db.query(Notification)
        .filter(Notification.is_archived == False)  # noqa: E712
        .order_by(Notification.created_at.desc())
        .all()
    )
    seen_keys = set()
    for row in all_open:
        if row.entity_type and row.entity_id is not None:
            key = (row.source_module or "", row.entity_type, row.entity_id)
        else:
            key = (row.source_module or "", row.title)

        if key in seen_keys:
            row.is_archived = True
            row.archived_at = utcnow()
        else:
            seen_keys.add(key)
            if row.message:
                row.message = _clean_human_message(row.message)


def _serialize_notification(row: Notification) -> dict:
    source = str(row.source_module or "system").lower()
    notif_type = str(row.type or "").lower()

    action_url = "/notifications"
    action_label = "View"

    if source == "backup" or "backup" in notif_type:
        action_url = "/settings"
        action_label = "Backup Settings"
    elif source == "inventory" or "stock" in notif_type:
        action_url = "/inventory/products"
        action_label = "View Stock"
    elif source == "repairs" or "repair" in notif_type:
        action_url = "/repairs"
        action_label = "View Repair"
    elif source == "pos" or "payment" in notif_type or "balance" in notif_type:
        action_url = "/pos"
        action_label = "Open POS"
    elif source == "warranty" or "warranty" in notif_type:
        action_url = "/warranty"
        action_label = "View Warranty"

    clean_msg = _clean_human_message(row.message)

    return {
        "id": row.id,
        "type": row.type,
        "title": row.title,
        "message": clean_msg,
        "is_read": bool(row.is_read),
        "read_at": row.read_at.isoformat() if row.read_at else None,
        "is_acknowledged": bool(row.is_acknowledged),
        "acknowledged_at": row.acknowledged_at.isoformat() if row.acknowledged_at else None,
        "acknowledged_by_user_id": row.acknowledged_by_user_id,
        "severity": row.severity or "medium",
        "source_module": row.source_module or "system",
        "escalation_level": row.escalation_level or 0,
        "due_at": row.due_at.isoformat() if row.due_at else None,
        "entity_type": row.entity_type,
        "entity_id": row.entity_id,
        "is_archived": bool(row.is_archived),
        "archived_at": row.archived_at.isoformat() if row.archived_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "action_url": action_url,
        "action_label": action_label,
    }


def _add_or_update_notification(
    db: Session,
    *,
    notif_type: str,
    title: str,
    message: str,
    severity: str = "medium",
    source_module: str = "general",
    escalation_level: int = 0,
    due_at: datetime | None = None,
    entity_type: str | None = None,
    entity_id: int | None = None,
) -> bool:
    query = db.query(Notification).filter(
        Notification.is_archived == False,  # noqa: E712
        Notification.type == notif_type,
    )
    if entity_type is not None and entity_id is not None:
        query = query.filter(
            Notification.entity_type == entity_type,
            Notification.entity_id == entity_id,
        )
    else:
        query = query.filter(Notification.title == title)

    existing_items = query.order_by(Notification.created_at.desc()).all()
    if existing_items:
        primary = existing_items[0]
        primary.title = title
        primary.message = message
        primary.severity = str(severity or "medium").lower()
        primary.source_module = source_module
        primary.escalation_level = int(escalation_level or 0)
        primary.due_at = due_at

        # Soft-archive any redundant duplicates that piled up previously
        for duplicate in existing_items[1:]:
            duplicate.is_archived = True
            duplicate.archived_at = utcnow()
        return False

    db.add(
        Notification(
            type=notif_type,
            title=title,
            message=message,
            severity=str(severity or "medium").lower(),
            source_module=source_module,
            escalation_level=int(escalation_level or 0),
            due_at=due_at,
            entity_type=entity_type,
            entity_id=entity_id,
            is_read=False,
            is_acknowledged=False,
            is_archived=False,
            created_at=utcnow(),
        )
    )
    return True


def _refresh_notifications(db: Session) -> dict:
    _ensure_runtime_schema(db)
    now = _normalize_naive_utc(utcnow()) or utcnow()
    created = 0

    # 1. Low stock check
    low_stock_items = (
        db.query(InventoryItem)
        .filter(InventoryItem.quantity <= InventoryItem.low_stock_threshold)
        .order_by(InventoryItem.quantity.asc())
        .limit(50)
        .all()
    )
    active_low_stock_ids = set()
    for item in low_stock_items:
        active_low_stock_ids.add(item.id)
        title = f"Low Stock: {item.name}"
        qty = int(item.quantity or 0)
        threshold = int(item.low_stock_threshold or 0)
        message = f"{item.name} stock is {qty} (minimum threshold is {threshold})."
        if _add_or_update_notification(
            db,
            notif_type="Low Stock",
            title=title,
            message=message,
            severity="critical" if qty <= 0 else ("high" if qty <= threshold / 2 else "medium"),
            source_module="inventory",
            entity_type="InventoryItem",
            entity_id=item.id,
        ):
            created += 1

    # 2. Overdue repairs check
    overdue_repairs = (
        db.query(RepairTicket)
        .filter(
            RepairTicket.estimated_completion.isnot(None),
            RepairTicket.estimated_completion < now,
            func.lower(func.trim(RepairTicket.status)).notin_([REPAIR_STATUS_DELIVERED, REPAIR_STATUS_CANCELLED]),
        )
        .order_by(RepairTicket.estimated_completion.asc())
        .limit(50)
        .all()
    )
    active_overdue_repair_ids = set()
    for repair in overdue_repairs:
        eta = _normalize_naive_utc(repair.estimated_completion)
        if isinstance(eta, str):
            eta = _parse_dt(eta)
        if not isinstance(eta, datetime):
            continue
        active_overdue_repair_ids.add(repair.id)
        overdue_days = max(0, int((now - eta).total_seconds() // 86400))
        escalation_level = 2 if overdue_days >= 3 else (1 if overdue_days >= 1 else 0)
        severity = "critical" if escalation_level >= 2 else "high"
        title = f"Overdue Repair: {repair.ticket_no}"
        eta_formatted = eta.strftime("%b %d, %Y")
        message = f"Repair {repair.ticket_no} for {repair.device_model or 'Device'} is overdue by {overdue_days} day(s) (ETA was {eta_formatted})."
        if _add_or_update_notification(
            db,
            notif_type="Overdue Repair",
            title=title,
            message=message,
            severity=severity,
            source_module="repairs",
            escalation_level=escalation_level,
            due_at=eta,
            entity_type="RepairTicket",
            entity_id=repair.id,
        ):
            created += 1

    # 3. Pending balance on sales
    pending_sales = (
        db.query(Sale)
        .filter(
            Sale.paid == False,  # noqa: E712
            Sale.is_voided == False,  # noqa: E712
            Sale.is_return == False,  # noqa: E712
            Sale.balance_due > 0,
        )
        .order_by(Sale.created_at.desc())
        .limit(50)
        .all()
    )
    active_pending_sale_ids = set()
    for sale in pending_sales:
        active_pending_sale_ids.add(sale.id)
        invoice_no = sale.invoice_no or f"INV-{sale.id:05d}"
        balance_due = round(float(sale.balance_due or max(0.0, float(sale.total or 0))), 2)
        title = f"Pending Balance: {invoice_no}"
        message = f"Invoice {invoice_no} has outstanding payment of LKR {balance_due:,.2f}."
        if _add_or_update_notification(
            db,
            notif_type="Pending Balance",
            title=title,
            message=message,
            severity="high" if balance_due > 0 else "medium",
            source_module="pos",
            entity_type="Sale",
            entity_id=sale.id,
        ):
            created += 1

    # 4. Warranty expiry check
    warranty_horizon = now + timedelta(days=7)
    expiring_warranties = (
        db.query(WarrantyRecord)
        .filter(
            func.lower(func.trim(WarrantyRecord.status)) == "active",
            WarrantyRecord.end_date.isnot(None),
            and_(WarrantyRecord.end_date >= now, WarrantyRecord.end_date <= warranty_horizon),
        )
        .order_by(WarrantyRecord.end_date.asc())
        .limit(50)
        .all()
    )
    active_warranty_ids = set()
    for warranty in expiring_warranties:
        end_date = _normalize_naive_utc(warranty.end_date)
        if isinstance(end_date, str):
            end_date = _parse_dt(end_date)
        if not isinstance(end_date, datetime):
            continue
        active_warranty_ids.add(warranty.id)
        title = f"Warranty Expiry: {warranty.warranty_code}"
        end_date_str = end_date.strftime("%b %d, %Y")
        message = (
            f"Warranty {warranty.warranty_code} for {warranty.product_or_service_name or 'Item'} "
            f"expires on {end_date_str}."
        )
        if _add_or_update_notification(
            db,
            notif_type="Warranty Expiry",
            title=title,
            message=message,
            severity="medium",
            source_module="warranty",
            due_at=end_date,
            entity_type="WarrantyRecord",
            entity_id=warranty.id,
        ):
            created += 1

    # 5. Backup freshness check (based on verified recovery point)
    last_verified_row = db.query(AppSetting).filter(AppSetting.key == "last_verified_backup_at").first()
    if not last_verified_row or not last_verified_row.value:
        last_verified_row = db.query(AppSetting).filter(AppSetting.key == "last_backup_at").first()

    last_backup_at = _parse_dt(last_verified_row.value if last_verified_row else None)
    last_backup_at = _normalize_naive_utc(last_backup_at)
    backup_is_stale = not last_backup_at or (now - last_backup_at) > timedelta(hours=48)
    if backup_is_stale:
        title = "Backup Stale"
        if not last_backup_at:
            message = "No verified recovery point recorded in the system."
        else:
            delta = now - last_backup_at
            days = delta.days
            hours = int(delta.seconds // 3600)
            time_ago = f"{days}d ago" if days > 0 else f"{hours}h ago"
            formatted_time = last_backup_at.strftime("%b %d, %Y at %I:%M %p")
            message = f"Last verified backup was {time_ago} ({formatted_time})."
        if _add_or_update_notification(
            db,
            notif_type="Backup Warning",
            title=title,
            message=message,
            severity="critical",
            source_module="backup",
            entity_type="Backup",
            entity_id=None,
        ):
            created += 1

    # AUTO-RESOLVE: Archive alerts that have resolved
    auto_resolved_at = utcnow()
    # Archive replenished low-stock alerts
    db.query(Notification).filter(
        Notification.is_archived == False,  # noqa: E712
        Notification.type == "Low Stock",
        Notification.entity_type == "InventoryItem",
        Notification.entity_id.notin_(active_low_stock_ids) if active_low_stock_ids else True,
    ).update({"is_archived": True, "archived_at": auto_resolved_at}, synchronize_session=False)

    # Archive completed/cancelled/on-time overdue repair alerts
    db.query(Notification).filter(
        Notification.is_archived == False,  # noqa: E712
        Notification.type == "Overdue Repair",
        Notification.entity_type == "RepairTicket",
        Notification.entity_id.notin_(active_overdue_repair_ids) if active_overdue_repair_ids else True,
    ).update({"is_archived": True, "archived_at": auto_resolved_at}, synchronize_session=False)

    # Archive paid/settled sale alerts
    db.query(Notification).filter(
        Notification.is_archived == False,  # noqa: E712
        Notification.type == "Pending Balance",
        Notification.entity_type == "Sale",
        Notification.entity_id.notin_(active_pending_sale_ids) if active_pending_sale_ids else True,
    ).update({"is_archived": True, "archived_at": auto_resolved_at}, synchronize_session=False)

    # Archive resolved backup alerts if backup is now fresh
    if not backup_is_stale:
        db.query(Notification).filter(
            Notification.is_archived == False,  # noqa: E712
            Notification.source_module == "backup",
        ).update({"is_archived": True, "archived_at": auto_resolved_at}, synchronize_session=False)

    # Clean up any leftover historical duplicates and sanitize message timestamps in DB
    _cleanup_existing_duplicates_and_messages(db)

    db.commit()
    return {
        "created": created,
        "low_stock_count": len(low_stock_items),
        "overdue_repairs_count": len(overdue_repairs),
        "pending_sales_count": len(pending_sales),
        "warranty_expiry_count": len(expiring_warranties),
    }


@router.get("", dependencies=[Depends(require_permission("notifications.view"))])
def list_notifications(db: Session = Depends(get_db), _=Depends(get_current_user)):
    try:
        _refresh_notifications(db)
    except OperationalError:
        db.rollback()
        global _RUNTIME_SCHEMA_READY
        _RUNTIME_SCHEMA_READY = False
        _ensure_runtime_schema(db)
        _refresh_notifications(db)
    rows = (
        db.query(Notification)
        .filter(Notification.is_archived == False)  # noqa: E712
        .order_by(Notification.created_at.desc())
        .limit(100)
        .all()
    )
    return [_serialize_notification(r) for r in rows]


@router.post("/refresh", dependencies=[Depends(require_permission("notifications.create"))])
def refresh_notifications(db: Session = Depends(get_db), _=Depends(get_current_user)):
    try:
        return _refresh_notifications(db)
    except OperationalError:
        db.rollback()
        global _RUNTIME_SCHEMA_READY
        _RUNTIME_SCHEMA_READY = False
        _ensure_runtime_schema(db)
        return _refresh_notifications(db)


@router.put("/{nid}/read", dependencies=[Depends(require_permission("notifications.acknowledge"))])
def mark_read(nid: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    _ensure_runtime_schema(db)
    n = db.query(Notification).filter(Notification.id == nid).first()
    if n:
        n.is_read = True
        n.read_at = utcnow()
        db.commit()
    return {"ok": True}


@router.put("/read-all", dependencies=[Depends(require_permission("notifications.acknowledge"))])
def mark_all_read(db: Session = Depends(get_db), _=Depends(get_current_user)):
    _ensure_runtime_schema(db)
    db.query(Notification).filter(Notification.is_read == False).update(  # noqa: E712
        {"is_read": True, "read_at": utcnow()}
    )
    db.commit()
    return {"ok": True}


@router.put("/{nid}/ack", dependencies=[Depends(require_permission("notifications.acknowledge"))])
def acknowledge_notification(nid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    _ensure_runtime_schema(db)
    row = db.query(Notification).filter(Notification.id == nid).first()
    if not row:
        return {"ok": True, "missing": True}
    row.is_acknowledged = True
    row.acknowledged_at = utcnow()
    row.acknowledged_by_user_id = user.id if user else None
    if not row.is_read:
        row.is_read = True
        row.read_at = utcnow()
    db.commit()
    return {"ok": True, "acknowledged": True}


@router.put("/ack-all", dependencies=[Depends(require_permission("notifications.acknowledge"))])
def acknowledge_all_notifications(db: Session = Depends(get_db), user=Depends(get_current_user)):
    _ensure_runtime_schema(db)
    db.query(Notification).filter(Notification.is_acknowledged == False).update(  # noqa: E712
        {
            "is_acknowledged": True,
            "acknowledged_at": utcnow(),
            "acknowledged_by_user_id": user.id if user else None,
        }
    )
    db.query(Notification).filter(Notification.is_read == False).update(  # noqa: E712
        {"is_read": True, "read_at": utcnow()}
    )
    db.commit()
    return {"ok": True}


@router.delete("/clear-all", dependencies=[Depends(require_permission("notifications.clear"))])
def clear_all(db: Session = Depends(get_db), user=Depends(get_current_user)):
    _ensure_runtime_schema(db)
    db.query(Notification).filter(Notification.is_archived == False).update(  # noqa: E712
        {
            "is_read": True,
            "read_at": utcnow(),
            "is_acknowledged": True,
            "acknowledged_at": utcnow(),
            "acknowledged_by_user_id": user.id if user else None,
            "is_archived": True,
            "archived_at": utcnow(),
            "archived_by_user_id": user.id if user else None,
        }
    )
    db.commit()
    return {"ok": True}

