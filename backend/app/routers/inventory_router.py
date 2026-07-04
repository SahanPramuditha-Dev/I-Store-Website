from datetime import datetime, timedelta
import re
from pathlib import Path
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Response
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import OperationalError
from app.database import get_db
from app.auth import get_current_user, require_permission
from sqlalchemy import func, or_
from app.models import (
    ActivityLog,
    InventoryItem,
    Supplier,
    StockMovement,
    InventorySerial,
    ProductCategory,
    Brand,
    GoodsReceivedNote,
    GoodsReceivedNoteItem,
    PriceAdjustmentLog,
    ProductDiscount,
    StockTakeSession,
    StockTakeLine,
    SupplierLedgerEntry,
    PurchaseOrder,
    PurchaseOrderItem,
    RepairPartUsage,
    Return as ReturnCase,
    ReturnItem,
    Sale,
    SaleItem,
    Customer,
    WarrantyRecord,
    ReturnRecord,
)
from app.schemas import (
    InventoryIn,
    SupplierIn,
    StockAdjustIn,
    CategoryIn,
    BrandIn,
    GrnIn,
    GrnCancelIn,
    PriceAdjustmentIn,
    DiscountIn,
    StockTakeIn,
    StockTakeLineIn,
    SupplierPaymentIn,
    SupplierNoteIn,
)
from app.services.numbering_service import next_number
from app.services.accounting_ledger_service import record_ledger_entry
from app.services.approval_service import consume_approval_request
from app.services.domain_audit_service import assert_accounting_period_open, record_domain_audit
from app.services.settings_policy_service import enforce_stock_adjustment_policy, stock_adjustment_approval_required
from app.utils.time import utcnow

router = APIRouter(prefix="/inventory", tags=["inventory"])

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads" / "inventory"
if os.getenv("VERCEL"):
    UPLOAD_DIR = Path("/tmp/uploads/inventory")

try:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    pass


def _normalize_barcode(value: str | None) -> str:
    raw = (value or "").strip().upper()
    return re.sub(r"[^A-Z0-9\-._:/]", "", raw)


def _validated_barcode(value: str | None, fallback_seed: str | None = None) -> str:
    barcode = _normalize_barcode(value) or _normalize_barcode(fallback_seed)
    if not barcode:
        raise HTTPException(status_code=400, detail="Barcode is required")
    if not re.match(r"^[A-Z0-9\-._:/]{3,64}$", barcode):
        raise HTTPException(status_code=400, detail="Invalid barcode format")
    return barcode


def _iso(value):
    return value.isoformat() if value else None


def _grn_line_received_qty(line: GoodsReceivedNoteItem) -> int:
    return max(0, int(line.quantity or 0) - int(line.damaged_qty or 0))


def _grn_total(lines: list[GoodsReceivedNoteItem] | None) -> float:
    return round(
        sum(_grn_line_received_qty(line) * float(line.unit_cost or 0) for line in (lines or [])),
        2,
    )


def _ledger_signed(entry: SupplierLedgerEntry) -> float:
    direction = str(entry.direction or "").lower()
    amount = float(entry.amount or 0)
    if direction == "debit":
        return amount
    if direction == "credit":
        return -amount
    return 0.0


def _margin_pct(sale_price: float | int | None, cost_price: float | int | None) -> float | None:
    sale = float(sale_price or 0)
    cost = float(cost_price or 0)
    if sale <= 0:
        return None
    return round(((sale - cost) / sale) * 100, 2)


@router.post("/upload-image", dependencies=[Depends(require_permission("inventory.edit_product"))])
def upload_inventory_image(file: UploadFile = File(...), _=Depends(get_current_user)):
    allowed = {".png", ".jpg", ".jpeg", ".webp"}
    ext = Path(file.filename or "").suffix.lower()
    if ext not in allowed:
        raise HTTPException(status_code=400, detail="Only PNG/JPG/JPEG/WEBP files are allowed")

    filename = f"{uuid4().hex}{ext}"
    target = UPLOAD_DIR / filename
    data = file.file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Max image size is 5MB")
    target.write_bytes(data)
    return {"url": f"/uploads/inventory/{filename}"}

@router.get('', dependencies=[Depends(require_permission("inventory.view"))])
def list_inventory(
    response: Response,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=500, ge=1, le=5000),
    offset: int | None = Query(default=None, ge=0),
    limit: int | None = Query(default=None, ge=1, le=5000),
    search: str | None = Query(default=None),
    category: str | None = Query(default=None),
    supplier_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(InventoryItem).filter(InventoryItem.is_deleted == False)  # noqa: E712
    if search:
        like = f"%{str(search).strip()}%"
        query = query.filter(
            InventoryItem.name.ilike(like)
            | InventoryItem.sku.ilike(like)
            | InventoryItem.barcode.ilike(like)
            | InventoryItem.brand.ilike(like)
            | InventoryItem.model.ilike(like)
        )
    if category:
        query = query.filter(InventoryItem.category == category)
    if supplier_id:
        query = query.filter(InventoryItem.supplier_id == int(supplier_id))
    total = query.count()
    response.headers["X-Total-Count"] = str(total)
    resolved_offset = int(offset) if offset is not None else (page - 1) * page_size
    resolved_limit = int(limit) if limit is not None else page_size
    rows = (
        query.order_by(InventoryItem.updated_at.desc(), InventoryItem.id.desc())
        .offset(resolved_offset)
        .limit(resolved_limit)
        .all()
    )
    return rows

@router.post('', dependencies=[Depends(require_permission("inventory.create_product"))])
def create_inventory(payload: InventoryIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    data = payload.model_dump()
    data["barcode"] = _validated_barcode(payload.barcode, payload.sku)
    duplicate = db.query(InventoryItem).filter(InventoryItem.barcode == data["barcode"]).first()
    if duplicate:
        raise HTTPException(status_code=400, detail=f"Duplicate barcode detected: {data['barcode']}")
    item = InventoryItem(**data)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item

@router.put('/{item_id}', dependencies=[Depends(require_permission("inventory.edit_product"))])
def update_inventory(item_id: int, payload: InventoryIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    item = db.query(InventoryItem).filter(InventoryItem.id == item_id, InventoryItem.is_deleted == False).first()  # noqa: E712
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    update_data = payload.model_dump()
    update_data["barcode"] = _validated_barcode(payload.barcode, payload.sku)
    duplicate = (
        db.query(InventoryItem)
        .filter(InventoryItem.barcode == update_data["barcode"], InventoryItem.id != item_id)
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=400, detail=f"Duplicate barcode detected: {update_data['barcode']}")
    for k, v in update_data.items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item

@router.delete('/{item_id}', dependencies=[Depends(require_permission("inventory.delete_product"))])
def delete_inventory(
    item_id: int,
    approval_request_code: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    item = db.query(InventoryItem).filter(InventoryItem.id == item_id, InventoryItem.is_deleted == False).first()  # noqa: E712
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    has_financial_history = (
        db.query(SaleItem).filter(SaleItem.item_id == item_id).first() is not None
        or db.query(RepairPartUsage).filter(RepairPartUsage.item_id == item_id).first() is not None
    )
    if has_financial_history:
        raise HTTPException(
            status_code=400,
            detail="Item has sales/repair history and cannot be deleted. Archive it instead.",
        )
    consume_approval_request(
        db,
        request_code=approval_request_code,
        module="inventory",
        action="archive_product",
        target_type="InventoryItem",
        target_id=item.id,
        user=current_user,
        permission="inventory.delete_product",
        expected_payload={"sku": item.sku},
        reason="Archive inventory item",
    )
    item.is_deleted = True
    item.deleted_at = utcnow()
    item.deleted_by = current_user.id if current_user else None
    item.delete_reason = "Deleted from inventory module"
    db.commit()
    return {"ok": True}

@router.get('/suppliers', dependencies=[Depends(require_permission("suppliers.view"))])
def suppliers(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Supplier).filter(Supplier.is_deleted == False).all()  # noqa: E712

@router.post('/suppliers', dependencies=[Depends(require_permission("suppliers.create"))])
def create_supplier(payload: SupplierIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    s = Supplier(**payload.model_dump())
    db.add(s)
    db.commit()
    db.refresh(s)
    return s

@router.put('/suppliers/{supplier_id}', dependencies=[Depends(require_permission("suppliers.edit"))])
def update_supplier(supplier_id: int, payload: SupplierIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    s = db.query(Supplier).filter(Supplier.id == supplier_id, Supplier.is_deleted == False).first()  # noqa: E712
    if not s:
        raise HTTPException(status_code=404, detail="Supplier not found")
    s.name = payload.name
    s.contact = payload.contact
    s.email = payload.email
    s.address = payload.address
    s.notes = payload.notes
    s.payment_terms_days = payload.payment_terms_days
    s.opening_balance = payload.opening_balance
    db.commit()
    db.refresh(s)
    return s

@router.delete('/suppliers/{supplier_id}', dependencies=[Depends(require_permission("suppliers.delete"))])
def delete_supplier(
    supplier_id: int,
    approval_request_code: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    s = db.query(Supplier).filter(Supplier.id == supplier_id, Supplier.is_deleted == False).first()  # noqa: E712
    if not s:
        raise HTTPException(status_code=404, detail="Supplier not found")
    has_financial_history = (
        db.query(PurchaseOrder).filter(PurchaseOrder.supplier_id == supplier_id).first() is not None
        or db.query(GoodsReceivedNote).filter(GoodsReceivedNote.supplier_id == supplier_id).first() is not None
        or db.query(SupplierLedgerEntry).filter(SupplierLedgerEntry.supplier_id == supplier_id).first() is not None
    )
    if has_financial_history:
        raise HTTPException(
            status_code=400,
            detail="Supplier has purchase/ledger history and cannot be deleted. Archive it instead.",
        )
    consume_approval_request(
        db,
        request_code=approval_request_code,
        module="suppliers",
        action="archive",
        target_type="Supplier",
        target_id=s.id,
        user=current_user,
        permission="suppliers.delete",
        expected_payload={"name": s.name},
        reason="Archive supplier",
    )
    s.is_deleted = True
    s.deleted_at = utcnow()
    s.deleted_by = current_user.id if current_user else None
    s.delete_reason = "Deleted from inventory module"
    db.commit()
    return {"ok": True}


@router.get('/suppliers/{supplier_id}/account', dependencies=[Depends(require_permission("suppliers.view_ledger"))])
def supplier_account(supplier_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    ledger_rows = (
        db.query(SupplierLedgerEntry)
        .options(joinedload(SupplierLedgerEntry.created_by))
        .filter(SupplierLedgerEntry.supplier_id == supplier_id)
        .order_by(SupplierLedgerEntry.created_at.desc())
        .limit(400)
        .all()
    )
    po_rows = (
        db.query(PurchaseOrder)
        .options(joinedload(PurchaseOrder.items))
        .filter(PurchaseOrder.supplier_id == supplier_id)
        .order_by(PurchaseOrder.created_at.desc())
        .limit(250)
        .all()
    )
    grn_rows = (
        db.query(GoodsReceivedNote)
        .options(joinedload(GoodsReceivedNote.lines))
        .filter(GoodsReceivedNote.supplier_id == supplier_id)
        .order_by(GoodsReceivedNote.created_at.desc())
        .limit(250)
        .all()
    )

    total_debits = sum(float(r.amount or 0) for r in ledger_rows if str(r.direction or "").lower() == "debit")
    total_credits = sum(float(r.amount or 0) for r in ledger_rows if str(r.direction or "").lower() == "credit")
    ledger_grn_refs = {
        int(r.reference_id)
        for r in ledger_rows
        if str(r.direction or "").lower() == "debit" and str(r.reference_type or "").lower() == "grn" and r.reference_id
    }
    imputed_grn_debits = 0.0
    for row in grn_rows:
        if int(row.id or 0) in ledger_grn_refs:
            continue
        row_total = sum(max(0, int(line.quantity or 0) - int(line.damaged_qty or 0)) * float(line.unit_cost or 0) for line in (row.lines or []))
        imputed_grn_debits += float(row_total or 0)
    effective_debits = total_debits + imputed_grn_debits
    opening_balance = float(supplier.opening_balance or 0)
    outstanding_balance = opening_balance + effective_debits - total_credits
    total_po_value = sum(float(r.total_cost or 0) for r in po_rows)
    total_received_po_value = sum(float(r.total_cost or 0) for r in po_rows if str(r.status or "").lower() == "received")

    return {
        "supplier": {
            "id": supplier.id,
            "name": supplier.name,
            "contact": supplier.contact,
            "email": supplier.email,
            "address": supplier.address,
            "notes": supplier.notes,
            "payment_terms_days": int(supplier.payment_terms_days or 0),
            "opening_balance": opening_balance,
        },
        "summary": {
            "opening_balance": opening_balance,
            "total_debits": round(effective_debits, 2),
            "ledger_debits_only": round(total_debits, 2),
            "imputed_grn_debits": round(imputed_grn_debits, 2),
            "total_credits": round(total_credits, 2),
            "outstanding_balance": round(outstanding_balance, 2),
            "po_count": len(po_rows),
            "grn_count": len(grn_rows),
            "po_total_value": round(total_po_value, 2),
            "received_po_total_value": round(total_received_po_value, 2),
        },
        "purchase_orders": [
            {
                "id": row.id,
                "po_number": row.po_number,
                "status": row.status,
                "total_cost": float(row.total_cost or 0),
                "created_at": _iso(row.created_at),
                "received_at": _iso(row.received_at),
                "line_count": len(row.items or []),
            }
            for row in po_rows
        ],
        "grns": [
            {
                "id": row.id,
                "grn_no": row.grn_no,
                "po_id": row.po_id,
                "invoice_no": row.invoice_no,
                "note": row.note,
                "created_at": _iso(row.created_at),
                "line_count": len(row.lines or []),
                "grn_total": round(
                    sum(max(0, int(line.quantity or 0) - int(line.damaged_qty or 0)) * float(line.unit_cost or 0) for line in (row.lines or [])),
                    2,
                ),
            }
            for row in grn_rows
        ],
        "ledger_entries": [
            {
                "id": row.id,
                "entry_type": row.entry_type,
                "direction": row.direction,
                "amount": float(row.amount or 0),
                "signed_amount": round(_ledger_signed(row), 2),
                "reference_type": row.reference_type,
                "reference_id": row.reference_id,
                "note": row.note,
                "created_at": _iso(row.created_at),
                "created_by_user_id": row.created_by_user_id,
                "created_by_name": row.created_by.full_name if row.created_by else None,
            }
            for row in ledger_rows
        ],
    }


@router.post('/suppliers/{supplier_id}/payments', dependencies=[Depends(require_permission("suppliers.view_ledger"))])
def supplier_payment(
    supplier_id: int,
    payload: SupplierPaymentIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    amount = float(payload.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero")
    row = SupplierLedgerEntry(
        supplier_id=supplier_id,
        entry_type="payment",
        direction="credit",
        amount=amount,
        reference_type="manual_payment",
        note=(payload.note or "").strip() or "Supplier payment recorded",
        created_by_user_id=current_user.id if current_user else None,
    )
    db.add(row)
    db.flush()
    record_ledger_entry(
        db,
        module="suppliers",
        entry_type="supplier_payment",
        direction="credit",
        amount=amount,
        account_code="supplier_payable",
        reference_type="supplier_payment",
        reference_id=row.id,
        reference_number=f"SUPPAY-{row.id}",
        source_table="supplier_ledger_entries",
        source_id=row.id,
        counterparty_type="supplier",
        counterparty_id=supplier_id,
        counterparty_name=supplier.name,
        description=f"Supplier payment recorded for {supplier.name}",
        metadata={"payment_note": row.note},
        user=current_user,
    )
    db.commit()
    db.refresh(row)
    return {
        "ok": True,
        "entry": {
            "id": row.id,
            "entry_type": row.entry_type,
            "direction": row.direction,
            "amount": float(row.amount or 0),
            "reference_type": row.reference_type,
            "reference_id": row.reference_id,
            "note": row.note,
            "created_at": _iso(row.created_at),
        },
    }


@router.post('/suppliers/{supplier_id}/notes', dependencies=[Depends(require_permission("suppliers.edit"))])
def supplier_note(
    supplier_id: int,
    payload: SupplierNoteIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    note = (payload.note or "").strip()
    if len(note) < 2:
        raise HTTPException(status_code=400, detail="Note is too short")
    row = SupplierLedgerEntry(
        supplier_id=supplier_id,
        entry_type="note",
        direction="memo",
        amount=0,
        reference_type="supplier_note",
        note=note,
        created_by_user_id=current_user.id if current_user else None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "ok": True,
        "entry": {
            "id": row.id,
            "entry_type": row.entry_type,
            "direction": row.direction,
            "amount": float(row.amount or 0),
            "note": row.note,
            "created_at": _iso(row.created_at),
        },
    }

@router.post('/adjust', dependencies=[Depends(require_permission("inventory.adjust_stock"))])
def adjust_stock(payload: StockAdjustIn, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    from app.services.activity_service import log_activity
    item = db.query(InventoryItem).filter(InventoryItem.id == payload.item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    if not payload.note or len(payload.note.strip()) < 5:
        raise HTTPException(status_code=400, detail="A descriptive reason (min 5 chars) is mandatory for stock adjustments")

    old_qty = item.quantity
    new_qty = old_qty + payload.quantity_change
    
    if new_qty < 0:
        raise HTTPException(status_code=400, detail="Stock level cannot be negative")
    if stock_adjustment_approval_required(
        db,
        quantity_change=int(payload.quantity_change or 0),
        unit_cost=float(item.cost_price or 0),
    ):
        consume_approval_request(
            db,
            request_code=payload.approval_request_code,
            module="inventory",
            action="stock_adjustment",
            target_type="InventoryItem",
            target_id=item.id,
            user=current_user,
            permission="inventory.adjust_stock",
            expected_payload={"quantity_change": int(payload.quantity_change or 0)},
            reason=payload.note,
        )
    else:
        enforce_stock_adjustment_policy(
            db,
            user=current_user,
            quantity_change=int(payload.quantity_change or 0),
            unit_cost=float(item.cost_price or 0),
        )
    assert_accounting_period_open(db, when=utcnow(), action="adjust stock")

    item.quantity = new_qty
    db.add(StockMovement(
        item_id=item.id,
        user_id=current_user.id if current_user else None,
        movement_type="ADJUSTMENT",
        quantity=payload.quantity_change,
        note=payload.note
    ))
    
    log_activity(
        db, current_user.id, "Adjustment", "InventoryItem", item.id,
        f"Stock adjusted by {payload.quantity_change}. Reason: {payload.note}",
        {"quantity": old_qty}, {"quantity": new_qty},
        is_reversible=True
    )
    record_domain_audit(
        db,
        module="inventory",
        action="stock_adjusted",
        target_type="InventoryItem",
        target_id=item.id,
        user=current_user,
        old_value={"quantity": old_qty},
        new_value={"quantity": new_qty, "quantity_change": payload.quantity_change},
        reason=payload.note,
        permission="inventory.adjust_stock",
    )
    record_ledger_entry(
        db,
        module="inventory",
        entry_type="stock_adjustment",
        direction="debit" if int(payload.quantity_change or 0) >= 0 else "credit",
        amount=round(abs(int(payload.quantity_change or 0)) * float(item.cost_price or 0), 2),
        account_code="inventory_value",
        reference_type="stock_adjustment",
        reference_id=item.id,
        reference_number=item.sku,
        source_table="inventory_items",
        source_id=item.id,
        description=f"Stock adjustment for {item.name}",
        metadata={
            "old_quantity": old_qty,
            "new_quantity": new_qty,
            "quantity_change": payload.quantity_change,
            "reason": payload.note,
        },
        user=current_user,
    )
    
    db.commit()
    return {"ok": True, "new_quantity": item.quantity}

@router.get('/movements', dependencies=[Depends(require_permission("inventory.view"))])
def movements(
    response: Response,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=200, ge=1, le=2000),
    offset: int | None = Query(default=None, ge=0),
    limit: int | None = Query(default=None, ge=1, le=2000),
    item_id: int | None = Query(default=None),
    movement_type: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(StockMovement)
    if item_id:
        query = query.filter(StockMovement.item_id == int(item_id))
    if movement_type:
        query = query.filter(StockMovement.movement_type == str(movement_type).strip())
    if date_from:
        try:
            query = query.filter(StockMovement.created_at >= datetime.fromisoformat(str(date_from)))
        except Exception:
            pass
    if date_to:
        try:
            query = query.filter(StockMovement.created_at <= datetime.fromisoformat(str(date_to)))
        except Exception:
            pass
    total = query.count()
    response.headers["X-Total-Count"] = str(total)
    resolved_offset = int(offset) if offset is not None else (page - 1) * page_size
    resolved_limit = int(limit) if limit is not None else page_size
    rows = (
        query.order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
        .offset(resolved_offset)
        .limit(resolved_limit)
        .all()
    )
    return [{
        "id": m.id,
        "item_id": m.item_id,
        "user_id": m.user_id,
        "item_name": m.item.name if m.item else "",
        "movement_type": m.movement_type,
        "quantity": m.quantity,
        "reference_type": m.reference_type,
        "reference_id": m.reference_id,
        "note": m.note,
        "created_at": m.created_at.isoformat()
    } for m in rows]


@router.get('/reports/analytics', dependencies=[Depends(require_permission("inventory.view"))])
def inventory_reports_analytics(
    dead_days: int = 90,
    period_days: int = 90,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    dead_days = max(1, min(int(dead_days or 90), 3650))
    period_days = max(1, min(int(period_days or 90), 3650))
    now = utcnow()
    dead_cutoff = now - timedelta(days=dead_days)
    period_cutoff = now - timedelta(days=period_days)
    try:
        items = db.query(InventoryItem).all()
        outbound_last_rows = (
            db.query(StockMovement.item_id, func.max(StockMovement.created_at))
            .filter(StockMovement.movement_type.in_(["SALE", "REPAIR_CONSUME", "OUT"]))
            .group_by(StockMovement.item_id)
            .all()
        )
        outbound_last_map = {int(item_id): last_dt for item_id, last_dt in outbound_last_rows if item_id}
        dead_rows = []
        for item in items:
            qty = int(item.quantity or 0)
            if qty <= 0:
                continue
            last_outbound = outbound_last_map.get(int(item.id))
            if last_outbound and last_outbound >= dead_cutoff:
                continue
            stock_value = round(qty * float(item.cost_price or 0), 2)
            dead_rows.append(
                {
                    "item_id": item.id,
                    "sku": item.sku,
                    "name": item.name,
                    "category": item.category,
                    "brand": item.brand,
                    "quantity": qty,
                    "cost_price": float(item.cost_price or 0),
                    "sale_price": float(item.sale_price or 0),
                    "stock_value": stock_value,
                    "last_outbound_at": _iso(last_outbound),
                    "days_since_outbound": (now.date() - last_outbound.date()).days if last_outbound else None,
                }
            )
        dead_rows.sort(key=lambda row: row["stock_value"], reverse=True)
        dead_total_value = round(sum(float(row["stock_value"] or 0) for row in dead_rows), 2)

        supplier_rows = db.query(Supplier).order_by(Supplier.name.asc()).all()
        po_period_rows = (
            db.query(
                PurchaseOrder.supplier_id,
                func.count(PurchaseOrder.id),
                func.coalesce(func.sum(PurchaseOrder.total_cost), 0),
                func.max(PurchaseOrder.created_at),
            )
            .filter(PurchaseOrder.created_at >= period_cutoff)
            .group_by(PurchaseOrder.supplier_id)
            .all()
        )
        po_period_map = {
            int(supplier_id): {
                "po_count": int(po_count or 0),
                "po_value": float(po_value or 0),
                "last_po_at": last_po_at,
            }
            for supplier_id, po_count, po_value, last_po_at in po_period_rows
            if supplier_id
        }
        grn_net_value_expr = (
            (func.coalesce(GoodsReceivedNoteItem.quantity, 0) - func.coalesce(GoodsReceivedNoteItem.damaged_qty, 0))
            * func.coalesce(GoodsReceivedNoteItem.unit_cost, 0)
        )
        grn_period_rows = (
            db.query(
                GoodsReceivedNote.supplier_id,
                func.count(func.distinct(GoodsReceivedNote.id)),
                func.coalesce(func.sum(grn_net_value_expr), 0),
                func.max(GoodsReceivedNote.created_at),
            )
            .outerjoin(GoodsReceivedNoteItem, GoodsReceivedNoteItem.grn_id == GoodsReceivedNote.id)
            .filter(GoodsReceivedNote.created_at >= period_cutoff)
            .group_by(GoodsReceivedNote.supplier_id)
            .all()
        )
        grn_period_map = {
            int(supplier_id): {
                "grn_count": int(grn_count or 0),
                "received_value": float(received_value or 0),
                "last_grn_at": last_grn_at,
            }
            for supplier_id, grn_count, received_value, last_grn_at in grn_period_rows
            if supplier_id
        }
        ledger_rows = db.query(
            SupplierLedgerEntry.supplier_id,
            SupplierLedgerEntry.direction,
            SupplierLedgerEntry.amount,
        ).all()
        ledger_balance_map: dict[int, float] = {}
        for supplier_id, direction, amount in ledger_rows:
            if not supplier_id:
                continue
            signed = 0.0
            normalized = str(direction or "").lower()
            if normalized == "debit":
                signed = float(amount or 0)
            elif normalized == "credit":
                signed = -float(amount or 0)
            ledger_balance_map[int(supplier_id)] = ledger_balance_map.get(int(supplier_id), 0.0) + signed

        supplier_purchase_rows = []
        for supplier in supplier_rows:
            po_period = po_period_map.get(int(supplier.id), {"po_count": 0, "po_value": 0.0, "last_po_at": None})
            grn_period = grn_period_map.get(int(supplier.id), {"grn_count": 0, "received_value": 0.0, "last_grn_at": None})
            last_purchase_at = grn_period["last_grn_at"] or po_period["last_po_at"]
            outstanding_balance = round(float(supplier.opening_balance or 0) + float(ledger_balance_map.get(int(supplier.id), 0.0)), 2)
            supplier_purchase_rows.append(
                {
                    "supplier_id": supplier.id,
                    "supplier_name": supplier.name,
                    "period_po_count": int(po_period["po_count"]),
                    "period_po_value": round(float(po_period["po_value"] or 0), 2),
                    "period_grn_count": int(grn_period["grn_count"]),
                    "period_received_value": round(float(grn_period["received_value"] or 0), 2),
                    "last_purchase_at": _iso(last_purchase_at),
                    "outstanding_balance": outstanding_balance,
                }
            )
        supplier_purchase_rows.sort(key=lambda row: row["period_received_value"], reverse=True)
        period_supplier_received_total = round(
            sum(float(row["period_received_value"] or 0) for row in supplier_purchase_rows),
            2,
        )

        repair_usage_rows = (
            db.query(
                RepairPartUsage.item_id,
                InventoryItem.name,
                InventoryItem.sku,
                func.sum(RepairPartUsage.quantity),
                func.coalesce(func.sum(RepairPartUsage.quantity * RepairPartUsage.unit_cost), 0),
                func.count(RepairPartUsage.id),
                func.max(RepairPartUsage.created_at),
            )
            .join(InventoryItem, InventoryItem.id == RepairPartUsage.item_id)
            .filter(RepairPartUsage.created_at >= period_cutoff)
            .group_by(RepairPartUsage.item_id, InventoryItem.name, InventoryItem.sku)
            .order_by(func.sum(RepairPartUsage.quantity).desc())
            .limit(120)
            .all()
        )
        repair_part_rows = [
            {
                "item_id": int(item_id),
                "item_name": item_name,
                "sku": sku,
                "quantity_used": int(quantity_used or 0),
                "usage_value": round(float(usage_value or 0), 2),
                "usage_events": int(usage_events or 0),
                "last_used_at": _iso(last_used_at),
            }
            for item_id, item_name, sku, quantity_used, usage_value, usage_events, last_used_at in repair_usage_rows
            if item_id
        ]
        repair_total_qty = int(sum(int(row["quantity_used"] or 0) for row in repair_part_rows))
        repair_total_value = round(sum(float(row["usage_value"] or 0) for row in repair_part_rows), 2)

        return {
            "generated_at": _iso(now),
            "dead_stock": {
                "days_threshold": dead_days,
                "summary": {
                    "item_count": len(dead_rows),
                    "total_value": dead_total_value,
                },
                "rows": dead_rows[:200],
            },
            "supplier_purchases": {
                "period_days": period_days,
                "summary": {
                    "supplier_count": len(supplier_purchase_rows),
                    "period_received_total": period_supplier_received_total,
                },
                "rows": supplier_purchase_rows[:200],
            },
            "repair_parts_usage": {
                "period_days": period_days,
                "summary": {
                    "line_count": len(repair_part_rows),
                    "total_quantity_used": repair_total_qty,
                    "total_usage_value": repair_total_value,
                },
                "rows": repair_part_rows,
            },
        }
    except OperationalError:
        return {
            "generated_at": _iso(now),
            "dead_stock": {"days_threshold": dead_days, "summary": {"item_count": 0, "total_value": 0}, "rows": []},
            "supplier_purchases": {"period_days": period_days, "summary": {"supplier_count": 0, "period_received_total": 0}, "rows": []},
            "repair_parts_usage": {"period_days": period_days, "summary": {"line_count": 0, "total_quantity_used": 0, "total_usage_value": 0}, "rows": []},
        }

@router.get('/meta', dependencies=[Depends(require_permission("inventory.view"))])
def inventory_meta(db: Session = Depends(get_db), _=Depends(get_current_user)):
    brands = [r[0] for r in db.query(InventoryItem.brand).filter(InventoryItem.brand.isnot(None), InventoryItem.brand != "").distinct().all()]
    categories = [r[0] for r in db.query(InventoryItem.category).filter(InventoryItem.category.isnot(None), InventoryItem.category != "").distinct().all()]
    return {"brands": brands, "categories": categories}

@router.get('/variants', dependencies=[Depends(require_permission("inventory.view"))])
def variants(db: Session = Depends(get_db), _=Depends(get_current_user)):
    rows = (
        db.query(
            InventoryItem.brand,
            InventoryItem.model,
            InventoryItem.storage,
            InventoryItem.color,
            InventoryItem.condition,
            InventoryItem.category,
            func.sum(InventoryItem.quantity).label("qty"),
            func.count(InventoryItem.id).label("products"),
            func.avg(InventoryItem.sale_price).label("avg_sale"),
        )
        .group_by(
            InventoryItem.brand,
            InventoryItem.model,
            InventoryItem.storage,
            InventoryItem.color,
            InventoryItem.condition,
            InventoryItem.category,
        )
        .order_by(func.sum(InventoryItem.quantity).desc())
        .all()
    )
    return [
        {
            "brand": r.brand,
            "model": r.model,
            "storage": r.storage,
            "color": r.color,
            "condition": r.condition,
            "category": r.category,
            "quantity": int(r.qty or 0),
            "product_count": int(r.products or 0),
            "avg_sale_price": float(r.avg_sale or 0),
        }
        for r in rows
    ]

@router.get('/serials/search', dependencies=[Depends(require_permission("inventory.serial_manage"))])
def search_serials(query: str = "", db: Session = Depends(get_db), _=Depends(get_current_user)):
    q = (query or "").strip()
    if not q:
        rows = db.query(InventorySerial).order_by(InventorySerial.created_at.desc()).limit(100).all()
    else:
        like = f"%{q}%"
        rows = (
            db.query(InventorySerial)
            .join(InventoryItem, InventoryItem.id == InventorySerial.item_id)
            .filter(
                (InventorySerial.serial_number.ilike(like)) |
                (InventoryItem.sku.ilike(like)) |
                (InventoryItem.name.ilike(like))
            )
            .order_by(InventorySerial.created_at.desc())
            .limit(200)
            .all()
        )
    return [
        {
            "id": s.id,
            "item_id": s.item_id,
            "item_name": s.item.name if s.item else "",
            "sku": s.item.sku if s.item else "",
            "serial_number": s.serial_number,
            "status": s.status,
            "sale_id": s.sale_id,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in rows
    ]


@router.get('/serials/{serial_id}/detail', dependencies=[Depends(require_permission("inventory.serial_manage"))])
def serial_detail(serial_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    serial = (
        db.query(InventorySerial)
        .options(joinedload(InventorySerial.item))
        .filter(InventorySerial.id == serial_id)
        .first()
    )
    if not serial:
        raise HTTPException(status_code=404, detail="Serial record not found")

    serial_text = str(serial.serial_number or "")
    sale_rows = (
        db.query(SaleItem, Sale, Customer)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .outerjoin(Customer, Customer.id == Sale.customer_id)
        .filter(SaleItem.serial_number == serial_text)
        .order_by(Sale.created_at.desc())
        .all()
    )
    warranty_rows = (
        db.query(WarrantyRecord)
        .filter(
            (WarrantyRecord.serial_number == serial_text)
            | (WarrantyRecord.imei_or_serial == serial_text)
        )
        .order_by(WarrantyRecord.created_at.desc())
        .all()
    )
    return_rows = (
        db.query(ReturnRecord)
        .filter(ReturnRecord.serial_number == serial_text)
        .order_by(ReturnRecord.created_at.desc())
        .all()
    )
    return_v2_pairs = (
        db.query(ReturnCase, ReturnItem)
        .join(ReturnItem, ReturnItem.return_id == ReturnCase.id)
        .filter(
            or_(
                ReturnItem.serial_id == serial.id,
                ReturnItem.imei == serial_text,
            )
        )
        .order_by(ReturnCase.created_at.desc())
        .all()
    )
    movement_rows = (
        db.query(StockMovement)
        .filter(StockMovement.item_id == serial.item_id)
        .order_by(StockMovement.created_at.desc())
        .limit(120)
        .all()
    )

    return {
        "serial": {
            "id": serial.id,
            "item_id": serial.item_id,
            "item_name": serial.item.name if serial.item else None,
            "sku": serial.item.sku if serial.item else None,
            "serial_number": serial.serial_number,
            "status": serial.status,
            "sale_id": serial.sale_id,
            "created_at": _iso(serial.created_at),
        },
        "sales_history": [
            {
                "sale_id": sale.id,
                "invoice_no": f"INV-{sale.id:05d}",
                "customer_id": sale.customer_id,
                "customer_name": customer.name if customer else "Walk-in",
                "customer_phone": customer.phone if customer else None,
                "quantity": int(line.quantity or 0),
                "unit_price": float(line.price or 0),
                "total": round(float(line.price or 0) * int(line.quantity or 0), 2),
                "is_return": bool(sale.is_return),
                "payment_method": sale.payment_method,
                "created_at": _iso(sale.created_at),
            }
            for line, sale, customer in sale_rows
        ],
        "warranty_links": [
            {
                "warranty_id": row.id,
                "warranty_code": row.warranty_code,
                "invoice_id": row.invoice_id,
                "status": row.status,
                "warranty_type": row.warranty_type,
                "customer_name": row.customer_name,
                "start_date": _iso(row.start_date),
                "end_date": _iso(row.end_date),
                "created_at": _iso(row.created_at),
            }
            for row in warranty_rows
        ],
        "return_history": [
            {
                "source": "legacy",
                "id": row.id,
                "return_code": row.return_code,
                "return_type": row.return_type,
                "decision_status": row.decision_status,
                "quantity": int(row.quantity or 0),
                "refund_amount": float(row.refund_amount or 0),
                "created_at": _iso(row.created_at),
            }
            for row in return_rows
        ]
        + [
            {
                "source": "v2",
                "id": case.id,
                "return_code": case.return_number,
                "return_type": case.return_type,
                "decision_status": case.decision_status,
                "quantity": int(item.quantity or 0),
                "refund_amount": float(case.refund_amount or 0),
                "created_at": _iso(case.created_at),
            }
            for case, item in return_v2_pairs
        ],
        "stock_movements": [
            {
                "id": row.id,
                "movement_type": row.movement_type,
                "quantity": int(row.quantity or 0),
                "reference_type": row.reference_type,
                "reference_id": row.reference_id,
                "note": row.note,
                "created_at": _iso(row.created_at),
            }
            for row in movement_rows
        ],
    }
@router.get('/{item_id}/serials', dependencies=[Depends(require_permission("inventory.serial_manage"))])
def list_serials(item_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    from app.models import InventorySerial
    return (
        db.query(InventorySerial)
        .filter(InventorySerial.item_id == item_id)
        .order_by(InventorySerial.created_at.desc())
        .all()
    )

@router.post('/{item_id}/serials', dependencies=[Depends(require_permission("inventory.serial_manage"))])
def add_serial(item_id: int, serial_number: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    from app.models import InventorySerial, InventoryItem
    item = db.query(InventoryItem).filter(InventoryItem.id == item_id, InventoryItem.is_deleted == False).first()  # noqa: E712
    if not item: raise HTTPException(404, "Item not found")

    serial_clean = str(serial_number or "").strip()
    if not serial_clean:
        raise HTTPException(status_code=400, detail="serial_number is required")

    existing = db.query(InventorySerial).filter(InventorySerial.serial_number == serial_clean).first()
    if existing: raise HTTPException(400, "Serial number already exists")

    active_serial_count = (
        db.query(func.count(InventorySerial.id))
        .filter(
            InventorySerial.item_id == item_id,
            InventorySerial.status.in_(["in_stock", "reserved", "sold", "returned", "damaged"]),
        )
        .scalar()
        or 0
    )
    if int(active_serial_count) >= int(item.quantity or 0):
        raise HTTPException(
            status_code=400,
            detail="Cannot add serial beyond current stock quantity. Receive stock or adjust quantity first.",
        )

    s = InventorySerial(item_id=item_id, serial_number=serial_clean, status="in_stock")
    db.add(s)
    db.add(
        StockMovement(
            item_id=item_id,
            user_id=current_user.id if current_user else None,
            movement_type="ADJUSTMENT",
            quantity=0,
            reference_type="serial_link",
            reference_id=None,
            note=f"Serial linked to existing stock: {serial_clean}",
        )
    )
    db.commit()
    db.refresh(s)
    return s

@router.delete('/serials/{serial_id}', dependencies=[Depends(require_permission("inventory.serial_manage"))])
def delete_serial(serial_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    from app.models import InventorySerial
    s = db.query(InventorySerial).filter(InventorySerial.id == serial_id).first()
    if not s: raise HTTPException(404, "Serial not found")

    current_status = str(s.status or "").lower()
    if current_status == "sold":
        raise HTTPException(status_code=400, detail="Sold serial numbers cannot be deleted")
    if current_status == "voided":
        return {"ok": True, "already_voided": True}

    s.status = "voided"
    db.add(
        StockMovement(
            item_id=s.item_id,
            user_id=current_user.id if current_user else None,
            movement_type="ADJUSTMENT",
            quantity=0,
            reference_type="serial_void",
            reference_id=s.id,
            note=f"Serial status changed to voided: {s.serial_number}",
        )
    )
    db.commit()
    return {"ok": True, "status": s.status}


@router.get('/categories', dependencies=[Depends(require_permission("inventory.view"))])
def list_categories(db: Session = Depends(get_db), _=Depends(get_current_user)):
    rows = db.query(ProductCategory).order_by(ProductCategory.name.asc()).all()
    counts = dict(
        db.query(func.lower(InventoryItem.category), func.count(InventoryItem.id))
        .filter(InventoryItem.category.isnot(None), InventoryItem.category != "")
        .group_by(func.lower(InventoryItem.category))
        .all()
    )
    return [
        {
            "id": row.id,
            "name": row.name,
            "icon_url": row.icon_url,
            # Keep backward compatibility for older clients using `icon`.
            "icon": row.icon_url,
            "parent_id": row.parent_id,
            "is_active": row.is_active,
            "product_count": int(counts.get((row.name or "").strip().lower(), 0)),
        }
        for row in rows
    ]


@router.post('/categories', dependencies=[Depends(require_permission("inventory.create_product"))])
def create_category(payload: CategoryIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    row = ProductCategory(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put('/categories/{category_id}', dependencies=[Depends(require_permission("inventory.edit_product"))])
def update_category(category_id: int, payload: CategoryIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    row = db.query(ProductCategory).filter(ProductCategory.id == category_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Category not found")
    for k, v in payload.model_dump().items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return row


@router.delete('/categories/{category_id}', dependencies=[Depends(require_permission("inventory.delete_product"))])
def delete_category(
    category_id: int,
    approval_request_code: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(ProductCategory).filter(ProductCategory.id == category_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Category not found")
    old_value = {"name": row.name, "is_active": bool(row.is_active)}
    consume_approval_request(
        db,
        request_code=approval_request_code,
        module="inventory",
        action="archive_category",
        target_type="ProductCategory",
        target_id=row.id,
        user=_,
        permission="inventory.delete_product",
        expected_payload={"name": row.name},
        reason="Archive product category",
    )
    row.is_active = False
    record_domain_audit(
        db,
        module="inventory",
        action="category_archived",
        target_type="ProductCategory",
        target_id=row.id,
        user=_,
        old_value=old_value,
        new_value={"name": row.name, "is_active": False},
        reason="Category archived from inventory module",
        permission="inventory.delete_product",
    )
    db.commit()
    return {"ok": True}


@router.get('/brands', dependencies=[Depends(require_permission("inventory.view"))])
def list_brands(db: Session = Depends(get_db), _=Depends(get_current_user)):
    rows = db.query(Brand).order_by(Brand.name.asc()).all()
    counts = dict(
        db.query(func.lower(InventoryItem.brand), func.count(InventoryItem.id))
        .filter(InventoryItem.brand.isnot(None), InventoryItem.brand != "")
        .group_by(func.lower(InventoryItem.brand))
        .all()
    )
    return [
        {
            "id": row.id,
            "name": row.name,
            "logo_url": row.logo_url,
            "is_active": row.is_active,
            "product_count": int(counts.get((row.name or "").strip().lower(), 0)),
        }
        for row in rows
    ]


@router.post('/brands', dependencies=[Depends(require_permission("inventory.create_product"))])
def create_brand(payload: BrandIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    row = Brand(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put('/brands/{brand_id}', dependencies=[Depends(require_permission("inventory.edit_product"))])
def update_brand(brand_id: int, payload: BrandIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    row = db.query(Brand).filter(Brand.id == brand_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Brand not found")
    for k, v in payload.model_dump().items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return row


@router.delete('/brands/{brand_id}', dependencies=[Depends(require_permission("inventory.delete_product"))])
def delete_brand(
    brand_id: int,
    approval_request_code: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(Brand).filter(Brand.id == brand_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Brand not found")
    old_value = {"name": row.name, "is_active": bool(row.is_active)}
    consume_approval_request(
        db,
        request_code=approval_request_code,
        module="inventory",
        action="archive_brand",
        target_type="Brand",
        target_id=row.id,
        user=_,
        permission="inventory.delete_product",
        expected_payload={"name": row.name},
        reason="Archive brand",
    )
    row.is_active = False
    record_domain_audit(
        db,
        module="inventory",
        action="brand_archived",
        target_type="Brand",
        target_id=row.id,
        user=_,
        old_value=old_value,
        new_value={"name": row.name, "is_active": False},
        reason="Brand archived from inventory module",
        permission="inventory.delete_product",
    )
    db.commit()
    return {"ok": True}


@router.get('/grn', dependencies=[Depends(require_permission("inventory.view"))])
def list_grn(db: Session = Depends(get_db), _=Depends(get_current_user)):
    try:
        rows = (
            db.query(GoodsReceivedNote)
            .options(
                joinedload(GoodsReceivedNote.supplier),
                joinedload(GoodsReceivedNote.po),
                joinedload(GoodsReceivedNote.lines),
            )
            .order_by(GoodsReceivedNote.created_at.desc())
            .limit(100)
            .all()
        )
    except OperationalError:
        # Older local DB without GRN tables: return empty until startup table sync runs.
        return []
    return [
        {
            "id": r.id,
            "grn_no": r.grn_no,
            "supplier_id": r.supplier_id,
            "supplier_name": r.supplier.name if r.supplier else "",
            "po_id": r.po_id,
            "po_number": r.po.po_number if r.po else None,
            "invoice_no": r.invoice_no,
            "note": r.note,
            "is_cancelled": bool(r.is_cancelled),
            "cancelled_at": _iso(r.cancelled_at),
            "cancelled_by_user_id": r.cancelled_by_user_id,
            "cancel_reason": r.cancel_reason,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "line_count": len(r.lines or []),
            "grn_total": _grn_total(r.lines),
        } for r in rows
    ]


@router.get('/grn/{grn_id}', dependencies=[Depends(require_permission("inventory.view"))])
def get_grn(grn_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    try:
        row = (
            db.query(GoodsReceivedNote)
            .options(
                joinedload(GoodsReceivedNote.supplier),
                joinedload(GoodsReceivedNote.po),
                joinedload(GoodsReceivedNote.lines).joinedload(GoodsReceivedNoteItem.item),
            )
            .filter(GoodsReceivedNote.id == grn_id)
            .first()
        )
    except OperationalError:
        raise HTTPException(status_code=404, detail="GRN not found")
    if not row:
        raise HTTPException(status_code=404, detail="GRN not found")

    lines = []
    total_received_qty = 0
    total_damaged_qty = 0
    grn_total = 0.0
    for line in (row.lines or []):
        qty = int(line.quantity or 0)
        damaged = int(line.damaged_qty or 0)
        received = max(0, qty - damaged)
        unit_cost = float(line.unit_cost or 0)
        line_total = round(received * unit_cost, 2)
        total_received_qty += received
        total_damaged_qty += max(0, damaged)
        grn_total += float(line_total)
        lines.append(
            {
                "id": line.id,
                "item_id": line.item_id,
                "item_name": line.item.name if line.item else f"Item #{line.item_id}",
                "sku": line.item.sku if line.item else None,
                "quantity": qty,
                "damaged_qty": max(0, damaged),
                "received_qty": received,
                "unit_cost": unit_cost,
                "line_total": line_total,
            }
        )

    return {
        "id": row.id,
        "grn_no": row.grn_no,
        "supplier_id": row.supplier_id,
        "supplier_name": row.supplier.name if row.supplier else "",
        "po_id": row.po_id,
        "po_number": row.po.po_number if row.po else None,
        "invoice_no": row.invoice_no,
        "note": row.note,
        "is_cancelled": bool(row.is_cancelled),
        "cancelled_at": _iso(row.cancelled_at),
        "cancelled_by_user_id": row.cancelled_by_user_id,
        "cancel_reason": row.cancel_reason,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "line_count": len(lines),
        "total_received_qty": total_received_qty,
        "total_damaged_qty": total_damaged_qty,
        "grn_total": round(grn_total, 2),
        "lines": lines,
    }


@router.post('/grn', dependencies=[Depends(require_permission("inventory.grn_create"))])
def create_grn(payload: GrnIn, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    supplier = db.query(Supplier).filter(Supplier.id == payload.supplier_id, Supplier.is_deleted == False).first()  # noqa: E712
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    linked_po = None
    if payload.po_id:
        linked_po = db.query(PurchaseOrder).filter(PurchaseOrder.id == payload.po_id).first()
        if not linked_po:
            raise HTTPException(status_code=404, detail="Purchase order not found")
        if int(linked_po.supplier_id or 0) != int(payload.supplier_id):
            raise HTTPException(status_code=400, detail="PO supplier mismatch")
        existing = (
            db.query(GoodsReceivedNote)
            .filter(
                GoodsReceivedNote.po_id == linked_po.id,
                GoodsReceivedNote.is_cancelled == False,  # noqa: E712
            )
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail="PO already linked to an existing GRN")

    grn = GoodsReceivedNote(
        grn_no=next_number(db, "GRN"),
        supplier_id=payload.supplier_id,
        po_id=payload.po_id,
        invoice_no=payload.invoice_no,
        note=payload.note
    )
    db.add(grn)
    db.flush()
    grn_total = 0.0
    for line in payload.lines:
        item = db.query(InventoryItem).filter(InventoryItem.id == line.item_id, InventoryItem.is_deleted == False).first()  # noqa: E712
        if not item:
            raise HTTPException(status_code=404, detail=f"Item not found: {line.item_id}")
        net_received = max(0, int(line.quantity) - int(line.damaged_qty or 0))
        line_cost = float(line.unit_cost or 0)
        item.quantity += net_received
        if line_cost > 0:
            item.cost_price = line_cost
        db.add(GoodsReceivedNoteItem(
            grn_id=grn.id,
            item_id=item.id,
            quantity=line.quantity,
            damaged_qty=line.damaged_qty,
            unit_cost=line_cost,
        ))
        db.add(StockMovement(
            item_id=item.id,
            user_id=current_user.id if current_user else None,
            movement_type="IN",
            quantity=net_received,
            reference_type="grn",
            reference_id=grn.id,
            note=f"GRN {grn.grn_no} invoice {payload.invoice_no or '-'}"
        ))
        grn_total += float(net_received) * line_cost
    if linked_po:
        linked_po.status = "Received"
        linked_po.received_at = utcnow()
    db.add(
        SupplierLedgerEntry(
            supplier_id=supplier.id,
            entry_type="purchase",
            direction="debit",
            amount=round(grn_total, 2),
            reference_type="grn",
            reference_id=grn.id,
            note=f"GRN {grn.grn_no}" + (f" linked to {linked_po.po_number}" if linked_po else ""),
            created_by_user_id=current_user.id if current_user else None,
        )
    )
    record_ledger_entry(
        db,
        module="inventory",
        entry_type="grn_stock_value",
        direction="debit",
        amount=round(grn_total, 2),
        account_code="inventory_value",
        reference_type="grn",
        reference_id=grn.id,
        reference_number=grn.grn_no,
        source_table="goods_received_notes",
        source_id=grn.id,
        counterparty_type="supplier",
        counterparty_id=supplier.id,
        counterparty_name=supplier.name,
        description=f"GRN stock value for {grn.grn_no}",
        metadata={"po_id": grn.po_id, "invoice_no": grn.invoice_no},
        user=current_user,
        entry_date=grn.created_at,
    )
    db.commit()
    return {
        "ok": True,
        "grn_id": grn.id,
        "grn_no": grn.grn_no,
        "po_id": grn.po_id,
        "grn_total": round(grn_total, 2),
    }


@router.post('/grn/{grn_id}/cancel', dependencies=[Depends(require_permission("inventory.grn_create"))])
def cancel_grn(
    grn_id: int,
    payload: GrnCancelIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    reason = str(payload.reason or "").strip()
    if len(reason) < 5:
        raise HTTPException(status_code=400, detail="A descriptive cancellation reason (min 5 chars) is required")

    grn = (
        db.query(GoodsReceivedNote)
        .options(joinedload(GoodsReceivedNote.lines), joinedload(GoodsReceivedNote.po))
        .filter(GoodsReceivedNote.id == grn_id)
        .first()
    )
    if not grn:
        raise HTTPException(status_code=404, detail="GRN not found")
    if bool(grn.is_cancelled):
        return {
            "ok": True,
            "already_cancelled": True,
            "grn_id": grn.id,
            "grn_no": grn.grn_no,
            "cancelled_at": _iso(grn.cancelled_at),
        }

    item_ids = [int(line.item_id) for line in (grn.lines or []) if line.item_id]
    item_map = {}
    if item_ids:
        item_rows = db.query(InventoryItem).filter(InventoryItem.id.in_(item_ids)).all()
        item_map = {int(row.id): row for row in item_rows}

    line_reversals: list[tuple[GoodsReceivedNoteItem, InventoryItem, int, float]] = []
    for line in (grn.lines or []):
        received_qty = _grn_line_received_qty(line)
        if received_qty <= 0:
            continue
        item = item_map.get(int(line.item_id))
        if not item:
            raise HTTPException(status_code=404, detail=f"Inventory item missing for GRN line: {line.item_id}")
        if int(item.quantity or 0) < received_qty:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Cannot cancel GRN {grn.grn_no}. Item '{item.name}' has only {int(item.quantity or 0)} "
                    f"in stock but reversal requires {received_qty}."
                ),
            )
        line_reversals.append((line, item, received_qty, float(line.unit_cost or 0)))

    reversal_total = 0.0
    for _, item, received_qty, unit_cost in line_reversals:
        item.quantity = int(item.quantity or 0) - received_qty
        db.add(
            StockMovement(
                item_id=item.id,
                user_id=current_user.id if current_user else None,
                movement_type="GRN_CANCEL",
                quantity=-received_qty,
                reference_type="grn_cancel",
                reference_id=grn.id,
                note=f"GRN cancellation rollback for {grn.grn_no}",
            )
        )
        reversal_total += float(received_qty) * float(unit_cost or 0)

    reversal_total = round(reversal_total, 2)
    if reversal_total > 0:
        db.add(
            SupplierLedgerEntry(
                supplier_id=grn.supplier_id,
                entry_type="adjustment",
                direction="credit",
                amount=reversal_total,
                reference_type="grn_cancel",
                reference_id=grn.id,
                note=f"GRN cancellation reversal for {grn.grn_no}",
                created_by_user_id=current_user.id if current_user else None,
            )
        )
        record_ledger_entry(
            db,
            module="inventory",
            entry_type="grn_cancel",
            direction="credit",
            amount=reversal_total,
            account_code="inventory_value",
            reference_type="grn_cancel",
            reference_id=grn.id,
            reference_number=grn.grn_no,
            source_table="goods_received_notes",
            source_id=grn.id,
            counterparty_type="supplier",
            counterparty_id=grn.supplier_id,
            description=f"GRN cancellation reversal for {grn.grn_no}",
            metadata={"reason": reason},
            user=current_user,
        )

    grn.is_cancelled = True
    grn.cancelled_at = utcnow()
    grn.cancelled_by_user_id = current_user.id if current_user else None
    grn.cancel_reason = reason

    if grn.po_id:
        active_grn_count = (
            db.query(GoodsReceivedNote)
            .filter(
                GoodsReceivedNote.po_id == grn.po_id,
                GoodsReceivedNote.id != grn.id,
                GoodsReceivedNote.is_cancelled == False,  # noqa: E712
            )
            .count()
        )
        if active_grn_count <= 0 and grn.po:
            grn.po.status = "Draft"
            grn.po.received_at = None

    db.add(
        ActivityLog(
            user_id=current_user.id if current_user else None,
            action="Cancel",
            entity_type="GRN",
            entity_id=grn.id,
            description=(
                f"Cancelled GRN {grn.grn_no}. Rolled back stock and posted supplier credit "
                f"LKR {reversal_total:,.2f}. Reason: {reason}"
            ),
            old_value=str({"is_cancelled": False}),
            new_value=str({"is_cancelled": True, "cancel_reason": reason}),
            is_reversible=False,
        )
    )

    db.commit()
    return {
        "ok": True,
        "grn_id": grn.id,
        "grn_no": grn.grn_no,
        "reversal_total": reversal_total,
        "cancelled_at": _iso(grn.cancelled_at),
        "po_id": grn.po_id,
        "po_status": grn.po.status if grn.po else None,
    }


@router.get('/discounts', dependencies=[Depends(require_permission("inventory.view"))])
def list_discounts(db: Session = Depends(get_db), _=Depends(get_current_user)):
    try:
        rows = db.query(ProductDiscount).order_by(ProductDiscount.id.desc()).limit(200).all()
    except OperationalError:
        # Older local DB without discount table: return empty until startup table sync runs.
        return []
    return [{
        "id": d.id,
        "item_id": d.item_id,
        "item_name": d.item.name if d.item else "",
        "discount_type": d.discount_type,
        "value": d.value,
        "start_date": d.start_date.isoformat() if d.start_date else None,
        "end_date": d.end_date.isoformat() if d.end_date else None,
        "is_active": d.is_active,
        "note": d.note,
    } for d in rows]


@router.post('/discounts', dependencies=[Depends(require_permission("inventory.price_adjust"))])
def create_discount(payload: DiscountIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    row = ProductDiscount(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get('/price-adjustments', dependencies=[Depends(require_permission("inventory.view"))])
def list_price_adjustments(db: Session = Depends(get_db), _=Depends(get_current_user)):
    try:
        rows = db.query(PriceAdjustmentLog).order_by(PriceAdjustmentLog.created_at.desc()).limit(200).all()
    except OperationalError:
        # Older local DB without price adjustment table: return empty until startup table sync runs.
        return []
    return [{
        "id": r.id,
        "item_id": r.item_id,
        "item_name": r.item.name if r.item else "",
        "old_cost_price": r.old_cost_price,
        "old_sale_price": r.old_sale_price,
        "new_cost_price": r.new_cost_price,
        "new_sale_price": r.new_sale_price,
        "old_margin_amount": round(float(r.old_sale_price or 0) - float(r.old_cost_price or 0), 2),
        "new_margin_amount": round(float(r.new_sale_price or 0) - float(r.new_cost_price or 0), 2),
        "old_margin_pct": _margin_pct(r.old_sale_price, r.old_cost_price),
        "new_margin_pct": _margin_pct(r.new_sale_price, r.new_cost_price),
        "reason": r.reason,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]


@router.post('/price-adjustments', dependencies=[Depends(require_permission("inventory.price_adjust"))])
def create_price_adjustment(payload: PriceAdjustmentIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    target = str(payload.target or "both").strip().lower()
    if target not in {"both", "sale", "cost"}:
        raise HTTPException(status_code=400, detail="Invalid target. Use one of: both, sale, cost")
    mode = str(payload.mode or "absolute").strip().lower()
    if mode not in {"absolute", "percentage"}:
        raise HTTPException(status_code=400, detail="Invalid mode. Use one of: absolute, percentage")

    target_item_ids: list[int] = []
    if payload.item_id is not None:
        target_item_ids.append(int(payload.item_id))
    if payload.item_ids:
        for raw_id in payload.item_ids:
            numeric_id = int(raw_id)
            if numeric_id not in target_item_ids:
                target_item_ids.append(numeric_id)
    if not target_item_ids:
        raise HTTPException(status_code=400, detail="At least one item id is required")

    if mode == "percentage":
        if payload.percent_change is None:
            raise HTTPException(status_code=400, detail="percent_change is required for percentage mode")
        percent_change = float(payload.percent_change)
    else:
        percent_change = 0.0
        if target in {"both", "cost"} and payload.new_cost_price is None:
            raise HTTPException(status_code=400, detail="new_cost_price is required for the selected target")
        if target in {"both", "sale"} and payload.new_sale_price is None:
            raise HTTPException(status_code=400, detail="new_sale_price is required for the selected target")

    items = db.query(InventoryItem).filter(InventoryItem.id.in_(target_item_ids)).all()
    found_ids = {int(item.id) for item in items}
    missing_ids = [item_id for item_id in target_item_ids if item_id not in found_ids]
    if missing_ids:
        raise HTTPException(status_code=404, detail=f"Item not found: {missing_ids[0]}")

    factor = 1.0 + (percent_change / 100.0)
    reason_text = (payload.reason or "").strip()
    created_rows = []
    for item in items:
        old_cost = float(item.cost_price or 0)
        old_sale = float(item.sale_price or 0)

        if mode == "percentage":
            new_cost = old_cost
            new_sale = old_sale
            if target in {"both", "cost"}:
                new_cost = max(0.0, round(old_cost * factor, 4))
            if target in {"both", "sale"}:
                new_sale = max(0.0, round(old_sale * factor, 4))
        else:
            new_cost = old_cost if target == "sale" else max(0.0, float(payload.new_cost_price or 0))
            new_sale = old_sale if target == "cost" else max(0.0, float(payload.new_sale_price or 0))

        row = PriceAdjustmentLog(
            item_id=item.id,
            old_cost_price=old_cost,
            old_sale_price=old_sale,
            new_cost_price=new_cost,
            new_sale_price=new_sale,
            reason=reason_text,
        )
        item.cost_price = new_cost
        item.sale_price = new_sale
        db.add(row)
        db.flush()
        created_rows.append(
            {
                "id": row.id,
                "item_id": item.id,
                "item_name": item.name,
                "old_cost_price": old_cost,
                "old_sale_price": old_sale,
                "new_cost_price": new_cost,
                "new_sale_price": new_sale,
                "old_margin_amount": round(old_sale - old_cost, 2),
                "new_margin_amount": round(new_sale - new_cost, 2),
                "old_margin_pct": _margin_pct(old_sale, old_cost),
                "new_margin_pct": _margin_pct(new_sale, new_cost),
                "reason": reason_text,
                "created_at": _iso(row.created_at),
            }
        )

    db.commit()
    created_rows.sort(key=lambda row: row["id"], reverse=True)
    return {
        "ok": True,
        "updated_count": len(created_rows),
        "mode": mode,
        "target": target,
        "adjustments": created_rows,
    }


@router.get('/stock-takes', dependencies=[Depends(require_permission("inventory.stock_take"))])
def list_stock_takes(db: Session = Depends(get_db), _=Depends(get_current_user)):
    try:
        rows = db.query(StockTakeSession).order_by(StockTakeSession.created_at.desc()).limit(100).all()
    except OperationalError:
        # Older local DB without stock-take tables: return empty until startup table sync runs.
        return []
    session_ids = [r.id for r in rows]
    line_counts = {}
    net_variance = {}
    if session_ids:
        line_counts = dict(
            db.query(StockTakeLine.session_id, func.count(StockTakeLine.id))
            .filter(StockTakeLine.session_id.in_(session_ids))
            .group_by(StockTakeLine.session_id)
            .all()
        )
        net_variance = dict(
            db.query(StockTakeLine.session_id, func.sum(StockTakeLine.difference))
            .filter(StockTakeLine.session_id.in_(session_ids))
            .group_by(StockTakeLine.session_id)
            .all()
        )
    return [{
        "id": r.id,
        "name": r.name,
        "note": r.note,
        "status": r.status,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "closed_at": r.closed_at.isoformat() if r.closed_at else None,
        "line_count": int(line_counts.get(r.id, 0)),
        "net_variance_units": int(net_variance.get(r.id, 0) or 0),
    } for r in rows]


@router.post('/stock-takes', dependencies=[Depends(require_permission("inventory.stock_take"))])
def create_stock_take(payload: StockTakeIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    row = StockTakeSession(name=payload.name, note=payload.note, status="Draft")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.post('/stock-takes/{session_id}/lines', dependencies=[Depends(require_permission("inventory.stock_take"))])
def submit_stock_take_line(session_id: int, payload: StockTakeLineIn, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    session = db.query(StockTakeSession).filter(StockTakeSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Stock take session not found")
    session_status = str(session.status or "").lower()
    if session_status not in {"draft", "review"}:
        raise HTTPException(status_code=400, detail="Session is already posted/closed")
    item = db.query(InventoryItem).filter(InventoryItem.id == payload.item_id, InventoryItem.is_deleted == False).first()  # noqa: E712
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    existing = (
        db.query(StockTakeLine)
        .filter(StockTakeLine.session_id == session_id, StockTakeLine.item_id == item.id)
        .first()
    )
    diff = int(payload.physical_qty) - int(item.quantity or 0)
    if existing:
        existing.system_qty = int(item.quantity or 0)
        existing.physical_qty = int(payload.physical_qty or 0)
        existing.difference = diff
        line = existing
    else:
        line = StockTakeLine(
            session_id=session_id,
            item_id=item.id,
            system_qty=item.quantity,
            physical_qty=payload.physical_qty,
            difference=diff,
        )
        db.add(line)

    session.status = "Draft"
    db.commit()
    return {
        "ok": True,
        "difference": diff,
        "line": {
            "item_id": line.item_id,
            "system_qty": int(line.system_qty or 0),
            "physical_qty": int(line.physical_qty or 0),
            "difference": int(line.difference or 0),
        },
    }


@router.get('/stock-takes/{session_id}', dependencies=[Depends(require_permission("inventory.stock_take"))])
def stock_take_detail(session_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    session = db.query(StockTakeSession).filter(StockTakeSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Stock take session not found")
    lines = (
        db.query(StockTakeLine)
        .options(joinedload(StockTakeLine.item))
        .filter(StockTakeLine.session_id == session_id)
        .order_by(StockTakeLine.id.asc())
        .all()
    )
    variance_increase = sum(int(l.difference or 0) for l in lines if int(l.difference or 0) > 0)
    variance_decrease = sum(abs(int(l.difference or 0)) for l in lines if int(l.difference or 0) < 0)
    zero_variance_count = sum(1 for l in lines if int(l.difference or 0) == 0)
    return {
        "session": {
            "id": session.id,
            "name": session.name,
            "note": session.note,
            "status": session.status,
            "created_at": _iso(session.created_at),
            "closed_at": _iso(session.closed_at),
        },
        "summary": {
            "line_count": len(lines),
            "variance_increase_units": int(variance_increase),
            "variance_decrease_units": int(variance_decrease),
            "net_variance_units": int(variance_increase - variance_decrease),
            "balanced_lines": int(zero_variance_count),
        },
        "lines": [
            {
                "id": line.id,
                "item_id": line.item_id,
                "item_name": line.item.name if line.item else f"Item #{line.item_id}",
                "sku": line.item.sku if line.item else None,
                "system_qty": int(line.system_qty or 0),
                "physical_qty": int(line.physical_qty or 0),
                "difference": int(line.difference or 0),
            }
            for line in lines
        ],
    }


@router.post('/stock-takes/{session_id}/close', dependencies=[Depends(require_permission("inventory.stock_take"))])
def close_stock_take(session_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    session = db.query(StockTakeSession).filter(StockTakeSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Stock take session not found")
    current_status = str(session.status or "").lower()
    if current_status == "posted":
        return {"ok": True, "already_posted": True, "closed_at": _iso(session.closed_at)}
    if current_status == "review":
        return {"ok": True, "already_closed": True, "closed_at": _iso(session.closed_at)}
    line_count = db.query(func.count(StockTakeLine.id)).filter(StockTakeLine.session_id == session_id).scalar() or 0
    if int(line_count) <= 0:
        raise HTTPException(status_code=400, detail="Cannot close stock take without counted lines")
    session.status = "Review"
    session.closed_at = utcnow()
    db.commit()
    return {"ok": True, "status": session.status, "closed_at": _iso(session.closed_at)}


@router.post('/stock-takes/{session_id}/post', dependencies=[Depends(require_permission("inventory.stock_take"))])
def post_stock_take(session_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    session = db.query(StockTakeSession).filter(StockTakeSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Stock take session not found")
    current_status = str(session.status or "").lower()
    if current_status == "posted":
        return {"ok": True, "already_posted": True}
    if current_status not in {"review", "closed"}:
        raise HTTPException(status_code=400, detail="Stock take must be reviewed before posting")

    lines = (
        db.query(StockTakeLine)
        .options(joinedload(StockTakeLine.item))
        .filter(StockTakeLine.session_id == session_id)
        .all()
    )
    if not lines:
        raise HTTPException(status_code=400, detail="No stock take lines to post")

    posted_adjustments = 0
    for line in lines:
        item = line.item
        if not item or bool(item.is_deleted):
            continue
        expected_qty = int(line.system_qty or 0)
        if int(item.quantity or 0) != expected_qty:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Stock changed for item {item.id} since counting (expected {expected_qty}, "
                    f"current {int(item.quantity or 0)}). Recount required."
                ),
            )

        diff = int(line.difference or 0)
        if diff == 0:
            continue
        item.quantity = int(line.physical_qty or 0)
        posted_adjustments += 1
        db.add(
            StockMovement(
                item_id=item.id,
                user_id=current_user.id if current_user else None,
                movement_type="ADJUSTMENT",
                quantity=diff,
                reference_type="stock_take_post",
                reference_id=session_id,
                note=f"Posted stock take {session.name}",
            )
        )

    session.status = "Posted"
    session.closed_at = utcnow()
    db.commit()
    return {
        "ok": True,
        "status": session.status,
        "posted_adjustments": int(posted_adjustments),
        "closed_at": _iso(session.closed_at),
    }
