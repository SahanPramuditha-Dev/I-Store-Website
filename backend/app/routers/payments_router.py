import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_permission
from app.database import get_db
from app.models import AppSetting, Customer, InvoiceAuditEvent, InvoicePayment, Sale
from app.services.numbering_service import next_number
from app.services.print_rendering_service import get_store_profile_print_data, render_payment_receipt_html
from app.services.settings_policy_service import enforce_void_refund_policy
from app.utils.money import add as money_add
from app.utils.money import sub as money_sub
from app.utils.money import to_float
from app.utils.time import utcnow

router = APIRouter(tags=["payments"])


def _safe_float(value) -> float:
    return to_float(value)


def _invoice_label(sale: Sale) -> str:
    return str(sale.invoice_no or f"INV-{sale.id:05d}")


def _read_sales_rules(db: Session) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == "settings_state_v2").first()
    if not row or not row.value:
        return {}
    try:
        payload = json.loads(row.value)
    except Exception:
        return {}
    return (((payload or {}).get("business_ops") or {}).get("sales_pos_rules") or {})


def _ensure_invoice_for_payment(db: Session, invoice_id: int) -> Sale:
    sale = db.query(Sale).filter(Sale.id == int(invoice_id)).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Invoice not found")
    status_key = str(sale.invoice_status or "").strip().lower()
    if bool(sale.is_voided) or status_key in {"voided", "cancelled"}:
        raise HTTPException(status_code=400, detail="Cannot post payment to voided/cancelled invoice")
    if status_key == "refunded":
        raise HTTPException(status_code=400, detail="Cannot post payment to refunded invoice")
    return sale


def _refresh_sale_payment_state(sale: Sale) -> None:
    due = money_sub(sale.total, sale.amount_paid)
    sale.balance_due = to_float(due if due > 0 else 0)
    sale.payment_status = "paid" if _safe_float(sale.balance_due) <= 0 else "partial"
    sale.paid = bool(_safe_float(sale.balance_due) <= 0)


def _payment_payload(row: InvoicePayment) -> dict:
    return {
        "id": row.id,
        "payment_number": row.payment_number,
        "invoice_id": row.invoice_id,
        "customer_id": row.customer_id,
        "payment_method": row.payment_method,
        "payment_type": row.payment_type,
        "amount": _safe_float(row.amount),
        "reference_number": row.reference_number,
        "received_by": row.received_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "notes": row.notes,
    }


@router.post("/payments", dependencies=[Depends(require_permission("pos.checkout"))])
def create_payment(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    invoice_id = int(payload.get("invoice_id") or 0)
    if invoice_id <= 0:
        raise HTTPException(status_code=400, detail="invoice_id is required")
    amount = _safe_float(payload.get("amount"))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be greater than zero")

    sale = _ensure_invoice_for_payment(db, invoice_id)
    payment_method = str(payload.get("payment_method") or "cash").strip().lower().replace(" ", "_")
    payment_type = str(payload.get("payment_type") or "balance_payment").strip().lower()
    reference_number = str(payload.get("reference_number") or "").strip() or None
    notes = str(payload.get("payment_note") or payload.get("notes") or "").strip() or None

    row = InvoicePayment(
        payment_number=next_number(db, "PAY"),
        invoice_id=sale.id,
        customer_id=sale.customer_id,
        payment_method=payment_method,
        payment_type=payment_type,
        amount=amount,
        reference_number=reference_number,
        received_by=current_user.id if current_user else None,
        notes=notes or "Payment posted from Payments API",
    )
    db.add(row)

    sale.amount_paid = to_float(money_add(sale.amount_paid, amount))
    _refresh_sale_payment_state(sale)
    db.add(
        InvoiceAuditEvent(
            invoice_id=sale.id,
            event_type="payment_received",
            event_message=f"Payment {row.payment_number} received amount={amount:.2f}",
            user_id=current_user.id if current_user else None,
        )
    )
    db.commit()
    db.refresh(row)
    return {
        "ok": True,
        "invoice_id": sale.id,
        "invoice_number": _invoice_label(sale),
        "payment": _payment_payload(row),
        "paid_total": _safe_float(sale.amount_paid),
        "balance_due": _safe_float(sale.balance_due),
        "payment_status": sale.payment_status,
    }


@router.get("/payments/invoice/{invoice_id}", dependencies=[Depends(require_permission("pos.view"))])
def list_invoice_payments(invoice_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    _ = _ensure_invoice_for_payment(db, int(invoice_id))
    rows = (
        db.query(InvoicePayment)
        .filter(InvoicePayment.invoice_id == int(invoice_id))
        .order_by(InvoicePayment.created_at.asc(), InvoicePayment.id.asc())
        .all()
    )
    return [_payment_payload(row) for row in rows]


@router.get("/payments/{payment_id}/receipt", dependencies=[Depends(require_permission(["pos.print", "pos.reprint"]))], response_class=HTMLResponse)
def print_payment_receipt(
    payment_id: int,
    paper: str = Query(default="thermal_80"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(InvoicePayment).filter(InvoicePayment.id == int(payment_id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Payment not found")
    sale = db.query(Sale).filter(Sale.id == int(row.invoice_id)).first() if row.invoice_id else None
    customer = db.query(Customer).filter(Customer.id == int(row.customer_id)).first() if row.customer_id else None
    payload = _payment_payload(row)
    payload.update(
        {
            "invoice_number": _invoice_label(sale) if sale else None,
            "customer_name": customer.name if customer else "Walk-in Customer",
            "paid_total": _safe_float(sale.amount_paid) if sale else 0,
            "balance_due": _safe_float(sale.balance_due) if sale else 0,
        }
    )
    store = get_store_profile_print_data(db)
    return HTMLResponse(render_payment_receipt_html(payload, store, thermal=str(paper).lower() != "a4"))


@router.post("/payments/split", dependencies=[Depends(require_permission("pos.split_payment"))])
def create_split_payment(payload: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    invoice_id = int(payload.get("invoice_id") or 0)
    if invoice_id <= 0:
        raise HTTPException(status_code=400, detail="invoice_id is required")
    lines = payload.get("payments") or []
    if not isinstance(lines, list) or not lines:
        raise HTTPException(status_code=400, detail="payments array is required")

    sale = _ensure_invoice_for_payment(db, invoice_id)
    rules = _read_sales_rules(db)
    if not bool(rules.get("allow_split_payments", True)):
        raise HTTPException(status_code=403, detail="Split payments are disabled by policy")

    created_rows: list[InvoicePayment] = []
    total_amount = 0.0
    for line in lines:
        amount = _safe_float((line or {}).get("amount"))
        if amount <= 0:
            continue
        payment_method = str((line or {}).get("payment_method") or "cash").strip().lower().replace(" ", "_")
        payment_type = str((line or {}).get("payment_type") or "balance_payment").strip().lower()
        reference_number = str((line or {}).get("reference_number") or "").strip() or None
        note = str((line or {}).get("payment_note") or (line or {}).get("notes") or "").strip() or None
        row = InvoicePayment(
            payment_number=next_number(db, "PAY"),
            invoice_id=sale.id,
            customer_id=sale.customer_id,
            payment_method=payment_method,
            payment_type=payment_type,
            amount=amount,
            reference_number=reference_number,
            received_by=current_user.id if current_user else None,
            notes=note or "Split payment entry",
        )
        db.add(row)
        created_rows.append(row)
        total_amount = to_float(money_add(total_amount, amount))

    total_amount = _safe_float(total_amount)
    if total_amount <= 0:
        raise HTTPException(status_code=400, detail="No valid payment amounts were provided")

    sale.amount_paid = to_float(money_add(sale.amount_paid, total_amount))
    _refresh_sale_payment_state(sale)

    db.add(
        InvoiceAuditEvent(
            invoice_id=sale.id,
            event_type="split_payment_received",
            event_message=f"Split payment total={total_amount:.2f} entries={len(created_rows)}",
            user_id=current_user.id if current_user else None,
        )
    )
    db.commit()

    rows = (
        db.query(InvoicePayment)
        .filter(InvoicePayment.invoice_id == int(invoice_id))
        .order_by(InvoicePayment.created_at.asc(), InvoicePayment.id.asc())
        .all()
    )
    return {
        "ok": True,
        "invoice_id": sale.id,
        "invoice_number": _invoice_label(sale),
        "posted_total": total_amount,
        "paid_total": _safe_float(sale.amount_paid),
        "balance_due": _safe_float(sale.balance_due),
        "payment_status": sale.payment_status,
        "payments": [_payment_payload(row) for row in rows],
        "posted_at": utcnow().isoformat(),
    }
