import json
import re
from datetime import datetime

from sqlalchemy.orm import Session

from app.database import Base, engine
from app.models import AppSetting, LabelTemplate
from app.utils.time import utcnow

LABEL_SCOPES = ["Product", "Repair Job", "Spare Part", "Asset"]
BARCODE_FORMATS = ["Auto", "CODE 128", "CODE 39", "EAN-13", "EAN-8", "UPC-A", "QR Code", "DataMatrix"]
LABEL_QUEUE_STATUSES = ["Waiting", "Printing", "Completed", "Failed", "Paused", "Cancelled"]
PRINTER_STATUSES = ["Online", "Offline", "Paper Low", "Error"]

LABEL_SIZE_PRESETS = [
    {"name": "Small Tag", "width_mm": 30, "height_mm": 20, "use_case": "Accessories, small parts"},
    {"name": "Medium Tag", "width_mm": 50, "height_mm": 30, "use_case": "Most products"},
    {"name": "Large Tag", "width_mm": 70, "height_mm": 40, "use_case": "Phones, tablets"},
    {"name": "Shelf Label", "width_mm": 100, "height_mm": 30, "use_case": "Shelf edge pricing"},
    {"name": "A4 Sheet (21-up)", "width_mm": 63, "height_mm": 38, "use_case": "Bulk paper labels"},
    {"name": "A4 Sheet (40-up)", "width_mm": 48, "height_mm": 25, "use_case": "Small sticker sheet"},
]

BUILTIN_TEMPLATES = [
    {
        "name": "Standard Product Label",
        "label_scope": "Product",
        "width_mm": 50,
        "height_mm": 30,
        "canvas": {
            "background": "#ffffff",
            "border": {"enabled": True, "color": "#111827", "width": 1},
            "elements": [
                {"id": "shop", "type": "text", "x": 2, "y": 2, "w": 46, "h": 4, "fontSize": 9, "bold": True, "value": "{{shop_name}}"},
                {"id": "name", "type": "text", "x": 2, "y": 7, "w": 46, "h": 7, "fontSize": 10, "bold": True, "value": "{{product_name}}"},
                {"id": "barcode", "type": "barcode", "x": 3, "y": 15, "w": 44, "h": 9, "fontSize": 8, "format": "CODE 128", "value": "{{barcode}}"},
                {"id": "price", "type": "price", "x": 2, "y": 24, "w": 46, "h": 4, "fontSize": 12, "bold": True, "value": "LKR {{price}}"},
            ],
        },
    },
    {
        "name": "Phone Price Tag",
        "label_scope": "Product",
        "width_mm": 70,
        "height_mm": 40,
        "canvas": {
            "background": "#ffffff",
            "border": {"enabled": True, "color": "#111827", "width": 1},
            "elements": [
                {"id": "name", "type": "text", "x": 3, "y": 3, "w": 64, "h": 8, "fontSize": 12, "bold": True, "value": "{{product_name}}"},
                {"id": "model", "type": "text", "x": 3, "y": 12, "w": 64, "h": 5, "fontSize": 9, "value": "{{brand}} {{model}}"},
                {"id": "barcode", "type": "barcode", "x": 4, "y": 18, "w": 62, "h": 12, "fontSize": 8, "format": "CODE 128", "value": "{{barcode}}"},
                {"id": "price", "type": "price", "x": 3, "y": 31, "w": 64, "h": 6, "fontSize": 14, "bold": True, "value": "LKR {{price}}"},
            ],
        },
    },
    {
        "name": "Small Accessory Tag",
        "label_scope": "Product",
        "width_mm": 30,
        "height_mm": 20,
        "canvas": {
            "background": "#ffffff",
            "border": {"enabled": True, "color": "#111827", "width": 1},
            "elements": [
                {"id": "name", "type": "text", "x": 1, "y": 1, "w": 28, "h": 6, "fontSize": 8, "bold": True, "value": "{{product_name}}"},
                {"id": "barcode", "type": "barcode", "x": 1, "y": 8, "w": 28, "h": 7, "fontSize": 6, "format": "CODE 128", "value": "{{barcode}}"},
                {"id": "price", "type": "price", "x": 1, "y": 15, "w": 28, "h": 4, "fontSize": 9, "bold": True, "value": "LKR {{price}}"},
            ],
        },
    },
    {
        "name": "Repair Job Sticker",
        "label_scope": "Repair Job",
        "width_mm": 40,
        "height_mm": 25,
        "canvas": {
            "background": "#ffffff",
            "border": {"enabled": True, "color": "#111827", "width": 1},
            "elements": [
                {"id": "job", "type": "text", "x": 2, "y": 2, "w": 36, "h": 6, "fontSize": 11, "bold": True, "value": "{{job_id}}"},
                {"id": "device", "type": "text", "x": 2, "y": 8, "w": 36, "h": 5, "fontSize": 8, "value": "{{product_name}}"},
                {"id": "barcode", "type": "barcode", "x": 2, "y": 13, "w": 36, "h": 9, "fontSize": 7, "format": "CODE 128", "value": "{{barcode}}"},
            ],
        },
    },
    {
        "name": "Repair Bag Label",
        "label_scope": "Repair Job",
        "width_mm": 80,
        "height_mm": 50,
        "canvas": {
            "background": "#ffffff",
            "border": {"enabled": True, "color": "#111827", "width": 1},
            "elements": [
                {"id": "job", "type": "text", "x": 3, "y": 3, "w": 74, "h": 8, "fontSize": 14, "bold": True, "value": "{{job_id}}"},
                {"id": "customer", "type": "text", "x": 3, "y": 12, "w": 74, "h": 5, "fontSize": 10, "value": "{{customer_name}}  {{customer_phone}}"},
                {"id": "device", "type": "text", "x": 3, "y": 18, "w": 74, "h": 6, "fontSize": 10, "bold": True, "value": "{{product_name}}"},
                {"id": "status", "type": "badge", "x": 3, "y": 25, "w": 32, "h": 6, "fontSize": 9, "value": "{{status}}"},
                {"id": "barcode", "type": "barcode", "x": 3, "y": 32, "w": 74, "h": 14, "fontSize": 8, "format": "CODE 128", "value": "{{barcode}}"},
            ],
        },
    },
    {
        "name": "Spare Part Tag",
        "label_scope": "Spare Part",
        "width_mm": 40,
        "height_mm": 25,
        "canvas": {
            "background": "#ffffff",
            "border": {"enabled": True, "color": "#111827", "width": 1},
            "elements": [
                {"id": "name", "type": "text", "x": 2, "y": 2, "w": 36, "h": 6, "fontSize": 9, "bold": True, "value": "{{product_name}}"},
                {"id": "compat", "type": "text", "x": 2, "y": 8, "w": 36, "h": 4, "fontSize": 7, "value": "{{model}}"},
                {"id": "barcode", "type": "barcode", "x": 2, "y": 12, "w": 36, "h": 8, "fontSize": 6, "format": "CODE 128", "value": "{{barcode}}"},
                {"id": "location", "type": "text", "x": 2, "y": 20, "w": 36, "h": 4, "fontSize": 7, "value": "{{location}}"},
            ],
        },
    },
    {
        "name": "Shelf Edge Label",
        "label_scope": "Product",
        "width_mm": 100,
        "height_mm": 30,
        "canvas": {
            "background": "#ffffff",
            "border": {"enabled": True, "color": "#111827", "width": 1},
            "elements": [
                {"id": "name", "type": "text", "x": 3, "y": 3, "w": 65, "h": 9, "fontSize": 12, "bold": True, "value": "{{product_name}}"},
                {"id": "barcode", "type": "barcode", "x": 3, "y": 13, "w": 65, "h": 14, "fontSize": 8, "format": "CODE 128", "value": "{{barcode}}"},
                {"id": "price", "type": "price", "x": 71, "y": 5, "w": 26, "h": 20, "fontSize": 16, "bold": True, "value": "LKR {{price}}"},
            ],
        },
    },
    {
        "name": "Asset Tag",
        "label_scope": "Asset",
        "width_mm": 50,
        "height_mm": 25,
        "canvas": {
            "background": "#ffffff",
            "border": {"enabled": True, "color": "#111827", "width": 1},
            "elements": [
                {"id": "name", "type": "text", "x": 2, "y": 2, "w": 46, "h": 5, "fontSize": 9, "bold": True, "value": "{{product_name}}"},
                {"id": "asset", "type": "text", "x": 2, "y": 7, "w": 46, "h": 4, "fontSize": 8, "value": "{{sku}}"},
                {"id": "barcode", "type": "barcode", "x": 2, "y": 11, "w": 46, "h": 9, "fontSize": 7, "format": "CODE 128", "value": "{{barcode}}"},
                {"id": "footer", "type": "text", "x": 2, "y": 20, "w": 46, "h": 4, "fontSize": 7, "value": "Property of {{shop_name}}"},
            ],
        },
    },
]


def safe_json_dumps(value) -> str:
    return json.dumps(value or {}, ensure_ascii=True)


def safe_json_loads(value: str | None, default):
    if not value:
        return default
    try:
        loaded = json.loads(value)
        return loaded if loaded is not None else default
    except Exception:
        return default


def normalize_barcode(value: str | None) -> str:
    raw = (value or "").strip().upper()
    cleaned = re.sub(r"[^A-Z0-9\-._:/]", "", raw)
    return cleaned


def validate_barcode(value: str | None) -> bool:
    normalized = normalize_barcode(value)
    if not normalized:
        return False
    return re.match(r"^[A-Z0-9\-._:/]{3,64}$", normalized) is not None


def generate_barcode_from_seed(seed: str | None) -> str:
    base = normalize_barcode(seed)
    if base:
        return base
    return f"LBL-{int(utcnow().timestamp())}"


def _upsert_setting(db: Session, key: str, default_value):
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        db.add(AppSetting(key=key, value=safe_json_dumps(default_value)))


def ensure_label_defaults(db: Session) -> None:
    # Safe, repeatable guard for local SQLite databases where migrations may be skipped.
    Base.metadata.create_all(bind=engine)

    for template in BUILTIN_TEMPLATES:
        row = db.query(LabelTemplate).filter(LabelTemplate.name == template["name"]).first()
        if row:
            continue
        db.add(
            LabelTemplate(
                name=template["name"],
                label_scope=template["label_scope"],
                width_mm=int(template["width_mm"]),
                height_mm=int(template["height_mm"]),
                canvas_json=safe_json_dumps(template["canvas"]),
                is_default=False,
                is_builtin=True,
                is_active=True,
            )
        )

    # Ensure one default template per scope.
    for scope in LABEL_SCOPES:
        default_row = (
            db.query(LabelTemplate)
            .filter(
                LabelTemplate.label_scope == scope,
                LabelTemplate.is_default == True,
                LabelTemplate.is_active == True,
            )
            .first()
        )
        if default_row:
            continue
        candidate = (
            db.query(LabelTemplate)
            .filter(LabelTemplate.label_scope == scope, LabelTemplate.is_active == True)
            .order_by(LabelTemplate.id.asc())
            .first()
        )
        if candidate:
            candidate.is_default = True

    _upsert_setting(
        db,
        "labels_printers",
        [
            {"name": "Counter Thermal", "model": "XPrinter XP-365B", "status": "Online", "paper_type": "Label Roll", "is_default": True},
            {"name": "Office A4", "model": "HP LaserJet", "status": "Online", "paper_type": "A4 Sheet", "is_default": False},
        ],
    )
    _upsert_setting(
        db,
        "labels_preferences",
        {
            "shop_name": "I Point",
            "shop_phone": "+94 77 123 4567",
            "currency": "LKR",
            "default_barcode_format": "CODE 128",
            "require_reprint_reason": True,
            "max_queue_size": 1000,
        },
    )
    db.commit()
