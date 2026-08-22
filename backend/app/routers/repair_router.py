from datetime import datetime
import json
import logging
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Request, Query, BackgroundTasks
from fastapi.responses import StreamingResponse
import io
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
from app.auth import get_current_user, require_permission
from app.utils.whatsapp_helper import log_and_send_whatsapp, render_template, DEFAULT_TEMPLATES
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
from app.models import Customer, RepairTicket, InventoryItem, StockMovement, RepairPartUsage, Sale, SaleItem, InvoicePayment, User, WhatsAppTemplate
from app.schemas import RepairCancelIn, RepairIn, RepairPartConsumeIn, SaleIn
from app.services.advance_service import available_advances_query, as_money, sync_repair_advance_totals
from app.services.numbering_service import next_number
from app.services.settings_policy_service import apply_repair_create_policy, enforce_repair_delivery_policy
from app.services.security_service import get_request_device_info, get_request_ip, record_security_audit
from app.utils.time import utcnow, format_iso_utc
from app.services.warranty_service import (
    create_repair_warranty_record,
    ensure_warranty_defaults,
    warranty_status_label,
)
from app.services.capability_service import require_capability

router = APIRouter(
    prefix="/repairs",
    tags=["repairs"],
    dependencies=[Depends(require_capability("repairs_management"))]
)
logger = logging.getLogger("istore.api")

REPAIR_STATUS_TRANSITIONS = {
    REPAIR_STATUS_PENDING: {REPAIR_STATUS_DIAGNOSING, REPAIR_STATUS_CANCELLED},
    REPAIR_STATUS_DIAGNOSING: {
        REPAIR_STATUS_WAITING_FOR_APPROVAL,
        REPAIR_STATUS_WAITING_FOR_PARTS,
        REPAIR_STATUS_REPAIRING,
        REPAIR_STATUS_CANCELLED,
    },
    REPAIR_STATUS_WAITING_FOR_APPROVAL: {
        REPAIR_STATUS_REPAIRING,
        REPAIR_STATUS_WAITING_FOR_PARTS,
        REPAIR_STATUS_CANCELLED,
    },
    REPAIR_STATUS_WAITING_FOR_PARTS: {
        REPAIR_STATUS_REPAIRING,
        REPAIR_STATUS_WAITING_FOR_APPROVAL,
        REPAIR_STATUS_CANCELLED,
    },
    REPAIR_STATUS_REPAIRING: {
        REPAIR_STATUS_QUALITY_CHECKING,
        REPAIR_STATUS_WAITING_FOR_PARTS,
        REPAIR_STATUS_CANCELLED,
    },
    REPAIR_STATUS_QUALITY_CHECKING: {
        REPAIR_STATUS_COMPLETED,
        REPAIR_STATUS_REPAIRING,
        REPAIR_STATUS_WAITING_FOR_PARTS,
        REPAIR_STATUS_CANCELLED,
    },
    REPAIR_STATUS_COMPLETED: {REPAIR_STATUS_DELIVERED, REPAIR_STATUS_REPAIRING, REPAIR_STATUS_QUALITY_CHECKING},
    REPAIR_STATUS_DELIVERED: set(),
    REPAIR_STATUS_CANCELLED: {REPAIR_STATUS_PENDING, REPAIR_STATUS_DIAGNOSING},
}


def _normalize_status(value: str) -> str:
    normalized = normalize_repair_status(value)
    if normalized not in REPAIR_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid repair status '{value}'. Allowed: {', '.join(sorted(REPAIR_STATUSES))}",
        )
    return normalized


_validate_status_or_400 = _normalize_status


def _get_store_info(db: Session, request: Request | None = None):
    import os
    store_name = "I-Store"
    store_phone = "+94 77 123 4567"
    store_address = "Colombo, Sri Lanka"
    store_website = os.getenv("CUSTOMER_PORTAL_URL", "https://i-store-customer-portal-one.vercel.app").rstrip("/")

    try:
        row = db.query(AppSetting).filter(AppSetting.key == "settings_state_v2").first()
        if row and row.value:
            data = json.loads(row.value)
            profile = data.get("store_profile", {})
            identity = profile.get("business_identity", {})
            contact = profile.get("contact_information", {})
            addr = profile.get("address", {})
            if identity.get("shop_name"):
                store_name = identity["shop_name"]
            if contact.get("primary_phone") or contact.get("whatsapp_number"):
                store_phone = contact.get("primary_phone") or contact.get("whatsapp_number")
            if contact.get("website"):
                store_website = contact["website"].rstrip("/")
            addr_parts = [addr.get("address_line_1"), addr.get("city"), addr.get("country")]
            valid_addr = ", ".join([p for p in addr_parts if p])
            if valid_addr:
                store_address = valid_addr
    except Exception:
        pass

    return store_name, store_phone, store_address, store_website.rstrip("/")


def _can_transition(old_status: str | None, new_status: str) -> bool:
    # Allow status updates freely so admins and staff are never blocked from moving tickets
    return True


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
        "assigned_at": format_iso_utc(r.assigned_at),
        "estimate_status": r.estimate_status,
        "approval_status": r.approval_status,
        "invoice_status": r.invoice_status,
        "payment_status": r.payment_status,
        "delivery_status": r.delivery_status,
        "estimated_cost": float(r.estimated_cost or 0),
        "advance_payment": float(r.advance_payment or 0),
        "outstanding_balance": float(r.outstanding_balance or 0),
        "estimated_completion": format_iso_utc(r.estimated_completion),
        "created_at": format_iso_utc(r.created_at),
        "delivered_at": format_iso_utc(r.delivered_at),
        "final_sale_id": r.final_sale_id,
        "invoice_no": _invoice_label(r.final_sale) if getattr(r, "final_sale", None) else None,
        "updated_at": format_iso_utc(getattr(r, "updated_at", None)),
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
    if status and not hasattr(status, 'default') and str(status).lower() != "all":
        query = query.filter(RepairTicket.status == _normalize_status(status))
    if customer_id is not None and not hasattr(customer_id, 'default'):
        try:
            query = query.filter(RepairTicket.customer_id == int(customer_id))
        except (ValueError, TypeError):
            pass
    if imei and not hasattr(imei, 'default'):
        query = query.filter(RepairTicket.imei.ilike(f"%{str(imei).strip()}%"))
    if technician and not hasattr(technician, 'default'):
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
def create_repair(payload: RepairIn, background_tasks: BackgroundTasks, request: Request, db: Session = Depends(get_db), _=Depends(get_current_user)):
    from app.models import AdvancePayment, RepairHistory

    apply_repair_create_policy(db, payload)
    payload_data = payload.model_dump()
    payload_data["status"] = _normalize_status(payload_data.get("status") or REPAIR_STATUS_PENDING)
    payload_data["advance_payment"] = float(payload_data.get("advance_payment") or 0)
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

    # Automatically dispatch repair intake notification via WhatsApp microservice
    customer = db.query(Customer).filter(Customer.id == ticket.customer_id).first()
    if customer and (customer.whatsapp_number or customer.phone):
        import urllib.parse
        _t_label = ticket.ticket_no or f"JOB-{ticket.id:05d}"
        _t_status = REPAIR_STATUS_LABELS.get(ticket.status, str(ticket.status))
        tracking_link = (
            f"{store_website}/repair/{_t_label}"
            f"?model={urllib.parse.quote(ticket.device_model or 'Device')}"
            f"&issue={urllib.parse.quote(ticket.issue or 'General Service')}"
            f"&status={urllib.parse.quote(_t_status)}"
            f"&adv={float(ticket.advance_payment or 0):.2f}"
            f"&est={float(ticket.estimated_cost or 0):.2f}"
            f"&name={urllib.parse.quote(customer.name or 'Customer')}"
            f"&phone={urllib.parse.quote(target_phone)}"
            f"&imei={urllib.parse.quote(ticket.imei or '')}"
        )
        background_tasks.add_task(
            log_and_send_whatsapp,
            event_type="repair_intake",
            phone=target_phone,
            variables={
                "customer_name": customer.name or "Customer",
                "store_name": store_name,
                "store_phone": store_phone,
                "store_address": store_address,
                "job_number": ticket.ticket_no or f"JOB-{ticket.id:05d}",
                "device_model": ticket.device_model or "Device",
                "reported_issue": ticket.issue or "General Service",
                "repair_status": REPAIR_STATUS_LABELS.get(ticket.status, ticket.status),
                "advance_paid": f"{float(ticket.advance_payment or 0):,.2f}",
                "repair_tracking_url": tracking_link,
            },
            customer_id=customer.id
        )

    # Sync to Cloud Customer Portal (Supabase)
    try:
        from app.services.supabase_pos_sync import sync_repair_ticket_to_cloud
        background_tasks.add_task(
            sync_repair_ticket_to_cloud,
            ticket_no=ticket.ticket_no or f"JOB-{ticket.id:05d}",
            customer_name=customer.name if customer else "Customer",
            customer_phone=customer.phone if customer else "",
            device_model=ticket.device_model or "Device",
            imei_or_serial=ticket.imei or "",
            problem_description=ticket.issue or "General Service",
            status=REPAIR_STATUS_LABELS.get(ticket.status, ticket.status),
            estimated_cost=float(ticket.estimated_cost or 0),
            advance_paid=float(ticket.advance_payment or 0),
            balance_due=float(ticket.outstanding_balance or 0),
            status_note=ticket.notes or "Ticket registered.",
        )
    except Exception as e:
        logger.warning(f"Could not enqueue repair ticket cloud sync: {e}")

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
    for key, value in incoming.items():
        setattr(repair, key, value)
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

@router.put('/{repair_id}/status', dependencies=[Depends(require_permission("repairs.edit"))])
def update_repair_status(
    repair_id: int, 
    status: str = Query(...), 
    note: str = Query(""), 
    background_tasks: BackgroundTasks = BackgroundTasks(),
    request: Request = None,
    db: Session = Depends(get_db), 
    current_user=Depends(get_current_user)
):
    from app.models import RepairHistory
    repair = db.query(RepairTicket).filter(RepairTicket.id == repair_id, RepairTicket.is_deleted == False).first()  # noqa: E712
    if not repair:
        raise HTTPException(status_code=404, detail="Repair not found")
    
    old_status = repair.status
    new_status = _validate_status_or_400(status)
    if not _can_transition(old_status, new_status):
        raise HTTPException(status_code=400, detail=f"Invalid repair status transition: {old_status} -> {new_status}")

    if new_status == REPAIR_STATUS_DELIVERED:
        enforce_repair_delivery_policy(db, repair)

    repair.status = new_status
    if new_status == REPAIR_STATUS_DELIVERED:
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
    db.refresh(repair)

    # Generate rich notification URL and enqueue WhatsApp notification asynchronously
    whatsapp_url = None
    customer = db.query(Customer).filter(Customer.id == repair.customer_id).first()
    if customer and (customer.whatsapp_number or customer.phone):
        target_phone = customer.whatsapp_number or customer.phone
        phone = target_phone.replace(" ", "").replace("-", "").replace("+", "")
        if phone.startswith("0"):
            phone = "94" + phone[1:]
        elif not phone.startswith("94") and len(phone) == 9:
            phone = "94" + phone

        status_label = REPAIR_STATUS_LABELS.get(new_status, str(new_status).replace("_", " ").title())
        store_name, store_phone, store_address, store_website = _get_store_info(db, request=request)
        
        if new_status == REPAIR_STATUS_DELIVERED:
            event_type = "repair_collected"
        elif new_status == REPAIR_STATUS_COMPLETED:
            event_type = "repair_completed"
        else:
            event_type = "repair_status"

        warranty_period_text = f"{generated_warranty.warranty_days} Days" if (generated_warranty and generated_warranty.warranty_days) else "30 Days Standard Warranty"
        status_note_text = note if note else f"Status updated to {status_label}"
        
        import urllib.parse
        _rep_label = repair.ticket_no or f"JOB-{repair.id:05d}"
        tracking_link = (
            f"{store_website}/repair/{_rep_label}"
            f"?model={urllib.parse.quote(repair.device_model or 'Device')}"
            f"&issue={urllib.parse.quote(repair.issue or 'Inspection & Repair')}"
            f"&status={urllib.parse.quote(status_label)}"
            f"&note={urllib.parse.quote(status_note_text)}"
            f"&est={float(repair.estimated_cost or 0):.2f}"
            f"&adv={float(repair.advance_payment or 0):.2f}"
            f"&bal={float(repair.outstanding_balance or 0):.2f}"
            f"&name={urllib.parse.quote(customer.name or 'Customer')}"
            f"&phone={urllib.parse.quote(target_phone)}"
            f"&imei={urllib.parse.quote(repair.imei or '')}"
        )

        tpl_vars = {
            "customer_name": customer.name or "Customer",
            "store_name": store_name,
            "store_phone": store_phone,
            "store_address": store_address,
            "job_number": repair.ticket_no or f"JOB-{repair.id:05d}",
            "device_model": repair.device_model or "Device",
            "reported_issue": repair.issue or "Inspection & Repair",
            "repair_status": status_label,
            "status_note": status_note_text,
            "estimated_cost": f"{float(repair.estimated_cost or 0):,.2f}",
            "advance_paid": f"{float(repair.advance_payment or 0):,.2f}",
            "balance_due": f"{float(repair.outstanding_balance or 0):,.2f}",
            "warranty_period": warranty_period_text,
            "repair_tracking_url": tracking_link,
        }

        # Build rich fallback wa.me URL
        db_tpl = db.query(WhatsAppTemplate).filter(WhatsAppTemplate.event_type == event_type, WhatsAppTemplate.is_active == True).first()
        raw_body = db_tpl.template_body if (db_tpl and db_tpl.template_body) else DEFAULT_TEMPLATES.get(event_type, "")
        if raw_body:
            import urllib.parse
            rendered_msg = render_template(raw_body, tpl_vars)
            whatsapp_url = f"https://wa.me/{phone}?text={urllib.parse.quote(rendered_msg)}"

        if not (new_status == REPAIR_STATUS_DELIVERED and old_status == REPAIR_STATUS_DELIVERED):
            background_tasks.add_task(
                log_and_send_whatsapp,
                event_type=event_type,
                phone=target_phone,
                variables=tpl_vars,
                customer_id=customer.id
            )


        # Sync to Cloud Customer Portal (Supabase)
        try:
            from app.services.supabase_pos_sync import sync_repair_ticket_to_cloud
            background_tasks.add_task(
                sync_repair_ticket_to_cloud,
                ticket_no=repair.ticket_no or f"JOB-{repair.id:05d}",
                customer_name=customer.name if customer else "Customer",
                customer_phone=customer.phone if customer else "",
                device_model=repair.device_model or "Device",
                imei_or_serial=repair.imei or "",
                problem_description=repair.issue or "General Service",
                status=status_label,
                estimated_cost=float(repair.estimated_cost or 0),
                advance_paid=float(repair.advance_payment or 0),
                balance_due=float(repair.outstanding_balance or 0),
                status_note=status_note_text,
            )
        except Exception as e:
            logger.warning(f"Could not enqueue repair ticket cloud status update: {e}")

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
        "item_name": r.custom_part_name if r.custom_part_name else (r.item.name if r.item else "Custom Part"),
        "is_manual": bool(r.custom_part_name or not r.item_id),
        "quantity": r.quantity,
        "unit_cost": r.unit_cost,
        "created_at": format_iso_utc(r.created_at)
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
            "created_at": format_iso_utc(row.created_at),
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

    # Check if manual / custom part
    if payload.custom_part_name and payload.custom_part_name.strip():
        custom_name = payload.custom_part_name.strip()
        qty = max(1, int(payload.quantity or 1))
        unit_cost = float(payload.unit_cost or 0)
        usage = RepairPartUsage(
            repair_id=repair_id,
            item_id=None,
            custom_part_name=custom_name,
            quantity=qty,
            unit_cost=unit_cost,
        )
        db.add(usage)

        # Auto-update repair estimated cost
        line_total = qty * unit_cost
        repair.estimated_cost = float(repair.estimated_cost or 0) + line_total
        repair.outstanding_balance = float(repair.estimated_cost or 0) - float(repair.advance_payment or 0)

        db.commit()
        db.refresh(usage)
        return {
            "ok": True,
            "usage_id": usage.id,
            "is_manual": True,
            "item_name": custom_name,
            "estimated_cost": repair.estimated_cost,
            "outstanding_balance": repair.outstanding_balance
        }

    if not payload.item_id:
        raise HTTPException(status_code=400, detail="Please select a part from inventory or enter a custom part name")

    item = db.query(InventoryItem).filter(InventoryItem.id == payload.item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    if item.quantity < payload.quantity:
        raise HTTPException(status_code=400, detail=f"Insufficient stock for {item.name}. Available: {item.quantity}")

    # 1. Deduct stock from inventory
    item.quantity -= payload.quantity

    # 2. Record part usage
    unit_price = float(item.sale_price or item.cost_price or 0)
    usage = RepairPartUsage(repair_id=repair_id, item_id=item.id, quantity=payload.quantity, unit_cost=unit_price)
    db.add(usage)

    # 3. Log stock audit movement
    db.add(StockMovement(
        item_id=item.id,
        user_id=current_user.id if current_user else None,
        movement_type="REPAIR_PART_USED",
        quantity=-payload.quantity,
        reference_type="repair",
        reference_id=repair_id,
        note=f"Consumed for #{repair.ticket_no or repair.id}"
    ))

    # 4. Auto-update repair estimated cost and balance due
    line_total = float(payload.quantity) * unit_price
    repair.estimated_cost = float(repair.estimated_cost or 0) + line_total
    repair.outstanding_balance = float(repair.estimated_cost or 0) - float(repair.advance_payment or 0)

    db.commit()
    db.refresh(usage)
    return {
        "ok": True,
        "usage_id": usage.id,
        "item_name": item.name,
        "remaining_stock": item.quantity,
        "estimated_cost": repair.estimated_cost,
        "outstanding_balance": repair.outstanding_balance
    }


@router.delete('/{repair_id}/parts/{usage_id}', dependencies=[Depends(require_permission("repairs.add_parts"))])
def remove_consumed_part(repair_id: int, usage_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    repair = db.query(RepairTicket).filter(RepairTicket.id == repair_id, RepairTicket.is_deleted == False).first()
    if not repair:
        raise HTTPException(status_code=404, detail="Repair not found")

    usage = db.query(RepairPartUsage).filter(RepairPartUsage.id == usage_id, RepairPartUsage.repair_id == repair_id).first()
    if not usage:
        raise HTTPException(status_code=404, detail="Part usage record not found")

    # If inventory part, restore stock
    if usage.item_id:
        item = db.query(InventoryItem).filter(InventoryItem.id == usage.item_id).first()
        if item:
            item.quantity += usage.quantity
            db.add(StockMovement(
                item_id=item.id,
                user_id=current_user.id if current_user else None,
                movement_type="REPAIR_PART_RETURNED",
                quantity=usage.quantity,
                reference_type="repair",
                reference_id=repair_id,
                note=f"Restored from #{repair.ticket_no or repair.id}"
            ))

    # Recalculate cost
    cost_deducted = float(usage.quantity or 0) * float(usage.unit_cost or 0)
    repair.estimated_cost = max(0.0, float(repair.estimated_cost or 0) - cost_deducted)
    repair.outstanding_balance = float(repair.estimated_cost or 0) - float(repair.advance_payment or 0)

    db.delete(usage)
    db.commit()

    return {
        "ok": True,
        "message": "Part removed and inventory stock restored.",
        "estimated_cost": repair.estimated_cost,
        "outstanding_balance": repair.outstanding_balance
    }

@router.get('/{repair_id}/job-card-pdf', dependencies=[Depends(require_permission("repairs.print_job_card"))])
def generate_job_card_pdf(repair_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    from fpdf import FPDF
    from sqlalchemy.orm import joinedload
    from app.models import RepairPartUsage, WarrantyRecord
    
    repair = db.query(RepairTicket).options(joinedload(RepairTicket.customer)).filter(RepairTicket.id == repair_id).first()
    if not repair:
        raise HTTPException(status_code=404, detail=f"Repair ID {repair_id} not found in database")

    parts = db.query(RepairPartUsage).options(joinedload(RepairPartUsage.item)).filter(RepairPartUsage.repair_id == repair.id).all()
    parts_total = sum((p.quantity or 0) * (p.unit_cost or 0) for p in parts)
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
    pdf.cell(90, 12, "E Store", ln=False, align="L")
    
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
        pdf.cell(90, 7, str(v1 or "-")[:35])
        pdf.set_x(x + 90)
        pdf.cell(90, 7, str(v2 or "-")[:35], ln=True)
        pdf.ln(3)

    # ── Information Section ──────────────────────────────────
    two_fields("Customer Name", customer_name, "Date Registered", format_iso_utc(repair.created_at)[:10] if repair.created_at else "-")
    two_fields("Phone Number", customer_phone, "Device Model", repair.device_model)
    two_fields("IMEI / Serial", repair.imei, "Technician", repair.technician)
    
    pdf.ln(3)
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_text_color(140, 140, 140)
    pdf.cell(0, 5, "REPORTED ISSUE / FAULT", ln=True)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(30, 30, 30)
    pdf.multi_cell(0, 6, repair.issue or "General Inspection")
    pdf.ln(5)

    # ── Parts Consumed (If any) ──────────────────────────────
    if parts:
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(140, 140, 140)
        pdf.cell(0, 5, "PARTS CONSUMED", ln=True)
        pdf.set_fill_color(255, 255, 255)
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(30, 30, 30)
        for p in parts:
            item_name = p.custom_part_name if p.custom_part_name else (p.item.name if p.item else "Custom Part")
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
    pdf.cell(70, 5, "Authorized Signature (E Store)", align="C")

    # ── Footer ───────────────────────────────────────────────
    pdf.set_y(260)
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(160, 160, 160)
    pdf.cell(0, 5, "Thank you for your trust in E Store! | Visit us again.", ln=True, align="C")

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


@router.get("/public/{ticket_no}")
def get_public_repair(ticket_no: str, db: Session = Depends(get_db)):
    clean_no = ticket_no.strip().upper()
    repair = db.query(RepairTicket).filter(RepairTicket.ticket_no == clean_no, RepairTicket.is_deleted == False).first()
    if not repair and clean_no.startswith("JOB-"):
        try:
            num = int(clean_no.replace("JOB-", "").lstrip("0") or "0")
            repair = db.query(RepairTicket).filter(RepairTicket.id == num, RepairTicket.is_deleted == False).first()
        except Exception:
            pass
    if not repair:
        raise HTTPException(status_code=404, detail="Repair ticket not found")

    customer = db.query(Customer).filter(Customer.id == repair.customer_id).first() if repair.customer_id else None
    
    intake_photos_list = []
    completion_photos_list = []
    try:
        if repair.intake_photos:
            intake_photos_list = json.loads(repair.intake_photos)
    except Exception:
        pass

    try:
        if repair.completion_photos:
            completion_photos_list = json.loads(repair.completion_photos)
    except Exception:
        pass

    return {
        "id": repair.ticket_no or f"JOB-{repair.id:05d}",
        "customer_phone": customer.phone if customer else "",
        "customer_name": customer.name if customer else "Valued Customer",
        "device_name": repair.device_model or "Electronic Device",
        "imei_or_serial": repair.imei or "",
        "issue_description": repair.issue or "General Inspection",
        "status": REPAIR_STATUS_LABELS.get(repair.status, str(repair.status).title()),
        "status_note": repair.notes or "",
        "estimated_cost": float(repair.estimated_cost or 0),
        "advance_paid": float(repair.advance_payment or 0),
        "balance_due": float(repair.outstanding_balance or 0),
        "intake_photos": intake_photos_list,
        "completion_photos": completion_photos_list,
        "created_at": repair.created_at.isoformat() if repair.created_at else None,
    }


# ─── Photo Upload & Pickup Reminder Endpoints ─────────────────────────────────

class RepairPhotoPayload(BaseModel):
    photo_type: str = "intake" # "intake" or "completion"
    photo_url: str             # Data URL base64 or hosted image URL
    caption: Optional[str] = None


@router.post("/{repair_id}/photos")
def add_repair_photo(
    repair_id: int,
    payload: RepairPhotoPayload,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Attaches an inspection photo (intake or completion) to a repair ticket."""
    repair = db.query(RepairTicket).filter(RepairTicket.id == repair_id, RepairTicket.is_deleted == False).first()
    if not repair:
        raise HTTPException(status_code=404, detail="Repair ticket not found")

    new_photo = {
        "url": payload.photo_url,
        "caption": payload.caption or ("Intake Inspection Photo" if payload.photo_type == "intake" else "Completed Service Photo"),
        "uploaded_at": datetime.utcnow().isoformat(),
        "uploaded_by": current_user.username if hasattr(current_user, "username") else "Staff"
    }

    if payload.photo_type == "completion":
        existing = []
        try:
            if repair.completion_photos: existing = json.loads(repair.completion_photos)
        except Exception: pass
        existing.append(new_photo)
        repair.completion_photos = json.dumps(existing)
    else:
        existing = []
        try:
            if repair.intake_photos: existing = json.loads(repair.intake_photos)
        except Exception: pass
        existing.append(new_photo)
        repair.intake_photos = json.dumps(existing)

    db.commit()
    return {"ok": True, "message": "Photo attached successfully.", "photo": new_photo}


@router.post("/{repair_id}/send-pickup-reminder")
async def send_repair_pickup_reminder(
    repair_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Dispatches an official 'Ready for Pickup' WhatsApp notification with balance due and store hours."""
    from app.utils.whatsapp_helper import resolve_store_variables, normalize_sri_lankan_phone, whatsapp_provider

    repair = db.query(RepairTicket).filter(RepairTicket.id == repair_id, RepairTicket.is_deleted == False).first()
    if not repair:
        raise HTTPException(status_code=404, detail="Repair ticket not found")

    customer = db.query(Customer).filter(Customer.id == repair.customer_id).first() if repair.customer_id else None
    if not customer or not customer.phone:
        raise HTTPException(status_code=400, detail="Customer phone number is missing from this repair ticket.")

    clean_phone = normalize_sri_lankan_phone(customer.phone)
    if not clean_phone:
        raise HTTPException(status_code=400, detail="Invalid customer phone number.")

    store_info = resolve_store_variables(db)
    store_name = store_info.get("store_name", "I-Store")
    store_phone = store_info.get("store_phone", "+94 77 123 4567")
    t_no = repair.ticket_no or f"JOB-{repair.id:05d}"
    cust_name = customer.name or "Valued Customer"
    dev_model = repair.device_model or "Device"
    est_cost = float(repair.estimated_cost or 0)
    adv_paid = float(repair.advance_payment or 0)
    bal_due = float(repair.outstanding_balance or (est_cost - adv_paid))

    portal_base = "https://i-store-customer-portal-one.vercel.app"
    tracking_url = f"{portal_base}/repair/{t_no}"

    msg = (
        f"📱 *YOUR DEVICE IS READY FOR PICKUP!* 🛠️✨\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"👋 Hello *{cust_name}*,\n\n"
        f"Great news! Your repair service has been *completed & quality checked*:\n\n"
        f"📋 *Job Ticket:* #{t_no}\n"
        f"📱 *Device:* {dev_model}\n"
        f"⚡ *Service Status:* Ready for Pickup\n\n"
        f"💰 *Payment Details:*\n"
        f"• Total Service Cost: LKR {est_cost:,.2f}\n"
        f"• Advance Paid: LKR {adv_paid:,.2f}\n"
        f"• *Balance Due upon Collection: LKR {bal_due:,.2f}*\n\n"
        f"🌐 *View Service Records & Inspection Photos:*\n{tracking_url}\n\n"
        f"🏬 *Pickup Location:* {store_info.get('store_address', 'Store Service Counter')}\n"
        f"⏰ *Opening Hours:* 9:00 AM – 8:00 PM\n"
        f"📞 *Support Hotline:* {store_phone}\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"_Please present this message or your Job Ticket ID at the counter._"
    )

    res = await whatsapp_provider.send_text(clean_phone, msg)
    if res.get("success"):
        return {"ok": True, "message": f"Pickup reminder successfully sent to {clean_phone}!"}
    else:
        raise HTTPException(status_code=400, detail=f"WhatsApp delivery failed: {res.get('error')}")

