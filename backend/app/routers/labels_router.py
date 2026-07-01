import json
import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_permission
from app.database import get_db
from app.models import (
    AppSetting,
    Customer,
    InventoryItem,
    LabelAsset,
    LabelPrintJob,
    LabelScanLog,
    LabelTemplate,
    RepairTicket,
    Supplier,
)
from app.schemas import (
    LabelAssetIn,
    LabelPrintNowIn,
    LabelQueueBatchIn,
    LabelQueueReorderIn,
    LabelQueueStatusUpdateIn,
    LabelReprintIn,
    LabelScanIn,
    LabelTemplateDuplicateIn,
    LabelTemplateIn,
)
from app.services.labels_service import (
    BARCODE_FORMATS,
    LABEL_QUEUE_STATUSES,
    LABEL_SCOPES,
    LABEL_SIZE_PRESETS,
    PRINTER_STATUSES,
    ensure_label_defaults,
    generate_barcode_from_seed,
    normalize_barcode,
    safe_json_dumps,
    safe_json_loads,
    validate_barcode,
)
from app.services.print_rendering_service import get_store_profile_print_data, render_label_sheet_html
from app.utils.time import utcnow

router = APIRouter(prefix="/labels", tags=["labels"])


def _parse_date(value: str | None, end_exclusive: bool = False) -> datetime | None:
    if not value:
        return None
    dt = datetime.fromisoformat(value)
    if end_exclusive:
        dt = dt + timedelta(days=1)
    return dt


def _serialize_user(user) -> str | None:
    if not user:
        return None
    return user.full_name or user.username or f"User #{user.id}"


def _is_spare_part(item: InventoryItem) -> bool:
    ptype = str(item.product_type or "").strip().lower()
    category = str(item.category or "").strip().lower()
    return ptype == "spare parts" or "spare" in category or "part" in category


def _stock_status(item: InventoryItem) -> str:
    qty = int(item.quantity or 0)
    threshold = int(item.low_stock_threshold or 0)
    if qty <= 0:
        return "Out of Stock"
    if qty <= max(1, threshold):
        return "Low"
    return "In Stock"


def _get_setting_json(db: Session, key: str, default):
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        return default
    return safe_json_loads(row.value, default)


def _set_setting_json(db: Session, key: str, value):
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        row = AppSetting(key=key, value=safe_json_dumps(value))
        db.add(row)
    else:
        row.value = safe_json_dumps(value)
    db.commit()
    return value


def _serialize_template(row: LabelTemplate) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "label_scope": row.label_scope,
        "width_mm": row.width_mm,
        "height_mm": row.height_mm,
        "canvas": safe_json_loads(row.canvas_json, {}),
        "is_default": bool(row.is_default),
        "is_builtin": bool(row.is_builtin),
        "is_active": bool(row.is_active),
        "created_by": _serialize_user(row.created_by),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _serialize_job(row: LabelPrintJob) -> dict:
    return {
        "id": row.id,
        "queue_no": row.id,
        "job_code": row.job_code,
        "label_type": row.label_type,
        "entity_type": row.entity_type,
        "entity_id": row.entity_id,
        "entity_ref": row.entity_ref,
        "item_name": row.item_name,
        "qty": int(row.qty or 0),
        "template_id": row.template_id,
        "template_name": row.template_name or (row.template.name if row.template else None),
        "barcode_format": row.barcode_format,
        "printer_name": row.printer_name,
        "paper_type": row.paper_type,
        "print_quality": row.print_quality,
        "orientation": row.orientation,
        "status": row.status,
        "priority": row.priority,
        "is_reprint": bool(row.is_reprint),
        "reprint_reason": row.reprint_reason,
        "generated_by": _serialize_user(row.generated_by),
        "error_message": row.error_message,
        "metadata": safe_json_loads(row.metadata_json, {}),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    }


def _serialize_asset(row: LabelAsset) -> dict:
    return {
        "id": row.id,
        "asset_code": row.asset_code,
        "asset_name": row.asset_name,
        "asset_type": row.asset_type,
        "department": row.department,
        "location": row.location,
        "purchase_date": row.purchase_date.isoformat() if row.purchase_date else None,
        "warranty_expiry_date": row.warranty_expiry_date.isoformat() if row.warranty_expiry_date else None,
        "assigned_to": row.assigned_to,
        "maintenance_due_date": row.maintenance_due_date.isoformat() if row.maintenance_due_date else None,
        "barcode_value": row.barcode_value,
        "qr_value": row.qr_value,
        "status": row.status,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _last_print_map(
    db: Session,
    *,
    entity_type: str,
    label_types: list[str] | None = None,
) -> dict[int, LabelPrintJob]:
    query = (
        db.query(LabelPrintJob)
        .options(joinedload(LabelPrintJob.generated_by), joinedload(LabelPrintJob.template))
        .filter(
            LabelPrintJob.entity_type == entity_type,
            LabelPrintJob.entity_id.isnot(None),
            LabelPrintJob.status == "Completed",
        )
    )
    if label_types:
        query = query.filter(LabelPrintJob.label_type.in_(label_types))
    rows = query.order_by(LabelPrintJob.completed_at.desc(), LabelPrintJob.created_at.desc()).limit(5000).all()
    mapping: dict[int, LabelPrintJob] = {}
    for row in rows:
        if row.entity_id is None:
            continue
        if row.entity_id not in mapping:
            mapping[row.entity_id] = row
    return mapping


@router.get("/meta", dependencies=[Depends(require_permission("labels.view"))])
def labels_meta(db: Session = Depends(get_db), _=Depends(get_current_user)):
    ensure_label_defaults(db)
    categories = [r[0] for r in db.query(InventoryItem.category).filter(InventoryItem.category.isnot(None), InventoryItem.category != "").distinct().all()]
    brands = [r[0] for r in db.query(InventoryItem.brand).filter(InventoryItem.brand.isnot(None), InventoryItem.brand != "").distinct().all()]
    suppliers = [{"id": row.id, "name": row.name} for row in db.query(Supplier).order_by(Supplier.name.asc()).all()]
    technicians = sorted(
        [
            (row[0] or "").strip()
            for row in (
                db.query(RepairTicket.technician)
                .filter(RepairTicket.technician.isnot(None), RepairTicket.technician != "")
                .distinct()
                .order_by(RepairTicket.technician.asc())
                .limit(500)
                .all()
            )
            if (row[0] or "").strip()
        ]
    )
    preferences = _get_setting_json(db, "labels_preferences", {})
    printers = _get_setting_json(db, "labels_printers", [])
    return {
        "label_scopes": LABEL_SCOPES,
        "barcode_formats": BARCODE_FORMATS,
        "queue_statuses": LABEL_QUEUE_STATUSES,
        "printer_statuses": PRINTER_STATUSES,
        "size_presets": LABEL_SIZE_PRESETS,
        "categories": sorted(categories),
        "brands": sorted(brands),
        "suppliers": suppliers,
        "technicians": technicians,
        "preferences": preferences,
        "printers": printers,
    }


@router.get("/dashboard", dependencies=[Depends(require_permission("labels.view"))])
def labels_dashboard(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ensure_label_defaults(db)
    now = utcnow()
    today_start = datetime(now.year, now.month, now.day)
    month_start = datetime(now.year, now.month, 1)
    range_start = _parse_date(date_from) or month_start
    range_end = _parse_date(date_to, end_exclusive=True)

    jobs_query = db.query(LabelPrintJob).options(joinedload(LabelPrintJob.generated_by), joinedload(LabelPrintJob.template))
    if range_start:
        jobs_query = jobs_query.filter(LabelPrintJob.created_at >= range_start)
    if range_end:
        jobs_query = jobs_query.filter(LabelPrintJob.created_at < range_end)
    jobs = jobs_query.order_by(LabelPrintJob.created_at.desc()).limit(1000).all()

    printed_today = len([j for j in jobs if j.status == "Completed" and j.created_at and j.created_at >= today_start])
    printed_month = len([j for j in jobs if j.status == "Completed" and j.created_at and j.created_at >= month_start])
    last_job = jobs[0] if jobs else None

    inventory_items = db.query(InventoryItem).order_by(InventoryItem.id.desc()).limit(5000).all()
    repair_rows = db.query(RepairTicket).order_by(RepairTicket.created_at.desc()).limit(5000).all()
    product_map = _last_print_map(db, entity_type="inventory_item", label_types=["Product"])
    spare_map = _last_print_map(db, entity_type="inventory_item", label_types=["Spare Part"])
    repair_map = _last_print_map(db, entity_type="repair_ticket", label_types=["Repair Job"])

    product_items = [row for row in inventory_items if not _is_spare_part(row)]
    spare_items = [row for row in inventory_items if _is_spare_part(row)]
    products_without_labels = len([row for row in product_items if row.id not in product_map])
    repairs_without_labels = len([row for row in repair_rows if row.id not in repair_map])
    spare_without_labels = len([row for row in spare_items if row.id not in spare_map])

    low_stock_rows = [
        row
        for row in inventory_items
        if int(row.quantity or 0) <= max(1, int(row.low_stock_threshold or 0))
    ]
    new_arrivals_today = [
        row
        for row in inventory_items
        if row.created_at and row.created_at >= today_start and row.id and row.id > 0 and row.name
    ]

    alerts: list[dict] = []
    if products_without_labels:
        alerts.append({"severity": "warning", "text": f"{products_without_labels} products are still unlabelled."})
    if repairs_without_labels:
        alerts.append({"severity": "warning", "text": f"{repairs_without_labels} repair jobs do not have printed labels."})
    if spare_without_labels:
        alerts.append({"severity": "warning", "text": f"{spare_without_labels} spare parts are missing labels."})
    if low_stock_rows:
        alerts.append({"severity": "info", "text": f"{len(low_stock_rows)} low-stock items available for quick batch label printing."})

    printers = _get_setting_json(db, "labels_printers", [])
    primary_printer = next((row for row in printers if row.get("is_default")), printers[0] if printers else None)
    printer_status = primary_printer.get("status") if primary_printer else "Offline"

    return {
        "kpis": {
            "labels_printed_today": printed_today,
            "labels_printed_month": printed_month,
            "products_without_labels": products_without_labels,
            "repair_jobs_without_labels": repairs_without_labels,
            "spare_parts_without_labels": spare_without_labels,
            "last_print_job": _serialize_job(last_job) if last_job else None,
            "printer_status": printer_status,
        },
        "quick_batches": {
            "low_stock_items": len(low_stock_rows),
            "new_arrivals_today": len(new_arrivals_today),
            "all_unlabelled_products": products_without_labels,
        },
        "alerts": alerts,
        "recent_print_jobs": [_serialize_job(row) for row in jobs[:20]],
    }


@router.get("/products", dependencies=[Depends(require_permission("labels.view"))])
def list_product_labels(
    q: str | None = Query(default=None),
    category: str | None = Query(default=None),
    brand: str | None = Query(default=None),
    supplier_id: int | None = Query(default=None),
    stock_status: str | None = Query(default=None),
    unlabelled_only: bool = Query(default=False),
    limit: int = Query(default=800, ge=1, le=5000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ensure_label_defaults(db)
    query = db.query(InventoryItem).options(joinedload(InventoryItem.supplier))
    query = query.filter(or_(InventoryItem.product_type.is_(None), InventoryItem.product_type != "Spare Parts"))
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(
                InventoryItem.name.ilike(like),
                InventoryItem.sku.ilike(like),
                InventoryItem.barcode.ilike(like),
                InventoryItem.model.ilike(like),
            )
        )
    if category and category.lower() != "all":
        query = query.filter(InventoryItem.category == category)
    if brand and brand.lower() != "all":
        query = query.filter(InventoryItem.brand == brand)
    if supplier_id:
        query = query.filter(InventoryItem.supplier_id == supplier_id)

    rows = query.order_by(InventoryItem.name.asc()).limit(limit).all()
    print_map = _last_print_map(db, entity_type="inventory_item", label_types=["Product"])

    payload = []
    for row in rows:
        status = _stock_status(row)
        if stock_status and stock_status.lower() not in {"all", ""} and status.lower().replace(" ", "_") != stock_status.lower().replace(" ", "_"):
            continue
        last_print = print_map.get(row.id)
        if unlabelled_only and last_print:
            continue
        payload.append(
            {
                "id": row.id,
                "name": row.name,
                "sku": row.sku,
                "barcode": row.barcode or row.sku,
                "category": row.category,
                "brand": row.brand,
                "model": row.model,
                "supplier_id": row.supplier_id,
                "supplier_name": row.supplier.name if row.supplier else None,
                "sale_price": float(row.sale_price or 0),
                "cost_price": float(row.cost_price or 0),
                "quantity": int(row.quantity or 0),
                "stock_status": status,
                "warranty_days": int(row.warranty_days or 0),
                "product_type": row.product_type,
                "location": row.location,
                "has_label_printed": bool(last_print),
                "last_printed_at": last_print.completed_at.isoformat() if last_print and last_print.completed_at else (last_print.created_at.isoformat() if last_print and last_print.created_at else None),
                "last_template": last_print.template_name if last_print else None,
                "last_printed_by": _serialize_user(last_print.generated_by) if last_print else None,
                "print_qty_suggestion": max(1, int(row.quantity or 1)),
            }
        )
    return payload


@router.get("/repairs", dependencies=[Depends(require_permission("labels.view"))])
def list_repair_labels(
    q: str | None = Query(default=None),
    technician: str | None = Query(default=None),
    status: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    unlabelled_only: bool = Query(default=False),
    limit: int = Query(default=500, ge=1, le=3000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ensure_label_defaults(db)
    query = db.query(RepairTicket).options(joinedload(RepairTicket.customer))
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(
                RepairTicket.ticket_no.ilike(like),
                RepairTicket.device_model.ilike(like),
                RepairTicket.imei.ilike(like),
                RepairTicket.technician.ilike(like),
            )
        )
    if technician and technician.lower() != "all":
        query = query.filter(RepairTicket.technician == technician)
    if status and status.lower() != "all":
        query = query.filter(RepairTicket.status == status)
    start = _parse_date(date_from)
    end = _parse_date(date_to, end_exclusive=True)
    if start:
        query = query.filter(RepairTicket.created_at >= start)
    if end:
        query = query.filter(RepairTicket.created_at < end)
    rows = query.order_by(RepairTicket.created_at.desc()).limit(limit).all()
    print_map = _last_print_map(db, entity_type="repair_ticket", label_types=["Repair Job"])

    payload = []
    for row in rows:
        last_print = print_map.get(row.id)
        if unlabelled_only and last_print:
            continue
        payload.append(
            {
                "id": row.id,
                "job_id": row.ticket_no,
                "customer_name": row.customer.name if row.customer else "Walk-in",
                "customer_phone": row.customer.phone if row.customer else None,
                "device_model": row.device_model,
                "imei": row.imei,
                "issue": row.issue,
                "status": row.status,
                "priority": row.priority,
                "technician": row.technician,
                "received_at": row.created_at.isoformat() if row.created_at else None,
                "estimated_completion": row.estimated_completion.isoformat() if row.estimated_completion else None,
                "has_label_printed": bool(last_print),
                "last_printed_at": last_print.completed_at.isoformat() if last_print and last_print.completed_at else (last_print.created_at.isoformat() if last_print and last_print.created_at else None),
                "last_template": last_print.template_name if last_print else None,
                "last_printed_by": _serialize_user(last_print.generated_by) if last_print else None,
            }
        )
    return payload


@router.get("/spare-parts", dependencies=[Depends(require_permission("labels.view"))])
def list_spare_part_labels(
    q: str | None = Query(default=None),
    category: str | None = Query(default=None),
    brand: str | None = Query(default=None),
    supplier_id: int | None = Query(default=None),
    unlabelled_only: bool = Query(default=False),
    limit: int = Query(default=1000, ge=1, le=5000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ensure_label_defaults(db)
    rows = (
        db.query(InventoryItem)
        .options(joinedload(InventoryItem.supplier))
        .order_by(InventoryItem.name.asc())
        .limit(limit)
        .all()
    )
    print_map = _last_print_map(db, entity_type="inventory_item", label_types=["Spare Part"])
    payload = []
    q_lower = (q or "").strip().lower()
    for row in rows:
        if not _is_spare_part(row):
            continue
        if category and category.lower() != "all" and row.category != category:
            continue
        if brand and brand.lower() != "all" and row.brand != brand:
            continue
        if supplier_id and row.supplier_id != supplier_id:
            continue
        if q_lower and q_lower not in " ".join(
            [
                str(row.name or "").lower(),
                str(row.sku or "").lower(),
                str(row.barcode or "").lower(),
                str(row.model or "").lower(),
            ]
        ):
            continue
        last_print = print_map.get(row.id)
        if unlabelled_only and last_print:
            continue
        payload.append(
            {
                "id": row.id,
                "part_name": row.name,
                "sku": row.sku,
                "barcode": row.barcode or row.sku,
                "category": row.category,
                "brand": row.brand,
                "compatible_models": row.model,
                "supplier_name": row.supplier.name if row.supplier else None,
                "cost_price": float(row.cost_price or 0),
                "quantity": int(row.quantity or 0),
                "location": row.location,
                "condition": row.condition or "New",
                "has_label_printed": bool(last_print),
                "last_printed_at": last_print.completed_at.isoformat() if last_print and last_print.completed_at else (last_print.created_at.isoformat() if last_print and last_print.created_at else None),
                "last_template": last_print.template_name if last_print else None,
            }
        )
    return payload


@router.get("/assets", dependencies=[Depends(require_permission("labels.view"))])
def list_label_assets(
    q: str | None = Query(default=None),
    asset_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=3000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ensure_label_defaults(db)
    query = db.query(LabelAsset)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(
                LabelAsset.asset_code.ilike(like),
                LabelAsset.asset_name.ilike(like),
                LabelAsset.barcode_value.ilike(like),
                LabelAsset.location.ilike(like),
            )
        )
    if asset_type and asset_type.lower() != "all":
        query = query.filter(LabelAsset.asset_type == asset_type)
    if status and status.lower() != "all":
        query = query.filter(LabelAsset.status == status)
    rows = query.order_by(LabelAsset.created_at.desc()).limit(limit).all()
    return [_serialize_asset(row) for row in rows]


@router.post("/assets", dependencies=[Depends(require_permission("labels.create"))])
def create_label_asset(
    payload: LabelAssetIn,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ensure_label_defaults(db)
    asset = LabelAsset(**payload.model_dump())
    db.add(asset)
    db.flush()
    asset.asset_code = f"AST-{asset.id:06d}"
    asset.barcode_value = normalize_barcode(payload.barcode_value) or generate_barcode_from_seed(asset.asset_code)
    if not validate_barcode(asset.barcode_value):
        raise HTTPException(status_code=400, detail="Invalid barcode value")
    duplicate = (
        db.query(LabelAsset)
        .filter(LabelAsset.barcode_value == asset.barcode_value, LabelAsset.id != asset.id)
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=400, detail="Duplicate barcode detected for asset")
    if not asset.qr_value:
        asset.qr_value = asset.asset_code
    db.commit()
    db.refresh(asset)
    return _serialize_asset(asset)


@router.put("/assets/{asset_id}", dependencies=[Depends(require_permission("labels.edit"))])
def update_label_asset(
    asset_id: int,
    payload: LabelAssetIn,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(LabelAsset).filter(LabelAsset.id == asset_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Asset not found")
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    row.barcode_value = normalize_barcode(row.barcode_value) or generate_barcode_from_seed(row.asset_code)
    if not validate_barcode(row.barcode_value):
        raise HTTPException(status_code=400, detail="Invalid barcode value")
    duplicate = (
        db.query(LabelAsset)
        .filter(LabelAsset.barcode_value == row.barcode_value, LabelAsset.id != row.id)
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=400, detail="Duplicate barcode detected for asset")
    db.commit()
    db.refresh(row)
    return _serialize_asset(row)


@router.delete("/assets/{asset_id}", dependencies=[Depends(require_permission("labels.delete"))])
def delete_label_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(LabelAsset).filter(LabelAsset.id == asset_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Asset not found")
    row.status = "Archived"
    row.updated_at = utcnow()
    db.commit()
    return {"ok": True}


@router.get("/templates", dependencies=[Depends(require_permission("labels.view"))])
def list_label_templates(
    scope: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ensure_label_defaults(db)
    query = db.query(LabelTemplate).options(joinedload(LabelTemplate.created_by)).filter(LabelTemplate.is_active == True)  # noqa: E712
    if scope and scope.lower() != "all":
        query = query.filter(LabelTemplate.label_scope == scope)
    rows = query.order_by(LabelTemplate.label_scope.asc(), LabelTemplate.name.asc()).all()
    return [_serialize_template(row) for row in rows]


@router.post("/templates", dependencies=[Depends(require_permission("labels.design"))])
def create_label_template(
    payload: LabelTemplateIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ensure_label_defaults(db)
    if payload.label_scope not in LABEL_SCOPES:
        raise HTTPException(status_code=400, detail="Invalid template scope")
    exists = db.query(LabelTemplate).filter(LabelTemplate.name == payload.name).first()
    if exists:
        raise HTTPException(status_code=400, detail="Template name already exists")
    row = LabelTemplate(
        name=payload.name.strip(),
        label_scope=payload.label_scope,
        width_mm=max(10, int(payload.width_mm)),
        height_mm=max(10, int(payload.height_mm)),
        canvas_json=safe_json_dumps(payload.canvas or {}),
        is_default=bool(payload.is_default),
        is_active=bool(payload.is_active),
        is_builtin=False,
        created_by_user_id=current_user.id if current_user else None,
    )
    if row.is_default:
        db.query(LabelTemplate).filter(LabelTemplate.label_scope == payload.label_scope).update({LabelTemplate.is_default: False})
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize_template(row)


@router.put("/templates/{template_id}", dependencies=[Depends(require_permission("labels.design"))])
def update_label_template(
    template_id: int,
    payload: LabelTemplateIn,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(LabelTemplate).filter(LabelTemplate.id == template_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    if payload.label_scope not in LABEL_SCOPES:
        raise HTTPException(status_code=400, detail="Invalid template scope")
    duplicate = db.query(LabelTemplate).filter(LabelTemplate.name == payload.name, LabelTemplate.id != row.id).first()
    if duplicate:
        raise HTTPException(status_code=400, detail="Template name already exists")
    if payload.is_default:
        db.query(LabelTemplate).filter(LabelTemplate.label_scope == payload.label_scope, LabelTemplate.id != row.id).update({LabelTemplate.is_default: False})
    row.name = payload.name.strip()
    row.label_scope = payload.label_scope
    row.width_mm = max(10, int(payload.width_mm))
    row.height_mm = max(10, int(payload.height_mm))
    row.canvas_json = safe_json_dumps(payload.canvas or {})
    row.is_default = bool(payload.is_default)
    row.is_active = bool(payload.is_active)
    db.commit()
    db.refresh(row)
    return _serialize_template(row)


@router.delete("/templates/{template_id}", dependencies=[Depends(require_permission("labels.design"))])
def delete_label_template(
    template_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(LabelTemplate).filter(LabelTemplate.id == template_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    if row.is_builtin:
        raise HTTPException(status_code=400, detail="Built-in template cannot be deleted")
    was_default = bool(row.is_default)
    scope = row.label_scope
    row.is_active = False
    row.is_default = False
    row.updated_at = utcnow()
    db.commit()
    if was_default:
        fallback = (
            db.query(LabelTemplate)
            .filter(LabelTemplate.label_scope == scope, LabelTemplate.is_active == True)
            .order_by(LabelTemplate.id.asc())
            .first()
        )
        if fallback:
            fallback.is_default = True
            db.commit()
    return {"ok": True}


@router.post("/templates/{template_id}/duplicate", dependencies=[Depends(require_permission("labels.design"))])
def duplicate_label_template(
    template_id: int,
    payload: LabelTemplateDuplicateIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.query(LabelTemplate).filter(LabelTemplate.id == template_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    exists = db.query(LabelTemplate).filter(LabelTemplate.name == payload.name).first()
    if exists:
        raise HTTPException(status_code=400, detail="Template name already exists")
    copied = LabelTemplate(
        name=payload.name.strip(),
        label_scope=row.label_scope,
        width_mm=row.width_mm,
        height_mm=row.height_mm,
        canvas_json=row.canvas_json,
        is_default=False,
        is_builtin=False,
        is_active=True,
        created_by_user_id=current_user.id if current_user else None,
    )
    db.add(copied)
    db.commit()
    db.refresh(copied)
    return _serialize_template(copied)


@router.get("/templates/{template_id}/export", dependencies=[Depends(require_permission("labels.export"))])
def export_label_template(
    template_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(LabelTemplate).filter(LabelTemplate.id == template_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"template": _serialize_template(row)}


@router.post("/queue", dependencies=[Depends(require_permission("labels.print"))])
def add_print_queue_items(
    payload: LabelQueueBatchIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ensure_label_defaults(db)
    preferences = _get_setting_json(db, "labels_preferences", {"max_queue_size": 1000})
    max_queue_size = int(preferences.get("max_queue_size") or 1000)
    waiting_count = db.query(LabelPrintJob).filter(LabelPrintJob.status.in_(["Waiting", "Printing", "Paused"])).count()
    if waiting_count + len(payload.items) > max_queue_size:
        raise HTTPException(status_code=400, detail=f"Queue limit exceeded. Max queue size is {max_queue_size}.")

    created_rows: list[LabelPrintJob] = []
    for item in payload.items:
        resolved_scope = item.label_type if item.label_type in LABEL_SCOPES else "Product"
        template_name = item.template_name
        template_id = item.template_id
        if not template_id:
            default_template = (
                db.query(LabelTemplate)
                .filter(
                    LabelTemplate.label_scope == resolved_scope,
                    LabelTemplate.is_default == True,
                    LabelTemplate.is_active == True,
                )
                .first()
            )
            if default_template:
                template_id = default_template.id
                template_name = default_template.name
        row = LabelPrintJob(
            label_type=resolved_scope,
            entity_type=item.entity_type,
            entity_id=item.entity_id,
            entity_ref=item.entity_ref,
            item_name=item.item_name,
            qty=max(1, int(item.qty or 1)),
            template_id=template_id,
            template_name=template_name,
            barcode_format=item.barcode_format,
            printer_name=item.printer_name,
            paper_type=item.paper_type,
            print_quality=item.print_quality,
            orientation=item.orientation,
            status=item.status if item.status in LABEL_QUEUE_STATUSES else "Waiting",
            priority=max(1, int(item.priority or 100)),
            is_reprint=bool(item.is_reprint),
            reprint_reason=item.reprint_reason,
            generated_by_user_id=current_user.id if current_user else None,
            metadata_json=safe_json_dumps(item.metadata or {}),
        )
        db.add(row)
        db.flush()
        row.job_code = f"LBLJOB-{row.id:07d}"
        created_rows.append(row)
    db.commit()
    for row in created_rows:
        db.refresh(row)
    return [_serialize_job(row) for row in created_rows]


@router.get("/queue", dependencies=[Depends(require_permission("labels.view"))])
def list_print_queue(
    status: str | None = Query(default=None),
    label_type: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=1000, ge=1, le=5000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ensure_label_defaults(db)
    query = db.query(LabelPrintJob).options(joinedload(LabelPrintJob.generated_by), joinedload(LabelPrintJob.template))
    if status and status.lower() != "all":
        query = query.filter(LabelPrintJob.status == status)
    else:
        query = query.filter(LabelPrintJob.status != "Archived")
    if label_type and label_type.lower() != "all":
        query = query.filter(LabelPrintJob.label_type == label_type)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(
                LabelPrintJob.job_code.ilike(like),
                LabelPrintJob.item_name.ilike(like),
                LabelPrintJob.entity_ref.ilike(like),
                LabelPrintJob.template_name.ilike(like),
                LabelPrintJob.printer_name.ilike(like),
            )
        )
    rows = (
        query.order_by(
            LabelPrintJob.priority.asc(),
            LabelPrintJob.created_at.asc(),
        )
        .limit(limit)
        .all()
    )
    return [_serialize_job(row) for row in rows]


@router.get("/print-document", dependencies=[Depends(require_permission("labels.print"))], response_class=HTMLResponse)
def print_label_document(
    document_type: str = Query(default="barcode_sheet"),
    reference: str | None = Query(default=None),
    paper: str = Query(default="label_50x30"),
    limit: int = Query(default=32, ge=1, le=100),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ensure_label_defaults(db)
    doc_key = str(document_type or "barcode_sheet").strip().lower()
    labels: list[dict] = []

    if doc_key == "product_label":
        token = str(reference or "").strip()
        if not token:
            raise HTTPException(status_code=400, detail="Product ID, SKU, or barcode is required for product labels")
        query = db.query(InventoryItem).filter(InventoryItem.is_deleted == False)  # noqa: E712
        if token.isdigit():
            query = query.filter(InventoryItem.id == int(token))
        else:
            query = query.filter(or_(InventoryItem.sku == token, InventoryItem.barcode == token))
        row = query.first()
        if not row:
            raise HTTPException(status_code=404, detail="Product not found for label")
        labels.append(
            {
                "name": row.name,
                "sku": row.sku,
                "barcode": row.barcode or row.sku,
                "subtitle": f"{row.brand or row.category or 'Product'} / LKR {float(row.sale_price or 0):,.2f}",
            }
        )
    else:
        query = db.query(LabelPrintJob).filter(LabelPrintJob.status != "Archived")
        token = str(reference or "").strip()
        if token:
            id_filter = LabelPrintJob.id == int(token) if token.isdigit() else False
            query = query.filter(
                or_(
                    LabelPrintJob.job_code == token,
                    LabelPrintJob.entity_ref == token,
                    id_filter,
                )
            )
        rows = (
            query.order_by(LabelPrintJob.priority.asc(), LabelPrintJob.created_at.asc())
            .limit(int(limit))
            .all()
        )
        for row in rows:
            metadata = safe_json_loads(row.metadata_json, {})
            template_name = row.template_name or (row.template.name if row.template else None) or "Default"
            qty = min(max(1, int(row.qty or 1)), 20)
            for _idx in range(qty):
                labels.append(
                    {
                        "name": row.item_name,
                        "entity_ref": row.entity_ref,
                        "job_code": row.job_code,
                        "barcode": metadata.get("barcode") or row.entity_ref or row.job_code,
                        "subtitle": f"{row.label_type or 'Label'} / {template_name}",
                    }
                )
                if len(labels) >= int(limit):
                    break
            if len(labels) >= int(limit):
                break

    store = get_store_profile_print_data(db)
    title = "Product Label" if doc_key == "product_label" else "Barcode Sheet"
    return HTMLResponse(render_label_sheet_html(labels, store, paper=paper, title=title))


@router.put("/queue/{job_id}/status", dependencies=[Depends(require_permission("labels.print"))])
def update_queue_item_status(
    job_id: int,
    payload: LabelQueueStatusUpdateIn,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(LabelPrintJob).filter(LabelPrintJob.id == job_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Queue item not found")
    if payload.status not in LABEL_QUEUE_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid queue status")
    row.status = payload.status
    if payload.priority is not None:
        row.priority = max(1, int(payload.priority))
    if payload.error_message is not None:
        row.error_message = payload.error_message
    if payload.status == "Completed":
        row.completed_at = utcnow()
    db.commit()
    db.refresh(row)
    return _serialize_job(row)


@router.post("/queue/{job_id}/print-now", dependencies=[Depends(require_permission("labels.print"))])
def print_queue_item_now(
    job_id: int,
    payload: LabelPrintNowIn,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    row = db.query(LabelPrintJob).filter(LabelPrintJob.id == job_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Queue item not found")
    row.status = "Printing"
    row.error_message = None
    if payload.mark_completed:
        row.status = "Completed"
        row.completed_at = utcnow()
    db.commit()
    db.refresh(row)
    return _serialize_job(row)


@router.post("/queue/reorder", dependencies=[Depends(require_permission("labels.print"))])
def reorder_queue(
    payload: LabelQueueReorderIn,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    if not payload.ordered_job_ids:
        return {"ok": True, "updated": 0}
    rows = db.query(LabelPrintJob).filter(LabelPrintJob.id.in_(payload.ordered_job_ids)).all()
    row_map = {row.id: row for row in rows}
    for idx, job_id in enumerate(payload.ordered_job_ids, start=1):
        row = row_map.get(job_id)
        if row:
            row.priority = idx
    db.commit()
    return {"ok": True, "updated": len(rows)}


@router.post("/queue/clear-completed", dependencies=[Depends(require_permission("labels.delete"))])
def clear_completed_queue(
    limit: int = Query(default=1000, ge=1, le=5000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    rows = (
        db.query(LabelPrintJob)
        .filter(LabelPrintJob.status.in_(["Completed", "Cancelled"]))
        .order_by(LabelPrintJob.updated_at.asc(), LabelPrintJob.created_at.asc())
        .limit(int(limit))
        .all()
    )
    count = len(rows)
    for row in rows:
        row.status = "Archived"
        row.updated_at = utcnow()
    db.commit()
    return {"ok": True, "archived": count}


@router.post("/queue/retry-failed", dependencies=[Depends(require_permission("labels.print"))])
def retry_failed_queue(
    limit: int = Query(default=1000, ge=1, le=5000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    rows = (
        db.query(LabelPrintJob)
        .filter(LabelPrintJob.status == "Failed")
        .order_by(LabelPrintJob.updated_at.asc(), LabelPrintJob.created_at.asc())
        .limit(int(limit))
        .all()
    )
    for row in rows:
        row.status = "Waiting"
        row.error_message = None
    db.commit()
    return {"ok": True, "updated": len(rows)}


@router.get("/printers", dependencies=[Depends(require_permission("labels.view"))])
def list_printers(
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ensure_label_defaults(db)
    return _get_setting_json(db, "labels_printers", [])


@router.put("/printers", dependencies=[Depends(require_permission("labels.edit"))])
def update_printers(
    payload: list[dict],
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    sanitized = []
    for row in payload:
        status = row.get("status") if row.get("status") in PRINTER_STATUSES else "Offline"
        sanitized.append(
            {
                "name": str(row.get("name") or "Printer"),
                "model": str(row.get("model") or ""),
                "status": status,
                "paper_type": str(row.get("paper_type") or "Label Roll"),
                "is_default": bool(row.get("is_default")),
            }
        )
    if sanitized and not any(r["is_default"] for r in sanitized):
        sanitized[0]["is_default"] = True
    _set_setting_json(db, "labels_printers", sanitized)
    return sanitized


@router.get("/history", dependencies=[Depends(require_permission("labels.view"))])
def label_history(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    label_type: str | None = Query(default=None),
    staff_id: int | None = Query(default=None),
    template_name: str | None = Query(default=None),
    printer_name: str | None = Query(default=None),
    status: str | None = Query(default=None),
    reprint_only: bool = Query(default=False),
    q: str | None = Query(default=None),
    limit: int = Query(default=2000, ge=1, le=10000),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ensure_label_defaults(db)
    query = db.query(LabelPrintJob).options(joinedload(LabelPrintJob.generated_by), joinedload(LabelPrintJob.template))
    start = _parse_date(date_from)
    end = _parse_date(date_to, end_exclusive=True)
    if start:
        query = query.filter(LabelPrintJob.created_at >= start)
    if end:
        query = query.filter(LabelPrintJob.created_at < end)
    if label_type and label_type.lower() != "all":
        query = query.filter(LabelPrintJob.label_type == label_type)
    if staff_id:
        query = query.filter(LabelPrintJob.generated_by_user_id == staff_id)
    if template_name and template_name.lower() != "all":
        query = query.filter(LabelPrintJob.template_name == template_name)
    if printer_name and printer_name.lower() != "all":
        query = query.filter(LabelPrintJob.printer_name == printer_name)
    if status and status.lower() != "all":
        query = query.filter(LabelPrintJob.status == status)
    if reprint_only:
        query = query.filter(LabelPrintJob.is_reprint == True)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(
                LabelPrintJob.job_code.ilike(like),
                LabelPrintJob.item_name.ilike(like),
                LabelPrintJob.entity_ref.ilike(like),
            )
        )

    rows = query.order_by(LabelPrintJob.created_at.desc()).limit(limit).all()
    serialized = [_serialize_job(row) for row in rows]

    reprint_map: dict[str, int] = {}
    staff_map: dict[str, int] = {}
    for row in rows:
        if row.is_reprint:
            key = row.entity_ref or row.item_name or "-"
            reprint_map[key] = reprint_map.get(key, 0) + 1
        staff_key = _serialize_user(row.generated_by) or "Unknown"
        staff_map[staff_key] = staff_map.get(staff_key, 0) + 1

    return {
        "kpis": {
            "total_labels_printed_month": len([r for r in rows if r.status == "Completed"]),
            "total_reprints_month": len([r for r in rows if r.is_reprint]),
            "print_jobs_today": len([r for r in rows if r.created_at and r.created_at >= utcnow().replace(hour=0, minute=0, second=0, microsecond=0)]),
            "failed_print_jobs": len([r for r in rows if r.status == "Failed"]),
            "most_active_printer": max(
                ({p: len([r for r in rows if r.printer_name == p]) for p in {r.printer_name for r in rows if r.printer_name}} or {"-": 0}).items(),
                key=lambda x: x[1],
            )[0],
        },
        "rows": serialized,
        "reprint_analysis": [{"item": k, "count": v} for k, v in sorted(reprint_map.items(), key=lambda x: x[1], reverse=True)],
        "staff_reprint_count": [{"staff": k, "count": v} for k, v in sorted(staff_map.items(), key=lambda x: x[1], reverse=True)],
    }


@router.post("/history/{job_id}/reprint", dependencies=[Depends(require_permission("labels.print"))])
def reprint_history_item(
    job_id: int,
    payload: LabelReprintIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    source = db.query(LabelPrintJob).filter(LabelPrintJob.id == job_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Print record not found")
    qty = max(1, int(payload.qty or source.qty or 1))
    cloned = LabelPrintJob(
        label_type=source.label_type,
        entity_type=source.entity_type,
        entity_id=source.entity_id,
        entity_ref=source.entity_ref,
        item_name=source.item_name,
        qty=qty,
        template_id=source.template_id,
        template_name=source.template_name,
        barcode_format=source.barcode_format,
        printer_name=payload.printer_name or source.printer_name,
        paper_type=source.paper_type,
        print_quality=source.print_quality,
        orientation=source.orientation,
        status="Waiting",
        priority=1,
        is_reprint=True,
        reprint_reason=payload.reason or "Manual reprint",
        generated_by_user_id=current_user.id if current_user else None,
        metadata_json=source.metadata_json,
    )
    db.add(cloned)
    db.flush()
    cloned.job_code = f"LBLJOB-{cloned.id:07d}"
    db.commit()
    db.refresh(cloned)
    return _serialize_job(cloned)


@router.post("/scanner/scan", dependencies=[Depends(require_permission("labels.view"))])
def scanner_lookup(
    payload: LabelScanIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ensure_label_defaults(db)
    raw = payload.value.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Barcode value is required")
    normalized = normalize_barcode(raw)

    result_type = "Unknown"
    result_id = None
    result_ref = None
    result_summary = None
    data = None

    product = (
        db.query(InventoryItem)
        .filter(or_(InventoryItem.barcode == normalized, InventoryItem.sku == normalized))
        .first()
    )
    if product:
        is_part = _is_spare_part(product)
        result_type = "Part" if is_part else "Product"
        result_id = product.id
        result_ref = product.sku
        result_summary = product.name
        data = {
            "id": product.id,
            "item_type": result_type,
            "name": product.name,
            "sku": product.sku,
            "barcode": product.barcode or product.sku,
            "price": float(product.sale_price or 0),
            "stock_qty": int(product.quantity or 0),
            "category": product.category,
            "brand": product.brand,
            "location": product.location,
            "quick_actions": ["Edit Product", "Print Label", "View Movements"],
        }
    if not data:
        repair = (
            db.query(RepairTicket)
            .options(joinedload(RepairTicket.customer))
            .filter(or_(RepairTicket.ticket_no == raw, RepairTicket.ticket_no == normalized))
            .first()
        )
        if not repair and raw.isdigit():
            repair = db.query(RepairTicket).options(joinedload(RepairTicket.customer)).filter(RepairTicket.id == int(raw)).first()
        if repair:
            result_type = "Repair Job"
            result_id = repair.id
            result_ref = repair.ticket_no
            result_summary = repair.device_model
            data = {
                "id": repair.id,
                "item_type": "Repair Job",
                "job_id": repair.ticket_no,
                "customer": repair.customer.name if repair.customer else "Walk-in",
                "phone": repair.customer.phone if repair.customer else None,
                "device": repair.device_model,
                "technician": repair.technician,
                "status": repair.status,
                "estimated_completion": repair.estimated_completion.isoformat() if repair.estimated_completion else None,
                "quick_actions": ["Update Status", "Print Job Label", "View Job Detail"],
            }
    if not data:
        asset = (
            db.query(LabelAsset)
            .filter(or_(LabelAsset.barcode_value == normalized, LabelAsset.asset_code == normalized))
            .first()
        )
        if asset:
            result_type = "Asset"
            result_id = asset.id
            result_ref = asset.asset_code
            result_summary = asset.asset_name
            data = {
                "id": asset.id,
                "item_type": "Asset",
                "asset_code": asset.asset_code,
                "name": asset.asset_name,
                "assigned_to": asset.assigned_to,
                "location": asset.location,
                "status": asset.status,
                "quick_actions": ["View Asset", "Print Asset Label"],
            }
    if not data:
        customer = (
            db.query(Customer)
            .filter(or_(Customer.phone == raw, Customer.phone == normalized, Customer.phone.ilike(f"%{raw}%")))
            .first()
        )
        if customer:
            result_type = "Customer"
            result_id = customer.id
            result_ref = f"CUS-{customer.id:05d}"
            result_summary = customer.name
            data = {
                "id": customer.id,
                "item_type": "Customer",
                "name": customer.name,
                "phone": customer.phone,
                "quick_actions": ["Open Customer", "Collect Payment", "View History"],
            }

    if not data:
        data = {
            "item_type": "Unknown",
            "raw": raw,
            "quick_actions": ["Try manual search", "Create custom label"],
        }

    scan_row = LabelScanLog(
        barcode_value=normalized,
        scan_mode=payload.scan_mode,
        scanned_type=result_type,
        result_ref=result_ref,
        result_id=result_id,
        result_summary=result_summary,
        scanned_by_user_id=current_user.id if current_user else None,
    )
    db.add(scan_row)
    db.commit()
    db.refresh(scan_row)

    return {
        "scan": {
            "id": scan_row.id,
            "barcode_value": scan_row.barcode_value,
            "scan_mode": scan_row.scan_mode,
            "scanned_type": scan_row.scanned_type,
            "result_ref": scan_row.result_ref,
            "result_id": scan_row.result_id,
            "result_summary": scan_row.result_summary,
            "scanned_by": _serialize_user(scan_row.scanned_by),
            "created_at": scan_row.created_at.isoformat() if scan_row.created_at else None,
        },
        "data": data,
    }


@router.get("/scanner/history", dependencies=[Depends(require_permission("labels.view"))])
def scanner_history(
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    rows = (
        db.query(LabelScanLog)
        .options(joinedload(LabelScanLog.scanned_by))
        .order_by(LabelScanLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": row.id,
            "timestamp": row.created_at.isoformat() if row.created_at else None,
            "barcode_value": row.barcode_value,
            "scan_mode": row.scan_mode,
            "scanned_type": row.scanned_type,
            "result_ref": row.result_ref,
            "result_id": row.result_id,
            "result_summary": row.result_summary,
            "user": _serialize_user(row.scanned_by),
        }
        for row in rows
    ]


@router.get("/state", dependencies=[Depends(require_permission("labels.view"))])
def labels_state(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    meta = labels_meta(db=db, _=_)
    dashboard = labels_dashboard(date_from=date_from, date_to=date_to, db=db, _=_)
    queue_rows = list_print_queue(status="all", label_type="all", q=None, limit=500, db=db, _=_)
    history = label_history(
        date_from=date_from,
        date_to=date_to,
        label_type=None,
        staff_id=None,
        template_name=None,
        printer_name=None,
        status=None,
        reprint_only=False,
        q=None,
        limit=500,
        db=db,
        _=_,
    )
    return {
        "meta": meta,
        "dashboard": dashboard,
        "queue": queue_rows,
        "history": history,
    }
