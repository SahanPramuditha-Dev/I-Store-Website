import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Customer, RepairTicket, Sale, SaleItem
from app.constants import REPAIR_STATUS_LABELS
from app.services.supabase_pos_sync import generate_invoice_token

router = APIRouter(prefix="/public", tags=["public"])


def _invoice_label(sale: Sale) -> str:
    return str(sale.invoice_no or f"INV-{sale.id:05d}")


@router.get("/invoice/{invoice_no}")
def get_public_invoice(invoice_no: str, token: str = Query(""), db: Session = Depends(get_db)):
    clean_no = invoice_no.strip().upper()
    expected_token = generate_invoice_token(clean_no)
    if token != expected_token:
        raise HTTPException(status_code=403, detail="Invalid security token")

    sale = db.query(Sale).filter(Sale.invoice_no == clean_no, Sale.is_deleted == False).first()
    if not sale and clean_no.startswith("INV-"):
        try:
            num = int(clean_no.replace("INV-", "").lstrip("0") or "0")
            sale = db.query(Sale).filter(Sale.id == num, Sale.is_deleted == False).first()
        except Exception:
            pass
    if not sale:
        raise HTTPException(status_code=404, detail="Invoice not found")

    customer = db.query(Customer).filter(Customer.id == sale.customer_id).first() if sale.customer_id else None
    items = db.query(SaleItem).filter(SaleItem.sale_id == sale.id).all()

    return {
        "id": _invoice_label(sale),
        "token": expected_token,
        "created_at": sale.created_at.isoformat() if sale.created_at else None,
        "customer_name": customer.name if customer else "Walk-in Customer",
        "customer_phone": customer.phone if customer else "",
        "customer_email": customer.email if customer else "",
        "subtotal": float(sale.subtotal or sale.total or 0),
        "discount": float(sale.discount_amount or 0),
        "tax": float(sale.tax_amount or 0),
        "total": float(sale.total or 0),
        "payment_method": str(sale.payment_method or "Cash").capitalize(),
        "status": "Paid" if (sale.paid or (sale.balance_due or 0) <= 0) else "Pending",
        "invoice_items": [
            {
                "item_name": item.description or (item.line_type.title() if item.line_type else "Product Item"),
                "quantity": item.quantity or 1,
                "unit_price": float(item.price or 0),
                "warranty_months": round((item.warranty_days or 0) / 30) if item.warranty_days else 0,
                "imei_or_serial": item.serial_number or getattr(item, "serial_number", None),
            }
            for item in items
        ]
    }


@router.get("/repair/{ticket_no}")
def get_public_repair(ticket_no: str, db: Session = Depends(get_db)):
    clean_no = ticket_no.strip().upper()
    repair = db.query(RepairTicket).filter(RepairTicket.ticket_no == clean_no, RepairTicket.is_deleted == False).first()
    if not repair and clean_no.startswith("JOB-"):
        try:
            num = int(clean_no.replace("JOB-", "").lstrip("0") or "0")
            repair = db.query(RepairTicket).filter(RepairTicket.id == num, RepairTicket.is_deleted == False).first()
        except Exception:
            pass
    if not repair:
        raise HTTPException(status_code=404, detail="Repair ticket not found")

    customer = db.query(Customer).filter(Customer.id == repair.customer_id).first() if repair.customer_id else None
    return {
        "id": repair.ticket_no or f"JOB-{repair.id:05d}",
        "customer_phone": customer.phone if customer else "",
        "customer_name": customer.name if customer else "Valued Customer",
        "device_name": repair.device_model or "Electronic Device",
        "imei_or_serial": repair.imei or "",
        "issue_description": repair.issue or "General Inspection",
        "status": REPAIR_STATUS_LABELS.get(repair.status, str(repair.status).title()),
        "status_note": repair.notes or "",
        "estimated_cost": float(repair.estimated_cost or 0),
        "advance_paid": float(repair.advance_payment or 0),
        "balance_due": float(repair.outstanding_balance or 0),
        "created_at": repair.created_at.isoformat() if repair.created_at else None,
    }
