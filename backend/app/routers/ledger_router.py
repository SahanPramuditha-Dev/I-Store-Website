from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.constants import is_repair_cancelled_status, is_repair_delivered_status
from app.database import get_db
from app.auth import get_current_user, require_permission
from app.models import Customer, Sale, RepairTicket

router = APIRouter(prefix="/ledger", tags=["ledger"])

@router.get('/customer/{customer_id}', dependencies=[Depends(require_permission("financial_audit.view"))])
def get_customer_ledger(customer_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    
    sales = db.query(Sale).filter(Sale.customer_id == customer_id, Sale.is_voided == False).all()
    repairs = db.query(RepairTicket).filter(RepairTicket.customer_id == customer_id).all()
    
    total_spent = sum(float(s.total or 0) for s in sales) + sum(
        float(r.estimated_cost or 0) for r in repairs if is_repair_delivered_status(r.status)
    )
    pending_payments = sum(
        max(0.0, float(r.estimated_cost or 0) - float(r.advance_payment or 0))
        for r in repairs
        if not is_repair_delivered_status(r.status) and not is_repair_cancelled_status(r.status)
    )
    
    return {
        "customer": {
            "id": customer.id,
            "name": customer.name,
            "phone": customer.phone
        },
        "stats": {
            "total_spent": total_spent,
            "pending_payments": pending_payments,
            "repair_count": len(repairs),
            "purchase_count": len(sales)
        },
        "history": sorted(
            [{"type": "Sale", "id": s.id, "amount": s.total, "date": s.created_at, "status": "Paid"} for s in sales] +
            [{"type": "Repair", "id": r.id, "amount": r.estimated_cost, "date": r.created_at, "status": r.status} for r in repairs],
            key=lambda x: x["date"], reverse=True
        )
    }
