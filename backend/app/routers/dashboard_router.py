from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import timedelta
from app.database import get_db
from app.auth import get_current_user, require_permission
from app.constants import (
    REPAIR_STATUSES,
    REPAIR_STATUS_COMPLETED,
    REPAIR_STATUS_DELIVERED,
    REPAIR_STATUS_LABELS,
    normalize_repair_status,
)
from app.models import Sale, RepairTicket, InventoryItem, ActivityLog, Customer, SaleItem
from app.utils.time import utcnow

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

@router.get('', dependencies=[Depends(require_permission("dashboard.view"))])
def dashboard(db: Session = Depends(get_db), _=Depends(get_current_user)):
    now = utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    valid_sales_filter = [Sale.is_voided == False, Sale.is_return == False]  # noqa: E712
    daily_revenue = (
        db.query(func.coalesce(func.sum(Sale.total), 0))
        .filter(*valid_sales_filter, Sale.created_at >= today_start)
        .scalar()
        or 0
    )
    total_repairs = db.query(func.count(RepairTicket.id)).filter(RepairTicket.is_deleted == False).scalar() or 0  # noqa: E712
    completed_repairs = (
        db.query(func.count(RepairTicket.id))
        .filter(
            RepairTicket.is_deleted == False,  # noqa: E712
            RepairTicket.status.in_([REPAIR_STATUS_COMPLETED, REPAIR_STATUS_DELIVERED]),
        )
        .scalar()
        or 0
    )
    customers_count = db.query(func.count(Customer.id)).filter(Customer.is_deleted == False).scalar() or 0  # noqa: E712

    low_stock_items = (
        db.query(InventoryItem)
        .filter(InventoryItem.is_deleted == False, InventoryItem.quantity <= InventoryItem.low_stock_threshold)  # noqa: E712
        .order_by(InventoryItem.quantity.asc())
        .limit(20)
        .all()
    )
    recent_sales = db.query(Sale).filter(*valid_sales_filter).order_by(Sale.created_at.desc()).limit(10).all()
    recent_repairs = (
        db.query(RepairTicket)
        .filter(RepairTicket.is_deleted == False)  # noqa: E712
        .order_by(RepairTicket.created_at.desc())
        .limit(8)
        .all()
    )

    # Monthly Revenue (Last 7 months)
    import calendar
    monthly_rev = []
    for i in range(6, -1, -1):
        target_date = now - timedelta(days=i*30)
        m_start = target_date.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if m_start.month == 12:
            m_end = m_start.replace(year=m_start.year+1, month=1)
        else:
            m_end = m_start.replace(month=m_start.month+1)
        
        m_label = m_start.strftime("%b")
        val = (
            db.query(func.coalesce(func.sum(Sale.total), 0))
            .filter(*valid_sales_filter, Sale.created_at >= m_start, Sale.created_at < m_end)
            .scalar()
            or 0
        )
        monthly_rev.append({"name": m_label, "value": val})

    product_revenue = (
        db.query(func.coalesce(func.sum(SaleItem.quantity * SaleItem.price), 0))
        .join(Sale, Sale.id == SaleItem.sale_id)
        .filter(*valid_sales_filter, SaleItem.line_type == "product")
        .scalar()
        or 0
    )
    spare_part_revenue = (
        db.query(func.coalesce(func.sum(SaleItem.quantity * SaleItem.price), 0))
        .join(Sale, Sale.id == SaleItem.sale_id)
        .filter(*valid_sales_filter, SaleItem.line_type == "spare_part")
        .scalar()
        or 0
    )
    repair_revenue = (
        db.query(func.coalesce(func.sum(SaleItem.quantity * SaleItem.price), 0))
        .join(Sale, Sale.id == SaleItem.sale_id)
        .filter(
            *valid_sales_filter,
            (Sale.repair_ticket_id.isnot(None)) | (SaleItem.line_type.in_(["labor", "service"])),
        )
        .scalar()
        or 0
    )

    outstanding_balance = (
        db.query(func.coalesce(func.sum(Sale.balance_due), 0))
        .filter(*valid_sales_filter, Sale.balance_due > 0)
        .scalar()
        or 0
    )

    # Activity Feed
    logs = db.query(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(10).all()
    activity_feed = []
    for l in logs:
        user_label = getattr(l, "user_name", None)
        if not user_label:
            if getattr(l, "user", None):
                user_label = l.user.full_name or l.user.username
            elif getattr(l, "user_id", None):
                user_label = f"User #{l.user_id}"
            else:
                user_label = "System"

        module_label = getattr(l, "module", None) or getattr(l, "entity_type", None) or "General"
        details_text = getattr(l, "details", None) or getattr(l, "description", None) or ""
        ts = l.created_at.isoformat() if getattr(l, "created_at", None) else now.isoformat()

        activity_feed.append({
            "id": l.id,
            "action": l.action,
            "module": module_label,
            "user": user_label,
            "timestamp": ts,
            "details": details_text
        })
        
    if not activity_feed:
        # Fallback to recent repairs and sales if no explicit activity logs
        for r in recent_repairs[:3]:
            activity_feed.append({"id": f"r{r.id}", "action": f"Repair ticket {r.ticket_no} created", "module": "REPAIR", "timestamp": r.created_at.isoformat(), "details": r.issue})
        for s in recent_sales[:3]:
            activity_feed.append({"id": f"s{s.id}", "action": f"Sale completed LKR {s.total:,.0f}", "module": "POS", "timestamp": s.created_at.isoformat(), "details": s.payment_method})
        activity_feed.sort(key=lambda x: x["timestamp"], reverse=True)

    grouped_status_rows = (
        db.query(RepairTicket.status, func.count(RepairTicket.id))
        .filter(RepairTicket.is_deleted == False)  # noqa: E712
        .group_by(RepairTicket.status)
        .all()
    )
    normalized_counts = {status: 0 for status in REPAIR_STATUSES}
    for raw_status, cnt in grouped_status_rows:
        normalized = normalize_repair_status(raw_status)
        if normalized in normalized_counts:
            normalized_counts[normalized] += int(cnt or 0)

    repair_status_distribution = [
        {
            "name": REPAIR_STATUS_LABELS.get(status, status.replace("_", " ").title()),
            "value": int(normalized_counts.get(status, 0)),
        }
        for status in REPAIR_STATUSES
    ]

    return {
        "daily_revenue": daily_revenue,
        "repair_stats": {"total": total_repairs, "completed": completed_repairs},
        "customers_count": customers_count,
        "low_stock_count": len(low_stock_items),
        "outstanding_balance": float(outstanding_balance or 0),
        "low_stock_items": [{"id": i.id, "name": i.name, "quantity": i.quantity} for i in low_stock_items],
        "recent_transactions": [{"id": s.id, "invoice_no": (s.invoice_no or f"INV-{s.id:05d}"), "total": s.total, "date": s.created_at.isoformat()} for s in recent_sales],
        "recent_repairs": [{
            "id": r.id,
            "customer": r.customer.name if r.customer else None,
            "device": r.device_model,
            "status": normalize_repair_status(r.status),
            "tech": r.technician or "Unknown"
        } for r in recent_repairs],
        "activity_feed": activity_feed,
        "charts": {
            "revenue_overview": monthly_rev,
            "sales_breakdown": [
                {"name": "Product Sales", "value": float(product_revenue or 0)},
                {"name": "Spare Parts", "value": float(spare_part_revenue or 0)},
                {"name": "Repair Services", "value": float(repair_revenue or 0)},
            ],
            "repair_status": repair_status_distribution,
        }
    }
