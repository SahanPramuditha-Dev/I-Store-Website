"""
shifts_router.py
================
Cashier Shift Management, Register Float Balancing, and Shift X/Z Reconciliation.
"""

from datetime import datetime
import json
import logging
from typing import Optional, Dict, Any, List
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, and_

from app.database import get_db
from app.auth import get_current_user, require_permission
from app.models import CashReconciliation, Sale, User
from app.utils.time import utcnow, format_iso_utc
from app.utils.whatsapp_helper import resolve_store_variables, normalize_sri_lankan_phone, whatsapp_provider

router = APIRouter(prefix="/shifts", tags=["shifts"])
logger = logging.getLogger("istore.shifts")


class OpenShiftIn(BaseModel):
    opening_float: float = 0.0
    shift_name: Optional[str] = "Main Register"
    notes: Optional[str] = None


class CloseShiftIn(BaseModel):
    counted_cash_total: float
    closing_float: Optional[float] = 0.0
    denominations: Optional[Dict[str, int]] = None
    notes: Optional[str] = None


def calculate_active_shift_sales(db: Session, cashier_id: Optional[int], start_time: datetime) -> Dict[str, Any]:
    """Calculates all sales transactions completed since the shift was opened."""
    query = db.query(Sale).filter(
        Sale.created_at >= start_time,
        Sale.is_voided == False  # noqa: E712
    )
    if cashier_id:
        query = query.filter(Sale.created_by == cashier_id)

    sales = query.all()

    cash_sales = 0.0
    card_sales = 0.0
    bank_sales = 0.0
    credit_sales = 0.0
    cash_tx_count = 0

    for s in sales:
        method = str(s.payment_method or "Cash").lower()
        tot = float(s.total or s.grand_total or 0)
        if "cash" in method:
            cash_sales += tot
            cash_tx_count += 1
        elif "card" in method:
            card_sales += tot
        elif "bank" in method or "transfer" in method:
            bank_sales += tot
        elif "credit" in method:
            credit_sales += tot
        else:
            cash_sales += tot
            cash_tx_count += 1

    return {
        "cash_sales": cash_sales,
        "card_sales": card_sales,
        "bank_sales": bank_sales,
        "credit_sales": credit_sales,
        "total_sales": sum(float(s.total or 0) for s in sales),
        "total_transactions": len(sales),
        "cash_transactions_count": cash_tx_count
    }


@router.get("/current")
def get_current_shift(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Returns the currently active open shift for the register."""
    # Find most recent shift with status='Open' or 'Pending Count'
    shift = db.query(CashReconciliation).filter(
        CashReconciliation.status.in_(["Open", "Pending Count"])
    ).order_by(desc(CashReconciliation.id)).first()

    if not shift:
        return {"has_active_shift": False, "shift": None}

    sales_metrics = calculate_active_shift_sales(db, shift.cashier_id, shift.created_at)
    expected_drawer_cash = float(shift.opening_float or 0) + sales_metrics["cash_sales"]

    cashier_name = shift.cashier.name if shift.cashier else (shift.cashier.username if shift.cashier else "Cashier")

    return {
        "has_active_shift": True,
        "shift": {
            "id": shift.id,
            "recon_code": shift.recon_code,
            "shift_name": shift.shift,
            "cashier_id": shift.cashier_id,
            "cashier_name": cashier_name,
            "opening_float": float(shift.opening_float or 0),
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
def open_register_shift(payload: OpenShiftIn, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Opens a new cash register shift with an opening float."""
    # Check if there is already an open shift
    existing = db.query(CashReconciliation).filter(
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
        cash_transactions_count=0,
        difference=0.0,
        status="Open",
        notes=payload.notes,
        created_at=datetime.utcnow()
    )
    db.add(new_shift)
    db.commit()
    db.refresh(new_shift)

    return {
        "ok": True,
        "message": f"Register shift #{recon_code} opened successfully with Float LKR {payload.opening_float:,.2f}.",
        "shift_id": new_shift.id,
        "recon_code": recon_code
    }


@router.post("/close")
async def close_register_shift(payload: CloseShiftIn, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Closes the current register shift, calculates overage/shortage discrepancy, and produces a Shift X-Report."""
    shift = db.query(CashReconciliation).filter(
        CashReconciliation.status.in_(["Open", "Pending Count"])
    ).order_by(desc(CashReconciliation.id)).first()

    if not shift:
        raise HTTPException(status_code=404, detail="No active open shift found to close.")

    sales_metrics = calculate_active_shift_sales(db, shift.cashier_id, shift.created_at)
    system_cash = sales_metrics["cash_sales"]
    expected_total = float(shift.opening_float or 0) + system_cash
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

    db.commit()

    return {
        "ok": True,
        "message": f"Register shift #{shift.recon_code} closed. Status: {status_label}",
        "recon_code": shift.recon_code,
        "opening_float": float(shift.opening_float or 0),
        "system_cash": system_cash,
        "expected_total": expected_total,
        "counted_total": counted_total,
        "difference": difference,
        "status": status_label,
        "sales_summary": sales_metrics
    }


@router.get("/history")
def get_shift_history(limit: int = Query(default=30), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Returns past shift reconciliation records."""
    shifts = db.query(CashReconciliation).order_by(desc(CashReconciliation.id)).limit(limit).all()
    results = []
    for s in shifts:
        cashier_name = s.cashier.name if s.cashier else (s.cashier.username if s.cashier else "Cashier")
        results.append({
            "id": s.id,
            "recon_code": s.recon_code,
            "shift_name": s.shift,
            "cashier_name": cashier_name,
            "opening_float": float(s.opening_float or 0),
            "system_cash_total": float(s.system_cash_total or 0),
            "counted_cash_total": float(s.counted_cash_total or 0),
            "difference": float(s.difference or 0),
            "status": s.status,
            "opened_at": s.created_at.isoformat() if s.created_at else None,
            "closed_at": s.updated_at.isoformat() if s.updated_at else None,
            "notes": s.notes
        })
    return results
