from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Response, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.constants import normalize_repair_status
from app.database import get_db
from app.auth import get_current_user, require_permission
from app.models import (
    AdvancePayment,
    ActivityLog,
    Customer,
    ExchangeRecord,
    ProductReservation,
    RefundPayment,
    Return as ReturnCase,
    ReturnItem,
    RepairTicket,
    Sale,
    SaleItem,
    User,
    WarrantyRecord,
)
from app.services.advance_service import calc_advance_remaining
from app.schemas import CustomerIn
from app.utils.time import utcnow, format_iso_utc
from app.utils.whatsapp_helper import log_and_send_whatsapp

router = APIRouter(prefix="/customers", tags=["customers"])


def _validate_customer_payload(payload: CustomerIn) -> dict:
    data = payload.model_dump()
    data["name"] = str(data.get("name") or "").strip()
    data["phone"] = str(data.get("phone") or "").strip()
    data["email"] = (str(data.get("email") or "").strip() or None)
    if not data["name"]:
        raise HTTPException(status_code=400, detail="Customer name is required")
    if not data["phone"]:
        raise HTTPException(status_code=400, detail="Customer phone is required")
    phone_digits = "".join(ch for ch in data["phone"] if ch.isdigit())
    if len(phone_digits) < 7:
        raise HTTPException(status_code=400, detail="Customer phone is invalid")
    if data["email"] and ("@" not in data["email"] or "." not in data["email"].split("@")[-1]):
        raise HTTPException(status_code=400, detail="Customer email is invalid")
    return data


def _log_customer_activity(
    db: Session,
    *,
    user_id: int | None,
    action: str,
    customer_id: int,
    description: str,
    old_value: dict | None = None,
    new_value: dict | None = None,
) -> None:
    db.add(
        ActivityLog(
            user_id=user_id,
            action=action,
            entity_type="Customer",
            entity_id=customer_id,
            description=description,
            old_value=None if old_value is None else str(old_value),
            new_value=None if new_value is None else str(new_value),
            is_reversible=action in {"Create", "Update"},
            is_reversed=False,
        )
    )


def _serialize_customer(row: Customer, active_warranty_count: int = 0) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "phone": row.phone,
        "email": row.email,
        "address": row.address,
        "notes": row.notes,
        "birthday": row.birthday.isoformat() if row.birthday else None,
        "created_at": format_iso_utc(row.created_at),
        "updated_at": format_iso_utc(row.updated_at),
        "active_warranty_count": int(active_warranty_count or 0),
    }


def _repair_financial_maps(db: Session, repair_ids: list[int]) -> tuple[dict[int, float], dict[int, float], dict[int, float]]:
    totals: dict[int, float] = {}
    paid: dict[int, float] = {}
    balances: dict[int, float] = {}
    if not repair_ids:
        return totals, paid, balances
    rows = (
        db.query(
            Sale.repair_ticket_id,
            func.coalesce(func.sum(Sale.total), 0),
            func.coalesce(func.sum(Sale.amount_paid), 0),
            func.coalesce(func.sum(Sale.balance_due), 0),
        )
        .filter(
            Sale.repair_ticket_id.in_(repair_ids),
            Sale.is_voided == False,  # noqa: E712
            Sale.is_return == False,  # noqa: E712
        )
        .group_by(Sale.repair_ticket_id)
        .all()
    )
    for repair_ticket_id, total_amt, paid_amt, balance_amt in rows:
        rid = int(repair_ticket_id)
        totals[rid] = float(total_amt or 0)
        paid[rid] = float(paid_amt or 0)
        balances[rid] = float(balance_amt or 0)
    return totals, paid, balances

@router.get('', dependencies=[Depends(require_permission("customers.view"))])
def list_customers(
    response: Response,
    search: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=1000, ge=1, le=5000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(Customer).filter(Customer.is_deleted == False)  # noqa: E712
    if search:
        text = f"%{str(search).strip()}%"
        query = query.filter(
            Customer.name.ilike(text)
            | Customer.phone.ilike(text)
            | Customer.email.ilike(text)
            | Customer.address.ilike(text)
        )
    total = query.count()
    resolved_offset = int(offset) if (offset is not None and not hasattr(offset, 'default')) else 0
    resolved_limit = int(limit) if (limit is not None and not hasattr(limit, 'default')) else 1000
    rows = query.order_by(Customer.created_at.desc(), Customer.id.desc()).offset(resolved_offset).limit(resolved_limit).all()
    customer_ids = [int(row.id) for row in rows]
    warranty_count_map: dict[int, int] = {}
    if customer_ids:
        counts = (
            db.query(WarrantyRecord.customer_id, func.count(WarrantyRecord.id))
            .filter(
                WarrantyRecord.customer_id.in_(customer_ids),
                func.lower(func.trim(WarrantyRecord.status)) == "active",
            )
            .group_by(WarrantyRecord.customer_id)
            .all()
        )
        for customer_id, count in counts:
            warranty_count_map[int(customer_id)] = int(count or 0)
    return [_serialize_customer(row, warranty_count_map.get(int(row.id), 0)) for row in rows]

@router.post('', dependencies=[Depends(require_permission("customers.create"))])
def create_customer(payload: CustomerIn, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    data = _validate_customer_payload(payload)
    c = Customer(**data)
    db.add(c)
    db.flush()
    _log_customer_activity(
        db,
        user_id=current_user.id if current_user else None,
        action="Create",
        customer_id=c.id,
        description=f"Customer {c.name} created",
        new_value={"name": c.name, "phone": c.phone, "email": c.email},
    )
    db.commit()
    db.refresh(c)
    
    if c.phone:
        background_tasks.add_task(
            log_and_send_whatsapp,
            "customer_welcome",
            c.phone,
            {"customer_name": c.name},
            customer_id=c.id
        )
        
    return _serialize_customer(c, 0)

@router.get('/{customer_id}', dependencies=[Depends(require_permission("customers.view"))])
def get_customer(customer_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    c = db.query(Customer).filter(Customer.id == customer_id, Customer.is_deleted == False).first()  # noqa: E712
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    active_warranties = (
        db.query(func.count(WarrantyRecord.id))
        .filter(
            WarrantyRecord.customer_id == customer_id,
            func.lower(func.trim(WarrantyRecord.status)) == "active",
        )
        .scalar()
        or 0
    )
    return _serialize_customer(c, int(active_warranties or 0))

@router.put('/{customer_id}', dependencies=[Depends(require_permission("customers.edit"))])
def update_customer(customer_id: int, payload: CustomerIn, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    c = db.query(Customer).filter(Customer.id == customer_id, Customer.is_deleted == False).first()  # noqa: E712
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    old = _serialize_customer(c, 0)
    for k, v in _validate_customer_payload(payload).items():
        setattr(c, k, v)
    _log_customer_activity(
        db,
        user_id=current_user.id if current_user else None,
        action="Update",
        customer_id=c.id,
        description=f"Customer {c.name} updated",
        old_value={"name": old["name"], "phone": old["phone"], "email": old["email"]},
        new_value={"name": c.name, "phone": c.phone, "email": c.email},
    )
    db.commit()
    db.refresh(c)
    active_warranties = (
        db.query(func.count(WarrantyRecord.id))
        .filter(
            WarrantyRecord.customer_id == customer_id,
            func.lower(func.trim(WarrantyRecord.status)) == "active",
        )
        .scalar()
        or 0
    )
    return _serialize_customer(c, int(active_warranties or 0))

@router.delete('/{customer_id}', dependencies=[Depends(require_permission("customers.delete"))])
def delete_customer(customer_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    c = db.query(Customer).filter(Customer.id == customer_id, Customer.is_deleted == False).first()  # noqa: E712
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    has_financial_history = (
        db.query(Sale).filter(Sale.customer_id == customer_id).first() is not None
        or db.query(RepairTicket).filter(RepairTicket.customer_id == customer_id).first() is not None
    )
    if has_financial_history:
        raise HTTPException(
            status_code=400,
            detail="Customer has sales/repair history and cannot be deleted. Archive instead.",
        )
    c.is_deleted = True
    c.deleted_at = utcnow()
    c.deleted_by = current_user.id if current_user else None
    c.delete_reason = "Deleted from customer module"
    _log_customer_activity(
        db,
        user_id=current_user.id if current_user else None,
        action="Soft Delete",
        customer_id=c.id,
        description=f"Customer {c.name} archived",
        old_value={"is_deleted": False},
        new_value={"is_deleted": True, "deleted_at": c.deleted_at.isoformat()},
    )
    db.commit()
    return {"ok": True}


@router.post('/{customer_id}/restore', dependencies=[Depends(require_permission("customers.restore"))])
def restore_customer(customer_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    c = db.query(Customer).filter(Customer.id == customer_id, Customer.is_deleted == True).first()  # noqa: E712
    if not c:
        raise HTTPException(status_code=404, detail="Deleted customer not found")
    c.is_deleted = False
    c.deleted_at = None
    c.deleted_by = None
    c.delete_reason = None
    _log_customer_activity(
        db,
        user_id=current_user.id if current_user else None,
        action="Restore",
        customer_id=c.id,
        description=f"Customer {c.name} restored",
        old_value={"is_deleted": True},
        new_value={"is_deleted": False},
    )
    db.commit()
    return {"ok": True, "customer_id": c.id}

@router.get('/{customer_id}/history', dependencies=[Depends(require_permission("customers.view_history"))])
def customer_history(customer_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    customer = db.query(Customer).filter(Customer.id == customer_id, Customer.is_deleted == False).first()  # noqa: E712
    sales = db.query(Sale).filter(Sale.customer_id == customer_id).order_by(Sale.created_at.desc()).all()
    repairs = db.query(RepairTicket).filter(RepairTicket.customer_id == customer_id, RepairTicket.is_deleted == False).order_by(RepairTicket.created_at.desc()).all()  # noqa: E712
    advances = (
        db.query(AdvancePayment)
        .filter(AdvancePayment.customer_id == customer_id, AdvancePayment.is_deleted == False)  # noqa: E712
        .order_by(AdvancePayment.payment_date.desc(), AdvancePayment.id.desc())
        .all()
    )
    reservations = (
        db.query(ProductReservation)
        .filter(ProductReservation.customer_id == customer_id)
        .order_by(ProductReservation.created_at.desc(), ProductReservation.id.desc())
        .all()
    )
    return_cases = (
        db.query(ReturnCase)
        .filter(ReturnCase.customer_id == customer_id)
        .order_by(ReturnCase.created_at.desc())
        .all()
    )
    return_case_ids = [int(row.id) for row in return_cases]
    return_items = (
        db.query(ReturnItem)
        .filter(ReturnItem.return_id.in_(return_case_ids))
        .all()
        if return_case_ids
        else []
    )
    refunds = (
        db.query(RefundPayment)
        .join(ReturnCase, ReturnCase.id == RefundPayment.return_id)
        .filter(ReturnCase.customer_id == customer_id)
        .order_by(RefundPayment.created_at.desc())
        .all()
    )
    exchanges = (
        db.query(ExchangeRecord)
        .join(ReturnCase, ReturnCase.id == ExchangeRecord.return_id)
        .filter(ReturnCase.customer_id == customer_id)
        .order_by(ExchangeRecord.created_at.desc())
        .all()
    )
    return_item_map: dict[int, list[ReturnItem]] = {}
    for item in return_items:
        return_item_map.setdefault(int(item.return_id), []).append(item)
    repair_totals, repair_paid, repair_balances = _repair_financial_maps(db, [int(row.id) for row in repairs])
    unapplied_advances = sum(calc_advance_remaining(row) for row in advances)
    refunded_advances = sum(float(row.refunded_amount or 0) for row in advances)
    return {
        "customer": {
            "id": customer.id,
            "name": customer.name,
            "phone": customer.phone,
            "email": customer.email,
            "address": customer.address,
            "notes": customer.notes,
            "birthday": customer.birthday.isoformat() if customer.birthday else None,
        } if customer else None,
        "sales": [{"id": s.id, "total": s.total, "payment_method": s.payment_method, "created_at": format_iso_utc(s.created_at)} for s in sales],
        "advances": [
            {
                "id": row.id,
                "advance_number": row.advance_number,
                "advance_type": row.advance_type,
                "amount": float(row.amount or 0),
                "applied_amount": float(row.applied_amount or 0),
                "refunded_amount": float(row.refunded_amount or 0),
                "remaining_amount": calc_advance_remaining(row),
                "status": row.status,
                "repair_ticket_id": row.repair_ticket_id,
                "reservation_id": row.reservation_id,
                "invoice_id": row.invoice_id,
                "payment_method": row.payment_method,
                "payment_date": row.payment_date.isoformat() if row.payment_date else None,
            }
            for row in advances
        ],
        "reservations": [
            {
                "id": row.id,
                "reservation_number": row.reservation_number,
                "product_id": row.product_id,
                "requested_product_name": row.requested_product_name,
                "quantity": row.quantity,
                "estimated_total": float(row.estimated_total or 0),
                "advance_paid_total": float(row.advance_paid_total or 0),
                "balance_due": float(row.balance_due or 0),
                "status": row.status,
                "linked_invoice_id": row.linked_invoice_id,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in reservations
        ],
        "advance_summary": {
            "total_advances_received": float(sum(float(row.amount or 0) for row in advances)),
            "unapplied_advances": float(unapplied_advances),
            "refunded_advances": float(refunded_advances),
            "pending_balances": float(sum(float(row.balance_due or 0) for row in reservations)),
        },
        "returns": [
            {
                "id": row.id,
                "return_number": row.return_number,
                "invoice_id": row.original_invoice_id,
                "return_type": row.return_type,
                "reason": row.reason,
                "inspection_status": row.inspection_status,
                "decision_status": row.decision_status,
                "refund_status": row.refund_status,
                "total_return_amount": float(row.total_return_amount or 0),
                "refund_amount": float(row.refund_amount or 0),
                "store_credit_amount": float(row.store_credit_amount or 0),
                "item_count": len(return_item_map.get(int(row.id), [])),
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in return_cases
        ],
        "return_refunds": [
            {
                "id": row.id,
                "refund_number": row.refund_number,
                "return_id": row.return_id,
                "refund_amount": float(row.refund_amount or 0),
                "refund_method": row.refund_method,
                "refund_status": row.refund_status,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in refunds
        ],
        "return_exchanges": [
            {
                "id": row.id,
                "return_id": row.return_id,
                "new_invoice_id": row.new_invoice_id,
                "price_difference": float(row.price_difference or 0),
                "balance_to_pay": float(row.balance_to_pay or 0),
                "balance_to_refund": float(row.balance_to_refund or 0),
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in exchanges
        ],
        "repairs": [
            {
                "id": r.id,
                "ticket_no": r.ticket_no,
                "status": normalize_repair_status(r.status),
                "device_model": r.device_model,
                "created_at": r.created_at.isoformat(),
                "invoice_amount": repair_totals.get(int(r.id), float(r.estimated_cost or 0)),
                "invoice_paid": repair_paid.get(int(r.id), float(r.advance_payment or 0)),
                "invoice_balance": repair_balances.get(int(r.id), max(0.0, float(r.estimated_cost or 0) - float(r.advance_payment or 0))),
            }
            for r in repairs
        ]
    }

@router.get('/{customer_id}/sales', dependencies=[Depends(require_permission("customers.view_history"))])
def customer_sales(customer_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    customer = db.query(Customer).filter(Customer.id == customer_id, Customer.is_deleted == False).first()  # noqa: E712
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    sales = db.query(Sale).filter(Sale.customer_id == customer_id).order_by(Sale.created_at.desc()).all()
    sale_ids = [s.id for s in sales]
    items_by_sale: dict[int, list[dict]] = {sid: [] for sid in sale_ids}
    if sale_ids:
        all_items = db.query(SaleItem).filter(SaleItem.sale_id.in_(sale_ids)).all()
        for item in all_items:
            items_by_sale.setdefault(item.sale_id, []).append({
                "id": item.id,
                "name": item.name,
                "quantity": item.quantity,
                "price": float(item.price or 0),
                "total": float(item.price or 0) * float(item.quantity or 1),
                "is_labor": getattr(item, "is_labor", False),
                "warranty_days": getattr(item, "warranty_days", 0) or 0,
            })
    
    user_ids = list({s.user_id for s in sales if s.user_id})
    users_map = {}
    if user_ids:
        users_map = {u.id: u.name for u in db.query(User).filter(User.id.in_(user_ids)).all()}

    result = []
    for s in sales:
        inv_code = s.invoice_no or f"INV-{s.id:06d}"
        result.append({
            "id": s.id,
            "invoice_no": inv_code,
            "total": float(s.total or 0),
            "subtotal": float(s.subtotal or s.total or 0),
            "amount_paid": float(s.amount_paid or s.total or 0),
            "balance_due": float(s.balance_due or 0),
            "payment_method": s.payment_method or "Cash",
            "cashier_name": users_map.get(s.user_id, "Store Staff"),
            "is_voided": bool(s.is_voided),
            "is_return": bool(s.is_return),
            "items": items_by_sale.get(s.id, []),
            "items_count": len(items_by_sale.get(s.id, [])),
            "created_at": format_iso_utc(s.created_at),
        })
    return result


@router.get('/{customer_id}/warranties', dependencies=[Depends(require_permission("customers.view_history"))])
def customer_warranties(customer_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    customer = db.query(Customer).filter(Customer.id == customer_id, Customer.is_deleted == False).first()  # noqa: E712
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    warranties = (
        db.query(WarrantyRecord)
        .filter(WarrantyRecord.customer_id == customer_id, WarrantyRecord.is_deleted == False)  # noqa: E712
        .order_by(WarrantyRecord.created_at.desc())
        .all()
    )
    now_dt = utcnow()
    res = []
    for w in warranties:
        remaining_days = 0
        if w.end_date:
            try:
                diff = (w.end_date - now_dt).total_seconds() / 86400.0
                remaining_days = max(0, int(diff))
            except Exception:
                remaining_days = 0
        res.append({
            "id": w.id,
            "warranty_code": getattr(w, "warranty_code", None) or f"WAR-{w.id:05d}",
            "product_or_service_name": w.product_or_service_name or "Product / Repair Service",
            "imei_or_serial": w.imei_or_serial or w.serial_number or w.imei or "-",
            "warranty_type": w.warranty_type or "standard",
            "status": w.status or ("active" if remaining_days > 0 else "expired"),
            "warranty_days": w.warranty_days or 0,
            "start_date": format_iso_utc(w.start_date) if w.start_date else None,
            "end_date": format_iso_utc(w.end_date) if w.end_date else None,
            "remaining_days": remaining_days,
            "repair_ticket_id": w.repair_ticket_id,
            "invoice_id": w.invoice_id,
        })
    return res

@router.get('/{customer_id}/repairs', dependencies=[Depends(require_permission("customers.view_history"))])
def customer_repairs(customer_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    customer = db.query(Customer).filter(Customer.id == customer_id, Customer.is_deleted == False).first()  # noqa: E712
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    repairs = db.query(RepairTicket).filter(RepairTicket.customer_id == customer_id, RepairTicket.is_deleted == False).order_by(RepairTicket.created_at.desc()).all()  # noqa: E712
    repair_totals, repair_paid, repair_balances = _repair_financial_maps(db, [int(row.id) for row in repairs])
    return [
        {
            "id": r.id,
            "ticket_no": r.ticket_no,
            "status": normalize_repair_status(r.status),
            "device_model": r.device_model,
            "issue": r.issue,
            "technician": r.technician,
            "estimated_cost": float(r.estimated_cost or 0),
            "advance_payment": float(r.advance_payment or 0),
            "invoice_amount": repair_totals.get(int(r.id), float(r.estimated_cost or 0)),
            "invoice_paid": repair_paid.get(int(r.id), float(r.advance_payment or 0)),
            "invoice_balance": repair_balances.get(int(r.id), max(0.0, float(r.estimated_cost or 0) - float(r.advance_payment or 0))),
            "created_at": format_iso_utc(r.created_at),
            "delivered_at": format_iso_utc(r.delivered_at),
        }
        for r in repairs
    ]


@router.get('/{customer_id}/advances', dependencies=[Depends(require_permission("customers.view_balance"))])
def customer_advances(customer_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    customer = db.query(Customer).filter(Customer.id == customer_id, Customer.is_deleted == False).first()  # noqa: E712
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    advances = (
        db.query(AdvancePayment)
        .filter(AdvancePayment.customer_id == customer_id, AdvancePayment.is_deleted == False)  # noqa: E712
        .order_by(AdvancePayment.payment_date.desc(), AdvancePayment.id.desc())
        .all()
    )
    return [
        {
            "id": row.id,
            "advance_number": row.advance_number,
            "advance_type": row.advance_type,
            "amount": float(row.amount or 0),
            "applied_amount": float(row.applied_amount or 0),
            "refunded_amount": float(row.refunded_amount or 0),
            "remaining_amount": calc_advance_remaining(row),
            "status": row.status,
            "repair_ticket_id": row.repair_ticket_id,
            "reservation_id": row.reservation_id,
            "invoice_id": row.invoice_id,
            "payment_method": row.payment_method,
            "payment_date": row.payment_date.isoformat() if row.payment_date else None,
            "notes": row.notes,
        }
        for row in advances
    ]
