import json
from typing import Any

from fastapi import HTTPException
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.models import (
    AdvancePayment,
    AppSetting,
    InvoicePayment,
    ProductReservation,
    RepairTicket,
)
from app.services.numbering_service import next_number
from app.utils.money import to_float
from app.utils.time import utcnow


ADVANCE_STATUS_CANCELLED = "cancelled"
ADVANCE_STATUS_APPLIED = "applied"
ADVANCE_STATUS_PARTIALLY_APPLIED = "partially_applied"
ADVANCE_STATUS_REFUNDED = "refunded"
ADVANCE_STATUS_PARTIALLY_REFUNDED = "partially_refunded"
ADVANCE_STATUS_RECEIVED = "received"

ADVANCE_NON_APPLICABLE_STATUSES = {
    ADVANCE_STATUS_CANCELLED,
    ADVANCE_STATUS_REFUNDED,
}

ADVANCE_SETTINGS_DEFAULT = {
    "enable_repair_advance": True,
    "enable_product_reservation_advance": True,
    "require_advance_above_amount": 0,
    "default_minimum_advance_percentage": 0,
    "allow_advance_greater_than_estimate": False,
    "manager_approval_required_for_refund": False,
    "manager_approval_required_for_cancellation": False,
    "auto_apply_advance_to_final_invoice": False,
    "reservation_expiry_days": 14,
    "receipt_template_settings": {"show_terms": True},
}

RESERVATION_STATUS_RESERVES_STOCK = {"reserved", "ordered", "received", "invoiced"}


def as_money(value: Any) -> float:
    return to_float(value)


def calc_advance_remaining(advance: AdvancePayment) -> float:
    return as_money(max(0.0, float(advance.amount or 0) - float(advance.applied_amount or 0) - float(advance.refunded_amount or 0)))


def calc_advance_effective_paid(advance: AdvancePayment) -> float:
    return as_money(max(0.0, float(advance.amount or 0) - float(advance.refunded_amount or 0)))


def get_advance_settings(db: Session) -> dict[str, Any]:
    row = db.query(AppSetting).filter(AppSetting.key == "settings_state_v2").first()
    if not row or not row.value:
        return dict(ADVANCE_SETTINGS_DEFAULT)
    try:
        payload = json.loads(row.value)
    except Exception:
        return dict(ADVANCE_SETTINGS_DEFAULT)

    configured = (
        (payload or {})
        .get("financial_settings", {})
        .get("advance_payment_settings", {})
    )
    merged = dict(ADVANCE_SETTINGS_DEFAULT)
    if isinstance(configured, dict):
        merged.update(configured)
    return merged


def sync_repair_advance_totals(db: Session, repair_ticket_id: int | None) -> None:
    if not repair_ticket_id:
        return
    repair = db.query(RepairTicket).filter(RepairTicket.id == int(repair_ticket_id)).first()
    if not repair:
        return
    advances = (
        db.query(AdvancePayment)
        .filter(
            AdvancePayment.repair_ticket_id == int(repair_ticket_id),
            AdvancePayment.is_deleted == False,  # noqa: E712
            AdvancePayment.status != ADVANCE_STATUS_CANCELLED,
        )
        .all()
    )
    paid_total = as_money(sum(calc_advance_effective_paid(row) for row in advances))
    repair.advance_payment = paid_total
    repair.outstanding_balance = as_money(max(0.0, float(repair.estimated_cost or 0) - paid_total))
    repair.payment_status = "paid" if float(repair.outstanding_balance or 0) <= 0 else "unpaid"


def sync_reservation_advance_totals(db: Session, reservation_id: int | None) -> None:
    if not reservation_id:
        return
    reservation = db.query(ProductReservation).filter(ProductReservation.id == int(reservation_id)).first()
    if not reservation:
        return
    advances = (
        db.query(AdvancePayment)
        .filter(
            AdvancePayment.reservation_id == int(reservation_id),
            AdvancePayment.is_deleted == False,  # noqa: E712
            AdvancePayment.status != ADVANCE_STATUS_CANCELLED,
        )
        .all()
    )
    paid_total = as_money(sum(calc_advance_effective_paid(row) for row in advances))
    reservation.advance_paid_total = paid_total
    reservation.balance_due = as_money(max(0.0, float(reservation.estimated_total or 0) - paid_total))


def get_reserved_qty_for_item(db: Session, item_id: int, exclude_reservation_id: int | None = None) -> int:
    filters = [
        ProductReservation.product_id == int(item_id),
        ProductReservation.status.in_(RESERVATION_STATUS_RESERVES_STOCK),
    ]
    if exclude_reservation_id:
        filters.append(ProductReservation.id != int(exclude_reservation_id))
    reserved_qty = (
        db.query(func.coalesce(func.sum(ProductReservation.quantity), 0))
        .filter(and_(*filters))
        .scalar()
        or 0
    )
    return int(reserved_qty or 0)


def available_advances_query(
    db: Session,
    customer_id: int,
    repair_ticket_id: int | None = None,
    reservation_id: int | None = None,
) -> list[AdvancePayment]:
    base_filters = [
        AdvancePayment.customer_id == int(customer_id),
        AdvancePayment.is_deleted == False,  # noqa: E712
        AdvancePayment.status.notin_(ADVANCE_NON_APPLICABLE_STATUSES),
    ]

    if repair_ticket_id or reservation_id:
        link_filters = []
        if repair_ticket_id:
            link_filters.append(AdvancePayment.repair_ticket_id == int(repair_ticket_id))
        if reservation_id:
            link_filters.append(AdvancePayment.reservation_id == int(reservation_id))
        # Allow generic customer advances as fallback.
        link_filters.append(
            and_(
                AdvancePayment.repair_ticket_id.is_(None),
                AdvancePayment.reservation_id.is_(None),
            )
        )
        base_filters.append(or_(*link_filters))

    rows = (
        db.query(AdvancePayment)
        .filter(and_(*base_filters))
        .order_by(AdvancePayment.payment_date.asc(), AdvancePayment.id.asc())
        .all()
    )
    return [row for row in rows if calc_advance_remaining(row) > 0]


def apply_advance_to_invoice(
    db: Session,
    advance: AdvancePayment,
    invoice_id: int,
    amount: float,
    user_id: int | None = None,
    note: str | None = None,
) -> InvoicePayment:
    amount_to_apply = as_money(amount)
    if amount_to_apply <= 0:
        raise HTTPException(status_code=400, detail="Advance apply amount must be greater than zero")
    if str(advance.status or "").lower() in ADVANCE_NON_APPLICABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Advance cannot be applied in the current status")
    remaining = calc_advance_remaining(advance)
    if amount_to_apply > remaining:
        raise HTTPException(status_code=400, detail=f"Advance remaining amount is {remaining}")
    if advance.invoice_id and int(advance.invoice_id) != int(invoice_id):
        raise HTTPException(status_code=409, detail="Advance is already linked to another invoice")

    advance.applied_amount = as_money(float(advance.applied_amount or 0) + amount_to_apply)
    advance.invoice_id = int(invoice_id)
    advance.updated_at = utcnow()
    remaining_after = calc_advance_remaining(advance)
    if remaining_after <= 0:
        advance.status = ADVANCE_STATUS_APPLIED
    elif float(advance.applied_amount or 0) > 0:
        advance.status = ADVANCE_STATUS_PARTIALLY_APPLIED
    else:
        advance.status = ADVANCE_STATUS_RECEIVED
    if note:
        old = str(advance.notes or "").strip()
        advance.notes = f"{old}\n{note}".strip() if old else note

    payment = InvoicePayment(
        payment_number=next_number(db, "PAY"),
        invoice_id=int(invoice_id),
        customer_id=advance.customer_id,
        amount=amount_to_apply,
        payment_method=str(advance.payment_method or "cash"),
        payment_type="advance_applied",
        linked_advance_payment_id=advance.id,
        received_by=user_id,
        notes=note or "Advance applied to invoice",
    )
    db.add(payment)
    return payment
