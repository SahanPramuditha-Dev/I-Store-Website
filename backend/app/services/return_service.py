import re
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import (
    Customer,
    DamagedStockLog,
    InventoryItem,
    ReturnRecord,
    Sale,
    SaleItem,
    StockMovement,
)
from app.services.numbering_service import next_number
from app.utils.time import utcnow

RETURN_STATUS_PENDING = "Pending Inspection"
RETURN_STATUS_APPROVED = "Approved"
RETURN_STATUS_REJECTED = "Rejected"
RETURN_STATUS_REFUNDED = "Refunded"
RETURN_STATUS_EXCHANGED = "Exchanged"
RETURN_STATUS_CLOSED = "Closed"

VALID_RETURN_STATUSES = {
    RETURN_STATUS_PENDING,
    RETURN_STATUS_APPROVED,
    RETURN_STATUS_REJECTED,
    RETURN_STATUS_REFUNDED,
    RETURN_STATUS_EXCHANGED,
    RETURN_STATUS_CLOSED,
}

VALID_RETURN_TYPES = {
    "Product Return",
    "Product Exchange",
    "Refund",
    "Warranty Replacement",
}

VALID_REFUND_METHODS = {"Cash", "Card", "Bank Transfer"}

VALID_RETURN_REASONS = {
    "Defective item",
    "Wrong item sold",
    "Customer changed mind",
    "Warranty claim",
    "Damaged packaging",
    "Not compatible",
}


def parse_invoice_id(invoice_ref_or_id: str | int) -> int:
    if isinstance(invoice_ref_or_id, int):
        return invoice_ref_or_id
    raw = str(invoice_ref_or_id or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Invoice reference is required")
    if raw.isdigit():
        return int(raw)
    if raw.lower().startswith("inv-"):
        digits = re.sub(r"[^\d]", "", raw)
        if digits:
            return int(digits)
    raise HTTPException(status_code=400, detail="Invalid invoice reference format")


def get_sale_or_404(db: Session, sale_id: int) -> Sale:
    sale = db.query(Sale).filter(Sale.id == sale_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Original invoice not found")
    if sale.is_voided:
        raise HTTPException(status_code=400, detail="Cannot process returns for a voided invoice")
    if sale.is_return:
        raise HTTPException(status_code=400, detail="Cannot process returns against a return invoice")
    return sale


def get_sale_item_or_404(db: Session, sale_item_id: int) -> SaleItem:
    row = db.query(SaleItem).filter(SaleItem.id == sale_item_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Sold item line not found")
    return row


def get_returned_qty_for_sale_item(db: Session, sale_item_id: int) -> int:
    returned = (
        db.query(func.coalesce(func.sum(ReturnRecord.quantity), 0))
        .filter(
            ReturnRecord.original_sale_item_id == sale_item_id,
            ReturnRecord.decision_status != RETURN_STATUS_REJECTED,
        )
        .scalar()
        or 0
    )
    return int(returned)


def get_sale_item_max_refund_amount(sale_item: SaleItem, quantity: int) -> float:
    qty = max(0, int(quantity or 0))
    return round(max(0.0, float(sale_item.price or 0)) * qty, 2)


def create_return_record(
    db: Session,
    *,
    original_sale_id: int,
    original_sale_item_id: int,
    quantity: int,
    return_type: str,
    return_reason: str,
    item_condition: str,
    inspection_note: str | None,
    staff_user_id: int | None,
) -> ReturnRecord:
    sale = get_sale_or_404(db, original_sale_id)
    sale_item = get_sale_item_or_404(db, original_sale_item_id)
    if sale_item.sale_id != sale.id:
        raise HTTPException(status_code=400, detail="Selected item does not belong to the invoice")

    qty = int(quantity or 0)
    if qty <= 0:
        raise HTTPException(status_code=400, detail="Return quantity must be at least 1")
    sold_qty = max(0, int(sale_item.quantity or 0))
    if sold_qty <= 0:
        raise HTTPException(status_code=400, detail="Only sold lines can be returned")

    already_returned = get_returned_qty_for_sale_item(db, sale_item.id)
    remaining = sold_qty - already_returned
    if remaining <= 0:
        raise HTTPException(status_code=400, detail="This sale item is already fully returned")
    if qty > remaining:
        raise HTTPException(
            status_code=400,
            detail=f"Return quantity exceeds remaining returnable quantity ({remaining})",
        )

    if return_type not in VALID_RETURN_TYPES:
        raise HTTPException(status_code=400, detail="Invalid return type")
    if return_reason not in VALID_RETURN_REASONS:
        raise HTTPException(status_code=400, detail="Invalid return reason")

    item = db.query(InventoryItem).filter(InventoryItem.id == sale_item.item_id).first()
    customer = db.query(Customer).filter(Customer.id == sale.customer_id).first() if sale.customer_id else None
    row = ReturnRecord(
        return_type=return_type,
        original_sale_id=sale.id,
        original_sale_item_id=sale_item.id,
        customer_id=customer.id if customer else sale.customer_id,
        customer_name=customer.name if customer else "Walk-in",
        customer_phone=customer.phone if customer else None,
        item_id=item.id if item else sale_item.item_id,
        product_name=item.name if item else f"Item #{sale_item.item_id}",
        sku_barcode=(item.barcode or item.sku) if item else None,
        serial_number=sale_item.serial_number,
        quantity=qty,
        return_reason=return_reason,
        item_condition=item_condition or "Reusable",
        inspection_note=inspection_note,
        staff_user_id=staff_user_id,
        decision_status=RETURN_STATUS_PENDING,
        refund_amount=0,
        refund_method=None,
    )
    db.add(row)
    db.flush()
    row.return_code = next_number(db, "RET")
    return row


def apply_return_stock(
    db: Session,
    *,
    record: ReturnRecord,
    user_id: int | None,
    process_note: str | None = None,
) -> None:
    if record.inventory_applied:
        return
    item = db.query(InventoryItem).filter(InventoryItem.id == record.item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Original item no longer exists in inventory")

    condition_text = str(record.item_condition or "").lower()
    is_damaged = condition_text == "damaged" or "damaged" in condition_text
    if is_damaged:
        item.damaged_quantity = max(0, int(item.damaged_quantity or 0)) + int(record.quantity or 0)
        db.add(
            DamagedStockLog(
                return_record_id=record.id,
                item_id=item.id,
                quantity=int(record.quantity or 0),
                reason=record.return_reason,
                note=process_note,
                created_by_user_id=user_id,
            )
        )
        db.add(
            StockMovement(
                item_id=item.id,
                user_id=user_id,
                movement_type="RETURN_DAMAGED",
                quantity=int(record.quantity or 0),
                reference_type="return_record",
                reference_id=record.id,
                note=f"Damaged return {record.return_code}",
            )
        )
    else:
        item.quantity = max(0, int(item.quantity or 0)) + int(record.quantity or 0)
        db.add(
            StockMovement(
                item_id=item.id,
                user_id=user_id,
                movement_type="RETURN_RESTOCK",
                quantity=int(record.quantity or 0),
                reference_type="return_record",
                reference_id=record.id,
                note=f"Reusable return {record.return_code}",
            )
        )
    record.inventory_applied = True


def apply_exchange_stock(
    db: Session,
    *,
    record: ReturnRecord,
    replacement_item_id: int,
    replacement_quantity: int,
    user_id: int | None = None,
    process_note: str | None = None,
) -> None:
    replacement_item = db.query(InventoryItem).filter(InventoryItem.id == replacement_item_id).first()
    if not replacement_item:
        raise HTTPException(status_code=404, detail="Replacement item not found")
    qty = int(replacement_quantity or 0)
    if qty <= 0:
        raise HTTPException(status_code=400, detail="Replacement quantity must be at least 1")
    if int(replacement_item.quantity or 0) < qty:
        raise HTTPException(status_code=400, detail="Insufficient replacement item stock")

    replacement_item.quantity = int(replacement_item.quantity or 0) - qty
    record.replacement_item_id = replacement_item.id
    record.replacement_item_name = replacement_item.name
    record.replacement_quantity = qty
    db.add(
        StockMovement(
            item_id=replacement_item.id,
            user_id=user_id,
            movement_type="EXCHANGE_OUT",
            quantity=-qty,
            reference_type="return_record",
            reference_id=record.id,
            note=process_note or f"Replacement issued for {record.return_code}",
        )
    )


def process_return_record(
    db: Session,
    *,
    record: ReturnRecord,
    decision_status: str,
    actor_user_id: int | None,
    return_reason: str | None = None,
    item_condition: str | None = None,
    inspection_note: str | None = None,
    refund_amount: float | None = None,
    refund_method: str | None = None,
    replacement_item_id: int | None = None,
    replacement_quantity: int | None = None,
    process_note: str | None = None,
) -> ReturnRecord:
    if record.decision_status == RETURN_STATUS_CLOSED:
        raise HTTPException(status_code=400, detail="Closed return records cannot be edited")

    status = str(decision_status or "").strip()
    if status not in VALID_RETURN_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid return status")

    if return_reason:
        if return_reason not in VALID_RETURN_REASONS:
            raise HTTPException(status_code=400, detail="Invalid return reason")
        record.return_reason = return_reason
    if item_condition:
        record.item_condition = item_condition
    if inspection_note is not None:
        record.inspection_note = inspection_note

    if status == RETURN_STATUS_REJECTED:
        record.decision_status = RETURN_STATUS_REJECTED
        record.approved_by_user_id = actor_user_id
        return record

    if status == RETURN_STATUS_APPROVED:
        record.decision_status = RETURN_STATUS_APPROVED
        record.approved_by_user_id = actor_user_id
        return record

    if status in {RETURN_STATUS_REFUNDED, RETURN_STATUS_EXCHANGED}:
        record.approved_by_user_id = actor_user_id
        apply_return_stock(db, record=record, user_id=actor_user_id, process_note=process_note)
        if status == RETURN_STATUS_REFUNDED:
            max_refundable = get_sale_item_max_refund_amount(record.sale_item, record.quantity)
            amount = max_refundable if refund_amount is None else round(float(refund_amount or 0), 2)
            if amount < 0:
                raise HTTPException(status_code=400, detail="Refund amount cannot be negative")
            if amount > max_refundable:
                raise HTTPException(
                    status_code=400,
                    detail=f"Refund amount cannot exceed max refundable ({max_refundable:.2f})",
                )
            if not refund_method or refund_method not in VALID_REFUND_METHODS:
                raise HTTPException(status_code=400, detail="Valid refund method is required")
            record.refund_amount = amount
            record.refund_method = refund_method
            record.payment_applied = True
            record.refund_approved_by_user_id = actor_user_id
            record.decision_status = RETURN_STATUS_REFUNDED
            return record

        if status == RETURN_STATUS_EXCHANGED:
            rep_item_id = replacement_item_id or record.replacement_item_id
            rep_qty = replacement_quantity or record.replacement_quantity or record.quantity
            if not rep_item_id:
                raise HTTPException(status_code=400, detail="Replacement item is required for exchanges")
            apply_exchange_stock(
                db,
                record=record,
                replacement_item_id=int(rep_item_id),
                replacement_quantity=int(rep_qty),
                user_id=actor_user_id,
                process_note=process_note,
            )
            record.decision_status = RETURN_STATUS_EXCHANGED
            return record

    if status == RETURN_STATUS_CLOSED:
        record.decision_status = RETURN_STATUS_CLOSED
        record.closed_at = utcnow()
        if actor_user_id:
            if record.approved_by_user_id is None:
                record.approved_by_user_id = actor_user_id
        return record

    record.decision_status = status
    return record


def build_return_receipt_payload(record: ReturnRecord) -> dict:
    line_price = float(record.sale_item.price or 0) if record.sale_item else 0.0
    return {
        "return_id": record.return_code,
        "invoice_id": f"INV-{record.original_sale_id:05d}" if record.original_sale_id else None,
        "customer_name": record.customer_name,
        "customer_phone": record.customer_phone,
        "product_name": record.product_name,
        "sku_barcode": record.sku_barcode,
        "serial_number": record.serial_number,
        "quantity": record.quantity,
        "unit_price": line_price,
        "return_reason": record.return_reason,
        "item_condition": record.item_condition,
        "return_type": record.return_type,
        "status": record.decision_status,
        "refund_amount": float(record.refund_amount or 0),
        "refund_method": record.refund_method,
        "replacement_item_name": record.replacement_item_name,
        "replacement_quantity": record.replacement_quantity,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "closed_at": record.closed_at.isoformat() if record.closed_at else None,
    }
