import json
import logging
from datetime import datetime
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi import Request
from sqlalchemy.orm import Session
from app.constants import SALE_INVENTORY_LINE_TYPES, SALE_LINE_TYPES
from app.database import get_db
from app.auth import get_current_user, require_permission
from app.models import (
    AppSetting,
    AdvancePayment,
    Customer,
    ExchangeRecord,
    InvoiceAuditEvent,
    InvoicePayment,
    InventorySerial,
    InventoryItem,
    ProductReservation,
    RefundPayment,
    Return as ReturnCase,
    ReturnItem,
    RepairTicket,
    ReturnRecord,
    Sale,
    SaleItem,
    StockMovement,
    StoreCredit,
    WarrantyRecord,
)
from app.schemas import SaleIn, SaleReturnIn, SaleVoidIn, QuickAddItemIn
from app.services.advance_service import (
    ADVANCE_NON_APPLICABLE_STATUSES,
    apply_advance_to_invoice,
    as_money,
    available_advances_query,
    calc_advance_remaining,
    get_reserved_qty_for_item,
    sync_repair_advance_totals,
    sync_reservation_advance_totals,
)
from app.services.accounting_ledger_service import record_ledger_entry
from app.services.approval_service import consume_approval_request
from app.services.numbering_service import next_number
from app.services.domain_audit_service import assert_accounting_period_open, record_domain_audit
from app.services.settings_policy_service import (
    enforce_pos_checkout_policy,
    enforce_void_refund_policy,
    void_refund_approval_required,
)
from app.services.warranty_service import (
    create_sale_warranty_records,
    ensure_warranty_defaults,
    resolve_sale_item_warranty_days,
    warranty_status_label,
)
from app.services.return_service import (
    RETURN_STATUS_REFUNDED,
    create_return_record as create_return_record_entry,
    get_returned_qty_for_sale_item,
    process_return_record as process_return_record_entry,
)
from app.utils.time import utcnow

router = APIRouter(prefix="/pos", tags=["pos"])
logger = logging.getLogger("istore.api")


def _normalize_line_type(raw_type: str | None, item_id: int | None) -> str:
    candidate = str(raw_type or "").strip().lower()
    aliases = {
        "product": "product",
        "item": "product",
        "spare_part": "spare_part",
        "spare part": "spare_part",
        "part": "spare_part",
        "labor": "labor",
        "service": "service",
        "discount": "discount",
        "manual_product": "manual_product",
    }
    if candidate in aliases:
        normalized = aliases[candidate]
    else:
        normalized = "product" if item_id else "labor"
    if normalized not in SALE_LINE_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid line_type '{raw_type}'")
    return normalized


def _invoice_label(sale: Sale) -> str:
    return str(sale.invoice_no or f"INV-{sale.id:05d}")


def _payment_status_from_balance(balance_due: float) -> str:
    if balance_due <= 0:
        return "paid"
    return "partial" if balance_due > 0 else "unpaid"


def _normalize_payment_method_for_ledger(method: str) -> str:
    key = str(method or "").strip().lower()
    aliases = {
        "cash": "cash",
        "card": "card",
        "bank transfer": "bank_transfer",
        "bank_transfer": "bank_transfer",
        "mixed": "mixed",
        "credit": "credit",
    }
    return aliases.get(key, key.replace(" ", "_"))


def _read_settings_state(db: Session) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == "settings_state_v2").first()
    if not row or not row.value:
        return {}
    try:
        payload = json.loads(row.value)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _business_ops_sales_rules(db: Session) -> dict:
    state = _read_settings_state(db)
    return (((state or {}).get("business_ops") or {}).get("sales_pos_rules") or {})


def _stock_label(available_qty: int) -> str:
    if available_qty <= 0:
        return "Out of Stock"
    if available_qty <= 5:
        return "Low Stock"
    return "Available"


def _inventory_card_payload(db: Session, row: InventoryItem) -> dict:
    reserved_qty = get_reserved_qty_for_item(db, int(row.id))
    available_qty = int(row.quantity or 0) - int(reserved_qty or 0)
    return {
        "id": row.id,
        "name": row.name,
        "sku": row.sku,
        "barcode": row.barcode,
        "category": row.category,
        "brand": row.brand,
        "model": row.model,
        "image_url": row.image_url,
        "sale_price": float(row.sale_price or 0),
        "cost_price": float(row.cost_price or 0),
        "warranty_days": int(row.warranty_days or 0),
        "has_serials": bool(row.has_serials),
        "stock": {
            "on_hand": int(row.quantity or 0),
            "reserved": int(reserved_qty or 0),
            "available": int(available_qty),
            "status": _stock_label(int(available_qty)),
        },
    }


def _log_invoice_event(
    db: Session,
    *,
    sale: Sale,
    event_type: str,
    event_message: str,
    user_id: int | None = None,
) -> None:
    db.add(
        InvoiceAuditEvent(
            invoice_id=int(sale.id),
            event_type=str(event_type),
            event_message=str(event_message),
            user_id=user_id,
        )
    )


@router.get('/print-profile', dependencies=[Depends(require_permission("pos.view"))])
def get_pos_print_profile(db: Session = Depends(get_db), _=Depends(get_current_user)):
    row = db.query(AppSetting).filter(AppSetting.key == "print_profile").first()
    if not row or not row.value:
        return {}
    try:
        payload = json.loads(row.value)
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


@router.get('/sales', dependencies=[Depends(require_permission("pos.view"))])
def sales(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=2000),
    customer_id: int | None = Query(default=None),
    repair_ticket_id: int | None = Query(default=None),
    payment_status: str | None = Query(default=None),
    invoice_type: str | None = Query(default=None),  # all | sale | return
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(Sale)
    if customer_id:
        query = query.filter(Sale.customer_id == int(customer_id))
    if repair_ticket_id:
        query = query.filter(Sale.repair_ticket_id == int(repair_ticket_id))
    if payment_status and str(payment_status).lower() != "all":
        query = query.filter(Sale.payment_status == str(payment_status).strip().lower())
    if invoice_type:
        key = str(invoice_type).strip().lower()
        if key == "sale":
            query = query.filter(Sale.is_return == False)  # noqa: E712
        elif key == "return":
            query = query.filter(Sale.is_return == True)  # noqa: E712
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
    rows = (
        query.order_by(Sale.created_at.desc(), Sale.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [
        {
            "id": s.id,
            "invoice_no": _invoice_label(s),
            "customer_id": s.customer_id,
            "repair_ticket_id": s.repair_ticket_id,
            "subtotal": s.subtotal,
            "discount_amount": s.discount_amount,
            "tax_amount": s.tax_amount,
            "total": s.total,
            "amount_paid": float(s.amount_paid or 0),
            "balance_due": float(s.balance_due or 0),
            "payment_status": s.payment_status,
            "is_return": s.is_return,
            "original_sale_id": s.original_sale_id,
            "payment_method": s.payment_method,
            "paid": s.paid,
            "is_voided": s.is_voided,
            "void_reason": s.void_reason,
            "created_at": s.created_at.isoformat()
        } for s in rows
    ]

@router.get('/sales/{sale_id}', dependencies=[Depends(require_permission("pos.view"))])
def get_sale(sale_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    sale = db.query(Sale).filter(Sale.id == sale_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")

    items = db.query(SaleItem).filter(SaleItem.sale_id == sale_id).all()
    # Join with inventory to get names
    res_items = []
    for si in items:
        inv = None
        if si.item_id:
            inv = db.query(InventoryItem).filter(InventoryItem.id == si.item_id).first()
        sold_qty = max(0, int(si.quantity or 0))
        already_returned_qty = get_returned_qty_for_sale_item(db, si.id)
        res_items.append({
            "sale_item_id": si.id,
            "item_id": si.item_id,
            "line_type": si.line_type,
            "description": si.description,
            "name": (inv.name if inv else (si.description or "Line Item")),
            "item_code": ((inv.sku or inv.barcode) if inv else None),
            "serial_number": si.serial_number,
            "quantity": si.quantity,
            "price": si.price,
            "line_total": float(si.quantity or 0) * float(si.price or 0),
            "warranty_days": si.warranty_days,
            "already_returned_qty": already_returned_qty,
            "returnable_qty": max(0, sold_qty - already_returned_qty),
        })

    customer = None
    if sale.customer_id:
        customer = db.query(Customer).filter(Customer.id == sale.customer_id).first()
    linked_repair = None
    if sale.repair_ticket_id:
        linked_repair = db.query(RepairTicket).filter(RepairTicket.id == sale.repair_ticket_id).first()

    warranties = (
        db.query(WarrantyRecord)
        .filter(WarrantyRecord.invoice_id == sale.id)
        .order_by(WarrantyRecord.created_at.asc())
        .all()
    )

    warranty_payload = [
        {
            "warranty_id": row.warranty_code,
            "item_name": row.product_or_service_name,
            "warranty_type": row.warranty_type,
            "warranty_days": row.warranty_days,
            "start_date": row.start_date.isoformat() if row.start_date else None,
            "end_date": row.end_date.isoformat() if row.end_date else None,
            "status": row.status,
            "serial_number": row.serial_number,
        }
        for row in warranties
    ]
    return_rows = (
        db.query(ReturnRecord)
        .filter(ReturnRecord.original_sale_id == sale.id)
        .order_by(ReturnRecord.created_at.desc())
        .all()
    )
    legacy_return_payload = [
        {
            "source": "legacy",
            "return_id": row.return_code,
            "return_type": row.return_type,
            "product_name": row.product_name,
            "quantity": row.quantity,
            "status": row.decision_status,
            "refund_amount": row.refund_amount,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in return_rows
    ]

    v2_rows = (
        db.query(ReturnCase)
        .filter(ReturnCase.original_invoice_id == sale.id)
        .order_by(ReturnCase.created_at.desc())
        .all()
    )
    v2_item_rows = (
        db.query(ReturnItem)
        .filter(ReturnItem.return_id.in_([row.id for row in v2_rows]))
        .all()
        if v2_rows
        else []
    )
    v2_item_map: dict[int, list[ReturnItem]] = {}
    for item_row in v2_item_rows:
        v2_item_map.setdefault(int(item_row.return_id), []).append(item_row)
    v2_return_payload = []
    for row in v2_rows:
        item_rows = v2_item_map.get(int(row.id), [])
        product_names = []
        for item_row in item_rows:
            inv = db.query(InventoryItem).filter(InventoryItem.id == item_row.product_id).first()
            if inv:
                product_names.append(inv.name)
        v2_return_payload.append(
            {
                "source": "v2",
                "return_id": row.return_number,
                "return_type": row.return_type,
                "product_name": ", ".join(product_names) if product_names else None,
                "quantity": int(sum(int(item.quantity or 0) for item in item_rows)),
                "status": row.decision_status,
                "refund_amount": float(row.refund_amount or 0),
                "store_credit_amount": float(row.store_credit_amount or 0),
                "refund_status": row.refund_status,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
        )

    return_payload = sorted(
        legacy_return_payload + v2_return_payload,
        key=lambda row: row.get("created_at") or "",
        reverse=True,
    )

    return {
        "id": sale.id,
        "invoice_no": _invoice_label(sale),
        "customer_id": sale.customer_id,
        "repair_ticket_id": sale.repair_ticket_id,
        "repair_ticket_no": linked_repair.ticket_no if linked_repair else None,
        "repair_device_model": linked_repair.device_model if linked_repair else None,
        "repair_device_imei": linked_repair.imei if linked_repair else None,
        "customer_name": customer.name if customer else "Walk-in",
        "customer_phone": customer.phone if customer else None,
        "customer_email": customer.email if customer else None,
        "customer_address": customer.address if customer else None,
        "subtotal": sale.subtotal,
        "discount_amount": sale.discount_amount,
        "tax_amount": sale.tax_amount,
        "total": sale.total,
        "amount_paid": float(sale.amount_paid or 0),
        "balance_due": float(sale.balance_due or 0),
        "payment_status": sale.payment_status,
        "is_return": sale.is_return,
        "original_sale_id": sale.original_sale_id,
        "payment_method": sale.payment_method,
        "cash_amount": sale.cash_amount,
        "card_amount": sale.card_amount,
        "paid": sale.paid,
        "is_voided": sale.is_voided,
        "void_reason": sale.void_reason,
        "created_at": sale.created_at.isoformat(),
        "lines": res_items,
        "warranty_records": warranty_payload,
        "return_history": return_payload,
    }


@router.get('/recent-transactions', dependencies=[Depends(require_permission("pos.view"))])
def recent_transactions(
    limit: int = Query(default=25, ge=1, le=200),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    rows = (
        db.query(Sale)
        .order_by(Sale.created_at.desc(), Sale.id.desc())
        .limit(int(limit))
        .all()
    )
    return [
        {
            "id": row.id,
            "invoice_number": _invoice_label(row),
            "invoice_type": row.invoice_type or ("repair_invoice" if row.repair_ticket_id else "product_sale"),
            "customer_id": row.customer_id,
            "repair_ticket_id": row.repair_ticket_id,
            "reservation_id": row.reservation_id,
            "grand_total": float(row.total or 0),
            "paid_total": float(row.amount_paid or 0),
            "balance_due": float(row.balance_due or 0),
            "payment_status": row.payment_status,
            "invoice_status": row.invoice_status or ("voided" if row.is_voided else "finalized"),
            "payment_method": row.payment_method,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


@router.get('/product-search', dependencies=[Depends(require_permission("pos.view"))])
def pos_product_search(
    q: str = Query(default="", min_length=0),
    category: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(InventoryItem).filter(InventoryItem.is_deleted == False)  # noqa: E712
    term = str(q or "").strip()
    if term:
        like = f"%{term}%"
        query = query.filter(
            (InventoryItem.name.ilike(like))
            | (InventoryItem.sku.ilike(like))
            | (InventoryItem.barcode.ilike(like))
            | (InventoryItem.brand.ilike(like))
            | (InventoryItem.model.ilike(like))
        )
    if category and str(category).strip().lower() != "all":
        query = query.filter(InventoryItem.category.ilike(str(category).strip()))
    rows = (
        query.order_by(InventoryItem.name.asc(), InventoryItem.id.asc())
        .offset(int(offset))
        .limit(int(limit))
        .all()
    )
    return [_inventory_card_payload(db, row) for row in rows]


@router.get('/barcode/{barcode}', dependencies=[Depends(require_permission("pos.view"))])
def pos_barcode_lookup(
    barcode: str,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    token = str(barcode or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Barcode is required")
    row = (
        db.query(InventoryItem)
        .filter(
            InventoryItem.is_deleted == False,  # noqa: E712
            ((InventoryItem.barcode == token) | (InventoryItem.sku == token)),
        )
        .first()
    )
    if not row:
        row = (
            db.query(InventoryItem)
            .filter(
                InventoryItem.is_deleted == False,  # noqa: E712
                ((InventoryItem.barcode.ilike(token)) | (InventoryItem.sku.ilike(token))),
            )
            .first()
        )
    if not row:
        raise HTTPException(status_code=404, detail="Product not found for barcode/SKU")
    return _inventory_card_payload(db, row)


@router.get('/customer/{customer_id}/available-credits', dependencies=[Depends(require_permission("pos.view"))])
def pos_customer_available_credits(
    customer_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    customer_row = db.query(Customer).filter(Customer.id == int(customer_id), Customer.is_deleted == False).first()  # noqa: E712
    if not customer_row:
        raise HTTPException(status_code=404, detail="Customer not found")
    rows = (
        db.query(StoreCredit)
        .filter(
            StoreCredit.customer_id == int(customer_id),
            StoreCredit.status.in_(["active", "used"]),
            StoreCredit.remaining_amount > 0,
        )
        .order_by(StoreCredit.created_at.asc(), StoreCredit.id.asc())
        .all()
    )
    return {
        "customer_id": int(customer_id),
        "total_available": round(sum(float(row.remaining_amount or 0) for row in rows), 2),
        "rows": [
            {
                "id": row.id,
                "credit_number": row.credit_number,
                "amount": float(row.amount or 0),
                "remaining_amount": float(row.remaining_amount or 0),
                "status": row.status,
                "expiry_date": row.expiry_date.isoformat() if row.expiry_date else None,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ],
    }


@router.get('/customer/{customer_id}/available-advances', dependencies=[Depends(require_permission("pos.apply_advance"))])
def pos_customer_available_advances(
    customer_id: int,
    repair_ticket_id: int | None = Query(default=None),
    reservation_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    rows = available_advances_query(
        db=db,
        customer_id=int(customer_id),
        repair_ticket_id=repair_ticket_id,
        reservation_id=reservation_id,
    )
    return [
        {
            "id": row.id,
            "advance_number": row.advance_number,
            "advance_type": row.advance_type,
            "amount": as_money(row.amount),
            "applied_amount": as_money(row.applied_amount),
            "refunded_amount": as_money(row.refunded_amount),
            "remaining_amount": calc_advance_remaining(row),
            "payment_method": row.payment_method,
            "payment_date": row.payment_date.isoformat() if row.payment_date else None,
            "repair_ticket_id": row.repair_ticket_id,
            "reservation_id": row.reservation_id,
        }
        for row in rows
    ]


@router.get('/available-advances', dependencies=[Depends(require_permission("pos.apply_advance"))])
def get_available_advances_for_checkout(
    customer_id: int,
    repair_ticket_id: int | None = Query(default=None),
    reservation_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    customer = db.query(Customer).filter(Customer.id == int(customer_id), Customer.is_deleted == False).first()  # noqa: E712
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    rows = available_advances_query(
        db=db,
        customer_id=int(customer_id),
        repair_ticket_id=repair_ticket_id,
        reservation_id=reservation_id,
    )
    payload = []
    for row in rows:
        payload.append(
            {
                "id": row.id,
                "advance_number": row.advance_number,
                "advance_type": row.advance_type,
                "amount": as_money(row.amount),
                "applied_amount": as_money(row.applied_amount),
                "refunded_amount": as_money(row.refunded_amount),
                "remaining_amount": calc_advance_remaining(row),
                "payment_method": row.payment_method,
                "payment_date": row.payment_date.isoformat() if row.payment_date else None,
                "repair_ticket_id": row.repair_ticket_id,
                "reservation_id": row.reservation_id,
            }
        )
    return payload


@router.post('/checkout', dependencies=[Depends(require_permission("pos.checkout"))])
def checkout(payload: SaleIn, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    ensure_warranty_defaults(db)
    assert_accounting_period_open(db, when=utcnow(), action="create sale")
    sales_rules = _business_ops_sales_rules(db)

    linked_repair = None
    if payload.repair_ticket_id:
        linked_repair = db.query(RepairTicket).filter(RepairTicket.id == int(payload.repair_ticket_id)).first()
        if not linked_repair:
            raise HTTPException(status_code=404, detail="Repair ticket not found")

    linked_reservation = None
    if payload.reservation_id:
        linked_reservation = db.query(ProductReservation).filter(ProductReservation.id == int(payload.reservation_id)).first()
        if not linked_reservation:
            raise HTTPException(status_code=404, detail="Product reservation not found")
        if payload.customer_id and int(linked_reservation.customer_id or 0) != int(payload.customer_id):
            raise HTTPException(status_code=400, detail="Selected customer does not match reservation customer")
        if not payload.customer_id:
            payload.customer_id = int(linked_reservation.customer_id)

    if not payload.lines:
        raise HTTPException(status_code=400, detail="At least one cart line is required")

    normalized_lines = []
    subtotal = 0.0
    for line in payload.lines:
        qty = int(line.quantity or 0)
        if qty <= 0:
            raise HTTPException(status_code=400, detail="Line quantity must be positive")
        line_type = _normalize_line_type(getattr(line, "line_type", None), line.item_id)
        price = float(line.price or 0)
        line_total = float(qty) * price
        if line_type == "discount":
            subtotal -= abs(line_total)
        else:
            subtotal += line_total
        normalized_lines.append(
            {
                "line": line,
                "line_type": line_type,
                "quantity": qty,
                "price": price,
            }
        )

    subtotal = round(float(subtotal or 0), 2)
    total = round(max(0.0, subtotal - float(payload.discount_amount or 0) + float(payload.tax_amount or 0)), 2)
    allow_freebie = bool(((sales_rules or {}).get("allow_freebie_invoice", False)))
    if total <= 0 and not allow_freebie:
        raise HTTPException(status_code=400, detail="Zero/negative total invoice is not allowed by policy")

    enforce_pos_checkout_policy(
        db,
        user=current_user,
        customer_id=payload.customer_id,
        paid=bool(payload.paid),
        discount_amount=float(payload.discount_amount or 0),
        subtotal=float(subtotal or 0),
        total=float(total or 0),
        lines=payload.lines,
    )

    applied_advances: list[tuple[AdvancePayment, float]] = []
    applied_advance_total = 0.0
    if payload.customer_id:
        remaining_to_cover = as_money(total)
        if payload.applied_advances:
            for line in payload.applied_advances:
                if remaining_to_cover <= 0:
                    break
                advance = (
                    db.query(AdvancePayment)
                    .filter(AdvancePayment.id == int(line.advance_payment_id), AdvancePayment.is_deleted == False)  # noqa: E712
                    .first()
                )
                if not advance:
                    raise HTTPException(status_code=404, detail=f"Advance payment not found: {line.advance_payment_id}")
                if int(advance.customer_id or 0) != int(payload.customer_id or 0):
                    raise HTTPException(status_code=400, detail=f"Advance {advance.advance_number} belongs to another customer")
                if str(advance.status or "").lower() in ADVANCE_NON_APPLICABLE_STATUSES:
                    raise HTTPException(status_code=400, detail=f"Advance {advance.advance_number} is not available")
                if payload.repair_ticket_id and advance.repair_ticket_id not in {None, int(payload.repair_ticket_id)}:
                    raise HTTPException(status_code=400, detail=f"Advance {advance.advance_number} is linked to another repair ticket")
                if payload.reservation_id and advance.reservation_id not in {None, int(payload.reservation_id)}:
                    raise HTTPException(status_code=400, detail=f"Advance {advance.advance_number} is linked to another reservation")

                max_apply = min(calc_advance_remaining(advance), remaining_to_cover)
                requested = as_money(line.amount)
                if requested <= 0:
                    continue
                amount_to_apply = as_money(min(requested, max_apply))
                if amount_to_apply <= 0:
                    continue
                applied_advances.append((advance, amount_to_apply))
                applied_advance_total = as_money(applied_advance_total + amount_to_apply)
                remaining_to_cover = as_money(max(0.0, remaining_to_cover - amount_to_apply))
        elif payload.auto_apply_advances:
            available_rows = available_advances_query(
                db=db,
                customer_id=int(payload.customer_id),
                repair_ticket_id=payload.repair_ticket_id,
                reservation_id=payload.reservation_id,
            )
            for advance in available_rows:
                if remaining_to_cover <= 0:
                    break
                amount_to_apply = as_money(min(calc_advance_remaining(advance), remaining_to_cover))
                if amount_to_apply <= 0:
                    continue
                applied_advances.append((advance, amount_to_apply))
                applied_advance_total = as_money(applied_advance_total + amount_to_apply)
                remaining_to_cover = as_money(max(0.0, remaining_to_cover - amount_to_apply))

    amount_due_after_advances = as_money(max(0.0, total - applied_advance_total))
    cash_amount = as_money(payload.cash_amount)
    card_amount = as_money(payload.card_amount)
    method_key = str(payload.payment_method or "").strip().lower().replace(" ", "_")
    if method_key == "storecredit":
        method_key = "store_credit"

    applied_store_credits: list[tuple[StoreCredit, float]] = []
    applied_store_credit_total = 0.0
    if payload.applied_store_credits or method_key == "store_credit":
        if not payload.customer_id:
            raise HTTPException(status_code=400, detail="Customer is required when applying store credit")
        credit_rows = (
            db.query(StoreCredit)
            .filter(
                StoreCredit.customer_id == int(payload.customer_id),
                StoreCredit.status.in_(["active", "used"]),
                StoreCredit.remaining_amount > 0,
            )
            .order_by(StoreCredit.created_at.asc(), StoreCredit.id.asc())
            .all()
        )
        credit_by_id = {int(row.id): row for row in credit_rows}
        remaining_credit_target = as_money(amount_due_after_advances)
        if payload.applied_store_credits:
            for line in payload.applied_store_credits:
                if remaining_credit_target <= 0:
                    break
                credit = credit_by_id.get(int(line.store_credit_id))
                if not credit:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Store credit not found for customer: {line.store_credit_id}",
                    )
                if credit.expiry_date and credit.expiry_date < utcnow():
                    credit.status = "expired"
                    raise HTTPException(status_code=400, detail=f"Store credit {credit.credit_number} has expired")
                remaining = as_money(credit.remaining_amount)
                requested = as_money(line.amount)
                if requested <= 0 or remaining <= 0:
                    continue
                amount_to_apply = as_money(min(requested, remaining, remaining_credit_target))
                if amount_to_apply <= 0:
                    continue
                applied_store_credits.append((credit, amount_to_apply))
                applied_store_credit_total = as_money(applied_store_credit_total + amount_to_apply)
                remaining_credit_target = as_money(max(0.0, remaining_credit_target - amount_to_apply))
        else:
            for credit in credit_rows:
                if remaining_credit_target <= 0:
                    break
                if credit.expiry_date and credit.expiry_date < utcnow():
                    credit.status = "expired"
                    continue
                remaining = as_money(credit.remaining_amount)
                if remaining <= 0:
                    continue
                amount_to_apply = as_money(min(remaining, remaining_credit_target))
                if amount_to_apply <= 0:
                    continue
                applied_store_credits.append((credit, amount_to_apply))
                applied_store_credit_total = as_money(applied_store_credit_total + amount_to_apply)
                remaining_credit_target = as_money(max(0.0, remaining_credit_target - amount_to_apply))
        if method_key == "store_credit" and applied_store_credit_total <= 0:
            raise HTTPException(status_code=400, detail="No usable store credit found for this customer")

    amount_due_after_store_credits = as_money(max(0.0, amount_due_after_advances - applied_store_credit_total))
    if method_key == "mixed" and not bool((sales_rules or {}).get("allow_split_payments", True)):
        raise HTTPException(status_code=403, detail="Split payments are disabled by policy")
    if method_key == "cash" and bool(payload.paid):
        cash_amount = amount_due_after_store_credits
        card_amount = 0.0
    if method_key == "card" and bool(payload.paid):
        card_amount = amount_due_after_store_credits
        cash_amount = 0.0
    if method_key == "mixed":
        tendered = max(0.0, cash_amount) + max(0.0, card_amount)
    elif method_key == "card":
        tendered = max(0.0, card_amount)
    elif method_key == "bank_transfer":
        tendered = amount_due_after_store_credits if bool(payload.paid) else 0.0
    elif method_key == "store_credit":
        tendered = 0.0
    else:
        tendered = max(0.0, cash_amount)
    if method_key == "store_credit":
        direct_paid_now = 0.0
    else:
        direct_paid_now = amount_due_after_store_credits if bool(payload.paid) else min(amount_due_after_store_credits, tendered)
    amount_paid = as_money(applied_advance_total + applied_store_credit_total + direct_paid_now)
    balance_due = as_money(max(0.0, total - amount_paid))
    if bool(payload.paid) and amount_due_after_store_credits > 0 and direct_paid_now < amount_due_after_store_credits and method_key != "credit":
        raise HTTPException(status_code=400, detail="Paid checkout requires full settlement of due amount")

    invoice_prefix = "INV"
    invoice_type = "product_sale"
    if payload.repair_ticket_id:
        invoice_prefix = "RINV"
        invoice_type = "repair_invoice"
    elif payload.reservation_id:
        invoice_type = "reservation_invoice"

    sale = Sale(
        invoice_no=next_number(db, invoice_prefix),
        invoice_type=invoice_type,
        customer_id=payload.customer_id,
        repair_ticket_id=payload.repair_ticket_id,
        reservation_id=payload.reservation_id,
        payment_method=payload.payment_method,
        cash_amount=cash_amount,
        card_amount=card_amount,
        amount_paid=amount_paid,
        balance_due=balance_due,
        payment_status=_payment_status_from_balance(balance_due),
        invoice_status="finalized",
        advance_applied_total=as_money(applied_advance_total),
        paid=bool(balance_due <= 0),
        subtotal=subtotal,
        discount_amount=payload.discount_amount,
        tax_amount=payload.tax_amount,
        total=total,
        created_by=current_user.id if current_user else None,
        finalized_at=utcnow(),
    )
    db.add(sale)
    db.flush()
    customer = None
    if payload.customer_id:
        customer = db.query(Customer).filter(Customer.id == payload.customer_id).first()

    receipt_lines = []
    sale_item_rows: list[SaleItem] = []
    stock_deducted_qty = 0
    for normalized in normalized_lines:
        line = normalized["line"]
        line_type = normalized["line_type"]
        quantity = int(normalized["quantity"])
        price = float(normalized["price"])

        if line_type in SALE_INVENTORY_LINE_TYPES:
            item = db.query(InventoryItem).filter(InventoryItem.id == line.item_id, InventoryItem.is_deleted == False).first()  # noqa: E712
            if not item:
                raise HTTPException(status_code=404, detail=f"Inventory item not found: {line.item_id}")
            reserved_exclusion_id = None
            if linked_reservation and int(linked_reservation.product_id or 0) == int(item.id):
                reserved_exclusion_id = int(linked_reservation.id)
            reserved_qty = get_reserved_qty_for_item(db, int(item.id), exclude_reservation_id=reserved_exclusion_id)
            available_qty = int(item.quantity or 0) - int(reserved_qty or 0)
            if available_qty < quantity:
                raise HTTPException(status_code=400, detail=f"Insufficient stock for item {line.item_id}")
            serial_row = None
            serial_text = str(line.serial_number or "").strip()
            if bool(item.has_serials):
                if quantity != 1:
                    raise HTTPException(status_code=400, detail=f"Serial-tracked item {line.item_id} must be sold one unit at a time")
                if not serial_text:
                    raise HTTPException(status_code=400, detail=f"Serial/IMEI is required for item {line.item_id}")
                serial_row = (
                    db.query(InventorySerial)
                    .filter(
                        InventorySerial.item_id == item.id,
                        InventorySerial.serial_number == serial_text,
                        InventorySerial.status.in_(["in_stock", "reserved"]),
                    )
                    .first()
                )
                if not serial_row:
                    raise HTTPException(status_code=400, detail=f"Serial/IMEI {serial_text} is not available for item {line.item_id}")
            elif serial_text:
                serial_row = (
                    db.query(InventorySerial)
                    .filter(
                        InventorySerial.item_id == item.id,
                        InventorySerial.serial_number == serial_text,
                        InventorySerial.status.in_(["in_stock", "reserved"]),
                    )
                    .first()
                )
            # Atomic stock deduction to prevent race conditions in concurrent checkouts
            rows_updated = (
                db.query(InventoryItem)
                .filter(
                    InventoryItem.id == item.id,
                    InventoryItem.quantity >= quantity,
                )
                .update(
                    {InventoryItem.quantity: InventoryItem.quantity - quantity},
                    synchronize_session="fetch",
                )
            )
            if rows_updated == 0:
                raise HTTPException(status_code=400, detail=f"Insufficient stock for item {line.item_id} (concurrent update)")
            db.refresh(item)
            resolved_warranty_days = resolve_sale_item_warranty_days(db, item, line.warranty_days)
            sale_item_row = SaleItem(
                sale_id=sale.id,
                item_id=line.item_id,
                line_type=line_type,
                description=line.description or item.name,
                quantity=quantity,
                price=price,
                discount_amount=0,
                line_total=round(quantity * price, 2),
                cost_price=item.cost_price,
                warranty_days=resolved_warranty_days,
                variant_id=None,
                serial_id=serial_row.id if serial_row else None,
                serial_number=serial_text or None,
            )
            db.add(sale_item_row)
            db.flush()
            sale_item_rows.append(sale_item_row)

            if serial_row:
                serial_row.status = "sold"
                serial_row.sale_id = sale.id
            db.add(
                StockMovement(
                    item_id=item.id,
                    user_id=current_user.id if current_user else None,
                    movement_type=("REPAIR_PART_USED" if (sale.repair_ticket_id and line_type == "spare_part") else "SALE_OUT"),
                    quantity=-quantity,
                    reference_type="sale",
                    reference_id=sale.id,
                    note=f"Invoice {_invoice_label(sale)}",
                )
            )
            stock_deducted_qty += quantity
            receipt_lines.append(
                {
                    "item_id": item.id,
                    "item_name": item.name,
                    "item_code": item.sku or item.barcode,
                    "line_type": line_type,
                    "description": line.description or item.name,
                    "qty": quantity,
                    "unit_price": price,
                    "line_total": quantity * price,
                    "warranty_days": resolved_warranty_days,
                    "serial_number": serial_text or None,
                }
            )
            continue

        sale_item_row = SaleItem(
            sale_id=sale.id,
            item_id=None,
            line_type=line_type,
            description=line.description or ("Labor Charge" if line_type == "labor" else "Service Charge"),
            quantity=quantity,
            price=price,
            discount_amount=0,
            line_total=round(quantity * price, 2),
            cost_price=0,
            warranty_days=0,
            variant_id=None,
            serial_id=None,
            serial_number=None,
        )
        db.add(sale_item_row)
        db.flush()
        sale_item_rows.append(sale_item_row)
        receipt_lines.append(
            {
                "item_id": None,
                "item_name": sale_item_row.description,
                "item_code": None,
                "line_type": line_type,
                "description": sale_item_row.description,
                "qty": quantity,
                "unit_price": price,
                "line_total": quantity * price,
                "warranty_days": 0,
                "serial_number": None,
            }
        )

    if sale.repair_ticket_id:
        linked_repair = db.query(RepairTicket).filter(RepairTicket.id == int(sale.repair_ticket_id)).first()
        if linked_repair:
            linked_repair.final_sale_id = sale.id
            linked_repair.invoice_status = "invoiced"
            linked_repair.invoiced_at = sale.created_at
            linked_repair.outstanding_balance = round(max(0.0, float(linked_repair.estimated_cost or 0) - float(amount_paid or 0)), 2)
            linked_repair.payment_status = "paid" if linked_repair.outstanding_balance <= 0 else "unpaid"

    if stock_deducted_qty > 0:
        _log_invoice_event(
            db,
            sale=sale,
            event_type="stock_deducted",
            event_message=f"Inventory deducted qty={stock_deducted_qty}",
            user_id=current_user.id if current_user else None,
        )

    direct_payment_type = "balance_payment" if (applied_advance_total > 0 or applied_store_credit_total > 0) else "normal"
    applied_store_credit_rows = []
    for credit, amount_to_apply in applied_store_credits:
        old_remaining = as_money(credit.remaining_amount)
        credit.remaining_amount = as_money(max(0.0, old_remaining - amount_to_apply))
        credit.status = "used" if credit.remaining_amount <= 0 else "active"
        db.add(
            InvoicePayment(
                payment_number=next_number(db, "PAY"),
                invoice_id=sale.id,
                customer_id=sale.customer_id,
                amount=as_money(amount_to_apply),
                payment_method="store_credit",
                payment_type="store_credit",
                reference_number=credit.credit_number,
                received_by=current_user.id if current_user else None,
                notes=f"Store credit applied ({credit.credit_number})",
            )
        )
        applied_store_credit_rows.append(
            {
                "store_credit_id": int(credit.id),
                "credit_number": credit.credit_number,
                "applied_amount": as_money(amount_to_apply),
                "remaining_amount": as_money(credit.remaining_amount),
            }
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
                        payment_type=direct_payment_type,
                        received_by=current_user.id if current_user else None,
                        notes="POS checkout direct cash payment",
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
                        payment_type=direct_payment_type,
                        reference_number=str(payload.payment_reference or "").strip() or None,
                        received_by=current_user.id if current_user else None,
                        notes="POS checkout direct card payment",
                    )
                )
        else:
            db.add(
                InvoicePayment(
                    payment_number=next_number(db, "PAY"),
                    invoice_id=sale.id,
                    customer_id=sale.customer_id,
                    amount=as_money(direct_paid_now),
                    payment_method=_normalize_payment_method_for_ledger(payload.payment_method),
                    payment_type=direct_payment_type,
                    reference_number=str(payload.payment_reference or "").strip() or None,
                    received_by=current_user.id if current_user else None,
                    notes="POS checkout direct payment",
                )
            )

    applied_advance_rows = []
    for advance, amount_to_apply in applied_advances:
        apply_advance_to_invoice(
            db=db,
            advance=advance,
            invoice_id=sale.id,
            amount=amount_to_apply,
            user_id=current_user.id if current_user else None,
            note=f"Applied in POS checkout ({sale.invoice_no})",
        )
        applied_advance_rows.append(
            {
                "advance_id": advance.id,
                "advance_number": advance.advance_number,
                "applied_amount": as_money(amount_to_apply),
            }
        )
        sync_repair_advance_totals(db, advance.repair_ticket_id)
        sync_reservation_advance_totals(db, advance.reservation_id)

    if linked_reservation:
        linked_reservation.linked_invoice_id = sale.id
        linked_reservation.status = "completed" if balance_due <= 0 else "invoiced"
        linked_reservation.updated_at = sale.created_at
        sync_reservation_advance_totals(db, linked_reservation.id)

    created_warranties = create_sale_warranty_records(
        db=db,
        sale=sale,
        sale_items=sale_item_rows,
        customer=customer,
        created_by_id=current_user.id if current_user else None,
    )
    warranty_by_invoice_item = {int(w.invoice_item_id): int(w.id) for w in created_warranties if w.invoice_item_id}
    for sale_item_row in sale_item_rows:
        if int(sale_item_row.id) in warranty_by_invoice_item:
            sale_item_row.warranty_record_id = warranty_by_invoice_item[int(sale_item_row.id)]

    _log_invoice_event(
        db,
        sale=sale,
        event_type="invoice_created",
        event_message=f"Invoice {_invoice_label(sale)} created ({invoice_type})",
        user_id=current_user.id if current_user else None,
    )
    if direct_paid_now > 0:
        _log_invoice_event(
            db,
            sale=sale,
            event_type="payment_received",
            event_message=f"Direct payment received: {as_money(direct_paid_now):.2f}",
            user_id=current_user.id if current_user else None,
        )
    if applied_advance_total > 0:
        _log_invoice_event(
            db,
            sale=sale,
            event_type="advance_applied",
            event_message=f"Advance applied: {as_money(applied_advance_total):.2f}",
            user_id=current_user.id if current_user else None,
        )
    if applied_store_credit_total > 0:
        _log_invoice_event(
            db,
            sale=sale,
            event_type="store_credit_applied",
            event_message=f"Store credit applied: {as_money(applied_store_credit_total):.2f}",
            user_id=current_user.id if current_user else None,
        )
    for warranty_row in created_warranties:
        _log_invoice_event(
            db,
            sale=sale,
            event_type="warranty_created",
            event_message=f"Warranty {warranty_row.warranty_code} created",
            user_id=current_user.id if current_user else None,
        )
    record_ledger_entry(
        db,
        module="pos",
        entry_type="sale",
        direction="debit",
        amount=as_money(total),
        account_code="sales_revenue",
        reference_type="invoice",
        reference_id=sale.id,
        reference_number=_invoice_label(sale),
        source_table="sales",
        source_id=sale.id,
        counterparty_type="customer",
        counterparty_id=sale.customer_id,
        counterparty_name=customer.name if customer else "Walk-in Customer",
        description=f"Sale invoice {_invoice_label(sale)}",
        metadata={
            "invoice_type": sale.invoice_type,
            "payment_method": sale.payment_method,
            "amount_paid": amount_paid,
            "balance_due": balance_due,
            "advance_applied_total": applied_advance_total,
            "store_credit_applied_total": applied_store_credit_total,
        },
        user=current_user,
        entry_date=sale.created_at,
    )

    db.commit()
    logger.info(json.dumps({
        "event": "sale_checkout",
        "request_id": getattr(request.state, "request_id", None),
        "sale_id": sale.id,
        "total": total,
        "line_count": len(payload.lines),
        "payment_method": sale.payment_method,
    }))
    return {
        "sale_id": sale.id,
        "id": sale.id,
        "invoice_no": _invoice_label(sale),
        "repair_ticket_id": sale.repair_ticket_id,
        "repair_ticket_no": linked_repair.ticket_no if linked_repair else None,
        "repair_device_model": linked_repair.device_model if linked_repair else None,
        "repair_device_imei": linked_repair.imei if linked_repair else None,
        "reservation_id": linked_reservation.id if linked_reservation else None,
        "reservation_number": linked_reservation.reservation_number if linked_reservation else None,
        "subtotal": subtotal,
        "discount_amount": payload.discount_amount,
        "tax_amount": payload.tax_amount,
        "total": total,
        "applied_advance_total": as_money(applied_advance_total),
        "applied_advances": applied_advance_rows,
        "applied_store_credit_total": as_money(applied_store_credit_total),
        "applied_store_credits": applied_store_credit_rows,
        "direct_paid_now": as_money(direct_paid_now),
        "amount_paid": amount_paid,
        "balance_due": balance_due,
        "payment_status": sale.payment_status,
        "payment_method": sale.payment_method,
        "cash_amount": sale.cash_amount,
        "card_amount": sale.card_amount,
        "paid": sale.paid,
        "created_at": sale.created_at.isoformat() if sale.created_at else None,
        "lines": receipt_lines,
        "warranty_records": [
            {
                "warranty_id": row.warranty_code,
                "item_name": row.product_or_service_name,
                "warranty_type": row.warranty_type,
                "warranty_days": row.warranty_days,
                "start_date": row.start_date.isoformat() if row.start_date else None,
                "end_date": row.end_date.isoformat() if row.end_date else None,
                "status": warranty_status_label(row.status),
                "status_key": row.status,
            }
            for row in created_warranties
        ],
        "customer_name": customer.name if customer else "Walk-in",
        "customer_phone": customer.phone if customer else None,
        "customer_email": customer.email if customer else None,
        "customer_address": customer.address if customer else None,
        "cashier_name": (
            (getattr(current_user, "full_name", None) or getattr(current_user, "username", None))
            if current_user
            else None
        ),
    }


@router.post('/checkout/repair', dependencies=[Depends(require_permission("pos.repair_billing"))])
def checkout_repair(
    payload: SaleIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if not payload.repair_ticket_id:
        raise HTTPException(status_code=400, detail="repair_ticket_id is required")
    return checkout(payload, request, db, current_user)


@router.post('/checkout/reservation', dependencies=[Depends(require_permission("pos.reservation_billing"))])
def checkout_reservation(
    payload: SaleIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if not payload.reservation_id:
        raise HTTPException(status_code=400, detail="reservation_id is required")
    return checkout(payload, request, db, current_user)


@router.post('/return', dependencies=[Depends(require_permission("pos.refund"))])
def return_sale(payload: SaleReturnIn, request: Request, db: Session = Depends(get_db), _=Depends(get_current_user)):
    original = db.query(Sale).filter(Sale.id == payload.sale_id).first()
    if not original:
        raise HTTPException(status_code=404, detail="Original sale not found")
    assert_accounting_period_open(db, when=original.created_at or utcnow(), action="refund sale")
    subtotal = sum(l.quantity * l.price for l in payload.lines)
    refund_amount = abs(float(subtotal or 0))
    if void_refund_approval_required(db, action="refund", amount=refund_amount):
        consume_approval_request(
            db,
            request_code=payload.approval_request_code,
            module="pos",
            action="refund",
            target_type="Sale",
            target_id=original.id,
            user=_,
            permission="pos.refund",
            expected_payload={"amount": round(refund_amount, 2)},
            reason=payload.note or "POS quick refund",
        )
    else:
        enforce_void_refund_policy(
            db,
            user=_,
            action="refund",
            amount=refund_amount,
        )
    return_sale_row = Sale(
        invoice_no=next_number(db, "INV"),
        invoice_type="product_sale",
        customer_id=original.customer_id,
        repair_ticket_id=original.repair_ticket_id,
        reservation_id=original.reservation_id,
        payment_method=original.payment_method,
        paid=True,
        subtotal=-subtotal,
        discount_amount=0,
        tax_amount=0,
        total=-subtotal,
        advance_applied_total=0,
        amount_paid=-subtotal,
        balance_due=0,
        payment_status="paid",
        invoice_status="refunded",
        is_return=True,
        original_sale_id=original.id,
        created_by=_.id if _ else None,
        finalized_at=utcnow(),
    )
    db.add(return_sale_row)
    db.flush()
    processed_returns = []
    for line in payload.lines:
        item = db.query(InventoryItem).filter(InventoryItem.id == line.item_id).first()
        if not item:
            raise HTTPException(status_code=404, detail=f"Item {line.item_id} not found")

        original_sale_items = (
            db.query(SaleItem)
            .filter(
                SaleItem.sale_id == original.id,
                SaleItem.item_id == line.item_id,
                SaleItem.quantity > 0,
            )
            .order_by(SaleItem.id.asc())
            .all()
        )
        selected_sale_item = None
        needed_qty = int(line.quantity or 0)
        for sale_item in original_sale_items:
            sold_qty = max(0, int(sale_item.quantity or 0))
            already_returned_qty = get_returned_qty_for_sale_item(db, sale_item.id)
            remaining_qty = sold_qty - already_returned_qty
            if remaining_qty >= needed_qty:
                selected_sale_item = sale_item
                break
        if not selected_sale_item:
            raise HTTPException(
                status_code=400,
                detail=f"Duplicate return prevented. Returnable quantity exceeded for item {line.item_id}",
            )

        record = create_return_record_entry(
            db=db,
            original_sale_id=original.id,
            original_sale_item_id=selected_sale_item.id,
            quantity=needed_qty,
            return_type="Refund",
            return_reason="Customer changed mind",
            item_condition="Reusable",
            inspection_note=payload.note or "POS quick refund flow",
            staff_user_id=_.id if _ else None,
        )
        process_return_record_entry(
            db=db,
            record=record,
            decision_status=RETURN_STATUS_REFUNDED,
            actor_user_id=_.id if _ else None,
            refund_amount=round(abs(float(line.price or 0)) * needed_qty, 2),
            refund_method=original.payment_method if original.payment_method in {"Cash", "Card", "Bank Transfer"} else "Cash",
            process_note=payload.note or f"Quick POS refund for {_invoice_label(original)}",
        )
        processed_returns.append({
            "return_id": record.return_code,
            "product_name": record.product_name,
            "quantity": record.quantity,
            "refund_amount": record.refund_amount,
            "refund_method": record.refund_method,
            "status": record.decision_status,
        })
        db.add(
            StockMovement(
                item_id=line.item_id,
                user_id=_.id if _ else None,
                movement_type="RETURN_RESTOCK",
                quantity=int(line.quantity or 0),
                reference_type="sale_return",
                reference_id=return_sale_row.id,
                note=payload.note or f"POS quick refund for {_invoice_label(original)}",
            )
        )
        db.add(
            SaleItem(
                sale_id=return_sale_row.id,
                item_id=line.item_id,
                line_type="product",
                description=f"Return for {_invoice_label(original)}",
                quantity=-line.quantity,
                price=line.price,
                discount_amount=0,
                line_total=round(-abs(float(line.quantity or 0) * float(line.price or 0)), 2),
                cost_price=float(item.cost_price or 0),
                warranty_days=0,
            )
        )

    refunded_total = (
        db.query(ReturnRecord)
        .filter(
            ReturnRecord.original_sale_id == original.id,
            ReturnRecord.decision_status == RETURN_STATUS_REFUNDED,
        )
        .all()
    )
    refund_amount_total = round(sum(float(row.refund_amount or 0) for row in refunded_total), 2)
    if refund_amount_total <= 0:
        pass
    elif refund_amount_total + 0.01 >= float(original.total or 0):
        original.invoice_status = "refunded"
    else:
        original.invoice_status = "partially_refunded"

    _log_invoice_event(
        db,
        sale=original,
        event_type="refund_issued",
        event_message=f"Refund issued via {_invoice_label(return_sale_row)} total={abs(float(subtotal or 0)):.2f}",
        user_id=_.id if _ else None,
    )
    _log_invoice_event(
        db,
        sale=return_sale_row,
        event_type="invoice_created",
        event_message=f"Return invoice {_invoice_label(return_sale_row)} created",
        user_id=_.id if _ else None,
    )
    record_domain_audit(
        db,
        module="pos",
        action="refund_issued",
        target_type="Sale",
        target_id=original.id,
        user=_,
        old_value={"invoice_status": "finalized"},
        new_value={
            "invoice_status": original.invoice_status,
            "refund_amount": refund_amount_total,
            "return_sale_id": return_sale_row.id,
        },
        reason=payload.note or "POS quick refund",
        permission="pos.refund",
    )
    record_ledger_entry(
        db,
        module="pos",
        entry_type="refund",
        direction="credit",
        amount=abs(float(subtotal or 0)),
        account_code="sales_refunds",
        reference_type="invoice",
        reference_id=return_sale_row.id,
        reference_number=_invoice_label(return_sale_row),
        source_table="sales",
        source_id=return_sale_row.id,
        counterparty_type="customer",
        counterparty_id=original.customer_id,
        description=f"Refund against {_invoice_label(original)} via {_invoice_label(return_sale_row)}",
        metadata={"original_sale_id": original.id, "processed_returns": processed_returns},
        user=_,
        entry_date=return_sale_row.created_at,
    )
    db.commit()
    logger.info(json.dumps({
        "event": "sale_return",
        "request_id": getattr(request.state, "request_id", None),
        "original_sale_id": original.id,
        "return_sale_id": return_sale_row.id,
        "line_count": len(payload.lines),
    }))
    return {
        "ok": True,
        "return_sale_id": return_sale_row.id,
        "invoice_no": _invoice_label(return_sale_row),
        "return_records": processed_returns,
    }

@router.post('/sales/{sale_id}/void', dependencies=[Depends(require_permission("pos.void_invoice"))])
def void_sale(
    sale_id: int,
    reason: str | None = Query(default=None),
    payload: SaleVoidIn | None = Body(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from app.services.activity_service import log_activity
    sale = db.query(Sale).filter(Sale.id == sale_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    if sale.is_voided:
        raise HTTPException(status_code=400, detail="Sale is already voided")
    assert_accounting_period_open(db, when=sale.created_at or utcnow(), action="void sale")
    resolved_reason = str((payload.reason if payload else reason) or "").strip()
    if len(resolved_reason) < 5:
        raise HTTPException(status_code=400, detail="A descriptive void reason (min 5 chars) is required")
    void_amount = abs(float(sale.total or 0))
    if void_refund_approval_required(db, action="void", amount=void_amount):
        consume_approval_request(
            db,
            request_code=(payload.approval_request_code if payload else None),
            module="pos",
            action="void",
            target_type="Sale",
            target_id=sale.id,
            user=current_user,
            permission="pos.void_invoice",
            expected_payload={"amount": round(void_amount, 2)},
            reason=resolved_reason,
        )
    else:
        enforce_void_refund_policy(
            db,
            user=current_user,
            action="void",
            amount=void_amount,
        )
    
    # Reverse inventory
    items = db.query(SaleItem).filter(SaleItem.sale_id == sale_id).all()
    for si in items:
        if si.item_id is None:
            continue
        inv = db.query(InventoryItem).filter(InventoryItem.id == si.item_id).first()
        if inv:
            inv.quantity += si.quantity
            db.add(StockMovement(
                item_id=inv.id,
                user_id=current_user.id if current_user else None,
                movement_type="VOID_REVERSAL",
                quantity=si.quantity,
                reference_type="sale_void",
                reference_id=sale.id,
                note=f"Voided {_invoice_label(sale)}"
            ))
    
    sale.is_voided = True
    sale.invoice_status = "voided"
    sale.void_reason = resolved_reason
    sale.voided_at = utcnow()
    sale.voided_by = current_user.id if current_user else None
    _log_invoice_event(
        db,
        sale=sale,
        event_type="invoice_voided",
        event_message=f"Invoice {_invoice_label(sale)} voided. Reason: {resolved_reason}",
        user_id=current_user.id if current_user else None,
    )
    
    log_activity(
        db, current_user.id, "Void", "Sale", sale.id,
        f"Voided Invoice {_invoice_label(sale)}. Reason: {resolved_reason}",
        is_reversible=False
    )
    record_domain_audit(
        db,
        module="pos",
        action="invoice_voided",
        target_type="Sale",
        target_id=sale.id,
        user=current_user,
        old_value={"is_voided": False, "invoice_status": "finalized"},
        new_value={"is_voided": True, "invoice_status": "voided", "void_reason": resolved_reason},
        reason=resolved_reason,
        permission="pos.void_invoice",
    )
    
    db.commit()
    return {"ok": True}

@router.post('/quick-add-item', dependencies=[Depends(require_permission('inventory.manage'))])
def quick_add_item(payload: QuickAddItemIn, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if payload.action_type not in ('inventory', 'draft'):
        raise HTTPException(status_code=400, detail='Invalid action_type for saving.')
    
    is_draft = payload.action_type == 'draft'
    
    sku = payload.sku
    if not sku:
        sku = f'MANUAL-{int(datetime.utcnow().timestamp())}'
    
    item = InventoryItem(
        name=payload.name,
        sale_price=payload.sale_price,
        cost_price=payload.cost_price,
        quantity=payload.quantity,
        category=payload.category,
        sku=sku,
        description=payload.description,
        is_manual_creation=True,
        is_draft=is_draft,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _inventory_card_payload(db, item)

