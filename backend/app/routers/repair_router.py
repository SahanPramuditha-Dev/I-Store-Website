from datetime import datetime
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
import io
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
from app.auth import get_current_user, require_permission
from app.constants import (
    REPAIR_STATUS_CANCELLED,
    REPAIR_STATUS_COMPLETED,
    REPAIR_STATUS_DELIVERED,
    REPAIR_STATUS_DIAGNOSING,
    REPAIR_STATUS_LABELS,
    REPAIR_STATUS_PENDING,
    REPAIR_STATUS_QUALITY_CHECKING,
    REPAIR_STATUS_REPAIRING,
    REPAIR_STATUS_WAITING_FOR_APPROVAL,
    REPAIR_STATUS_WAITING_FOR_PARTS,
    REPAIR_STATUSES,
    normalize_repair_status,
)
from app.models import Customer, RepairTicket, InventoryItem, StockMovement, RepairPartUsage, Sale, SaleItem, InvoicePayment, User
from app.schemas import RepairCancelIn, RepairIn, RepairPartConsumeIn, SaleIn
from app.services.advance_service import available_advances_query, as_money, sync_repair_advance_totals
from app.services.numbering_service import next_number
from app.services.settings_policy_service import apply_repair_create_policy, enforce_repair_delivery_policy
from app.services.security_service import get_request_device_info, get_request_ip, record_security_audit
from app.utils.time import utcnow
from app.services.warranty_service import (
    create_repair_warranty_record,
    ensure_warranty_defaults,
    warranty_status_label,
)

router = APIRouter(prefix="/repairs", tags=["repairs"])
logger = logging.getLogger("istore.api")

REPAIR_STATUS_TRANSITIONS = {
    REPAIR_STATUS_PENDING: {REPAIR_STATUS_DIAGNOSING, REPAIR_STATUS_CANCELLED},
    REPAIR_STATUS_DIAGNOSING: {
        REPAIR_STATUS_WAITING_FOR_APPROVAL,
        REPAIR_STATUS_WAITING_FOR_PARTS,
        REPAIR_STATUS_REPAIRING,
        REPAIR_STATUS_CANCELLED,
    },
    REPAIR_STATUS_WAITING_FOR_APPROVAL: {REPAIR_STATUS_REPAIRING, REPAIR_STATUS_CANCELLED},
    REPAIR_STATUS_WAITING_FOR_PARTS: {REPAIR_STATUS_REPAIRING, REPAIR_STATUS_CANCELLED},
    REPAIR_STATUS_REPAIRING: {REPAIR_STATUS_QUALITY_CHECKING, REPAIR_STATUS_WAITING_FOR_PARTS, REPAIR_STATUS_CANCELLED},
    REPAIR_STATUS_QUALITY_CHECKING: {REPAIR_STATUS_COMPLETED, REPAIR_STATUS_REPAIRING, REPAIR_STATUS_CANCELLED},
    REPAIR_STATUS_COMPLETED: {REPAIR_STATUS_DELIVERED, REPAIR_STATUS_REPAIRING},
    REPAIR_STATUS_DELIVERED: set(),
    REPAIR_STATUS_CANCELLED: set(),
}


def _normalize_status(value: str | None) -> str:
    return normalize_repair_status(value)


def _validate_status_or_400(value: str | None) -> str:
    normalized = _normalize_status(value)
    if normalized not in set(REPAIR_STATUSES):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid repair status '{value}'. Allowed: {', '.join(sorted(REPAIR_STATUSES))}",
        )
    return normalized


def _can_transition(old_status: str | None, new_status: str) -> bool:
    old_normalized = _normalize_status(old_status)
    if old_normalized == new_status:
        return True
    allowed = REPAIR_STATUS_TRANSITIONS.get(old_normalized)
    # Be permissive for legacy/unknown historical statuses.
    if allowed is None:
        return True
    return new_status in allowed


def _invoice_label(sale: Sale) -> str:
    return str(sale.invoice_no or f"INV-{sale.id:05d}")


def _serialize_repair(r: RepairTicket) -> dict:
    return {
        "id": r.id,
        "ticket_no": r.ticket_no,
        "customer_id": r.customer_id,
        "device_model": r.device_model,
        "imei": r.imei,
        "issue": r.issue,
        "status": _normalize_status(r.status),
        "status_label": REPAIR_STATUS_LABELS.get(_normalize_status(r.status), str(r.status or "").title()),
        "priority": r.priority,
        "technician": r.technician,
        "assigned_technician_user_id": r.assigned_technician_user_id,
        "assigned_at": r.assigned_at.isoformat() if r.assigned_at else None,
        "estimate_status": r.estimate_status,
        "approval_status": r.approval_status,
        "invoice_status": r.invoice_status,
        "payment_status": r.payment_status,
        "delivery_status": r.delivery_status,
        "estimated_cost": float(r.estimated_cost or 0),
        "advance_payment": float(r.advance_payment or 0),
        "outstanding_balance": float(r.outstanding_balance or 0),
        "estimated_completion": r.estimated_completion.isoformat() if r.estimated_completion else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "delivered_at": r.delivered_at.isoformat() if r.delivered_at else None,
        "customer_name": r.customer.name if r.customer else "Unknown",
        "customer_phone": r.customer.phone if r.customer else "N/A",
    }

@router.get('', dependencies=[Depends(require_permission("repairs.view"))])
def list_repairs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=300, ge=1, le=5000),
    status: str | None = Query(default=None),
    customer_id: int | None = Query(default=None),
    imei: str | None = Query(default=None),
    technician: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(RepairTicket).filter(RepairTicket.is_deleted == False)  # noqa: E712
    if status and str(status).lower() != "all":
        query = query.filter(RepairTicket.status == _normalize_status(status))
    if customer_id:
        query = query.filter(RepairTicket.customer_id == int(customer_id))
    if imei:
        query = query.filter(RepairTicket.imei.ilike(f"%{str(imei).strip()}%"))
    if technician:
        query = query.filter(RepairTicket.technician.ilike(f"%{str(technician).strip()}%"))
    if date_from:
        try:
            query = query.filter(RepairTicket.created_at >= datetime.fromisoformat(str(date_from)))
        except Exception:
            pass
    if date_to:
        try:
            query = query.filter(RepairTicket.created_at <= datetime.fromisoformat(str(date_to)))
        except Exception:
            pass
    repairs = (
        query.order_by(RepairTicket.created_at.desc(), RepairTicket.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [_serialize_repair(r) for r in repairs]

@router.get('/dashboard-stats', dependencies=[Depends(require_permission("repairs.view"))])
def get_repair_stats(db: Session = Depends(get_db), _=Depends(get_current_user)):
    total = db.query(RepairTicket).filter(RepairTicket.is_deleted == False).count()  # noqa: E712
    pending = (
        db.query(RepairTicket)
        .filter(
            RepairTicket.is_deleted == False,  # noqa: E712
            RepairTicket.status == REPAIR_STATUS_PENDING,
        )
        .count()
    )
    in_progress = (
        db.query(RepairTicket)
        .filter(
            RepairTicket.is_deleted == False,  # noqa: E712
            RepairTicket.status.in_(
                [
                    REPAIR_STATUS_DIAGNOSING,
                    REPAIR_STATUS_WAITING_FOR_APPROVAL,
                    REPAIR_STATUS_WAITING_FOR_PARTS,
                    REPAIR_STATUS_REPAIRING,
                    REPAIR_STATUS_QUALITY_CHECKING,
                ]
            ),
        )
        .count()
    )
    completed = (
        db.query(RepairTicket)
        .filter(
            RepairTicket.is_deleted == False,  # noqa: E712
            RepairTicket.status == REPAIR_STATUS_COMPLETED,
        )
        .count()
    )
    revenue_today = db.query(func.sum(RepairTicket.estimated_cost))\
                      .filter(RepairTicket.status == REPAIR_STATUS_DELIVERED)\
                      .filter(RepairTicket.delivered_at >= utcnow().replace(hour=0, minute=0, second=0, microsecond=0))\
                      .scalar() or 0
    return {
        "total": total,
        "pending": pending,
        "in_progress": in_progress,
        "completed": completed,
        "revenue_today": revenue_today
    }

@router.post('', dependencies=[Depends(require_permission("repairs.create"))])
def create_repair(payload: RepairIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    from app.models import AdvancePayment, RepairHistory

    apply_repair_create_policy(db, payload)
    payload_data = payload.model_dump()
    payload_data["status"] = _validate_status_or_400(payload_data.get("status"))
    payload_data["outstanding_balance"] = max(
        0.0,
        float(payload_data.get("estimated_cost") or 0) - float(payload_data.get("advance_payment") or 0),
    )
    payload_data["payment_status"] = "paid" if payload_data["outstanding_balance"] <= 0 else "unpaid"
    payload_data["delivery_status"] = (
        "delivered" if payload_data["status"] == REPAIR_STATUS_DELIVERED else "not_delivered"
    )
    ticket = RepairTicket(
        ticket_no=next_number(db, "JOB"),
        **payload_data
    )
    db.add(ticket)
    db.flush()
    db.add(RepairHistory(repair_id=ticket.id, status=ticket.status, note="Repair ticket created."))
    
    if payload.advance_payment > 0:
        advance_row = AdvancePayment(
            advance_number=next_number(db, "ADV"),
            advance_type="repair",
            customer_id=payload.customer_id,
            repair_ticket_id=ticket.id,
            amount=float(payload.advance_payment or 0),
            applied_amount=0,
            refunded_amount=0,
            payment_method="cash",
            payment_date=utcnow(),
            status="received",
            notes=f"Repair opening advance ({ticket.ticket_no})",
            received_by=_.id if _ else None,
        )
        db.add(advance_row)
        db.flush()
    sync_repair_advance_totals(db, ticket.id)

    db.commit()
    db.refresh(ticket)
    return _serialize_repair(ticket)

@router.put('/{repair_id}', dependencies=[Depends(require_permission("repairs.edit"))])
def update_repair(repair_id: int, payload: RepairIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    repair = (
        db.query(RepairTicket)
        .filter(RepairTicket.id == repair_id, RepairTicket.is_deleted == False)  # noqa: E712
        .first()
    )
    if not repair:
        raise HTTPException(status_code=404, detail="Repair not found")
    apply_repair_create_policy(db, payload)
    incoming = payload.model_dump()
    new_status = _validate_status_or_400(incoming.get("status"))
    if not _can_transition(repair.status, new_status):
        raise HTTPException(status_code=400, detail=f"Invalid repair status transition: {repair.status} -> {new_status}")
    incoming["status"] = new_status
    incoming["advance_payment"] = float(repair.advance_payment or 0)
    incoming["outstanding_balance"] = max(
        0.0,
        float(incoming.get("estimated_cost") or 0) - float(incoming.get("advance_payment") or 0),
    )
    incoming["payment_status"] = "paid" if incoming["outstanding_balance"] <= 0 else "unpaid"
    incoming["delivery_status"] = "delivered" if new_status == REPAIR_STATUS_DELIVERED else incoming.get("delivery_status", repair.delivery_status)
    for k, v in incoming.items():
        setattr(repair, k, v)
    sync_repair_advance_totals(db, repair.id)
    db.commit()
    db.refresh(repair)
    return _serialize_repair(repair)

@router.delete('/{repair_id}', dependencies=[Depends(require_permission("repairs.delete"))])
def delete_repair(repair_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    from app.models import RepairHistory

    repair = db.query(RepairTicket).filter(RepairTicket.id == repair_id, RepairTicket.is_deleted == False).first()  # noqa: E712
    if not repair:
        raise HTTPException(status_code=404, detail="Repair not found")
    repair.is_deleted = True
    repair.deleted_at = utcnow()
    repair.deleted_by = _.id if _ else None
    repair.delete_reason = "Deleted from repair module"
    repair.status = REPAIR_STATUS_CANCELLED
    repair.delivery_status = "cancelled"
    db.add(
        RepairHistory(
            repair_id=repair.id,
            status=REPAIR_STATUS_CANCELLED,
            note="Repair ticket soft-deleted",
        )
    )
    db.commit()
    return {"ok": True}

@router.put('/{repair_id}/status', dependencies=[Depends(require_permission("repairs.change_status"))])
def update_repair_status(repair_id: int, status: str, request: Request, note: str = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    from app.models import RepairHistory
    repair = db.query(RepairTicket).filter(RepairTicket.id == repair_id, RepairTicket.is_deleted == False).first()  # noqa: E712
    if not repair:
        raise HTTPException(status_code=404, detail="Repair not found")
    
    new_status = _validate_status_or_400(status)
    old_status = _normalize_status(repair.status)
    if not _can_transition(old_status, new_status):
        raise HTTPException(status_code=400, detail=f"Invalid repair status transition: {old_status} -> {new_status}")

    repair.status = new_status
    if new_status == REPAIR_STATUS_DELIVERED:
        enforce_repair_delivery_policy(db, repair)
        repair.delivered_at = utcnow()
        repair.delivery_status = "delivered"
    elif new_status == REPAIR_STATUS_COMPLETED:
        repair.delivery_status = "ready_for_delivery"
    elif new_status == REPAIR_STATUS_CANCELLED:
        repair.delivery_status = "cancelled"

    db.add(RepairHistory(
        repair_id=repair_id, 
        status=new_status, 
        note=note if note else f"Status changed from {old_status} to {new_status}"
    ))
    generated_warranty = None
    if new_status == REPAIR_STATUS_DELIVERED:
        ensure_warranty_defaults(db)
        customer = db.query(Customer).filter(Customer.id == repair.customer_id).first()
        generated_warranty = create_repair_warranty_record(
            db=db,
            repair=repair,
            customer=customer,
            created_by_id=current_user.id if current_user else None,
        )

    db.commit()
    logger.info(json.dumps({
        "event": "repair_status_changed",
        "request_id": getattr(request.state, "request_id", None),
        "repair_id": repair.id,
        "status": new_status,
    }))

    # Generate notification link if possible
    whatsapp_url = None
    customer = db.query(Customer).filter(Customer.id == repair.customer_id).first()
    if customer and customer.phone:
        phone = customer.phone.replace(" ", "").replace("-", "")
        if not phone.startswith("+"): phone = "94" + phone.lstrip("0") # Default to Sri Lanka if no country code
        status_label = REPAIR_STATUS_LABELS.get(new_status, new_status)
        message = f"Hello {customer.name}, your device ({repair.device_model}) repair status is now: {status_label}. Total estimated: LKR {repair.estimated_cost}. - i Store"
        import urllib.parse
        whatsapp_url = f"https://wa.me/{phone}?text={urllib.parse.quote(message)}"

    return {
        "ok": True,
        "whatsapp_url": whatsapp_url,
        "repair": _serialize_repair(repair),
        "warranty_record": (
            {
                "warranty_id": generated_warranty.warranty_code,
                "warranty_type": generated_warranty.warranty_type,
                "warranty_days": generated_warranty.warranty_days,
                "start_date": generated_warranty.start_date.isoformat() if generated_warranty.start_date else None,
                "end_date": generated_warranty.end_date.isoformat() if generated_warranty.end_date else None,
                "status": warranty_status_label(generated_warranty.status),
                "status_key": generated_warranty.status,
            }
            if generated_warranty
            else None
        ),
    }


@router.post('/{repair_id}/cancel', dependencies=[Depends(require_permission("repairs.change_status"))])
def cancel_repair(
    repair_id: int,
    payload: RepairCancelIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from app.models import RepairHistory

    reason = str(payload.reason or "").strip()
    if len(reason) < 5:
        raise HTTPException(status_code=400, detail="A descriptive cancellation reason (min 5 chars) is required")

    repair = (
        db.query(RepairTicket)
        .filter(RepairTicket.id == repair_id, RepairTicket.is_deleted == False)  # noqa: E712
        .first()
    )
    if not repair:
        raise HTTPException(status_code=404, detail="Repair not found")

    current_status = _normalize_status(repair.status)
    if current_status == REPAIR_STATUS_CANCELLED:
        return {"ok": True, "already_cancelled": True, "repair": _serialize_repair(repair)}

    if current_status == REPAIR_STATUS_DELIVERED:
        raise HTTPException(status_code=409, detail="Delivered repairs cannot be cancelled")

    if repair.final_sale_id:
        linked_sale = db.query(Sale).filter(Sale.id == int(repair.final_sale_id)).first()
        if linked_sale and not bool(linked_sale.is_voided):
            raise HTTPException(
                status_code=409,
                detail="Repair has a linked active invoice. Void the invoice before cancelling the repair.",
            )

    old_status = current_status
    repair.status = REPAIR_STATUS_CANCELLED
    repair.delivery_status = "cancelled"
    repair.estimate_status = "cancelled"
    repair.approval_status = "cancelled"
    if str(repair.invoice_status or "").strip().lower() == "not_invoiced":
        repair.payment_status = "cancelled"
        repair.outstanding_balance = 0
    note_prefix = str(repair.notes or "").strip()
    cancel_note = f"Cancelled: {reason}"
    repair.notes = f"{note_prefix}\n{cancel_note}".strip() if note_prefix else cancel_note

    db.add(
        RepairHistory(
            repair_id=repair.id,
            status=REPAIR_STATUS_CANCELLED,
            note=f"Repair cancelled by {current_user.full_name if current_user else 'system'}: {reason}",
        )
    )
    db.commit()
    db.refresh(repair)

    record_security_audit(
        db,
        action="repair_cancelled",
        user_id=current_user.id if current_user else None,
        target_type="repair",
        target_id=repair.id,
        target_ref=repair.ticket_no,
        detail=f"Repair cancelled. Status {old_status} -> cancelled. Reason: {reason}",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
        metadata={
            "old_status": old_status,
            "new_status": REPAIR_STATUS_CANCELLED,
            "reason": reason,
        },
    )
    return {"ok": True, "repair": _serialize_repair(repair)}

@router.post('/{repair_id}/assign-technician', dependencies=[Depends(require_permission("repairs.assign_technician"))])
def assign_technician(
    repair_id: int,
    payload: dict,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from app.models import RepairHistory

    repair = db.query(RepairTicket).filter(RepairTicket.id == repair_id, RepairTicket.is_deleted == False).first()  # noqa: E712
    if not repair:
        raise HTTPException(status_code=404, detail="Repair not found")

    technician_user_id = payload.get("technician_user_id")
    technician_name = str(payload.get("technician") or "").strip()
    assigned_user = None
    if technician_user_id:
        assigned_user = (
            db.query(User)
            .filter(User.id == int(technician_user_id), User.is_active == True, User.is_deleted == False)  # noqa: E712
            .first()
        )
        if not assigned_user:
            raise HTTPException(status_code=404, detail="Technician user not found")
        technician_name = assigned_user.full_name or assigned_user.username

    if not technician_name:
        raise HTTPException(status_code=400, detail="Technician name or technician_user_id is required")

    repair.technician = technician_name
    repair.assigned_technician_user_id = int(assigned_user.id) if assigned_user else None
    repair.assigned_at = utcnow()
    db.add(
        RepairHistory(
            repair_id=repair.id,
            status=repair.status,
            note=f"Technician assigned: {technician_name}",
        )
    )
    db.commit()
    db.refresh(repair)

    record_security_audit(
        db,
        action="repair_technician_assigned",
        user_id=current_user.id if current_user else None,
        target_type="repair",
        target_id=repair.id,
        target_ref=repair.ticket_no,
        detail=f"Assigned technician {technician_name}",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
        metadata={
            "assigned_technician_user_id": int(assigned_user.id) if assigned_user else None,
            "assigned_technician_name": technician_name,
        },
    )
    return {"ok": True, "repair": _serialize_repair(repair)}


@router.post('/assign-technician/bulk', dependencies=[Depends(require_permission("repairs.assign_technician"))])
def bulk_assign_technician(
    payload: dict,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from app.models import RepairHistory

    repair_ids = payload.get("repair_ids") or []
    if not isinstance(repair_ids, list) or not repair_ids:
        raise HTTPException(status_code=400, detail="repair_ids array is required")
    technician_user_id = payload.get("technician_user_id")
    technician_name = str(payload.get("technician") or "").strip()

    assigned_user = None
    if technician_user_id:
        assigned_user = (
            db.query(User)
            .filter(User.id == int(technician_user_id), User.is_active == True, User.is_deleted == False)  # noqa: E712
            .first()
        )
        if not assigned_user:
            raise HTTPException(status_code=404, detail="Technician user not found")
        technician_name = assigned_user.full_name or assigned_user.username
    if not technician_name:
        raise HTTPException(status_code=400, detail="Technician name or technician_user_id is required")

    ids = [int(rid) for rid in repair_ids]
    rows = (
        db.query(RepairTicket)
        .filter(RepairTicket.id.in_(ids), RepairTicket.is_deleted == False)  # noqa: E712
        .all()
    )
    updated_ids = []
    for row in rows:
        row.technician = technician_name
        row.assigned_technician_user_id = int(assigned_user.id) if assigned_user else None
        row.assigned_at = utcnow()
        db.add(
            RepairHistory(
                repair_id=row.id,
                status=row.status,
                note=f"Technician assigned (bulk): {technician_name}",
            )
        )
        updated_ids.append(int(row.id))

    db.commit()
    record_security_audit(
        db,
        action="repair_technician_assigned_bulk",
        user_id=current_user.id if current_user else None,
        target_type="repair",
        target_ref="bulk",
        detail=f"Bulk assigned technician {technician_name} to {len(updated_ids)} repairs",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
        metadata={
            "repair_ids": updated_ids,
            "assigned_technician_user_id": int(assigned_user.id) if assigned_user else None,
            "assigned_technician_name": technician_name,
        },
    )
    return {"ok": True, "updated_count": len(updated_ids), "updated_ids": updated_ids}

@router.get('/{repair_id}/timeline', dependencies=[Depends(require_permission("repairs.view"))])
def get_timeline(repair_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    from app.models import RepairHistory
    return db.query(RepairHistory).filter(RepairHistory.repair_id == repair_id).order_by(RepairHistory.created_at.asc()).all()

@router.get('/{repair_id}/parts', dependencies=[Depends(require_permission("repairs.view"))])
def repair_parts(repair_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    rows = db.query(RepairPartUsage).filter(RepairPartUsage.repair_id == repair_id).order_by(RepairPartUsage.created_at.desc()).all()
    return [{
        "id": r.id,
        "item_id": r.item_id,
        "item_name": r.item.name if r.item else "",
        "quantity": r.quantity,
        "unit_cost": r.unit_cost,
        "created_at": r.created_at.isoformat()
    } for r in rows]


@router.get('/{repair_id}/billing-summary', dependencies=[Depends(require_permission("pos.repair_billing"))])
def repair_billing_summary(
    repair_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    repair = db.query(RepairTicket).filter(RepairTicket.id == int(repair_id), RepairTicket.is_deleted == False).first()  # noqa: E712
    if not repair:
        raise HTTPException(status_code=404, detail="Repair not found")

    invoice_rows = (
        db.query(Sale)
        .filter(Sale.repair_ticket_id == int(repair_id))
        .order_by(Sale.created_at.desc(), Sale.id.desc())
        .all()
    )
    invoice_ids = [int(row.id) for row in invoice_rows]
    payment_rows = (
        db.query(InvoicePayment)
        .filter(InvoicePayment.invoice_id.in_(invoice_ids))
        .all()
        if invoice_ids
        else []
    )
    part_rows = db.query(RepairPartUsage).filter(RepairPartUsage.repair_id == int(repair_id)).all()

    advances = []
    if repair.customer_id:
        for row in available_advances_query(db, int(repair.customer_id), repair_ticket_id=int(repair.id)):
            advances.append(
                {
                    "id": row.id,
                    "advance_number": row.advance_number,
                    "remaining_amount": as_money(row.amount - row.applied_amount - row.refunded_amount),
                    "payment_method": row.payment_method,
                }
            )

    total_invoiced = round(sum(float(row.total or 0) for row in invoice_rows if not row.is_return), 2)
    total_paid = round(sum(float(row.amount or 0) for row in payment_rows), 2)
    total_parts_cost = round(sum(float(row.unit_cost or 0) * int(row.quantity or 0) for row in part_rows), 2)

    return {
        "repair_id": repair.id,
        "ticket_no": repair.ticket_no,
        "customer_id": repair.customer_id,
        "customer_name": repair.customer.name if repair.customer else None,
        "device_model": repair.device_model,
        "imei": repair.imei,
        "issue": repair.issue,
        "technician": repair.technician,
        "estimated_cost": float(repair.estimated_cost or 0),
        "advance_payment": float(repair.advance_payment or 0),
        "outstanding_balance": float(repair.outstanding_balance or 0),
        "invoice_status": repair.invoice_status,
        "payment_status": repair.payment_status,
        "parts_used_count": len(part_rows),
        "parts_used_cost_total": total_parts_cost,
        "invoices_count": len(invoice_rows),
        "total_invoiced": total_invoiced,
        "total_paid": total_paid,
        "available_advances": advances,
        "invoices": [
            {
                "id": row.id,
                "invoice_number": _invoice_label(row),
                "invoice_type": row.invoice_type or "repair_invoice",
                "grand_total": float(row.total or 0),
                "paid_total": float(row.amount_paid or 0),
                "balance_due": float(row.balance_due or 0),
                "invoice_status": row.invoice_status or ("voided" if row.is_voided else "finalized"),
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in invoice_rows
        ],
    }


@router.get('/{repair_id}/invoices', dependencies=[Depends(require_permission("pos.repair_billing"))])
def repair_invoices(
    repair_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    repair = db.query(RepairTicket).filter(RepairTicket.id == int(repair_id), RepairTicket.is_deleted == False).first()  # noqa: E712
    if not repair:
        raise HTTPException(status_code=404, detail="Repair not found")
    rows = (
        db.query(Sale)
        .filter(Sale.repair_ticket_id == int(repair_id))
        .order_by(Sale.created_at.desc(), Sale.id.desc())
        .all()
    )
    return [
        {
            "id": row.id,
            "invoice_number": _invoice_label(row),
            "invoice_type": row.invoice_type or "repair_invoice",
            "grand_total": float(row.total or 0),
            "paid_total": float(row.amount_paid or 0),
            "balance_due": float(row.balance_due or 0),
            "payment_status": row.payment_status,
            "invoice_status": row.invoice_status or ("voided" if row.is_voided else "finalized"),
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


@router.post('/{repair_id}/create-invoice', dependencies=[Depends(require_permission("pos.repair_billing"))])
def repair_create_invoice(
    repair_id: int,
    payload: dict,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    repair = db.query(RepairTicket).filter(RepairTicket.id == int(repair_id), RepairTicket.is_deleted == False).first()  # noqa: E712
    if not repair:
        raise HTTPException(status_code=404, detail="Repair not found")
    if repair.final_sale_id:
        linked = db.query(Sale).filter(Sale.id == int(repair.final_sale_id)).first()
        if linked and not linked.is_voided:
            raise HTTPException(status_code=409, detail="Repair already has an active invoice")

    lines = payload.get("lines") or []
    if not lines:
        default_price = float(payload.get("default_service_amount") or repair.outstanding_balance or repair.estimated_cost or 0)
        if default_price <= 0:
            raise HTTPException(status_code=400, detail="No billing lines provided and repair has no billable amount")
        lines = [
            {
                "item_id": None,
                "line_type": "service",
                "description": f"Repair service - {repair.issue or repair.device_model}",
                "quantity": 1,
                "price": default_price,
                "warranty_days": 0,
            }
        ]

    checkout_payload = SaleIn(
        customer_id=repair.customer_id,
        repair_ticket_id=repair.id,
        reservation_id=None,
        payment_method=str(payload.get("payment_method") or "Cash"),
        cash_amount=float(payload.get("cash_amount") or 0),
        card_amount=float(payload.get("card_amount") or 0),
        paid=bool(payload.get("paid", True)),
        discount_amount=float(payload.get("discount_amount") or 0),
        tax_amount=float(payload.get("tax_amount") or 0),
        auto_apply_advances=bool(payload.get("auto_apply_advances", False)),
        applied_advances=payload.get("applied_advances") or [],
        note=str(payload.get("note") or f"Repair invoice for {repair.ticket_no}"),
        lines=lines,
    )

    from app.routers.pos_router import checkout as pos_checkout

    return pos_checkout(checkout_payload, request, db, current_user)

@router.post('/{repair_id}/consume-part', dependencies=[Depends(require_permission("repairs.add_parts"))])
def consume_part(repair_id: int, payload: RepairPartConsumeIn, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    repair = db.query(RepairTicket).filter(RepairTicket.id == repair_id, RepairTicket.is_deleted == False).first()  # noqa: E712
    if not repair:
        raise HTTPException(status_code=404, detail="Repair not found")
    item = db.query(InventoryItem).filter(InventoryItem.id == payload.item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    if item.quantity < payload.quantity:
        raise HTTPException(status_code=400, detail="Insufficient stock")
    item.quantity -= payload.quantity
    usage = RepairPartUsage(repair_id=repair_id, item_id=item.id, quantity=payload.quantity, unit_cost=item.sale_price)
    db.add(usage)
    db.add(StockMovement(
        item_id=item.id,
        user_id=current_user.id if current_user else None,
        movement_type="REPAIR_PART_USED",
        quantity=-payload.quantity,
        reference_type="repair",
        reference_id=repair_id,
        note=f"Consumed for {repair.ticket_no}"
    ))
    db.commit()
    db.refresh(usage)
    return {"ok": True, "usage_id": usage.id, "remaining_stock": item.quantity}

@router.get('/{repair_id}/job-card-pdf', dependencies=[Depends(require_permission("repairs.print_job_card"))])
def generate_job_card_pdf(repair_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    from fpdf import FPDF
    from sqlalchemy.orm import joinedload
    from app.models import RepairPartUsage, WarrantyRecord
    
    repair = db.query(RepairTicket).options(joinedload(RepairTicket.customer)).filter(RepairTicket.id == repair_id).first()
    if not repair:
        raise HTTPException(status_code=404, detail=f"Repair ID {repair_id} not found in database")

    parts = db.query(RepairPartUsage).options(joinedload(RepairPartUsage.item)).filter(RepairPartUsage.repair_id == repair.id).all()
    parts_total = sum(p.quantity * p.unit_cost for p in parts)
    repair_warranty = (
        db.query(WarrantyRecord)
        .filter(
            WarrantyRecord.repair_ticket_id == repair.id,
            WarrantyRecord.warranty_type == "Repair Service",
        )
        .order_by(WarrantyRecord.created_at.desc())
        .first()
    )

    est_cost = repair.estimated_cost or 0
    grand_total = est_cost + parts_total
    
    is_final = _normalize_status(repair.status) in [REPAIR_STATUS_COMPLETED, REPAIR_STATUS_DELIVERED]
    doc_title = "FINAL INVOICE" if is_final else "REPAIR JOB CARD"

    customer_name = repair.customer.name if repair.customer else "Valued Customer"
    customer_phone = repair.customer.phone if repair.customer else "N/A"

    pdf = FPDF()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.set_margins(15, 15, 15)

    # Outer Border
    pdf.set_line_width(0.5)
    pdf.set_draw_color(99, 102, 241) # Indigo border
    pdf.rect(10, 10, 190, 277)

    # ── Header ──────────────────────────────────────────────
    pdf.set_font("Helvetica", "B", 26)
    pdf.set_text_color(15, 23, 42)
    pdf.cell(90, 12, "i Store", ln=False, align="L")
    
    pdf.set_font("Helvetica", "B", 20)
    pdf.set_text_color(99, 102, 241)
    pdf.cell(90, 12, doc_title, ln=True, align="R")
    
    pdf.set_font("Helvetica", "I", 10)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(90, 6, "Expert Mobile & Apple Device Repair Center", ln=False, align="L")
    
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(220, 38, 38) # Red for ticket number
    pdf.cell(90, 6, f"TICKET NO: {repair.ticket_no}", ln=True, align="R")

    pdf.set_draw_color(220, 220, 220)
    pdf.set_line_width(0.3)
    pdf.line(15, 35, 195, 35)
    pdf.ln(10)

    # ── Helper: labelled field ───────────────────────────────
    def two_fields(l1, v1, l2, v2):
        x = pdf.get_x()
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(140, 140, 140)
        pdf.cell(90, 5, l1.upper())
        pdf.set_x(x + 90)
        pdf.cell(90, 5, l2.upper(), ln=True)
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(30, 30, 30)
        pdf.set_x(x)
        pdf.cell(90, 7, str(v1))
        pdf.set_x(x + 90)
        pdf.cell(90, 7, str(v2), ln=True)
        pdf.ln(5)

    # ── Information Section ──────────────────────────────────
    from datetime import date
    two_fields("Date", date.today().strftime('%d %B %Y'), "Technician", repair.technician or "N/A")
    two_fields("Customer Name", customer_name, "Contact Number", customer_phone)
    two_fields("Device Model", repair.device_model, "IMEI / Serial", repair.imei or "N/A")

    # ── Issue box ────────────────────────────────────────────
    pdf.ln(2)
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_text_color(140, 140, 140)
    pdf.cell(0, 5, "REPORTED ISSUE / FAULT DESCRIPTION", ln=True)
    pdf.set_fill_color(248, 250, 252) # Slate 50
    pdf.set_draw_color(203, 213, 225) # Slate 300
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(15, 23, 42)
    pdf.multi_cell(180, 8, repair.issue or "N/A", border=1, fill=True)
    pdf.ln(8)
    
    # ── Parts Consumed (If any) ──────────────────────────────
    if parts:
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(140, 140, 140)
        pdf.cell(0, 5, "PARTS CONSUMED", ln=True)
        pdf.set_fill_color(255, 255, 255)
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(30, 30, 30)
        for p in parts:
            item_name = p.item.name if p.item else "Unknown Part"
            cost_str = f"LKR {p.unit_cost * p.quantity:,.0f}"
            pdf.cell(140, 6, f"- {item_name} (x{p.quantity})", border=0)
            pdf.cell(40, 6, cost_str, border=0, align="R", ln=True)
        pdf.ln(5)

    # ── Cost box ─────────────────────────────────────────────
    pdf.set_fill_color(238, 242, 255) # Indigo 50
    pdf.set_draw_color(199, 210, 254) # Indigo 200
    
    box_height = 28 if parts else 20
    if repair.advance_payment > 0:
        box_height += 16
        
    pdf.rect(15, pdf.get_y(), 180, box_height, style="DF")
    
    y_start = pdf.get_y() + 6
    pdf.set_xy(20, y_start)
    
    # Labor line
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(67, 56, 202) # Indigo 700
    pdf.cell(90, 6, "LABOR CHARGE:" if is_final else "ESTIMATED LABOR COST:")
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(15, 23, 42)
    pdf.cell(80, 6, f"LKR {est_cost:,.0f}", align="R", ln=True)
    
    if parts:
        pdf.set_xy(20, pdf.get_y() + 2)
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(67, 56, 202)
        pdf.cell(90, 8, "ACTUAL GRAND TOTAL:")
        pdf.set_font("Helvetica", "B", 16)
        pdf.set_text_color(15, 23, 42)
        pdf.cell(80, 8, f"LKR {grand_total:,.0f}", align="R", ln=True)
        
    if repair.advance_payment > 0:
        pdf.set_xy(20, pdf.get_y() + 2)
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(34, 197, 94) # Green
        pdf.cell(90, 6, "ADVANCE DEPOSIT PAID:")
        pdf.set_font("Helvetica", "B", 12)
        pdf.set_text_color(34, 197, 94)
        pdf.cell(80, 6, f"- LKR {repair.advance_payment:,.0f}", align="R", ln=True)
        
        pdf.set_xy(20, pdf.get_y() + 2)
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(220, 38, 38) # Red
        pdf.cell(90, 6, "BALANCE DUE:")
        pdf.set_font("Helvetica", "B", 14)
        pdf.set_text_color(220, 38, 38)
        pdf.cell(80, 6, f"LKR {(grand_total - repair.advance_payment):,.0f}", align="R", ln=True)

    pdf.ln(15 if not parts else 10)

    # ── Terms ────────────────────────────────────────────────
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(15, 23, 42)
    pdf.cell(0, 6, "Store Policy & Terms of Service:", ln=True)
    
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(100, 100, 100)
    warranty_text = "A 90-day warranty applies to replaced parts only (excludes physical damage, liquid damage, or software issues)."
    if repair_warranty:
        warranty_text = (
            f"Repair warranty valid for {repair_warranty.warranty_days} days until "
            f"{repair_warranty.end_date.strftime('%d %b %Y')} "
            "(excludes physical, liquid, burn, and misuse damage)."
        )

    terms = [
        "Please present this original job card during device collection.",
        "Devices not claimed within 60 days of completion will be disposed of to recover costs.",
        "We are not responsible for any data loss during the repair process. Please ensure you have a backup.",
        warranty_text,
        "The estimated cost is subject to change upon deep diagnosis. You will be notified before proceeding."
    ]
    for i, t in enumerate(terms, 1):
        pdf.cell(0, 5, f"{i}. {t}", ln=True)

    pdf.ln(25)
    
    # ── Signatures ───────────────────────────────────────────
    y = pdf.get_y()
    pdf.set_draw_color(150, 150, 150)
    pdf.set_line_width(0.3)
    
    pdf.line(20, y, 80, y)
    pdf.set_xy(20, y + 2)
    pdf.set_font("Helvetica", "I", 8)
    pdf.cell(60, 5, "Customer Signature", align="C")

    pdf.line(110, y, 180, y)
    pdf.set_xy(110, y + 2)
    pdf.cell(70, 5, "Authorized Signature (i Store)", align="C")

    # ── Footer ───────────────────────────────────────────────
    pdf.set_y(260)
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(160, 160, 160)
    pdf.cell(0, 5, "Thank you for your trust in i Store! | Visit us again.", ln=True, align="C")

    # ── Stream response ──────────────────────────────────────
    pdf_bytes = pdf.output()
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"inline; filename=JobCard-{repair.ticket_no}.pdf",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )
