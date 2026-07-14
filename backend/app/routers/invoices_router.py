import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_permission
from app.database import get_db
from app.models import (
    AppSetting,
    Customer,
    InventoryItem,
    InvoiceAuditEvent,
    InvoicePayment,
    RepairTicket,
    Sale,
    SaleItem,
    StockMovement,
    User,
    WarrantyRecord,
)
from app.services.activity_service import log_activity
from app.services.approval_service import consume_approval_request
from app.services.domain_audit_service import assert_accounting_period_open, record_domain_audit
from app.services.print_rendering_service import get_store_profile_print_data, render_invoice_html_from_store
from app.services.settings_policy_service import enforce_void_refund_policy, void_refund_approval_required
from app.utils.time import utcnow

router = APIRouter(tags=["invoices"])


def _invoice_label(sale: Sale) -> str:
    return str(sale.invoice_no or f"INV-{sale.id:05d}")


def _payment_status_from_balance(balance_due: float) -> str:
    if float(balance_due or 0) <= 0:
        return "paid"
    return "partial"


def _safe_float(value) -> float:
    try:
        return float(value or 0)
    except Exception:
        return 0.0


def _read_state(db: Session) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == "settings_state_v2").first()
    if not row or not row.value:
        return {}
    try:
        payload = json.loads(row.value)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _read_print_profile(db: Session) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == "print_profile").first()
    if not row or not row.value:
        return {}
    try:
        payload = json.loads(row.value)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _store_profile_payload(db: Session) -> dict:
    state = _read_state(db)
    print_profile = _read_print_profile(db)
    store = (state or {}).get("store_profile", {})
    business = (store or {}).get("business_identity", {})
    contact = (store or {}).get("contact_information", {})
    address = (store or {}).get("address", {})
    branding = (store or {}).get("logo_branding", {})
    return {
        "software_name": "I Store",
        "shop_name": business.get("shop_name") or print_profile.get("store_name") or "I Point",
        "shop_logo": branding.get("shop_logo") or print_profile.get("logo_data") or "",
        "address": address.get("address_line_1") or print_profile.get("store_address") or "",
        "phone": contact.get("primary_phone") or print_profile.get("store_phone") or "",
        "email": contact.get("email_address") or print_profile.get("store_email") or "",
        "invoice_footer": business.get("invoice_footer_text") or print_profile.get("footer_note") or "",
        "warranty_terms": business.get("warranty_terms") or "",
    }


def _invoice_detail(db: Session, sale: Sale) -> dict:
    customer = db.query(Customer).filter(Customer.id == sale.customer_id).first() if sale.customer_id else None
    repair = db.query(RepairTicket).filter(RepairTicket.id == sale.repair_ticket_id).first() if sale.repair_ticket_id else None
    creator = db.query(User).filter(User.id == sale.created_by).first() if sale.created_by else None

    lines = db.query(SaleItem).filter(SaleItem.sale_id == sale.id).order_by(SaleItem.id.asc()).all()
    item_ids = [int(line.item_id) for line in lines if line.item_id]
    item_map: dict[int, InventoryItem] = {}
    if item_ids:
        item_map = {int(row.id): row for row in db.query(InventoryItem).filter(InventoryItem.id.in_(item_ids)).all()}
    line_payload = []
    for line in lines:
        item = item_map.get(int(line.item_id or 0))
        qty = int(line.quantity or 0)
        unit = _safe_float(line.price)
        line_total = _safe_float(line.line_total)
        if not line_total:
            line_total = round(qty * unit - _safe_float(line.discount_amount), 2)
        line_payload.append(
            {
                "id": line.id,
                "line_type": line.line_type,
                "product_id": line.item_id,
                "variant_id": line.variant_id,
                "serial_id": line.serial_id,
                "description": line.description or (item.name if item else "Line Item"),
                "item_name": item.name if item else (line.description or "Line Item"),
                "sku": item.sku if item else None,
                "barcode": item.barcode if item else None,
                "quantity": qty,
                "unit_price": unit,
                "discount_amount": _safe_float(line.discount_amount),
                "line_total": line_total,
                "warranty_days": int(line.warranty_days or 0),
                "warranty_rule_id": line.warranty_rule_id,
                "warranty_record_id": line.warranty_record_id,
                "serial_number": line.serial_number,
            }
        )

    payment_rows = db.query(InvoicePayment).filter(InvoicePayment.invoice_id == sale.id).order_by(InvoicePayment.created_at.asc()).all()
    payments = [
        {
            "id": row.id,
            "payment_number": row.payment_number,
            "payment_method": row.payment_method,
            "payment_type": row.payment_type,
            "amount": _safe_float(row.amount),
            "reference_number": row.reference_number,
            "received_by": row.received_by,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "notes": row.notes,
        }
        for row in payment_rows
    ]

    warranty_rows = db.query(WarrantyRecord).filter(WarrantyRecord.invoice_id == sale.id).order_by(WarrantyRecord.id.asc()).all()
    warranties = [
        {
            "warranty_id": row.warranty_code or row.warranty_number,
            "product_or_service_name": row.product_or_service_name,
            "warranty_type": row.warranty_type,
            "warranty_days": int(row.warranty_days or 0),
            "start_date": row.start_date.isoformat() if row.start_date else None,
            "end_date": row.end_date.isoformat() if row.end_date else None,
            "status": row.status,
            "serial_number": row.serial_number,
        }
        for row in warranty_rows
    ]

    audit_rows = (
        db.query(InvoiceAuditEvent)
        .filter(InvoiceAuditEvent.invoice_id == sale.id)
        .order_by(InvoiceAuditEvent.created_at.asc(), InvoiceAuditEvent.id.asc())
        .all()
    )
    audit_payload = [
        {
            "id": row.id,
            "event_type": row.event_type,
            "event_message": row.event_message,
            "user_id": row.user_id,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in audit_rows
    ]

    return {
        "id": sale.id,
        "invoice_number": _invoice_label(sale),
        "invoice_type": sale.invoice_type or ("repair_invoice" if sale.repair_ticket_id else "product_sale"),
        "invoice_status": sale.invoice_status or ("voided" if sale.is_voided else "finalized"),
        "payment_status": sale.payment_status,
        "customer_id": sale.customer_id,
        "customer_name": customer.name if customer else "Walk-in Customer",
        "customer_phone": customer.phone if customer else None,
        "repair_ticket_id": sale.repair_ticket_id,
        "reservation_id": sale.reservation_id,
        "repair_ticket_no": repair.ticket_no if repair else None,
        "device_model": repair.device_model if repair else None,
        "imei": repair.imei if repair else None,
        "technician": repair.technician if repair else None,
        "subtotal": _safe_float(sale.subtotal),
        "discount_total": _safe_float(sale.discount_amount),
        "tax_total": _safe_float(sale.tax_amount),
        "grand_total": _safe_float(sale.total),
        "advance_applied_total": _safe_float(sale.advance_applied_total),
        "paid_total": _safe_float(sale.amount_paid),
        "balance_due": _safe_float(sale.balance_due),
        "created_by": sale.created_by,
        "created_by_name": creator.full_name if creator else None,
        "created_at": sale.created_at.isoformat() if sale.created_at else None,
        "finalized_at": sale.finalized_at.isoformat() if sale.finalized_at else None,
        "voided_at": sale.voided_at.isoformat() if sale.voided_at else None,
        "voided_by": sale.voided_by,
        "void_reason": sale.void_reason,
        "lines": line_payload,
        "payments": payments,
        "warranty_records": warranties,
        "audit_events": audit_payload,
    }


def _print_html(invoice: dict, store: dict, thermal: bool = False) -> str:
    lines = invoice.get("lines") or []
    line_rows = "".join(
        [
            (
                f"<tr>"
                f"<td>{(row.get('description') or row.get('item_name') or '').replace('<', '&lt;')}</td>"
                f"<td style='text-align:right'>{int(row.get('quantity') or 0)}</td>"
                f"<td style='text-align:right'>{_safe_float(row.get('unit_price')):,.2f}</td>"
                f"<td style='text-align:right'>{_safe_float(row.get('line_total')):,.2f}</td>"
                f"</tr>"
            )
            for row in lines
        ]
    )
    warranty_rows = "".join(
        [
            (
                f"<li>{(row.get('product_or_service_name') or '').replace('<', '&lt;')} "
                f"({row.get('warranty_days') or 0} days, until {row.get('end_date') or '-'})</li>"
            )
            for row in (invoice.get("warranty_records") or [])
        ]
    )
    max_width = "80mm" if thermal else "210mm"
    padding = "6mm" if thermal else "12mm"
    font_size = "11px" if thermal else "13px"
    logo_html = ""
    if store.get("shop_logo"):
        logo_html = (
            "<div style='margin-bottom:6px;'>"
            f"<img src='{store.get('shop_logo')}' alt='Store Logo' style='max-height:{'28px' if thermal else '56px'}; max-width:100%; object-fit:contain;' />"
            "</div>"
        )
    return f"""
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>{invoice.get("invoice_number")}</title>
  <style>
    body {{ font-family: Arial, sans-serif; background: #fff; color: #111; margin: 0; padding: {padding}; }}
    .wrap {{ max-width: {max_width}; margin: 0 auto; }}
    .top {{ margin-bottom: 8px; }}
    .shop {{ font-size: {font_size}; font-weight: 700; }}
    .muted {{ color: #555; font-size: 11px; }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 8px; }}
    th, td {{ border-bottom: 1px solid #ddd; padding: 6px 4px; font-size: {font_size}; }}
    th {{ text-align: left; background: #f7f7f7; }}
    .totals td {{ border: none; }}
    .right {{ text-align: right; }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      {logo_html}
      <div class="shop">{store.get("shop_name") or "I Point"}</div>
      <div class="muted">{store.get("address") or ""}</div>
      <div class="muted">{store.get("phone") or ""} {store.get("email") or ""}</div>
      <div class="muted">Invoice: {invoice.get("invoice_number")} | Date: {invoice.get("created_at") or ""}</div>
      <div class="muted">Customer: {invoice.get("customer_name") or "Walk-in Customer"}</div>
    </div>
    <table>
      <thead>
        <tr><th>Item</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Total</th></tr>
      </thead>
      <tbody>{line_rows}</tbody>
    </table>
    <table class="totals">
      <tr><td>Subtotal</td><td class="right">{_safe_float(invoice.get("subtotal")):,.2f}</td></tr>
      <tr><td>Discount</td><td class="right">{_safe_float(invoice.get("discount_total")):,.2f}</td></tr>
      <tr><td>Tax</td><td class="right">{_safe_float(invoice.get("tax_total")):,.2f}</td></tr>
      <tr><td>Grand Total</td><td class="right">{_safe_float(invoice.get("grand_total")):,.2f}</td></tr>
      <tr><td>Advance Applied</td><td class="right">{_safe_float(invoice.get("advance_applied_total")):,.2f}</td></tr>
      <tr><td>Paid</td><td class="right">{_safe_float(invoice.get("paid_total")):,.2f}</td></tr>
      <tr><td>Balance</td><td class="right">{_safe_float(invoice.get("balance_due")):,.2f}</td></tr>
    </table>
    <div class="muted" style="margin-top:8px;">
      Warranty Terms: {(store.get("warranty_terms") or "-").replace('<', '&lt;')}
    </div>
    <ul class="muted">{warranty_rows}</ul>
    <div class="muted" style="margin-top:8px;">{(store.get("invoice_footer") or "").replace('<', '&lt;')}</div>
  </div>
</body>
</html>
"""


@router.get("/invoices", dependencies=[Depends(require_permission("pos.view"))])
def list_invoices(
    q: str | None = Query(default=None),
    customer_id: int | None = Query(default=None),
    repair_ticket_id: int | None = Query(default=None),
    reservation_id: int | None = Query(default=None),
    invoice_status: str | None = Query(default=None),
    payment_status: str | None = Query(default=None),
    invoice_type: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(Sale)
    if customer_id:
        query = query.filter(Sale.customer_id == int(customer_id))
    if repair_ticket_id:
        query = query.filter(Sale.repair_ticket_id == int(repair_ticket_id))
    if reservation_id:
        query = query.filter(Sale.reservation_id == int(reservation_id))
    if invoice_status and str(invoice_status).lower() != "all":
        query = query.filter(Sale.invoice_status == str(invoice_status).strip().lower())
    if payment_status and str(payment_status).lower() != "all":
        query = query.filter(Sale.payment_status == str(payment_status).strip().lower())
    if invoice_type and str(invoice_type).lower() != "all":
        query = query.filter(Sale.invoice_type == str(invoice_type).strip().lower())
    if q:
        like = f"%{q.strip()}%"
        query = query.filter((Sale.invoice_no.ilike(like)) | (Sale.id.cast(sa.String).ilike(like)))
    if date_from:
        try:
            query = query.filter(Sale.created_at >= datetime.fromisoformat(str(date_from)))
        except Exception:
            pass
    if date_to:
        try:
            query = query.filter(Sale.created_at <= datetime.fromisoformat(str(date_to)))
        except Exception:
            pass
    rows = query.order_by(Sale.created_at.desc(), Sale.id.desc()).limit(int(limit)).all()
    return [
        {
            "id": row.id,
            "invoice_number": _invoice_label(row),
            "invoice_type": row.invoice_type or ("repair_invoice" if row.repair_ticket_id else "product_sale"),
            "customer_id": row.customer_id,
            "repair_ticket_id": row.repair_ticket_id,
            "reservation_id": row.reservation_id,
            "grand_total": _safe_float(row.total),
            "paid_total": _safe_float(row.amount_paid),
            "balance_due": _safe_float(row.balance_due),
            "payment_status": row.payment_status,
            "invoice_status": row.invoice_status or ("voided" if row.is_voided else "finalized"),
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "void_reason": row.void_reason,
        }
        for row in rows
    ]


@router.get("/invoices/number/{invoice_number}", dependencies=[Depends(require_permission("pos.view"))])
def get_invoice_by_number(invoice_number: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    token = str(invoice_number or "").strip()
    row = db.query(Sale).filter(Sale.invoice_no == token).first()
    if not row:
        row = db.query(Sale).filter(Sale.invoice_no.ilike(token)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return _invoice_detail(db, row)


@router.get("/invoices/{id}", dependencies=[Depends(require_permission("pos.view"))])
def get_invoice(id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    row = db.query(Sale).filter(Sale.id == int(id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return _invoice_detail(db, row)


@router.patch("/invoices/{id}/void", dependencies=[Depends(require_permission("pos.void_invoice"))])
def void_invoice(
    id: int,
    payload: dict | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(Sale).filter(Sale.id == int(id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if bool(row.is_voided):
        raise HTTPException(status_code=400, detail="Invoice already voided")
    assert_accounting_period_open(db, when=row.created_at or utcnow(), action="void invoice")

    reason = str((payload or {}).get("reason") or "").strip()
    if len(reason) < 5:
        raise HTTPException(status_code=400, detail="Void reason must be at least 5 characters")
    void_amount = abs(_safe_float(row.total))
    if void_refund_approval_required(db, action="void", amount=void_amount):
        consume_approval_request(
            db,
            request_code=str((payload or {}).get("approval_request_code") or ""),
            module="pos",
            action="void",
            target_type="Sale",
            target_id=row.id,
            user=current_user,
            permission="pos.void_invoice",
            expected_payload={"amount": round(void_amount, 2)},
            reason=reason,
        )
    else:
        enforce_void_refund_policy(db, user=current_user, action="void", amount=void_amount)

    sale_items = db.query(SaleItem).filter(SaleItem.sale_id == row.id).all()
    for sale_item in sale_items:
        if sale_item.item_id is None:
            continue
        inv = db.query(InventoryItem).filter(InventoryItem.id == int(sale_item.item_id)).first()
        if inv:
            inv.quantity = int(inv.quantity or 0) + int(sale_item.quantity or 0)
            db.add(
                StockMovement(
                    item_id=inv.id,
                    user_id=current_user.id if current_user else None,
                    movement_type="VOID_REVERSAL",
                    quantity=int(sale_item.quantity or 0),
                    reference_type="sale_void",
                    reference_id=row.id,
                    note=f"Voided {_invoice_label(row)}",
                )
            )

    row.is_voided = True
    row.invoice_status = "voided"
    row.void_reason = reason
    row.voided_at = utcnow()
    row.voided_by = current_user.id if current_user else None
    row.payment_status = "cancelled"

    db.add(
        InvoiceAuditEvent(
            invoice_id=row.id,
            event_type="invoice_voided",
            event_message=f"Invoice {_invoice_label(row)} voided. Reason: {reason}",
            user_id=current_user.id if current_user else None,
        )
    )
    log_activity(
        db,
        current_user.id if current_user else None,
        "Void",
        "Invoice",
        row.id,
        f"Voided invoice {_invoice_label(row)}. Reason: {reason}",
    )
    record_domain_audit(
        db,
        module="pos",
        action="invoice_voided",
        target_type="Sale",
        target_id=row.id,
        user=current_user,
        old_value={"is_voided": False, "invoice_status": "finalized"},
        new_value={"is_voided": True, "invoice_status": "voided", "void_reason": reason},
        reason=reason,
        permission="pos.void_invoice",
    )
    db.commit()
    return {"ok": True, "invoice_id": row.id, "invoice_number": _invoice_label(row), "invoice_status": row.invoice_status}


@router.post("/invoices/{id}/reprint", dependencies=[Depends(require_permission("pos.reprint"))])
def reprint_invoice(id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    row = db.query(Sale).filter(Sale.id == int(id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Invoice not found")
    db.add(
        InvoiceAuditEvent(
            invoice_id=row.id,
            event_type="invoice_reprinted",
            event_message=f"Invoice {_invoice_label(row)} reprinted",
            user_id=current_user.id if current_user else None,
        )
    )
    log_activity(
        db,
        current_user.id if current_user else None,
        "Reprint",
        "Invoice",
        row.id,
        f"Reprinted invoice {_invoice_label(row)}",
    )
    db.commit()
    return {
        "ok": True,
        "invoice_id": row.id,
        "invoice_number": _invoice_label(row),
        "print_urls": {
            "a4": f"/invoices/{row.id}/print/a4",
            "thermal": f"/invoices/{row.id}/print/thermal",
        },
    }


@router.get("/invoices/{id}/print/a4", dependencies=[Depends(require_permission(["pos.print", "pos.reprint"]))], response_class=HTMLResponse)
def print_invoice_a4(
    id: int,
    template: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(Sale).filter(Sale.id == int(id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Invoice not found")
    invoice = _invoice_detail(db, row)
    store = get_store_profile_print_data(db)
    return HTMLResponse(render_invoice_html_from_store(invoice, store, thermal=False, template=template))


@router.get("/invoices/{id}/print/thermal", dependencies=[Depends(require_permission(["pos.print", "pos.reprint"]))], response_class=HTMLResponse)
def print_invoice_thermal(
    id: int,
    template: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(Sale).filter(Sale.id == int(id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Invoice not found")
    invoice = _invoice_detail(db, row)
    store = get_store_profile_print_data(db)
    return HTMLResponse(render_invoice_html_from_store(invoice, store, thermal=True, template=template))
