"""Staff inbox for requests from verified portal customers."""
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from app.auth import get_current_user
from app.database import get_db
from app.models import PortalServiceRequest
from app.routers.cloud_portal_router import request_json, require_request_schema

router = APIRouter(prefix="/portal-requests", tags=["portal requests"])


def staff(user=Depends(get_current_user)):
    if str(user.role or "").strip().lower() not in {"owner", "admin", "manager", "super_admin"}:
        raise HTTPException(403, "Manager access required")
    if not user.organization_id or not user.branch_id:
        raise HTTPException(403, "Explicit organization and branch required")
    return user


def query(db, user):
    require_request_schema(db)
    return db.query(PortalServiceRequest).filter(PortalServiceRequest.organization_id == user.organization_id, PortalServiceRequest.branch_id == user.branch_id)


@router.get("")
def inbox(db: Session = Depends(get_db), user=Depends(staff)):
    return {"requests": [{**request_json(row), "customerId": row.customer_id, "receiptSaleId": row.receipt_sale_id, "relatedId": row.related_id} for row in query(db, user).order_by(PortalServiceRequest.created_at.desc()).limit(100)]}


class ReviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["confirmed", "completed", "declined", "cancelled"]
    response: str = Field(min_length=5, max_length=2000)


@router.patch("/{identifier}")
def review(identifier: str, payload: ReviewIn, db: Session = Depends(get_db), user=Depends(staff)):
    row = query(db, user).filter(PortalServiceRequest.id == identifier).first()
    if not row:
        raise HTTPException(404, "Request not found")
    if row.status in {"completed", "declined", "cancelled"}:
        raise HTTPException(409, "This request is closed")
    if payload.status == "confirmed" and row.kind != "appointment":
        raise HTTPException(422, "Only appointments can be confirmed")
    row.status, row.staff_response, row.reviewed_by = payload.status, payload.response.strip(), user.id
    db.commit()
    return request_json(row)
