import json
import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_permission
from app.database import get_db
from app.models import (
    Customer,
    InventoryItem,
    RepairTicket,
    Sale,
    WarrantyClaim,
    WarrantyCondition,
    WarrantyRecord,
    WarrantyRule,
)
from app.schemas import (
    WarrantyClaimIn,
    WarrantyClaimUpdateIn,
    WarrantyConditionIn,
    WarrantyRecordIn,
    WarrantyRuleIn,
)
from app.services.warranty_service import (
    CLAIM_STATUS_APPROVED,
    CLAIM_STATUS_PENDING,
    CLAIM_STATUS_REJECTED,
    CLAIM_STATUS_REPLACED,
    WARRANTY_STATUS_ACTIVE,
    WARRANTY_STATUS_CLAIMED,
    WARRANTY_STATUS_EXPIRED,
    WARRANTY_STATUS_REJECTED,
    WARRANTY_STATUS_REPLACED,
    CLAIM_STATUS_CLOSED,
    CLAIM_STATUS_PENDING_INSPECTION,
    CLAIM_STATUS_RESOLVED,
    CLAIM_STATUS_REPAIRING,
    apply_claim_status_to_warranty,
    approve_claim,
    claim_status_label,
    create_claim,
    create_repair_from_claim,
    create_replacement_from_claim,
    ensure_warranty_defaults,
    inspect_claim,
    normalize_claim_status,
    normalize_warranty_status,
    reject_claim,
    refresh_warranty_statuses,
    resolve_claim,
    stamp_claim_code,
    warranty_status_label,
)
from app.services.numbering_service import next_number
from app.services.print_rendering_service import get_store_profile_print_data, render_warranty_certificate_html
from app.utils.time import utcnow

router = APIRouter(prefix="/warranty", tags=["warranty"])


def _role_key(user) -> str:
    return str(getattr(user, "role", "") or "").strip().lower().replace(" ", "_")


def _require_any_role(user, allowed_roles: set[str]) -> None:
    role = _role_key(user)
    if not any(token in role for token in allowed_roles):
        raise HTTPException(status_code=403, detail="Insufficient permission")


def _parse_iso_date(value: str | None, end_exclusive: bool = False) -> datetime | None:
    if not value:
        return None
    dt = datetime.fromisoformat(value)
    if end_exclusive:
        dt = dt + timedelta(days=1)
    return dt


def _parse_conditions_json(value: str | None) -> list[dict]:
    if not value:
        return []
    try:
        loaded = json.loads(value)
        return loaded if isinstance(loaded, list) else []
    except Exception:
        return []


def _serialize_rule(row: WarrantyRule) -> dict:
    return {
        "id": row.id,
        "rule_name": row.rule_name,
        "rule_type": row.rule_type or row.scope_type,
        "scope_type": row.scope_type,
        "scope_value": row.scope_value,
        "category_id": row.category_id,
        "product_id": row.product_id,
        "variant_id": row.variant_id,
        "serial_id": row.serial_id,
        "repair_service_id": row.repair_service_id,
        "warranty_duration_value": row.warranty_duration_value,
        "warranty_duration_unit": row.warranty_duration_unit,
        "warranty_days": row.warranty_days,
        "coverage_type": row.coverage_type,
        "priority": row.priority,
        "conditions_text": row.conditions_text,
        "exclusion_text": row.exclusion_text,
        "description": row.description,
        "is_active": row.is_active,
        "is_deleted": bool(row.is_deleted),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _sync_rule_legacy_fields(row: WarrantyRule) -> None:
    rule_type = str(row.rule_type or "").strip().lower() or str(row.scope_type or "").strip().lower()
    if rule_type == "category":
        row.scope_type = "product_category"
        row.scope_value = str(row.scope_value or "*").strip() or "*"
    elif rule_type == "product":
        row.scope_type = "product"
        row.scope_value = str(row.product_id or row.scope_value or "*")
    elif rule_type == "repair_service":
        row.scope_type = "repair_service"
        row.scope_value = str(row.repair_service_id or row.scope_value or "*")
    elif rule_type == "serial":
        row.scope_type = "serial"
        row.scope_value = str(row.serial_id or row.scope_value or "*")
    elif rule_type == "variant":
        row.scope_type = "variant"
        row.scope_value = str(row.variant_id or row.scope_value or "*")
    else:
        row.scope_type = "global"
        row.scope_value = str(row.scope_value or "*").strip() or "*"

    row.rule_type = rule_type or "global"
    if int(row.warranty_duration_value or 0) <= 0 and int(row.warranty_days or 0) > 0:
        row.warranty_duration_value = int(row.warranty_days or 0)
        row.warranty_duration_unit = row.warranty_duration_unit or "days"
    if int(row.warranty_duration_value or 0) > 0 and str(row.warranty_duration_unit or "days").lower() == "days":
        row.warranty_days = int(row.warranty_duration_value or 0)


def _serialize_record(row: WarrantyRecord) -> dict:
    invoice_no = f"INV-{row.invoice_id:05d}" if row.invoice_id else None
    repair_no = row.repair_ticket.ticket_no if row.repair_ticket else None
    status_key = normalize_warranty_status(row.status)
    return {
        "id": row.id,
        "warranty_id": row.warranty_code,
        "warranty_number": row.warranty_number or row.warranty_code,
        "invoice_id": row.invoice_id,
        "invoice_no": invoice_no,
        "invoice_item_id": row.invoice_item_id or row.sale_item_id,
        "repair_ticket_id": row.repair_ticket_id,
        "repair_ticket_no": repair_no,
        "sale_item_id": row.sale_item_id,
        "warranty_rule_id": row.warranty_rule_id,
        "product_id": row.product_id or row.item_id,
        "variant_id": row.variant_id,
        "serial_id": row.serial_id,
        "item_id": row.item_id,
        "customer_id": row.customer_id,
        "customer_name": row.customer_name,
        "customer_phone": row.customer_phone,
        "product_or_service_name": row.product_or_service_name,
        "product_category": row.product_category,
        "brand": row.brand,
        "supplier_name": row.supplier_name,
        "device_brand_model": row.device_brand_model,
        "imei_or_serial": row.imei_or_serial,
        "serial_number": row.serial_number,
        "warranty_type": row.warranty_type,
        "start_date": row.start_date.isoformat() if row.start_date else None,
        "end_date": row.end_date.isoformat() if row.end_date else None,
        "status": warranty_status_label(status_key),
        "status_key": status_key,
        "coverage_type": row.coverage_type or "repair",
        "quantity_covered": row.quantity_covered,
        "warranty_days": row.warranty_days,
        "conditions": _parse_conditions_json(row.conditions_json),
        "notes": row.notes,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "claims_count": len(row.claims or []),
        "latest_claim_status": row.claims[-1].claim_status if row.claims else None,
    }


def _serialize_claim(row: WarrantyClaim) -> dict:
    status_key = normalize_claim_status(row.decision_status or row.claim_status)
    return {
        "id": row.id,
        "claim_id": row.claim_code,
        "claim_number": row.claim_number or row.claim_code,
        "warranty_id": row.warranty_id,
        "warranty_code": row.warranty.warranty_code if row.warranty else None,
        "customer_name": row.warranty.customer_name if row.warranty else None,
        "customer_phone": row.warranty.customer_phone if row.warranty else None,
        "product_or_service_name": row.warranty.product_or_service_name if row.warranty else None,
        "warranty_status": warranty_status_label(row.warranty.status) if row.warranty else None,
        "warranty_status_key": normalize_warranty_status(row.warranty.status) if row.warranty else None,
        "customer_id": row.customer_id,
        "claim_date": row.claim_date.isoformat() if row.claim_date else None,
        "issue_description": row.issue_description,
        "customer_complaint": row.customer_complaint,
        "technician_id": row.technician_id,
        "inspection_notes": row.inspection_notes or row.technician_inspection_note,
        "technician_inspection_note": row.technician_inspection_note or row.inspection_notes,
        "claim_status": claim_status_label(status_key),
        "claim_status_key": status_key,
        "decision_status": status_key,
        "rejection_reason": row.rejection_reason,
        "resolution_type": row.resolution_type,
        "replacement_product_id": row.replacement_product_id,
        "replacement_serial_id": row.replacement_serial_id,
        "linked_repair_ticket_id": row.linked_repair_ticket_id,
        "claim_decision": row.claim_decision,
        "replacement_item": row.replacement_item,
        "repair_action": row.repair_action,
        "processed_by": (
            row.processed_by.full_name or row.processed_by.username
            if row.processed_by
            else None
        ),
        "approved_by": (
            row.approved_by.full_name or row.approved_by.username
            if row.approved_by
            else None
        ),
        "approved_at": row.approved_at.isoformat() if row.approved_at else None,
        "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
        "closed_at": row.closed_at.isoformat() if row.closed_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _build_record_query(
    db: Session,
    status: str | None = None,
    warranty_type: str | None = None,
    category: str | None = None,
    brand: str | None = None,
    supplier: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    q: str | None = None,
):
    query = (
        db.query(WarrantyRecord)
        .options(
            joinedload(WarrantyRecord.repair_ticket),
            joinedload(WarrantyRecord.claims),
        )
        .filter(or_(WarrantyRecord.is_deleted == False, WarrantyRecord.is_deleted.is_(None)))  # noqa: E712
    )
    if status and status.lower() != "all":
        status_key = normalize_warranty_status(status)
        query = query.filter(
            or_(
                func.lower(func.trim(WarrantyRecord.status)) == status_key,
                WarrantyRecord.status == status,
            )
        )
    if warranty_type and warranty_type.lower() != "all":
        query = query.filter(func.lower(func.trim(WarrantyRecord.warranty_type)) == str(warranty_type).strip().lower())
    if category and category.lower() != "all":
        query = query.filter(WarrantyRecord.product_category == category)
    if brand and brand.lower() != "all":
        query = query.filter(WarrantyRecord.brand == brand)
    if supplier and supplier.lower() != "all":
        query = query.filter(WarrantyRecord.supplier_name == supplier)
    start = _parse_iso_date(date_from)
    end = _parse_iso_date(date_to, end_exclusive=True)
    if start:
        query = query.filter(WarrantyRecord.start_date >= start)
    if end:
        query = query.filter(WarrantyRecord.start_date < end)
    if q:
        normalized_q = q.strip()
        invoice_id_match = None
        if normalized_q.lower().startswith("inv-"):
            digits = re.sub(r"[^\d]", "", normalized_q)
            if digits:
                invoice_id_match = int(digits)
        like = f"%{q.strip()}%"
        clauses = [
            WarrantyRecord.warranty_code.ilike(like),
            WarrantyRecord.warranty_number.ilike(like),
            WarrantyRecord.customer_name.ilike(like),
            WarrantyRecord.customer_phone.ilike(like),
            WarrantyRecord.imei_or_serial.ilike(like),
            WarrantyRecord.imei.ilike(like),
            WarrantyRecord.serial_number.ilike(like),
            WarrantyRecord.product_or_service_name.ilike(like),
        ]
        if invoice_id_match is not None:
            clauses.append(WarrantyRecord.invoice_id == invoice_id_match)
        query = query.filter(or_(*clauses))
    return query


@router.get("/dashboard", dependencies=[Depends(require_permission("warranty.view"))])
def warranty_dashboard(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ensure_warranty_defaults(db)
    refresh_warranty_statuses(db)
    now = utcnow()
    soon_cutoff = now + timedelta(days=14)

    record_query = _build_record_query(db, date_from=date_from, date_to=date_to)
    records = record_query.all()
    active = [r for r in records if normalize_warranty_status(r.status) == WARRANTY_STATUS_ACTIVE and r.end_date >= now]
    expired = [r for r in records if normalize_warranty_status(r.status) == WARRANTY_STATUS_EXPIRED or r.end_date < now]
    expiring_soon = [r for r in active if r.end_date <= soon_cutoff]

    claim_query = db.query(WarrantyClaim)
    start = _parse_iso_date(date_from)
    end = _parse_iso_date(date_to, end_exclusive=True)
    if start:
        claim_query = claim_query.filter(WarrantyClaim.created_at >= start)
    if end:
        claim_query = claim_query.filter(WarrantyClaim.created_at < end)
    claims = claim_query.all()

    pending_claims = [c for c in claims if normalize_claim_status(c.decision_status or c.claim_status) == CLAIM_STATUS_PENDING_INSPECTION]
    approved_claims = [c for c in claims if normalize_claim_status(c.decision_status or c.claim_status) == CLAIM_STATUS_APPROVED]
    rejected_claims = [c for c in claims if normalize_claim_status(c.decision_status or c.claim_status) == CLAIM_STATUS_REJECTED]

    return {
        "kpis": {
            "active_warranties": len(active),
            "expired_warranties": len(expired),
            "pending_claims": len(pending_claims),
            "approved_claims": len(approved_claims),
            "rejected_claims": len(rejected_claims),
            "expiring_soon": len(expiring_soon),
            "total_warranties": len(records),
            "total_claims": len(claims),
        },
        "top_expiring": [
            {
                "warranty_id": row.warranty_code,
                "customer_name": row.customer_name,
                "product_or_service_name": row.product_or_service_name,
                "end_date": row.end_date.isoformat() if row.end_date else None,
                "days_left": max(0, int((row.end_date - now).days)) if row.end_date else 0,
                "status": warranty_status_label(row.status),
                "status_key": normalize_warranty_status(row.status),
            }
            for row in sorted(expiring_soon, key=lambda r: r.end_date)[:10]
        ],
    }


@router.get("/dashboard/overview", dependencies=[Depends(require_permission("warranty.view"))])
def warranty_dashboard_overview(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    return warranty_dashboard(date_from=date_from, date_to=date_to, db=db, _=_)


@router.get("/dashboard/status-breakdown", dependencies=[Depends(require_permission("warranty.view"))])
def warranty_dashboard_status_breakdown(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    refresh_warranty_statuses(db)
    rows = _build_record_query(db, date_from=date_from, date_to=date_to).all()
    buckets: dict[str, int] = {}
    for row in rows:
        key = normalize_warranty_status(row.status)
        buckets[key] = buckets.get(key, 0) + 1
    return {"rows": [{"status": key, "count": value, "label": warranty_status_label(key)} for key, value in sorted(buckets.items())]}


@router.get("/dashboard/claim-performance", dependencies=[Depends(require_permission("warranty.view"))])
def warranty_dashboard_claim_performance(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(WarrantyClaim)
    start = _parse_iso_date(date_from)
    end = _parse_iso_date(date_to, end_exclusive=True)
    if start:
        query = query.filter(WarrantyClaim.created_at >= start)
    if end:
        query = query.filter(WarrantyClaim.created_at < end)
    rows = query.all()
    total = len(rows)
    approved = len([r for r in rows if normalize_claim_status(r.decision_status or r.claim_status) == CLAIM_STATUS_APPROVED])
    rejected = len([r for r in rows if normalize_claim_status(r.decision_status or r.claim_status) == CLAIM_STATUS_REJECTED])
    resolved = len([r for r in rows if normalize_claim_status(r.decision_status or r.claim_status) in {CLAIM_STATUS_RESOLVED, CLAIM_STATUS_CLOSED}])
    pending = max(0, total - approved - rejected - resolved)
    approval_rate = round((approved / total) * 100, 2) if total else 0
    return {
        "total_claims": total,
        "approved": approved,
        "rejected": rejected,
        "resolved": resolved,
        "pending": pending,
        "approval_rate_pct": approval_rate,
    }


@router.get("/dashboard/expiring", dependencies=[Depends(require_permission("warranty.view"))])
def warranty_dashboard_expiring(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    return list_expiring_warranty_records(days=days, db=db, _=_)


@router.get("/dashboard/recent-claims", dependencies=[Depends(require_permission("warranty.view"))])
def warranty_dashboard_recent_claims(
    limit: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    rows = (
        db.query(WarrantyClaim)
        .options(
            joinedload(WarrantyClaim.warranty),
            joinedload(WarrantyClaim.processed_by),
            joinedload(WarrantyClaim.approved_by),
        )
        .order_by(WarrantyClaim.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_serialize_claim(row) for row in rows]


@router.get("/records", dependencies=[Depends(require_permission("warranty.view"))])
def list_warranty_records(
    status: str | None = Query(default=None),
    warranty_type: str | None = Query(default=None),
    category: str | None = Query(default=None),
    brand: str | None = Query(default=None),
    supplier: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    refresh_warranty_statuses(db)
    rows = (
        _build_record_query(
            db,
            status=status,
            warranty_type=warranty_type,
            category=category,
            brand=brand,
            supplier=supplier,
            date_from=date_from,
            date_to=date_to,
            q=q,
        )
        .order_by(WarrantyRecord.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_serialize_record(row) for row in rows]


@router.get("/records/expiring-soon", dependencies=[Depends(require_permission("warranty.view"))])
def list_expiring_warranty_records(
    days: int = Query(default=14, ge=1, le=365),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    refresh_warranty_statuses(db)
    now = utcnow()
    cutoff = now + timedelta(days=int(days))
    rows = (
        db.query(WarrantyRecord)
        .options(joinedload(WarrantyRecord.repair_ticket), joinedload(WarrantyRecord.claims))
        .filter(
            WarrantyRecord.end_date >= now,
            WarrantyRecord.end_date <= cutoff,
            or_(WarrantyRecord.is_deleted == False, WarrantyRecord.is_deleted.is_(None)),  # noqa: E712
        )
        .order_by(WarrantyRecord.end_date.asc())
        .limit(500)
        .all()
    )
    return [_serialize_record(row) for row in rows]


@router.get("/records/customer/{customer_id}", dependencies=[Depends(require_permission("warranty.view"))])
def list_customer_warranty_records(
    customer_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    refresh_warranty_statuses(db)
    rows = (
        db.query(WarrantyRecord)
        .options(joinedload(WarrantyRecord.repair_ticket), joinedload(WarrantyRecord.claims))
        .filter(
            WarrantyRecord.customer_id == customer_id,
            or_(WarrantyRecord.is_deleted == False, WarrantyRecord.is_deleted.is_(None)),  # noqa: E712
        )
        .order_by(WarrantyRecord.created_at.desc())
        .limit(1000)
        .all()
    )
    return [_serialize_record(row) for row in rows]


@router.post("/records/manual-exception", dependencies=[Depends(require_permission("warranty.create_manual"))])
def create_manual_exception_warranty_record(
    payload: WarrantyRecordIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _require_any_role(current_user, {"owner", "admin", "manager"})
    row_payload = payload.model_copy(update={"warranty_type": payload.warranty_type or "manual_exception"})
    return create_warranty_record(row_payload, db=db, current_user=current_user)


@router.get("/records/{warranty_record_id}", dependencies=[Depends(require_permission("warranty.view"))])
def get_warranty_record(
    warranty_record_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = (
        db.query(WarrantyRecord)
        .options(
            joinedload(WarrantyRecord.repair_ticket),
            joinedload(WarrantyRecord.claims).joinedload(WarrantyClaim.processed_by),
            joinedload(WarrantyRecord.claims).joinedload(WarrantyClaim.approved_by),
        )
        .filter(WarrantyRecord.id == warranty_record_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Warranty record not found")
    payload = _serialize_record(row)
    payload["claims"] = [_serialize_claim(claim) for claim in row.claims]
    return payload


@router.get(
    "/records/{warranty_record_id}/certificate",
    dependencies=[Depends(require_permission("warranty.print"))],
    response_class=HTMLResponse,
)
def print_warranty_certificate(
    warranty_record_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = (
        db.query(WarrantyRecord)
        .options(joinedload(WarrantyRecord.repair_ticket), joinedload(WarrantyRecord.claims))
        .filter(WarrantyRecord.id == warranty_record_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Warranty record not found")
    store = get_store_profile_print_data(db)
    return HTMLResponse(render_warranty_certificate_html(_serialize_record(row), store))


@router.post("/records", dependencies=[Depends(require_permission("warranty.create_manual"))])
def create_warranty_record(
    payload: WarrantyRecordIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    start_date = payload.start_date
    end_date = payload.end_date or (start_date + timedelta(days=max(0, int(payload.warranty_days or 0))))
    if end_date < start_date:
        raise HTTPException(status_code=400, detail="End date cannot be earlier than start date")

    row = WarrantyRecord(
        invoice_id=payload.invoice_id,
        invoice_item_id=payload.invoice_item_id or payload.sale_item_id,
        repair_ticket_id=payload.repair_ticket_id,
        sale_item_id=payload.sale_item_id,
        warranty_rule_id=payload.warranty_rule_id,
        product_id=payload.product_id or payload.item_id,
        variant_id=payload.variant_id,
        serial_id=payload.serial_id,
        item_id=payload.item_id,
        customer_id=payload.customer_id,
        customer_name=payload.customer_name,
        customer_phone=payload.customer_phone,
        product_or_service_name=payload.product_or_service_name,
        product_category=payload.product_category,
        brand=payload.brand,
        supplier_name=payload.supplier_name,
        device_brand_model=payload.device_brand_model,
        imei=payload.imei,
        imei_or_serial=payload.imei_or_serial,
        serial_number=payload.serial_number,
        warranty_type=payload.warranty_type,
        start_date=start_date,
        end_date=end_date,
        status=normalize_warranty_status(payload.status if payload.status else (WARRANTY_STATUS_ACTIVE if end_date >= utcnow() else WARRANTY_STATUS_EXPIRED)),
        coverage_type=payload.coverage_type or "repair",
        quantity_covered=max(1, int(payload.quantity_covered or 1)),
        warranty_days=max(0, int(payload.warranty_days or 0)),
        conditions_json=payload.conditions_json,
        notes=payload.notes,
        created_by_id=current_user.id,
    )
    db.add(row)
    db.flush()
    row.warranty_code = next_number(db, "WRN")
    row.warranty_number = row.warranty_code
    db.commit()
    db.refresh(row)
    return _serialize_record(row)


@router.put("/records/{warranty_record_id}/status", dependencies=[Depends(require_permission("warranty.edit"))])
def update_warranty_record_status(
    warranty_record_id: int,
    status: str,
    notes: str | None = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(WarrantyRecord).filter(WarrantyRecord.id == warranty_record_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Warranty record not found")

    normalized_status = normalize_warranty_status(status)
    row.status = normalized_status
    if notes is not None:
        row.notes = notes
    db.commit()
    db.refresh(row)
    return _serialize_record(row)


@router.patch("/records/{warranty_record_id}/void", dependencies=[Depends(require_permission("warranty.void"))])
def void_warranty_record(
    warranty_record_id: int,
    reason: str = Query(..., min_length=3),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _require_any_role(current_user, {"owner", "admin", "manager"})
    row = db.query(WarrantyRecord).filter(WarrantyRecord.id == warranty_record_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Warranty record not found")
    row.status = "voided"
    row.notes = f"{(row.notes or '').strip()}\nVoided: {reason}".strip()
    row.delete_reason = reason
    row.deleted_at = utcnow()
    row.deleted_by = current_user.id if current_user else None
    db.commit()
    db.refresh(row)
    return _serialize_record(row)


@router.get("/lookup", dependencies=[Depends(require_permission("warranty.view"))])
def warranty_lookup(
    invoice_id: int | None = Query(default=None),
    invoice: str | None = Query(default=None),
    customer_phone: str | None = Query(default=None),
    phone: str | None = Query(default=None),
    imei: str | None = Query(default=None),
    warranty_id: str | None = Query(default=None),
    warranty_number: str | None = Query(default=None),
    serial_number: str | None = Query(default=None),
    serial: str | None = Query(default=None),
    q: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    refresh_warranty_statuses(db)
    query = (
        db.query(WarrantyRecord)
        .options(joinedload(WarrantyRecord.repair_ticket), joinedload(WarrantyRecord.claims))
        .filter(or_(WarrantyRecord.is_deleted == False, WarrantyRecord.is_deleted.is_(None)))  # noqa: E712
    )
    if invoice_id:
        query = query.filter(WarrantyRecord.invoice_id == invoice_id)
    invoice_text = str(invoice or "").strip()
    if invoice_text and not invoice_id:
        digits = re.sub(r"[^\d]", "", invoice_text)
        if digits:
            query = query.filter(WarrantyRecord.invoice_id == int(digits))
    resolved_phone = customer_phone or phone
    if resolved_phone:
        query = query.filter(WarrantyRecord.customer_phone.ilike(f"%{resolved_phone.strip()}%"))
    if imei:
        query = query.filter(or_(WarrantyRecord.imei_or_serial.ilike(f"%{imei.strip()}%"), WarrantyRecord.imei.ilike(f"%{imei.strip()}%")))
    resolved_warranty_no = warranty_number or warranty_id
    if resolved_warranty_no:
        query = query.filter(
            or_(
                WarrantyRecord.warranty_code.ilike(f"%{resolved_warranty_no.strip()}%"),
                WarrantyRecord.warranty_number.ilike(f"%{resolved_warranty_no.strip()}%"),
            )
        )
    resolved_serial = serial_number or serial
    if resolved_serial:
        query = query.filter(WarrantyRecord.serial_number.ilike(f"%{resolved_serial.strip()}%"))
    if q:
        normalized_q = q.strip()
        invoice_id_match = None
        if normalized_q.lower().startswith("inv-"):
            digits = re.sub(r"[^\d]", "", normalized_q)
            if digits:
                invoice_id_match = int(digits)
        like = f"%{q.strip()}%"
        clauses = [
            WarrantyRecord.warranty_code.ilike(like),
            WarrantyRecord.customer_phone.ilike(like),
            WarrantyRecord.customer_name.ilike(like),
            WarrantyRecord.imei_or_serial.ilike(like),
            WarrantyRecord.serial_number.ilike(like),
            WarrantyRecord.product_or_service_name.ilike(like),
        ]
        if invoice_id_match is not None:
            clauses.append(WarrantyRecord.invoice_id == invoice_id_match)
        query = query.filter(or_(*clauses))
    rows = query.order_by(WarrantyRecord.created_at.desc()).limit(100).all()
    return [_serialize_record(row) for row in rows]


@router.get("/claims", dependencies=[Depends(require_permission("warranty.view"))])
def list_warranty_claims(
    claim_status: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = (
        db.query(WarrantyClaim)
        .options(
            joinedload(WarrantyClaim.warranty),
            joinedload(WarrantyClaim.processed_by),
            joinedload(WarrantyClaim.approved_by),
        )
        .filter(or_(WarrantyClaim.is_deleted == False, WarrantyClaim.is_deleted.is_(None)))  # noqa: E712
    )
    if claim_status and claim_status.lower() != "all":
        status_key = normalize_claim_status(claim_status)
        query = query.filter(
            or_(
                func.lower(func.trim(WarrantyClaim.decision_status)) == status_key,
                func.lower(func.trim(WarrantyClaim.claim_status)) == status_key,
                WarrantyClaim.claim_status == claim_status,
            )
        )
    start = _parse_iso_date(date_from)
    end = _parse_iso_date(date_to, end_exclusive=True)
    if start:
        query = query.filter(WarrantyClaim.created_at >= start)
    if end:
        query = query.filter(WarrantyClaim.created_at < end)
    if q:
        like = f"%{q.strip()}%"
        query = query.join(WarrantyClaim.warranty).filter(
            or_(
                WarrantyClaim.claim_code.ilike(like),
                WarrantyClaim.claim_number.ilike(like),
                WarrantyRecord.warranty_code.ilike(like),
                WarrantyRecord.warranty_number.ilike(like),
                WarrantyRecord.customer_name.ilike(like),
                WarrantyRecord.customer_phone.ilike(like),
                WarrantyRecord.product_or_service_name.ilike(like),
                WarrantyClaim.customer_complaint.ilike(like),
            )
        )
    rows = query.order_by(WarrantyClaim.created_at.desc()).limit(limit).all()
    return [_serialize_claim(row) for row in rows]


@router.post("/claims", dependencies=[Depends(require_permission("warranty.create_claim"))])
def create_warranty_claim(
    payload: WarrantyClaimIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    try:
        row = create_claim(
            db=db,
            warranty_id=payload.warranty_id,
            complaint=payload.customer_complaint,
            created_by_id=current_user.id if current_user else None,
            customer_id=payload.customer_id,
            issue_description=payload.claim_decision,
        )
        if payload.issue_description:
            row.issue_description = payload.issue_description
        if payload.claim_date:
            row.claim_date = payload.claim_date
        if payload.technician_id:
            row.technician_id = payload.technician_id
        if payload.technician_inspection_note:
            row.technician_inspection_note = payload.technician_inspection_note
            row.inspection_notes = payload.technician_inspection_note
        if payload.inspection_notes:
            row.inspection_notes = payload.inspection_notes
            row.technician_inspection_note = payload.inspection_notes
        if payload.claim_decision:
            row.claim_decision = payload.claim_decision
        if payload.replacement_item:
            row.replacement_item = payload.replacement_item
        if payload.repair_action:
            row.repair_action = payload.repair_action
        if payload.rejection_reason:
            row.rejection_reason = payload.rejection_reason
        if payload.resolution_type:
            row.resolution_type = payload.resolution_type
        if payload.replacement_product_id:
            row.replacement_product_id = payload.replacement_product_id
        if payload.replacement_serial_id:
            row.replacement_serial_id = payload.replacement_serial_id
        if payload.linked_repair_ticket_id:
            row.linked_repair_ticket_id = payload.linked_repair_ticket_id
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    db.commit()
    db.refresh(row)
    return _serialize_claim(row)


@router.get("/claims/{claim_id}", dependencies=[Depends(require_permission("warranty.view"))])
def get_warranty_claim(
    claim_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = (
        db.query(WarrantyClaim)
        .options(
            joinedload(WarrantyClaim.warranty),
            joinedload(WarrantyClaim.processed_by),
            joinedload(WarrantyClaim.approved_by),
        )
        .filter(WarrantyClaim.id == claim_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Claim not found")
    return _serialize_claim(row)


@router.patch("/claims/{claim_id}/inspect", dependencies=[Depends(require_permission("warranty.inspect_claim"))])
def inspect_warranty_claim(
    claim_id: int,
    technician_notes: str = Query(..., min_length=3),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    try:
        row = inspect_claim(
            db=db,
            claim_id=claim_id,
            technician_notes=technician_notes,
            technician_id=current_user.id if current_user else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    db.commit()
    db.refresh(row)
    return _serialize_claim(row)


@router.patch("/claims/{claim_id}/approve", dependencies=[Depends(require_permission("warranty.approve_claim"))])
def approve_warranty_claim(
    claim_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _require_any_role(current_user, {"owner", "admin", "manager"})
    try:
        row = approve_claim(db, claim_id=claim_id, approved_by_id=current_user.id if current_user else None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    db.commit()
    db.refresh(row)
    return _serialize_claim(row)


@router.patch("/claims/{claim_id}/reject", dependencies=[Depends(require_permission("warranty.reject_claim"))])
def reject_warranty_claim(
    claim_id: int,
    reason: str = Query(..., min_length=3),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _require_any_role(current_user, {"owner", "admin", "manager"})
    try:
        row = reject_claim(
            db,
            claim_id=claim_id,
            reason=reason,
            rejected_by_id=current_user.id if current_user else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    db.commit()
    db.refresh(row)
    return _serialize_claim(row)


@router.patch("/claims/{claim_id}/resolve", dependencies=[Depends(require_permission("warranty.resolve_claim"))])
def resolve_warranty_claim(
    claim_id: int,
    resolution_type: str = Query(default="no_action"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    try:
        row = resolve_claim(
            db,
            claim_id=claim_id,
            resolution_type=resolution_type,
            resolved_by_id=current_user.id if current_user else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    db.commit()
    db.refresh(row)
    return _serialize_claim(row)


@router.post("/claims/{claim_id}/create-repair", dependencies=[Depends(require_permission("warranty.resolve_claim"))])
def create_repair_for_warranty_claim(
    claim_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    try:
        row = create_repair_from_claim(db, claim_id=claim_id, performed_by_id=current_user.id if current_user else None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    db.commit()
    db.refresh(row)
    return _serialize_claim(row)


@router.post("/claims/{claim_id}/replacement", dependencies=[Depends(require_permission("warranty.resolve_claim"))])
def create_replacement_for_warranty_claim(
    claim_id: int,
    replacement_product_id: int | None = Query(default=None),
    replacement_serial_id: int | None = Query(default=None),
    reason: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _require_any_role(current_user, {"owner", "admin", "manager"})
    try:
        row, warranty = create_replacement_from_claim(
            db=db,
            claim_id=claim_id,
            replacement_product_id=replacement_product_id,
            replacement_serial_id=replacement_serial_id,
            replacement_reason=reason,
            performed_by_id=current_user.id if current_user else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    db.commit()
    db.refresh(row)
    return {
        "claim": _serialize_claim(row),
        "replacement_warranty": _serialize_record(warranty) if warranty else None,
    }


@router.put("/claims/{claim_id}", dependencies=[Depends(require_permission("warranty.create_claim"))])
def update_warranty_claim(
    claim_id: int,
    payload: WarrantyClaimUpdateIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = (
        db.query(WarrantyClaim)
        .options(joinedload(WarrantyClaim.warranty))
        .filter(WarrantyClaim.id == claim_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Claim not found")

    if payload.technician_inspection_note:
        row.technician_inspection_note = payload.technician_inspection_note
        row.inspection_notes = payload.technician_inspection_note
    if payload.inspection_notes is not None:
        row.inspection_notes = payload.inspection_notes
        if payload.inspection_notes:
            row.technician_inspection_note = payload.inspection_notes
    if payload.issue_description is not None:
        row.issue_description = payload.issue_description

    if payload.claim_decision is not None:
        row.claim_decision = payload.claim_decision
    if payload.replacement_item is not None:
        row.replacement_item = payload.replacement_item
    if payload.repair_action is not None:
        row.repair_action = payload.repair_action
    if payload.rejection_reason is not None:
        row.rejection_reason = payload.rejection_reason
    if payload.resolution_type is not None:
        row.resolution_type = payload.resolution_type
    if payload.replacement_product_id is not None:
        row.replacement_product_id = payload.replacement_product_id
    if payload.replacement_serial_id is not None:
        row.replacement_serial_id = payload.replacement_serial_id
    if payload.linked_repair_ticket_id is not None:
        row.linked_repair_ticket_id = payload.linked_repair_ticket_id

    if payload.claim_status:
        status_key = normalize_claim_status(payload.claim_status)
        try:
            if status_key == CLAIM_STATUS_APPROVED:
                row = approve_claim(db, claim_id=row.id, approved_by_id=current_user.id if current_user else None)
            elif status_key == CLAIM_STATUS_REJECTED:
                reason = payload.claim_decision or "Rejected"
                row = reject_claim(db, claim_id=row.id, reason=reason, rejected_by_id=current_user.id if current_user else None)
            elif status_key in {CLAIM_STATUS_RESOLVED, CLAIM_STATUS_CLOSED}:
                resolution = payload.repair_action or "no_action"
                row = resolve_claim(db, claim_id=row.id, resolution_type=resolution, resolved_by_id=current_user.id if current_user else None)
                if status_key == CLAIM_STATUS_CLOSED:
                    row.decision_status = CLAIM_STATUS_CLOSED
                    row.claim_status = claim_status_label(CLAIM_STATUS_CLOSED)
                    row.closed_at = utcnow()
            elif status_key == CLAIM_STATUS_REPAIRING:
                row = create_repair_from_claim(db, claim_id=row.id, performed_by_id=current_user.id if current_user else None)
            elif status_key == CLAIM_STATUS_REPLACED:
                row, _ = create_replacement_from_claim(
                    db,
                    claim_id=row.id,
                    replacement_product_id=None,
                    replacement_serial_id=None,
                    replacement_reason=payload.claim_decision or "Replacement approved",
                    performed_by_id=current_user.id if current_user else None,
                )
            else:
                row.decision_status = status_key
                row.claim_status = claim_status_label(status_key)
                apply_claim_status_to_warranty(row.warranty, status_key)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    row.processed_by_id = current_user.id if current_user else row.processed_by_id
    db.commit()
    db.refresh(row)
    return _serialize_claim(row)


@router.get("/rules", dependencies=[Depends(require_permission("warranty.view"))])
def list_warranty_rules(
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ensure_warranty_defaults(db)
    rows = (
        db.query(WarrantyRule)
        .filter(or_(WarrantyRule.is_deleted == False, WarrantyRule.is_deleted.is_(None)))  # noqa: E712
        .order_by(WarrantyRule.priority.asc(), WarrantyRule.scope_type.asc(), WarrantyRule.id.asc())
        .all()
    )
    return [_serialize_rule(row) for row in rows]


@router.post("/rules", dependencies=[Depends(require_permission("warranty.edit_rules"))])
def create_warranty_rule(
    payload: WarrantyRuleIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = WarrantyRule(**payload.model_dump())
    row.created_by = current_user.id if current_user else None
    _sync_rule_legacy_fields(row)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize_rule(row)


@router.put("/rules/{rule_id}", dependencies=[Depends(require_permission("warranty.edit_rules"))])
def update_warranty_rule(
    rule_id: int,
    payload: WarrantyRuleIn,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(WarrantyRule).filter(WarrantyRule.id == rule_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Warranty rule not found")
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    _sync_rule_legacy_fields(row)
    db.commit()
    db.refresh(row)
    return _serialize_rule(row)


@router.delete("/rules/{rule_id}", dependencies=[Depends(require_permission("warranty.edit_rules"))])
def delete_warranty_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(WarrantyRule).filter(WarrantyRule.id == rule_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Warranty rule not found")
    row.is_active = False
    row.is_deleted = True
    row.deleted_at = utcnow()
    row.deleted_by = current_user.id if current_user else None
    row.delete_reason = "Deactivated via delete endpoint"
    db.commit()
    return {"ok": True}


@router.patch("/rules/{rule_id}/activate", dependencies=[Depends(require_permission("warranty.edit_rules"))])
def activate_warranty_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(WarrantyRule).filter(WarrantyRule.id == rule_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Warranty rule not found")
    row.is_active = True
    row.is_deleted = False
    row.deleted_at = None
    row.deleted_by = None
    row.delete_reason = None
    db.commit()
    db.refresh(row)
    return {"ok": True, "rule": {"id": row.id, "is_active": row.is_active}}


@router.patch("/rules/{rule_id}/deactivate", dependencies=[Depends(require_permission("warranty.edit_rules"))])
def deactivate_warranty_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(WarrantyRule).filter(WarrantyRule.id == rule_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Warranty rule not found")
    row.is_active = False
    row.deleted_at = utcnow()
    row.deleted_by = current_user.id if current_user else None
    row.delete_reason = "Deactivated"
    db.commit()
    db.refresh(row)
    return {"ok": True, "rule": {"id": row.id, "is_active": row.is_active}}


@router.get("/conditions", dependencies=[Depends(require_permission("warranty.view"))])
def list_warranty_conditions(
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ensure_warranty_defaults(db)
    rows = db.query(WarrantyCondition).order_by(WarrantyCondition.sort_order.asc(), WarrantyCondition.id.asc()).all()
    return [
        {
            "id": row.id,
            "condition_code": row.condition_code,
            "title": row.title,
            "description": row.description,
            "is_covered": row.is_covered,
            "is_active": row.is_active,
            "sort_order": row.sort_order,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


@router.post("/conditions", dependencies=[Depends(require_permission("warranty.edit_rules"))])
def create_warranty_condition(
    payload: WarrantyConditionIn,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    exists = (
        db.query(WarrantyCondition)
        .filter(WarrantyCondition.condition_code == payload.condition_code)
        .first()
    )
    if exists:
        raise HTTPException(status_code=400, detail="Condition code already exists")
    row = WarrantyCondition(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "condition_code": row.condition_code,
        "title": row.title,
        "description": row.description,
        "is_covered": row.is_covered,
        "is_active": row.is_active,
        "sort_order": row.sort_order,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.put("/conditions/{condition_id}", dependencies=[Depends(require_permission("warranty.edit_rules"))])
def update_warranty_condition(
    condition_id: int,
    payload: WarrantyConditionIn,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(WarrantyCondition).filter(WarrantyCondition.id == condition_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Condition not found")
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "condition_code": row.condition_code,
        "title": row.title,
        "description": row.description,
        "is_covered": row.is_covered,
        "is_active": row.is_active,
        "sort_order": row.sort_order,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.delete("/conditions/{condition_id}", dependencies=[Depends(require_permission("warranty.edit_rules"))])
def delete_warranty_condition(
    condition_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(WarrantyCondition).filter(WarrantyCondition.id == condition_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Condition not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/reports", dependencies=[Depends(require_permission("warranty.export"))])
def warranty_reports(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    refresh_warranty_statuses(db)
    rows = _build_record_query(db, date_from=date_from, date_to=date_to).all()
    claims = (
        db.query(WarrantyClaim)
        .options(joinedload(WarrantyClaim.warranty))
        .all()
    )
    start = _parse_iso_date(date_from)
    end = _parse_iso_date(date_to, end_exclusive=True)
    if start:
        claims = [c for c in claims if c.created_at and c.created_at >= start]
    if end:
        claims = [c for c in claims if c.created_at and c.created_at < end]

    active_rows = [r for r in rows if normalize_warranty_status(r.status) == WARRANTY_STATUS_ACTIVE]
    expired_rows = [r for r in rows if normalize_warranty_status(r.status) == WARRANTY_STATUS_EXPIRED]
    rejected_claim_rows = [c for c in claims if normalize_claim_status(c.decision_status or c.claim_status) == CLAIM_STATUS_REJECTED]
    replacement_claim_rows = [c for c in claims if normalize_claim_status(c.decision_status or c.claim_status) == CLAIM_STATUS_REPLACED]

    summary_by_status: dict[str, int] = {}
    for claim in claims:
        key = normalize_claim_status(claim.decision_status or claim.claim_status)
        summary_by_status[key] = summary_by_status.get(key, 0) + 1

    trend_map: dict[str, dict] = {}
    for claim in claims:
        if not claim.created_at:
            continue
        month_key = claim.created_at.strftime("%Y-%m")
        if month_key not in trend_map:
            trend_map[month_key] = {
                "month": month_key,
                "total_claims": 0,
                "approved": 0,
                "rejected": 0,
            }
        trend_map[month_key]["total_claims"] += 1
        status_key = normalize_claim_status(claim.decision_status or claim.claim_status)
        if status_key == CLAIM_STATUS_APPROVED:
            trend_map[month_key]["approved"] += 1
        if status_key == CLAIM_STATUS_REJECTED:
            trend_map[month_key]["rejected"] += 1

    return {
        "kpis": {
            "active_warranties": len(active_rows),
            "expired_warranties": len(expired_rows),
            "claims_total": len(claims),
            "claims_pending": len([c for c in claims if normalize_claim_status(c.decision_status or c.claim_status) == CLAIM_STATUS_PENDING_INSPECTION]),
            "claims_rejected": len(rejected_claim_rows),
            "claims_replaced": len(replacement_claim_rows),
        },
        "active_warranties": [_serialize_record(r) for r in active_rows[:500]],
        "expired_warranties": [_serialize_record(r) for r in expired_rows[:500]],
        "claims_summary": [{"status": k, "status_label": claim_status_label(k), "count": v} for k, v in sorted(summary_by_status.items())],
        "rejected_claims": [_serialize_claim(c) for c in rejected_claim_rows[:500]],
        "replacement_history": [_serialize_claim(c) for c in replacement_claim_rows[:500]],
        "claim_trend": [trend_map[key] for key in sorted(trend_map.keys())],
    }


@router.get("/filters", dependencies=[Depends(require_permission("warranty.view"))])
def warranty_filters(
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    categories = [
        row[0]
        for row in db.query(WarrantyRecord.product_category)
        .filter(WarrantyRecord.product_category.isnot(None), WarrantyRecord.product_category != "")
        .distinct()
        .all()
    ]
    brands = [
        row[0]
        for row in db.query(WarrantyRecord.brand)
        .filter(WarrantyRecord.brand.isnot(None), WarrantyRecord.brand != "")
        .distinct()
        .all()
    ]
    suppliers = [
        row[0]
        for row in db.query(WarrantyRecord.supplier_name)
        .filter(WarrantyRecord.supplier_name.isnot(None), WarrantyRecord.supplier_name != "")
        .distinct()
        .all()
    ]
    customers = [
        {"id": row.id, "name": row.name, "phone": row.phone}
        for row in db.query(Customer).order_by(Customer.name.asc()).all()
    ]
    inventory_items = [
        {
            "id": row.id,
            "name": row.name,
            "category": row.category,
            "brand": row.brand,
        }
        for row in db.query(InventoryItem).order_by(InventoryItem.name.asc()).all()
    ]
    repairs = [
        {
            "id": row.id,
            "ticket_no": row.ticket_no,
            "device_model": row.device_model,
            "status": row.status,
        }
        for row in db.query(RepairTicket).order_by(RepairTicket.created_at.desc()).limit(200).all()
    ]
    invoices = [
        {
            "id": row.id,
            "invoice_no": f"INV-{row.id:05d}",
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in db.query(Sale).order_by(Sale.created_at.desc()).limit(200).all()
    ]
    return {
        "categories": categories,
        "brands": brands,
        "suppliers": suppliers,
        "customers": customers,
        "inventory_items": inventory_items,
        "repairs": repairs,
        "invoices": invoices,
    }
