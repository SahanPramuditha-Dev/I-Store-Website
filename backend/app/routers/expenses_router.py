from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_permission
from app.database import get_db
from app.models import ActivityLog, Expense, Supplier, User
from app.schemas import ExpenseDecisionIn, ExpenseIn, ExpenseUpdateIn
from app.services.accounting_ledger_service import record_ledger_entry
from app.services.approval_service import consume_approval_request
from app.services.domain_audit_service import assert_accounting_period_open, record_domain_audit
from app.services.security_service import has_permission
from app.utils.money import add as money_add
from app.utils.money import to_float
from app.utils.time import utcnow

router = APIRouter(prefix="/expenses", tags=["expenses"])

EXPENSE_STATUSES = {"Pending Approval", "Approved", "Rejected", "Paid", "Cancelled"}


def _parse_iso(value: str | None, *, end_exclusive: bool = False) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    if end_exclusive:
        parsed = parsed + timedelta(days=1)
    return parsed


def _normalize_status(value: str | None) -> str:
    raw = str(value or "").strip().lower()
    mapping = {
        "pending": "Pending Approval",
        "pending approval": "Pending Approval",
        "approved": "Approved",
        "rejected": "Rejected",
        "paid": "Paid",
        "cancelled": "Cancelled",
        "canceled": "Cancelled",
    }
    return mapping.get(raw, "Pending Approval")


def _next_expense_code(db: Session) -> str:
    day_prefix = utcnow().strftime("%Y%m%d")
    like_prefix = f"EXP-{day_prefix}-%"
    today_count = db.query(Expense).filter(Expense.expense_code.like(like_prefix)).count()
    return f"EXP-{day_prefix}-{today_count + 1:04d}"


def _display_user(user: User | None) -> str | None:
    if not user:
        return None
    return user.full_name or user.username or f"User #{user.id}"


def _serialize_expense(row: Expense) -> dict[str, Any]:
    return {
        "id": row.id,
        "expense_code": row.expense_code,
        "expense_date": row.expense_date.isoformat() if row.expense_date else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "category": row.category,
        "description": row.description,
        "amount": float(row.amount or 0),
        "tax_amount": float(row.tax_amount or 0),
        "payment_method": row.payment_method,
        "status": row.status,
        "supplier_id": row.supplier_id,
        "supplier_name": row.supplier.name if row.supplier else None,
        "vendor_name": row.vendor_name or (row.supplier.name if row.supplier else None),
        "reference_no": row.reference_no,
        "is_recurring": bool(row.is_recurring),
        "recurring_cycle": row.recurring_cycle,
        "receipt_attachment": row.receipt_attachment,
        "notes": row.notes,
        "created_by_user_id": row.created_by_user_id,
        "created_by_name": _display_user(row.created_by),
        "approved_by_user_id": row.approved_by_user_id,
        "approved_by_name": _display_user(row.approved_by),
        "approved_at": row.approved_at.isoformat() if row.approved_at else None,
        "rejection_reason": row.rejection_reason,
        "paid_at": row.paid_at.isoformat() if row.paid_at else None,
        # Compatibility aliases used in older report components.
        "po_number": row.expense_code,
        "total_cost": float(row.amount or 0),
        "note": row.description or row.notes,
    }


def _log_activity(
    db: Session,
    *,
    user_id: int | None,
    action: str,
    entity_id: int,
    description: str,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
) -> None:
    db.add(
        ActivityLog(
            user_id=user_id,
            action=action,
            entity_type="Expense",
            entity_id=entity_id,
            description=description,
            old_value=None if old_value is None else str(old_value),
            new_value=None if new_value is None else str(new_value),
            is_reversible=action in {"Create", "Update"},
            is_reversed=False,
        )
    )


def _require_expense_decision_permission(db: Session, user: User | None, action: str) -> None:
    normalized = str(action or "").strip().lower()
    permission = "expenses.reject" if normalized == "reject" else "expenses.approve"
    if not has_permission(db, user, permission):
        raise HTTPException(status_code=403, detail=f"Permission denied: {permission}")


def _apply_decision(row: Expense, payload: ExpenseDecisionIn, actor: User | None) -> None:
    action = str(payload.action or "").strip().lower()
    note = (payload.note or "").strip() or None
    now = utcnow()
    if action == "approve":
        row.status = "Approved"
        row.approved_by_user_id = actor.id if actor else None
        row.approved_at = now
        row.rejection_reason = None
    elif action == "reject":
        row.status = "Rejected"
        row.approved_by_user_id = actor.id if actor else None
        row.approved_at = now
        row.rejection_reason = note or "Rejected"
    elif action == "paid":
        row.status = "Paid"
        row.approved_by_user_id = row.approved_by_user_id or (actor.id if actor else None)
        row.approved_at = row.approved_at or now
        row.paid_at = now
        row.rejection_reason = None
    elif action == "cancel":
        row.status = "Cancelled"
    elif action == "pending":
        row.status = "Pending Approval"
        row.approved_by_user_id = None
        row.approved_at = None
        row.rejection_reason = None
        row.paid_at = None
    else:
        raise HTTPException(status_code=400, detail="Invalid action. Use approve, reject, paid, cancel, or pending.")
    if note:
        row.notes = "\n".join([part for part in [row.notes, f"[Decision] {note}"] if part])


@router.get("", dependencies=[Depends(require_permission("expenses.view"))])
def list_expenses(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    status: str | None = Query(default=None),
    category: str | None = Query(default=None),
    recurring: bool | None = Query(default=None),
    search: str | None = Query(default=None),
    limit: int = Query(default=1000, ge=1, le=5000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(Expense).options(
        joinedload(Expense.created_by),
        joinedload(Expense.approved_by),
        joinedload(Expense.supplier),
    ).filter(Expense.is_deleted == False)  # noqa: E712
    start = _parse_iso(date_from)
    end = _parse_iso(date_to, end_exclusive=True)
    if start:
        query = query.filter(Expense.expense_date >= start)
    if end:
        query = query.filter(Expense.expense_date < end)
    if status:
        normalized = _normalize_status(status)
        query = query.filter(Expense.status == normalized)
    if category:
        query = query.filter(Expense.category == category)
    if recurring is not None:
        query = query.filter(Expense.is_recurring == bool(recurring))
    if search:
        text = f"%{str(search).strip()}%"
        query = query.filter(
            Expense.expense_code.ilike(text)
            | Expense.category.ilike(text)
            | Expense.description.ilike(text)
            | Expense.vendor_name.ilike(text)
            | Expense.reference_no.ilike(text)
            | Expense.notes.ilike(text)
        )
    rows = query.order_by(Expense.expense_date.desc(), Expense.created_at.desc()).limit(limit).all()
    return [_serialize_expense(row) for row in rows]


@router.get("/summary", dependencies=[Depends(require_permission("expenses.report"))])
def expense_summary(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(Expense).filter(Expense.is_deleted == False)  # noqa: E712
    start = _parse_iso(date_from)
    end = _parse_iso(date_to, end_exclusive=True)
    if start:
        query = query.filter(Expense.expense_date >= start)
    if end:
        query = query.filter(Expense.expense_date < end)

    total_amount = to_float(query.with_entities(func.coalesce(func.sum(Expense.amount), 0)).scalar() or 0)
    records = int(query.with_entities(func.count(Expense.id)).scalar() or 0)
    status_rows = query.with_entities(
        Expense.status,
        func.coalesce(func.sum(Expense.amount), 0),
        func.count(Expense.id),
    ).group_by(Expense.status).all()
    by_status = {status: 0.0 for status in sorted(EXPENSE_STATUSES)}
    by_status_count = {status: 0 for status in sorted(EXPENSE_STATUSES)}
    for status, total, count in status_rows:
        key = status or "Pending Approval"
        by_status[key] = to_float(total)
        by_status_count[key] = int(count or 0)

    by_category_rows = (
        query.with_entities(
            Expense.category,
            func.coalesce(func.sum(Expense.amount), 0),
            func.count(Expense.id),
        )
        .group_by(Expense.category)
        .order_by(func.sum(Expense.amount).desc())
        .all()
    )

    return {
        "total_expenses": total_amount,
        "records": records,
        "pending_count": by_status_count.get("Pending Approval", 0),
        "approved_count": by_status_count.get("Approved", 0),
        "paid_count": by_status_count.get("Paid", 0),
        "rejected_count": by_status_count.get("Rejected", 0),
        "by_status_amount": by_status,
        "by_category": [
            {"category": category or "Uncategorized", "total": to_float(total), "count": int(count or 0)}
            for category, total, count in by_category_rows
        ],
    }


@router.get("/{expense_id}", dependencies=[Depends(require_permission("expenses.view"))])
def get_expense(expense_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    row = (
        db.query(Expense)
        .options(joinedload(Expense.created_by), joinedload(Expense.approved_by), joinedload(Expense.supplier))
        .filter(Expense.id == expense_id, Expense.is_deleted == False)  # noqa: E712
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Expense not found")
    return _serialize_expense(row)


@router.post("", dependencies=[Depends(require_permission("expenses.create"))])
def create_expense(payload: ExpenseIn, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    assert_accounting_period_open(db, when=payload.expense_date or utcnow(), action="create expense")
    amount = to_float(payload.amount)
    tax_amount = to_float(payload.tax_amount)
    if amount < 0:
        raise HTTPException(status_code=400, detail="Amount must be non-negative")
    if tax_amount < 0:
        raise HTTPException(status_code=400, detail="Tax amount must be non-negative")
    category = str(payload.category or "").strip()
    if not category:
        raise HTTPException(status_code=400, detail="category is required")

    if payload.supplier_id:
        supplier = db.query(Supplier).filter(Supplier.id == payload.supplier_id).first()
        if not supplier:
            raise HTTPException(status_code=404, detail="Supplier not found")

    row = Expense(
        expense_code=_next_expense_code(db),
        expense_date=payload.expense_date or utcnow(),
        category=category,
        description=payload.description,
        amount=amount,
        tax_amount=tax_amount,
        payment_method=payload.payment_method or "Cash",
        status="Pending Approval",
        supplier_id=payload.supplier_id,
        vendor_name=payload.vendor_name,
        reference_no=payload.reference_no,
        is_recurring=bool(payload.is_recurring),
        recurring_cycle=payload.recurring_cycle,
        receipt_attachment=payload.receipt_attachment,
        notes=payload.notes,
        created_by_user_id=current_user.id if current_user else None,
    )
    db.add(row)
    db.flush()
    _log_activity(
        db,
        user_id=current_user.id if current_user else None,
        action="Create",
        entity_id=row.id,
        description=f"Expense {row.expense_code} created ({row.category})",
        new_value={"amount": row.amount, "status": row.status},
    )
    record_ledger_entry(
        db,
        module="expenses",
        entry_type="expense_created",
        direction="debit",
        amount=to_float(money_add(row.amount, row.tax_amount)),
        account_code="operating_expense",
        reference_type="expense",
        reference_id=row.id,
        reference_number=row.expense_code,
        source_table="expenses",
        source_id=row.id,
        counterparty_type="supplier" if row.supplier_id else "vendor",
        counterparty_id=row.supplier_id,
        counterparty_name=row.vendor_name or (row.supplier.name if row.supplier else None),
        description=f"Expense {row.expense_code}: {row.category}",
        metadata={"status": row.status, "payment_method": row.payment_method, "tax_amount": row.tax_amount},
        user=current_user,
        entry_date=row.expense_date,
    )
    db.commit()
    db.refresh(row)
    return _serialize_expense(row)


@router.put("/{expense_id}", dependencies=[Depends(require_permission("expenses.edit"))])
def update_expense(
    expense_id: int,
    payload: ExpenseUpdateIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(Expense).filter(Expense.id == expense_id, Expense.is_deleted == False).first()  # noqa: E712
    if not row:
        raise HTTPException(status_code=404, detail="Expense not found")
    assert_accounting_period_open(db, when=row.expense_date or row.created_at or utcnow(), action="update expense")
    if row.status == "Paid":
        raise HTTPException(status_code=400, detail="Paid expenses are immutable")

    old = _serialize_expense(row)
    updates = payload.model_dump(exclude_unset=True)
    if "amount" in updates:
        updates["amount"] = to_float(updates["amount"])
        if updates["amount"] < 0:
            raise HTTPException(status_code=400, detail="Amount must be non-negative")
    if "tax_amount" in updates:
        updates["tax_amount"] = to_float(updates["tax_amount"])
        if updates["tax_amount"] < 0:
            raise HTTPException(status_code=400, detail="Tax amount must be non-negative")
    if "status" in updates and _normalize_status(updates["status"]) not in EXPENSE_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")

    if "status" in updates:
        updates["status"] = _normalize_status(updates["status"])
    if "category" in updates and not str(updates["category"] or "").strip():
        raise HTTPException(status_code=400, detail="category cannot be empty")
    if "category" in updates:
        updates["category"] = str(updates["category"]).strip()

    if "supplier_id" in updates and updates["supplier_id"]:
        supplier = db.query(Supplier).filter(Supplier.id == updates["supplier_id"]).first()
        if not supplier:
            raise HTTPException(status_code=404, detail="Supplier not found")

    for key, value in updates.items():
        setattr(row, key, value)

    _log_activity(
        db,
        user_id=current_user.id if current_user else None,
        action="Update",
        entity_id=row.id,
        description=f"Expense {row.expense_code} updated",
        old_value={"amount": old["amount"], "status": old["status"]},
        new_value={"amount": row.amount, "status": row.status},
    )
    db.commit()
    db.refresh(row)
    return _serialize_expense(row)


@router.put("/{expense_id}/approve", dependencies=[Depends(require_permission("expenses.approve"))])
def approve_expense(
    expense_id: int,
    payload: ExpenseDecisionIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _require_expense_decision_permission(db, current_user, payload.action)
    row = db.query(Expense).filter(Expense.id == expense_id, Expense.is_deleted == False).first()  # noqa: E712
    if not row:
        raise HTTPException(status_code=404, detail="Expense not found")
    assert_accounting_period_open(db, when=row.expense_date or row.created_at or utcnow(), action="approve expense")
    old_status = row.status
    _apply_decision(row, payload, current_user)
    _log_activity(
        db,
        user_id=current_user.id if current_user else None,
        action="Approve",
        entity_id=row.id,
        description=f"Expense {row.expense_code} decision: {payload.action}",
        old_value={"status": old_status},
        new_value={"status": row.status},
    )
    record_domain_audit(
        db,
        module="expenses",
        action="decision_applied",
        target_type="Expense",
        target_id=row.id,
        user=current_user,
        old_value={"status": old_status},
        new_value={"status": row.status},
        reason=payload.note,
        permission="expenses.approve" if str(payload.action or "").lower() != "reject" else "expenses.reject",
    )
    if str(payload.action or "").strip().lower() == "paid":
        record_ledger_entry(
            db,
            module="expenses",
            entry_type="expense_paid",
            direction="credit",
            amount=to_float(money_add(row.amount, row.tax_amount)),
            account_code="cash_or_bank",
            reference_type="expense",
            reference_id=row.id,
            reference_number=row.expense_code,
            source_table="expenses",
            source_id=row.id,
            counterparty_type="supplier" if row.supplier_id else "vendor",
            counterparty_id=row.supplier_id,
            counterparty_name=row.vendor_name or (row.supplier.name if row.supplier else None),
            description=f"Expense paid {row.expense_code}",
            metadata={"old_status": old_status, "new_status": row.status, "payment_method": row.payment_method},
            user=current_user,
            entry_date=row.paid_at or utcnow(),
        )
    db.commit()
    db.refresh(row)
    return _serialize_expense(row)


@router.delete("/{expense_id}", dependencies=[Depends(require_permission("expenses.delete"))])
def delete_expense(
    expense_id: int,
    approval_request_code: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(Expense).filter(Expense.id == expense_id, Expense.is_deleted == False).first()  # noqa: E712
    if not row:
        raise HTTPException(status_code=404, detail="Expense not found")
    assert_accounting_period_open(db, when=row.expense_date or row.created_at or utcnow(), action="archive expense")
    if row.status == "Paid":
        raise HTTPException(status_code=400, detail="Paid expenses cannot be deleted")
    code = row.expense_code
    old = _serialize_expense(row)
    consume_approval_request(
        db,
        request_code=approval_request_code,
        module="expenses",
        action="archive",
        target_type="Expense",
        target_id=row.id,
        user=current_user,
        permission="expenses.delete",
        expected_payload={"expense_code": code},
        reason="Archive expense",
    )
    row.is_deleted = True
    row.deleted_at = utcnow()
    row.deleted_by = current_user.id if current_user else None
    row.delete_reason = "Deleted from expense module"
    _log_activity(
        db,
        user_id=current_user.id if current_user else None,
        action="Soft Delete",
        entity_id=expense_id,
        description=f"Expense {code} archived",
        old_value={"amount": old["amount"], "status": old["status"]},
        new_value={"is_deleted": True, "deleted_at": row.deleted_at.isoformat()},
    )
    record_domain_audit(
        db,
        module="expenses",
        action="expense_archived",
        target_type="Expense",
        target_id=row.id,
        user=current_user,
        old_value={"amount": old["amount"], "status": old["status"], "is_deleted": False},
        new_value={"is_deleted": True, "deleted_at": row.deleted_at.isoformat()},
        reason=row.delete_reason,
        permission="expenses.delete",
    )
    db.commit()
    return {"ok": True}
