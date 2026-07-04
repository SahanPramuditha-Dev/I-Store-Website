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
    except Exception:
        pass
    _RUNTIME_SCHEMA_READY = True


def _exists_recent(
    db: Session,
    *,
    notif_type: str,
    title: str,
    entity_type: str | None,
    entity_id: int | None,
    since: datetime,
) -> bool:
    query = db.query(Notification).filter(
        Notification.type == notif_type,
        Notification.title == title,
        Notification.created_at >= since,
    )
    if entity_type is None:
        query = query.filter(Notification.entity_type.is_(None))
    else:
        query = query.filter(Notification.entity_type == entity_type)
    if entity_id is None:
        query = query.filter(Notification.entity_id.is_(None))
    else:
        query = query.filter(Notification.entity_id == entity_id)
    return query.first() is not None


def _add_notification(
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
    dedupe_since = utcnow() - timedelta(hours=24)
    if _exists_recent(
        db,
        notif_type=notif_type,
        title=title,
        entity_type=entity_type,
        entity_id=entity_id,
        since=dedupe_since,
    ):
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
            created_at=utcnow(),
        )
    )
    return True


def _refresh_notifications(db: Session) -> dict:
    _ensure_runtime_schema(db)
    now = _normalize_naive_utc(utcnow()) or utcnow()
    created = 0

    low_stock_items = (
        db.query(InventoryItem)
        .filter(InventoryItem.quantity <= InventoryItem.low_stock_threshold)
        .order_by(InventoryItem.quantity.asc())
        .limit(50)
        .all()
    )
    for item in low_stock_items:
        title = f"Low Stock: {item.name}"
        message = f"{item.name} stock is {int(item.quantity or 0)} (threshold {int(item.low_stock_threshold or 0)})."
        if _add_notification(
            db,
            notif_type="Low Stock",
            title=title,
            message=message,
            severity="high" if int(item.quantity or 0) <= 0 else "medium",
            source_module="inventory",
            entity_type="InventoryItem",
            entity_id=item.id,
        ):
            created += 1

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
    for repair in overdue_repairs:
        eta = _normalize_naive_utc(repair.estimated_completion)
        if isinstance(eta, str):
            eta = _parse_dt(eta)
        if not isinstance(eta, datetime):
            continue
        overdue_days = max(0, int((now - eta).total_seconds() // 86400))
        escalation_level = 2 if overdue_days >= 3 else (1 if overdue_days >= 1 else 0)
        severity = "critical" if escalation_level >= 2 else "high"
        title = f"Overdue Repair: {repair.ticket_no}"
        message = f"Repair {repair.ticket_no} for {repair.device_model} is overdue by {overdue_days} day(s)."
        if _add_notification(
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
    for sale in pending_sales:
        invoice_no = sale.invoice_no or f"INV-{sale.id:05d}"
        balance_due = round(float(sale.balance_due or max(0.0, float(sale.total or 0))), 2)
        title = f"Pending Balance: {invoice_no}"
        message = f"Invoice {invoice_no} has outstanding payment of LKR {balance_due:,.2f}."
        if _add_notification(
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
    for warranty in expiring_warranties:
        end_date = _normalize_naive_utc(warranty.end_date)
        if isinstance(end_date, str):
            end_date = _parse_dt(end_date)
        if not isinstance(end_date, datetime):
            continue
        title = f"Warranty Expiry: {warranty.warranty_code}"
        message = (
            f"Warranty {warranty.warranty_code} for {warranty.product_or_service_name} "
            f"expires on {end_date.date().isoformat()}."
        )
        if _add_notification(
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

    last_backup_row = db.query(AppSetting).filter(AppSetting.key == "last_backup_at").first()
    last_backup_at = _parse_dt(last_backup_row.value if last_backup_row else None)
    last_backup_at = _normalize_naive_utc(last_backup_at)
    if not last_backup_at or (now - last_backup_at) > timedelta(hours=48):
        title = "Backup Stale"
        message = (
            "No successful backup found in the last 48 hours."
            if not last_backup_at
            else f"Last backup was at {last_backup_at.isoformat()}."
        )
        if _add_notification(
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
    return (
        db.query(Notification)
        .filter(Notification.is_archived == False)  # noqa: E712
        .order_by(Notification.created_at.desc())
        .limit(100)
        .all()
    )


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
