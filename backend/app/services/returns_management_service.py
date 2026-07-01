import json
import re
from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.constants import SALE_INVENTORY_LINE_TYPES
from app.models import (
    ActivityLog,
    AppSetting,
    Customer,
    DamagedStockRecord,
    ExchangeRecord,
    InventoryItem,
    InventorySerial,
    InvoicePayment,
    RefundPayment,
    Return as ReturnCase,
    ReturnItem,
    ReturnRecord,
    Sale,
    SaleItem,
    StockMovement,
    StoreCredit,
    User,
    WarrantyClaim,
    WarrantyRecord,
)
from app.services.numbering_service import next_number
from app.services.security_service import canonical_role_name, has_permission
from app.utils.money import add as money_add
from app.utils.money import mul as money_mul
from app.utils.money import sub as money_sub
from app.utils.money import to_decimal
from app.utils.money import to_float
from app.utils.time import utcnow

SETTINGS_STATE_KEY = "settings_state_v2"

RETURN_TYPES = {"return", "refund", "exchange", "warranty_replacement", "store_credit"}
RETURN_INSPECTION_STATUSES = {"pending_inspection", "inspected", "approved", "rejected"}
RETURN_DECISION_STATUSES = {"pending", "approved", "rejected", "refunded", "exchanged", "closed", "cancelled"}
RETURN_REFUND_STATUSES = {"none", "pending", "partial_refund", "full_refund", "completed"}
RETURN_ITEM_CONDITIONS = {"sellable", "damaged", "opened", "defective", "missing_parts"}
RETURN_RESTOCK_ACTIONS = {"restock", "damaged_stock", "scrap", "return_to_supplier", "no_stock_change"}
REFUND_METHODS = {"cash", "card", "bank_transfer", "store_credit"}
REFUND_STATUSES = {"pending", "approved", "paid", "cancelled"}
STORE_CREDIT_STATUSES = {"active", "used", "expired", "cancelled"}
DAMAGED_ACTIONS = {"hold", "repair", "scrap", "return_to_supplier"}

DEFAULT_RETURN_REASONS = [
    "Defective item",
    "Wrong item sold",
    "Customer changed mind",
    "Warranty claim",
    "Damaged packaging",
    "Not compatible",
    "Duplicate purchase",
    "Incorrect price",
    "Product not working",
    "Other",
]

DEFAULT_RETURN_RULES = {
    "return_period_days": 7,
    "allow_returns_without_invoice": False,
    "allow_refund_to_different_payment_method": False,
    "refund_approval_threshold": 100000,
    "allow_store_credit": True,
    "allow_exchanges": True,
    "allow_warranty_replacement": True,
    "restock_returned_sellable_items_automatically": True,
    "require_inspection_before_refund": True,
    "require_manager_approval_for_damaged_returns": True,
    "default_return_policy_text": "Returns allowed within 7 days with invoice.",
    "return_receipt_footer_text": "Thank you. Returns are handled per policy.",
    "return_reasons": DEFAULT_RETURN_REASONS,
}


def _role_key(user: User | None) -> str:
    return canonical_role_name(getattr(user, "role", None) if user else None)


def _is_manager_or_above(user: User | None) -> bool:
    return _role_key(user) in {"owner", "admin", "manager"}


def _safe_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return to_float(default)
    return to_float(value)


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def _normalize_refund_method(method: str) -> str:
    key = str(method or "").strip().lower().replace(" ", "_")
    aliases = {
        "bank": "bank_transfer",
        "transfer": "bank_transfer",
        "banktransfer": "bank_transfer",
        "storecredit": "store_credit",
    }
    return aliases.get(key, key)


def _normalize_return_type(raw: str) -> str:
    key = str(raw or "").strip().lower().replace(" ", "_")
    aliases = {
        "product_return": "return",
        "product_exchange": "exchange",
        "warranty_replacement": "warranty_replacement",
    }
    normalized = aliases.get(key, key)
    if normalized not in RETURN_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported return type: {raw}")
    return normalized


def _parse_invoice_ref(invoice_ref: str | int) -> int:
    if isinstance(invoice_ref, int):
        return int(invoice_ref)
    raw = str(invoice_ref or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Invoice reference is required")
    if raw.isdigit():
        return int(raw)
    if raw.lower().startswith("inv-"):
        digits = re.sub(r"[^\d]", "", raw)
        if digits:
            return int(digits)
    raise HTTPException(status_code=400, detail="Invalid invoice reference format")


def _invoice_label(sale: Sale) -> str:
    return str(sale.invoice_no or f"INV-{sale.id:05d}")


def _load_settings_state(db: Session) -> dict[str, Any]:
    row = db.query(AppSetting).filter(AppSetting.key == SETTINGS_STATE_KEY).first()
    if not row or not row.value:
        return {}
    try:
        payload = json.loads(row.value)
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def get_return_rules(db: Session) -> dict[str, Any]:
    state = _load_settings_state(db)
    business_ops = (state.get("business_ops") or {}) if isinstance(state, dict) else {}
    rules = business_ops.get("return_refund_rules") or {}
    merged = dict(DEFAULT_RETURN_RULES)
    if isinstance(rules, dict):
        merged.update(rules)
    reasons = merged.get("return_reasons")
    if not isinstance(reasons, list) or not reasons:
        merged["return_reasons"] = list(DEFAULT_RETURN_REASONS)
    else:
        merged["return_reasons"] = [str(x).strip() for x in reasons if str(x).strip()]
    return merged


def get_return_reasons(db: Session) -> list[str]:
    return list(get_return_rules(db).get("return_reasons") or DEFAULT_RETURN_REASONS)


def _raise_if_sale_not_eligible_for_return(sale: Sale | None) -> None:
    if not sale:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if bool(sale.is_return):
        raise HTTPException(status_code=400, detail="Cannot process returns for a return invoice")
    if bool(sale.is_voided):
        raise HTTPException(status_code=400, detail="Cannot process returns for a voided invoice")


def get_returned_qty_for_sale_item(db: Session, sale_item_id: int) -> int:
    new_qty = (
        db.query(func.coalesce(func.sum(ReturnItem.quantity), 0))
        .join(ReturnCase, ReturnItem.return_id == ReturnCase.id)
        .filter(
            ReturnItem.original_invoice_item_id == int(sale_item_id),
            ReturnCase.decision_status.notin_(["rejected", "cancelled"]),
        )
        .scalar()
        or 0
    )
    legacy_qty = (
        db.query(func.coalesce(func.sum(ReturnRecord.quantity), 0))
        .filter(
            ReturnRecord.original_sale_item_id == int(sale_item_id),
            ReturnRecord.decision_status != "Rejected",
        )
        .scalar()
        or 0
    )
    return int(new_qty or 0) + int(legacy_qty or 0)


def _base_return_query(db: Session):
    return db.query(ReturnCase)


def list_return_cases(
    db: Session,
    *,
    q: str | None = None,
    return_type: str | None = None,
    inspection_status: str | None = None,
    decision_status: str | None = None,
    refund_status: str | None = None,
    customer_id: int | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 500,
) -> list[ReturnCase]:
    query = _base_return_query(db)
    if q:
        like = f"%{q.strip()}%"
        query = query.outerjoin(Customer, Customer.id == ReturnCase.customer_id).filter(
            or_(
                ReturnCase.return_number.ilike(like),
                ReturnCase.reason.ilike(like),
                Customer.name.ilike(like),
                Customer.phone.ilike(like),
            )
        )
    if return_type and str(return_type).lower() != "all":
        query = query.filter(ReturnCase.return_type == _normalize_return_type(return_type))
    if inspection_status and str(inspection_status).lower() != "all":
        query = query.filter(ReturnCase.inspection_status == str(inspection_status).strip().lower())
    if decision_status and str(decision_status).lower() != "all":
        query = query.filter(ReturnCase.decision_status == str(decision_status).strip().lower())
    if refund_status and str(refund_status).lower() != "all":
        query = query.filter(ReturnCase.refund_status == str(refund_status).strip().lower())
    if customer_id:
        query = query.filter(ReturnCase.customer_id == int(customer_id))
    if date_from:
        try:
            query = query.filter(ReturnCase.created_at >= datetime.fromisoformat(str(date_from)))
        except Exception:
            pass
    if date_to:
        try:
            query = query.filter(ReturnCase.created_at < datetime.fromisoformat(str(date_to)) + timedelta(days=1))
        except Exception:
            pass
    return query.order_by(ReturnCase.created_at.desc()).limit(max(1, min(2000, int(limit)))).all()


def get_return_case_or_404(db: Session, return_id: int) -> ReturnCase:
    row = _base_return_query(db).filter(ReturnCase.id == int(return_id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Return case not found")
    return row


def _serialize_return_item(row: ReturnItem) -> dict[str, Any]:
    return {
        "id": row.id,
        "original_invoice_item_id": row.original_invoice_item_id,
        "product_id": row.product_id,
        "variant_id": row.variant_id,
        "serial_id": row.serial_id,
        "imei": row.imei,
        "quantity": int(row.quantity or 0),
        "unit_price": float(row.unit_price or 0),
        "return_amount": float(row.return_amount or 0),
        "item_condition": row.item_condition,
        "restock_action": row.restock_action,
        "replacement_product_id": row.replacement_product_id,
        "replacement_serial_id": row.replacement_serial_id,
        "notes": row.notes,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def serialize_return_case(db: Session, row: ReturnCase, include_items: bool = True) -> dict[str, Any]:
    customer = db.query(Customer).filter(Customer.id == row.customer_id).first() if row.customer_id else None
    invoice = db.query(Sale).filter(Sale.id == row.original_invoice_id).first() if row.original_invoice_id else None
    payload = {
        "id": row.id,
        "return_number": row.return_number,
        "original_invoice_id": row.original_invoice_id,
        "original_invoice_number": _invoice_label(invoice) if invoice else None,
        "customer_id": row.customer_id,
        "warranty_claim_id": row.warranty_claim_id,
        "customer_name": customer.name if customer else None,
        "customer_phone": customer.phone if customer else None,
        "return_type": row.return_type,
        "reason": row.reason,
        "notes": row.notes,
        "inspection_status": row.inspection_status,
        "decision_status": row.decision_status,
        "refund_status": row.refund_status,
        "total_return_amount": float(row.total_return_amount or 0),
        "refund_amount": float(row.refund_amount or 0),
        "store_credit_amount": float(row.store_credit_amount or 0),
        "approved_by": row.approved_by,
        "rejected_by": row.rejected_by,
        "processed_by": row.processed_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "closed_at": row.closed_at.isoformat() if row.closed_at else None,
    }
    if include_items:
        items = db.query(ReturnItem).filter(ReturnItem.return_id == row.id).order_by(ReturnItem.id.asc()).all()
        payload["items"] = [_serialize_return_item(item) for item in items]
    return payload


def _log_audit(
    db: Session,
    *,
    user_id: int | None,
    action: str,
    target_id: int,
    old_value: Any = None,
    new_value: Any = None,
    device_session: str | None = None,
) -> None:
    description = f"RETURNS::{action}"
    if device_session:
        description = f"{description}::{device_session}"
    db.add(
        ActivityLog(
            user_id=user_id,
            action=action,
            entity_type="RETURNS",
            entity_id=int(target_id),
            description=description,
            old_value=json.dumps(old_value) if old_value is not None else None,
            new_value=json.dumps(new_value) if new_value is not None else None,
            is_reversible=False,
        )
    )


def lookup_invoice(db: Session, reference: str) -> dict[str, Any]:
    token = str(reference or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Invoice lookup query is required")

    candidates: list[Sale] = []
    parsed_id = None
    try:
        parsed_id = _parse_invoice_ref(token)
    except HTTPException:
        parsed_id = None

    if parsed_id:
        sale = db.query(Sale).filter(Sale.id == int(parsed_id)).first()
        if sale:
            _raise_if_sale_not_eligible_for_return(sale)
            candidates.append(sale)

    invoice_matches = (
        db.query(Sale)
        .filter(
            Sale.is_return == False,  # noqa: E712
            Sale.is_voided == False,  # noqa: E712
            Sale.invoice_no.isnot(None),
            Sale.invoice_no.ilike(f"%{token}%"),
        )
        .order_by(Sale.created_at.desc())
        .limit(10)
        .all()
    )
    for row in invoice_matches:
        if not any(existing.id == row.id for existing in candidates):
            candidates.append(row)

    customer_matches = (
        db.query(Sale)
        .outerjoin(Customer, Customer.id == Sale.customer_id)
        .filter(
            Sale.is_return == False,  # noqa: E712
            Sale.is_voided == False,  # noqa: E712
            or_(
                Customer.phone.ilike(f"%{token}%"),
                Customer.name.ilike(f"%{token}%"),
            ),
        )
        .order_by(Sale.created_at.desc())
        .limit(10)
        .all()
    )
    for row in customer_matches:
        if not any(existing.id == row.id for existing in candidates):
            candidates.append(row)

    if not candidates:
        raise HTTPException(status_code=404, detail="No invoice found for this lookup")

    selected = candidates[0]
    eligible = eligible_items_for_invoice(db, selected.id)
    return {
        "selected_invoice": eligible,
        "matches": [
            {
                "invoice_id": row.id,
                "invoice_no": _invoice_label(row),
                "customer_id": row.customer_id,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "total": float(row.total or 0),
            }
            for row in candidates
        ],
    }


def eligible_items_for_invoice(db: Session, invoice_id: int) -> dict[str, Any]:
    sale = db.query(Sale).filter(Sale.id == int(invoice_id)).first()
    _raise_if_sale_not_eligible_for_return(sale)

    customer = db.query(Customer).filter(Customer.id == sale.customer_id).first() if sale.customer_id else None
    lines = db.query(SaleItem).filter(SaleItem.sale_id == sale.id).order_by(SaleItem.id.asc()).all()

    item_ids = [int(line.item_id) for line in lines if line.item_id]
    item_map: dict[int, InventoryItem] = {}
    if item_ids:
        rows = db.query(InventoryItem).filter(InventoryItem.id.in_(item_ids)).all()
        item_map = {int(row.id): row for row in rows}

    line_payload = []
    for line in lines:
        line_type = str(line.line_type or "product").strip().lower()
        sold_qty = max(0, int(line.quantity or 0))
        if sold_qty <= 0 or line_type not in SALE_INVENTORY_LINE_TYPES:
            continue
        returned_qty = get_returned_qty_for_sale_item(db, line.id)
        returnable_qty = max(0, sold_qty - returned_qty)
        product = item_map.get(int(line.item_id or 0))

        warranty = (
            db.query(WarrantyRecord)
            .filter(
                or_(
                    WarrantyRecord.invoice_item_id == line.id,
                    WarrantyRecord.sale_item_id == line.id,
                )
            )
            .order_by(WarrantyRecord.created_at.desc())
            .first()
        )

        prior_returns = (
            db.query(ReturnCase, ReturnItem)
            .join(ReturnItem, ReturnItem.return_id == ReturnCase.id)
            .filter(ReturnItem.original_invoice_item_id == line.id)
            .order_by(ReturnCase.created_at.desc())
            .all()
        )

        line_payload.append(
            {
                "sale_item_id": line.id,
                "product_id": line.item_id,
                "product_name": product.name if product else (line.description or f"Item #{line.item_id}"),
                "sku": product.sku if product else None,
                "barcode": product.barcode if product else None,
                "serial_number": line.serial_number,
                "unit_price": float(line.price or 0),
                "sold_qty": sold_qty,
                "already_returned_qty": returned_qty,
                "returnable_qty": returnable_qty,
                "warranty_status": str(warranty.status) if warranty else "no_warranty",
                "warranty_end_date": warranty.end_date.isoformat() if warranty and warranty.end_date else None,
                "return_history": [
                    {
                        "return_id": ret.id,
                        "return_number": ret.return_number,
                        "decision_status": ret.decision_status,
                        "quantity": int(item.quantity or 0),
                        "created_at": ret.created_at.isoformat() if ret.created_at else None,
                    }
                    for ret, item in prior_returns
                ],
            }
        )

    case_rows = (
        db.query(ReturnCase)
        .filter(ReturnCase.original_invoice_id == sale.id)
        .order_by(ReturnCase.created_at.desc())
        .all()
    )

    return {
        "invoice_id": sale.id,
        "invoice_no": _invoice_label(sale),
        "customer_id": sale.customer_id,
        "customer_name": customer.name if customer else "Walk-in",
        "customer_phone": customer.phone if customer else None,
        "payment_method": sale.payment_method,
        "created_at": sale.created_at.isoformat() if sale.created_at else None,
        "total": float(sale.total or 0),
        "items": line_payload,
        "return_cases": [serialize_return_case(db, row, include_items=False) for row in case_rows],
    }


def _validate_reason(db: Session, reason: str) -> str:
    text = str(reason or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Return reason is required")
    reasons = {str(x).strip().lower() for x in get_return_reasons(db)}
    if text.lower() not in reasons:
        raise HTTPException(status_code=400, detail="Return reason is not configured")
    return text


def create_return_case(
    db: Session,
    *,
    payload: Any,
    actor: User | None,
    device_session: str | None = None,
) -> ReturnCase:
    rules = get_return_rules(db)
    return_type = _normalize_return_type(payload.return_type)
    reason = _validate_reason(db, payload.reason)

    if return_type == "store_credit" and not bool(rules.get("allow_store_credit", True)):
        raise HTTPException(status_code=400, detail="Store credit is disabled by policy")
    if return_type == "exchange" and not bool(rules.get("allow_exchanges", True)):
        raise HTTPException(status_code=400, detail="Exchanges are disabled by policy")
    if return_type == "warranty_replacement" and not bool(rules.get("allow_warranty_replacement", True)):
        raise HTTPException(status_code=400, detail="Warranty replacement is disabled by policy")

    items = list(payload.items or [])
    if not items:
        raise HTTPException(status_code=400, detail="At least one return item is required")

    invoice = None
    if payload.original_invoice_id:
        invoice = db.query(Sale).filter(Sale.id == int(payload.original_invoice_id)).first()
        _raise_if_sale_not_eligible_for_return(invoice)
    else:
        allowed_without_invoice = bool(rules.get("allow_returns_without_invoice", False))
        can_override = bool(actor and has_permission(db, actor, "returns.override"))
        if (not allowed_without_invoice) and (not payload.manual_exception) and (not can_override):
            raise HTTPException(status_code=403, detail="Returns without invoice are blocked by policy")

    customer_id = int(payload.customer_id) if payload.customer_id else (int(invoice.customer_id) if invoice and invoice.customer_id else None)
    customer = db.query(Customer).filter(Customer.id == customer_id).first() if customer_id else None

    row = ReturnCase(
        return_number=next_number(db, "RET"),
        original_invoice_id=invoice.id if invoice else None,
        customer_id=customer.id if customer else customer_id,
        warranty_claim_id=int(payload.warranty_claim_id) if getattr(payload, "warranty_claim_id", None) else None,
        return_type=return_type,
        reason=reason,
        notes=payload.notes,
        inspection_status="pending_inspection",
        decision_status="pending",
        refund_status="none",
        total_return_amount=0,
        refund_amount=0,
        store_credit_amount=0,
        processed_by=actor.id if actor else None,
    )
    db.add(row)
    db.flush()

    total = 0.0
    for line in items:
        qty = _safe_int(line.quantity, 0)
        if qty <= 0:
            raise HTTPException(status_code=400, detail="Return quantity must be at least 1")

        sale_line = None
        product_id = int(line.product_id) if line.product_id else None
        unit_price = _safe_float(line.unit_price, 0)
        serial_id = int(line.serial_id) if line.serial_id else None

        if invoice:
            if not line.original_invoice_item_id:
                raise HTTPException(status_code=400, detail="original_invoice_item_id is required for invoice returns")
            sale_line = db.query(SaleItem).filter(SaleItem.id == int(line.original_invoice_item_id)).first()
            if not sale_line or int(sale_line.sale_id or 0) != int(invoice.id):
                raise HTTPException(status_code=400, detail=f"Sale line {line.original_invoice_item_id} does not belong to invoice")
            sold_qty = max(0, int(sale_line.quantity or 0))
            already_returned = get_returned_qty_for_sale_item(db, int(sale_line.id))
            remaining_qty = max(0, sold_qty - already_returned)
            if qty > remaining_qty:
                raise HTTPException(
                    status_code=400,
                    detail=f"Returned quantity exceeds eligible quantity ({remaining_qty})",
                )
            product_id = int(sale_line.item_id or 0) if (not product_id) else product_id
            serial_id = serial_id or None
            unit_price = _safe_float(line.unit_price, _safe_float(sale_line.price, 0))
        else:
            if not product_id:
                raise HTTPException(status_code=400, detail="product_id is required for no-invoice return item")

        product = db.query(InventoryItem).filter(InventoryItem.id == int(product_id)).first()
        if not product:
            raise HTTPException(status_code=404, detail=f"Product not found: {product_id}")

        condition = str(line.item_condition or "sellable").strip().lower()
        if condition not in RETURN_ITEM_CONDITIONS:
            raise HTTPException(status_code=400, detail=f"Invalid item_condition: {line.item_condition}")

        restock_action = str(line.restock_action or "").strip().lower()
        if not restock_action:
            restock_action = "damaged_stock" if condition in {"damaged", "defective", "missing_parts"} else "restock"
        if restock_action not in RETURN_RESTOCK_ACTIONS:
            raise HTTPException(status_code=400, detail=f"Invalid restock_action: {line.restock_action}")

        return_amount = round(_safe_float(unit_price, 0) * qty, 2)
        total = round(total + return_amount, 2)

        db.add(
            ReturnItem(
                return_id=row.id,
                original_invoice_item_id=int(sale_line.id) if sale_line else (int(line.original_invoice_item_id) if line.original_invoice_item_id else None),
                product_id=int(product_id),
                variant_id=line.variant_id,
                serial_id=serial_id,
                imei=line.imei,
                quantity=qty,
                unit_price=unit_price,
                return_amount=return_amount,
                item_condition=condition,
                restock_action=restock_action,
                notes=line.notes,
            )
        )

    row.total_return_amount = round(total, 2)
    if return_type == "warranty_replacement":
        if row.warranty_claim_id:
            claim = db.query(WarrantyClaim).filter(WarrantyClaim.id == int(row.warranty_claim_id)).first()
            if not claim:
                raise HTTPException(status_code=404, detail="Warranty claim not found")
        else:
            if not invoice:
                raise HTTPException(status_code=400, detail="Warranty replacement requires an invoice link")
            warranty_rows = (
                db.query(WarrantyRecord)
                .filter(WarrantyRecord.invoice_id == invoice.id)
                .order_by(WarrantyRecord.created_at.desc())
                .all()
            )
            if not warranty_rows:
                raise HTTPException(status_code=400, detail="No linked warranty records found for this invoice")
            target_warranty = warranty_rows[0]
            claim_number = next_number(db, "WCL")
            claim = WarrantyClaim(
                claim_code=claim_number,
                claim_number=claim_number,
                warranty_id=target_warranty.id,
                customer_id=target_warranty.customer_id,
                customer_complaint=reason,
                issue_description=payload.notes,
                decision_status="pending_inspection",
                claim_status="Pending Inspection",
                created_by=actor.id if actor else None,
            )
            db.add(claim)
            db.flush()
            row.warranty_claim_id = claim.id

    _log_audit(
        db,
        user_id=actor.id if actor else None,
        action="return_created",
        target_id=row.id,
        old_value=None,
        new_value=serialize_return_case(db, row, include_items=True),
        device_session=device_session,
    )
    db.flush()
    return row


def inspect_return_case(
    db: Session,
    *,
    return_case: ReturnCase,
    payload: Any,
    actor: User | None,
    device_session: str | None = None,
) -> ReturnCase:
    if return_case.decision_status in {"closed", "cancelled"}:
        raise HTTPException(status_code=400, detail="Closed/cancelled return case cannot be inspected")
    old_value = serialize_return_case(db, return_case, include_items=True)
    updates = payload.item_updates or []
    for change in updates:
        item_id = int(change.get("id") or 0)
        if item_id <= 0:
            continue
        item = db.query(ReturnItem).filter(ReturnItem.id == item_id, ReturnItem.return_id == return_case.id).first()
        if not item:
            continue
        if change.get("item_condition") is not None:
            value = str(change.get("item_condition") or "").strip().lower()
            if value not in RETURN_ITEM_CONDITIONS:
                raise HTTPException(status_code=400, detail=f"Invalid item condition: {value}")
            item.item_condition = value
        if change.get("restock_action") is not None:
            value = str(change.get("restock_action") or "").strip().lower()
            if value not in RETURN_RESTOCK_ACTIONS:
                raise HTTPException(status_code=400, detail=f"Invalid restock action: {value}")
            item.restock_action = value
        if change.get("notes") is not None:
            item.notes = str(change.get("notes") or "")
        if change.get("replacement_product_id") is not None:
            item.replacement_product_id = int(change.get("replacement_product_id") or 0) or None
        if change.get("replacement_serial_id") is not None:
            item.replacement_serial_id = int(change.get("replacement_serial_id") or 0) or None
    if payload.inspection_notes:
        return_case.notes = (return_case.notes or "") + f"\nInspection: {str(payload.inspection_notes)}"
    status = str(payload.inspection_status or "inspected").strip().lower()
    if status not in RETURN_INSPECTION_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid inspection status")
    return_case.inspection_status = status
    return_case.processed_by = actor.id if actor else return_case.processed_by
    _log_audit(
        db,
        user_id=actor.id if actor else None,
        action="return_inspected",
        target_id=return_case.id,
        old_value=old_value,
        new_value=serialize_return_case(db, return_case, include_items=True),
        device_session=device_session,
    )
    return return_case


def approve_return_case(
    db: Session,
    *,
    return_case: ReturnCase,
    actor: User | None,
    notes: str | None = None,
    device_session: str | None = None,
) -> ReturnCase:
    if return_case.decision_status in {"closed", "cancelled", "rejected"}:
        raise HTTPException(status_code=400, detail="This return case cannot be approved")
    old_value = serialize_return_case(db, return_case, include_items=False)
    return_case.decision_status = "approved"
    return_case.inspection_status = "approved"
    return_case.approved_by = actor.id if actor else return_case.approved_by
    return_case.processed_by = actor.id if actor else return_case.processed_by
    if notes:
        return_case.notes = (return_case.notes or "") + f"\nApproval: {notes}"
    _log_audit(
        db,
        user_id=actor.id if actor else None,
        action="return_approved",
        target_id=return_case.id,
        old_value=old_value,
        new_value=serialize_return_case(db, return_case, include_items=False),
        device_session=device_session,
    )
    return return_case


def reject_return_case(
    db: Session,
    *,
    return_case: ReturnCase,
    reason: str,
    actor: User | None,
    notes: str | None = None,
    device_session: str | None = None,
) -> ReturnCase:
    if return_case.decision_status in {"closed", "cancelled"}:
        raise HTTPException(status_code=400, detail="Closed/cancelled return case cannot be rejected")
    old_value = serialize_return_case(db, return_case, include_items=False)
    return_case.decision_status = "rejected"
    return_case.inspection_status = "rejected"
    return_case.rejected_by = actor.id if actor else return_case.rejected_by
    info = str(reason or "").strip()
    if not info:
        raise HTTPException(status_code=400, detail="Rejection reason is required")
    return_case.notes = ((return_case.notes or "") + f"\nRejected: {info}").strip()
    if notes:
        return_case.notes = return_case.notes + f"\n{notes}"
    _log_audit(
        db,
        user_id=actor.id if actor else None,
        action="return_rejected",
        target_id=return_case.id,
        old_value=old_value,
        new_value=serialize_return_case(db, return_case, include_items=False),
        device_session=device_session,
    )
    return return_case


def close_return_case(
    db: Session,
    *,
    return_case: ReturnCase,
    actor: User | None,
    notes: str | None = None,
    device_session: str | None = None,
) -> ReturnCase:
    if return_case.decision_status == "cancelled":
        raise HTTPException(status_code=400, detail="Cancelled return case cannot be closed")
    old_value = serialize_return_case(db, return_case, include_items=False)
    return_case.decision_status = "closed"
    return_case.closed_at = utcnow()
    return_case.processed_by = actor.id if actor else return_case.processed_by
    if notes:
        return_case.notes = (return_case.notes or "") + f"\nClose note: {notes}"
    _log_audit(
        db,
        user_id=actor.id if actor else None,
        action="return_closed",
        target_id=return_case.id,
        old_value=old_value,
        new_value=serialize_return_case(db, return_case, include_items=False),
        device_session=device_session,
    )
    return return_case


def cancel_return_case(
    db: Session,
    *,
    return_case: ReturnCase,
    reason: str,
    actor: User | None,
    notes: str | None = None,
    device_session: str | None = None,
) -> ReturnCase:
    if return_case.decision_status == "closed":
        raise HTTPException(status_code=400, detail="Closed return case cannot be cancelled")
    old_value = serialize_return_case(db, return_case, include_items=False)
    text_reason = str(reason or "").strip()
    if not text_reason:
        raise HTTPException(status_code=400, detail="Cancellation reason is required")
    return_case.decision_status = "cancelled"
    return_case.notes = ((return_case.notes or "") + f"\nCancelled: {text_reason}").strip()
    if notes:
        return_case.notes = return_case.notes + f"\n{notes}"
    return_case.processed_by = actor.id if actor else return_case.processed_by
    _log_audit(
        db,
        user_id=actor.id if actor else None,
        action="return_cancelled",
        target_id=return_case.id,
        old_value=old_value,
        new_value=serialize_return_case(db, return_case, include_items=False),
        device_session=device_session,
    )
    return return_case


def _has_return_item_stock_movement(db: Session, return_item_id: int) -> bool:
    row = (
        db.query(StockMovement)
        .filter(
            StockMovement.reference_type == "return_item",
            StockMovement.reference_id == int(return_item_id),
        )
        .first()
    )
    return bool(row)


def _apply_return_item_inventory(
    db: Session,
    *,
    return_item: ReturnItem,
    actor_id: int | None,
) -> None:
    if _has_return_item_stock_movement(db, return_item.id):
        return
    product = db.query(InventoryItem).filter(InventoryItem.id == int(return_item.product_id)).first()
    if not product:
        raise HTTPException(status_code=404, detail=f"Return product not found: {return_item.product_id}")
    qty = max(0, int(return_item.quantity or 0))
    if qty <= 0:
        return

    condition = str(return_item.item_condition or "sellable").lower()
    action = str(return_item.restock_action or "restock").lower()
    is_damaged = condition in {"damaged", "defective", "missing_parts"} or action in {"damaged_stock", "scrap", "return_to_supplier"}

    if action == "no_stock_change":
        db.add(
            StockMovement(
                item_id=product.id,
                user_id=actor_id,
                movement_type="RETURN_NO_STOCK_CHANGE",
                quantity=0,
                reference_type="return_item",
                reference_id=return_item.id,
                note=f"Return item {return_item.id} (no stock change)",
            )
        )
        return

    if is_damaged:
        product.damaged_quantity = max(0, int(product.damaged_quantity or 0)) + qty
        db.add(
            DamagedStockRecord(
                return_item_id=return_item.id,
                product_id=product.id,
                serial_id=return_item.serial_id,
                quantity=qty,
                damage_reason=return_item.notes or "Damaged return",
                action=action if action in DAMAGED_ACTIONS else "hold",
                created_by=actor_id,
            )
        )
        movement_type = "RETURN_DAMAGED"
    else:
        product.quantity = max(0, int(product.quantity or 0)) + qty
        movement_type = "RETURN_RESTOCK"

    db.add(
        StockMovement(
            item_id=product.id,
            user_id=actor_id,
            movement_type=movement_type,
            quantity=qty,
            reference_type="return_item",
            reference_id=return_item.id,
            note=f"Return item {return_item.id} ({action})",
        )
    )

    if return_item.serial_id:
        serial = db.query(InventorySerial).filter(InventorySerial.id == int(return_item.serial_id)).first()
        if serial:
            serial.status = "damaged" if is_damaged else "returned"


def apply_return_inventory(db: Session, *, return_case: ReturnCase, actor_id: int | None) -> None:
    items = db.query(ReturnItem).filter(ReturnItem.return_id == return_case.id).all()
    for row in items:
        _apply_return_item_inventory(db, return_item=row, actor_id=actor_id)


def create_refund_payment(
    db: Session,
    *,
    return_case: ReturnCase,
    payload: Any,
    actor: User | None,
    device_session: str | None = None,
) -> RefundPayment:
    rules = get_return_rules(db)
    if return_case.decision_status in {"rejected", "cancelled", "closed"}:
        raise HTTPException(status_code=400, detail="Refund cannot be created for current return status")
    if bool(rules.get("require_inspection_before_refund", True)) and return_case.inspection_status in {"pending_inspection"}:
        raise HTTPException(status_code=400, detail="Item inspection is required before refund")

    reason = str(payload.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Refund reason is required")

    amount = to_float(payload.refund_amount)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Refund amount must be greater than 0")
    if not return_case.customer_id:
        raise HTTPException(status_code=400, detail="Customer must be linked before creating a refund")

    already_reserved = (
        db.query(func.coalesce(func.sum(RefundPayment.refund_amount), 0))
        .filter(
            RefundPayment.return_id == return_case.id,
            RefundPayment.refund_status != "cancelled",
        )
        .scalar()
        or 0
    )
    eligible_remaining = money_sub(return_case.total_return_amount, already_reserved)
    if eligible_remaining < to_decimal(0):
        eligible_remaining = to_decimal(0)
    eligible_amount = to_float(eligible_remaining)
    if amount > eligible_amount:
        raise HTTPException(
            status_code=400,
            detail=f"Refund amount exceeds eligible amount ({eligible_amount:.2f})",
        )

    method = _normalize_refund_method(payload.refund_method)
    if method not in REFUND_METHODS:
        raise HTTPException(status_code=400, detail="Unsupported refund method")
    if method == "store_credit" and not bool(rules.get("allow_store_credit", True)):
        raise HTTPException(status_code=400, detail="Store credit is disabled by policy")

    threshold = _safe_float(rules.get("refund_approval_threshold", 100000), 100000)
    damaged_item_refund = bool(rules.get("require_manager_approval_for_damaged_returns", True)) and (
        db.query(ReturnItem)
        .filter(
            ReturnItem.return_id == return_case.id,
            ReturnItem.item_condition.in_(["damaged", "defective", "missing_parts"]),
        )
        .first()
        is not None
    )
    approval_required = amount > threshold or damaged_item_refund or return_case.return_type == "warranty_replacement"
    manager_override = bool(payload.manager_override_used) and bool(actor and has_permission(db, actor, "returns.override"))
    auto_approve = (not approval_required) or _is_manager_or_above(actor) or manager_override

    row = RefundPayment(
        refund_number=next_number(db, "RFD"),
        return_id=return_case.id,
        original_payment_id=payload.original_payment_id,
        customer_id=int(return_case.customer_id),
        refund_amount=amount,
        refund_method=method,
        refund_status="approved" if auto_approve else "pending",
        approved_by=(actor.id if (auto_approve and actor) else None),
        notes=payload.notes or reason,
    )
    db.add(row)
    db.flush()

    return_case.refund_status = "pending"
    return_case.processed_by = actor.id if actor else return_case.processed_by
    _log_audit(
        db,
        user_id=actor.id if actor else None,
        action="refund_created",
        target_id=row.id,
        old_value=None,
        new_value={
            "refund_number": row.refund_number,
            "return_id": row.return_id,
            "refund_amount": row.refund_amount,
            "refund_method": row.refund_method,
            "refund_status": row.refund_status,
        },
        device_session=device_session,
    )
    return row


def approve_refund_payment(
    db: Session,
    *,
    refund: RefundPayment,
    actor: User | None,
    notes: str | None = None,
    device_session: str | None = None,
) -> RefundPayment:
    if refund.refund_status == "paid":
        raise HTTPException(status_code=400, detail="Paid refund cannot be approved again")
    old_status = refund.refund_status
    refund.refund_status = "approved"
    refund.approved_by = actor.id if actor else refund.approved_by
    if notes:
        refund.notes = (refund.notes or "") + f"\nApproval note: {notes}"
    _log_audit(
        db,
        user_id=actor.id if actor else None,
        action="refund_approved",
        target_id=refund.id,
        old_value={"refund_status": old_status},
        new_value={"refund_status": refund.refund_status},
        device_session=device_session,
    )
    return refund


def _recompute_refund_rollups(db: Session, return_case: ReturnCase) -> None:
    paid_total = (
        db.query(func.coalesce(func.sum(RefundPayment.refund_amount), 0))
        .filter(
            RefundPayment.return_id == return_case.id,
            RefundPayment.refund_status == "paid",
        )
        .scalar()
        or 0
    )
    reserved_total = (
        db.query(func.coalesce(func.sum(RefundPayment.refund_amount), 0))
        .filter(
            RefundPayment.return_id == return_case.id,
            RefundPayment.refund_status.in_(["pending", "approved", "paid"]),
        )
        .scalar()
        or 0
    )
    paid_total_dec = to_decimal(paid_total)
    reserved_total_dec = to_decimal(reserved_total)
    return_case.refund_amount = to_float(paid_total_dec)
    if reserved_total_dec <= 0:
        return_case.refund_status = "none"
    elif paid_total_dec <= 0:
        return_case.refund_status = "pending"
    elif paid_total_dec < to_decimal(return_case.total_return_amount):
        return_case.refund_status = "partial_refund"
    else:
        return_case.refund_status = "completed"
        return_case.decision_status = "refunded"


def mark_refund_payment_paid(
    db: Session,
    *,
    refund: RefundPayment,
    actor: User | None,
    notes: str | None = None,
    paid_at: datetime | None = None,
    device_session: str | None = None,
) -> RefundPayment:
    if refund.refund_status == "cancelled":
        raise HTTPException(status_code=400, detail="Cancelled refund cannot be paid")
    if refund.refund_status not in {"approved", "paid"} and not _is_manager_or_above(actor):
        raise HTTPException(status_code=403, detail="Refund must be approved before payment")

    if refund.refund_status != "paid":
        refund.refund_status = "paid"
        refund.paid_by = actor.id if actor else refund.paid_by
        refund.paid_at = paid_at or utcnow()
        if notes:
            refund.notes = (refund.notes or "") + f"\nPayment note: {notes}"

        return_case = get_return_case_or_404(db, int(refund.return_id))
        apply_return_inventory(db, return_case=return_case, actor_id=actor.id if actor else None)
        refund_amount = to_float(refund.refund_amount)

        if refund.refund_method == "store_credit":
            db.add(
                StoreCredit(
                    credit_number=next_number(db, "CRD"),
                    customer_id=refund.customer_id,
                    return_id=return_case.id,
                    amount=refund_amount,
                    remaining_amount=refund_amount,
                    status="active",
                    created_by=actor.id if actor else None,
                )
            )
            return_case.store_credit_amount = to_float(money_add(return_case.store_credit_amount, refund_amount))
        else:
            if not return_case.original_invoice_id:
                raise HTTPException(status_code=400, detail="Original invoice link is required to post refund payment")
            db.add(
                InvoicePayment(
                    invoice_id=int(return_case.original_invoice_id),
                    customer_id=refund.customer_id,
                    amount=refund_amount,
                    payment_method=str(refund.refund_method or "cash"),
                    payment_type="refund",
                    received_by=actor.id if actor else None,
                    notes=f"Refund payout for {return_case.return_number}",
                )
            )

        _recompute_refund_rollups(db, return_case)
        _log_audit(
            db,
            user_id=actor.id if actor else None,
            action="refund_paid",
            target_id=refund.id,
            old_value={"refund_status": "approved"},
            new_value={"refund_status": "paid"},
            device_session=device_session,
        )
    return refund


def cancel_refund_payment(
    db: Session,
    *,
    refund: RefundPayment,
    actor: User | None,
    reason: str,
    notes: str | None = None,
    device_session: str | None = None,
) -> RefundPayment:
    if refund.refund_status == "paid":
        raise HTTPException(status_code=400, detail="Paid refund cannot be cancelled")
    text_reason = str(reason or "").strip()
    if not text_reason:
        raise HTTPException(status_code=400, detail="Cancellation reason is required")
    old_status = refund.refund_status
    refund.refund_status = "cancelled"
    refund.notes = ((refund.notes or "") + f"\nCancelled: {text_reason}").strip()
    if notes:
        refund.notes = refund.notes + f"\n{notes}"
    return_case = get_return_case_or_404(db, int(refund.return_id))
    _recompute_refund_rollups(db, return_case)
    _log_audit(
        db,
        user_id=actor.id if actor else None,
        action="refund_cancelled",
        target_id=refund.id,
        old_value={"refund_status": old_status},
        new_value={"refund_status": refund.refund_status},
        device_session=device_session,
    )
    return refund


def issue_store_credit(
    db: Session,
    *,
    return_case: ReturnCase,
    amount: float,
    expiry_date: datetime | None,
    notes: str | None,
    actor: User | None,
    device_session: str | None = None,
) -> StoreCredit:
    rules = get_return_rules(db)
    if not bool(rules.get("allow_store_credit", True)):
        raise HTTPException(status_code=400, detail="Store credit is disabled by policy")
    if return_case.decision_status in {"cancelled", "rejected", "closed"}:
        raise HTTPException(status_code=400, detail="Store credit cannot be issued for this return case")
    credit_amount = to_float(amount)
    if credit_amount <= 0:
        raise HTTPException(status_code=400, detail="Store credit amount must be greater than 0")
    if not return_case.customer_id:
        raise HTTPException(status_code=400, detail="Customer must be linked before issuing store credit")

    already_issued = (
        db.query(func.coalesce(func.sum(StoreCredit.amount), 0))
        .filter(
            StoreCredit.return_id == return_case.id,
            StoreCredit.status != "cancelled",
        )
        .scalar()
        or 0
    )
    remaining_eligible_dec = money_sub(return_case.total_return_amount, already_issued)
    if remaining_eligible_dec < to_decimal(0):
        remaining_eligible_dec = to_decimal(0)
    remaining_eligible = to_float(remaining_eligible_dec)
    if credit_amount > remaining_eligible:
        raise HTTPException(status_code=400, detail=f"Store credit exceeds eligible amount ({remaining_eligible:.2f})")

    row = StoreCredit(
        credit_number=next_number(db, "CRD"),
        customer_id=int(return_case.customer_id or 0),
        return_id=return_case.id,
        amount=credit_amount,
        remaining_amount=credit_amount,
        status="active",
        expiry_date=expiry_date,
        created_by=actor.id if actor else None,
    )
    db.add(row)
    db.flush()

    apply_return_inventory(db, return_case=return_case, actor_id=actor.id if actor else None)
    return_case.store_credit_amount = to_float(money_add(return_case.store_credit_amount, credit_amount))
    return_case.decision_status = "refunded"
    if to_decimal(return_case.store_credit_amount) >= to_decimal(return_case.total_return_amount):
        return_case.refund_status = "completed"
    elif to_decimal(return_case.store_credit_amount) > 0:
        return_case.refund_status = "partial_refund"
    if notes:
        return_case.notes = (return_case.notes or "") + f"\nStore credit note: {notes}"
    _log_audit(
        db,
        user_id=actor.id if actor else None,
        action="store_credit_issued",
        target_id=row.id,
        old_value=None,
        new_value={
            "credit_number": row.credit_number,
            "customer_id": row.customer_id,
            "amount": row.amount,
            "remaining_amount": row.remaining_amount,
        },
        device_session=device_session,
    )
    return row


def list_customer_store_credits(db: Session, customer_id: int) -> list[StoreCredit]:
    rows = (
        db.query(StoreCredit)
        .filter(StoreCredit.customer_id == int(customer_id))
        .order_by(StoreCredit.created_at.desc())
        .all()
    )
    out: list[StoreCredit] = []
    now = utcnow()
    for row in rows:
        if row.status == "active" and row.expiry_date and row.expiry_date < now:
            row.status = "expired"
        out.append(row)
    return out


def use_store_credit(
    db: Session,
    *,
    credit: StoreCredit,
    amount: float,
    invoice_id: int | None,
    actor: User | None,
    notes: str | None = None,
    override_customer_restriction: bool = False,
    device_session: str | None = None,
) -> StoreCredit:
    if credit.status not in {"active", "used"}:
        raise HTTPException(status_code=400, detail="Store credit is not usable")
    if credit.expiry_date and credit.expiry_date < utcnow():
        credit.status = "expired"
        raise HTTPException(status_code=400, detail="Store credit has expired")
    use_amount = _safe_float(amount, 0)
    if use_amount <= 0:
        raise HTTPException(status_code=400, detail="Usage amount must be greater than 0")
    if to_decimal(use_amount) > to_decimal(credit.remaining_amount):
        raise HTTPException(status_code=400, detail="Usage amount exceeds remaining credit")

    target_invoice = None
    if invoice_id:
        target_invoice = db.query(Sale).filter(Sale.id == int(invoice_id)).first()
        if not target_invoice:
            raise HTTPException(status_code=404, detail="Invoice not found for store credit usage")
        same_customer = int(target_invoice.customer_id or 0) == int(credit.customer_id or 0)
        allow_override = bool(override_customer_restriction and actor and has_permission(db, actor, "returns.override"))
        if (not same_customer) and (not allow_override):
            raise HTTPException(status_code=403, detail="Store credit belongs to another customer")

    old_remaining = _safe_float(credit.remaining_amount)
    credit.remaining_amount = to_float(money_sub(old_remaining, use_amount))
    credit.status = "used" if credit.remaining_amount <= 0 else "active"

    if target_invoice:
        db.add(
            InvoicePayment(
                payment_number=next_number(db, "PAY"),
                invoice_id=target_invoice.id,
                customer_id=credit.customer_id,
                amount=use_amount,
                payment_method="store_credit",
                payment_type="store_credit",
                received_by=actor.id if actor else None,
                notes=notes or f"Store credit {credit.credit_number} used",
            )
        )
        target_invoice.amount_paid = to_float(money_add(target_invoice.amount_paid, use_amount))
        balance_due = money_sub(target_invoice.total, target_invoice.amount_paid)
        target_invoice.balance_due = to_float(balance_due if balance_due > 0 else 0)
        target_invoice.paid = bool(_safe_float(target_invoice.balance_due) <= 0)
        target_invoice.payment_status = "paid" if target_invoice.paid else "partial"

    _log_audit(
        db,
        user_id=actor.id if actor else None,
        action="store_credit_used",
        target_id=credit.id,
        old_value={"remaining_amount": old_remaining},
        new_value={"remaining_amount": credit.remaining_amount, "invoice_id": target_invoice.id if target_invoice else None},
        device_session=device_session,
    )
    return credit


def create_exchange(
    db: Session,
    *,
    return_case: ReturnCase,
    payload: Any,
    actor: User | None,
    device_session: str | None = None,
) -> ExchangeRecord:
    rules = get_return_rules(db)
    if not bool(rules.get("allow_exchanges", True)):
        raise HTTPException(status_code=400, detail="Exchanges are disabled by policy")
    if return_case.decision_status not in {"approved", "pending"}:
        raise HTTPException(status_code=400, detail="Return must be pending/approved before exchange")

    items = db.query(ReturnItem).filter(ReturnItem.return_id == return_case.id).all()
    if not items:
        raise HTTPException(status_code=400, detail="No return items found for exchange")
    selected_item = None
    if payload.old_invoice_item_id:
        selected_item = next((x for x in items if int(x.original_invoice_item_id or 0) == int(payload.old_invoice_item_id)), None)
    if not selected_item:
        selected_item = items[0]

    new_product = db.query(InventoryItem).filter(InventoryItem.id == int(payload.new_product_id)).first()
    if not new_product:
        raise HTTPException(status_code=404, detail="Replacement product not found")
    new_qty = max(1, int(payload.new_quantity or 1))
    if int(new_product.quantity or 0) < new_qty:
        raise HTTPException(status_code=400, detail="Insufficient replacement stock")

    apply_return_inventory(db, return_case=return_case, actor_id=actor.id if actor else None)

    new_product.quantity = int(new_product.quantity or 0) - new_qty
    db.add(
        StockMovement(
            item_id=new_product.id,
            user_id=actor.id if actor else None,
            movement_type="EXCHANGE_OUT",
            quantity=-new_qty,
            reference_type="return_exchange",
            reference_id=return_case.id,
            note=f"Exchange for return {return_case.return_number}",
        )
    )

    old_total = to_decimal(selected_item.return_amount)
    new_total = money_mul(new_product.sale_price, new_qty)
    price_difference_dec = money_sub(new_total, old_total)
    balance_to_pay_dec = price_difference_dec if price_difference_dec > 0 else to_decimal(0)
    balance_to_refund_dec = -price_difference_dec if price_difference_dec < 0 else to_decimal(0)
    price_difference = to_float(price_difference_dec)
    balance_to_pay = to_float(balance_to_pay_dec)
    balance_to_refund = to_float(balance_to_refund_dec)

    row = ExchangeRecord(
        exchange_number=next_number(db, "EXC"),
        return_id=return_case.id,
        old_invoice_item_id=int(selected_item.original_invoice_item_id),
        old_product_id=int(selected_item.product_id),
        new_product_id=int(new_product.id),
        price_difference=price_difference,
        balance_to_pay=balance_to_pay,
        balance_to_refund=balance_to_refund,
        created_by=actor.id if actor else None,
    )
    db.add(row)
    db.flush()

    selected_item.replacement_product_id = int(new_product.id)
    selected_item.replacement_serial_id = int(payload.new_serial_id) if payload.new_serial_id else selected_item.replacement_serial_id
    return_case.decision_status = "exchanged"
    return_case.processed_by = actor.id if actor else return_case.processed_by
    if payload.notes:
        return_case.notes = (return_case.notes or "") + f"\nExchange note: {payload.notes}"

    _log_audit(
        db,
        user_id=actor.id if actor else None,
        action="exchange_completed",
        target_id=row.id,
        old_value=None,
        new_value={
            "return_id": row.return_id,
            "old_product_id": row.old_product_id,
            "new_product_id": row.new_product_id,
            "price_difference": row.price_difference,
            "balance_to_pay": row.balance_to_pay,
            "balance_to_refund": row.balance_to_refund,
        },
        device_session=device_session,
    )
    return row


def create_exchange_invoice(
    db: Session,
    *,
    return_case: ReturnCase,
    payload: Any,
    actor: User | None,
    device_session: str | None = None,
) -> Sale:
    exchange = None
    if payload.exchange_id:
        exchange = db.query(ExchangeRecord).filter(ExchangeRecord.id == int(payload.exchange_id), ExchangeRecord.return_id == return_case.id).first()
    if not exchange:
        exchange = db.query(ExchangeRecord).filter(ExchangeRecord.return_id == return_case.id).order_by(ExchangeRecord.created_at.desc()).first()
    if not exchange:
        raise HTTPException(status_code=404, detail="No exchange record found for invoice creation")

    item = db.query(ReturnItem).filter(ReturnItem.return_id == return_case.id).order_by(ReturnItem.id.asc()).first()
    qty = max(1, int(item.quantity or 1)) if item else 1
    total_dec = to_decimal(exchange.balance_to_pay)
    if total_dec < 0:
        total_dec = to_decimal(0)
    total = to_float(total_dec)
    unit_price = to_float(total_dec / to_decimal(qty)) if qty > 0 else total

    sale = Sale(
        invoice_no=next_number(db, "EXC"),
        invoice_type="exchange_invoice",
        customer_id=return_case.customer_id,
        payment_method=payload.payment_method or "Cash",
        subtotal=total,
        discount_amount=0,
        tax_amount=0,
        total=total,
        advance_applied_total=0,
        paid=bool(payload.paid),
        amount_paid=total if payload.paid else 0,
        balance_due=0 if payload.paid else total,
        payment_status="paid" if payload.paid else "partial",
        invoice_status="finalized",
        is_return=False,
        created_by=actor.id if actor else None,
        finalized_at=utcnow(),
    )
    db.add(sale)
    db.flush()

    db.add(
        SaleItem(
            sale_id=sale.id,
            item_id=exchange.new_product_id,
            line_type="product",
            description=f"Exchange invoice for {return_case.return_number}",
            quantity=qty,
            price=unit_price,
            discount_amount=0,
            line_total=to_float(money_mul(unit_price, qty)),
            cost_price=0,
            warranty_days=0,
            serial_number=None,
        )
    )
    if payload.paid and total > 0:
        db.add(
            InvoicePayment(
                payment_number=next_number(db, "PAY"),
                invoice_id=sale.id,
                customer_id=sale.customer_id,
                amount=total,
                payment_method=str(payload.payment_method or "cash").lower(),
                payment_type="normal",
                received_by=actor.id if actor else None,
                notes=f"Exchange settlement for {return_case.return_number}",
            )
        )
    exchange.new_invoice_id = sale.id

    _log_audit(
        db,
        user_id=actor.id if actor else None,
        action="exchange_invoice_created",
        target_id=sale.id,
        old_value=None,
        new_value={
            "invoice_no": sale.invoice_no,
            "return_id": return_case.id,
            "exchange_id": exchange.id,
            "total": sale.total,
        },
        device_session=device_session,
    )
    return sale


def update_damaged_stock_action(
    db: Session,
    *,
    record: DamagedStockRecord,
    action: str,
    note: str | None,
    actor: User | None,
    device_session: str | None = None,
) -> DamagedStockRecord:
    value = str(action or "").strip().lower()
    if value not in DAMAGED_ACTIONS:
        raise HTTPException(status_code=400, detail="Invalid damaged stock action")
    old_value = {"action": record.action}
    record.action = value
    if note:
        record.damage_reason = (record.damage_reason or "") + f" | {note}"
    _log_audit(
        db,
        user_id=actor.id if actor else None,
        action="damaged_stock_updated",
        target_id=record.id,
        old_value=old_value,
        new_value={"action": record.action},
        device_session=device_session,
    )
    return record


def returns_summary_report(
    db: Session,
    *,
    date_from: str | None = None,
    date_to: str | None = None,
    customer_id: int | None = None,
    product_id: int | None = None,
    cashier_id: int | None = None,
    manager_id: int | None = None,
    return_reason: str | None = None,
    return_status: str | None = None,
    refund_method: str | None = None,
    limit: int = 5000,
) -> dict[str, Any]:
    query = db.query(ReturnCase)
    if date_from:
        try:
            query = query.filter(ReturnCase.created_at >= datetime.fromisoformat(str(date_from)))
        except Exception:
            pass
    if date_to:
        try:
            query = query.filter(ReturnCase.created_at < datetime.fromisoformat(str(date_to)) + timedelta(days=1))
        except Exception:
            pass
    if customer_id:
        query = query.filter(ReturnCase.customer_id == int(customer_id))
    if cashier_id:
        query = query.filter(ReturnCase.processed_by == int(cashier_id))
    if manager_id:
        query = query.filter(ReturnCase.approved_by == int(manager_id))
    if return_reason:
        query = query.filter(ReturnCase.reason == str(return_reason))
    if return_status:
        query = query.filter(ReturnCase.decision_status == str(return_status).strip().lower())

    if product_id:
        query = query.join(ReturnItem, ReturnItem.return_id == ReturnCase.id).filter(ReturnItem.product_id == int(product_id))
    bounded_limit = max(1, min(int(limit or 5000), 20000))
    rows = query.order_by(ReturnCase.created_at.desc()).limit(bounded_limit).all()

    refunds_q = db.query(RefundPayment)
    if refund_method:
        refunds_q = refunds_q.filter(RefundPayment.refund_method == _normalize_refund_method(refund_method))
    if date_from:
        try:
            refunds_q = refunds_q.filter(RefundPayment.created_at >= datetime.fromisoformat(str(date_from)))
        except Exception:
            pass
    if date_to:
        try:
            refunds_q = refunds_q.filter(RefundPayment.created_at < datetime.fromisoformat(str(date_to)) + timedelta(days=1))
        except Exception:
            pass
    refunds = refunds_q.order_by(RefundPayment.created_at.desc()).limit(bounded_limit).all()

    exchanges = (
        db.query(ExchangeRecord)
        .join(ReturnCase, ReturnCase.id == ExchangeRecord.return_id)
        .order_by(ExchangeRecord.created_at.desc())
        .limit(bounded_limit)
        .all()
    )
    damaged = db.query(DamagedStockRecord).order_by(DamagedStockRecord.created_at.desc()).limit(bounded_limit).all()

    by_date: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = row.created_at.date().isoformat() if row.created_at else "unknown"
        bucket = by_date.setdefault(key, {"date": key, "return_count": 0, "total_return_value": 0.0})
        bucket["return_count"] += 1
        bucket["total_return_value"] = round(float(bucket["total_return_value"]) + float(row.total_return_amount or 0), 2)

    summary_rows = sorted(by_date.values(), key=lambda x: x["date"], reverse=True)
    return {
        "summary": {
            "total_returns": len(rows),
            "total_return_value": round(sum(float(r.total_return_amount or 0) for r in rows), 2),
            "total_refunds": round(sum(float(r.refund_amount or 0) for r in refunds if r.refund_status == "paid"), 2),
            "total_exchanges": len(exchanges),
            "damaged_item_count": int(sum(int(d.quantity or 0) for d in damaged)),
        },
        "returns_by_date": summary_rows,
    }
