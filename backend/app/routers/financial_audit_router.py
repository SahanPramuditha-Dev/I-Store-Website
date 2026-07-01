import json
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, func
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_admin, require_permission
from app.database import get_db
from app.models import (
    ActivityLog,
    AccountingPeriod,
    AccountingLedgerEntry,
    AppSetting,
    ApprovalRequest,
    CashReconciliation,
    Expense,
    FinancialAuditFlag,
    FinancialDailyClosing,
    FinancialTransactionReview,
    InvoicePayment,
    InventoryItem,
    RepairTicket,
    ReturnRecord,
    Sale,
    SaleItem,
    StockMovement,
    User,
)
from app.schemas import (
    CashReconciliationIn,
    CashReconciliationResolveIn,
    FinancialDailyClosingGenerateIn,
    FinancialDailyClosingVerifyIn,
    FinancialFlagBulkResolveIn,
    FinancialFlagCreateIn,
    FinancialFlagResolveIn,
    FinancialTransactionReviewIn,
)
from app.services.accounting_ledger_service import serialize_ledger_entry
from app.services.domain_audit_service import record_domain_audit
from app.utils.money import add as money_add
from app.utils.money import equals as money_equals
from app.utils.money import to_decimal, to_float
from app.utils.time import utcnow

router = APIRouter(prefix="/financial-audit", tags=["financial-audit"])

SEVERITY_ORDER = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}
RECON_MINOR_VARIANCE_LKR = 100


class AccountingPeriodIn(BaseModel):
    start_date: datetime
    end_date: datetime
    reason: str | None = None


class AccountingPeriodReopenIn(BaseModel):
    reason: str


class ApprovalRequestIn(BaseModel):
    module: str
    action: str
    target_type: str
    target_id: int | None = None
    reason: str
    payload: dict | None = None


class ApprovalDecisionIn(BaseModel):
    note: str | None = None


def _parse_iso_date(value: str | None, end_exclusive: bool = False) -> datetime | None:
    if not value:
        return None
    dt = datetime.fromisoformat(value)
    if end_exclusive:
        dt = dt + timedelta(days=1)
    return dt


def _period_code(start_date: datetime, end_date: datetime) -> str:
    return f"{start_date.date().isoformat()}_{end_date.date().isoformat()}"


def _serialize_accounting_period(row: AccountingPeriod) -> dict:
    return {
        "id": row.id,
        "period_code": row.period_code,
        "start_date": row.start_date.isoformat() if row.start_date else None,
        "end_date": row.end_date.isoformat() if row.end_date else None,
        "status": row.status,
        "close_reason": row.close_reason,
        "closed_at": row.closed_at.isoformat() if row.closed_at else None,
        "closed_by": _serialize_user(row.closed_by),
        "reopened_at": row.reopened_at.isoformat() if row.reopened_at else None,
        "reopened_by": _serialize_user(row.reopened_by),
        "reopen_reason": row.reopen_reason,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _serialize_approval_request(row: ApprovalRequest) -> dict:
    payload = {}
    if row.payload_json:
        try:
            loaded = json.loads(row.payload_json)
            payload = loaded if isinstance(loaded, dict) else {}
        except Exception:
            payload = {}
    return {
        "id": row.id,
        "request_code": row.request_code,
        "module": row.module,
        "action": row.action,
        "target_type": row.target_type,
        "target_id": row.target_id,
        "status": row.status,
        "reason": row.reason,
        "payload": payload,
        "requested_by": _serialize_user(row.requested_by) if row.requested_by else None,
        "requested_at": row.requested_at.isoformat() if row.requested_at else None,
        "decided_by": _serialize_user(row.decided_by) if row.decided_by else None,
        "decided_at": row.decided_at.isoformat() if row.decided_at else None,
        "decision_note": row.decision_note,
        "executed_by": _serialize_user(row.executed_by) if row.executed_by else None,
        "executed_at": row.executed_at.isoformat() if row.executed_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _serialize_user(user: User | None) -> str | None:
    if not user:
        return None
    return user.full_name or user.username or f"User #{user.id}"


def _safe_json_load(value: str | None, default):
    if not value:
        return default
    try:
        loaded = json.loads(value)
        return loaded if loaded is not None else default
    except Exception:
        return default


def _read_setting_number(db: Session, key: str, default: float) -> float:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row or row.value is None:
        return float(default)


@router.get("/money-integrity", dependencies=[Depends(require_permission("financial_audit.view"))])
def money_integrity_check(
    limit: int = Query(default=1000, ge=1, le=5000),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    query = db.query(Sale).order_by(Sale.created_at.desc(), Sale.id.desc())
    start = _parse_iso_date(date_from)
    end = _parse_iso_date(date_to, end_exclusive=True)
    if start:
        query = query.filter(Sale.created_at >= start)
    if end:
        query = query.filter(Sale.created_at < end)
    sales = query.limit(int(limit)).all()
    mismatches: list[dict] = []
    totals = {
        "invoice_total": to_decimal(0),
        "recorded_amount_paid": to_decimal(0),
        "recorded_balance_due": to_decimal(0),
        "payment_rows_total": to_decimal(0),
        "ledger_debit_total": to_decimal(0),
        "ledger_credit_total": to_decimal(0),
    }

    for sale in sales:
        payment_total = (
            db.query(func.coalesce(func.sum(InvoicePayment.amount), 0))
            .filter(InvoicePayment.invoice_id == int(sale.id))
            .scalar()
            or 0
        )
        totals["invoice_total"] = money_add(totals["invoice_total"], sale.total)
        totals["recorded_amount_paid"] = money_add(totals["recorded_amount_paid"], sale.amount_paid)
        totals["recorded_balance_due"] = money_add(totals["recorded_balance_due"], sale.balance_due)
        totals["payment_rows_total"] = money_add(totals["payment_rows_total"], payment_total)
        reconstructed_total = money_add(sale.amount_paid, sale.balance_due)
        if not money_equals(sale.total, reconstructed_total):
            mismatches.append(
                {
                    "type": "invoice_total_mismatch",
                    "invoice_id": sale.id,
                    "invoice_number": sale.invoice_no,
                    "expected_total": to_float(sale.total),
                    "paid_plus_balance": to_float(reconstructed_total),
                    "amount_paid": to_float(sale.amount_paid),
                    "balance_due": to_float(sale.balance_due),
                }
            )
        if not money_equals(payment_total, sale.amount_paid):
            mismatches.append(
                {
                    "type": "payment_rows_mismatch",
                    "invoice_id": sale.id,
                    "invoice_number": sale.invoice_no,
                    "payment_rows_total": to_float(payment_total),
                    "recorded_amount_paid": to_float(sale.amount_paid),
                }
            )

        ledger_rows = (
            db.query(AccountingLedgerEntry)
            .filter(
                AccountingLedgerEntry.reference_type == "invoice",
                AccountingLedgerEntry.reference_id == int(sale.id),
            )
            .all()
        )
        if ledger_rows:
            debit_total = to_decimal(0)
            credit_total = to_decimal(0)
            for row in ledger_rows:
                if str(row.direction or "").lower() == "debit":
                    debit_total = money_add(debit_total, row.amount)
                elif str(row.direction or "").lower() == "credit":
                    credit_total = money_add(credit_total, row.amount)
            totals["ledger_debit_total"] = money_add(totals["ledger_debit_total"], debit_total)
            totals["ledger_credit_total"] = money_add(totals["ledger_credit_total"], credit_total)
            expected = abs(to_decimal(sale.total))
            if debit_total > 0 and not money_equals(debit_total, expected):
                mismatches.append(
                    {
                        "type": "ledger_debit_mismatch",
                        "invoice_id": sale.id,
                        "invoice_number": sale.invoice_no,
                        "ledger_debit_total": to_float(debit_total),
                        "expected_total": to_float(expected),
                    }
                )
            if credit_total > 0 and not money_equals(credit_total, expected):
                mismatches.append(
                    {
                        "type": "ledger_credit_mismatch",
                        "invoice_id": sale.id,
                        "invoice_number": sale.invoice_no,
                        "ledger_credit_total": to_float(credit_total),
                        "expected_total": to_float(expected),
                    }
                )

    return {
        "checked_invoices": len(sales),
        "mismatch_count": len(mismatches),
        "mismatch_totals": dict(Counter(row["type"] for row in mismatches)),
        "totals": {key: to_float(value) for key, value in totals.items()},
        "mismatches": mismatches,
        "date_from": date_from,
        "date_to": date_to,
    }
    try:
        return float(row.value)
    except Exception:
        return float(default)


def _next_code(db: Session, model, prefix: str) -> str:
    return f"{prefix}-{int(utcnow().timestamp())}-{uuid.uuid4().hex[:6].upper()}"


def _sale_payment_split(sale: Sale) -> tuple[float, float, float, float]:
    total = float(sale.total or 0)
    cash = max(0.0, float(sale.cash_amount or 0))
    card = max(0.0, float(sale.card_amount or 0))
    method = str(sale.payment_method or "").lower()
    transfer = 0.0
    if "transfer" in method:
        transfer = max(0.0, total - cash - card)
    credit = max(0.0, total - cash - card - transfer)
    if "credit" in method or "partial" in method or "due" in method or not sale.paid:
        credit = max(credit, total - cash - card - transfer)
    return cash, card, transfer, credit


def _repair_payment_split(repair: RepairTicket) -> tuple[float, float, float]:
    total = max(0.0, float(repair.estimated_cost or 0))
    advance = max(0.0, float(repair.advance_payment or 0))
    credit = max(0.0, total - advance)
    return advance, 0.0, credit


def _status_badge(flagged: bool, verified: bool = False, resolved: bool = False) -> str:
    if resolved:
        return "Resolved"
    if flagged:
        return "Flagged"
    if verified:
        return "Verified"
    return "Pending Review"


def _flag_record(flag: FinancialAuditFlag) -> dict:
    return {
        "id": flag.id,
        "flag_id": flag.flag_code,
        "date_raised": flag.raised_at.isoformat() if flag.raised_at else None,
        "severity": flag.severity,
        "module": flag.module,
        "flag_type": flag.flag_type,
        "description": flag.description,
        "raised_by": flag.raised_by_source if flag.raised_by_source == "System" else _serialize_user(flag.raised_by),
        "assigned_to": _serialize_user(flag.assigned_to),
        "status": flag.status,
        "resolution_notes": flag.resolution_notes,
        "resolved_by": _serialize_user(flag.resolved_by),
        "resolved_at": flag.resolved_at.isoformat() if flag.resolved_at else None,
        "transaction_type": flag.transaction_type,
        "transaction_id": flag.transaction_id,
        "reference_code": flag.reference_code,
        "amount": float(flag.amount or 0),
        "status_badge": _status_badge(
            flagged=flag.status in {"Open", "Pending Review", "Escalated"},
            resolved=flag.status == "Resolved",
        ),
    }


def _recon_status(diff: float) -> str:
    variance = abs(float(diff or 0))
    if variance == 0:
        return "Balanced"
    if variance < RECON_MINOR_VARIANCE_LKR:
        return "Minor Variance"
    return "Major Variance"


def _serialize_reconciliation(row: CashReconciliation) -> dict:
    return {
        "id": row.id,
        "recon_id": row.recon_code,
        "date": row.recon_date.isoformat() if row.recon_date else None,
        "shift": row.shift,
        "cashier_id": row.cashier_id,
        "cashier": _serialize_user(row.cashier),
        "opening_float": float(row.opening_float or 0),
        "system_total": float(row.system_cash_total or 0),
        "cash_counted": float(row.counted_cash_total or 0),
        "closing_float": float(row.closing_float or 0),
        "transactions_count": int(row.cash_transactions_count or 0),
        "difference": float(row.difference or 0),
        "status": row.status,
        "verified_by": _serialize_user(row.verified_by),
        "verified_at": row.verified_at.isoformat() if row.verified_at else None,
        "notes": row.notes,
        "resolution_notes": row.resolution_notes,
        "denominations": _safe_json_load(row.denomination_json, {}),
        "status_badge": _status_badge(
            flagged=row.status in {"Minor Variance", "Major Variance", "Pending Count"},
            resolved=row.status == "Resolved",
            verified=row.status == "Balanced",
        ),
    }


def _serialize_daily_closing(row: FinancialDailyClosing) -> dict:
    return {
        "id": row.id,
        "report_id": row.report_code,
        "date": row.report_date.date().isoformat() if row.report_date else None,
        "generated_at": row.generated_at.isoformat() if row.generated_at else None,
        "verified_by": _serialize_user(row.verified_by),
        "verification_time": row.verification_time.isoformat() if row.verification_time else None,
        "status": row.status,
        "sales_cash": float(row.sales_cash or 0),
        "sales_card": float(row.sales_card or 0),
        "sales_transfer": float(row.sales_transfer or 0),
        "sales_credit": float(row.sales_credit or 0),
        "sales_total": float(row.sales_total or 0),
        "repairs_cash": float(row.repairs_cash or 0),
        "repairs_card": float(row.repairs_card or 0),
        "repairs_credit": float(row.repairs_credit or 0),
        "repairs_total": float(row.repairs_total or 0),
        "total_revenue": float(row.total_revenue or 0),
        "refunds_issued": float(row.refunds_issued or 0),
        "discounts_applied": float(row.discounts_applied or 0),
        "voids_cancellations": float(row.voids_cancellations or 0),
        "net_revenue": float(row.net_revenue or 0),
        "expenses_today": float(row.expenses_today or 0),
        "net_income_today": float(row.net_income_today or 0),
        "expected_cash": float(row.expected_cash or 0),
        "counted_cash": float(row.counted_cash or 0),
        "variance": float(row.variance or 0),
        "cash_status": row.cash_status,
        "total_invoices": int(row.total_invoices or 0),
        "total_repairs_completed": int(row.total_repairs_completed or 0),
        "voids_count": int(row.voids_count or 0),
        "refunds_count": int(row.refunds_count or 0),
        "partial_payments": int(row.partial_payments or 0),
        "has_unresolved_flags": bool(row.has_unresolved_flags),
        "notes": row.notes,
        "status_badge": _status_badge(
            flagged=row.status == "Flagged" or row.has_unresolved_flags,
            resolved=row.status == "Signed",
            verified=row.status == "Signed",
        ),
    }


def _ensure_system_flag(
    db: Session,
    active_map: dict[tuple[str, str], FinancialAuditFlag],
    active_keys: set[tuple[str, str]],
    *,
    reference_code: str,
    flag_type: str,
    module: str,
    description: str,
    severity: str = "Medium",
    amount: float = 0,
    transaction_type: str | None = None,
    transaction_id: int | None = None,
    metadata: dict | None = None,
):
    key = (reference_code, flag_type)
    active_keys.add(key)
    row = active_map.get(key)
    now = utcnow()
    if row:
        row.module = module
        row.description = description
        row.severity = severity
        row.amount = float(amount or 0)
        row.transaction_type = transaction_type
        row.transaction_id = transaction_id
        row.metadata_json = json.dumps(metadata or {})
        if row.status == "Resolved":
            row.status = "Open"
            row.resolved_by_user_id = None
            row.resolved_at = None
            row.resolution_notes = None
            row.raised_at = now
        return row

    created = FinancialAuditFlag(
        flag_code=_next_code(db, FinancialAuditFlag, "FLAG"),
        raised_at=now,
        severity=severity,
        module=module,
        flag_type=flag_type,
        description=description,
        raised_by_source="System",
        status="Open",
        transaction_type=transaction_type,
        transaction_id=transaction_id,
        reference_code=reference_code,
        amount=float(amount or 0),
        metadata_json=json.dumps(metadata or {}),
    )
    db.add(created)
    active_map[key] = created
    return created


def _sync_system_flags(
    db: Session,
    *,
    sales_rows: list[Sale],
    repairs_rows: list[RepairTicket],
    expense_rows: list[Expense],
    inventory_rows: list[InventoryItem],
    stock_movement_rows: list[StockMovement],
    closing_rows: list[FinancialDailyClosing],
    activity_rows: list[ActivityLog],
    discount_threshold_pct: float,
    large_txn_threshold: float,
    expense_threshold: float,
    critical_cash_variance: float,
):
    existing = (
        db.query(FinancialAuditFlag)
        .filter(FinancialAuditFlag.raised_by_source == "System")
        .all()
    )
    active_map = {
        (row.reference_code or f"flag:{row.id}", row.flag_type): row
        for row in existing
    }
    active_keys: set[tuple[str, str]] = set()

    # Discount and zero-value invoice flags.
    for sale in sales_rows:
        subtotal = float(sale.subtotal or 0)
        discount = float(sale.discount_amount or 0)
        if subtotal > 0:
            pct = (discount / subtotal) * 100 if subtotal else 0
            if pct > discount_threshold_pct:
                _ensure_system_flag(
                    db,
                    active_map,
                    active_keys,
                    reference_code=f"sale-discount-{sale.id}",
                    flag_type="Discount above threshold",
                    module="Discount & Override",
                    description=f"Invoice INV-{sale.id:05d} discount {pct:.2f}% exceeds {discount_threshold_pct:.2f}%.",
                    severity="High" if pct >= (discount_threshold_pct * 2) else "Medium",
                    amount=discount,
                    transaction_type="Sale",
                    transaction_id=sale.id,
                )
        if subtotal > 0 and float(sale.total or 0) <= 0:
            _ensure_system_flag(
                db,
                active_map,
                active_keys,
                reference_code=f"sale-zero-{sale.id}",
                flag_type="Zero-value invoice created",
                module="Transaction Verification",
                description=f"Invoice INV-{sale.id:05d} has subtotal {subtotal:.2f} but total {float(sale.total or 0):.2f}.",
                severity="High",
                amount=float(sale.total or 0),
                transaction_type="Sale",
                transaction_id=sale.id,
            )

    # Large transactions + no-customer cash + after-hours + duplicates.
    sale_sorted = sorted(sales_rows, key=lambda x: x.created_at or datetime.min)
    recent_by_customer_amount: dict[tuple[str, int], datetime] = {}
    for sale in sale_sorted:
        total = float(sale.total or 0)
        if total >= large_txn_threshold:
            _ensure_system_flag(
                db,
                active_map,
                active_keys,
                reference_code=f"sale-large-{sale.id}",
                flag_type="Large transaction threshold crossed",
                module="Transaction Verification",
                description=f"Invoice INV-{sale.id:05d} amount LKR {round(total):,} exceeds configured threshold.",
                severity="High",
                amount=total,
                transaction_type="Sale",
                transaction_id=sale.id,
            )
        method = str(sale.payment_method or "").lower()
        if ("cash" in method or not method) and not sale.customer_id and total > 0:
            _ensure_system_flag(
                db,
                active_map,
                active_keys,
                reference_code=f"sale-cash-nocust-{sale.id}",
                flag_type="Cash transaction with no customer",
                module="Payment Integrity",
                description=f"Invoice INV-{sale.id:05d} is cash without customer linkage.",
                severity="Medium",
                amount=total,
                transaction_type="Sale",
                transaction_id=sale.id,
            )
        if sale.created_at:
            hour = sale.created_at.hour
            if hour >= 22 or hour < 7:
                _ensure_system_flag(
                    db,
                    active_map,
                    active_keys,
                    reference_code=f"sale-afterhours-{sale.id}",
                    flag_type="After-hours transaction",
                    module="Audit Flags & Alerts",
                    description=f"Invoice INV-{sale.id:05d} recorded at {sale.created_at.strftime('%H:%M')}.",
                    severity="Low",
                    amount=total,
                    transaction_type="Sale",
                    transaction_id=sale.id,
                )

        if sale.created_at:
            customer_key = str(sale.customer_id or "walkin")
            duplicate_key = (customer_key, int(round(total)))
            prev_ts = recent_by_customer_amount.get(duplicate_key)
            if prev_ts and abs((sale.created_at - prev_ts).total_seconds()) <= 900:
                _ensure_system_flag(
                    db,
                    active_map,
                    active_keys,
                    reference_code=f"sale-duplicate-{sale.id}-{duplicate_key[1]}",
                    flag_type="Duplicate payment detected",
                    module="Payment Integrity",
                    description=f"Potential duplicate payment pattern for amount LKR {duplicate_key[1]:,}.",
                    severity="Critical",
                    amount=total,
                    transaction_type="Sale",
                    transaction_id=sale.id,
                )
            recent_by_customer_amount[duplicate_key] = sale.created_at

    # Repairs completed but no invoice/payment coverage.
    for repair in repairs_rows:
        status = str(repair.status or "").lower()
        if status in {"completed", "delivered"}:
            total = float(repair.estimated_cost or 0)
            advance = float(repair.advance_payment or 0)
            if advance <= 0 and total > 0:
                _ensure_system_flag(
                    db,
                    active_map,
                    active_keys,
                    reference_code=f"repair-uninvoiced-{repair.id}",
                    flag_type="Repair completed, no invoice",
                    module="Technician Billing",
                    description=f"Repair {repair.ticket_no or repair.id} completed with zero collected amount.",
                    severity="High",
                    amount=total,
                    transaction_type="Repair",
                    transaction_id=repair.id,
                )

    # Expenses requiring approval.
    for exp in expense_rows:
        amount = float(exp.amount or 0)
        is_approved = str(exp.status or "").lower() in {"approved", "paid"}
        if amount > expense_threshold and not is_approved:
            _ensure_system_flag(
                db,
                active_map,
                active_keys,
                reference_code=f"expense-threshold-{exp.id}",
                flag_type="Expense above threshold unapproved",
                module="Expense Audit",
                description=f"Expense {exp.expense_code or exp.id} exceeds threshold and is not approved.",
                severity="High",
                amount=amount,
                transaction_type="Expense",
                transaction_id=exp.id,
            )

    # Stock discrepancy check from cumulative movements.
    movement_totals = defaultdict(int)
    for mv in stock_movement_rows:
        movement_totals[mv.item_id] += int(mv.quantity or 0)
    for item in inventory_rows:
        expected_from_movement = movement_totals.get(item.id, 0)
        actual = int(item.quantity or 0)
        diff = actual - expected_from_movement
        if abs(diff) > 0:
            _ensure_system_flag(
                db,
                active_map,
                active_keys,
                reference_code=f"stock-discrepancy-{item.id}",
                flag_type="Stock vs sales discrepancy",
                module="Stock vs Sales Reconciliation",
                description=f"{item.name}: expected {expected_from_movement}, actual {actual} (diff {diff}).",
                severity="Medium" if abs(diff) <= 3 else "High",
                amount=abs(diff * float(item.cost_price or 0)),
                transaction_type="Stock",
                transaction_id=item.id,
            )

    # Closing reports unsigned / major cash variance.
    for close in closing_rows:
        if close.status != "Signed":
            _ensure_system_flag(
                db,
                active_map,
                active_keys,
                reference_code=f"closing-unsigned-{close.id}",
                flag_type="Closing report unsigned",
                module="Daily Closing",
                description=f"Daily closing report {close.report_code} remains {close.status}.",
                severity="High",
                amount=float(close.variance or 0),
                transaction_type="DailyClosing",
                transaction_id=close.id,
            )
        if abs(float(close.variance or 0)) >= critical_cash_variance:
            _ensure_system_flag(
                db,
                active_map,
                active_keys,
                reference_code=f"closing-variance-{close.id}",
                flag_type="Cash variance detected",
                module="Cash Reconciliation",
                description=f"{close.report_code} has high variance LKR {round(float(close.variance or 0)):,}.",
                severity="Critical",
                amount=float(close.variance or 0),
                transaction_type="DailyClosing",
                transaction_id=close.id,
            )

    # Failed login attempts and unsafe edit signals from activity logs.
    failed_by_user = Counter()
    for log in activity_rows:
        desc = str(log.description or "").lower()
        action = str(log.action or "").lower()
        if "failed login" in desc or (action == "login" and "failed" in desc):
            failed_by_user[log.user_id or 0] += 1
        if action == "update" and ("payment" in desc or "balance" in desc or "outstanding" in desc):
            _ensure_system_flag(
                db,
                active_map,
                active_keys,
                reference_code=f"txn-edit-{log.id}",
                flag_type="Transaction edited after payment",
                module="Transaction Verification",
                description=f"Post-payment edit detected: {log.description or 'No description'}",
                severity="High",
                transaction_type=log.entity_type,
                transaction_id=log.entity_id,
            )
        if action == "delete" and "approved" not in desc:
            _ensure_system_flag(
                db,
                active_map,
                active_keys,
                reference_code=f"delete-unapproved-{log.id}",
                flag_type="Record deleted without approval",
                module="Void & Deletion Audit",
                description=log.description or "Delete action missing approval reference.",
                severity="Critical",
                transaction_type=log.entity_type,
                transaction_id=log.entity_id,
            )
    for user_id, count in failed_by_user.items():
        if count >= 3:
            _ensure_system_flag(
                db,
                active_map,
                active_keys,
                reference_code=f"failed-login-{user_id}",
                flag_type="Failed login attempts (3+)",
                module="Audit Flags & Alerts",
                description=f"User {user_id} has {count} failed login attempts.",
                severity="High",
            )

    # Auto-resolve system flags that no longer appear in active scan.
    now = utcnow()
    for row in existing:
        key = (row.reference_code or f"flag:{row.id}", row.flag_type)
        if key in active_keys:
            continue
        if row.status in {"Open", "Pending Review", "Escalated"}:
            row.status = "Resolved"
            row.resolved_at = now
            if not row.resolution_notes:
                row.resolution_notes = "Auto-resolved by system check."


def _apply_flag_filters(
    rows: list[FinancialAuditFlag],
    *,
    module: str | None,
    flag_status: str | None,
):
    filtered = rows
    if module and module.lower() != "all":
        filtered = [row for row in filtered if str(row.module or "").lower() == module.lower()]
    if flag_status and flag_status.lower() != "all":
        if flag_status.lower() == "open":
            filtered = [row for row in filtered if row.status in {"Open", "Pending Review", "Escalated"}]
        else:
            filtered = [row for row in filtered if str(row.status or "").lower() == flag_status.lower()]
    return filtered


@router.get("/periods", dependencies=[Depends(require_permission("financial_audit.view"))])
def list_accounting_periods(
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    rows = db.query(AccountingPeriod).order_by(AccountingPeriod.start_date.desc()).limit(120).all()
    return [_serialize_accounting_period(row) for row in rows]


@router.get("/ledger", dependencies=[Depends(require_permission("financial_audit.view"))])
def list_accounting_ledger_entries(
    module: str | None = Query(default=None),
    entry_type: str | None = Query(default=None),
    direction: str | None = Query(default=None),
    reference_type: str | None = Query(default=None),
    reference_id: int | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(AccountingLedgerEntry).options(joinedload(AccountingLedgerEntry.created_by))
    if module:
        query = query.filter(AccountingLedgerEntry.module == str(module).strip())
    if entry_type:
        query = query.filter(AccountingLedgerEntry.entry_type == str(entry_type).strip())
    if direction:
        query = query.filter(AccountingLedgerEntry.direction == str(direction).strip().lower())
    if reference_type:
        query = query.filter(AccountingLedgerEntry.reference_type == str(reference_type).strip())
    if reference_id is not None:
        query = query.filter(AccountingLedgerEntry.reference_id == int(reference_id))
    start = _parse_iso_date(date_from)
    end = _parse_iso_date(date_to, end_exclusive=True)
    if start:
        query = query.filter(AccountingLedgerEntry.entry_date >= start)
    if end:
        query = query.filter(AccountingLedgerEntry.entry_date < end)
    rows = (
        query.order_by(AccountingLedgerEntry.entry_date.desc(), AccountingLedgerEntry.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [serialize_ledger_entry(row) for row in rows]


@router.get("/approvals", dependencies=[Depends(require_permission("financial_audit.view"))])
def list_approval_requests(
    status: str | None = Query(default=None),
    module: str | None = Query(default=None),
    target_type: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(ApprovalRequest).options(
        joinedload(ApprovalRequest.requested_by),
        joinedload(ApprovalRequest.decided_by),
        joinedload(ApprovalRequest.executed_by),
    )
    if status:
        query = query.filter(ApprovalRequest.status == str(status).strip().lower())
    if module:
        query = query.filter(ApprovalRequest.module == str(module).strip())
    if target_type:
        query = query.filter(ApprovalRequest.target_type == str(target_type).strip())
    rows = (
        query.order_by(ApprovalRequest.requested_at.desc(), ApprovalRequest.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_serialize_approval_request(row) for row in rows]


@router.post("/approvals", dependencies=[Depends(require_permission("financial_audit.view"))])
def create_approval_request(
    payload: ApprovalRequestIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    reason = str(payload.reason or "").strip()
    if len(reason) < 5:
        raise HTTPException(status_code=400, detail="A descriptive approval reason is required")
    row = ApprovalRequest(
        request_code=_next_code(db, ApprovalRequest, "APR"),
        module=str(payload.module or "").strip(),
        action=str(payload.action or "").strip(),
        target_type=str(payload.target_type or "").strip(),
        target_id=payload.target_id,
        status="pending",
        reason=reason,
        payload_json=json.dumps(payload.payload or {}, sort_keys=True, default=str),
        requested_by_user_id=current_user.id if current_user else None,
        requested_at=utcnow(),
    )
    if not row.module or not row.action or not row.target_type:
        raise HTTPException(status_code=400, detail="module, action, and target_type are required")
    db.add(row)
    db.flush()
    record_domain_audit(
        db,
        module="financial_audit",
        action="approval_requested",
        target_type="ApprovalRequest",
        target_id=row.id,
        user=current_user,
        new_value=_serialize_approval_request(row),
        reason=reason,
        permission="financial_audit.view",
    )
    db.commit()
    db.refresh(row)
    return _serialize_approval_request(row)


def _approval_request_by_code(db: Session, request_code: str) -> ApprovalRequest:
    row = (
        db.query(ApprovalRequest)
        .options(
            joinedload(ApprovalRequest.requested_by),
            joinedload(ApprovalRequest.decided_by),
            joinedload(ApprovalRequest.executed_by),
        )
        .filter(ApprovalRequest.request_code == str(request_code))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Approval request not found")
    return row


@router.post("/approvals/{request_code}/approve", dependencies=[Depends(require_permission("financial_audit.approve"))])
def approve_approval_request(
    request_code: str,
    payload: ApprovalDecisionIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = _approval_request_by_code(db, request_code)
    if row.status != "pending":
        raise HTTPException(status_code=409, detail=f"Cannot approve request in status: {row.status}")
    old_status = row.status
    row.status = "approved"
    row.decided_by_user_id = current_user.id if current_user else None
    row.decided_at = utcnow()
    row.decision_note = str(payload.note or "").strip() or "Approved"
    record_domain_audit(
        db,
        module="financial_audit",
        action="approval_approved",
        target_type="ApprovalRequest",
        target_id=row.id,
        user=current_user,
        old_value={"status": old_status},
        new_value={"status": row.status, "decision_note": row.decision_note},
        reason=row.decision_note,
        permission="financial_audit.approve",
    )
    db.commit()
    db.refresh(row)
    return _serialize_approval_request(row)


@router.post("/approvals/{request_code}/reject", dependencies=[Depends(require_permission("financial_audit.approve"))])
def reject_approval_request(
    request_code: str,
    payload: ApprovalDecisionIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    note = str(payload.note or "").strip()
    if len(note) < 5:
        raise HTTPException(status_code=400, detail="A descriptive rejection note is required")
    row = _approval_request_by_code(db, request_code)
    if row.status != "pending":
        raise HTTPException(status_code=409, detail=f"Cannot reject request in status: {row.status}")
    old_status = row.status
    row.status = "rejected"
    row.decided_by_user_id = current_user.id if current_user else None
    row.decided_at = utcnow()
    row.decision_note = note
    record_domain_audit(
        db,
        module="financial_audit",
        action="approval_rejected",
        target_type="ApprovalRequest",
        target_id=row.id,
        user=current_user,
        old_value={"status": old_status},
        new_value={"status": row.status, "decision_note": note},
        reason=note,
        permission="financial_audit.approve",
    )
    db.commit()
    db.refresh(row)
    return _serialize_approval_request(row)


@router.post("/approvals/{request_code}/execute", dependencies=[Depends(require_permission("financial_audit.approve"))])
def mark_approval_request_executed(
    request_code: str,
    payload: ApprovalDecisionIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = _approval_request_by_code(db, request_code)
    if row.status != "approved":
        raise HTTPException(status_code=409, detail=f"Only approved requests can be executed. Current status: {row.status}")
    old_status = row.status
    row.status = "executed"
    row.executed_by_user_id = current_user.id if current_user else None
    row.executed_at = utcnow()
    note = str(payload.note or "").strip() or "Executed"
    record_domain_audit(
        db,
        module="financial_audit",
        action="approval_executed",
        target_type="ApprovalRequest",
        target_id=row.id,
        user=current_user,
        old_value={"status": old_status},
        new_value={"status": row.status, "execution_note": note},
        reason=note,
        permission="financial_audit.approve",
    )
    db.commit()
    db.refresh(row)
    return _serialize_approval_request(row)


@router.post("/periods/close", dependencies=[Depends(require_permission("financial_audit.close_period"))])
def close_accounting_period(
    payload: AccountingPeriodIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="end_date must be after start_date")
    overlapping = (
        db.query(AccountingPeriod)
        .filter(
            AccountingPeriod.status == "closed",
            AccountingPeriod.start_date <= payload.end_date,
            AccountingPeriod.end_date >= payload.start_date,
        )
        .first()
    )
    if overlapping:
        raise HTTPException(status_code=409, detail=f"Overlaps closed period {overlapping.period_code}")
    row = AccountingPeriod(
        period_code=_period_code(payload.start_date, payload.end_date),
        start_date=payload.start_date,
        end_date=payload.end_date,
        status="closed",
        close_reason=(payload.reason or "").strip() or "Closed from financial audit",
        closed_at=utcnow(),
        closed_by_user_id=current_user.id if current_user else None,
    )
    db.add(row)
    db.flush()
    record_domain_audit(
        db,
        module="financial_audit",
        action="period_closed",
        target_type="AccountingPeriod",
        target_id=row.id,
        user=current_user,
        new_value=_serialize_accounting_period(row),
        reason=row.close_reason,
        permission="financial_audit.close_period",
    )
    db.commit()
    db.refresh(row)
    return _serialize_accounting_period(row)


@router.post("/periods/{period_id}/reopen", dependencies=[Depends(require_permission("financial_audit.reopen_period"))])
def reopen_accounting_period(
    period_id: int,
    payload: AccountingPeriodReopenIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    reason = str(payload.reason or "").strip()
    if len(reason) < 5:
        raise HTTPException(status_code=400, detail="A descriptive reopen reason is required")
    row = db.query(AccountingPeriod).filter(AccountingPeriod.id == period_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Accounting period not found")
    old_value = _serialize_accounting_period(row)
    row.status = "open"
    row.reopened_at = utcnow()
    row.reopened_by_user_id = current_user.id if current_user else None
    row.reopen_reason = reason
    record_domain_audit(
        db,
        module="financial_audit",
        action="period_reopened",
        target_type="AccountingPeriod",
        target_id=row.id,
        user=current_user,
        old_value=old_value,
        new_value=_serialize_accounting_period(row),
        reason=reason,
        permission="financial_audit.reopen_period",
    )
    db.commit()
    db.refresh(row)
    return _serialize_accounting_period(row)


@router.get("/state", dependencies=[Depends(require_permission("financial_audit.view"))])
def financial_audit_state(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    staff_id: int | None = Query(default=None),
    module: str | None = Query(default="all"),
    flag_status: str | None = Query(default="all"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    start = _parse_iso_date(date_from)
    end = _parse_iso_date(date_to, end_exclusive=True)
    now = utcnow()
    today_start = datetime(now.year, now.month, now.day)
    month_start = datetime(now.year, now.month, 1)
    day_ago = now - timedelta(hours=24)

    discount_threshold_pct = _read_setting_number(db, "audit_discount_threshold_percent", 10)
    large_txn_threshold = _read_setting_number(db, "audit_large_transaction_threshold", 50000)
    expense_threshold = _read_setting_number(db, "audit_expense_approval_threshold", 10000)
    critical_cash_variance = _read_setting_number(db, "audit_critical_cash_variance", 5000)

    users_rows = db.query(User).order_by(User.full_name.asc()).all()
    users_map = {u.id: u for u in users_rows}

    sales_q = db.query(Sale).options(joinedload(Sale.customer))
    repairs_q = db.query(RepairTicket).options(joinedload(RepairTicket.customer))
    expense_q = db.query(Expense).options(
        joinedload(Expense.created_by),
        joinedload(Expense.approved_by),
        joinedload(Expense.supplier),
    )
    return_q = db.query(ReturnRecord).options(joinedload(ReturnRecord.customer))
    movement_q = db.query(StockMovement).options(joinedload(StockMovement.item))
    activity_q = db.query(ActivityLog).options(joinedload(ActivityLog.user))
    recon_q = db.query(CashReconciliation).options(
        joinedload(CashReconciliation.cashier),
        joinedload(CashReconciliation.verified_by),
    )
    closing_q = db.query(FinancialDailyClosing).options(joinedload(FinancialDailyClosing.verified_by))

    if start:
        sales_q = sales_q.filter(Sale.created_at >= start)
        repairs_q = repairs_q.filter(RepairTicket.created_at >= start)
        expense_q = expense_q.filter(Expense.expense_date >= start)
        return_q = return_q.filter(ReturnRecord.created_at >= start)
        movement_q = movement_q.filter(StockMovement.created_at >= start)
        activity_q = activity_q.filter(ActivityLog.created_at >= start)
        recon_q = recon_q.filter(CashReconciliation.recon_date >= start)
        closing_q = closing_q.filter(FinancialDailyClosing.report_date >= start)
    if end:
        sales_q = sales_q.filter(Sale.created_at < end)
        repairs_q = repairs_q.filter(RepairTicket.created_at < end)
        expense_q = expense_q.filter(Expense.expense_date < end)
        return_q = return_q.filter(ReturnRecord.created_at < end)
        movement_q = movement_q.filter(StockMovement.created_at < end)
        activity_q = activity_q.filter(ActivityLog.created_at < end)
        recon_q = recon_q.filter(CashReconciliation.recon_date < end)
        closing_q = closing_q.filter(FinancialDailyClosing.report_date < end)

    sales_rows = sales_q.order_by(Sale.created_at.desc()).all()
    repairs_rows = repairs_q.order_by(RepairTicket.created_at.desc()).all()
    expense_entries = expense_q.order_by(Expense.expense_date.desc(), Expense.created_at.desc()).all()
    return_rows = return_q.order_by(ReturnRecord.created_at.desc()).all()
    movement_rows = movement_q.order_by(StockMovement.created_at.desc()).all()
    activity_rows = activity_q.order_by(ActivityLog.created_at.desc()).limit(1500).all()
    recon_rows = recon_q.order_by(CashReconciliation.recon_date.desc()).all()
    closing_rows = closing_q.order_by(FinancialDailyClosing.report_date.desc()).all()
    inventory_rows = db.query(InventoryItem).all()

    # Apply staff filter where user linkage exists.
    if staff_id:
        repairs_rows = [r for r in repairs_rows if users_map.get(staff_id) and r.technician and users_map[staff_id].full_name and users_map[staff_id].full_name.lower() in str(r.technician).lower()]
        expense_entries = [r for r in expense_entries if r.created_by_user_id == staff_id or r.approved_by_user_id == staff_id]
        return_rows = [r for r in return_rows if r.staff_user_id == staff_id or r.approved_by_user_id == staff_id]
        activity_rows = [r for r in activity_rows if r.user_id == staff_id]
        recon_rows = [r for r in recon_rows if r.cashier_id == staff_id or r.verified_by_user_id == staff_id]
        closing_rows = [r for r in closing_rows if r.verified_by_user_id == staff_id]

    # Auto-sync system-raised flags.
    _sync_system_flags(
        db,
        sales_rows=sales_rows,
        repairs_rows=repairs_rows,
        expense_rows=expense_entries,
        inventory_rows=inventory_rows,
        stock_movement_rows=movement_rows,
        closing_rows=closing_rows,
        activity_rows=activity_rows,
        discount_threshold_pct=discount_threshold_pct,
        large_txn_threshold=large_txn_threshold,
        expense_threshold=expense_threshold,
        critical_cash_variance=critical_cash_variance,
    )
    db.commit()

    flags_rows = (
        db.query(FinancialAuditFlag)
        .options(
            joinedload(FinancialAuditFlag.raised_by),
            joinedload(FinancialAuditFlag.assigned_to),
            joinedload(FinancialAuditFlag.resolved_by),
        )
        .order_by(FinancialAuditFlag.raised_at.desc())
        .all()
    )
    flags_filtered = _apply_flag_filters(flags_rows, module=module, flag_status=flag_status)
    flags_serialized = [_flag_record(row) for row in flags_filtered]
    flags_by_ref = {(f["reference_code"], f["flag_type"]): f for f in flags_serialized if f.get("reference_code")}

    # Maps for joins.
    sale_ids = [s.id for s in sales_rows]
    sale_items_map: dict[int, list[SaleItem]] = defaultdict(list)
    if sale_ids:
        for line in db.query(SaleItem).filter(SaleItem.sale_id.in_(sale_ids)).all():
            sale_items_map[line.sale_id].append(line)
    reviews_rows = db.query(FinancialTransactionReview).all()
    reviews_map = {(row.transaction_type, row.transaction_id): row for row in reviews_rows}

    # --------------------------------
    # PAGE 1 - Overview Dashboard
    # --------------------------------
    sales_today = [s for s in sales_rows if s.created_at and s.created_at >= today_start]
    repairs_today = [r for r in repairs_rows if r.created_at and r.created_at >= today_start]
    flags_today = [f for f in flags_filtered if f.raised_at and f.raised_at >= today_start]
    resolved_today = [f for f in flags_today if f.status == "Resolved"]
    unresolved_flags = [f for f in flags_filtered if f.status in {"Open", "Pending Review", "Escalated"}]
    pending_reviews = [f for f in flags_filtered if f.status == "Pending Review"]
    critical_alerts = [f for f in unresolved_flags if f.severity == "Critical"]

    total_sales_revenue_today = sum(float(s.total or 0) for s in sales_today if not s.is_voided)
    total_repair_revenue_today = sum(float(r.estimated_cost or 0) for r in repairs_today if str(r.status or "").lower() in {"completed", "delivered"})
    total_revenue_today = total_sales_revenue_today + total_repair_revenue_today
    system_cash_today = sum(_sale_payment_split(s)[0] for s in sales_today if not s.is_voided)
    counted_cash_today = sum(float(r.counted_cash_total or 0) for r in recon_rows if r.recon_date and r.recon_date >= today_start)
    diff_cash_today = counted_cash_today - system_cash_today
    discounts_today = sum(float(s.discount_amount or 0) for s in sales_today if not s.is_voided)
    voids_today = len([s for s in sales_today if s.is_voided])
    outstanding_changes_24h = len(
        [
            a
            for a in activity_rows
            if a.created_at and a.created_at >= day_ago and "outstanding" in str(a.description or "").lower()
        ]
    )

    total_cash_discrepancy_lkr = sum(abs(float(r.difference or 0)) for r in recon_rows if abs(float(r.difference or 0)) > 0)

    daily_flag_counts = defaultdict(int)
    daily_flag_resolved = defaultdict(int)
    for row in flags_filtered:
        if not row.raised_at:
            continue
        key = row.raised_at.date().isoformat()
        daily_flag_counts[key] += 1
        if row.status == "Resolved":
            daily_flag_resolved[key] += 1
    flag_trend_line = []
    for i in range(29, -1, -1):
        day = (now - timedelta(days=i)).date().isoformat()
        flag_trend_line.append({"date": day, "flags": daily_flag_counts.get(day, 0)})
    resolution_rate_line = []
    for i in range(29, -1, -1):
        day = (now - timedelta(days=i)).date().isoformat()
        raised = daily_flag_counts.get(day, 0)
        resolved = daily_flag_resolved.get(day, 0)
        rate = (resolved / raised * 100) if raised else 0
        resolution_rate_line.append({"date": day, "rate": round(rate, 2)})

    cash_by_day_system = defaultdict(float)
    for s in sales_rows:
        if not s.created_at:
            continue
        if s.created_at < month_start:
            continue
        key = s.created_at.date().isoformat()
        cash_by_day_system[key] += _sale_payment_split(s)[0]
    cash_by_day_counted = defaultdict(float)
    for r in recon_rows:
        if not r.recon_date:
            continue
        if r.recon_date < month_start:
            continue
        key = r.recon_date.date().isoformat()
        cash_by_day_counted[key] += float(r.counted_cash_total or 0)
    month_days = max(1, now.day)
    cash_vs_system = []
    for d in range(1, month_days + 1):
        date_obj = datetime(now.year, now.month, d).date().isoformat()
        cash_vs_system.append(
            {
                "date": date_obj,
                "system": round(cash_by_day_system.get(date_obj, 0), 2),
                "counted": round(cash_by_day_counted.get(date_obj, 0), 2),
            }
        )

    flag_type_counter = Counter()
    for f in unresolved_flags:
        bucket = "Other"
        txt = f.flag_type.lower()
        if "cash" in txt or "closing" in txt:
            bucket = "Cash"
        elif "discount" in txt:
            bucket = "Discount"
        elif "delete" in txt or "void" in txt:
            bucket = "Void"
        elif "payment" in txt:
            bucket = "Payment"
        elif "stock" in txt:
            bucket = "Stock"
        flag_type_counter[bucket] += 1
    flag_distribution = [{"type": k, "count": v} for k, v in flag_type_counter.items()]

    staff_activity_map = defaultdict(lambda: {"transaction_count": 0, "cash_handled": 0.0, "discounts": 0.0})
    for s in sales_today:
        key = "System"
        staff_activity_map[key]["transaction_count"] += 1
        staff_activity_map[key]["cash_handled"] += _sale_payment_split(s)[0]
        staff_activity_map[key]["discounts"] += float(s.discount_amount or 0)
    for r in recon_rows:
        if r.recon_date and r.recon_date >= today_start:
            key = _serialize_user(r.cashier) or "Unknown Cashier"
            staff_activity_map[key]["cash_handled"] += float(r.counted_cash_total or 0)
    staff_activity_rows = [
        {
            "staff": key,
            "transactions": int(val["transaction_count"]),
            "cash_handled": round(val["cash_handled"], 2),
            "discounts": round(val["discounts"], 2),
            "status_badge": _status_badge(flagged=False, verified=True),
        }
        for key, val in staff_activity_map.items()
    ]
    staff_activity_rows.sort(key=lambda x: (-x["transactions"], -x["cash_handled"]))

    overview = {
        "kpis_row_1": [
            {"label": "Total Flags Today", "value": len(flags_today), "tone": "red" if len(flags_today) > 0 else "green"},
            {"label": "Cash Discrepancies", "value": round(total_cash_discrepancy_lkr, 2), "tone": "red" if total_cash_discrepancy_lkr else "green"},
            {
                "label": "Unverified Transactions",
                "value": len([row for row in reviews_rows if row.status == "Pending Review"]),
                "tone": "amber",
            },
            {"label": "Resolved Flags Today", "value": len(resolved_today), "tone": "green"},
            {"label": "Pending Reviews", "value": len(pending_reviews), "tone": "amber"},
            {"label": "Critical Alerts", "value": len(critical_alerts), "tone": "red"},
        ],
        "kpis_row_2": [
            {"label": "Total Revenue Today (System)", "value": round(total_revenue_today, 2), "tone": "sky"},
            {"label": "Total Cash Counted Today", "value": round(counted_cash_today, 2), "tone": "sky"},
            {"label": "Difference (System vs Cash)", "value": round(diff_cash_today, 2), "tone": "red" if diff_cash_today else "green"},
            {"label": "Discounts Given Today", "value": round(discounts_today, 2), "tone": "amber"},
            {"label": "Voids / Cancellations Today", "value": voids_today, "tone": "amber"},
            {"label": "Outstanding Changes (24h)", "value": outstanding_changes_24h, "tone": "amber"},
        ],
        "active_flags": [row for row in flags_serialized if row["status"] in {"Open", "Pending Review", "Escalated"}][:20],
        "recent_activity": [
            {
                "timestamp": a.created_at.isoformat() if a.created_at else None,
                "user": _serialize_user(a.user) or "System",
                "action": a.action,
                "module": a.entity_type,
                "description": a.description,
                "status_badge": _status_badge(flagged=str(a.action or "").lower() in {"delete", "void", "update"}),
            }
            for a in activity_rows[:20]
        ],
        "staff_financial_activity": staff_activity_rows[:20],
        "charts": {
            "flag_trend_line": flag_trend_line,
            "cash_vs_system_revenue": cash_vs_system,
            "flag_type_distribution": flag_distribution,
            "resolution_rate_trend": resolution_rate_line,
        },
    }

    # --------------------------------
    # PAGE 2 - Cash Reconciliation
    # --------------------------------
    cash_sales_total = sum(_sale_payment_split(s)[0] for s in sales_rows if not s.is_voided)
    counted_total = sum(float(r.counted_cash_total or 0) for r in recon_rows)
    variance_total = counted_total - cash_sales_total
    opening_float_sum = sum(float(r.opening_float or 0) for r in recon_rows)
    closing_float_sum = sum(float(r.closing_float or 0) for r in recon_rows)
    cash_txn_count = sum(1 for s in sales_rows if _sale_payment_split(s)[0] > 0 and not s.is_voided)

    variance_by_day = defaultdict(float)
    variance_by_cashier = defaultdict(float)
    running_balance = []
    running_total = 0.0
    for row in sorted(recon_rows, key=lambda x: x.recon_date or datetime.min):
        date_key = row.recon_date.date().isoformat() if row.recon_date else "-"
        variance_by_day[date_key] += float(row.difference or 0)
        cashier_label = _serialize_user(row.cashier) or "Unknown"
        variance_by_cashier[cashier_label] += float(row.difference or 0)
        running_total += float(row.difference or 0)
        running_balance.append({"date": date_key, "running_balance": round(running_total, 2)})

    cash_reconciliation = {
        "kpis": [
            {"label": "System Cash Total", "value": round(cash_sales_total, 2), "tone": "sky"},
            {"label": "Physical Cash Counted", "value": round(counted_total, 2), "tone": "sky"},
            {"label": "Difference (LKR)", "value": round(variance_total, 2), "tone": "red" if variance_total else "green"},
            {"label": "Opening Float Amount", "value": round(opening_float_sum, 2), "tone": "indigo"},
            {"label": "Closing Float Amount", "value": round(closing_float_sum, 2), "tone": "indigo"},
            {"label": "Cash Transactions Count", "value": cash_txn_count, "tone": "amber"},
        ],
        "rows": [_serialize_reconciliation(row) for row in recon_rows[:400]],
        "charts": {
            "daily_cash_variance": [{"date": d, "variance": round(v, 2)} for d, v in sorted(variance_by_day.items())],
            "cashier_variance": [{"cashier": k, "variance": round(v, 2)} for k, v in sorted(variance_by_cashier.items(), key=lambda x: -abs(x[1]))],
            "running_cash_balance": running_balance,
        },
        "form_defaults": {
            "opening_float": 0,
            "closing_float": 0,
            "denominations": {"5000": 0, "1000": 0, "500": 0, "100": 0, "50": 0, "20_10": 0},
        },
    }

    # --------------------------------
    # PAGE 3 - Daily Closing Report
    # --------------------------------
    closings_serialized = [_serialize_daily_closing(row) for row in closing_rows[:365]]
    latest_closing = closings_serialized[0] if closings_serialized else None
    previous_closing = closings_serialized[1] if len(closings_serialized) > 1 else None
    daily_closing = {
        "kpis": [
            {"label": "Signed Reports", "value": len([c for c in closing_rows if c.status == "Signed"]), "tone": "green"},
            {"label": "Unsigned Reports", "value": len([c for c in closing_rows if c.status == "Unsigned"]), "tone": "amber"},
            {"label": "Flagged Reports", "value": len([c for c in closing_rows if c.status == "Flagged"]), "tone": "red"},
            {
                "label": "Avg Cash Variance",
                "value": round((sum(abs(float(c.variance or 0)) for c in closing_rows) / len(closing_rows)), 2) if closing_rows else 0,
                "tone": "amber",
            },
        ],
        "rows": closings_serialized,
        "latest_report": latest_closing,
        "previous_day_comparison": {
            "latest_net_revenue": latest_closing["net_revenue"] if latest_closing else 0,
            "previous_net_revenue": previous_closing["net_revenue"] if previous_closing else 0,
            "delta": round((latest_closing["net_revenue"] if latest_closing else 0) - (previous_closing["net_revenue"] if previous_closing else 0), 2),
        },
    }

    # --------------------------------
    # PAGE 4 - Transaction Verification
    # --------------------------------
    transaction_rows = []
    suspicious_count = 0
    edited_after_creation_count = 0
    flagged_transaction_count = 0
    activity_by_tx = defaultdict(list)
    for a in activity_rows:
        if a.entity_type and a.entity_id:
            activity_by_tx[(str(a.entity_type).title(), int(a.entity_id))].append(a)

    for sale in sales_rows:
        cash, card, transfer, credit = _sale_payment_split(sale)
        txn_type = "Sale"
        key = (txn_type, sale.id)
        review = reviews_map.get(key)
        logs = activity_by_tx.get(key, [])
        edited_after = any(str(l.action or "").lower() == "update" for l in logs)
        if edited_after:
            edited_after_creation_count += 1
        status = review.status if review else "Pending Review"
        flagged = status == "Flagged" or edited_after
        if flagged:
            flagged_transaction_count += 1
        suspicious = edited_after or float(sale.total or 0) >= large_txn_threshold or (float(sale.subtotal or 0) > 0 and float(sale.total or 0) <= 0)
        if suspicious:
            suspicious_count += 1
        transaction_rows.append(
            {
                "id": f"S-{sale.id}",
                "timestamp": sale.created_at.isoformat() if sale.created_at else None,
                "transaction_id": f"INV-{sale.id:05d}",
                "transaction_type": txn_type,
                "customer": sale.customer.name if sale.customer else "Walk-in",
                "amount": float(sale.total or 0),
                "payment_method": sale.payment_method or "N/A",
                "cashier": "System",
                "status": status,
                "edit_history_count": len(logs),
                "flag": "Yes" if flagged else "No",
                "status_badge": _status_badge(flagged=flagged, verified=status == "Verified", resolved=status == "Resolved"),
                "edited_after_creation": edited_after,
                "suspicious": suspicious,
            }
        )

    for repair in repairs_rows:
        key = ("Repair", repair.id)
        review = reviews_map.get(key)
        logs = activity_by_tx.get(key, [])
        edited_after = any(str(l.action or "").lower() == "update" for l in logs)
        if edited_after:
            edited_after_creation_count += 1
        status = review.status if review else "Pending Review"
        flagged = status == "Flagged" or edited_after
        if flagged:
            flagged_transaction_count += 1
        suspicious = edited_after or (str(repair.status or "").lower() in {"completed", "delivered"} and float(repair.advance_payment or 0) <= 0 and float(repair.estimated_cost or 0) > 0)
        if suspicious:
            suspicious_count += 1
        transaction_rows.append(
            {
                "id": f"R-{repair.id}",
                "timestamp": repair.created_at.isoformat() if repair.created_at else None,
                "transaction_id": repair.ticket_no or f"JOB-{repair.id:05d}",
                "transaction_type": "Repair",
                "customer": repair.customer.name if repair.customer else "Walk-in",
                "amount": float(repair.estimated_cost or 0),
                "payment_method": "Cash/Credit",
                "cashier": "Technician",
                "status": status,
                "edit_history_count": len(logs),
                "flag": "Yes" if flagged else "No",
                "status_badge": _status_badge(flagged=flagged, verified=status == "Verified", resolved=status == "Resolved"),
                "edited_after_creation": edited_after,
                "suspicious": suspicious,
            }
        )

    transaction_rows.sort(key=lambda row: row["timestamp"] or "", reverse=True)
    transaction_verification = {
        "kpis": [
            {"label": "Total Transactions", "value": len(transaction_rows), "tone": "sky"},
            {"label": "Verified Transactions", "value": len([r for r in transaction_rows if r["status"] == "Verified"]), "tone": "green"},
            {"label": "Unverified / Pending", "value": len([r for r in transaction_rows if r["status"] == "Pending Review"]), "tone": "amber"},
            {"label": "Flagged Transactions", "value": flagged_transaction_count, "tone": "red"},
            {"label": "Edited After Creation", "value": edited_after_creation_count, "tone": "amber"},
            {"label": "Suspicious Transactions", "value": suspicious_count, "tone": "red"},
        ],
        "rows": transaction_rows[:1000],
    }

    # --------------------------------
    # PAGE 5 - Discount & Override Audit
    # --------------------------------
    discount_rows = []
    discount_by_staff = Counter()
    discount_by_day = defaultdict(float)
    discount_by_category = Counter()
    threshold_counter = Counter()
    for sale in sales_rows:
        discount_amt = float(sale.discount_amount or 0)
        if discount_amt <= 0:
            continue
        subtotal = float(sale.subtotal or 0)
        discount_pct = (discount_amt / subtotal * 100) if subtotal > 0 else 0
        threshold_breached = discount_pct > discount_threshold_pct
        threshold_counter["above" if threshold_breached else "normal"] += 1
        day_key = sale.created_at.date().isoformat() if sale.created_at else "-"
        discount_by_day[day_key] += discount_amt
        discount_by_staff["System"] += discount_amt
        lines = sale_items_map.get(sale.id, [])
        product_name = lines[0].item_id if lines else "-"
        category = "Uncategorized"
        if lines:
            line_item = lines[0]
            inv = next((i for i in inventory_rows if i.id == line_item.item_id), None)
            if inv:
                product_name = inv.name
                category = inv.category or "Uncategorized"
        discount_by_category[category] += discount_amt
        matched_flag = flags_by_ref.get((f"sale-discount-{sale.id}", "Discount above threshold"))
        status = "Pending Review" if threshold_breached else "Verified"
        if matched_flag and matched_flag["status"] == "Resolved":
            status = "Resolved"
        discount_rows.append(
            {
                "id": sale.id,
                "date": sale.created_at.isoformat() if sale.created_at else None,
                "invoice_no": f"INV-{sale.id:05d}",
                "product_or_service": product_name,
                "original_price": round(subtotal, 2),
                "discount_pct": round(discount_pct, 2),
                "discount_amount": round(discount_amt, 2),
                "final_price": round(float(sale.total or 0), 2),
                "applied_by": "System",
                "reason": "POS Discount",
                "threshold_breached": threshold_breached,
                "approved_by": matched_flag["resolved_by"] if matched_flag else None,
                "status": status,
                "status_badge": _status_badge(
                    flagged=threshold_breached and status != "Resolved",
                    verified=not threshold_breached,
                    resolved=status == "Resolved",
                ),
            }
        )

    discount_override = {
        "kpis": [
            {"label": "Total Discounts Given", "value": len(discount_rows), "tone": "amber"},
            {"label": "Total Discount Value", "value": round(sum(row["discount_amount"] for row in discount_rows), 2), "tone": "amber"},
            {
                "label": "Discount as % Revenue",
                "value": round((sum(row["discount_amount"] for row in discount_rows) / sum(max(1, float(s.total or 0)) for s in sales_rows)) * 100, 2) if sales_rows else 0,
                "tone": "sky",
            },
            {"label": "Manual Price Overrides", "value": len(discount_rows), "tone": "indigo"},
            {"label": "Above-Threshold Discounts", "value": threshold_counter.get("above", 0), "tone": "red"},
            {
                "label": "Highest Single Discount",
                "value": round(max([row["discount_amount"] for row in discount_rows], default=0), 2),
                "tone": "red",
            },
        ],
        "rows": sorted(discount_rows, key=lambda x: x["date"] or "", reverse=True),
        "charts": {
            "discount_by_staff": [{"staff": k, "amount": round(v, 2)} for k, v in discount_by_staff.items()],
            "discount_trend": [{"date": k, "amount": round(v, 2)} for k, v in sorted(discount_by_day.items())],
            "discount_by_category": [{"category": k, "amount": round(v, 2)} for k, v in discount_by_category.items()],
            "threshold_distribution": [
                {"type": "Above Threshold", "count": threshold_counter.get("above", 0)},
                {"type": "Normal", "count": threshold_counter.get("normal", 0)},
            ],
        },
    }

    # --------------------------------
    # PAGE 6 - Void & Deletion Audit
    # --------------------------------
    void_delete_rows = []
    void_value_total = 0.0
    deletions = [a for a in activity_rows if str(a.action or "").lower() == "delete"]
    void_logs = [a for a in activity_rows if str(a.action or "").lower() == "void"]
    for sale in sales_rows:
        if not sale.is_voided:
            continue
        value = float(sale.total or 0)
        void_value_total += value
        row = {
            "id": f"void-sale-{sale.id}",
            "timestamp": sale.created_at.isoformat() if sale.created_at else None,
            "record_type": "Voided Sale Invoice",
            "record_id": f"INV-{sale.id:05d}",
            "description": sale.void_reason or "No reason captured",
            "original_value": value,
            "actor": "System",
            "reason": sale.void_reason or "-",
            "approved_by": None,
            "recoverable": True,
            "status": "Flagged" if not sale.void_reason else "Pending Review",
            "status_badge": _status_badge(flagged=True),
        }
        void_delete_rows.append(row)

    for log in deletions:
        row = {
            "id": f"delete-{log.id}",
            "timestamp": log.created_at.isoformat() if log.created_at else None,
            "record_type": f"Deleted {log.entity_type}",
            "record_id": str(log.entity_id),
            "description": log.description or "-",
            "original_value": 0,
            "actor": _serialize_user(log.user) or "System",
            "reason": log.description or "-",
            "approved_by": "Unknown",
            "recoverable": bool(log.is_reversible) and not bool(log.is_reversed),
            "status": "Flagged" if "approved" not in str(log.description or "").lower() else "Pending Review",
            "status_badge": _status_badge(flagged=True),
        }
        void_delete_rows.append(row)

    void_delete_rows.sort(key=lambda row: row["timestamp"] or "", reverse=True)
    void_staff_counter = Counter([row["actor"] for row in void_delete_rows])
    void_by_hour = Counter()
    for row in void_delete_rows:
        if row["timestamp"]:
            hour = datetime.fromisoformat(row["timestamp"]).hour
            void_by_hour[hour] += 1
    void_deletion = {
        "kpis": [
            {"label": "Total Voids", "value": len([r for r in void_delete_rows if "Voided" in r["record_type"]]), "tone": "amber"},
            {"label": "Total Deletions", "value": len(deletions), "tone": "red"},
            {"label": "Void Value (LKR)", "value": round(void_value_total, 2), "tone": "red"},
            {"label": "Cancellations Count", "value": len(void_logs), "tone": "amber"},
            {"label": "Deleted by Staff (Top)", "value": void_staff_counter.most_common(1)[0][0] if void_staff_counter else "-", "tone": "indigo"},
            {
                "label": "Unresolved Void Flags",
                "value": len([f for f in flags_serialized if f["module"] == "Void & Deletion Audit" and f["status"] != "Resolved"]),
                "tone": "red",
            },
        ],
        "rows": void_delete_rows[:1000],
        "charts": {
            "voids_per_staff": [{"staff": k, "count": v} for k, v in void_staff_counter.items()],
            "void_trend": flag_trend_line,
            "record_type_distribution": [{"record_type": k, "count": v} for k, v in Counter([r["record_type"] for r in void_delete_rows]).items()],
            "void_by_hour": [{"hour": h, "count": c} for h, c in sorted(void_by_hour.items())],
        },
    }

    # --------------------------------
    # PAGE 7 - Payment Integrity Check
    # --------------------------------
    payment_rows = []
    unmatched_count = 0
    duplicate_count = 0
    partial_count = 0
    mismatch_count = 0
    unreconciled_cash_count = 0
    seen_payment_key = {}
    recon_dates = {r.recon_date.date().isoformat(): r for r in recon_rows if r.recon_date}

    for sale in sales_rows:
        cash, card, transfer, credit = _sale_payment_split(sale)
        paid_amount = cash + card + transfer
        partial = credit > 0
        if partial:
            partial_count += 1
        payment_method = sale.payment_method or "Unknown"
        method_lower = payment_method.lower()
        mismatch = ("cash" in method_lower and card > 0) or ("card" in method_lower and cash > 0)
        if mismatch:
            mismatch_count += 1
        date_key = sale.created_at.date().isoformat() if sale.created_at else "-"
        reconciled = True
        if "cash" in method_lower:
            reconciled = date_key in recon_dates
            if not reconciled:
                unreconciled_cash_count += 1
        matched = sale.id is not None
        if not matched:
            unmatched_count += 1

        duplicate_key = (str(sale.customer_id or "walkin"), int(round(paid_amount)))
        duplicate_flag = False
        if duplicate_key in seen_payment_key:
            prev_ts = seen_payment_key[duplicate_key]
            if sale.created_at and prev_ts and abs((sale.created_at - prev_ts).total_seconds()) <= 900:
                duplicate_flag = True
                duplicate_count += 1
        seen_payment_key[duplicate_key] = sale.created_at

        status_badge = _status_badge(flagged=(not matched) or duplicate_flag or mismatch or (partial and credit > 0), verified=matched and reconciled and not partial)
        payment_rows.append(
            {
                "id": f"SALE-{sale.id}",
                "date": sale.created_at.isoformat() if sale.created_at else None,
                "payment_id": f"PAY-S-{sale.id:05d}",
                "invoice_ref": f"INV-{sale.id:05d}",
                "customer": sale.customer.name if sale.customer else "Walk-in",
                "amount": round(paid_amount, 2),
                "method": payment_method,
                "collected_by": "System",
                "matched": matched,
                "reconciled": reconciled,
                "flag": "Yes" if (not matched or duplicate_flag or mismatch) else "No",
                "status_badge": status_badge,
                "balance": round(credit, 2),
            }
        )

    payment_integrity = {
        "kpis": [
            {"label": "Total Payments Recorded", "value": len(payment_rows), "tone": "sky"},
            {"label": "Unmatched Payments", "value": unmatched_count, "tone": "red"},
            {"label": "Duplicate Payment Flags", "value": duplicate_count, "tone": "red"},
            {"label": "Partial Payments Pending", "value": partial_count, "tone": "amber"},
            {"label": "Payment Method Mismatches", "value": mismatch_count, "tone": "amber"},
            {"label": "Cash Payments Unreconciled", "value": unreconciled_cash_count, "tone": "red"},
        ],
        "rows": payment_rows[:1200],
        "charts": {
            "method_distribution": [{"method": k, "count": v} for k, v in Counter([row["method"] for row in payment_rows]).items()],
            "unmatched_trend": flag_trend_line,
            "collection_by_cashier": [{"cashier": k, "count": v} for k, v in Counter([row["collected_by"] for row in payment_rows]).items()],
        },
    }

    # --------------------------------
    # PAGE 8 - Outstanding Reconciliation
    # --------------------------------
    customer_balance = defaultdict(lambda: {"invoices": 0, "billed": 0.0, "paid": 0.0, "balance": 0.0, "last_payment_date": None})
    for sale in sales_rows:
        key = sale.customer_id or 0
        cash, card, transfer, credit = _sale_payment_split(sale)
        billed = float(sale.total or 0)
        paid = cash + card + transfer
        customer_balance[key]["invoices"] += 1
        customer_balance[key]["billed"] += billed
        customer_balance[key]["paid"] += paid
        customer_balance[key]["balance"] += max(0.0, billed - paid)
        if sale.created_at:
            existing = customer_balance[key]["last_payment_date"]
            if not existing or sale.created_at > existing:
                customer_balance[key]["last_payment_date"] = sale.created_at
    for repair in repairs_rows:
        key = repair.customer_id or 0
        billed = float(repair.estimated_cost or 0)
        paid = float(repair.advance_payment or 0)
        customer_balance[key]["billed"] += billed
        customer_balance[key]["paid"] += paid
        customer_balance[key]["balance"] += max(0.0, billed - paid)

    outstanding_rows = []
    for customer_id, bucket in customer_balance.items():
        if bucket["balance"] <= 0:
            continue
        customer_name = "Walk-in"
        customer_phone = None
        if customer_id and any(s.customer_id == customer_id for s in sales_rows):
            sale_ref = next((s for s in sales_rows if s.customer_id == customer_id and s.customer), None)
            if sale_ref and sale_ref.customer:
                customer_name = sale_ref.customer.name
                customer_phone = sale_ref.customer.phone
        suspicious_edit = any("outstanding" in str(a.description or "").lower() and a.user_id for a in activity_rows)
        status_badge = _status_badge(flagged=suspicious_edit, verified=not suspicious_edit)
        outstanding_rows.append(
            {
                "customer_id": customer_id,
                "customer": customer_name,
                "phone": customer_phone,
                "invoice_count": bucket["invoices"],
                "total_billed": round(bucket["billed"], 2),
                "total_paid": round(bucket["paid"], 2),
                "balance": round(bucket["balance"], 2),
                "last_payment_date": bucket["last_payment_date"].isoformat() if bucket["last_payment_date"] else None,
                "risk_level": "High" if bucket["balance"] > 100000 else "Medium" if bucket["balance"] > 20000 else "Low",
                "status_badge": status_badge,
            }
        )
    outstanding_rows.sort(key=lambda x: x["balance"], reverse=True)
    total_outstanding = sum(r["balance"] for r in outstanding_rows)
    outstanding_reconciliation = {
        "kpis": [
            {"label": "Total Outstanding (System)", "value": round(total_outstanding, 2), "tone": "red"},
            {"label": "Outstanding Verified", "value": len([r for r in outstanding_rows if r["status_badge"] == "Verified"]), "tone": "green"},
            {"label": "Discrepancy Amount", "value": round(sum(r["balance"] for r in outstanding_rows if r["status_badge"] == "Flagged"), 2), "tone": "amber"},
            {
                "label": "Outstanding Invoices Changed",
                "value": len([a for a in activity_rows if "outstanding" in str(a.description or "").lower()]),
                "tone": "amber",
            },
            {"label": "Suspicious Balance Edits", "value": len([a for a in activity_rows if "balance" in str(a.description or "").lower() and str(a.action or "").lower() == "update"]), "tone": "red"},
        ],
        "rows": outstanding_rows,
    }

    # --------------------------------
    # PAGE 9 - Expense Audit
    # --------------------------------
    expense_rows: list[dict] = []
    duplicate_expense_flags = 0
    expense_hash = {}
    for exp in expense_entries:
        expense_dt = exp.expense_date or exp.created_at
        date_key = expense_dt.date().isoformat() if expense_dt else "-"
        desc = exp.description or exp.notes or f"Expense {exp.expense_code}"
        category = exp.category or "Miscellaneous"
        amount = float(exp.amount or 0)
        key = (exp.supplier_id or exp.vendor_name or "-", int(round(amount)), date_key)
        duplicate = key in expense_hash
        if duplicate:
            duplicate_expense_flags += 1
        expense_hash[key] = True
        above_threshold = amount > expense_threshold
        verified = str(exp.status or "").lower() in {"approved", "paid"}
        flagged = duplicate or (above_threshold and not verified)
        expense_rows.append(
            {
                "id": exp.id,
                "date": expense_dt.isoformat() if expense_dt else None,
                "category": category,
                "description": desc,
                "amount": round(amount, 2),
                "entered_by": _serialize_user(exp.created_by) or "System",
                "receipt_ref": exp.reference_no or exp.expense_code,
                "verified": verified,
                "approved_by": _serialize_user(exp.approved_by) if verified else None,
                "flag": "Yes" if flagged else "No",
                "notes": "Awaiting approval" if not verified else "Verified approval",
                "status": exp.status,
                "status_badge": _status_badge(flagged=flagged, verified=verified),
            }
        )
    expense_rows.sort(key=lambda x: x["date"] or "", reverse=True)
    expense_audit = {
        "kpis": [
            {"label": "Total Expenses", "value": round(sum(r["amount"] for r in expense_rows), 2), "tone": "sky"},
            {"label": "Unverified Expenses", "value": len([r for r in expense_rows if not r["verified"]]), "tone": "amber"},
            {"label": "Above-Threshold Expenses", "value": len([r for r in expense_rows if r["amount"] > expense_threshold]), "tone": "red"},
            {"label": "Duplicate Expense Flags", "value": duplicate_expense_flags, "tone": "red"},
            {"label": "Expense Edits After Approval", "value": len([a for a in activity_rows if str(a.entity_type or "").lower() == "expense" and str(a.action or "").lower() == "update"]), "tone": "amber"},
            {"label": "Rejected Expenses", "value": len([r for r in expense_rows if r["status_badge"] == "Flagged"]), "tone": "red"},
        ],
        "rows": expense_rows,
    }

    # --------------------------------
    # PAGE 10 - Stock vs Sales Reconciliation
    # --------------------------------
    movement_group = defaultdict(list)
    for mv in movement_rows:
        movement_group[mv.item_id].append(mv)
    stock_rows = []
    for item in inventory_rows:
        item_mvs = movement_group.get(item.id, [])
        purchased = sum(int(m.quantity or 0) for m in item_mvs if str(m.movement_type or "").upper() in {"IN", "PURCHASE", "GRN"})
        sold = sum(abs(int(m.quantity or 0)) for m in item_mvs if str(m.movement_type or "").upper() == "SALE")
        used_repairs = sum(abs(int(m.quantity or 0)) for m in item_mvs if str(m.movement_type or "").upper() == "REPAIR_CONSUME")
        adjustments = sum(int(m.quantity or 0) for m in item_mvs if str(m.movement_type or "").upper() in {"ADJUSTMENT", "VOID_RETURN", "RETURN"})
        net_period = purchased - sold - used_repairs + adjustments
        actual_closing = int(item.quantity or 0)
        opening_stock = actual_closing - net_period
        expected_closing = opening_stock + purchased - sold - used_repairs + adjustments
        difference = actual_closing - expected_closing
        variance_pct = (difference / expected_closing * 100) if expected_closing else 0
        flagged = abs(difference) > 0
        stock_rows.append(
            {
                "item_id": item.id,
                "product": item.name,
                "opening_stock": int(opening_stock),
                "purchased": int(purchased),
                "sold_pos": int(sold),
                "used_repairs": int(used_repairs),
                "adjustments": int(adjustments),
                "expected_closing": int(expected_closing),
                "actual_closing": int(actual_closing),
                "difference": int(difference),
                "variance_pct": round(variance_pct, 2),
                "discrepancy_value": round(abs(difference) * float(item.cost_price or 0), 2),
                "status_badge": _status_badge(flagged=flagged, verified=not flagged),
            }
        )
    stock_rows.sort(key=lambda x: abs(x["difference"]), reverse=True)
    stock_reconciliation = {
        "kpis": [
            {"label": "Expected Stock", "value": sum(r["expected_closing"] for r in stock_rows), "tone": "sky"},
            {"label": "Actual Stock Count", "value": sum(r["actual_closing"] for r in stock_rows), "tone": "sky"},
            {"label": "Discrepancy Units", "value": sum(abs(r["difference"]) for r in stock_rows), "tone": "amber"},
            {"label": "Discrepancy Value", "value": round(sum(r["discrepancy_value"] for r in stock_rows), 2), "tone": "red"},
            {"label": "Unexplained Adjustments", "value": len([r for r in stock_rows if r["adjustments"] != 0]), "tone": "amber"},
            {"label": "Shrinkage Value", "value": round(sum(r["discrepancy_value"] for r in stock_rows if r["difference"] < 0), 2), "tone": "red"},
        ],
        "rows": stock_rows,
        "charts": {
            "variance_by_product": [{"product": r["product"], "difference": r["difference"]} for r in stock_rows[:20]],
            "reconciliation_trend": flag_trend_line,
            "shrinkage_trend": [{"date": r["date"], "value": 0} for r in flag_trend_line],
        },
    }

    # --------------------------------
    # PAGE 11 - Technician Billing Audit
    # --------------------------------
    tech_rows = []
    completed_repairs = [r for r in repairs_rows if str(r.status or "").lower() in {"completed", "delivered"}]
    invoiced_count = 0
    unpaid_delivered = 0
    for repair in completed_repairs:
        invoice_created = float(repair.advance_payment or 0) > 0
        if invoice_created:
            invoiced_count += 1
        amount = float(repair.estimated_cost or 0)
        collected = float(repair.advance_payment or 0)
        balance = max(0.0, amount - collected)
        if str(repair.status or "").lower() == "delivered" and balance > 0:
            unpaid_delivered += 1
        flagged = (not invoice_created and amount > 0) or (str(repair.status or "").lower() == "delivered" and balance > 0) or amount == 0
        tech_rows.append(
            {
                "job_id": repair.ticket_no or f"JOB-{repair.id:05d}",
                "date_completed": repair.delivered_at.isoformat() if repair.delivered_at else (repair.created_at.isoformat() if repair.created_at else None),
                "technician": repair.technician or "Unassigned",
                "device": repair.device_model,
                "customer": repair.customer.name if repair.customer else "Walk-in",
                "invoice_created": invoice_created,
                "invoice_amount": round(amount, 2),
                "amount_collected": round(collected, 2),
                "balance": round(balance, 2),
                "flag": "Yes" if flagged else "No",
                "status_badge": _status_badge(flagged=flagged, verified=not flagged),
            }
        )
    tech_rows.sort(key=lambda x: x["date_completed"] or "", reverse=True)
    technician_billing = {
        "kpis": [
            {"label": "Repairs Completed", "value": len(completed_repairs), "tone": "sky"},
            {"label": "Repairs Invoiced", "value": invoiced_count, "tone": "green"},
            {"label": "Uninvoiced Completions", "value": max(0, len(completed_repairs) - invoiced_count), "tone": "red"},
            {"label": "Delivered but Unpaid", "value": unpaid_delivered, "tone": "red"},
            {"label": "Revenue from Completed Repairs", "value": round(sum(r["invoice_amount"] for r in tech_rows), 2), "tone": "sky"},
            {"label": "Uninvoiced Revenue Estimate", "value": round(sum(r["invoice_amount"] for r in tech_rows if not r["invoice_created"]), 2), "tone": "amber"},
        ],
        "rows": tech_rows,
    }

    # --------------------------------
    # PAGE 12 - Flags & Alerts
    # --------------------------------
    open_flags = [f for f in flags_serialized if f["status"] in {"Open", "Pending Review", "Escalated"}]
    resolved_flags_today = [f for f in flags_serialized if f["status"] == "Resolved" and f["resolved_at"] and datetime.fromisoformat(f["resolved_at"]) >= today_start]
    resolution_times = []
    for row in flags_rows:
        if row.resolved_at and row.raised_at:
            resolution_times.append((row.resolved_at - row.raised_at).total_seconds() / 3600)
    avg_resolution_hours = round(sum(resolution_times) / len(resolution_times), 2) if resolution_times else 0
    oldest_days = 0
    if open_flags:
        oldest_ts = min(datetime.fromisoformat(f["date_raised"]) for f in open_flags if f["date_raised"])
        oldest_days = max(0, (now - oldest_ts).days)

    severity_counter = Counter([f["severity"] for f in open_flags])
    module_counter = Counter([f["module"] for f in flags_serialized])
    staff_counter = Counter([f["assigned_to"] or "Unassigned" for f in flags_serialized])
    resolution_hist = Counter(int(t // 24) for t in resolution_times)
    flags_alerts = {
        "kpis": [
            {"label": "Total Open Flags", "value": len(open_flags), "tone": "red"},
            {"label": "Critical Flags", "value": severity_counter.get("Critical", 0), "tone": "red"},
            {"label": "High Priority Flags", "value": severity_counter.get("High", 0), "tone": "amber"},
            {"label": "Resolved Today", "value": len(resolved_flags_today), "tone": "green"},
            {"label": "Avg Resolution Time (hrs)", "value": avg_resolution_hours, "tone": "indigo"},
            {"label": "Oldest Unresolved Flag (days)", "value": oldest_days, "tone": "amber"},
        ],
        "rows": flags_serialized[:2000],
        "charts": {
            "open_by_severity": [{"severity": k, "count": v} for k, v in severity_counter.items()],
            "flags_per_day": flag_trend_line,
            "flags_by_module": [{"module": k, "count": v} for k, v in module_counter.items()],
            "resolution_histogram": [{"days_bucket": k, "count": v} for k, v in sorted(resolution_hist.items())],
            "staff_involvement": [{"staff": k, "count": v} for k, v in staff_counter.items()],
        },
    }

    return {
        "filters": {
            "staff": [{"id": user.id, "name": _serialize_user(user)} for user in users_rows],
            "modules": sorted(list(set([f.module for f in flags_rows if f.module]))),
            "flag_statuses": ["all", "Open", "Pending Review", "Escalated", "Resolved"],
        },
        "overview": overview,
        "cash_reconciliation": cash_reconciliation,
        "daily_closing": daily_closing,
        "transaction_verification": transaction_verification,
        "discount_override": discount_override,
        "void_deletion": void_deletion,
        "payment_integrity": payment_integrity,
        "outstanding_reconciliation": outstanding_reconciliation,
        "expense_audit": expense_audit,
        "stock_sales_reconciliation": stock_reconciliation,
        "technician_billing": technician_billing,
        "flags_alerts": flags_alerts,
    }


@router.post("/cash-reconciliation", dependencies=[Depends(require_permission("financial_audit.approve"))])
def create_cash_reconciliation(
    payload: CashReconciliationIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    recon_date = _parse_iso_date(payload.recon_date) or utcnow()
    day_start = datetime(recon_date.year, recon_date.month, recon_date.day)
    day_end = day_start + timedelta(days=1)
    sales_rows = (
        db.query(Sale)
        .filter(and_(Sale.created_at >= day_start, Sale.created_at < day_end, Sale.is_voided == False))
        .all()
    )
    system_cash_total = sum(_sale_payment_split(sale)[0] for sale in sales_rows)
    cash_txn_count = len([sale for sale in sales_rows if _sale_payment_split(sale)[0] > 0])
    counted = float(payload.counted_cash_total or 0)
    difference = round(counted - system_cash_total, 2)
    status = _recon_status(difference)

    row = CashReconciliation(
        recon_code=_next_code(db, CashReconciliation, "RECON"),
        recon_date=recon_date,
        shift=payload.shift,
        cashier_id=payload.cashier_id or (current_user.id if current_user else None),
        opening_float=float(payload.opening_float or 0),
        system_cash_total=round(system_cash_total, 2),
        counted_cash_total=round(counted, 2),
        closing_float=float(payload.closing_float or 0),
        cash_transactions_count=cash_txn_count,
        denomination_json=json.dumps(payload.denominations or {}),
        difference=difference,
        status=status,
        notes=payload.notes,
        verified_by_user_id=current_user.id if current_user else None,
        verified_at=utcnow(),
    )
    db.add(row)
    db.flush()

    if status in {"Minor Variance", "Major Variance"}:
        severity = "High" if status == "Major Variance" else "Medium"
        db.add(
            FinancialAuditFlag(
                flag_code=_next_code(db, FinancialAuditFlag, "FLAG"),
                severity=severity,
                module="Cash Reconciliation",
                flag_type="Cash variance detected",
                description=f"{status} for {day_start.date().isoformat()} by cashier {payload.cashier_id or 'N/A'}: LKR {difference:,}.",
                raised_by_source="System",
                status="Open",
                reference_code=f"recon-{row.id}",
                amount=difference,
                transaction_type="CashReconciliation",
                transaction_id=row.id,
            )
        )
    db.commit()
    db.refresh(row)
    return _serialize_reconciliation(row)


@router.put("/cash-reconciliation/{recon_id}/resolve", dependencies=[Depends(require_permission("financial_audit.approve"))])
def resolve_cash_reconciliation(
    recon_id: int,
    payload: CashReconciliationResolveIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(CashReconciliation).filter(CashReconciliation.id == recon_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Reconciliation record not found")
    row.status = payload.status or "Resolved"
    row.resolution_notes = payload.resolution_notes
    row.verified_by_user_id = current_user.id if current_user else None
    row.verified_at = utcnow()

    linked_flags = (
        db.query(FinancialAuditFlag)
        .filter(
            FinancialAuditFlag.transaction_type == "CashReconciliation",
            FinancialAuditFlag.transaction_id == recon_id,
            FinancialAuditFlag.status.in_(["Open", "Pending Review", "Escalated"]),
        )
        .all()
    )
    for flag in linked_flags:
        flag.status = "Resolved"
        flag.resolution_notes = payload.resolution_notes
        flag.resolved_by_user_id = current_user.id if current_user else None
        flag.resolved_at = utcnow()
    db.commit()
    db.refresh(row)
    return _serialize_reconciliation(row)


@router.post("/daily-closing/generate", dependencies=[Depends(require_permission("financial_audit.approve"))])
def generate_daily_closing(
    payload: FinancialDailyClosingGenerateIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    base_date = _parse_iso_date(payload.report_date) or utcnow()
    day_start = datetime(base_date.year, base_date.month, base_date.day)
    day_end = day_start + timedelta(days=1)

    sales_rows = db.query(Sale).filter(and_(Sale.created_at >= day_start, Sale.created_at < day_end)).all()
    repair_rows = db.query(RepairTicket).filter(and_(RepairTicket.created_at >= day_start, RepairTicket.created_at < day_end)).all()
    expense_rows = db.query(Expense).filter(and_(Expense.expense_date >= day_start, Expense.expense_date < day_end)).all()
    return_rows = db.query(ReturnRecord).filter(and_(ReturnRecord.created_at >= day_start, ReturnRecord.created_at < day_end)).all()

    sales_cash = sales_card = sales_transfer = sales_credit = 0.0
    for sale in sales_rows:
        cash, card, transfer, credit = _sale_payment_split(sale)
        sales_cash += cash
        sales_card += card
        sales_transfer += transfer
        sales_credit += credit
    sales_total = sum(float(s.total or 0) for s in sales_rows if not s.is_voided)

    repairs_cash = repairs_card = repairs_credit = 0.0
    for repair in repair_rows:
        if str(repair.status or "").lower() not in {"completed", "delivered"}:
            continue
        cash, card, credit = _repair_payment_split(repair)
        repairs_cash += cash
        repairs_card += card
        repairs_credit += credit
    repairs_total = sum(float(r.estimated_cost or 0) for r in repair_rows if str(r.status or "").lower() in {"completed", "delivered"})

    refunds_issued = sum(float(r.refund_amount or 0) for r in return_rows)
    discounts_applied = sum(float(s.discount_amount or 0) for s in sales_rows if not s.is_voided)
    voids_cancellations = sum(float(s.total or 0) for s in sales_rows if s.is_voided)
    total_revenue = sales_total + repairs_total
    net_revenue = total_revenue - refunds_issued - discounts_applied - voids_cancellations
    expenses_today = sum(float(exp.amount or 0) for exp in expense_rows if str(exp.status or "").lower() in {"approved", "paid"})
    net_income_today = net_revenue - expenses_today

    latest_recon = (
        db.query(CashReconciliation)
        .filter(and_(CashReconciliation.recon_date >= day_start, CashReconciliation.recon_date < day_end))
        .order_by(CashReconciliation.recon_date.desc())
        .first()
    )
    expected_cash = sales_cash + repairs_cash
    counted_cash = float(payload.counted_cash if payload.counted_cash is not None else (latest_recon.counted_cash_total if latest_recon else 0))
    variance = round(counted_cash - expected_cash, 2)
    cash_status = "BALANCED" if variance == 0 else "VARIANCE"
    has_unresolved_flags = (
        db.query(FinancialAuditFlag)
        .filter(
            FinancialAuditFlag.raised_at >= day_start,
            FinancialAuditFlag.raised_at < day_end,
            FinancialAuditFlag.status.in_(["Open", "Pending Review", "Escalated"]),
        )
        .count()
        > 0
    )

    report = (
        db.query(FinancialDailyClosing)
        .filter(
            FinancialDailyClosing.report_date >= day_start,
            FinancialDailyClosing.report_date < day_end,
        )
        .first()
    )
    if not report:
        report = FinancialDailyClosing(
            report_code=_next_code(db, FinancialDailyClosing, "CLOSE"),
            report_date=day_start,
        )
        db.add(report)

    report.generated_at = utcnow()
    report.status = "Flagged" if has_unresolved_flags or variance != 0 else "Unsigned"
    report.sales_cash = round(sales_cash, 2)
    report.sales_card = round(sales_card, 2)
    report.sales_transfer = round(sales_transfer, 2)
    report.sales_credit = round(sales_credit, 2)
    report.sales_total = round(sales_total, 2)
    report.repairs_cash = round(repairs_cash, 2)
    report.repairs_card = round(repairs_card, 2)
    report.repairs_credit = round(repairs_credit, 2)
    report.repairs_total = round(repairs_total, 2)
    report.total_revenue = round(total_revenue, 2)
    report.refunds_issued = round(refunds_issued, 2)
    report.discounts_applied = round(discounts_applied, 2)
    report.voids_cancellations = round(voids_cancellations, 2)
    report.net_revenue = round(net_revenue, 2)
    report.expenses_today = round(expenses_today, 2)
    report.net_income_today = round(net_income_today, 2)
    report.expected_cash = round(expected_cash, 2)
    report.counted_cash = round(counted_cash, 2)
    report.variance = variance
    report.cash_status = cash_status
    report.total_invoices = len(sales_rows)
    report.total_repairs_completed = len([r for r in repair_rows if str(r.status or "").lower() in {"completed", "delivered"}])
    report.voids_count = len([s for s in sales_rows if s.is_voided])
    report.refunds_count = len(return_rows)
    report.partial_payments = len([s for s in sales_rows if _sale_payment_split(s)[3] > 0])
    report.has_unresolved_flags = has_unresolved_flags
    report.notes = payload.notes
    db.commit()
    db.refresh(report)
    return _serialize_daily_closing(report)


@router.put("/daily-closing/{closing_id}/verify", dependencies=[Depends(require_permission("financial_audit.approve"))])
def verify_daily_closing(
    closing_id: int,
    payload: FinancialDailyClosingVerifyIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(FinancialDailyClosing).filter(FinancialDailyClosing.id == closing_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Daily closing report not found")
    row.status = "Signed"
    row.verified_by_user_id = current_user.id if current_user else None
    row.verification_time = utcnow()
    if payload.notes:
        row.notes = payload.notes

    linked_flags = (
        db.query(FinancialAuditFlag)
        .filter(
            FinancialAuditFlag.transaction_type == "DailyClosing",
            FinancialAuditFlag.transaction_id == closing_id,
            FinancialAuditFlag.status.in_(["Open", "Pending Review", "Escalated"]),
        )
        .all()
    )
    for flag in linked_flags:
        flag.status = "Resolved"
        flag.resolved_by_user_id = current_user.id if current_user else None
        flag.resolved_at = utcnow()
        if not flag.resolution_notes:
            flag.resolution_notes = "Resolved during daily closing sign-off."

    db.commit()
    db.refresh(row)
    return _serialize_daily_closing(row)


@router.put("/transactions/{transaction_type}/{transaction_id}/review", dependencies=[Depends(require_permission("financial_audit.approve"))])
def review_transaction(
    transaction_type: str,
    transaction_id: int,
    payload: FinancialTransactionReviewIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    normalized_type = transaction_type.title()
    review = (
        db.query(FinancialTransactionReview)
        .filter(
            FinancialTransactionReview.transaction_type == normalized_type,
            FinancialTransactionReview.transaction_id == transaction_id,
        )
        .first()
    )
    if not review:
        review = FinancialTransactionReview(
            transaction_type=normalized_type,
            transaction_id=transaction_id,
        )
        db.add(review)
    review.status = payload.status
    review.notes = payload.notes
    review.flagged_reason = payload.flagged_reason
    review.verified_by_user_id = current_user.id if current_user else None
    review.verified_at = utcnow()

    if payload.status == "Flagged":
        db.add(
            FinancialAuditFlag(
                flag_code=_next_code(db, FinancialAuditFlag, "FLAG"),
                severity="High",
                module="Transaction Verification",
                flag_type="Manual transaction flag",
                description=payload.flagged_reason or f"{normalized_type} #{transaction_id} flagged manually.",
                raised_by_source="User",
                raised_by_user_id=current_user.id if current_user else None,
                status="Open",
                transaction_type=normalized_type,
                transaction_id=transaction_id,
                reference_code=f"manual-txn-{normalized_type}-{transaction_id}-{int(utcnow().timestamp())}",
            )
        )
    db.commit()
    db.refresh(review)
    return {
        "id": review.id,
        "transaction_type": review.transaction_type,
        "transaction_id": review.transaction_id,
        "status": review.status,
        "notes": review.notes,
        "flagged_reason": review.flagged_reason,
        "verified_by": _serialize_user(review.verified_by),
        "verified_at": review.verified_at.isoformat() if review.verified_at else None,
    }


@router.post("/flags", dependencies=[Depends(require_permission("financial_audit.approve"))])
def create_financial_flag(
    payload: FinancialFlagCreateIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = FinancialAuditFlag(
        flag_code=_next_code(db, FinancialAuditFlag, "FLAG"),
        raised_at=utcnow(),
        severity=payload.severity,
        module=payload.module,
        flag_type=payload.flag_type,
        description=payload.description,
        raised_by_source="User",
        raised_by_user_id=current_user.id if current_user else None,
        assigned_to_user_id=payload.assigned_to_user_id,
        status="Open",
        transaction_type=payload.transaction_type,
        transaction_id=payload.transaction_id,
        reference_code=payload.reference_code or f"user-{int(utcnow().timestamp())}",
        amount=float(payload.amount or 0),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _flag_record(row)


@router.put("/flags/{flag_id}/resolve", dependencies=[Depends(require_permission("financial_audit.approve"))])
def resolve_financial_flag(
    flag_id: int,
    payload: FinancialFlagResolveIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(FinancialAuditFlag).filter(FinancialAuditFlag.id == flag_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Flag not found")
    row.status = payload.status or "Resolved"
    row.resolution_notes = payload.resolution_notes
    row.resolved_by_user_id = current_user.id if current_user else None
    row.resolved_at = utcnow()
    db.commit()
    db.refresh(row)
    return _flag_record(row)


@router.put("/flags/{flag_id}/escalate", dependencies=[Depends(require_permission("financial_audit.approve"))])
def escalate_financial_flag(
    flag_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(FinancialAuditFlag).filter(FinancialAuditFlag.id == flag_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Flag not found")
    row.status = "Escalated"
    row.assigned_to_user_id = current_user.id if current_user else row.assigned_to_user_id
    if row.resolution_notes:
        row.resolution_notes = f"{row.resolution_notes}\nEscalated at {utcnow().isoformat()}."
    else:
        row.resolution_notes = f"Escalated at {utcnow().isoformat()}."
    db.commit()
    db.refresh(row)
    return _flag_record(row)


@router.put("/flags/bulk-resolve", dependencies=[Depends(require_permission("financial_audit.approve"))])
def bulk_resolve_flags(
    payload: FinancialFlagBulkResolveIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if not payload.flag_ids:
        return {"ok": True, "updated": 0}
    rows = (
        db.query(FinancialAuditFlag)
        .filter(FinancialAuditFlag.id.in_(payload.flag_ids))
        .all()
    )
    now = utcnow()
    for row in rows:
        row.status = "Resolved"
        row.resolution_notes = payload.resolution_notes
        row.resolved_by_user_id = current_user.id if current_user else None
        row.resolved_at = now
    db.commit()
    return {"ok": True, "updated": len(rows)}
