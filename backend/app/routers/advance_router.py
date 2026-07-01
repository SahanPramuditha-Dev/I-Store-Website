import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_permission
from app.database import get_db
from app.models import (
    ActivityLog,
    AdvancePayment,
    AppSetting,
    Customer,
    InventoryItem,
    InventorySerial,
    InvoicePayment,
    ProductReservation,
    RepairEstimate,
    RepairTicket,
    Sale,
    SaleItem,
    StockMovement,
)
from app.schemas import (
    AdvancePaymentApplyIn,
    AdvancePaymentCancelIn,
    AdvancePaymentIn,
    AdvancePaymentRefundIn,
    ProductReservationCreateInvoiceIn,
    ProductReservationIn,
    ProductReservationStatusIn,
    ProductReservationUpdateIn,
    RepairEstimateDecisionIn,
    RepairEstimateIn,
)
from app.services.advance_service import (
    ADVANCE_NON_APPLICABLE_STATUSES,
    ADVANCE_SETTINGS_DEFAULT,
    ADVANCE_STATUS_APPLIED,
    ADVANCE_STATUS_CANCELLED,
    ADVANCE_STATUS_PARTIALLY_REFUNDED,
    ADVANCE_STATUS_RECEIVED,
    ADVANCE_STATUS_REFUNDED,
    apply_advance_to_invoice,
    as_money,
    available_advances_query,
    calc_advance_effective_paid,
    calc_advance_remaining,
    get_advance_settings,
    get_reserved_qty_for_item,
    sync_repair_advance_totals,
    sync_reservation_advance_totals,
)
from app.services.accounting_ledger_service import record_ledger_entry
from app.services.numbering_service import next_number
from app.services.print_rendering_service import get_store_profile_print_data, render_advance_receipt_html
from app.services.security_service import has_permission
from app.services.warranty_service import create_sale_warranty_records, ensure_warranty_defaults
from app.utils.time import utcnow


router = APIRouter(tags=["advance_payments"])
SOFTWARE_NAME = "I Store"

ALLOWED_ADVANCE_TYPES = {
    "repair",
    "product_reservation",
    "product_order",
    "spare_part_order",
    "other",
}
ALLOWED_PAYMENT_METHODS = {"cash", "card", "bank_transfer", "mixed", "credit"}
RESERVATION_ALLOWED_STATUSES = {
    "draft",
    "reserved",
    "ordered",
    "received",
    "invoiced",
    "completed",
    "cancelled",
    "refunded",
}


def _role_key(user) -> str:
    return str(getattr(user, "role", "") or "").strip().lower()


def _is_manager_or_above(user) -> bool:
    key = _role_key(user)
    return ("owner" in key) or ("admin" in key) or ("manager" in key)


def _normalize_payment_method(value: str) -> str:
    key = str(value or "").strip().lower().replace(" ", "_")
    aliases = {
        "bank": "bank_transfer",
        "banktransfer": "bank_transfer",
        "bank_transfer": "bank_transfer",
        "cash": "cash",
        "card": "card",
        "mixed": "mixed",
        "credit": "credit",
    }
    normalized = aliases.get(key)
    if not normalized or normalized not in ALLOWED_PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail=f"Unsupported payment method '{value}'")
    return normalized


def _normalize_advance_type(value: str) -> str:
    key = str(value or "").strip().lower()
    if key not in ALLOWED_ADVANCE_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported advance_type '{value}'")
    return key


def _normalize_reservation_type(value: str) -> str:
    key = str(value or "in_stock_reservation").strip().lower()
    aliases = {
        "instock": "in_stock_reservation",
        "in_stock": "in_stock_reservation",
        "in_stock_reservation": "in_stock_reservation",
        "special_order": "special_order",
        "product_order": "special_order",
        "pre_order": "pre_order",
    }
    normalized = aliases.get(key, key)
    if normalized not in {"in_stock_reservation", "special_order", "pre_order"}:
        raise HTTPException(status_code=400, detail=f"Unsupported reservation_type '{value}'")
    return normalized


def _assert_customer(db: Session, customer_id: int) -> Customer:
    row = db.query(Customer).filter(Customer.id == int(customer_id), Customer.is_deleted == False).first()  # noqa: E712
    if not row:
        raise HTTPException(status_code=404, detail="Customer not found")
    return row


def _append_note(existing: str | None, value: str | None) -> str | None:
    text = str(value or "").strip()
    if not text:
        return existing
    base = str(existing or "").strip()
    return f"{base}\n{text}".strip() if base else text


def _get_store_profile_print_data(db: Session) -> dict:
    state_row = db.query(AppSetting).filter(AppSetting.key == "settings_state_v2").first()
    print_row = db.query(AppSetting).filter(AppSetting.key == "print_profile").first()

    state_payload = {}
    if state_row and state_row.value:
        try:
            state_payload = json.loads(state_row.value)
        except Exception:
            state_payload = {}

    print_profile = {}
    if print_row and print_row.value:
        try:
            print_profile = json.loads(print_row.value)
        except Exception:
            print_profile = {}

    store_profile = (state_payload or {}).get("store_profile", {})
    business = (store_profile or {}).get("business_identity", {})
    address = (store_profile or {}).get("address", {})
    contact = (store_profile or {}).get("contact_information", {})
    operations = (store_profile or {}).get("operational_details", {})

    return {
        "software_name": SOFTWARE_NAME,
        "shop_name": business.get("shop_name") or print_profile.get("store_name") or "I Point",
        "shop_logo": ((store_profile or {}).get("logo_branding", {}) or {}).get("shop_logo")
        or print_profile.get("logo_data")
        or "",
        "address": address.get("address_line_1") or print_profile.get("store_address") or "",
        "phone": contact.get("primary_phone") or print_profile.get("store_phone") or "",
        "email": contact.get("email_address") or print_profile.get("store_email") or "",
        "website": contact.get("website_url") or print_profile.get("store_website") or "",
        "business_registration_number": business.get("registration_number") or print_profile.get("business_reg_no") or "",
        "tax_number": business.get("tax_vat_number") or print_profile.get("tax_number") or "",
        "opening_hours": operations.get("opening_hours") or "",
        "invoice_footer": operations.get("invoice_footer_text") or print_profile.get("footer_note") or "",
        "warranty_terms": operations.get("warranty_terms") or "",
        "receipt_message": operations.get("receipt_message") or "Thank you for your purchase!",
    }


def _serialize_advance(row: AdvancePayment) -> dict:
    remaining = calc_advance_remaining(row)
    return {
        "id": row.id,
        "advance_number": row.advance_number,
        "advance_type": row.advance_type,
        "customer_id": row.customer_id,
        "customer_name": row.customer.name if row.customer else None,
        "repair_ticket_id": row.repair_ticket_id,
        "repair_ticket_no": row.repair_ticket.ticket_no if row.repair_ticket else None,
        "product_order_id": row.product_order_id,
        "reservation_id": row.reservation_id,
        "reservation_number": row.reservation.reservation_number if row.reservation else None,
        "estimate_id": row.estimate_id,
        "invoice_id": row.invoice_id,
        "amount": as_money(row.amount),
        "applied_amount": as_money(row.applied_amount),
        "refunded_amount": as_money(row.refunded_amount),
        "remaining_amount": remaining,
        "effective_paid_amount": calc_advance_effective_paid(row),
        "payment_method": row.payment_method,
        "payment_date": row.payment_date.isoformat() if row.payment_date else None,
        "status": row.status,
        "notes": row.notes,
        "cancellation_reason": row.cancellation_reason,
        "refund_reason": row.refund_reason,
        "received_by": row.received_by,
        "received_by_name": row.receiver.full_name if row.receiver else None,
        "manager_override_used": bool(row.manager_override_used),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _serialize_reservation(row: ProductReservation) -> dict:
    return {
        "id": row.id,
        "reservation_number": row.reservation_number,
        "customer_id": row.customer_id,
        "customer_name": row.customer.name if row.customer else None,
        "product_id": row.product_id,
        "product_name": row.product.name if row.product else None,
        "variant_id": row.variant_id,
        "serial_id": row.serial_id,
        "serial_number": row.serial.serial_number if row.serial else None,
        "requested_product_name": row.requested_product_name,
        "reservation_type": row.reservation_type,
        "quantity": int(row.quantity or 0),
        "estimated_total": as_money(row.estimated_total),
        "advance_required": bool(row.advance_required),
        "advance_required_amount": as_money(row.advance_required_amount),
        "advance_paid_total": as_money(row.advance_paid_total),
        "balance_due": as_money(row.balance_due),
        "status": row.status,
        "expected_arrival_date": row.expected_arrival_date.isoformat() if row.expected_arrival_date else None,
        "expiry_date": row.expiry_date.isoformat() if row.expiry_date else None,
        "notes": row.notes,
        "linked_invoice_id": row.linked_invoice_id,
        "linked_invoice_no": row.linked_invoice.invoice_no if row.linked_invoice else None,
        "created_by": row.created_by,
        "created_by_name": row.creator.full_name if row.creator else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _serialize_estimate(row: RepairEstimate) -> dict:
    return {
        "id": row.id,
        "repair_ticket_id": row.repair_ticket_id,
        "repair_ticket_no": row.repair_ticket.ticket_no if row.repair_ticket else None,
        "customer_id": row.customer_id,
        "estimated_parts_cost": as_money(row.estimated_parts_cost),
        "estimated_labor_cost": as_money(row.estimated_labor_cost),
        "estimated_total": as_money(row.estimated_total),
        "advance_required": bool(row.advance_required),
        "advance_required_amount": as_money(row.advance_required_amount),
        "approval_status": row.approval_status,
        "notes": row.notes,
        "approved_at": row.approved_at.isoformat() if row.approved_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "created_by": row.created_by,
        "created_by_name": row.creator.full_name if row.creator else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _activity(
    db: Session,
    user_id: int | None,
    action: str,
    entity_type: str,
    entity_id: int,
    description: str,
    old_value: dict | None = None,
    new_value: dict | None = None,
) -> None:
    db.add(
        ActivityLog(
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=int(entity_id),
            description=description,
            old_value=None if old_value is None else str(old_value),
            new_value=None if new_value is None else str(new_value),
            is_reversible=False,
        )
    )


@router.get(
    "/advance-payments",
    dependencies=[Depends(require_permission("advance.view"))],
)
def list_advance_payments(
    customer_id: int | None = Query(default=None),
    advance_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    payment_method: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(AdvancePayment).filter(AdvancePayment.is_deleted == False)  # noqa: E712
    if customer_id:
        query = query.filter(AdvancePayment.customer_id == int(customer_id))
    if advance_type:
        query = query.filter(AdvancePayment.advance_type == str(advance_type).strip().lower())
    if status and str(status).lower() != "all":
        query = query.filter(AdvancePayment.status == str(status).strip().lower())
    if payment_method and str(payment_method).lower() != "all":
        query = query.filter(AdvancePayment.payment_method == _normalize_payment_method(payment_method))
    if date_from:
        try:
            query = query.filter(AdvancePayment.payment_date >= datetime.fromisoformat(str(date_from)))
        except Exception:
            pass
    if date_to:
        try:
            query = query.filter(AdvancePayment.payment_date <= datetime.fromisoformat(str(date_to)))
        except Exception:
            pass
    rows = query.order_by(AdvancePayment.payment_date.desc(), AdvancePayment.id.desc()).all()
    return [_serialize_advance(row) for row in rows]


@router.get(
    "/advance-payments/available",
    dependencies=[Depends(require_permission("advance.view"))],
)
def list_available_advance_payments(
    customer_id: int,
    repair_ticket_id: int | None = Query(default=None),
    reservation_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    _assert_customer(db, customer_id)
    rows = available_advances_query(
        db,
        customer_id=int(customer_id),
        repair_ticket_id=repair_ticket_id,
        reservation_id=reservation_id,
    )
    return [_serialize_advance(row) for row in rows]


@router.post(
    "/advance-payments",
    dependencies=[Depends(require_permission("advance.create"))],
)
def create_advance_payment(
    payload: AdvancePaymentIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    amount = as_money(payload.amount)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Advance amount must be greater than zero")
    advance_type = _normalize_advance_type(payload.advance_type)
    payment_method = _normalize_payment_method(payload.payment_method)

    customer = _assert_customer(db, payload.customer_id)

    repair = None
    if payload.repair_ticket_id:
        repair = db.query(RepairTicket).filter(RepairTicket.id == int(payload.repair_ticket_id)).first()
        if not repair:
            raise HTTPException(status_code=404, detail="Repair ticket not found")
        if int(repair.customer_id or 0) != int(customer.id):
            raise HTTPException(status_code=400, detail="Advance customer does not match repair ticket customer")

    reservation = None
    if payload.reservation_id:
        reservation = db.query(ProductReservation).filter(ProductReservation.id == int(payload.reservation_id)).first()
        if not reservation:
            raise HTTPException(status_code=404, detail="Product reservation not found")
        if int(reservation.customer_id or 0) != int(customer.id):
            raise HTTPException(status_code=400, detail="Advance customer does not match reservation customer")

    estimate = None
    if payload.estimate_id:
        estimate = db.query(RepairEstimate).filter(RepairEstimate.id == int(payload.estimate_id)).first()
        if not estimate:
            raise HTTPException(status_code=404, detail="Repair estimate not found")
        if int(estimate.customer_id or 0) != int(customer.id):
            raise HTTPException(status_code=400, detail="Advance customer does not match estimate customer")

    if not repair and not reservation and advance_type != "other":
        raise HTTPException(
            status_code=400,
            detail="Repair ticket or reservation must be linked unless this is a general customer advance",
        )

    estimated_total = 0.0
    if estimate:
        estimated_total = as_money(estimate.estimated_total)
    elif reservation:
        estimated_total = as_money(reservation.estimated_total)
    elif repair:
        estimated_total = as_money(repair.estimated_cost)

    settings = get_advance_settings(db)
    allow_above_estimate = bool(
        settings.get("allow_advance_greater_than_estimate", ADVANCE_SETTINGS_DEFAULT["allow_advance_greater_than_estimate"])
    )
    manager_override = bool(payload.manager_override_used)
    can_override = manager_override and (has_permission(db, current_user, "advance.override") or _is_manager_or_above(current_user))
    if estimated_total > 0 and amount > estimated_total and not allow_above_estimate and not can_override:
        raise HTTPException(
            status_code=400,
            detail=f"Advance amount exceeds estimated total ({estimated_total}). Manager override required.",
        )

    advance = AdvancePayment(
        advance_number=next_number(db, "ADV"),
        advance_type=advance_type,
        customer_id=customer.id,
        repair_ticket_id=repair.id if repair else None,
        product_order_id=payload.product_order_id,
        reservation_id=reservation.id if reservation else None,
        estimate_id=estimate.id if estimate else None,
        invoice_id=payload.invoice_id,
        amount=amount,
        applied_amount=0,
        refunded_amount=0,
        payment_method=payment_method,
        payment_date=payload.payment_date or utcnow(),
        status=ADVANCE_STATUS_RECEIVED,
        notes=payload.notes,
        received_by=payload.received_by or (current_user.id if current_user else None),
        manager_override_used=bool(can_override),
    )
    db.add(advance)
    db.flush()
    sync_repair_advance_totals(db, advance.repair_ticket_id)
    sync_reservation_advance_totals(db, advance.reservation_id)
    _activity(
        db=db,
        user_id=current_user.id if current_user else None,
        action="advance_received",
        entity_type="advance_payment",
        entity_id=advance.id,
        description=f"Advance received: {advance.advance_number}",
        new_value={
            "advance_number": advance.advance_number,
            "amount": amount,
            "advance_type": advance.advance_type,
            "customer_id": customer.id,
            "repair_ticket_id": advance.repair_ticket_id,
            "reservation_id": advance.reservation_id,
        },
    )
    record_ledger_entry(
        db,
        module="advance",
        entry_type="advance_received",
        direction="credit",
        amount=amount,
        account_code="customer_advances",
        reference_type="advance_payment",
        reference_id=advance.id,
        reference_number=advance.advance_number,
        source_table="advance_payments",
        source_id=advance.id,
        counterparty_type="customer",
        counterparty_id=customer.id,
        counterparty_name=customer.name,
        description=f"Advance received {advance.advance_number}",
        metadata={
            "advance_type": advance.advance_type,
            "payment_method": advance.payment_method,
            "repair_ticket_id": advance.repair_ticket_id,
            "reservation_id": advance.reservation_id,
        },
        user=current_user,
        entry_date=advance.payment_date,
    )
    db.commit()
    db.refresh(advance)
    return _serialize_advance(advance)


@router.get(
    "/advance-payments/{advance_id}",
    dependencies=[Depends(require_permission("advance.view"))],
)
def get_advance_payment(
    advance_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(AdvancePayment).filter(AdvancePayment.id == int(advance_id), AdvancePayment.is_deleted == False).first()  # noqa: E712
    if not row:
        raise HTTPException(status_code=404, detail="Advance payment not found")
    return _serialize_advance(row)


@router.get(
    "/advance-payments/{advance_id}/receipt",
    dependencies=[Depends(require_permission("advance.view"))],
)
def get_advance_payment_receipt(
    advance_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    advance = (
        db.query(AdvancePayment)
        .filter(AdvancePayment.id == int(advance_id), AdvancePayment.is_deleted == False)  # noqa: E712
        .first()
    )
    if not advance:
        raise HTTPException(status_code=404, detail="Advance payment not found")

    reservation = advance.reservation
    repair = advance.repair_ticket
    estimate = advance.estimate

    estimated_total = 0.0
    if estimate:
        estimated_total = as_money(estimate.estimated_total)
    elif reservation:
        estimated_total = as_money(reservation.estimated_total)
    elif repair:
        estimated_total = as_money(repair.estimated_cost)

    receipt = _get_store_profile_print_data(db)
    receipt.update(
        {
            "receipt_number": advance.advance_number,
            "advance_id": advance.id,
            "advance_type": advance.advance_type,
            "payment_date": advance.payment_date.isoformat() if advance.payment_date else None,
            "customer_id": advance.customer_id,
            "customer_name": advance.customer.name if advance.customer else None,
            "amount_paid": as_money(advance.amount),
            "payment_method": advance.payment_method,
            "received_by": advance.received_by,
            "received_by_name": advance.receiver.full_name if advance.receiver else None,
            "status": advance.status,
            "notes": advance.notes,
            "estimated_total": estimated_total,
            "remaining_balance": calc_advance_remaining(advance),
            "repair_ticket_id": repair.id if repair else None,
            "repair_ticket_number": repair.ticket_no if repair else None,
            "device_model": repair.device_model if repair else None,
            "device_imei": repair.imei if repair else None,
            "reservation_id": reservation.id if reservation else None,
            "reservation_number": reservation.reservation_number if reservation else None,
            "product_name": (
                reservation.requested_product_name
                or (reservation.product.name if reservation and reservation.product else None)
                if reservation
                else None
            ),
            "powered_by": SOFTWARE_NAME,
            "generated_at": utcnow().isoformat(),
        }
    )
    return receipt


@router.get(
    "/advance-payments/{advance_id}/receipt/html",
    dependencies=[Depends(require_permission("advance.view"))],
    response_class=HTMLResponse,
)
def print_advance_payment_receipt(
    advance_id: int,
    paper: str = Query(default="thermal_80"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    receipt = get_advance_payment_receipt(advance_id=advance_id, db=db, _=_)
    store = get_store_profile_print_data(db)
    return HTMLResponse(render_advance_receipt_html(receipt, store, thermal=str(paper).lower() != "a4"))


@router.get(
    "/advance-payments/customer/{customer_id}",
    dependencies=[Depends(require_permission("advance.view"))],
)
def get_customer_advances(
    customer_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    _assert_customer(db, customer_id)
    rows = (
        db.query(AdvancePayment)
        .filter(AdvancePayment.customer_id == int(customer_id), AdvancePayment.is_deleted == False)  # noqa: E712
        .order_by(AdvancePayment.payment_date.desc(), AdvancePayment.id.desc())
        .all()
    )
    return [_serialize_advance(row) for row in rows]


@router.get(
    "/advance-payments/repair/{repair_ticket_id}",
    dependencies=[Depends(require_permission("advance.view"))],
)
def get_repair_advances(
    repair_ticket_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    rows = (
        db.query(AdvancePayment)
        .filter(
            AdvancePayment.repair_ticket_id == int(repair_ticket_id),
            AdvancePayment.is_deleted == False,  # noqa: E712
        )
        .order_by(AdvancePayment.payment_date.desc(), AdvancePayment.id.desc())
        .all()
    )
    return [_serialize_advance(row) for row in rows]


@router.get(
    "/advance-payments/product-reservation/{reservation_id}",
    dependencies=[Depends(require_permission("advance.view"))],
)
def get_reservation_advances(
    reservation_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    rows = (
        db.query(AdvancePayment)
        .filter(
            AdvancePayment.reservation_id == int(reservation_id),
            AdvancePayment.is_deleted == False,  # noqa: E712
        )
        .order_by(AdvancePayment.payment_date.desc(), AdvancePayment.id.desc())
        .all()
    )
    return [_serialize_advance(row) for row in rows]


@router.patch(
    "/advance-payments/{advance_id}/apply",
    dependencies=[Depends(require_permission("advance.apply"))],
)
def apply_advance_payment(
    advance_id: int,
    payload: AdvancePaymentApplyIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    advance = db.query(AdvancePayment).filter(AdvancePayment.id == int(advance_id), AdvancePayment.is_deleted == False).first()  # noqa: E712
    if not advance:
        raise HTTPException(status_code=404, detail="Advance payment not found")
    invoice = db.query(Sale).filter(Sale.id == int(payload.invoice_id)).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    manager_override = bool(payload.manager_override_used)
    can_override = manager_override and (has_permission(db, current_user, "advance.override") or _is_manager_or_above(current_user))
    if int(invoice.customer_id or 0) != int(advance.customer_id or 0) and not can_override:
        raise HTTPException(status_code=400, detail="Advance cannot be applied to an unrelated customer invoice")

    old_status = str(advance.status or "")
    old_applied = as_money(advance.applied_amount)
    old_remaining = calc_advance_remaining(advance)
    payment = apply_advance_to_invoice(
        db=db,
        advance=advance,
        invoice_id=invoice.id,
        amount=payload.amount,
        user_id=current_user.id if current_user else None,
        note=payload.notes,
    )
    advance.manager_override_used = bool(advance.manager_override_used or can_override)

    # Recalculate invoice payment state after applying advance.
    invoice_payments_total = as_money(float(invoice.amount_paid or 0) + float(payment.amount or 0))
    invoice.amount_paid = invoice_payments_total
    invoice.balance_due = as_money(max(0.0, float(invoice.total or 0) - invoice_payments_total))
    invoice.payment_status = "paid" if invoice.balance_due <= 0 else "partial"

    sync_repair_advance_totals(db, advance.repair_ticket_id)
    sync_reservation_advance_totals(db, advance.reservation_id)
    _activity(
        db=db,
        user_id=current_user.id if current_user else None,
        action="advance_applied" if advance.status == ADVANCE_STATUS_APPLIED else "advance_partially_applied",
        entity_type="advance_payment",
        entity_id=advance.id,
        description=f"Advance {advance.advance_number} applied to invoice {invoice.invoice_no or invoice.id}",
        old_value={"status": old_status, "applied_amount": old_applied, "remaining_amount": old_remaining},
        new_value={
            "status": advance.status,
            "applied_amount": as_money(advance.applied_amount),
            "remaining_amount": calc_advance_remaining(advance),
            "invoice_id": invoice.id,
        },
    )
    db.commit()
    db.refresh(advance)
    return {"advance": _serialize_advance(advance), "invoice_balance_due": as_money(invoice.balance_due)}


@router.patch(
    "/advance-payments/{advance_id}/refund",
    dependencies=[Depends(require_permission("advance.refund"))],
)
def refund_advance_payment(
    advance_id: int,
    payload: AdvancePaymentRefundIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    advance = db.query(AdvancePayment).filter(AdvancePayment.id == int(advance_id), AdvancePayment.is_deleted == False).first()  # noqa: E712
    if not advance:
        raise HTTPException(status_code=404, detail="Advance payment not found")

    refund_amount = as_money(payload.amount)
    if refund_amount <= 0:
        raise HTTPException(status_code=400, detail="Refund amount must be greater than zero")
    reason = str(payload.reason or "").strip()
    if len(reason) < 5:
        raise HTTPException(status_code=400, detail="A descriptive refund reason is required")
    refund_method = _normalize_payment_method(payload.refund_method or advance.payment_method or "cash")

    settings = get_advance_settings(db)
    approval_required = bool(settings.get("manager_approval_required_for_refund", False))
    manager_override = bool(payload.manager_override_used)
    can_override = manager_override and (has_permission(db, current_user, "advance.override") or _is_manager_or_above(current_user))
    if approval_required and not can_override and not _is_manager_or_above(current_user):
        raise HTTPException(status_code=403, detail="Manager approval is required for advance refunds")

    # Only unapplied balance can be refunded directly to preserve invoice integrity.
    refundable_available = calc_advance_remaining(advance)
    if refund_amount > refundable_available:
        raise HTTPException(status_code=400, detail=f"Refundable amount is {refundable_available}")

    old_status = str(advance.status or "")
    old_refunded = as_money(advance.refunded_amount)
    advance.refunded_amount = as_money(float(advance.refunded_amount or 0) + refund_amount)
    remaining_after = calc_advance_remaining(advance)
    if as_money(advance.refunded_amount) >= as_money(advance.amount) and as_money(advance.applied_amount) <= 0:
        advance.status = ADVANCE_STATUS_REFUNDED
    else:
        advance.status = ADVANCE_STATUS_PARTIALLY_REFUNDED
    advance.refund_reason = reason
    advance.notes = _append_note(advance.notes, payload.notes)
    advance.notes = _append_note(advance.notes, f"Refund method: {refund_method}")
    advance.manager_override_used = bool(advance.manager_override_used or can_override)
    advance.updated_at = utcnow()

    sync_repair_advance_totals(db, advance.repair_ticket_id)
    sync_reservation_advance_totals(db, advance.reservation_id)
    _activity(
        db=db,
        user_id=current_user.id if current_user else None,
        action="advance_refunded",
        entity_type="advance_payment",
        entity_id=advance.id,
        description=f"Advance refund processed: {advance.advance_number}",
        old_value={"status": old_status, "refunded_amount": old_refunded},
        new_value={
            "status": advance.status,
            "refunded_amount": as_money(advance.refunded_amount),
            "remaining_amount": remaining_after,
            "reason": reason,
            "refund_method": refund_method,
            "convert_to_customer_credit": bool(payload.convert_to_customer_credit),
        },
    )
    record_ledger_entry(
        db,
        module="advance",
        entry_type="advance_refunded",
        direction="debit",
        amount=refund_amount,
        account_code="customer_advances",
        reference_type="advance_payment",
        reference_id=advance.id,
        reference_number=advance.advance_number,
        source_table="advance_payments",
        source_id=advance.id,
        counterparty_type="customer",
        counterparty_id=advance.customer_id,
        counterparty_name=advance.customer.name if advance.customer else None,
        description=f"Advance refunded {advance.advance_number}",
        metadata={"refund_method": refund_method, "reason": reason, "remaining_after": remaining_after},
        user=current_user,
    )
    db.commit()
    db.refresh(advance)
    return _serialize_advance(advance)


@router.patch(
    "/advance-payments/{advance_id}/cancel",
    dependencies=[Depends(require_permission("advance.cancel"))],
)
def cancel_advance_payment(
    advance_id: int,
    payload: AdvancePaymentCancelIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    advance = db.query(AdvancePayment).filter(AdvancePayment.id == int(advance_id), AdvancePayment.is_deleted == False).first()  # noqa: E712
    if not advance:
        raise HTTPException(status_code=404, detail="Advance payment not found")
    reason = str(payload.reason or "").strip()
    if len(reason) < 5:
        raise HTTPException(status_code=400, detail="A descriptive cancellation reason is required")

    settings = get_advance_settings(db)
    approval_required = bool(settings.get("manager_approval_required_for_cancellation", False))
    manager_override = bool(payload.manager_override_used)
    can_override = manager_override and (has_permission(db, current_user, "advance.override") or _is_manager_or_above(current_user))
    if approval_required and not can_override and not _is_manager_or_above(current_user):
        raise HTTPException(status_code=403, detail="Manager approval is required for advance cancellation")
    if as_money(advance.applied_amount) > 0 and not can_override:
        raise HTTPException(status_code=409, detail="Applied advance cannot be cancelled without manager override")
    if str(advance.status or "").lower() == ADVANCE_STATUS_CANCELLED:
        return _serialize_advance(advance)

    old_status = str(advance.status or "")
    advance.status = ADVANCE_STATUS_CANCELLED
    advance.cancellation_reason = reason
    advance.notes = _append_note(advance.notes, payload.notes)
    advance.manager_override_used = bool(advance.manager_override_used or can_override)
    advance.updated_at = utcnow()
    sync_repair_advance_totals(db, advance.repair_ticket_id)
    sync_reservation_advance_totals(db, advance.reservation_id)
    _activity(
        db=db,
        user_id=current_user.id if current_user else None,
        action="advance_cancelled",
        entity_type="advance_payment",
        entity_id=advance.id,
        description=f"Advance cancelled: {advance.advance_number}",
        old_value={"status": old_status},
        new_value={"status": advance.status, "reason": reason},
    )
    db.commit()
    db.refresh(advance)
    return _serialize_advance(advance)


@router.get(
    "/product-reservations",
    dependencies=[Depends(require_permission("reservation.view"))],
)
def list_product_reservations(
    status: str | None = Query(default=None),
    customer_id: int | None = Query(default=None),
    reservation_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(ProductReservation)
    if status and str(status).lower() != "all":
        query = query.filter(ProductReservation.status == str(status).strip().lower())
    if customer_id:
        query = query.filter(ProductReservation.customer_id == int(customer_id))
    if reservation_type and str(reservation_type).lower() != "all":
        query = query.filter(ProductReservation.reservation_type == _normalize_reservation_type(reservation_type))
    rows = query.order_by(ProductReservation.created_at.desc(), ProductReservation.id.desc()).all()
    return [_serialize_reservation(row) for row in rows]


@router.post(
    "/product-reservations",
    dependencies=[Depends(require_permission("reservation.create"))],
)
def create_product_reservation(
    payload: ProductReservationIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    customer = _assert_customer(db, payload.customer_id)
    qty = int(payload.quantity or 0)
    if qty <= 0:
        raise HTTPException(status_code=400, detail="Reservation quantity must be greater than zero")

    reservation_type = _normalize_reservation_type(payload.reservation_type)
    product = None
    if payload.product_id:
        product = db.query(InventoryItem).filter(InventoryItem.id == int(payload.product_id), InventoryItem.is_deleted == False).first()  # noqa: E712
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
    if reservation_type == "in_stock_reservation" and not product:
        raise HTTPException(status_code=400, detail="In-stock reservation requires product selection")

    if product and reservation_type == "in_stock_reservation":
        reserved_qty = get_reserved_qty_for_item(db, int(product.id))
        available_qty = int(product.quantity or 0) - int(reserved_qty or 0)
        if qty > available_qty:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient available stock. Available after reservations: {max(0, available_qty)}",
            )

    estimated_total = as_money(payload.estimated_total)
    if estimated_total <= 0 and product:
        estimated_total = as_money(float(product.sale_price or 0) * qty)

    settings = get_advance_settings(db)
    threshold = as_money(settings.get("require_advance_above_amount", 0))
    default_min_pct = float(settings.get("default_minimum_advance_percentage", 0) or 0)

    advance_required = bool(payload.advance_required)
    if estimated_total >= threshold > 0:
        advance_required = True
    advance_required_amount = as_money(payload.advance_required_amount)
    if advance_required and advance_required_amount <= 0 and default_min_pct > 0:
        advance_required_amount = as_money((estimated_total * default_min_pct) / 100)

    reservation_prefix = "RSV" if reservation_type == "in_stock_reservation" else "ORD"
    row = ProductReservation(
        reservation_number=next_number(db, reservation_prefix),
        customer_id=customer.id,
        product_id=product.id if product else None,
        variant_id=payload.variant_id,
        serial_id=payload.serial_id,
        requested_product_name=payload.requested_product_name,
        reservation_type=reservation_type,
        quantity=qty,
        estimated_total=estimated_total,
        advance_required=advance_required,
        advance_required_amount=advance_required_amount,
        advance_paid_total=0,
        balance_due=estimated_total,
        status="draft",
        expected_arrival_date=payload.expected_arrival_date,
        expiry_date=payload.expiry_date,
        notes=payload.notes,
        created_by=current_user.id if current_user else None,
    )
    db.add(row)
    db.flush()
    _activity(
        db=db,
        user_id=current_user.id if current_user else None,
        action="product_reservation_created",
        entity_type="product_reservation",
        entity_id=row.id,
        description=f"Product reservation created: {row.reservation_number}",
        new_value={
            "reservation_number": row.reservation_number,
            "customer_id": row.customer_id,
            "product_id": row.product_id,
            "quantity": row.quantity,
            "estimated_total": row.estimated_total,
            "advance_required_amount": row.advance_required_amount,
        },
    )
    db.commit()
    db.refresh(row)
    return _serialize_reservation(row)


@router.get(
    "/product-reservations/{reservation_id}",
    dependencies=[Depends(require_permission("reservation.view"))],
)
def get_product_reservation(
    reservation_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(ProductReservation).filter(ProductReservation.id == int(reservation_id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Product reservation not found")
    return _serialize_reservation(row)


@router.patch(
    "/product-reservations/{reservation_id}",
    dependencies=[Depends(require_permission("reservation.edit"))],
)
def update_product_reservation(
    reservation_id: int,
    payload: ProductReservationUpdateIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(ProductReservation).filter(ProductReservation.id == int(reservation_id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Product reservation not found")

    updates = payload.model_dump(exclude_unset=True)
    if "reservation_type" in updates:
        updates["reservation_type"] = _normalize_reservation_type(updates["reservation_type"])
    if "status" in updates and updates["status"] is not None:
        status = str(updates["status"]).strip().lower()
        if status not in RESERVATION_ALLOWED_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid reservation status")
        updates["status"] = status

    if "product_id" in updates and updates["product_id"]:
        product = db.query(InventoryItem).filter(InventoryItem.id == int(updates["product_id"]), InventoryItem.is_deleted == False).first()  # noqa: E712
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")

    old = _serialize_reservation(row)
    for key, value in updates.items():
        setattr(row, key, value)
    row.updated_at = utcnow()
    sync_reservation_advance_totals(db, row.id)
    _activity(
        db=db,
        user_id=current_user.id if current_user else None,
        action="product_reservation_updated",
        entity_type="product_reservation",
        entity_id=row.id,
        description=f"Product reservation updated: {row.reservation_number}",
        old_value=old,
        new_value=_serialize_reservation(row),
    )
    db.commit()
    db.refresh(row)
    return _serialize_reservation(row)


def _set_reservation_status(
    db: Session,
    row: ProductReservation,
    new_status: str,
    notes: str | None,
) -> None:
    row.status = str(new_status).strip().lower()
    row.notes = _append_note(row.notes, notes)
    row.updated_at = utcnow()


@router.patch(
    "/product-reservations/{reservation_id}/reserve",
    dependencies=[Depends(require_permission("reservation.edit"))],
)
def mark_reservation_reserved(
    reservation_id: int,
    payload: ProductReservationStatusIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(ProductReservation).filter(ProductReservation.id == int(reservation_id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Product reservation not found")
    if row.product_id:
        product = db.query(InventoryItem).filter(InventoryItem.id == int(row.product_id)).first()
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        reserved_qty = get_reserved_qty_for_item(db, int(product.id), exclude_reservation_id=row.id)
        available_qty = int(product.quantity or 0) - int(reserved_qty or 0)
        if int(row.quantity or 0) > available_qty:
            raise HTTPException(status_code=400, detail=f"Only {max(0, available_qty)} units are available to reserve")
    _set_reservation_status(db, row, "reserved", payload.notes)
    _activity(
        db=db,
        user_id=current_user.id if current_user else None,
        action="product_reservation_reserved",
        entity_type="product_reservation",
        entity_id=row.id,
        description=f"Reservation marked as reserved: {row.reservation_number}",
    )
    db.commit()
    db.refresh(row)
    return _serialize_reservation(row)


@router.patch(
    "/product-reservations/{reservation_id}/mark-ordered",
    dependencies=[Depends(require_permission("reservation.edit"))],
)
def mark_reservation_ordered(
    reservation_id: int,
    payload: ProductReservationStatusIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(ProductReservation).filter(ProductReservation.id == int(reservation_id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Product reservation not found")
    _set_reservation_status(db, row, "ordered", payload.notes)
    if payload.expected_arrival_date:
        row.expected_arrival_date = payload.expected_arrival_date
    _activity(
        db=db,
        user_id=current_user.id if current_user else None,
        action="product_reservation_marked_ordered",
        entity_type="product_reservation",
        entity_id=row.id,
        description=f"Reservation marked ordered: {row.reservation_number}",
    )
    db.commit()
    db.refresh(row)
    return _serialize_reservation(row)


@router.patch(
    "/product-reservations/{reservation_id}/mark-received",
    dependencies=[Depends(require_permission("reservation.edit"))],
)
def mark_reservation_received(
    reservation_id: int,
    payload: ProductReservationStatusIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(ProductReservation).filter(ProductReservation.id == int(reservation_id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Product reservation not found")

    if payload.product_id:
        product = db.query(InventoryItem).filter(InventoryItem.id == int(payload.product_id), InventoryItem.is_deleted == False).first()  # noqa: E712
        if not product:
            raise HTTPException(status_code=404, detail="Linked product not found")
        row.product_id = int(product.id)
    if payload.serial_id:
        serial = db.query(InventorySerial).filter(InventorySerial.id == int(payload.serial_id)).first()
        if not serial:
            raise HTTPException(status_code=404, detail="Linked serial not found")
        row.serial_id = serial.id
    _set_reservation_status(db, row, "received", payload.notes)
    _activity(
        db=db,
        user_id=current_user.id if current_user else None,
        action="product_reservation_marked_received",
        entity_type="product_reservation",
        entity_id=row.id,
        description=f"Reservation marked received: {row.reservation_number}",
    )
    db.commit()
    db.refresh(row)
    return _serialize_reservation(row)


@router.patch(
    "/product-reservations/{reservation_id}/cancel",
    dependencies=[Depends(require_permission("reservation.cancel"))],
)
def cancel_product_reservation(
    reservation_id: int,
    payload: ProductReservationStatusIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(ProductReservation).filter(ProductReservation.id == int(reservation_id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Product reservation not found")
    reason = str(payload.reason or "").strip()
    if len(reason) < 5:
        raise HTTPException(status_code=400, detail="A descriptive cancellation reason is required")
    _set_reservation_status(db, row, "cancelled", payload.notes or reason)
    _activity(
        db=db,
        user_id=current_user.id if current_user else None,
        action="product_reservation_cancelled",
        entity_type="product_reservation",
        entity_id=row.id,
        description=f"Reservation cancelled: {row.reservation_number}. Reason: {reason}",
    )
    db.commit()
    db.refresh(row)
    return _serialize_reservation(row)


@router.post(
    "/product-reservations/{reservation_id}/create-invoice",
    dependencies=[Depends(require_permission("reservation.invoice"))],
)
def create_invoice_from_reservation(
    reservation_id: int,
    payload: ProductReservationCreateInvoiceIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ensure_warranty_defaults(db)
    row = db.query(ProductReservation).filter(ProductReservation.id == int(reservation_id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Product reservation not found")
    if row.status in {"cancelled", "refunded"}:
        raise HTTPException(status_code=409, detail="Cancelled/refunded reservation cannot be invoiced")
    if row.linked_invoice_id:
        existing = db.query(Sale).filter(Sale.id == int(row.linked_invoice_id)).first()
        if existing:
            return {
                "invoice_id": existing.id,
                "invoice_no": existing.invoice_no,
                "reservation": _serialize_reservation(row),
                "already_invoiced": True,
            }

    product = None
    if row.product_id:
        product = db.query(InventoryItem).filter(InventoryItem.id == int(row.product_id)).first()
        if not product:
            raise HTTPException(status_code=404, detail="Linked product not found")

    qty = int(row.quantity or 0)
    if qty <= 0:
        raise HTTPException(status_code=400, detail="Reservation quantity must be positive")

    estimated_total = as_money(row.estimated_total)
    unit_price = as_money((estimated_total / qty) if qty > 0 else 0)
    if product and unit_price <= 0:
        unit_price = as_money(product.sale_price)
    subtotal = as_money(unit_price * qty)
    total = as_money(max(0.0, subtotal - float(payload.discount_amount or 0) + float(payload.tax_amount or 0)))

    applied_total = 0.0
    advances_applied_payload = []
    if payload.auto_apply_advances:
        available_rows = available_advances_query(
            db,
            customer_id=int(row.customer_id),
            reservation_id=int(row.id),
        )
        for advance in available_rows:
            still_needed = as_money(total - applied_total)
            if still_needed <= 0:
                break
            amount_to_apply = as_money(min(calc_advance_remaining(advance), still_needed))
            if amount_to_apply <= 0:
                continue
            advances_applied_payload.append((advance, amount_to_apply))
            applied_total = as_money(applied_total + amount_to_apply)

    due_after_adv = as_money(max(0.0, total - applied_total))
    payment_method = str(payload.payment_method or "Cash").strip()
    cash_amount = as_money(payload.cash_amount)
    card_amount = as_money(payload.card_amount)
    method_key = payment_method.lower()
    if bool(payload.paid):
        if method_key == "cash":
            cash_amount = due_after_adv
            card_amount = 0
        elif method_key == "card":
            card_amount = due_after_adv
            cash_amount = 0
        elif method_key == "mixed":
            if cash_amount + card_amount <= 0:
                cash_amount = due_after_adv
                card_amount = 0
        else:
            cash_amount = due_after_adv
            card_amount = 0

    tendered_now = due_after_adv if bool(payload.paid) else as_money(
        cash_amount + card_amount if method_key == "mixed" else (card_amount if method_key == "card" else cash_amount)
    )
    direct_paid_now = as_money(min(due_after_adv, tendered_now))
    invoice_amount_paid = as_money(applied_total + direct_paid_now)
    balance_due = as_money(max(0.0, total - invoice_amount_paid))

    sale = Sale(
        invoice_no=next_number(db, "INV"),
        invoice_type="reservation_invoice",
        customer_id=row.customer_id,
        repair_ticket_id=None,
        reservation_id=row.id,
        subtotal=subtotal,
        discount_amount=as_money(payload.discount_amount),
        tax_amount=as_money(payload.tax_amount),
        total=total,
        advance_applied_total=as_money(applied_total),
        payment_method=payment_method,
        cash_amount=cash_amount,
        card_amount=card_amount,
        amount_paid=invoice_amount_paid,
        balance_due=balance_due,
        payment_status="paid" if balance_due <= 0 else "partial",
        invoice_status="finalized",
        paid=bool(payload.paid and balance_due <= 0),
        is_return=False,
        created_by=current_user.id if current_user else None,
        finalized_at=utcnow(),
    )
    db.add(sale)
    db.flush()

    line_description = row.requested_product_name or (product.name if product else "Reserved Product")
    sale_item = SaleItem(
        sale_id=sale.id,
        item_id=product.id if product else None,
        line_type="product" if product else "service",
        description=line_description,
        quantity=qty,
        price=unit_price,
        discount_amount=0,
        line_total=as_money(qty * unit_price),
        cost_price=float(product.cost_price or 0) if product else 0,
        warranty_days=int(product.warranty_days or 0) if product else 0,
        serial_number=row.serial.serial_number if row.serial else None,
    )
    db.add(sale_item)
    db.flush()

    if product:
        reserved_qty_elsewhere = get_reserved_qty_for_item(db, int(product.id), exclude_reservation_id=row.id)
        available_qty = int(product.quantity or 0) - int(reserved_qty_elsewhere or 0)
        if qty > available_qty:
            raise HTTPException(status_code=400, detail=f"Insufficient available stock. Available: {max(0, available_qty)}")
        product.quantity = int(product.quantity or 0) - qty
        db.add(
            StockMovement(
                item_id=product.id,
                user_id=current_user.id if current_user else None,
                movement_type="SALE_OUT",
                quantity=-qty,
                reference_type="sale",
                reference_id=sale.id,
                note=f"Invoice {sale.invoice_no} from reservation {row.reservation_number}",
            )
        )
        if row.serial_id:
            serial = db.query(InventorySerial).filter(InventorySerial.id == int(row.serial_id)).first()
            if serial:
                serial.status = "sold"
                serial.sale_id = sale.id

    customer = db.query(Customer).filter(Customer.id == int(row.customer_id)).first()
    created_warranties = create_sale_warranty_records(
        db=db,
        sale=sale,
        sale_items=[sale_item],
        customer=customer,
        created_by_id=current_user.id if current_user else None,
    )

    if direct_paid_now > 0:
        if method_key == "mixed":
            if cash_amount > 0:
                db.add(
                    InvoicePayment(
                        payment_number=next_number(db, "PAY"),
                        invoice_id=sale.id,
                        customer_id=sale.customer_id,
                        amount=as_money(min(cash_amount, direct_paid_now)),
                        payment_method="cash",
                        payment_type="balance_payment" if applied_total > 0 else "normal",
                        received_by=current_user.id if current_user else None,
                        notes=f"Reservation invoice direct cash payment ({row.reservation_number})",
                    )
                )
            if card_amount > 0:
                db.add(
                    InvoicePayment(
                        payment_number=next_number(db, "PAY"),
                        invoice_id=sale.id,
                        customer_id=sale.customer_id,
                        amount=as_money(min(card_amount, max(0.0, direct_paid_now - cash_amount))),
                        payment_method="card",
                        payment_type="balance_payment" if applied_total > 0 else "normal",
                        received_by=current_user.id if current_user else None,
                        notes=f"Reservation invoice direct card payment ({row.reservation_number})",
                    )
                )
        else:
            db.add(
                InvoicePayment(
                    payment_number=next_number(db, "PAY"),
                    invoice_id=sale.id,
                    customer_id=sale.customer_id,
                    amount=as_money(direct_paid_now),
                    payment_method=method_key.replace(" ", "_"),
                    payment_type="balance_payment" if applied_total > 0 else "normal",
                    received_by=current_user.id if current_user else None,
                    notes=f"Reservation invoice direct payment ({row.reservation_number})",
                )
            )

    for advance, amount_to_apply in advances_applied_payload:
        apply_advance_to_invoice(
            db=db,
            advance=advance,
            invoice_id=sale.id,
            amount=amount_to_apply,
            user_id=current_user.id if current_user else None,
            note=f"Auto-applied from reservation invoice {sale.invoice_no}",
        )

    row.linked_invoice_id = sale.id
    row.status = "completed" if balance_due <= 0 else "invoiced"
    row.updated_at = utcnow()
    sync_reservation_advance_totals(db, row.id)
    _activity(
        db=db,
        user_id=current_user.id if current_user else None,
        action="product_reservation_invoiced",
        entity_type="product_reservation",
        entity_id=row.id,
        description=f"Reservation converted to invoice {sale.invoice_no}",
        new_value={"invoice_id": sale.id, "invoice_no": sale.invoice_no, "balance_due": balance_due},
    )
    db.commit()
    db.refresh(row)
    return {
        "invoice_id": sale.id,
        "invoice_no": sale.invoice_no,
        "reservation": _serialize_reservation(row),
        "applied_advance_total": as_money(applied_total),
        "balance_due": balance_due,
        "warranty_records": [
            {
                "warranty_id": w.warranty_code,
                "item_name": w.product_or_service_name,
                "start_date": w.start_date.isoformat() if w.start_date else None,
                "end_date": w.end_date.isoformat() if w.end_date else None,
            }
            for w in created_warranties
        ],
    }


@router.post(
    "/repairs/{repair_ticket_id}/estimate",
    dependencies=[Depends(require_permission("repairs.edit"))],
)
def create_or_update_repair_estimate(
    repair_ticket_id: int,
    payload: RepairEstimateIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    repair = db.query(RepairTicket).filter(RepairTicket.id == int(repair_ticket_id), RepairTicket.is_deleted == False).first()  # noqa: E712
    if not repair:
        raise HTTPException(status_code=404, detail="Repair ticket not found")

    parts_cost = as_money(payload.estimated_parts_cost)
    labor_cost = as_money(payload.estimated_labor_cost)
    estimated_total = as_money(payload.estimated_total if payload.estimated_total > 0 else (parts_cost + labor_cost))
    advance_required_amount = as_money(payload.advance_required_amount)

    row = db.query(RepairEstimate).filter(RepairEstimate.repair_ticket_id == int(repair.id)).first()
    if not row:
        row = RepairEstimate(
            repair_ticket_id=repair.id,
            customer_id=repair.customer_id,
            estimated_parts_cost=parts_cost,
            estimated_labor_cost=labor_cost,
            estimated_total=estimated_total,
            advance_required=bool(payload.advance_required),
            advance_required_amount=advance_required_amount,
            approval_status="pending",
            notes=payload.notes,
            created_by=current_user.id if current_user else None,
        )
        db.add(row)
    else:
        row.estimated_parts_cost = parts_cost
        row.estimated_labor_cost = labor_cost
        row.estimated_total = estimated_total
        row.advance_required = bool(payload.advance_required)
        row.advance_required_amount = advance_required_amount
        row.approval_status = "pending"
        row.notes = payload.notes
        row.updated_at = utcnow()

    repair.estimated_cost = estimated_total
    repair.estimate_status = "estimated"
    repair.approval_status = "pending"
    sync_repair_advance_totals(db, repair.id)
    _activity(
        db=db,
        user_id=current_user.id if current_user else None,
        action="repair_estimate_saved",
        entity_type="repair_ticket",
        entity_id=repair.id,
        description=f"Estimate saved for repair {repair.ticket_no}",
        new_value={
            "estimated_total": estimated_total,
            "advance_required": bool(payload.advance_required),
            "advance_required_amount": advance_required_amount,
        },
    )
    db.commit()
    db.refresh(row)
    return _serialize_estimate(row)


@router.get(
    "/repairs/{repair_ticket_id}/estimate",
    dependencies=[Depends(require_permission("repairs.view"))],
)
def get_repair_estimate(
    repair_ticket_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(RepairEstimate).filter(RepairEstimate.repair_ticket_id == int(repair_ticket_id)).first()
    if not row:
        repair = db.query(RepairTicket).filter(RepairTicket.id == int(repair_ticket_id), RepairTicket.is_deleted == False).first()  # noqa: E712
        if not repair:
            raise HTTPException(status_code=404, detail="Repair ticket not found")
        return {
            "id": None,
            "repair_ticket_id": repair.id,
            "repair_ticket_no": repair.ticket_no,
            "customer_id": repair.customer_id,
            "estimated_parts_cost": 0,
            "estimated_labor_cost": as_money(repair.estimated_cost),
            "estimated_total": as_money(repair.estimated_cost),
            "advance_required": False,
            "advance_required_amount": 0,
            "approval_status": "pending",
            "notes": None,
            "approved_at": None,
            "created_at": None,
            "created_by": None,
            "created_by_name": None,
            "updated_at": None,
        }
    return _serialize_estimate(row)


@router.patch(
    "/repairs/{repair_ticket_id}/estimate/approve",
    dependencies=[Depends(require_permission("repairs.approve"))],
)
def approve_repair_estimate(
    repair_ticket_id: int,
    payload: RepairEstimateDecisionIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(RepairEstimate).filter(RepairEstimate.repair_ticket_id == int(repair_ticket_id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Repair estimate not found")
    repair = db.query(RepairTicket).filter(RepairTicket.id == int(repair_ticket_id)).first()
    if not repair:
        raise HTTPException(status_code=404, detail="Repair ticket not found")

    row.approval_status = "approved"
    row.approved_at = utcnow()
    row.notes = _append_note(row.notes, payload.notes)
    row.updated_at = utcnow()
    repair.approval_status = "approved"
    repair.estimate_status = "approved"
    repair.approved_at = utcnow()
    _activity(
        db=db,
        user_id=current_user.id if current_user else None,
        action="repair_estimate_approved",
        entity_type="repair_ticket",
        entity_id=repair.id,
        description=f"Estimate approved for repair {repair.ticket_no}",
    )
    db.commit()
    db.refresh(row)
    return _serialize_estimate(row)


@router.patch(
    "/repairs/{repair_ticket_id}/estimate/reject",
    dependencies=[Depends(require_permission("repairs.approve"))],
)
def reject_repair_estimate(
    repair_ticket_id: int,
    payload: RepairEstimateDecisionIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(RepairEstimate).filter(RepairEstimate.repair_ticket_id == int(repair_ticket_id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Repair estimate not found")
    repair = db.query(RepairTicket).filter(RepairTicket.id == int(repair_ticket_id)).first()
    if not repair:
        raise HTTPException(status_code=404, detail="Repair ticket not found")

    row.approval_status = "rejected"
    row.notes = _append_note(row.notes, payload.notes)
    row.updated_at = utcnow()
    repair.approval_status = "rejected"
    repair.estimate_status = "rejected"
    _activity(
        db=db,
        user_id=current_user.id if current_user else None,
        action="repair_estimate_rejected",
        entity_type="repair_ticket",
        entity_id=repair.id,
        description=f"Estimate rejected for repair {repair.ticket_no}",
        new_value={"notes": payload.notes},
    )
    db.commit()
    db.refresh(row)
    return _serialize_estimate(row)
