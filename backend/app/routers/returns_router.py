from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_permission
from app.database import get_db
from app.models import DamagedStockRecord, ExchangeRecord, RefundPayment, StoreCredit
from app.services.print_rendering_service import get_store_profile_print_data, render_return_receipt_html
from app.schemas import (
    DamagedStockActionIn,
    RefundApproveIn,
    RefundCancelIn,
    RefundMarkPaidIn,
    ReturnApproveIn,
    ReturnCancelIn,
    ReturnCloseIn,
    ReturnCreateIn,
    ReturnExchangeIn,
    ReturnExchangeInvoiceIn,
    ReturnInspectIn,
    ReturnItemCreateIn,
    ReturnRefundCreateIn,
    ReturnRejectIn,
    ReturnStoreCreditCreateIn,
    StoreCreditUseIn,
)
from app.services.returns_management_service import (
    DAMAGED_ACTIONS,
    REFUND_METHODS,
    REFUND_STATUSES,
    RETURN_DECISION_STATUSES,
    RETURN_INSPECTION_STATUSES,
    RETURN_ITEM_CONDITIONS,
    RETURN_REFUND_STATUSES,
    RETURN_RESTOCK_ACTIONS,
    RETURN_TYPES,
    STORE_CREDIT_STATUSES,
    approve_refund_payment,
    approve_return_case,
    cancel_refund_payment,
    cancel_return_case,
    close_return_case,
    create_exchange,
    create_exchange_invoice,
    create_refund_payment,
    create_return_case,
    eligible_items_for_invoice,
    get_return_case_or_404,
    get_return_reasons,
    get_return_rules,
    inspect_return_case,
    issue_store_credit,
    list_customer_store_credits,
    list_return_cases,
    lookup_invoice,
    mark_refund_payment_paid,
    reject_return_case,
    returns_summary_report,
    serialize_return_case,
    update_damaged_stock_action,
    use_store_credit,
)

router = APIRouter(tags=["returns"])

LEGACY_RETURN_TYPE_MAP = {
    "product_return": "return",
    "return": "return",
    "refund": "refund",
    "exchange": "exchange",
    "warranty_replacement": "warranty_replacement",
    "store_credit": "store_credit",
}

LEGACY_ITEM_CONDITION_MAP = {
    "reusable": "sellable",
    "sellable": "sellable",
    "damaged": "damaged",
    "opened": "opened",
    "defective": "defective",
    "missing_parts": "missing_parts",
}


def _device_session_tag(request: Request) -> str | None:
    req_id = getattr(request.state, "request_id", None)
    sid = None
    auth_session = getattr(request.state, "auth_session", None)
    if auth_session is not None:
        sid = getattr(auth_session, "session_code", None)
    if req_id and sid:
        return f"{sid}:{req_id}"
    if req_id:
        return str(req_id)
    if sid:
        return str(sid)
    return None


def _serialize_store_credit(row: StoreCredit) -> dict[str, Any]:
    return {
        "id": row.id,
        "credit_number": row.credit_number,
        "customer_id": row.customer_id,
        "return_id": row.return_id,
        "amount": float(row.amount or 0),
        "remaining_amount": float(row.remaining_amount or 0),
        "status": row.status,
        "expiry_date": row.expiry_date.isoformat() if row.expiry_date else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "created_by": row.created_by,
    }


def _serialize_refund(row: RefundPayment) -> dict[str, Any]:
    return {
        "id": row.id,
        "refund_number": row.refund_number,
        "return_id": row.return_id,
        "original_payment_id": row.original_payment_id,
        "customer_id": row.customer_id,
        "refund_amount": float(row.refund_amount or 0),
        "refund_method": row.refund_method,
        "refund_status": row.refund_status,
        "approved_by": row.approved_by,
        "paid_by": row.paid_by,
        "paid_at": row.paid_at.isoformat() if row.paid_at else None,
        "notes": row.notes,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _serialize_exchange(row: ExchangeRecord) -> dict[str, Any]:
    return {
        "id": row.id,
        "exchange_number": row.exchange_number,
        "return_id": row.return_id,
        "old_invoice_item_id": row.old_invoice_item_id,
        "old_product_id": row.old_product_id,
        "new_product_id": row.new_product_id,
        "new_invoice_id": row.new_invoice_id,
        "price_difference": float(row.price_difference or 0),
        "balance_to_pay": float(row.balance_to_pay or 0),
        "balance_to_refund": float(row.balance_to_refund or 0),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "created_by": row.created_by,
    }


def _serialize_damaged(row: DamagedStockRecord) -> dict[str, Any]:
    return {
        "id": row.id,
        "return_item_id": row.return_item_id,
        "product_id": row.product_id,
        "serial_id": row.serial_id,
        "quantity": int(row.quantity or 0),
        "damage_reason": row.damage_reason,
        "action": row.action,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "created_by": row.created_by,
    }


@router.get("/returns/meta", dependencies=[Depends(require_permission("returns.view"))])
def returns_meta(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return {
        "return_types": sorted(list(RETURN_TYPES)),
        "inspection_statuses": sorted(list(RETURN_INSPECTION_STATUSES)),
        "decision_statuses": sorted(list(RETURN_DECISION_STATUSES)),
        "refund_statuses": sorted(list(RETURN_REFUND_STATUSES)),
        "item_conditions": sorted(list(RETURN_ITEM_CONDITIONS)),
        "restock_actions": sorted(list(RETURN_RESTOCK_ACTIONS)),
        "refund_methods": sorted(list(REFUND_METHODS)),
        "refund_payment_statuses": sorted(list(REFUND_STATUSES)),
        "store_credit_statuses": sorted(list(STORE_CREDIT_STATUSES)),
        "damaged_actions": sorted(list(DAMAGED_ACTIONS)),
        "return_reasons": get_return_reasons(db),
        "rules": get_return_rules(db),
    }


@router.get("/returns/reports/summary", dependencies=[Depends(require_permission("returns.report"))])
def returns_report_summary(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    customer_id: int | None = Query(default=None),
    product_id: int | None = Query(default=None),
    cashier: int | None = Query(default=None),
    manager: int | None = Query(default=None),
    reason: str | None = Query(default=None),
    status: str | None = Query(default=None),
    refund_method: str | None = Query(default=None),
    limit: int = Query(default=5000, ge=1, le=20000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    return returns_summary_report(
        db,
        date_from=date_from,
        date_to=date_to,
        customer_id=customer_id,
        product_id=product_id,
        cashier_id=cashier,
        manager_id=manager,
        return_reason=reason,
        return_status=status,
        refund_method=refund_method,
        limit=limit,
    )


@router.get("/returns/reports/refunds", dependencies=[Depends(require_permission("returns.report"))])
def returns_report_refunds(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    method: str | None = Query(default=None),
    limit: int = Query(default=5000, ge=1, le=20000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(RefundPayment)
    if method and method.lower() != "all":
        query = query.filter(RefundPayment.refund_method == str(method).strip().lower())
    if date_from:
        try:
            query = query.filter(RefundPayment.created_at >= datetime.fromisoformat(str(date_from)))
        except Exception:
            pass
    if date_to:
        try:
            query = query.filter(RefundPayment.created_at < datetime.fromisoformat(str(date_to)))
        except Exception:
            pass
    rows = query.order_by(RefundPayment.created_at.desc()).limit(int(limit)).all()
    return {
        "total_refunds": round(sum(float(row.refund_amount or 0) for row in rows if row.refund_status == "paid"), 2),
        "rows": [_serialize_refund(row) for row in rows],
    }


@router.get("/returns/reports/exchanges", dependencies=[Depends(require_permission("returns.report"))])
def returns_report_exchanges(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    limit: int = Query(default=5000, ge=1, le=20000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(ExchangeRecord)
    if date_from:
        try:
            query = query.filter(ExchangeRecord.created_at >= datetime.fromisoformat(str(date_from)))
        except Exception:
            pass
    if date_to:
        try:
            query = query.filter(ExchangeRecord.created_at < datetime.fromisoformat(str(date_to)))
        except Exception:
            pass
    rows = query.order_by(ExchangeRecord.created_at.desc()).limit(int(limit)).all()
    return {
        "exchange_count": len(rows),
        "balance_to_pay_total": round(sum(float(row.balance_to_pay or 0) for row in rows), 2),
        "balance_to_refund_total": round(sum(float(row.balance_to_refund or 0) for row in rows), 2),
        "rows": [_serialize_exchange(row) for row in rows],
    }


@router.get("/returns/reports/damaged-stock", dependencies=[Depends(require_permission("returns.report"))])
def returns_report_damaged_stock(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    limit: int = Query(default=5000, ge=1, le=20000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(DamagedStockRecord)
    if date_from:
        try:
            query = query.filter(DamagedStockRecord.created_at >= datetime.fromisoformat(str(date_from)))
        except Exception:
            pass
    if date_to:
        try:
            query = query.filter(DamagedStockRecord.created_at < datetime.fromisoformat(str(date_to)))
        except Exception:
            pass
    rows = query.order_by(DamagedStockRecord.created_at.desc()).limit(int(limit)).all()
    return {
        "damaged_count": len(rows),
        "loss_quantity": int(sum(int(row.quantity or 0) for row in rows)),
        "rows": [_serialize_damaged(row) for row in rows],
    }


@router.get("/returns/lookup-invoice/{invoice_number}", dependencies=[Depends(require_permission("returns.view"))])
def returns_lookup_invoice(
    invoice_number: str,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    return lookup_invoice(db, invoice_number)


@router.get("/returns/invoice-lookup/{invoice_ref}", dependencies=[Depends(require_permission("returns.view"))])
def returns_lookup_invoice_legacy(
    invoice_ref: str,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    token = str(invoice_ref or "").strip()
    if token.isdigit():
        return eligible_items_for_invoice(db, int(token))
    payload = lookup_invoice(db, token)
    return payload.get("selected_invoice") or {}


@router.get("/returns/invoice/{invoice_id}/eligible-items", dependencies=[Depends(require_permission("returns.view"))])
def returns_invoice_eligible_items(
    invoice_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    return eligible_items_for_invoice(db, invoice_id)


@router.get("/returns", dependencies=[Depends(require_permission("returns.view"))])
def list_returns(
    q: str | None = Query(default=None),
    return_type: str | None = Query(default=None),
    inspection_status: str | None = Query(default=None),
    decision_status: str | None = Query(default=None),
    refund_status: str | None = Query(default=None),
    customer_id: int | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    rows = list_return_cases(
        db,
        q=q,
        return_type=return_type,
        inspection_status=inspection_status,
        decision_status=decision_status,
        refund_status=refund_status,
        customer_id=customer_id,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
    )
    return [serialize_return_case(db, row, include_items=False) for row in rows]


@router.post("/returns", dependencies=[Depends(require_permission("returns.create"))])
def create_returns(
    payload: ReturnCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = create_return_case(
        db,
        payload=payload,
        actor=current_user,
        device_session=_device_session_tag(request),
    )
    db.commit()
    db.refresh(row)
    return serialize_return_case(db, row, include_items=True)


@router.post("/returns/records", dependencies=[Depends(require_permission("returns.create"))])
def create_returns_legacy(
    payload: dict[str, Any],
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    raw_type = str(payload.get("return_type") or "return").strip().lower().replace(" ", "_")
    return_type = LEGACY_RETURN_TYPE_MAP.get(raw_type, raw_type)
    raw_condition = str(payload.get("item_condition") or "sellable").strip().lower().replace(" ", "_")
    item_condition = LEGACY_ITEM_CONDITION_MAP.get(raw_condition, raw_condition)

    invoice_item_id = payload.get("original_sale_item_id")
    if invoice_item_id is None:
        invoice_item_id = payload.get("original_invoice_item_id")
    reason = str(payload.get("return_reason") or payload.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="return_reason is required")

    item_payload = ReturnItemCreateIn(
        original_invoice_item_id=int(invoice_item_id) if invoice_item_id is not None else None,
        product_id=int(payload.get("product_id")) if payload.get("product_id") is not None else None,
        serial_id=int(payload.get("serial_id")) if payload.get("serial_id") is not None else None,
        quantity=max(1, int(payload.get("quantity") or 1)),
        unit_price=float(payload.get("unit_price") or 0),
        item_condition=item_condition,
        notes=payload.get("notes"),
    )
    create_payload = ReturnCreateIn(
        original_invoice_id=int(payload.get("original_invoice_id")) if payload.get("original_invoice_id") is not None else None,
        customer_id=int(payload.get("customer_id")) if payload.get("customer_id") is not None else None,
        return_type=return_type,
        reason=reason,
        notes=payload.get("notes"),
        manual_exception=bool(payload.get("manual_exception") or False),
        requested_resolution=str(payload.get("requested_resolution") or "refund"),
        items=[item_payload],
    )
    row = create_return_case(
        db,
        payload=create_payload,
        actor=current_user,
        device_session=_device_session_tag(request),
    )
    db.commit()
    db.refresh(row)
    return {
        "ok": True,
        "id": row.id,
        "return_id": row.return_number,
        "return_number": row.return_number,
    }


@router.get("/returns/{id}", dependencies=[Depends(require_permission("returns.view"))])
def get_return(
    id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = get_return_case_or_404(db, id)
    return serialize_return_case(db, row, include_items=True)


@router.get("/returns/{id}/receipt/html", dependencies=[Depends(require_permission("returns.print"))], response_class=HTMLResponse)
def print_return_receipt(
    id: int,
    paper: str = Query(default="thermal_80"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = get_return_case_or_404(db, id)
    payload = serialize_return_case(db, row, include_items=True)
    store = get_store_profile_print_data(db)
    return HTMLResponse(render_return_receipt_html(payload, store, thermal=str(paper).lower() != "a4"))


@router.patch("/returns/{id}/inspect", dependencies=[Depends(require_permission("returns.inspect"))])
def inspect_return(
    id: int,
    payload: ReturnInspectIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = get_return_case_or_404(db, id)
    inspect_return_case(
        db,
        return_case=row,
        payload=payload,
        actor=current_user,
        device_session=_device_session_tag(request),
    )
    db.commit()
    db.refresh(row)
    return serialize_return_case(db, row, include_items=True)


@router.patch("/returns/{id}/approve", dependencies=[Depends(require_permission("returns.approve"))])
def approve_return(
    id: int,
    payload: ReturnApproveIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = get_return_case_or_404(db, id)
    approve_return_case(
        db,
        return_case=row,
        actor=current_user,
        notes=payload.notes,
        device_session=_device_session_tag(request),
    )
    db.commit()
    db.refresh(row)
    return serialize_return_case(db, row, include_items=True)


@router.patch("/returns/{id}/reject", dependencies=[Depends(require_permission("returns.reject"))])
def reject_return(
    id: int,
    payload: ReturnRejectIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = get_return_case_or_404(db, id)
    reject_return_case(
        db,
        return_case=row,
        reason=payload.rejection_reason,
        notes=payload.notes,
        actor=current_user,
        device_session=_device_session_tag(request),
    )
    db.commit()
    db.refresh(row)
    return serialize_return_case(db, row, include_items=True)


@router.patch("/returns/{id}/close", dependencies=[Depends(require_permission("returns.approve"))])
def close_return(
    id: int,
    payload: ReturnCloseIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = get_return_case_or_404(db, id)
    close_return_case(
        db,
        return_case=row,
        notes=payload.notes,
        actor=current_user,
        device_session=_device_session_tag(request),
    )
    db.commit()
    db.refresh(row)
    return serialize_return_case(db, row, include_items=True)


@router.patch("/returns/{id}/cancel", dependencies=[Depends(require_permission("returns.cancel"))])
def cancel_return(
    id: int,
    payload: ReturnCancelIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = get_return_case_or_404(db, id)
    cancel_return_case(
        db,
        return_case=row,
        reason=payload.reason,
        notes=payload.notes,
        actor=current_user,
        device_session=_device_session_tag(request),
    )
    db.commit()
    db.refresh(row)
    return serialize_return_case(db, row, include_items=True)


@router.post("/returns/{return_id}/refund", dependencies=[Depends(require_permission("returns.refund"))])
def create_refund(
    return_id: int,
    payload: ReturnRefundCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = get_return_case_or_404(db, return_id)
    refund = create_refund_payment(
        db,
        return_case=row,
        payload=payload,
        actor=current_user,
        device_session=_device_session_tag(request),
    )
    db.commit()
    db.refresh(refund)
    return _serialize_refund(refund)


@router.patch("/refunds/{refund_id}/approve", dependencies=[Depends(require_permission("returns.approve"))])
def approve_refund(
    refund_id: int,
    payload: RefundApproveIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(RefundPayment).filter(RefundPayment.id == refund_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Refund not found")
    approve_refund_payment(
        db,
        refund=row,
        actor=current_user,
        notes=payload.notes,
        device_session=_device_session_tag(request),
    )
    db.commit()
    db.refresh(row)
    return _serialize_refund(row)


@router.patch("/refunds/{refund_id}/mark-paid", dependencies=[Depends(require_permission("returns.refund"))])
def mark_refund_paid(
    refund_id: int,
    payload: RefundMarkPaidIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(RefundPayment).filter(RefundPayment.id == refund_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Refund not found")
    mark_refund_payment_paid(
        db,
        refund=row,
        actor=current_user,
        notes=payload.notes,
        paid_at=payload.paid_at,
        device_session=_device_session_tag(request),
    )
    db.commit()
    db.refresh(row)
    return _serialize_refund(row)


@router.patch("/refunds/{refund_id}/cancel", dependencies=[Depends(require_permission("returns.cancel"))])
def cancel_refund(
    refund_id: int,
    payload: RefundCancelIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(RefundPayment).filter(RefundPayment.id == refund_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Refund not found")
    cancel_refund_payment(
        db,
        refund=row,
        reason=payload.reason,
        notes=payload.notes,
        actor=current_user,
        device_session=_device_session_tag(request),
    )
    db.commit()
    db.refresh(row)
    return _serialize_refund(row)


@router.post("/returns/{return_id}/exchange", dependencies=[Depends(require_permission("returns.exchange"))])
def create_exchange_for_return(
    return_id: int,
    payload: ReturnExchangeIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = get_return_case_or_404(db, return_id)
    exchange = create_exchange(
        db,
        return_case=row,
        payload=payload,
        actor=current_user,
        device_session=_device_session_tag(request),
    )
    db.commit()
    db.refresh(exchange)
    return _serialize_exchange(exchange)


@router.post("/returns/{return_id}/exchange/create-invoice", dependencies=[Depends(require_permission("returns.exchange"))])
def create_exchange_invoice_endpoint(
    return_id: int,
    payload: ReturnExchangeInvoiceIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = get_return_case_or_404(db, return_id)
    sale = create_exchange_invoice(
        db,
        return_case=row,
        payload=payload,
        actor=current_user,
        device_session=_device_session_tag(request),
    )
    db.commit()
    return {
        "sale_id": sale.id,
        "invoice_no": sale.invoice_no or f"EXC-{sale.id:05d}",
        "customer_id": sale.customer_id,
        "total": float(sale.total or 0),
        "paid": bool(sale.paid),
        "amount_paid": float(sale.amount_paid or 0),
        "balance_due": float(sale.balance_due or 0),
        "payment_status": sale.payment_status,
    }


@router.post("/returns/{return_id}/store-credit", dependencies=[Depends(require_permission("returns.store_credit"))])
def create_store_credit_for_return(
    return_id: int,
    payload: ReturnStoreCreditCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = get_return_case_or_404(db, return_id)
    credit = issue_store_credit(
        db,
        return_case=row,
        amount=payload.amount,
        expiry_date=payload.expiry_date,
        notes=payload.notes,
        actor=current_user,
        device_session=_device_session_tag(request),
    )
    db.commit()
    db.refresh(credit)
    return _serialize_store_credit(credit)


@router.get("/store-credits/customer/{customer_id}", dependencies=[Depends(require_permission("returns.view"))])
def list_store_credits_by_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    rows = list_customer_store_credits(db, customer_id)
    db.commit()
    return [_serialize_store_credit(row) for row in rows]


@router.patch("/store-credits/{id}/use", dependencies=[Depends(require_permission("returns.store_credit"))])
def use_store_credit_endpoint(
    id: int,
    payload: StoreCreditUseIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(StoreCredit).filter(StoreCredit.id == id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Store credit not found")
    use_store_credit(
        db,
        credit=row,
        amount=payload.amount,
        invoice_id=payload.invoice_id,
        notes=payload.notes,
        override_customer_restriction=payload.override_customer_restriction,
        actor=current_user,
        device_session=_device_session_tag(request),
    )
    db.commit()
    db.refresh(row)
    return _serialize_store_credit(row)


@router.get("/damaged-stock", dependencies=[Depends(require_permission("returns.view"))])
def list_damaged_stock(
    product_id: int | None = Query(default=None),
    action: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=5000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(DamagedStockRecord)
    if product_id:
        query = query.filter(DamagedStockRecord.product_id == int(product_id))
    if action and action.lower() != "all":
        query = query.filter(DamagedStockRecord.action == str(action).strip().lower())
    if date_from:
        try:
            query = query.filter(DamagedStockRecord.created_at >= datetime.fromisoformat(str(date_from)))
        except Exception:
            pass
    if date_to:
        try:
            query = query.filter(DamagedStockRecord.created_at < datetime.fromisoformat(str(date_to)))
        except Exception:
            pass
    rows = query.order_by(DamagedStockRecord.created_at.desc()).limit(int(limit)).all()
    return [_serialize_damaged(row) for row in rows]


@router.patch("/damaged-stock/{id}/action", dependencies=[Depends(require_permission("returns.approve"))])
def update_damaged_stock(
    id: int,
    payload: DamagedStockActionIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(DamagedStockRecord).filter(DamagedStockRecord.id == id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Damaged stock record not found")
    update_damaged_stock_action(
        db,
        record=row,
        action=payload.action,
        note=payload.note,
        actor=current_user,
        device_session=_device_session_tag(request),
    )
    db.commit()
    db.refresh(row)
    return _serialize_damaged(row)
