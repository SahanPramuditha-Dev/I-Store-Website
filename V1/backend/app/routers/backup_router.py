import csv
import io
import json
import math
import re
import uuid
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape as xml_escape

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_permission
from app.config import settings
from app.database import get_db
from app.models import (
    ActivityLog,
    AppSetting,
    BackupRecord,
    Customer,
    Expense,
    InventoryItem,
    RepairTicket,
    RestoreApproval,
    RestoreAuditEvent,
    RestoreRequest,
    Sale,
    Supplier,
    User,
)
from app.services.activity_service import log_activity
from app.services.backup_service import create_backup, list_backup_filenames, restore_backup
from app.utils.time import utcnow

router = APIRouter(prefix="/backup", tags=["backup"])

LEGACY_RESTORE_REQUESTS_KEY = "backup_restore_requests_v1"
LEGACY_RESTORE_MIGRATED_KEY = "backup_restore_requests_migrated_v1"
EXPORT_HISTORY_KEY = "export_center_history"
RESTORE_STATUS_LABELS = {
    "pending_approval": "Pending Approval",
    "approved": "Approved",
    "rejected": "Rejected",
    "executed": "Executed",
    "failed": "Failed",
}


class BackupExportRequest(BaseModel):
    format: str = "CSV"  # CSV | Excel | JSON
    products_inventory: bool = True
    customers: bool = True
    suppliers: bool = True
    sales_invoices: bool = True
    repair_jobs: bool = True
    expenses: bool = True
    audit_logs: bool = True


class RestoreRequestCreateIn(BaseModel):
    filename: str
    reason: str = ""


class RestoreRequestDecisionIn(BaseModel):
    note: str = ""


class BackupCleanupIn(BaseModel):
    dry_run: bool = True
    targets: list[str] | None = None
    keep_latest_verified: bool = True


def _now_iso() -> str:
    return utcnow().isoformat()


def _role_level(role: str | None) -> int:
    name = str(role or "").strip().lower()
    mapping = {
        "owner": 5,
        "admin": 4,
        "manager": 3,
        "technician": 2,
        "cashier / staff": 1,
        "cashier": 1,
        "staff": 1,
        "employee": 1,
        "view only": 0,
        "viewer": 0,
    }
    return mapping.get(name, 1)


def _can_approve_restore(user: User) -> bool:
    return _role_level(user.role) >= 3


def _can_execute_restore(user: User) -> bool:
    return _role_level(user.role) >= 4


def _require_owner(user: User) -> None:
    if _role_level(user.role) < 5:
        raise HTTPException(status_code=403, detail="Owner authorization is required for this operation")


def _status_label(status_value: str | None) -> str:
    key = str(status_value or "").strip().lower()
    return RESTORE_STATUS_LABELS.get(key, "Pending Approval")


def _status_value(label_or_value: str | None) -> str:
    key = str(label_or_value or "").strip().lower().replace("-", " ").replace("_", " ")
    by_label = {
        "pending approval": "pending_approval",
        "approved": "approved",
        "rejected": "rejected",
        "executed": "executed",
        "failed": "failed",
    }
    return by_label.get(key, key.replace(" ", "_"))


def _parse_iso_datetime(value: str | None) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = raw[:-1]
    try:
        return datetime.fromisoformat(raw)
    except Exception:
        return None


def _actor_name(user: User | None, fallback: str | None = None) -> str | None:
    if user:
        return user.full_name or user.username
    return fallback


def _upsert_setting(db: Session, key: str, value: str) -> None:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=key, value=value))


def _record_restore_event(
    db: Session,
    *,
    restore_request_id: int,
    event_type: str,
    actor_user_id: int | None = None,
    event_status: str = "success",
    detail: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    db.add(
        RestoreAuditEvent(
            restore_request_id=restore_request_id,
            event_type=event_type,
            event_status=event_status,
            actor_user_id=actor_user_id,
            detail=detail,
            metadata_json=(json.dumps(metadata, ensure_ascii=False) if metadata else None),
        )
    )


def _migrate_legacy_restore_requests_to_tables(db: Session) -> None:
    marker = db.query(AppSetting).filter(AppSetting.key == LEGACY_RESTORE_MIGRATED_KEY).first()
    if marker and str(marker.value or "") == "1":
        return

    legacy_row = db.query(AppSetting).filter(AppSetting.key == LEGACY_RESTORE_REQUESTS_KEY).first()
    if not legacy_row or not legacy_row.value:
        _upsert_setting(db, LEGACY_RESTORE_MIGRATED_KEY, "1")
        db.commit()
        return

    try:
        payload = json.loads(legacy_row.value)
    except Exception:
        payload = []
    if not isinstance(payload, list):
        payload = []

    fallback_user = db.query(User).order_by(User.id.asc()).first()
    fallback_user_id = fallback_user.id if fallback_user else None

    for row in payload:
        if not isinstance(row, dict):
            continue
        request_code = str(row.get("request_id") or "").strip()
        filename = str(row.get("filename") or "").strip()
        if not request_code or not filename:
            continue
        exists = db.query(RestoreRequest).filter(RestoreRequest.request_code == request_code).first()
        if exists:
            continue

        requested_by_user_id = row.get("requested_by_user_id") or row.get("approved_by_user_id") or row.get("executed_by_user_id") or fallback_user_id
        if requested_by_user_id is None:
            continue
        requested_by_user_id = int(requested_by_user_id)
        backup_record = _ensure_backup_record(db, filename, requested_by_user_id)
        status = _status_value(row.get("status"))
        req = RestoreRequest(
            request_code=request_code,
            backup_record_id=backup_record.id,
            reason=str(row.get("reason") or "").strip() or None,
            status=status,
            requested_by_user_id=requested_by_user_id,
            requested_at=_parse_iso_datetime(row.get("requested_at")) or utcnow(),
            executed_by_user_id=(int(row["executed_by_user_id"]) if row.get("executed_by_user_id") is not None else None),
            executed_at=_parse_iso_datetime(row.get("executed_at")),
            execution_result=(str(row.get("execution_result")) if row.get("execution_result") is not None else None),
        )
        db.add(req)
        db.flush()

        _record_restore_event(
            db,
            restore_request_id=req.id,
            event_type="request_created",
            actor_user_id=requested_by_user_id,
            detail=req.reason or "Restore request migrated from legacy settings payload",
        )

        approved_by_id = row.get("approved_by_user_id")
        approved_at = _parse_iso_datetime(row.get("approved_at"))
        approval_note = str(row.get("approval_note") or "").strip()
        if approved_by_id is not None:
            db.add(
                RestoreApproval(
                    restore_request_id=req.id,
                    decision="approved",
                    note=approval_note,
                    decided_by_user_id=int(approved_by_id),
                    decided_at=approved_at or utcnow(),
                )
            )
            _record_restore_event(
                db,
                restore_request_id=req.id,
                event_type="approved",
                actor_user_id=int(approved_by_id),
                detail=approval_note or "Approved",
            )

        rejected_by_id = row.get("rejected_by_user_id")
        rejected_at = _parse_iso_datetime(row.get("rejected_at"))
        rejection_note = str(row.get("rejection_note") or "").strip()
        if rejected_by_id is not None:
            db.add(
                RestoreApproval(
                    restore_request_id=req.id,
                    decision="rejected",
                    note=rejection_note,
                    decided_by_user_id=int(rejected_by_id),
                    decided_at=rejected_at or utcnow(),
                )
            )
            _record_restore_event(
                db,
                restore_request_id=req.id,
                event_type="rejected",
                actor_user_id=int(rejected_by_id),
                detail=rejection_note or "Rejected",
            )

        if status == "executed":
            _record_restore_event(
                db,
                restore_request_id=req.id,
                event_type="restore_completed",
                actor_user_id=(req.executed_by_user_id or requested_by_user_id),
                detail=req.execution_result or "Restore executed successfully",
            )
        elif status == "failed":
            _record_restore_event(
                db,
                restore_request_id=req.id,
                event_type="restore_failed",
                actor_user_id=(req.executed_by_user_id or requested_by_user_id),
                event_status="failed",
                detail=req.execution_result or "Restore failed",
            )

    _upsert_setting(db, LEGACY_RESTORE_MIGRATED_KEY, "1")
    _upsert_setting(db, LEGACY_RESTORE_REQUESTS_KEY, "[]")
    db.commit()


def _serialize_restore_request(
    req: RestoreRequest,
    approved: RestoreApproval | None,
    rejected: RestoreApproval | None,
    latest_execution_event: RestoreAuditEvent | None,
) -> dict[str, Any]:
    execution_result = req.execution_result
    restore_output = None
    if latest_execution_event and latest_execution_event.metadata_json:
        try:
            restore_output = json.loads(latest_execution_event.metadata_json)
        except Exception:
            restore_output = None

    if execution_result is None and latest_execution_event is not None:
        execution_result = latest_execution_event.detail

    return {
        "request_id": req.request_code,
        "filename": req.backup_record.filename if req.backup_record else None,
        "reason": req.reason or "",
        "requested_by_user_id": req.requested_by_user_id,
        "requested_by": _actor_name(req.requested_by),
        "requested_at": _now_iso() if req.requested_at is None else req.requested_at.isoformat(),
        "status": _status_label(req.status),
        "approval_note": approved.note if approved else "",
        "approved_by_user_id": approved.decided_by_user_id if approved else None,
        "approved_by": _actor_name(approved.decided_by) if approved else None,
        "approved_at": approved.decided_at.isoformat() if approved and approved.decided_at else None,
        "rejection_note": rejected.note if rejected else "",
        "rejected_by_user_id": rejected.decided_by_user_id if rejected else None,
        "rejected_by": _actor_name(rejected.decided_by) if rejected else None,
        "rejected_at": rejected.decided_at.isoformat() if rejected and rejected.decided_at else None,
        "executed_by_user_id": req.executed_by_user_id,
        "executed_by": _actor_name(req.executed_by),
        "executed_at": req.executed_at.isoformat() if req.executed_at else None,
        "execution_result": execution_result,
        "restore_output": restore_output,
    }


def _load_restore_requests(db: Session) -> list[dict[str, Any]]:
    _migrate_legacy_restore_requests_to_tables(db)
    rows = (
        db.query(RestoreRequest)
        .options(
            joinedload(RestoreRequest.backup_record),
            joinedload(RestoreRequest.requested_by),
            joinedload(RestoreRequest.executed_by),
        )
        .order_by(RestoreRequest.requested_at.desc(), RestoreRequest.id.desc())
        .all()
    )
    if not rows:
        return []

    req_ids = [row.id for row in rows]
    approval_rows = (
        db.query(RestoreApproval)
        .options(joinedload(RestoreApproval.decided_by))
        .filter(RestoreApproval.restore_request_id.in_(req_ids))
        .order_by(RestoreApproval.decided_at.desc(), RestoreApproval.id.desc())
        .all()
    )
    latest_approved: dict[int, RestoreApproval] = {}
    latest_rejected: dict[int, RestoreApproval] = {}
    for row in approval_rows:
        if row.decision == "approved" and row.restore_request_id not in latest_approved:
            latest_approved[row.restore_request_id] = row
        if row.decision == "rejected" and row.restore_request_id not in latest_rejected:
            latest_rejected[row.restore_request_id] = row

    event_rows = (
        db.query(RestoreAuditEvent)
        .filter(
            RestoreAuditEvent.restore_request_id.in_(req_ids),
            RestoreAuditEvent.event_type.in_(["restore_completed", "restore_failed"]),
        )
        .order_by(RestoreAuditEvent.created_at.desc(), RestoreAuditEvent.id.desc())
        .all()
    )
    latest_execution_event: dict[int, RestoreAuditEvent] = {}
    for row in event_rows:
        if row.restore_request_id not in latest_execution_event:
            latest_execution_event[row.restore_request_id] = row

    return [
        _serialize_restore_request(
            req,
            latest_approved.get(req.id),
            latest_rejected.get(req.id),
            latest_execution_event.get(req.id),
        )
        for req in rows
    ]


def _find_restore_request_row(db: Session, request_code: str) -> RestoreRequest | None:
    _migrate_legacy_restore_requests_to_tables(db)
    return (
        db.query(RestoreRequest)
        .options(
            joinedload(RestoreRequest.backup_record),
            joinedload(RestoreRequest.requested_by),
            joinedload(RestoreRequest.executed_by),
        )
        .filter(RestoreRequest.request_code == str(request_code))
        .first()
    )


def _ensure_backup_record(db: Session, filename: str, user_id: int | None) -> BackupRecord:
    row = db.query(BackupRecord).filter(BackupRecord.filename == filename).first()
    if row:
        return row
    backup_code = f"BKP-{uuid.uuid4().hex[:12].upper()}"
    row = BackupRecord(
        backup_code=backup_code,
        filename=filename,
        status="created",
        backup_type="manual",
        storage_target="local",
        created_by_user_id=user_id,
    )
    db.add(row)
    db.flush()
    return row


def _latest_verified_backup_id(db: Session) -> int | None:
    row = (
        db.query(BackupRecord)
        .filter(BackupRecord.status == "verified")
        .order_by(BackupRecord.created_at.desc(), BackupRecord.id.desc())
        .first()
    )
    return int(row.id) if row else None


def _backup_file_exists(filename: str) -> bool:
    try:
        return (Path(settings.backup_folder) / str(filename)).exists()
    except Exception:
        return False


def _cleanup_export_history(db: Session, *, dry_run: bool, keep: int = 200) -> dict[str, Any]:
    row = db.query(AppSetting).filter(AppSetting.key == EXPORT_HISTORY_KEY).first()
    if not row or not row.value:
        return {"checked": 0, "removed": 0}
    try:
        history = json.loads(row.value)
    except Exception:
        history = []
    if not isinstance(history, list):
        history = []
    checked = len(history)
    kept = history[:keep]
    removed = max(0, checked - len(kept))
    if removed and not dry_run:
        row.value = json.dumps(kept, ensure_ascii=False)
    return {"checked": checked, "removed": removed}


def _sanitize_sheet_name(name: str, used: set[str]) -> str:
    cleaned = re.sub(r"[\[\]\*\?/\\:]", "_", str(name or "Sheet")).strip() or "Sheet"
    cleaned = cleaned[:31]
    base = cleaned
    n = 1
    while cleaned in used:
        suffix = f"_{n}"
        cleaned = f"{base[: max(1, 31 - len(suffix))]}{suffix}"
        n += 1
    used.add(cleaned)
    return cleaned


def _excel_col_name(index_zero_based: int) -> str:
    n = index_zero_based + 1
    letters = []
    while n:
        n, rem = divmod(n - 1, 26)
        letters.append(chr(65 + rem))
    return "".join(reversed(letters))


def _is_number(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return False
        return True
    return False


def _cell_xml(cell_ref: str, value: Any) -> str:
    if value is None:
        return f'<c r="{cell_ref}" t="inlineStr"><is><t></t></is></c>'
    if isinstance(value, bool):
        return f'<c r="{cell_ref}" t="b"><v>{1 if value else 0}</v></c>'
    if _is_number(value):
        return f'<c r="{cell_ref}" t="n"><v>{value}</v></c>'

    text = str(value)
    escaped = xml_escape(text)
    if text != text.strip() or "\n" in text or "\t" in text:
        return f'<c r="{cell_ref}" t="inlineStr"><is><t xml:space="preserve">{escaped}</t></is></c>'
    return f'<c r="{cell_ref}" t="inlineStr"><is><t>{escaped}</t></is></c>'


def _sheet_xml(rows: list[dict[str, Any]]) -> str:
    if rows:
        headers = list(rows[0].keys())
        matrix: list[list[Any]] = [headers]
        for row in rows:
            matrix.append([row.get(h, "") for h in headers])
    else:
        matrix = [["No data"], ["-"]]

    parts = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
        "<sheetData>",
    ]
    for r_idx, row_vals in enumerate(matrix, start=1):
        parts.append(f'<row r="{r_idx}">')
        for c_idx, value in enumerate(row_vals):
            cell_ref = f"{_excel_col_name(c_idx)}{r_idx}"
            parts.append(_cell_xml(cell_ref, value))
        parts.append("</row>")
    parts.extend(["</sheetData>", "</worksheet>"])
    return "".join(parts)


def _workbook_xml(sheet_names: list[str]) -> str:
    sheets = []
    for i, name in enumerate(sheet_names, start=1):
        sheets.append(f'<sheet name="{xml_escape(name)}" sheetId="{i}" r:id="rId{i}"/>')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f"<sheets>{''.join(sheets)}</sheets>"
        "</workbook>"
    )


def _workbook_rels_xml(sheet_count: int) -> str:
    rels = []
    for i in range(1, sheet_count + 1):
        rels.append(
            f'<Relationship Id="rId{i}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            f'Target="worksheets/sheet{i}.xml"/>'
        )
    rels.append(
        f'<Relationship Id="rId{sheet_count + 1}" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        'Target="styles.xml"/>'
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f"{''.join(rels)}"
        "</Relationships>"
    )


def _content_types_xml(sheet_count: int) -> str:
    overrides = [
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/xl/styles.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ]
    for i in range(1, sheet_count + 1):
        overrides.append(
            f'<Override PartName="/xl/worksheets/sheet{i}.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        f"{''.join(overrides)}"
        "</Types>"
    )


def _root_rels_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/>'
        "</Relationships>"
    )


def _styles_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        "</styleSheet>"
    )


def _build_xlsx_file(sheets: dict[str, list[dict[str, Any]]]) -> bytes:
    used_names: set[str] = set()
    sheet_pairs = [(_sanitize_sheet_name(name, used_names), rows) for name, rows in sheets.items()]
    if not sheet_pairs:
        sheet_pairs = [("Export", [])]

    mem = io.BytesIO()
    with zipfile.ZipFile(mem, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", _content_types_xml(len(sheet_pairs)))
        zf.writestr("_rels/.rels", _root_rels_xml())
        zf.writestr("xl/workbook.xml", _workbook_xml([name for name, _ in sheet_pairs]))
        zf.writestr("xl/_rels/workbook.xml.rels", _workbook_rels_xml(len(sheet_pairs)))
        zf.writestr("xl/styles.xml", _styles_xml())
        for i, (_, rows) in enumerate(sheet_pairs, start=1):
            zf.writestr(f"xl/worksheets/sheet{i}.xml", _sheet_xml(rows))
    mem.seek(0)
    return mem.getvalue()


def _rows_to_csv_bytes(rows: list[dict[str, Any]]) -> bytes:
    sio = io.StringIO()
    if rows:
        headers = list(rows[0].keys())
        writer = csv.DictWriter(sio, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    else:
        writer = csv.writer(sio)
        writer.writerow(["No data"])
    return sio.getvalue().encode("utf-8")


def _collect_export_rows(db: Session, req: BackupExportRequest) -> dict[str, list[dict[str, Any]]]:
    sheets: dict[str, list[dict[str, Any]]] = {}

    if req.products_inventory:
        items = db.query(InventoryItem).order_by(InventoryItem.id.asc()).all()
        sheets["Products_Inventory"] = [
            {
                "id": item.id,
                "sku": item.sku,
                "barcode": item.barcode,
                "name": item.name,
                "category": item.category,
                "brand": item.brand,
                "model": item.model,
                "quantity": int(item.quantity or 0),
                "damaged_quantity": int(item.damaged_quantity or 0),
                "cost_price": float(item.cost_price or 0),
                "sale_price": float(item.sale_price or 0),
                "warranty_days": int(item.warranty_days or 0),
                "location": item.location,
            }
            for item in items
        ]

    if req.customers:
        customers = db.query(Customer).order_by(Customer.id.asc()).all()
        sheets["Customers"] = [
            {
                "id": c.id,
                "name": c.name,
                "phone": c.phone,
                "email": c.email,
                "address": c.address,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in customers
        ]

    if req.suppliers:
        suppliers = db.query(Supplier).order_by(Supplier.id.asc()).all()
        sheets["Suppliers"] = [
            {
                "id": s.id,
                "name": s.name,
                "contact": s.contact,
                "email": s.email,
                "address": s.address,
                "notes": s.notes,
                "payment_terms_days": int(s.payment_terms_days or 0),
                "opening_balance": float(s.opening_balance or 0),
            }
            for s in suppliers
        ]

    if req.sales_invoices:
        sales = db.query(Sale).options(joinedload(Sale.customer)).order_by(Sale.created_at.desc()).all()
        sheets["Sales_Invoices"] = [
            {
                "id": sale.id,
                "invoice_no": f"INV-{sale.id:05d}",
                "created_at": sale.created_at.isoformat() if sale.created_at else None,
                "customer_id": sale.customer_id,
                "customer_name": sale.customer.name if sale.customer else None,
                "payment_method": sale.payment_method,
                "subtotal": float(sale.subtotal or 0),
                "discount_amount": float(sale.discount_amount or 0),
                "tax_amount": float(sale.tax_amount or 0),
                "total": float(sale.total or 0),
                "paid": bool(sale.paid),
                "is_return": bool(sale.is_return),
                "is_voided": bool(sale.is_voided),
            }
            for sale in sales
        ]

    if req.repair_jobs:
        repairs = db.query(RepairTicket).options(joinedload(RepairTicket.customer)).order_by(RepairTicket.created_at.desc()).all()
        sheets["Repair_Jobs"] = [
            {
                "id": rep.id,
                "ticket_no": rep.ticket_no,
                "created_at": rep.created_at.isoformat() if rep.created_at else None,
                "customer_id": rep.customer_id,
                "customer_name": rep.customer.name if rep.customer else None,
                "device_model": rep.device_model,
                "imei": rep.imei,
                "status": rep.status,
                "priority": rep.priority,
                "technician": rep.technician,
                "estimated_cost": float(rep.estimated_cost or 0),
                "advance_payment": float(rep.advance_payment or 0),
                "delivered_at": rep.delivered_at.isoformat() if rep.delivered_at else None,
            }
            for rep in repairs
        ]

    if req.expenses:
        expenses = db.query(Expense).options(joinedload(Expense.supplier)).order_by(Expense.expense_date.desc()).all()
        sheets["Expenses"] = [
            {
                "id": row.id,
                "expense_code": row.expense_code,
                "expense_date": row.expense_date.isoformat() if row.expense_date else None,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "category": row.category,
                "description": row.description,
                "payment_method": row.payment_method,
                "supplier_id": row.supplier_id,
                "supplier_name": row.supplier.name if row.supplier else None,
                "vendor_name": row.vendor_name,
                "reference_no": row.reference_no,
                "status": row.status,
                "amount": float(row.amount or 0),
                "is_recurring": bool(row.is_recurring),
                "recurring_cycle": row.recurring_cycle,
                "approved_at": row.approved_at.isoformat() if row.approved_at else None,
                "paid_at": row.paid_at.isoformat() if row.paid_at else None,
                "notes": row.notes,
            }
            for row in expenses
        ]

    if req.audit_logs:
        logs = db.query(ActivityLog).options(joinedload(ActivityLog.user)).order_by(ActivityLog.created_at.desc()).limit(5000).all()
        sheets["Audit_Logs"] = [
            {
                "id": log.id,
                "created_at": log.created_at.isoformat() if log.created_at else None,
                "user_id": log.user_id,
                "user_name": (log.user.full_name if log.user and log.user.full_name else (log.user.username if log.user else "System")),
                "action": log.action,
                "entity_type": log.entity_type,
                "entity_id": log.entity_id,
                "description": log.description,
                "is_reversible": bool(log.is_reversible),
                "is_reversed": bool(log.is_reversed),
            }
            for log in logs
        ]

    return sheets


def _export_history_note(req: BackupExportRequest) -> str:
    picked = []
    for key, label in [
        ("products_inventory", "products"),
        ("customers", "customers"),
        ("suppliers", "suppliers"),
        ("sales_invoices", "sales"),
        ("repair_jobs", "repairs"),
        ("expenses", "expenses"),
        ("audit_logs", "audit"),
    ]:
        if bool(getattr(req, key, False)):
            picked.append(label)
    return f"datasets={','.join(picked)}"


@router.post("/create", dependencies=[Depends(require_permission("backup.create"))])
def create_backup_endpoint(is_auto: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        result = create_backup(db, is_auto=is_auto, trigger="auto" if is_auto else "manual")
        log_activity(
            db=db,
            user_id=user.id if user else None,
            action="Create",
            entity_type="Backup",
            entity_id=0,
            description=f"{'Auto' if is_auto else 'Manual'} backup created: {result.get('filename')}",
            new_value=result.get("metadata"),
            is_reversible=False,
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=500, detail="Backup creation failed")


@router.get("/last", dependencies=[Depends(require_permission("backup.view"))])
def get_last_backup(db: Session = Depends(get_db), _=Depends(get_current_user)):
    row = db.query(AppSetting).filter(AppSetting.key == "last_backup_at").first()
    return {"last_backup_at": row.value if row else None}


@router.get("", dependencies=[Depends(require_permission("backup.view"))])
def list_backups(_=Depends(get_current_user)):
    return list_backup_filenames()


@router.get("/restore/requests", dependencies=[Depends(require_permission("backup.view"))])
def list_restore_requests(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return _load_restore_requests(db)


@router.post("/cleanup", dependencies=[Depends(require_permission("backup.restore"))])
def cleanup_backup_metadata(payload: BackupCleanupIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_owner(user)
    _migrate_legacy_restore_requests_to_tables(db)
    targets = payload.targets or [
        "missing_backup_records",
        "failed_restore_requests",
        "expired_export_history",
    ]
    target_set = {str(target or "").strip().lower() for target in targets}
    latest_verified_id = _latest_verified_backup_id(db) if payload.keep_latest_verified else None
    result: dict[str, Any] = {
        "dry_run": bool(payload.dry_run),
        "keep_latest_verified": bool(payload.keep_latest_verified),
        "latest_verified_backup_id": latest_verified_id,
        "targets": {},
    }

    if "missing_backup_records" in target_set or "old_local_backup_metadata" in target_set:
        rows = (
            db.query(BackupRecord)
            .filter(BackupRecord.storage_target == "local")
            .order_by(BackupRecord.created_at.asc(), BackupRecord.id.asc())
            .all()
        )
        candidates: list[BackupRecord] = []
        protected = 0
        with_restore_requests = 0
        for row in rows:
            if latest_verified_id and int(row.id) == latest_verified_id:
                protected += 1
                continue
            if _backup_file_exists(row.filename):
                continue
            linked = db.query(RestoreRequest).filter(RestoreRequest.backup_record_id == row.id).count()
            if linked:
                with_restore_requests += 1
                continue
            candidates.append(row)
        if not payload.dry_run:
            for row in candidates:
                db.delete(row)
        result["targets"]["missing_backup_records"] = {
            "checked": len(rows),
            "removed": len(candidates),
            "protected_latest_verified": protected,
            "skipped_with_restore_requests": with_restore_requests,
        }

    if "failed_restore_requests" in target_set:
        cutoff = utcnow() - timedelta(days=30)
        rows = (
            db.query(RestoreRequest)
            .filter(RestoreRequest.status.in_(["failed", "rejected"]), RestoreRequest.requested_at < cutoff)
            .order_by(RestoreRequest.requested_at.asc(), RestoreRequest.id.asc())
            .all()
        )
        if not payload.dry_run and rows:
            request_ids = [int(row.id) for row in rows]
            db.query(RestoreAuditEvent).filter(RestoreAuditEvent.restore_request_id.in_(request_ids)).delete(synchronize_session=False)
            db.query(RestoreApproval).filter(RestoreApproval.restore_request_id.in_(request_ids)).delete(synchronize_session=False)
            db.query(RestoreRequest).filter(RestoreRequest.id.in_(request_ids)).delete(synchronize_session=False)
        result["targets"]["failed_restore_requests"] = {"checked": len(rows), "removed": len(rows)}

    if "expired_export_history" in target_set or "export_history" in target_set:
        result["targets"]["expired_export_history"] = _cleanup_export_history(db, dry_run=bool(payload.dry_run))

    if not payload.dry_run:
        db.commit()
        log_activity(
            db=db,
            user_id=user.id,
            action="Cleanup",
            entity_type="Backup",
            entity_id=0,
            description="Backup cleanup executed",
            new_value=result,
            is_reversible=False,
        )
    return result


@router.post("/restore/request", dependencies=[Depends(require_permission("backup.restore"))])
def create_restore_request(payload: RestoreRequestCreateIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _migrate_legacy_restore_requests_to_tables(db)
    filename = str(payload.filename or "").strip()
    if not filename:
        raise HTTPException(status_code=400, detail="filename is required")
    if filename not in list_backup_filenames():
        raise HTTPException(status_code=404, detail="backup file not found")

    request_id = f"RR-{uuid.uuid4().hex[:10].upper()}"
    backup_record = _ensure_backup_record(db, filename, user.id if user else None)
    req = RestoreRequest(
        request_code=request_id,
        backup_record_id=backup_record.id,
        reason=str(payload.reason or "").strip() or None,
        status="pending_approval",
        requested_by_user_id=user.id,
    )
    db.add(req)
    db.flush()
    _record_restore_event(
        db,
        restore_request_id=req.id,
        event_type="request_created",
        actor_user_id=user.id,
        event_status="success",
        detail=req.reason or "Restore request created",
    )
    db.commit()

    req = _find_restore_request_row(db, request_id)
    if not req:
        raise HTTPException(status_code=500, detail="Failed to load restore request after create")
    created = _load_restore_requests(db)
    payload_row = next((row for row in created if str(row.get("request_id")) == request_id), None)
    if payload_row is None:
        raise HTTPException(status_code=500, detail="Failed to serialize restore request")

    log_activity(
        db=db,
        user_id=user.id,
        action="Create",
        entity_type="BackupRestoreRequest",
        entity_id=0,
        description=f"Restore request created for backup: {filename}",
        new_value=payload_row,
        is_reversible=False,
    )
    return payload_row


@router.post("/restore/requests/{request_id}/approve", dependencies=[Depends(require_permission("backup.restore"))])
def approve_restore_request(request_id: str, payload: RestoreRequestDecisionIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_owner(user)
    req = _find_restore_request_row(db, request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="restore request not found")
    if str(req.status or "") != "pending_approval":
        raise HTTPException(status_code=409, detail=f"Cannot approve request in status: {_status_label(req.status)}")

    approval_note = str(payload.note or "").strip()
    req.status = "approved"
    db.add(
        RestoreApproval(
            restore_request_id=req.id,
            decision="approved",
            note=approval_note,
            decided_by_user_id=user.id,
        )
    )
    _record_restore_event(
        db,
        restore_request_id=req.id,
        event_type="approved",
        actor_user_id=user.id,
        event_status="success",
        detail=approval_note or "Approved",
    )
    db.commit()

    row = next((r for r in _load_restore_requests(db) if str(r.get("request_id")) == request_id), None)
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to serialize approved restore request")

    log_activity(
        db=db,
        user_id=user.id,
        action="Update",
        entity_type="BackupRestoreRequest",
        entity_id=0,
        description=f"Restore request approved: {request_id}",
        new_value={"request_id": request_id, "status": row.get("status"), "note": row.get("approval_note")},
        is_reversible=False,
    )
    return row


@router.post("/restore/requests/{request_id}/reject", dependencies=[Depends(require_permission("backup.restore"))])
def reject_restore_request(request_id: str, payload: RestoreRequestDecisionIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    req = _find_restore_request_row(db, request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="restore request not found")
    if str(req.status or "") != "pending_approval":
        raise HTTPException(status_code=409, detail=f"Cannot reject request in status: {_status_label(req.status)}")

    rejection_note = str(payload.note or "").strip()
    req.status = "rejected"
    db.add(
        RestoreApproval(
            restore_request_id=req.id,
            decision="rejected",
            note=rejection_note,
            decided_by_user_id=user.id,
        )
    )
    _record_restore_event(
        db,
        restore_request_id=req.id,
        event_type="rejected",
        actor_user_id=user.id,
        event_status="success",
        detail=rejection_note or "Rejected",
    )
    db.commit()

    row = next((r for r in _load_restore_requests(db) if str(r.get("request_id")) == request_id), None)
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to serialize rejected restore request")

    log_activity(
        db=db,
        user_id=user.id,
        action="Update",
        entity_type="BackupRestoreRequest",
        entity_id=0,
        description=f"Restore request rejected: {request_id}",
        new_value={"request_id": request_id, "status": row.get("status"), "note": row.get("rejection_note")},
        is_reversible=False,
    )
    return row


@router.post("/restore/requests/{request_id}/execute", dependencies=[Depends(require_permission("backup.restore"))])
def execute_restore_request(request_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_owner(user)
    req = _find_restore_request_row(db, request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="restore request not found")
    if str(req.status or "") != "approved":
        raise HTTPException(status_code=409, detail=f"Only approved requests can be executed. Current status: {_status_label(req.status)}")

    filename = str(req.backup_record.filename if req.backup_record else "").strip()
    if not filename:
        raise HTTPException(status_code=400, detail="restore request has no backup filename")

    _record_restore_event(
        db,
        restore_request_id=req.id,
        event_type="restore_started",
        actor_user_id=user.id,
        event_status="pending",
        detail=f"Restore started for {filename}",
    )
    db.commit()

    try:
        result = restore_backup(db, filename)
    except FileNotFoundError as exc:
        req.status = "failed"
        req.executed_by_user_id = user.id
        req.executed_at = utcnow()
        req.execution_result = str(exc)
        _record_restore_event(
            db,
            restore_request_id=req.id,
            event_type="restore_failed",
            actor_user_id=user.id,
            event_status="failed",
            detail=str(exc),
        )
        db.commit()
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        req.status = "failed"
        req.executed_by_user_id = user.id
        req.executed_at = utcnow()
        req.execution_result = str(exc)
        _record_restore_event(
            db,
            restore_request_id=req.id,
            event_type="restore_failed",
            actor_user_id=user.id,
            event_status="failed",
            detail=str(exc),
        )
        db.commit()
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        req.status = "failed"
        req.executed_by_user_id = user.id
        req.executed_at = utcnow()
        req.execution_result = "Restore execution failed"
        _record_restore_event(
            db,
            restore_request_id=req.id,
            event_type="restore_failed",
            actor_user_id=user.id,
            event_status="failed",
            detail="Restore execution failed",
        )
        db.commit()
        raise HTTPException(status_code=500, detail="Restore execution failed")

    req.status = "executed"
    req.executed_by_user_id = user.id
    req.executed_at = utcnow()
    req.execution_result = "success"
    pre_restore_snapshot = result.get("pre_restore_snapshot")
    if pre_restore_snapshot:
        pre_record = _ensure_backup_record(db, str(pre_restore_snapshot), user.id)
        pre_record.backup_type = "pre_restore"
        pre_record.status = "verified"
        pre_record.storage_target = "local"
        _record_restore_event(
            db,
            restore_request_id=req.id,
            event_type="pre_restore_backup",
            actor_user_id=user.id,
            event_status="success",
            detail=f"Pre-restore backup created: {pre_restore_snapshot}",
            metadata={"filename": pre_restore_snapshot},
        )
    _record_restore_event(
        db,
        restore_request_id=req.id,
        event_type="restore_completed",
        actor_user_id=user.id,
        event_status="success",
        detail="Restore executed successfully",
        metadata=result,
    )
    db.commit()

    row = next((r for r in _load_restore_requests(db) if str(r.get("request_id")) == request_id), None)
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to serialize executed restore request")

    log_activity(
        db=db,
        user_id=user.id,
        action="Restore",
        entity_type="Backup",
        entity_id=0,
        description=f"Backup restore executed via workflow: {filename}",
        new_value={"request_id": request_id, "result": result},
        is_reversible=False,
    )
    return {"request": row, "restore_result": result}


@router.post("/restore/{filename}", dependencies=[Depends(require_permission("backup.restore"))])
def restore_backup_endpoint(filename: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """
    Direct restore endpoint kept for backward compatibility.
    For normal operations, use request -> approve -> execute workflow endpoints.
    """
    if not settings.allow_direct_restore:
        raise HTTPException(
            status_code=410,
            detail="Direct restore is disabled. Use the restore request, approval, and execute workflow.",
        )
    try:
        result = restore_backup(db, filename)
        log_activity(
            db=db,
            user_id=user.id,
            action="Restore",
            entity_type="Backup",
            entity_id=0,
            description=f"Direct backup restore executed: {filename}",
            new_value=result,
            is_reversible=False,
        )
        return result
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=500, detail="Restore execution failed")


@router.post("/export-data", dependencies=[Depends(require_permission("backup.export"))])
def export_system_data(payload: BackupExportRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    fmt = str(payload.format or "CSV").strip().lower()
    if fmt not in {"csv", "excel", "json"}:
        raise HTTPException(status_code=400, detail="format must be one of: CSV, Excel, JSON")

    datasets = _collect_export_rows(db, payload)
    if not datasets:
        raise HTTPException(status_code=400, detail="No datasets selected for export")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    export_note = _export_history_note(payload)

    if fmt == "json":
        data = json.dumps({"generated_at": _now_iso(), "datasets": datasets}, ensure_ascii=False, indent=2).encode("utf-8")
        filename = f"system_export_{timestamp}.json"
        media_type = "application/json"
        stream = io.BytesIO(data)
    elif fmt == "excel":
        data = _build_xlsx_file(datasets)
        filename = f"system_export_{timestamp}.xlsx"
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        stream = io.BytesIO(data)
    else:
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            for name, rows in datasets.items():
                zf.writestr(f"{name}.csv", _rows_to_csv_bytes(rows))
        stream.seek(0)
        data = stream.getvalue()
        filename = f"system_export_{timestamp}.zip"
        media_type = "application/zip"
        stream = io.BytesIO(data)

    log_activity(
        db=db,
        user_id=user.id if user else None,
        action="Export",
        entity_type="BackupDataExport",
        entity_id=0,
        description=f"System data export generated ({fmt.upper()}): {filename}",
        new_value={"filename": filename, "format": fmt.upper(), "note": export_note},
        is_reversible=False,
    )

    return StreamingResponse(
        stream,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/scheduler/status", dependencies=[Depends(require_permission("backup.view"))])
def get_scheduler_status(_=Depends(get_current_user)):
    try:
        from app.services.backup_scheduler import get_scheduler
    except Exception:
        return {"enabled": False, "reason": "Scheduler service unavailable"}

    scheduler = get_scheduler()
    if not settings.backup_schedule_enabled:
        return {"enabled": False, "reason": "Disabled in configuration"}
    if scheduler is None:
        return {"enabled": False, "reason": "Scheduler not initialized"}
    if not scheduler.running:
        return {"enabled": False, "reason": "Scheduler not running"}
    job = scheduler.get_job("daily_backup")
    if not job:
        return {"enabled": False, "reason": "Daily backup job not found"}
    return {
        "enabled": True,
        "scheduler_running": scheduler.running,
        "job_name": job.name,
        "job_id": job.id,
        "next_run_time": job.next_run_time.isoformat() if job.next_run_time else None,
        "schedule": f"{settings.backup_schedule_hour:02d}:{settings.backup_schedule_minute:02d} daily ({settings.backup_schedule_timezone})",
        "keep_count": settings.backup_keep_local,
    }


@router.post("/scheduler/trigger-now", dependencies=[Depends(require_permission("backup.create"))])
def trigger_backup_now(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        result = create_backup(db, is_auto=True, trigger="scheduled-manual-trigger")
        log_activity(
            db=db,
            user_id=user.id if user else None,
            action="Create",
            entity_type="Backup",
            entity_id=0,
            description=f"Scheduled backup manually triggered: {result.get('filename')}",
            new_value=result.get("metadata"),
            is_reversible=False,
        )
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=500, detail="Scheduled backup failed")
