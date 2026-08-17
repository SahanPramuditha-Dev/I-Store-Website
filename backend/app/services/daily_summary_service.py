"""
daily_summary_service.py
========================
Generates enterprise daily Z-Report business summaries and dispatches them via WhatsApp.
"""

from datetime import datetime, date, time
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, desc

from app.models import Sale, SaleItem, RepairTicket, User, AppSetting, SecuritySetting
from app.utils.time import utcnow
from app.utils.whatsapp_helper import dispatch_whatsapp_event, normalize_sri_lankan_phone


def get_daily_business_metrics(db: Session, target_date: Optional[date] = None) -> Dict[str, Any]:
    """Computes comprehensive daily metrics for sales, payments, repairs, and top products."""
    if not target_date:
        target_date = date.today()

    start_dt = datetime.combine(target_date, time.min)
    end_dt = datetime.combine(target_date, time.max)

    # 1. Sales query
    sales = db.query(Sale).filter(
        and_(
            Sale.created_at >= start_dt,
            Sale.created_at <= end_dt,
            Sale.is_voided == False,  # noqa: E712
            Sale.is_return == False   # noqa: E712
        )
    ).all()

    gross_sales = sum(float(s.total or s.grand_total or 0) for s in sales)
    total_discounts = sum(float(s.discount_amount or s.discount or 0) for s in sales)
    total_invoices = len(sales)

    # 2. Payment breakdown
    cash_total = sum(float(s.total or 0) for s in sales if str(s.payment_method or '').lower() == 'cash')
    card_total = sum(float(s.total or 0) for s in sales if 'card' in str(s.payment_method or '').lower())
    bank_total = sum(float(s.total or 0) for s in sales if 'bank' in str(s.payment_method or '').lower() or 'transfer' in str(s.payment_method or '').lower())
    credit_total = sum(float(s.total or 0) for s in sales if 'credit' in str(s.payment_method or '').lower())
    other_total = gross_sales - (cash_total + card_total + bank_total + credit_total)

    # 3. Units sold & Top products
    sale_ids = [s.id for s in sales]
    units_sold = 0
    top_products = []
    if sale_ids:
        items = db.query(
            SaleItem.product_name,
            func.sum(SaleItem.quantity).label("total_qty"),
            func.sum(SaleItem.line_total).label("total_revenue")
        ).filter(
            SaleItem.sale_id.in_(sale_ids)
        ).group_by(
            SaleItem.product_name
        ).order_by(
            desc("total_qty")
        ).limit(3).all()

        for item in items:
            top_products.append({
                "name": item[0] or "Product",
                "qty": int(item[1] or 0),
                "revenue": float(item[2] or 0)
            })

        total_units = db.query(func.sum(SaleItem.quantity)).filter(SaleItem.sale_id.in_(sale_ids)).scalar()
        units_sold = int(total_units or 0)

    # 4. Repair metrics
    repairs_intake = db.query(RepairTicket).filter(
        and_(
            RepairTicket.created_at >= start_dt,
            RepairTicket.created_at <= end_dt,
            RepairTicket.is_deleted == False  # noqa: E712
        )
    ).count()

    repairs_completed = db.query(RepairTicket).filter(
        and_(
            RepairTicket.status.in_(["completed", "delivered"]),
            RepairTicket.created_at >= start_dt,
            RepairTicket.is_deleted == False  # noqa: E712
        )
    ).count()

    repair_revenue = db.query(func.sum(RepairTicket.estimated_cost)).filter(
        and_(
            RepairTicket.status.in_(["completed", "delivered"]),
            RepairTicket.created_at >= start_dt,
            RepairTicket.is_deleted == False  # noqa: E712
        )
    ).scalar() or 0.0

    return {
        "date_str": target_date.strftime("%B %d, %Y"),
        "gross_sales": gross_sales,
        "total_discounts": total_discounts,
        "total_invoices": total_invoices,
        "units_sold": units_sold,
        "cash_total": cash_total,
        "card_total": card_total,
        "bank_total": bank_total,
        "credit_total": credit_total,
        "other_total": max(0.0, other_total),
        "top_products": top_products,
        "repairs_intake": repairs_intake,
        "repairs_completed": repairs_completed,
        "repair_revenue": float(repair_revenue)
    }


def format_daily_summary_whatsapp_message(metrics: Dict[str, Any], store_name: str = "I-Store") -> str:
    """Formats the metrics into an executive WhatsApp Z-Report."""
    top_items_text = ""
    if metrics["top_products"]:
        top_items_text = "\n🔥 *Top Selling Products:*\n" + "\n".join(
            f"  • {p['name']} ({p['qty']} pcs - LKR {p['revenue']:,.0f})"
            for p in metrics["top_products"]
        )

    msg = (
        f"📊 *DAILY BUSINESS CLOSING SUMMARY (Z-REPORT)*\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"🏬 *{store_name}* • 📅 *{metrics['date_str']}*\n\n"
        f"💰 *FINANCIAL OVERVIEW:*\n"
        f"• *Gross Revenue:* LKR {metrics['gross_sales']:,.2f}\n"
        f"• Total Invoices: {metrics['total_invoices']}\n"
        f"• Total Units Sold: {metrics['units_sold']}\n"
        f"• Total Discounts Given: LKR {metrics['total_discounts']:,.2f}\n\n"
        f"💳 *COLLECTION BREAKDOWN:*\n"
        f"• 💵 Cash in Drawer: LKR {metrics['cash_total']:,.2f}\n"
        f"• 💳 Card Payments: LKR {metrics['card_total']:,.2f}\n"
        f"• 🏦 Bank Transfers: LKR {metrics['bank_total']:,.2f}\n"
    )

    if metrics["credit_total"] > 0:
        msg += f"• 📋 Customer Credit: LKR {metrics['credit_total']:,.2f}\n"

    msg += (
        f"\n🛠️ *SERVICE CENTER & REPAIRS:*\n"
        f"• New Repair Intakes: {metrics['repairs_intake']}\n"
        f"• Repairs Completed: {metrics['repairs_completed']}\n"
        f"• Repair Revenue: LKR {metrics['repair_revenue']:,.2f}\n"
        f"{top_items_text}\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"_Generated automatically by I-Store ERP System._"
    )

    return msg
