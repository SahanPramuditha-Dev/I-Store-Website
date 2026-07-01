from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_permission
from app.database import get_db
from app.models import (
    ActivityLog,
    GoodsReceivedNote,
    GoodsReceivedNoteItem,
    InventoryItem,
    PurchaseOrder,
    PurchaseOrderItem,
    StockMovement,
    Supplier,
    SupplierLedgerEntry,
)
from app.schemas import PurchaseCancelIn, PurchaseOrderIn, PurchaseReconcileIn
from app.services.accounting_ledger_service import record_ledger_entry
from app.services.numbering_service import next_number
from app.utils.time import utcnow

router = APIRouter(prefix="/purchase", tags=["purchase"])


def _serialize_grn(grn: GoodsReceivedNote) -> dict:
    lines = grn.lines or []
    total = sum(max(0, int(line.quantity or 0) - int(line.damaged_qty or 0)) * float(line.unit_cost or 0) for line in lines)
    return {
        "id": grn.id,
        "grn_no": grn.grn_no,
        "po_id": grn.po_id,
        "invoice_no": grn.invoice_no,
        "note": grn.note,
        "is_cancelled": bool(grn.is_cancelled),
        "cancelled_at": grn.cancelled_at.isoformat() if grn.cancelled_at else None,
        "cancelled_by_user_id": grn.cancelled_by_user_id,
        "cancel_reason": grn.cancel_reason,
        "created_at": grn.created_at.isoformat() if grn.created_at else None,
        "line_count": len(lines),
        "total_cost": round(float(total or 0), 2),
        "lines": [
            {
                "id": line.id,
                "item_id": line.item_id,
                "item_name": line.item.name if line.item else f"Item #{line.item_id}",
                "quantity": int(line.quantity or 0),
                "damaged_qty": int(line.damaged_qty or 0),
                "received_qty": max(0, int(line.quantity or 0) - int(line.damaged_qty or 0)),
                "unit_cost": float(line.unit_cost or 0),
            }
            for line in lines
        ],
    }


def _serialize_po(po: PurchaseOrder, include_items: bool = False, include_grns: bool = False) -> dict:
    po_items = po.items or []
    grns = po.grns or []
    active_grns = [g for g in grns if not bool(g.is_cancelled)]
    cancelled_grns = [g for g in grns if bool(g.is_cancelled)]
    result = {
        "id": po.id,
        "po_number": po.po_number,
        "supplier_id": po.supplier_id,
        "supplier_name": po.supplier.name if po.supplier else None,
        "status": po.status,
        "total_cost": float(po.total_cost or 0),
        "note": po.note,
        "created_at": po.created_at.isoformat() if po.created_at else None,
        "received_at": po.received_at.isoformat() if po.received_at else None,
        "line_count": len(po_items),
        "grn_count": len(active_grns),
        "cancelled_grn_count": len(cancelled_grns),
        "grn_numbers": [g.grn_no for g in active_grns],
    }
    if include_items:
        result["items"] = [
            {
                "id": item.id,
                "item_id": item.item_id,
                "item_name": item.item.name if item.item else f"Item #{item.item_id}",
                "sku": item.item.sku if item.item else None,
                "quantity": int(item.quantity or 0),
                "unit_cost": float(item.unit_cost or 0),
                "line_total": round(float(item.unit_cost or 0) * int(item.quantity or 0), 2),
            }
            for item in po_items
        ]
    if include_grns:
        result["grns"] = [_serialize_grn(grn) for grn in grns]
    return result


def _build_default_reconcile_payload(po: PurchaseOrder) -> PurchaseReconcileIn:
    return PurchaseReconcileIn(
        invoice_no=None,
        note=f"Auto reconciliation from {po.po_number}",
        lines=[
            {
                "item_id": item.item_id,
                "received_qty": int(item.quantity or 0),
                "damaged_qty": 0,
                "unit_cost": float(item.unit_cost or 0),
            }
            for item in (po.items or [])
        ],
    )


def _append_cancellation_note(existing_note: str | None, reason: str) -> str:
    stamp = utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
    line = f"[Cancelled {stamp}] {reason}"
    base = str(existing_note or "").strip()
    return f"{base} {line}".strip() if base else line


def _reconcile_po(
    db: Session,
    *,
    po: PurchaseOrder,
    payload: PurchaseReconcileIn,
    actor_user_id: int | None,
) -> tuple[GoodsReceivedNote, float]:
    if str(po.status or "").lower() == "received":
        raise HTTPException(status_code=400, detail="PO already received")

    existing_grn = (
        db.query(GoodsReceivedNote)
        .filter(
            GoodsReceivedNote.po_id == po.id,
            GoodsReceivedNote.is_cancelled == False,  # noqa: E712
        )
        .order_by(GoodsReceivedNote.id.asc())
        .first()
    )
    if existing_grn:
        raise HTTPException(status_code=400, detail="PO already reconciled with a GRN")

    supplier = db.query(Supplier).filter(Supplier.id == po.supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    po_item_map = {int(item.item_id): item for item in (po.items or [])}
    provided = {int(line.item_id): line for line in payload.lines}
    if not po_item_map:
        raise HTTPException(status_code=400, detail="PO has no items")

    grn = GoodsReceivedNote(
        grn_no=next_number(db, "GRN"),
        supplier_id=po.supplier_id,
        po_id=po.id,
        invoice_no=payload.invoice_no,
        note=payload.note,
    )
    db.add(grn)
    db.flush()

    grn_total = 0.0
    variance_messages: list[str] = []
    for item_id, po_item in po_item_map.items():
        line = provided.get(item_id)
        ordered_qty = int(po_item.quantity or 0)
        received_qty = int(line.received_qty if line else ordered_qty)
        damaged_qty = int(line.damaged_qty if line else 0)
        if received_qty < 0:
            raise HTTPException(status_code=400, detail=f"Received quantity cannot be negative for item {item_id}")
        if damaged_qty < 0:
            raise HTTPException(status_code=400, detail=f"Damaged quantity cannot be negative for item {item_id}")
        if received_qty > ordered_qty:
            raise HTTPException(status_code=400, detail=f"Received quantity exceeds ordered quantity for item {item_id}")
        if damaged_qty > received_qty:
            raise HTTPException(status_code=400, detail=f"Damaged quantity cannot exceed received quantity for item {item_id}")

        unit_cost = float(line.unit_cost if line and line.unit_cost is not None else po_item.unit_cost or 0)
        net_received = max(0, received_qty - damaged_qty)
        inventory_item = db.query(InventoryItem).filter(InventoryItem.id == item_id).first()
        if not inventory_item:
            raise HTTPException(status_code=404, detail=f"Inventory item not found: {item_id}")

        inventory_item.quantity = int(inventory_item.quantity or 0) + net_received
        if unit_cost > 0:
            inventory_item.cost_price = unit_cost
        db.add(
            GoodsReceivedNoteItem(
                grn_id=grn.id,
                item_id=item_id,
                quantity=received_qty,
                damaged_qty=damaged_qty,
                unit_cost=unit_cost,
            )
        )
        db.add(
            StockMovement(
                item_id=item_id,
                user_id=actor_user_id,
                movement_type="IN",
                quantity=net_received,
                reference_type="grn",
                reference_id=grn.id,
                note=f"Reconciled {po.po_number} via {grn.grn_no}",
            )
        )

        if received_qty != ordered_qty:
            variance_messages.append(f"{inventory_item.name}: ordered {ordered_qty}, received {received_qty}")
        grn_total += float(net_received) * float(unit_cost)

    po.status = "Received"
    po.received_at = utcnow()
    if variance_messages:
        variance_note = " | ".join(variance_messages)
        po.note = f"{(po.note or '').strip()} [Reconcile variance: {variance_note}]".strip()

    db.add(
        SupplierLedgerEntry(
            supplier_id=po.supplier_id,
            entry_type="purchase",
            direction="debit",
            amount=round(grn_total, 2),
            reference_type="grn",
            reference_id=grn.id,
            note=f"PO {po.po_number} reconciled via {grn.grn_no}",
            created_by_user_id=actor_user_id,
        )
    )
    record_ledger_entry(
        db,
        module="purchasing",
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
        counterparty_id=po.supplier_id,
        counterparty_name=supplier.name,
        description=f"PO {po.po_number} reconciled via {grn.grn_no}",
        metadata={"po_id": po.id, "po_number": po.po_number},
        user=None,
    )
    return grn, round(grn_total, 2)


@router.get('', dependencies=[Depends(require_permission("purchasing.view"))])
def list_pos(
    response: Response,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=5000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(PurchaseOrder)
    response.headers["X-Total-Count"] = str(query.count())
    rows = (
        query
        .options(
            joinedload(PurchaseOrder.supplier),
            joinedload(PurchaseOrder.items).joinedload(PurchaseOrderItem.item),
            joinedload(PurchaseOrder.grns),
        )
        .order_by(PurchaseOrder.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_serialize_po(row) for row in rows]


@router.post('', dependencies=[Depends(require_permission("purchasing.create_po"))])
def create_po(payload: PurchaseOrderIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    total = sum(int(i.quantity or 0) * float(i.unit_cost or 0) for i in payload.items)
    po = PurchaseOrder(
        po_number=next_number(db, "PO"),
        supplier_id=payload.supplier_id,
        note=payload.note,
        total_cost=total,
        status="Draft",
    )
    db.add(po)
    db.flush()
    for item in payload.items:
        db.add(
            PurchaseOrderItem(
                po_id=po.id,
                item_id=item.item_id,
                quantity=item.quantity,
                unit_cost=item.unit_cost,
            )
        )
    db.commit()
    po = (
        db.query(PurchaseOrder)
        .options(
            joinedload(PurchaseOrder.supplier),
            joinedload(PurchaseOrder.items).joinedload(PurchaseOrderItem.item),
            joinedload(PurchaseOrder.grns),
        )
        .filter(PurchaseOrder.id == po.id)
        .first()
    )
    return _serialize_po(po, include_items=True, include_grns=True)


@router.get('/reconciliation', dependencies=[Depends(require_permission("purchasing.view"))])
def list_reconciliation(
    response: Response,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=5000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(PurchaseOrder)
    response.headers["X-Total-Count"] = str(query.count())
    rows = (
        query
        .options(
            joinedload(PurchaseOrder.supplier),
            joinedload(PurchaseOrder.items).joinedload(PurchaseOrderItem.item),
            joinedload(PurchaseOrder.grns).joinedload(GoodsReceivedNote.lines),
        )
        .order_by(PurchaseOrder.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    out = []
    for po in rows:
        ordered_total_qty = sum(int(item.quantity or 0) for item in (po.items or []))
        received_total_qty = sum(
            max(0, int(line.quantity or 0) - int(line.damaged_qty or 0))
            for grn in (po.grns or [])
            if not bool(grn.is_cancelled)
            for line in (grn.lines or [])
        )
        grn_total_cost = sum(
            max(0, int(line.quantity or 0) - int(line.damaged_qty or 0)) * float(line.unit_cost or 0)
            for grn in (po.grns or [])
            if not bool(grn.is_cancelled)
            for line in (grn.lines or [])
        )
        out.append(
            {
                "po_id": po.id,
                "po_number": po.po_number,
                "supplier_id": po.supplier_id,
                "supplier_name": po.supplier.name if po.supplier else None,
                "status": po.status,
                "created_at": po.created_at.isoformat() if po.created_at else None,
                "received_at": po.received_at.isoformat() if po.received_at else None,
                "ordered_qty_total": ordered_total_qty,
                "received_qty_total": received_total_qty,
                "qty_variance": ordered_total_qty - received_total_qty,
                "po_total_cost": float(po.total_cost or 0),
                "grn_total_cost": round(float(grn_total_cost or 0), 2),
                "cost_variance": round(float(po.total_cost or 0) - float(grn_total_cost or 0), 2),
                "grn_count": len([g for g in (po.grns or []) if not bool(g.is_cancelled)]),
                "grn_numbers": [row.grn_no for row in (po.grns or []) if not bool(row.is_cancelled)],
            }
        )
    return out


@router.get('/{po_id}', dependencies=[Depends(require_permission("purchasing.view"))])
def get_po(po_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    po = (
        db.query(PurchaseOrder)
        .options(
            joinedload(PurchaseOrder.supplier),
            joinedload(PurchaseOrder.items).joinedload(PurchaseOrderItem.item),
            joinedload(PurchaseOrder.grns).joinedload(GoodsReceivedNote.lines).joinedload(GoodsReceivedNoteItem.item),
        )
        .filter(PurchaseOrder.id == po_id)
        .first()
    )
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    return _serialize_po(po, include_items=True, include_grns=True)


@router.get('/{po_id}/reconciliation', dependencies=[Depends(require_permission("purchasing.view"))])
def get_po_reconciliation(po_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    po = (
        db.query(PurchaseOrder)
        .options(
            joinedload(PurchaseOrder.supplier),
            joinedload(PurchaseOrder.items).joinedload(PurchaseOrderItem.item),
            joinedload(PurchaseOrder.grns).joinedload(GoodsReceivedNote.lines).joinedload(GoodsReceivedNoteItem.item),
        )
        .filter(PurchaseOrder.id == po_id)
        .first()
    )
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")

    per_item_received: dict[int, int] = {}
    for grn in (po.grns or []):
        if bool(grn.is_cancelled):
            continue
        for line in (grn.lines or []):
            net_received = max(0, int(line.quantity or 0) - int(line.damaged_qty or 0))
            per_item_received[int(line.item_id)] = per_item_received.get(int(line.item_id), 0) + net_received

    lines = []
    for po_item in (po.items or []):
        ordered_qty = int(po_item.quantity or 0)
        received_qty = int(per_item_received.get(int(po_item.item_id), 0))
        lines.append(
            {
                "item_id": po_item.item_id,
                "item_name": po_item.item.name if po_item.item else f"Item #{po_item.item_id}",
                "sku": po_item.item.sku if po_item.item else None,
                "ordered_qty": ordered_qty,
                "received_qty": received_qty,
                "qty_variance": ordered_qty - received_qty,
                "ordered_unit_cost": float(po_item.unit_cost or 0),
                "ordered_line_total": round(ordered_qty * float(po_item.unit_cost or 0), 2),
            }
        )

    return {
        "po": _serialize_po(po, include_items=True, include_grns=True),
        "lines": lines,
    }


@router.post('/{po_id}/reconcile', dependencies=[Depends(require_permission("purchasing.receive_grn"))])
def reconcile_po(po_id: int, payload: PurchaseReconcileIn, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    po = (
        db.query(PurchaseOrder)
        .options(joinedload(PurchaseOrder.items))
        .filter(PurchaseOrder.id == po_id)
        .first()
    )
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    grn, grn_total = _reconcile_po(
        db,
        po=po,
        payload=payload,
        actor_user_id=current_user.id if current_user else None,
    )
    db.commit()
    return {
        "ok": True,
        "po_id": po.id,
        "po_number": po.po_number,
        "grn_id": grn.id,
        "grn_no": grn.grn_no,
        "grn_total": grn_total,
    }


@router.post('/{po_id}/receive', dependencies=[Depends(require_permission("purchasing.receive_grn"))])
def receive_po(po_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    po = (
        db.query(PurchaseOrder)
        .options(joinedload(PurchaseOrder.items))
        .filter(PurchaseOrder.id == po_id)
        .first()
    )
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    payload = _build_default_reconcile_payload(po)
    grn, grn_total = _reconcile_po(
        db,
        po=po,
        payload=payload,
        actor_user_id=current_user.id if current_user else None,
    )
    db.commit()
    return {
        "ok": True,
        "po_id": po.id,
        "po_number": po.po_number,
        "grn_id": grn.id,
        "grn_no": grn.grn_no,
        "grn_total": grn_total,
    }


@router.post('/{po_id}/cancel', dependencies=[Depends(require_permission("purchasing.cancel_po"))])
def cancel_po(
    po_id: int,
    payload: PurchaseCancelIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    reason = str(payload.reason or "").strip()
    if len(reason) < 5:
        raise HTTPException(status_code=400, detail="A descriptive cancellation reason (min 5 chars) is required")

    po = (
        db.query(PurchaseOrder)
        .options(joinedload(PurchaseOrder.grns))
        .filter(PurchaseOrder.id == po_id)
        .first()
    )
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")

    current_status = str(po.status or "").strip().lower()
    if current_status == "cancelled":
        return {"ok": True, "already_cancelled": True, "po_id": po.id, "po_number": po.po_number}

    active_grn_count = len([g for g in (po.grns or []) if not bool(g.is_cancelled)])
    if active_grn_count > 0:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot cancel PO {po.po_number}. It has {active_grn_count} active GRN(s). "
                "Cancel linked GRN entries first."
            ),
        )

    previous_status = po.status
    po.status = "Cancelled"
    po.received_at = None
    po.note = _append_cancellation_note(po.note, reason)

    db.add(
        ActivityLog(
            user_id=current_user.id if current_user else None,
            action="Cancel",
            entity_type="PurchaseOrder",
            entity_id=po.id,
            description=f"Cancelled PO {po.po_number}. Reason: {reason}",
            old_value=str({"status": previous_status}),
            new_value=str({"status": "Cancelled", "reason": reason}),
            is_reversible=False,
        )
    )
    db.commit()
    return {"ok": True, "po_id": po.id, "po_number": po.po_number, "status": po.status}
