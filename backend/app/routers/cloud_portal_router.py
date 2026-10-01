"""Private Worker-to-ERP API. Never accepts customer or tenant IDs from a body."""
import hashlib
import hmac
import json
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session
from sqlalchemy import inspect

from app.database import get_db
from app.models import AppSetting, Branch, Customer, Organization, PortalServiceRequest, RepairTicket, Sale, WarrantyRecord
from app.services.cloudflare_portal_sync import normalize_phone
from app.services.portal_reconciliation import _snapshot
from app.utils.time import utcnow

router = APIRouter(prefix="/portal", tags=["private customer portal"])


def _digest(value, key):
    return hmac.new(key.encode(), value.encode(), hashlib.sha256).hexdigest()


def _equal(left, right):
    return hmac.compare_digest(left.encode(), right.encode())


def _legacy_sale_id(ref):
    value = ref[4:] if ref.startswith("INV-") else ""
    return int(value) if value.isdigit() and len(value) <= 10 and 0 < int(value) <= 2147483647 else None


@dataclass
class Context:
    organization_id: int
    branch_id: int
    store_ref: str
    customer: Customer
    receipt: Sale


def portal_context(request: Request, db: Session = Depends(get_db)):
    token = os.getenv("POS_PORTAL_API_TOKEN", "")
    if len(token) < 32 or os.getenv("CLOUDFLARE_PORTAL_ENABLED", "false").lower() != "true":
        raise HTTPException(503, "Private portal API is not configured")
    if not _equal(request.headers.get("authorization", ""), f"Bearer {token}"):
        raise HTTPException(401, "Worker authentication required")
    org = os.getenv("CLOUDFLARE_PORTAL_ORGANIZATION_ID", "")
    branch = os.getenv("CLOUDFLARE_PORTAL_BRANCH_ID", "")
    store = os.getenv("CLOUDFLARE_PORTAL_STORE_REF", "")
    key = os.getenv("CLOUDFLARE_RECEIPT_IDENTITY_KEY", "")
    if not org.isdigit() or not branch.isdigit() or int(org) < 1 or int(branch) < 1 or not store or len(key) < 32:
        raise HTTPException(503, "Explicit portal mapping and identity key required")
    organization = db.query(Organization).filter(Organization.id == int(org), Organization.is_active.is_(True)).first()
    mapped_branch = db.query(Branch).filter(Branch.id == int(branch), Branch.organization_id == int(org), Branch.is_active.is_(True)).first()
    if not organization or not mapped_branch:
        raise HTTPException(503, "Portal mapping is unavailable")
    ref = request.headers.get("x-portal-invoice-ref", "")
    if request.headers.get("x-portal-store-ref") != store or not ref or len(ref) > 100:
        raise HTTPException(404, "Receipt not found")
    receipt = db.query(Sale).filter(Sale.organization_id == int(org), Sale.branch_id == int(branch), Sale.is_deleted.is_(False), Sale.is_return.is_(False), Sale.invoice_status != "draft", Sale.invoice_no == ref).first()
    if not receipt and _legacy_sale_id(ref):
        candidate = db.query(Sale).filter(Sale.id == _legacy_sale_id(ref), Sale.organization_id == int(org), Sale.branch_id == int(branch), Sale.is_deleted.is_(False), Sale.is_return.is_(False), Sale.invoice_status != "draft").first()
        if candidate and not candidate.invoice_no:
            receipt = candidate
    customer = db.query(Customer).filter(Customer.id == receipt.customer_id, Customer.organization_id == int(org), Customer.is_deleted.is_(False)).first() if receipt else None
    if not customer:
        raise HTTPException(404, "Receipt not found")
    try:
        phone = normalize_phone(customer.whatsapp_number or customer.phone)
    except ValueError:
        raise HTTPException(404, "Receipt not found")
    if not _equal(request.headers.get("x-portal-customer-ref", ""), _digest(f"{store}:{phone.lstrip('+')}", key)) or not _equal(request.headers.get("x-portal-receipt-id", ""), _digest(f"{store}:{ref}", key)):
        raise HTTPException(404, "Receipt not found")
    checkpoint = db.query(AppSetting).filter(AppSetting.key == f"portal_bill:{store}:{org}:{receipt.id}").first()
    try:
        state = json.loads(checkpoint.value) if checkpoint else {}
    except (ValueError, TypeError):
        state = {}
    identity = hashlib.sha256(f"{customer.id}:{phone}".encode()).hexdigest()
    if state.get("revoked") or state.get("identity") != identity or state.get("invoice_ref") != ref:
        raise HTTPException(404, "Receipt not found")
    return Context(int(org), int(branch), store, customer, receipt)


def scoped(db, model, ctx):
    return db.query(model).filter(model.organization_id == ctx.organization_id, model.branch_id == ctx.branch_id, model.customer_id == ctx.customer.id, model.is_deleted.is_(False))


def bill(db, row, ctx):
    return _snapshot(db, row, ctx.customer, ctx.store_ref)["bill"]


def sale_by_ref(db, ref, ctx):
    if not ref or len(ref) > 100:
        raise HTTPException(404, "Bill not found")
    query = scoped(db, Sale, ctx).filter(Sale.is_return.is_(False), Sale.invoice_status != "draft")
    row = query.filter(Sale.invoice_no == ref).first()
    if not row and _legacy_sale_id(ref):
        candidate = query.filter(Sale.id == _legacy_sale_id(ref)).first()
        if candidate and not candidate.invoice_no:
            row = candidate
    if row:
        state = db.query(AppSetting).filter(AppSetting.key == f"portal_bill:{ctx.store_ref}:{ctx.organization_id}:{row.id}").first()
        try:
            checkpoint = json.loads(state.value) if state else {}
        except (ValueError, TypeError):
            checkpoint = {}
        phone = normalize_phone(ctx.customer.whatsapp_number or ctx.customer.phone)
        if not checkpoint.get("revoked") and checkpoint.get("identity") == hashlib.sha256(f"{ctx.customer.id}:{phone}".encode()).hexdigest() and checkpoint.get("invoice_ref") == ref:
            return row
    raise HTTPException(404, "Bill not found")


@router.get("/bills")
def bills(db: Session = Depends(get_db), ctx: Context = Depends(portal_context)):
    result = []
    for row in scoped(db, Sale, ctx).filter(Sale.is_return.is_(False), Sale.invoice_status != "draft").order_by(Sale.id.desc()).limit(50):
        try:
            result.append(bill(db, sale_by_ref(db, row.invoice_no or f"INV-{row.id:05d}", ctx), ctx))
        except HTTPException:
            continue
    return {"bills": result}


@router.get("/bills/{invoice_ref}")
def bill_detail(invoice_ref: str, db: Session = Depends(get_db), ctx: Context = Depends(portal_context)):
    return bill(db, sale_by_ref(db, invoice_ref, ctx), ctx)


@router.get("/bills/{invoice_ref}/download")
def bill_download(invoice_ref: str, db: Session = Depends(get_db), ctx: Context = Depends(portal_context)):
    row = sale_by_ref(db, invoice_ref, ctx)
    return JSONResponse(bill(db, row, ctx), headers={"Content-Disposition": f'attachment; filename="invoice-{row.id}.json"', "Cache-Control": "no-store"})


def warranty_json(row):
    return {"id": row.id, "code": row.warranty_code, "product": row.product_or_service_name, "serial": row.serial_number, "startDate": row.start_date, "endDate": row.end_date, "status": row.status, "coverage": row.coverage_type}


def owned(db, model, identifier, ctx):
    if not 0 < identifier <= 2147483647:
        raise HTTPException(404, "Record not found")
    row = scoped(db, model, ctx).filter(model.id == identifier).first()
    if not row:
        raise HTTPException(404, "Record not found")
    return row


@router.get("/warranties")
def warranties(db: Session = Depends(get_db), ctx: Context = Depends(portal_context)):
    return {"warranties": [warranty_json(row) for row in scoped(db, WarrantyRecord, ctx).order_by(WarrantyRecord.id.desc()).limit(100)]}


@router.get("/warranties/{identifier}")
def warranty(identifier: int, db: Session = Depends(get_db), ctx: Context = Depends(portal_context)):
    return warranty_json(owned(db, WarrantyRecord, identifier, ctx))


def repair_json(row):
    return {"id": row.id, "ticketNumber": row.ticket_no, "deviceModel": row.device_model, "issue": row.issue, "status": row.status, "estimatedCost": row.estimated_cost, "createdAt": row.created_at, "estimatedCompletion": row.estimated_completion}


@router.get("/repairs")
def repairs(db: Session = Depends(get_db), ctx: Context = Depends(portal_context)):
    return {"repairs": [repair_json(row) for row in scoped(db, RepairTicket, ctx).order_by(RepairTicket.id.desc()).limit(100)]}


@router.get("/repairs/{identifier}")
def repair(identifier: int, db: Session = Depends(get_db), ctx: Context = Depends(portal_context)):
    return repair_json(owned(db, RepairTicket, identifier, ctx))


class RequestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(min_length=5, max_length=2000)

    @field_validator("message")
    @classmethod
    def clean_message(cls, value):
        value = value.strip()
        if len(value) < 5:
            raise ValueError("Please describe your request")
        return value


class AppointmentIn(RequestIn):
    requested_at: datetime

    @field_validator("requested_at")
    @classmethod
    def future_time(cls, value):
        if value.tzinfo is None:
            raise ValueError("Include the appointment time zone")
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
        if not utcnow() < value <= utcnow() + timedelta(days=180):
            raise ValueError("Choose a future date within 180 days")
        return value


class ClaimIn(RequestIn):
    warranty_id: int = Field(gt=0, le=2147483647)


def request_json(row):
    return {"id": row.id, "kind": row.kind, "message": row.message, "status": row.status, "requestedAt": row.requested_at.replace(tzinfo=timezone.utc) if row.requested_at else None, "createdAt": row.created_at.replace(tzinfo=timezone.utc), "staffResponse": row.staff_response}


def create_request(db, ctx, kind, message, requested_at=None, related_id=None):
    # These are requests for staff review, not confirmed appointments or intake.
    require_request_schema(db)
    pending = db.query(PortalServiceRequest).filter(PortalServiceRequest.organization_id == ctx.organization_id, PortalServiceRequest.customer_id == ctx.customer.id, PortalServiceRequest.status == "pending").count()
    if pending >= 20:
        raise HTTPException(429, "Too many pending requests; contact the shop")
    if related_id:
        duplicate = db.query(PortalServiceRequest).filter(PortalServiceRequest.organization_id == ctx.organization_id, PortalServiceRequest.branch_id == ctx.branch_id, PortalServiceRequest.customer_id == ctx.customer.id, PortalServiceRequest.kind == kind, PortalServiceRequest.related_id == related_id, PortalServiceRequest.status == "pending").first()
        if duplicate:
            return request_json(duplicate)
    row = PortalServiceRequest(id=str(uuid.uuid4()), organization_id=ctx.organization_id, branch_id=ctx.branch_id, customer_id=ctx.customer.id, receipt_sale_id=ctx.receipt.id, kind=kind, message=message, requested_at=requested_at, related_id=related_id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return request_json(row)


@router.post("/repairs", status_code=202)
def request_repair(payload: RequestIn, db: Session = Depends(get_db), ctx: Context = Depends(portal_context)):
    return create_request(db, ctx, "repair", payload.message)


@router.post("/warranty-claims", status_code=202)
def request_claim(payload: ClaimIn, db: Session = Depends(get_db), ctx: Context = Depends(portal_context)):
    owned(db, WarrantyRecord, payload.warranty_id, ctx)
    return create_request(db, ctx, "warranty_claim", payload.message, related_id=payload.warranty_id)


@router.post("/feedback", status_code=202)
def feedback(payload: RequestIn, db: Session = Depends(get_db), ctx: Context = Depends(portal_context)):
    return create_request(db, ctx, "feedback", payload.message)


@router.post("/bills/{invoice_ref}/resend", status_code=202)
def resend(invoice_ref: str, db: Session = Depends(get_db), ctx: Context = Depends(portal_context)):
    sale = sale_by_ref(db, invoice_ref, ctx)
    if not ctx.customer.whatsapp_opt_in:
        raise HTTPException(409, "WhatsApp consent is required")
    return create_request(db, ctx, "bill_resend", f"Please resend {invoice_ref} to my registered WhatsApp number.", related_id=sale.id)


@router.get("/appointments")
def appointments(db: Session = Depends(get_db), ctx: Context = Depends(portal_context)):
    require_request_schema(db)
    rows = db.query(PortalServiceRequest).filter(PortalServiceRequest.organization_id == ctx.organization_id, PortalServiceRequest.branch_id == ctx.branch_id, PortalServiceRequest.customer_id == ctx.customer.id, PortalServiceRequest.kind == "appointment").order_by(PortalServiceRequest.created_at.desc()).limit(100)
    return {"appointments": [request_json(row) for row in rows]}


@router.get("/requests")
def requests(db: Session = Depends(get_db), ctx: Context = Depends(portal_context)):
    require_request_schema(db)
    rows = db.query(PortalServiceRequest).filter(PortalServiceRequest.organization_id == ctx.organization_id, PortalServiceRequest.branch_id == ctx.branch_id, PortalServiceRequest.customer_id == ctx.customer.id).order_by(PortalServiceRequest.created_at.desc()).limit(100)
    return {"requests": [request_json(row) for row in rows]}


@router.post("/appointments", status_code=202)
def appointment(payload: AppointmentIn, db: Session = Depends(get_db), ctx: Context = Depends(portal_context)):
    return create_request(db, ctx, "appointment", payload.message, payload.requested_at)


def own_appointment(db, identifier, ctx):
    require_request_schema(db)
    row = db.query(PortalServiceRequest).filter(PortalServiceRequest.id == identifier, PortalServiceRequest.organization_id == ctx.organization_id, PortalServiceRequest.branch_id == ctx.branch_id, PortalServiceRequest.customer_id == ctx.customer.id, PortalServiceRequest.kind == "appointment").first()
    if not row:
        raise HTTPException(404, "Appointment not found")
    return row


def require_request_schema(db):
    if not inspect(db.bind).has_table("portal_service_requests"):
        raise HTTPException(503, "Portal request migration is required")


@router.patch("/appointments/{identifier}")
def update_appointment(identifier: str, payload: AppointmentIn, db: Session = Depends(get_db), ctx: Context = Depends(portal_context)):
    row = own_appointment(db, identifier, ctx)
    if row.status not in {"pending", "confirmed"}:
        raise HTTPException(409, "This appointment cannot be changed")
    row.message, row.requested_at, row.status, row.staff_response = payload.message, payload.requested_at, "pending", None
    db.commit()
    return request_json(row)


@router.delete("/appointments/{identifier}")
def cancel_appointment(identifier: str, db: Session = Depends(get_db), ctx: Context = Depends(portal_context)):
    row = own_appointment(db, identifier, ctx)
    if row.status not in {"pending", "confirmed", "cancelled"}:
        raise HTTPException(409, "This appointment cannot be cancelled")
    row.status = "cancelled"
    db.commit()
    return request_json(row)
