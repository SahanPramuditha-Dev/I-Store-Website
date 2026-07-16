from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_permission
from app.database import get_db
from app.models import Customer, InvoicePayment, RepairPartUsage, RepairTicket, Sale, WarrantyRecord
from app.routers.advance_router import get_advance_payment_receipt
from app.routers.invoices_router import _invoice_detail
from app.routers.labels_router import print_label_document
from app.routers.returns_router import get_return_case_or_404, serialize_return_case
from app.routers.warranty_router import _serialize_record
from app.services.print_rendering_service import (
    get_store_profile_print_data,
    render_advance_receipt_html,
    render_invoice_html_from_store,
    render_payment_receipt_html,
    render_repair_document_html,
    render_return_receipt_html,
    render_warranty_certificate_html,
)
from app.services.print_sample_data_service import get_sample_data
from app.services.security_service import has_permission
from app.utils.money import mul as money_mul
from app.utils.money import to_float

router = APIRouter(prefix="/print-center", tags=["print-center"])

DOCUMENTS = {
    "sales_receipt": {
        "label": "Sales Receipt",
        "permissions": ["pos.print", "pos.reprint"],
        "reference_label": "Invoice ID",
        "requires_reference": False,
        "papers": ["thermal_80"],
    },
    "invoice": {
        "label": "Invoice",
        "permissions": ["pos.print", "pos.reprint"],
        "reference_label": "Invoice ID",
        "requires_reference": False,
        "papers": ["a4", "thermal_80"],
    },
    "return_receipt": {
        "label": "Return Receipt",
        "permissions": ["returns.print"],
        "reference_label": "Return ID",
        "requires_reference": True,
        "papers": ["thermal_80", "a4"],
    },
    "refund_receipt": {
        "label": "Refund Receipt",
        "permissions": ["returns.print"],
        "reference_label": "Return ID",
        "requires_reference": True,
        "papers": ["thermal_80", "a4"],
    },
    "exchange_receipt": {
        "label": "Exchange Receipt",
        "permissions": ["returns.print"],
        "reference_label": "Return ID",
        "requires_reference": True,
        "papers": ["thermal_80", "a4"],
    },
    "advance_receipt": {
        "label": "Advance Payment Receipt",
        "permissions": ["advance.view", "pos.print"],
        "reference_label": "Advance ID",
        "requires_reference": True,
        "papers": ["thermal_80", "a4"],
    },
    "repair_job_card": {
        "label": "Repair Job Card",
        "permissions": ["repairs.print_job_card"],
        "reference_label": "Repair ID",
        "requires_reference": True,
        "papers": ["a4", "thermal_80"],
    },
    "repair_delivery_receipt": {
        "label": "Repair Delivery Receipt",
        "permissions": ["repairs.print_job_card", "repairs.print"],
        "reference_label": "Repair ID",
        "requires_reference": True,
        "papers": ["a4", "thermal_80"],
    },
    "warranty_certificate": {
        "label": "Warranty Certificate",
        "permissions": ["warranty.print"],
        "reference_label": "Warranty Record ID",
        "requires_reference": True,
        "papers": ["a4"],
    },
    "barcode_sheet": {
        "label": "Barcode Sheet",
        "permissions": ["labels.print"],
        "reference_label": "Batch/Queue ID",
        "requires_reference": False,
        "papers": ["label_38x25", "label_50x30", "a4"],
    },
    "product_label": {
        "label": "Product Label",
        "permissions": ["labels.print"],
        "reference_label": "Product ID/SKU",
        "requires_reference": True,
        "papers": ["label_38x25", "label_50x30"],
    },
    "payment_receipt": {
        "label": "Payment Receipt",
        "permissions": ["pos.print", "pos.reprint"],
        "reference_label": "Payment ID",
        "requires_reference": True,
        "papers": ["thermal_80", "a4"],
    },
}


def _has_any_permission(db: Session, user, permissions: list[str]) -> bool:
    return any(has_permission(db, user, permission) for permission in permissions)


def _require_document_permission(db: Session, user, doc: dict) -> None:
    if not _has_any_permission(db, user, doc["permissions"]):
        raise HTTPException(status_code=403, detail=f"Permission required: {', '.join(doc['permissions'])}")


def _require_reference(doc: dict, reference: str | None) -> str:
    """Extract reference token. Does not throw error if missing - demo mode is allowed."""
    token = str(reference or "").strip()
    return token


def _numeric_reference(token: str, label: str) -> int:
    if not str(token or "").isdigit():
        raise HTTPException(status_code=400, detail=f"{label} must be numeric")
    return int(token)


def _serialize_repair(row: RepairTicket) -> dict:
    return {
        "id": row.id,
        "ticket_no": row.ticket_no,
        "customer_name": row.customer.name if row.customer else "Unknown",
        "customer_phone": row.customer.phone if row.customer else "",
        "device_model": row.device_model,
        "imei": row.imei,
        "issue": row.issue,
        "status": row.status,
        "status_label": str(row.status or "").replace("_", " ").title(),
        "priority": row.priority,
        "technician": row.technician,
        "estimated_cost": to_float(row.estimated_cost),
        "advance_payment": to_float(row.advance_payment),
        "outstanding_balance": to_float(row.outstanding_balance),
    }


def _repair_parts(db: Session, repair_id: int) -> list[dict]:
    rows = (
        db.query(RepairPartUsage)
        .options(joinedload(RepairPartUsage.item))
        .filter(RepairPartUsage.repair_id == int(repair_id))
        .order_by(RepairPartUsage.created_at.asc(), RepairPartUsage.id.asc())
        .all()
    )
    return [
        {
            "item_id": row.item_id,
            "item_name": row.item.name if row.item else f"Item #{row.item_id}",
            "quantity": int(row.quantity or 0),
            "unit_cost": to_float(row.unit_cost),
            "line_total": to_float(money_mul(row.unit_cost, row.quantity or 0)),
        }
        for row in rows
    ]


def _payment_payload(db: Session, row: InvoicePayment) -> dict:
    sale = db.query(Sale).filter(Sale.id == int(row.invoice_id)).first() if row.invoice_id else None
    customer = db.query(Customer).filter(Customer.id == int(row.customer_id)).first() if row.customer_id else None
    return {
        "id": row.id,
        "payment_number": row.payment_number,
        "invoice_id": row.invoice_id,
        "invoice_number": str(sale.invoice_no or f"INV-{sale.id:05d}") if sale else None,
        "customer_name": customer.name if customer else "Walk-in Customer",
        "payment_method": row.payment_method,
        "payment_type": row.payment_type,
        "amount": to_float(row.amount),
        "reference_number": row.reference_number,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "notes": row.notes,
        "paid_total": to_float(sale.amount_paid) if sale else 0,
        "balance_due": to_float(sale.balance_due) if sale else 0,
    }


@router.get("/documents", dependencies=[Depends(require_permission("dashboard.view"))])
def list_print_center_documents(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return {
        "documents": [
            {
                "document_type": key,
                "label": value["label"],
                "required_reference": value["reference_label"] if value["requires_reference"] else None,
                "requires_reference": bool(value["requires_reference"]),
                "supported_paper_sizes": value["papers"],
                "permissions": value["permissions"],
                "permission_allowed": _has_any_permission(db, user, value["permissions"]),
            }
            for key, value in DOCUMENTS.items()
        ]
    }


@router.get("/render", response_class=HTMLResponse, dependencies=[Depends(require_permission("dashboard.view"))])
def render_print_center_document(
    document_type: str = Query(...),
    reference: str | None = Query(default=None),
    paper: str = Query(default="thermal_80"),
    limit: int = Query(default=32, ge=1, le=100),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    doc_key = str(document_type or "").strip().lower()
    doc = DOCUMENTS.get(doc_key)
    if not doc:
        raise HTTPException(status_code=400, detail=f"Unsupported document type: {document_type}")
    _require_document_permission(db, user, doc)
    token = _require_reference(doc, reference)
    store = get_store_profile_print_data(db)
    thermal = str(paper).lower() != "a4"
    is_demo_mode = not token  # If no reference provided, use demo mode

    # Demo mode: generate sample data
    if is_demo_mode:
        try:
            sample_data = get_sample_data(doc_key)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Demo mode not supported for document type: {document_type}")

        if doc_key in {"invoice", "sales_receipt"}:
            return HTMLResponse(render_invoice_html_from_store(sample_data, store, thermal=(doc_key == "sales_receipt" or thermal), preview=True))
        if doc_key in {"return_receipt", "refund_receipt", "exchange_receipt"}:
            return HTMLResponse(render_return_receipt_html(sample_data, store, thermal=thermal))
        if doc_key == "advance_receipt":
            return HTMLResponse(render_advance_receipt_html(sample_data, store, thermal=thermal))
        if doc_key in {"repair_job_card", "repair_delivery_receipt"}:
            repair_parts = sample_data.pop("parts_used", [])
            title = "Repair Delivery Receipt" if doc_key == "repair_delivery_receipt" else "Repair Job Card"
            return HTMLResponse(render_repair_document_html(sample_data, repair_parts, store, thermal=thermal, title=title))
        if doc_key == "warranty_certificate":
            return HTMLResponse(render_warranty_certificate_html(sample_data, store))
        if doc_key == "payment_receipt":
            return HTMLResponse(render_payment_receipt_html(sample_data, store, thermal=thermal))
        if doc_key in {"barcode_sheet", "product_label"}:
            return print_label_document(document_type=doc_key, reference=None, paper=paper, limit=limit, db=db, _=user)
        raise HTTPException(status_code=400, detail=f"Unsupported document type: {document_type}")

    # Real mode: load actual data from database
    if doc_key in {"invoice", "sales_receipt"}:
        sale = db.query(Sale).filter(Sale.id == _numeric_reference(token, "Invoice ID")).first()
        if not sale:
            raise HTTPException(status_code=404, detail="Invoice not found")
        invoice = _invoice_detail(db, sale)
        return HTMLResponse(render_invoice_html_from_store(invoice, store, thermal=(doc_key == "sales_receipt" or thermal), preview=False))

    if doc_key in {"return_receipt", "refund_receipt", "exchange_receipt"}:
        row = get_return_case_or_404(db, _numeric_reference(token, "Return ID"))
        return HTMLResponse(render_return_receipt_html(serialize_return_case(db, row, include_items=True), store, thermal=thermal))

    if doc_key == "advance_receipt":
        receipt = get_advance_payment_receipt(advance_id=_numeric_reference(token, "Advance ID"), db=db, _=user)
        return HTMLResponse(render_advance_receipt_html(receipt, store, thermal=thermal))

    if doc_key in {"repair_job_card", "repair_delivery_receipt"}:
        repair = db.query(RepairTicket).options(joinedload(RepairTicket.customer)).filter(RepairTicket.id == _numeric_reference(token, "Repair ID")).first()
        if not repair:
            raise HTTPException(status_code=404, detail="Repair ticket not found")
        title = "Repair Delivery Receipt" if doc_key == "repair_delivery_receipt" else "Repair Job Card"
        return HTMLResponse(render_repair_document_html(_serialize_repair(repair), _repair_parts(db, repair.id), store, thermal=thermal, title=title))

    if doc_key == "warranty_certificate":
        row = db.query(WarrantyRecord).filter(WarrantyRecord.id == _numeric_reference(token, "Warranty Record ID")).first()
        if not row:
            raise HTTPException(status_code=404, detail="Warranty record not found")
        return HTMLResponse(render_warranty_certificate_html(_serialize_record(row), store))

    if doc_key == "payment_receipt":
        row = db.query(InvoicePayment).filter(InvoicePayment.id == _numeric_reference(token, "Payment ID")).first()
        if not row:
            raise HTTPException(status_code=404, detail="Payment not found")
        return HTMLResponse(render_payment_receipt_html(_payment_payload(db, row), store, thermal=thermal))

    if doc_key in {"barcode_sheet", "product_label"}:
        return print_label_document(document_type=doc_key, reference=token or None, paper=paper, limit=limit, db=db, _=user)

    raise HTTPException(status_code=400, detail=f"Unsupported document type: {document_type}")
