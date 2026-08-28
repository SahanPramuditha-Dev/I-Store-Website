"""
shifts_router.py
================
Cashier Shift Management, Register Float Balancing, Midday Cash Drops,
Interim X-Readings, and Automated End-of-Day (EOD) Z-Report Reconciliation.
"""

from datetime import datetime
import json
import logging
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Query, Request, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import desc, and_

from app.database import get_db
from app.auth import get_current_user, require_permission
from app.core.tenant_guard import scope_query, stamp_tenant
from app.models import CashReconciliation, Sale, User, AppSetting
from app.utils.time import utcnow, format_iso_utc
from app.utils.whatsapp_helper import resolve_store_variables, normalize_sri_lankan_phone, log_and_send_whatsapp

router = APIRouter(prefix="/shifts", tags=["shifts"])
logger = logging.getLogger("istore.shifts")


class OpenShiftIn(BaseModel):
    opening_float: float = 0.0
    shift_name: Optional[str] = "Main Register"
    notes: Optional[str] = None


class CashMovementIn(BaseModel):
    movement_type: str = Field(..., description="'drop' (cash skim to safe) or 'in' (add float/petty cash)")
    amount: float = Field(..., gt=0, description="Movement amount in LKR")
    reason: str = Field(..., min_length=2, description="Reason for cash drop or cash in")


class CloseShiftIn(BaseModel):
    counted_cash_total: float
    closing_float: Optional[float] = 0.0
    denominations: Optional[Dict[str, int]] = None
    notes: Optional[str] = None
    send_whatsapp_report: Optional[bool] = True


def calculate_active_shift_sales(db: Session, cashier_id: Optional[int], start_time: datetime, request: Optional[Request] = None) -> Dict[str, Any]:
    """Calculates all sales transactions and payment breakdowns completed since the shift opened."""
    query = db.query(Sale).filter(
        Sale.created_at >= start_time,
        Sale.is_voided == False  # noqa: E712
    )
    if request:
        query = scope_query(query, Sale, request)

    if cashier_id:
        query = query.filter(Sale.created_by == cashier_id)

    sales = query.all()

    # Also count voided sales in this shift
    void_query = db.query(Sale).filter(
        Sale.created_at >= start_time,
        Sale.is_voided == True  # noqa: E712
    )
    if request:
        void_query = scope_query(void_query, Sale, request)
    if cashier_id:
        void_query = void_query.filter(Sale.created_by == cashier_id)
    voided_sales = void_query.all()

    cash_sales = 0.0
    card_sales = 0.0
    bank_sales = 0.0
    credit_sales = 0.0
    store_credit_sales = 0.0
    discounts_total = 0.0
    tax_total = 0.0
    cash_tx_count = 0

    for s in sales:
        method = str(s.payment_method or "Cash").lower()
        tot = float(s.total or 0)
        discounts_total += float(s.discount_amount or 0)
        tax_total += float(s.tax_amount or 0)

        if "cash" in method:
            cash_sales += float(s.cash_amount or tot)
            cash_tx_count += 1
        elif "card" in method:
            card_sales += float(s.card_amount or tot)
        elif "bank" in method or "transfer" in method:
            bank_sales += tot
        elif "store_credit" in method or "storecredit" in method:
            store_credit_sales += tot
        elif "credit" in method:
            credit_sales += tot
        else:
            cash_sales += float(s.cash_amount or tot)
            cash_tx_count += 1

    gross_sales = sum(float(s.subtotal or s.total or 0) for s in sales)
    net_sales = sum(float(s.total or 0) for s in sales)
    void_total = sum(float(s.total or 0) for s in voided_sales)

    return {
        "cash_sales": cash_sales,
        "card_sales": card_sales,
        "bank_sales": bank_sales,
        "credit_sales": credit_sales,
        "store_credit_sales": store_credit_sales,
        "gross_sales": gross_sales,
        "net_sales": net_sales,
        "total_sales": net_sales,
        "discounts_total": discounts_total,
        "tax_total": tax_total,
        "total_transactions": len(sales),
        "cash_transactions_count": cash_tx_count,
        "voided_transactions_count": len(voided_sales),
        "voided_total": void_total
    }


def _resolve_user_name(user: Optional[User]) -> str:
    if not user:
        return "Cashier"
    return getattr(user, "name", None) or getattr(user, "full_name", None) or getattr(user, "username", None) or "Cashier"


@router.get("/current")
def get_current_shift(
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Returns the currently active open shift for the register."""
    shift_query = scope_query(db.query(CashReconciliation), CashReconciliation, request).filter(
        CashReconciliation.status.in_(["Open", "Pending Count"])
    ).order_by(desc(CashReconciliation.id))

    shift = shift_query.first()

    if not shift:
        return {"has_active_shift": False, "shift": None}

    sales_metrics = calculate_active_shift_sales(db, shift.cashier_id, shift.created_at, request)
    cash_drops = float(shift.cash_drops_total or 0.0)
    cash_ins = float(shift.cash_ins_total or 0.0)
    expected_drawer_cash = float(shift.opening_float or 0) + sales_metrics["cash_sales"] + cash_ins - cash_drops

    cashier_name = _resolve_user_name(shift.cashier)

    movements = []
    if shift.cash_movements_json:
        try:
            movements = json.loads(shift.cash_movements_json)
        except Exception:
            movements = []

    return {
        "has_active_shift": True,
        "shift": {
            "id": shift.id,
            "recon_code": shift.recon_code,
            "shift_name": shift.shift,
            "cashier_id": shift.cashier_id,
            "cashier_name": cashier_name,
            "opening_float": float(shift.opening_float or 0),
            "cash_drops_total": cash_drops,
            "cash_ins_total": cash_ins,
            "cash_movements": movements,
            "opened_at": shift.created_at.isoformat() if shift.created_at else None,
            "notes": shift.notes,
            "status": shift.status,
            "sales_summary": {
                **sales_metrics,
                "expected_drawer_cash": expected_drawer_cash
            }
        }
    }


@router.post("/open")
def open_register_shift(
    payload: OpenShiftIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Opens a new cash register shift with an opening float."""
    existing = scope_query(db.query(CashReconciliation), CashReconciliation, request).filter(
        CashReconciliation.status.in_(["Open", "Pending Count"])
    ).first()

    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Register shift #{existing.recon_code} is already open. Please close it before opening a new shift."
        )

    count_today = db.query(CashReconciliation).count() + 1
    recon_code = f"SHIFT-{datetime.utcnow().strftime('%Y%m%d')}-{count_today:03d}"

    new_shift = CashReconciliation(
        recon_code=recon_code,
        recon_date=datetime.utcnow(),
        shift=payload.shift_name or "Main Register",
        cashier_id=current_user.id if hasattr(current_user, "id") else None,
        opening_float=float(payload.opening_float or 0),
        system_cash_total=0.0,
        counted_cash_total=0.0,
        closing_float=0.0,
        cash_drops_total=0.0,
        cash_ins_total=0.0,
        cash_movements_json="[]",
        cash_transactions_count=0,
        difference=0.0,
        status="Open",
        notes=payload.notes,
        created_at=datetime.utcnow()
    )
    stamp_tenant(new_shift, request)
    db.add(new_shift)
    db.commit()
    db.refresh(new_shift)

    return {
        "ok": True,
        "message": f"Register shift #{recon_code} opened successfully with Float LKR {payload.opening_float:,.2f}.",
        "shift_id": new_shift.id,
        "recon_code": recon_code
    }


@router.post("/cash-movement")
def record_shift_cash_movement(
    payload: CashMovementIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """
    Records a midday cash drop (skimming excess cash to the safe) or cash addition (petty cash / change float).
    """
    shift = scope_query(db.query(CashReconciliation), CashReconciliation, request).filter(
        CashReconciliation.status.in_(["Open", "Pending Count"])
    ).order_by(desc(CashReconciliation.id)).first()

    if not shift:
        raise HTTPException(status_code=404, detail="No active open shift found to record cash movement.")

    m_type = payload.movement_type.strip().lower()
    if m_type not in ["drop", "in", "cash_drop", "cash_in"]:
        raise HTTPException(status_code=400, detail="Invalid movement_type. Must be 'drop' or 'in'.")

    is_drop = m_type in ["drop", "cash_drop"]
    amount = float(payload.amount)

    # Parse existing movements
    movements = []
    if shift.cash_movements_json:
        try:
            movements = json.loads(shift.cash_movements_json)
        except Exception:
            movements = []

    movement_entry = {
        "id": f"MOV-{len(movements) + 1:03d}",
        "type": "drop" if is_drop else "in",
        "type_label": "Cash Drop to Safe" if is_drop else "Cash Added to Drawer",
        "amount": amount,
        "reason": payload.reason,
        "performed_by": current_user.username if hasattr(current_user, "username") else "Cashier",
        "timestamp": datetime.utcnow().isoformat()
    }
    movements.append(movement_entry)
    shift.cash_movements_json = json.dumps(movements)

    if is_drop:
        shift.cash_drops_total = float(shift.cash_drops_total or 0.0) + amount
    else:
        shift.cash_ins_total = float(shift.cash_ins_total or 0.0) + amount

    db.commit()

    return {
        "ok": True,
        "message": f"Recorded {'Cash Drop of LKR ' + f'{amount:,.2f}' if is_drop else 'Cash In of LKR ' + f'{amount:,.2f}'} successfully.",
        "cash_drops_total": float(shift.cash_drops_total or 0.0),
        "cash_ins_total": float(shift.cash_ins_total or 0.0),
        "movement": movement_entry
    }


@router.get("/x-report")
def get_interim_x_report(
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """
    Generates an interim X-Reading (snapshot of sales and cash totals without closing the shift).
    """
    shift = scope_query(db.query(CashReconciliation), CashReconciliation, request).filter(
        CashReconciliation.status.in_(["Open", "Pending Count"])
    ).order_by(desc(CashReconciliation.id)).first()

    if not shift:
        raise HTTPException(status_code=404, detail="No active open shift found for X-Report.")

    sales_metrics = calculate_active_shift_sales(db, shift.cashier_id, shift.created_at, request)
    cash_drops = float(shift.cash_drops_total or 0.0)
    cash_ins = float(shift.cash_ins_total or 0.0)
    expected_drawer_cash = float(shift.opening_float or 0) + sales_metrics["cash_sales"] + cash_ins - cash_drops

    cashier_name = _resolve_user_name(shift.cashier)

    return {
        "report_type": "X_READING",
        "report_title": "Interim Shift X-Report",
        "recon_code": shift.recon_code,
        "shift_name": shift.shift,
        "cashier_name": cashier_name,
        "opened_at": shift.created_at.isoformat() if shift.created_at else None,
        "reading_time": datetime.utcnow().isoformat(),
        "opening_float": float(shift.opening_float or 0),
        "cash_drops_total": cash_drops,
        "cash_ins_total": cash_ins,
        "expected_drawer_cash": expected_drawer_cash,
        "sales_summary": sales_metrics
    }


@router.post("/close")
@router.post("/z-report")
def close_register_shift(
    payload: CloseShiftIn,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """
    Closes the current register shift, calculates overage/shortage discrepancy,
    produces a finalized End-of-Day Z-Report, and automatically dispatches summary via WhatsApp to store owner.
    """
    shift = scope_query(db.query(CashReconciliation), CashReconciliation, request).filter(
        CashReconciliation.status.in_(["Open", "Pending Count"])
    ).order_by(desc(CashReconciliation.id)).first()

    if not shift:
        raise HTTPException(status_code=404, detail="No active open shift found to close.")

    sales_metrics = calculate_active_shift_sales(db, shift.cashier_id, shift.created_at, request)
    cash_drops = float(shift.cash_drops_total or 0.0)
    cash_ins = float(shift.cash_ins_total or 0.0)
    
    system_cash = sales_metrics["cash_sales"]
    expected_total = float(shift.opening_float or 0) + system_cash + cash_ins - cash_drops
    counted_total = float(payload.counted_cash_total or 0)
    difference = counted_total - expected_total

    # Determine status
    if abs(difference) < 1.0:
        status_label = "Balanced"
    elif difference > 0:
        status_label = f"Overage (+LKR {difference:,.2f})"
    else:
        status_label = f"Shortage (-LKR {abs(difference):,.2f})"

    denom_str = json.dumps(payload.denominations) if payload.denominations else None

    shift.system_cash_total = system_cash
    shift.counted_cash_total = counted_total
    shift.closing_float = float(payload.closing_float or 0)
    shift.cash_transactions_count = sales_metrics["cash_transactions_count"]
    shift.denomination_json = denom_str
    shift.difference = difference
    shift.status = "Closed"
    shift.verified_by_user_id = current_user.id if hasattr(current_user, "id") else None
    shift.verified_at = datetime.utcnow()
    shift.updated_at = datetime.utcnow()
    if payload.notes:
        shift.notes = f"{shift.notes or ''} | Close notes: {payload.notes}".strip(" |")

    # Format Automated Executive WhatsApp EOD Z-Report
    cashier_name = _resolve_user_name(shift.cashier)
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

    # Fetch store settings
    store_setting = db.query(AppSetting).filter(AppSetting.key == "store_name").first()
    owner_phone_setting = db.query(AppSetting).filter(
        AppSetting.key.in_(["store_owner_phone", "business_phone", "admin_phone", "contact_phone"])
    ).first()

    store_title = store_setting.value if store_setting and store_setting.value else "I-Store Retail"
    owner_phone = owner_phone_setting.value if owner_phone_setting and owner_phone_setting.value else "0764158980"

    diff_str = "✓ Perfectly Balanced" if abs(difference) < 1.0 else f"{'+' if difference > 0 else '-'}LKR {abs(difference):,.2f} ({status_label})"

    z_report_msg = (
        f"📊 *[{store_title}] — End-of-Day Z-Report*\n"
        f"Shift: *#{shift.recon_code}* ({shift.shift})\n"
        f"Cashier: *{cashier_name}*\n"
        f"Closed At: *{now_str}*\n\n"
        f"💵 *Cash Drawer Summary:*\n"
        f"• Opening Float: LKR {float(shift.opening_float or 0):,.2f}\n"
        f"• Cash Sales: +LKR {system_cash:,.2f}\n"
        f"• Midday Cash In: +LKR {cash_ins:,.2f}\n"
        f"• Midday Cash Drops: -LKR {cash_drops:,.2f}\n"
        f"• Expected Drawer Cash: LKR {expected_total:,.2f}\n"
        f"• Physical Counted Cash: *LKR {counted_total:,.2f}*\n"
        f"• Drawer Variance: *{diff_str}*\n\n"
        f"💳 *Payment Breakdown:*\n"
        f"• Card Sales: LKR {sales_metrics['card_sales']:,.2f}\n"
        f"• Bank Transfers: LKR {sales_metrics['bank_sales']:,.2f}\n"
        f"• Store Credits: LKR {sales_metrics['store_credit_sales']:,.2f}\n\n"
        f"📈 *Total Shift Turnover:* *LKR {sales_metrics['net_sales']:,.2f}*\n"
        f"Total Invoices: *{sales_metrics['total_transactions']}* | Voids: *{sales_metrics['voided_transactions_count']}*\n"
    )

    if bool(payload.send_whatsapp_report):
        try:
            background_tasks.add_task(
                log_and_send_whatsapp,
                event_type="EOD_Z_REPORT",
                phone=owner_phone,
                variables={"z_report": z_report_msg, "message": z_report_msg}
            )
            shift.z_report_dispatched = True
        except Exception as we:
            logger.warning(f"Failed to queue EOD Z-Report WhatsApp message: {we}")

    db.commit()

    return {
        "ok": True,
        "message": f"Register shift #{shift.recon_code} closed. Status: {status_label}",
        "recon_code": shift.recon_code,
        "opening_float": float(shift.opening_float or 0),
        "cash_drops_total": cash_drops,
        "cash_ins_total": cash_ins,
        "system_cash": system_cash,
        "expected_total": expected_total,
        "counted_total": counted_total,
        "difference": difference,
        "status": status_label,
        "z_report_text": z_report_msg,
        "z_report_dispatched": shift.z_report_dispatched,
        "sales_summary": sales_metrics
    }


@router.get("/history")
def get_shift_history(
    request: Request,
    limit: int = Query(default=30),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Returns past shift reconciliation records."""
    shifts = scope_query(db.query(CashReconciliation), CashReconciliation, request).order_by(desc(CashReconciliation.id)).limit(limit).all()
    results = []
    for s in shifts:
        cashier_name = _resolve_user_name(s.cashier)
        results.append({
            "id": s.id,
            "recon_code": s.recon_code,
            "shift_name": s.shift,
            "cashier_name": cashier_name,
            "opening_float": float(s.opening_float or 0),
            "cash_drops_total": float(s.cash_drops_total or 0),
            "cash_ins_total": float(s.cash_ins_total or 0),
            "system_cash_total": float(s.system_cash_total or 0),
            "counted_cash_total": float(s.counted_cash_total or 0),
            "difference": float(s.difference or 0),
            "status": s.status,
            "z_report_dispatched": bool(s.z_report_dispatched),
            "opened_at": s.created_at.isoformat() if s.created_at else None,
            "closed_at": s.updated_at.isoformat() if s.updated_at else None,
            "notes": s.notes
        })
    return results

