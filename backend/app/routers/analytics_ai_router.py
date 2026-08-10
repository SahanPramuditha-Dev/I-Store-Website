from datetime import datetime, date, timedelta
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text, func

from app.database import get_db
from app.models import Sale, InventoryItem, Customer, RepairTicket, InventoryLedger
from app.auth import get_current_user, require_permission

router = APIRouter(prefix="/api/analytics", tags=["AI Analytics & Reporting"])


@router.get("/today-sales", response_model=Dict[str, Any], dependencies=[Depends(require_permission("reports.view"))])
def get_today_sales_analytics(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """AI Query Endpoint: What were today's sales?"""
    today_start = datetime.combine(date.today(), datetime.min.time())
    sales_query = db.query(
        func.coalesce(func.sum(Sale.total), 0.0).label("total_sales"),
        func.count(Sale.id).label("total_orders"),
        func.coalesce(func.sum(Sale.tax_amount), 0.0).label("total_tax"),
        func.coalesce(func.sum(Sale.discount_amount), 0.0).label("total_discounts"),
    ).filter(Sale.created_at >= today_start, Sale.is_voided == False).first()

    return {
        "date": date.today().isoformat(),
        "total_sales": float(sales_query.total_sales or 0.0),
        "total_orders": int(sales_query.total_orders or 0),
        "total_tax": float(sales_query.total_tax or 0.0),
        "total_discounts": float(sales_query.total_discounts or 0.0),
    }


@router.get("/low-stock", response_model=List[Dict[str, Any]], dependencies=[Depends(require_permission("inventory.view"))])
def get_low_stock_analytics(
    threshold: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """AI Query Endpoint: Which products have low stock?"""
    query = db.query(InventoryItem).filter(
        InventoryItem.is_deleted == False,
        InventoryItem.quantity <= func.coalesce(threshold, InventoryItem.low_stock_threshold),
    )
    items = query.all()
    return [
        {
            "id": item.id,
            "uuid": getattr(item, "uuid", None),
            "name": item.name,
            "sku": item.sku,
            "current_stock": item.quantity,
            "low_stock_threshold": item.low_stock_threshold,
            "category": item.category,
        }
        for item in items
    ]


@router.get("/unpaid-balances", response_model=List[Dict[str, Any]], dependencies=[Depends(require_permission("customers.view"))])
def get_unpaid_customer_balances(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """AI Query Endpoint: Which customers have unpaid balances?"""
    rows = (
        db.query(
            Sale.customer_id,
            func.coalesce(func.sum(Sale.balance_due), 0.0).label("total_unpaid_balance"),
            func.count(Sale.id).label("unpaid_invoices_count"),
        )
        .filter(
            Sale.is_voided == False,  # noqa: E712
            Sale.balance_due > 0,
            Sale.customer_id.isnot(None),
        )
        .group_by(Sale.customer_id)
        .all()
    )

    if not rows:
        return []

    customer_ids = [int(r.customer_id) for r in rows if r.customer_id]
    customers = (
        db.query(Customer.id, Customer.name, Customer.phone)
        .filter(Customer.id.in_(customer_ids))
        .all()
    )
    cust_map = {c.id: c for c in customers}

    return [
        {
            "customer_id": int(r.customer_id),
            "customer_name": cust_map[r.customer_id].name if r.customer_id in cust_map else "Unknown",
            "phone": cust_map[r.customer_id].phone if r.customer_id in cust_map else None,
            "total_unpaid_balance": float(r.total_unpaid_balance or 0.0),
            "unpaid_invoices_count": int(r.unpaid_invoices_count or 0),
        }
        for r in rows
    ]


@router.get("/delayed-repairs", response_model=List[Dict[str, Any]], dependencies=[Depends(require_permission("repairs.view"))])
def get_delayed_repairs_analytics(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """AI Query Endpoint: Which repairs are delayed?"""
    now = datetime.utcnow()
    repairs = (
        db.query(
            RepairTicket.id,
            RepairTicket.ticket_no,
            RepairTicket.device_model,
            RepairTicket.customer_id,
            RepairTicket.status,
            RepairTicket.estimated_completion,
        )
        .filter(
            RepairTicket.is_deleted == False,  # noqa: E712
            RepairTicket.status.notin_(["completed", "delivered", "cancelled"]),
            RepairTicket.estimated_completion.isnot(None),
            RepairTicket.estimated_completion < now,
        )
        .all()
    )

    return [
        {
            "ticket_id": r.id,
            "ticket_no": r.ticket_no,
            "device_model": r.device_model,
            "customer_id": r.customer_id,
            "status": r.status,
            "estimated_completion": r.estimated_completion.isoformat() if r.estimated_completion else None,
            "delay_hours": round((now - r.estimated_completion).total_seconds() / 3600, 1) if r.estimated_completion else 0,
        }
        for r in repairs
    ]


@router.get("/peak-hours", response_model=List[Dict[str, Any]], dependencies=[Depends(require_permission("reports.view"))])
def get_peak_hours_analytics(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """BI Endpoint: Distribution of sales and revenue by hour of the day."""
    start_date = datetime.utcnow() - timedelta(days=days)
    sales = (
        db.query(Sale.created_at, Sale.total)
        .filter(Sale.created_at >= start_date, Sale.is_voided == False)  # noqa: E712
        .all()
    )

    hourly_data = {h: {"hour": h, "sales_count": 0, "total_revenue": 0.0} for h in range(24)}
    for created_at, total in sales:
        if created_at:
            h = created_at.hour
            hourly_data[h]["sales_count"] += 1
            hourly_data[h]["total_revenue"] += float(total or 0.0)
            
    return list(hourly_data.values())
