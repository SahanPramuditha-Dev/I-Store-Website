import calendar
import json
from datetime import datetime, timedelta
from typing import Iterable

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import (
    Customer,
    InventoryItem,
    InventorySerial,
    RepairTicket,
    Sale,
    SaleItem,
    WarrantyClaim,
    WarrantyClaimEvent,
    WarrantyCondition,
    WarrantyRecord,
    WarrantyReplacement,
    WarrantyRule,
)
from app.services.numbering_service import next_number
from app.utils.time import utcnow

# Canonical warranty record statuses
WARRANTY_STATUS_ACTIVE = "active"
WARRANTY_STATUS_EXPIRED = "expired"
WARRANTY_STATUS_CLAIMED = "claimed"
WARRANTY_STATUS_REJECTED = "rejected"
WARRANTY_STATUS_REPLACED = "replaced"
WARRANTY_STATUS_VOIDED = "voided"
WARRANTY_STATUS_CANCELLED = "cancelled"

WARRANTY_STATUS_VALUES = {
    WARRANTY_STATUS_ACTIVE,
    WARRANTY_STATUS_EXPIRED,
    WARRANTY_STATUS_CLAIMED,
    WARRANTY_STATUS_REJECTED,
    WARRANTY_STATUS_REPLACED,
    WARRANTY_STATUS_VOIDED,
    WARRANTY_STATUS_CANCELLED,
}

# Canonical claim statuses
CLAIM_STATUS_PENDING_INSPECTION = "pending_inspection"
CLAIM_STATUS_UNDER_REVIEW = "under_review"
CLAIM_STATUS_APPROVED = "approved"
CLAIM_STATUS_REJECTED = "rejected"
CLAIM_STATUS_REPAIRING = "repairing"
CLAIM_STATUS_WAITING_PARTS = "waiting_parts"
CLAIM_STATUS_REPLACED = "replaced"
CLAIM_STATUS_RESOLVED = "resolved"
CLAIM_STATUS_CLOSED = "closed"

CLAIM_STATUS_VALUES = {
    CLAIM_STATUS_PENDING_INSPECTION,
    CLAIM_STATUS_UNDER_REVIEW,
    CLAIM_STATUS_APPROVED,
    CLAIM_STATUS_REJECTED,
    CLAIM_STATUS_REPAIRING,
    CLAIM_STATUS_WAITING_PARTS,
    CLAIM_STATUS_REPLACED,
    CLAIM_STATUS_RESOLVED,
    CLAIM_STATUS_CLOSED,
}

# Backward compatibility names used in existing routers/UI
CLAIM_STATUS_PENDING = CLAIM_STATUS_PENDING_INSPECTION
CLAIM_STATUS_REPAIRED = CLAIM_STATUS_REPAIRING

WARRANTY_STATUS_LABELS = {
    WARRANTY_STATUS_ACTIVE: "Active",
    WARRANTY_STATUS_EXPIRED: "Expired",
    WARRANTY_STATUS_CLAIMED: "Claimed",
    WARRANTY_STATUS_REJECTED: "Rejected",
    WARRANTY_STATUS_REPLACED: "Replaced",
    WARRANTY_STATUS_VOIDED: "Voided",
    WARRANTY_STATUS_CANCELLED: "Cancelled",
}

CLAIM_STATUS_LABELS = {
    CLAIM_STATUS_PENDING_INSPECTION: "Pending Inspection",
    CLAIM_STATUS_UNDER_REVIEW: "Under Review",
    CLAIM_STATUS_APPROVED: "Approved",
    CLAIM_STATUS_REJECTED: "Rejected",
    CLAIM_STATUS_REPAIRING: "Repairing",
    CLAIM_STATUS_WAITING_PARTS: "Waiting Parts",
    CLAIM_STATUS_REPLACED: "Replaced",
    CLAIM_STATUS_RESOLVED: "Resolved",
    CLAIM_STATUS_CLOSED: "Closed",
}

CLAIM_STATUS_NORMALIZE_MAP = {
    "pending inspection": CLAIM_STATUS_PENDING_INSPECTION,
    "pending_inspection": CLAIM_STATUS_PENDING_INSPECTION,
    "pending": CLAIM_STATUS_PENDING_INSPECTION,
    "under review": CLAIM_STATUS_UNDER_REVIEW,
    "under_review": CLAIM_STATUS_UNDER_REVIEW,
    "approved": CLAIM_STATUS_APPROVED,
    "rejected": CLAIM_STATUS_REJECTED,
    "repairing": CLAIM_STATUS_REPAIRING,
    "repaired": CLAIM_STATUS_REPAIRING,
    "waiting parts": CLAIM_STATUS_WAITING_PARTS,
    "waiting_parts": CLAIM_STATUS_WAITING_PARTS,
    "replaced": CLAIM_STATUS_REPLACED,
    "resolved": CLAIM_STATUS_RESOLVED,
    "closed": CLAIM_STATUS_CLOSED,
}

WARRANTY_STATUS_NORMALIZE_MAP = {
    "active": WARRANTY_STATUS_ACTIVE,
    "expired": WARRANTY_STATUS_EXPIRED,
    "claimed": WARRANTY_STATUS_CLAIMED,
    "rejected": WARRANTY_STATUS_REJECTED,
    "replaced": WARRANTY_STATUS_REPLACED,
    "voided": WARRANTY_STATUS_VOIDED,
    "cancelled": WARRANTY_STATUS_CANCELLED,
    "canceled": WARRANTY_STATUS_CANCELLED,
}

RULE_TYPE_PRIORITY = {
    "product": 1,
    "variant": 2,
    "serial": 3,
    "category": 4,
    "repair_service": 5,
    "global": 6,
}


def normalize_warranty_status(value: str | None) -> str:
    key = str(value or "").strip().lower()
    return WARRANTY_STATUS_NORMALIZE_MAP.get(key, WARRANTY_STATUS_ACTIVE)


def warranty_status_label(value: str | None) -> str:
    return WARRANTY_STATUS_LABELS.get(normalize_warranty_status(value), "Active")


def normalize_claim_status(value: str | None) -> str:
    key = str(value or "").strip().lower()
    return CLAIM_STATUS_NORMALIZE_MAP.get(key, CLAIM_STATUS_PENDING_INSPECTION)


def claim_status_label(value: str | None) -> str:
    return CLAIM_STATUS_LABELS.get(normalize_claim_status(value), CLAIM_STATUS_LABELS[CLAIM_STATUS_PENDING_INSPECTION])


def normalize_coverage_type(value: str | None) -> str:
    key = str(value or "").strip().lower()
    if key in {"repair", "replacement", "service_only", "no_warranty"}:
        return key
    return "repair"


def _legacy_scope_to_rule_type(scope_type: str | None) -> str:
    key = str(scope_type or "").strip().lower()
    if key in {"product", "variant", "serial", "category", "repair_service", "global"}:
        return key
    if key == "product_category":
        return "category"
    if key == "spare_part":
        return "category"
    if key == "repair_service":
        return "repair_service"
    if key == "product":
        return "product"
    return "global"


def _active_rule_query(db: Session):
    return db.query(WarrantyRule).filter(
        WarrantyRule.is_active == True,  # noqa: E712
        or_(WarrantyRule.is_deleted == False, WarrantyRule.is_deleted.is_(None)),  # noqa: E712
    )


def ensure_warranty_defaults(db: Session) -> None:
    if _active_rule_query(db).count() == 0:
        defaults = [
            WarrantyRule(
                rule_name="Global Retail Warranty",
                rule_type="global",
                scope_type="global",
                scope_value="*",
                warranty_duration_value=30,
                warranty_duration_unit="days",
                warranty_days=30,
                coverage_type="repair",
                priority=600,
                description="Default fallback warranty when no specific rule is found.",
                is_active=True,
            ),
            WarrantyRule(
                rule_name="Smartphone Category Warranty",
                rule_type="category",
                scope_type="product_category",
                scope_value="Smartphones",
                warranty_duration_value=1,
                warranty_duration_unit="years",
                warranty_days=365,
                coverage_type="repair",
                priority=400,
                is_active=True,
            ),
            WarrantyRule(
                rule_name="Spare Parts Category Warranty",
                rule_type="category",
                scope_type="product_category",
                scope_value="Spare Parts",
                warranty_duration_value=30,
                warranty_duration_unit="days",
                warranty_days=30,
                coverage_type="service_only",
                priority=430,
                is_active=True,
            ),
            WarrantyRule(
                rule_name="Repair Service Warranty",
                rule_type="repair_service",
                scope_type="repair_service",
                scope_value="*",
                warranty_duration_value=30,
                warranty_duration_unit="days",
                warranty_days=30,
                coverage_type="repair",
                priority=500,
                is_active=True,
            ),
        ]
        db.add_all(defaults)

    if db.query(WarrantyCondition).count() == 0:
        conditions = [
            WarrantyCondition(
                condition_code="PHYSICAL_DAMAGE",
                title="Physical damage not covered",
                description="Any cracked body, bent frame, or impact marks void warranty.",
                is_covered=False,
                is_active=True,
                sort_order=10,
            ),
            WarrantyCondition(
                condition_code="WATER_DAMAGE",
                title="Water damage not covered",
                description="Liquid ingress, corrosion, and moisture indicators are excluded.",
                is_covered=False,
                is_active=True,
                sort_order=20,
            ),
            WarrantyCondition(
                condition_code="BURN_DAMAGE",
                title="Burn damage not covered",
                description="Electrical burns, overheating burns, and short-circuit burns are excluded.",
                is_covered=False,
                is_active=True,
                sort_order=30,
            ),
            WarrantyCondition(
                condition_code="SEAL_REMOVED",
                title="Warranty void if seal removed",
                description="Tamper seals removed by unauthorized parties void warranty.",
                is_covered=False,
                is_active=True,
                sort_order=40,
            ),
        ]
        db.add_all(conditions)

    db.commit()


def refresh_warranty_statuses(db: Session) -> None:
    now = utcnow()
    rows = (
        db.query(WarrantyRecord)
        .filter(
            or_(WarrantyRecord.is_deleted == False, WarrantyRecord.is_deleted.is_(None)),  # noqa: E712
            ~WarrantyRecord.status.in_([WARRANTY_STATUS_VOIDED, WARRANTY_STATUS_CANCELLED]),
        )
        .all()
    )
    touched = False
    for row in rows:
        current = normalize_warranty_status(row.status)
        if current in {WARRANTY_STATUS_CLAIMED, WARRANTY_STATUS_REJECTED, WARRANTY_STATUS_REPLACED}:
            continue
        desired = WARRANTY_STATUS_ACTIVE if row.end_date and row.end_date >= now else WARRANTY_STATUS_EXPIRED
        if current != desired:
            row.status = desired
            touched = True
    if touched:
        db.commit()


def _is_spare_part(item: InventoryItem | None) -> bool:
    if not item:
        return False
    type_hint = str(item.product_type or "").lower()
    cat_hint = str(item.category or "").lower()
    return "spare" in type_hint or "spare" in cat_hint or "part" in cat_hint


def _variant_key_from_item(item: InventoryItem | None) -> str | None:
    if not item:
        return None
    parts = [
        str(item.brand or "").strip().lower(),
        str(item.model or "").strip().lower(),
        str(item.storage or "").strip().lower(),
        str(item.color or "").strip().lower(),
        str(item.condition or "").strip().lower(),
    ]
    key = "|".join([p for p in parts if p])
    return key or None


def _list_active_conditions_payload(db: Session) -> str:
    rows = (
        db.query(WarrantyCondition)
        .filter(WarrantyCondition.is_active == True)  # noqa: E712
        .order_by(WarrantyCondition.sort_order.asc(), WarrantyCondition.id.asc())
        .all()
    )
    payload = [
        {
            "code": r.condition_code,
            "title": r.title,
            "description": r.description,
            "is_covered": bool(r.is_covered),
        }
        for r in rows
    ]
    return json.dumps(payload)


def _duration_to_days(value: int, unit: str) -> int:
    v = max(0, int(value or 0))
    key = str(unit or "days").strip().lower()
    if key == "years":
        return v * 365
    if key == "months":
        return v * 30
    return v


def _rule_duration_days(rule: WarrantyRule | None) -> int:
    if not rule:
        return 0
    if int(rule.warranty_duration_value or 0) > 0:
        return _duration_to_days(int(rule.warranty_duration_value or 0), str(rule.warranty_duration_unit or "days"))
    return max(0, int(rule.warranty_days or 0))


def validate_warranty_rule(rule: WarrantyRule) -> tuple[bool, str]:
    if not rule:
        return False, "Rule is required"
    if normalize_coverage_type(rule.coverage_type) == "no_warranty":
        return True, ""
    if _rule_duration_days(rule) <= 0:
        return False, "Warranty duration must be greater than zero"
    return True, ""


def _rule_rank(
    rule: WarrantyRule,
    *,
    product_id: int | None = None,
    variant_id: str | None = None,
    serial_id: int | None = None,
    serial_text: str | None = None,
    category_id: int | None = None,
    category_name: str | None = None,
    repair_service_tokens: list[str] | None = None,
) -> int | None:
    rule_type = str(rule.rule_type or "").strip().lower() or _legacy_scope_to_rule_type(rule.scope_type)
    scope_val = str(rule.scope_value or "").strip().lower()
    category_key = str(category_name or "").strip().lower()
    variant_key = str(variant_id or "").strip().lower()
    serial_key = str(serial_text or "").strip().lower()
    tokens = [str(t or "").strip().lower() for t in (repair_service_tokens or []) if str(t or "").strip()]
    repair_scope = str(rule.repair_service_id or "").strip().lower()

    if rule_type == "product":
        if rule.product_id and product_id and int(rule.product_id) == int(product_id):
            return RULE_TYPE_PRIORITY["product"]
        if scope_val and scope_val not in {"*", "all"} and product_id and scope_val.isdigit() and int(scope_val) == int(product_id):
            return RULE_TYPE_PRIORITY["product"]
        return None

    if rule_type == "variant":
        if rule.variant_id and variant_key and str(rule.variant_id).strip().lower() == variant_key:
            return RULE_TYPE_PRIORITY["variant"]
        if scope_val and scope_val not in {"*", "all"} and variant_key and scope_val == variant_key:
            return RULE_TYPE_PRIORITY["variant"]
        return None

    if rule_type == "serial":
        if rule.serial_id and serial_id and int(rule.serial_id) == int(serial_id):
            return RULE_TYPE_PRIORITY["serial"]
        if scope_val and scope_val not in {"*", "all"} and serial_key and scope_val == serial_key:
            return RULE_TYPE_PRIORITY["serial"]
        return None

    if rule_type == "category":
        if rule.category_id and category_id and int(rule.category_id) == int(category_id):
            return RULE_TYPE_PRIORITY["category"]
        if scope_val in {"*", "all"}:
            return RULE_TYPE_PRIORITY["category"]
        if category_key and scope_val == category_key:
            return RULE_TYPE_PRIORITY["category"]
        return None

    if rule_type == "repair_service":
        if repair_scope and repair_scope in {"*", "all"}:
            return RULE_TYPE_PRIORITY["repair_service"]
        if scope_val and scope_val in {"*", "all"}:
            return RULE_TYPE_PRIORITY["repair_service"]
        for token in tokens:
            if repair_scope and repair_scope in token:
                return RULE_TYPE_PRIORITY["repair_service"]
            if scope_val and scope_val in token:
                return RULE_TYPE_PRIORITY["repair_service"]
        return None

    if rule_type == "global":
        if scope_val in {"", "*", "all"}:
            return RULE_TYPE_PRIORITY["global"]
        return RULE_TYPE_PRIORITY["global"]

    return None


def get_applicable_warranty_rule(
    db: Session,
    product_id: int | None = None,
    variant_id: str | None = None,
    serial_id: int | None = None,
    category_id: int | None = None,
    category_name: str | None = None,
    repair_service_id: str | None = None,
    serial_text: str | None = None,
) -> WarrantyRule | None:
    rows = _active_rule_query(db).all()
    tokens = []
    if repair_service_id:
        key = str(repair_service_id).strip().lower()
        tokens.extend([key])
        tokens.extend([p for p in key.split() if p])
        tokens.extend([p for p in key.split("|") if p])

    ranked: list[tuple[int, int, int, WarrantyRule]] = []
    for rule in rows:
        rank = _rule_rank(
            rule,
            product_id=product_id,
            variant_id=variant_id,
            serial_id=serial_id,
            serial_text=serial_text,
            category_id=category_id,
            category_name=category_name,
            repair_service_tokens=tokens,
        )
        if rank is None:
            continue
        valid, _ = validate_warranty_rule(rule)
        if not valid and normalize_coverage_type(rule.coverage_type) != "no_warranty":
            continue
        priority = int(rule.priority or 100)
        duration_days = _rule_duration_days(rule)
        ranked.append((rank, priority, -duration_days, rule))

    if not ranked:
        return None
    ranked.sort(key=lambda t: (t[0], t[1], t[2]))
    return ranked[0][3]


def get_applicable_repair_warranty_rule(
    db: Session,
    service_id: str | None = None,
    repair_ticket_id: int | None = None,
) -> WarrantyRule | None:
    tokens: list[str] = []
    if service_id:
        tokens.append(str(service_id).strip())
    if repair_ticket_id:
        repair = db.query(RepairTicket).filter(RepairTicket.id == int(repair_ticket_id)).first()
        if repair:
            if repair.issue:
                tokens.append(str(repair.issue))
            if repair.device_model:
                tokens.append(str(repair.device_model))
    key = " | ".join([t for t in tokens if t]).strip()
    return get_applicable_warranty_rule(db, repair_service_id=key)


def _add_months(dt: datetime, months: int) -> datetime:
    if months <= 0:
        return dt
    month_idx = dt.month - 1 + months
    year = dt.year + month_idx // 12
    month = month_idx % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def calculate_warranty_dates(rule: WarrantyRule | None, sale_date: datetime) -> tuple[datetime, datetime, int]:
    start_date = sale_date
    if not rule:
        return start_date, start_date, 0
    duration_value = int(rule.warranty_duration_value or 0)
    duration_unit = str(rule.warranty_duration_unit or "days").strip().lower()
    if duration_value <= 0:
        duration_value = max(0, int(rule.warranty_days or 0))
        duration_unit = "days"

    if duration_unit == "years":
        end_date = _add_months(start_date, duration_value * 12)
    elif duration_unit == "months":
        end_date = _add_months(start_date, duration_value)
    else:
        end_date = start_date + timedelta(days=max(0, duration_value))

    return start_date, end_date, _duration_to_days(duration_value, duration_unit)


def _normalize_record_status(end_date: datetime, existing_status: str | None = None) -> str:
    current = normalize_warranty_status(existing_status)
    if current in {WARRANTY_STATUS_VOIDED, WARRANTY_STATUS_CANCELLED, WARRANTY_STATUS_REPLACED, WARRANTY_STATUS_REJECTED}:
        return current
    return WARRANTY_STATUS_ACTIVE if end_date >= utcnow() else WARRANTY_STATUS_EXPIRED


def _set_warranty_numbers(db: Session, row: WarrantyRecord) -> None:
    if not row.warranty_code:
        row.warranty_code = next_number(db, "WRN")
    if not row.warranty_number:
        row.warranty_number = row.warranty_code


def _set_claim_numbers(db: Session, row: WarrantyClaim) -> None:
    if not row.claim_code:
        row.claim_code = next_number(db, "WCL")
    if not row.claim_number:
        row.claim_number = row.claim_code


def _find_serial_row(db: Session, item_id: int | None, serial_number: str | None) -> InventorySerial | None:
    if not item_id or not serial_number:
        return None
    return (
        db.query(InventorySerial)
        .filter(
            InventorySerial.item_id == int(item_id),
            InventorySerial.serial_number == str(serial_number).strip(),
        )
        .first()
    )


def resolve_sale_item_warranty_days(
    db: Session,
    item: InventoryItem | None,
    explicit_days: int | None = None,
) -> int:
    if explicit_days and int(explicit_days) > 0:
        return int(explicit_days)
    if not item:
        return 0
    variant_key = _variant_key_from_item(item)
    rule = get_applicable_warranty_rule(
        db,
        product_id=item.id,
        variant_id=variant_key,
        category_name=item.category,
    )
    if rule:
        if normalize_coverage_type(rule.coverage_type) == "no_warranty":
            return 0
        return _rule_duration_days(rule)
    if int(item.warranty_days or 0) > 0:
        return int(item.warranty_days or 0)
    return 0


def resolve_repair_warranty_days(db: Session, repair: RepairTicket) -> int:
    rule = get_applicable_repair_warranty_rule(
        db,
        service_id=f"{repair.issue or ''} {repair.device_model or ''}".strip(),
        repair_ticket_id=repair.id,
    )
    if not rule:
        return 0
    if normalize_coverage_type(rule.coverage_type) == "no_warranty":
        return 0
    return _rule_duration_days(rule)


def create_warranty_from_invoice_item(
    db: Session,
    invoice_item_id: int,
    created_by_id: int | None = None,
) -> WarrantyRecord | None:
    line = db.query(SaleItem).filter(SaleItem.id == int(invoice_item_id)).first()
    if not line:
        return None
    sale = db.query(Sale).filter(Sale.id == int(line.sale_id)).first()
    if not sale:
        return None
    customer = db.query(Customer).filter(Customer.id == sale.customer_id).first() if sale.customer_id else None
    created = create_warranty_from_pos_sale(
        db=db,
        invoice_id=sale.id,
        created_by_id=created_by_id,
        restrict_item_ids={line.id},
        customer_override=customer,
    )
    return created[0] if created else None


def create_warranty_from_pos_sale(
    db: Session,
    invoice_id: int,
    created_by_id: int | None = None,
    restrict_item_ids: set[int] | None = None,
    customer_override: Customer | None = None,
) -> list[WarrantyRecord]:
    sale = db.query(Sale).filter(Sale.id == int(invoice_id)).first()
    if not sale or bool(sale.is_return):
        return []
    sale_items = db.query(SaleItem).filter(SaleItem.sale_id == sale.id).all()
    if restrict_item_ids:
        sale_items = [row for row in sale_items if int(row.id) in restrict_item_ids]
    customer = customer_override
    if not customer and sale.customer_id:
        customer = db.query(Customer).filter(Customer.id == sale.customer_id).first()
    return create_sale_warranty_records(
        db=db,
        sale=sale,
        sale_items=sale_items,
        customer=customer,
        created_by_id=created_by_id,
    )


def create_sale_warranty_records(
    db: Session,
    sale: Sale,
    sale_items: list[SaleItem],
    customer: Customer | None,
    created_by_id: int | None = None,
) -> list[WarrantyRecord]:
    if sale.is_return:
        return []

    item_ids = [line.item_id for line in sale_items if line.item_id]
    items = (
        db.query(InventoryItem)
        .filter(InventoryItem.id.in_(item_ids))
        .all()
        if item_ids
        else []
    )
    items_by_id = {row.id: row for row in items}
    conditions_json = _list_active_conditions_payload(db)
    sale_time = sale.created_at or utcnow()
    created: list[WarrantyRecord] = []

    for line in sale_items:
        if not line.item_id:
            continue
        if line.line_type and str(line.line_type).lower() not in {"product", "spare_part"}:
            continue
        if int(line.quantity or 0) <= 0:
            continue

        existing = (
            db.query(WarrantyRecord)
            .filter(
                or_(WarrantyRecord.sale_item_id == line.id, WarrantyRecord.invoice_item_id == line.id),
                WarrantyRecord.warranty_type.in_(["product", "spare_part", "Product", "Spare Part"]),
                or_(WarrantyRecord.is_deleted == False, WarrantyRecord.is_deleted.is_(None)),  # noqa: E712
            )
            .first()
        )
        if existing:
            created.append(existing)
            continue

        item = items_by_id.get(line.item_id)
        serial_row = _find_serial_row(db, line.item_id, line.serial_number)
        variant_key = _variant_key_from_item(item)
        rule = get_applicable_warranty_rule(
            db,
            product_id=item.id if item else None,
            variant_id=variant_key,
            serial_id=serial_row.id if serial_row else None,
            serial_text=line.serial_number,
            category_name=item.category if item else None,
        )
        coverage = normalize_coverage_type(getattr(rule, "coverage_type", None))
        if coverage == "no_warranty":
            continue
        _, end_date, days = calculate_warranty_dates(rule, sale_time)
        if days <= 0:
            continue

        device_brand_model = ""
        if item:
            device_brand_model = " ".join([x for x in [item.brand, item.model, item.storage] if x]).strip()

        warranty_type = "spare_part" if _is_spare_part(item) else "product"
        row = WarrantyRecord(
            warranty_code=None,
            warranty_number=None,
            invoice_id=sale.id,
            invoice_item_id=line.id,
            repair_ticket_id=sale.repair_ticket_id,
            sale_item_id=line.id,
            warranty_rule_id=rule.id if rule else None,
            product_id=item.id if item else None,
            variant_id=variant_key,
            serial_id=serial_row.id if serial_row else None,
            item_id=item.id if item else None,
            customer_id=customer.id if customer else sale.customer_id,
            customer_name=customer.name if customer else "Walk-in",
            customer_phone=customer.phone if customer else None,
            product_or_service_name=(line.description or item.name) if item else (line.description or f"Item #{line.item_id}"),
            product_category=item.category if item else None,
            brand=item.brand if item else None,
            supplier_name=item.supplier.name if item and item.supplier else None,
            device_brand_model=device_brand_model or None,
            imei=line.serial_number,
            imei_or_serial=line.serial_number,
            serial_number=line.serial_number,
            warranty_type=warranty_type,
            start_date=sale_time,
            end_date=end_date,
            status=_normalize_record_status(end_date),
            coverage_type=coverage,
            quantity_covered=max(1, int(line.quantity or 1)),
            warranty_days=days,
            conditions_json=conditions_json,
            notes=f"Auto-created from POS invoice {sale.invoice_no or f'INV-{sale.id:05d}'}",
            created_by_id=created_by_id,
        )
        db.add(row)
        db.flush()
        _set_warranty_numbers(db, row)
        created.append(row)

    return created


def create_warranty_from_repair_delivery(
    db: Session,
    repair_ticket_id: int,
    created_by_id: int | None = None,
) -> WarrantyRecord | None:
    repair = db.query(RepairTicket).filter(RepairTicket.id == int(repair_ticket_id)).first()
    if not repair:
        return None
    customer = db.query(Customer).filter(Customer.id == repair.customer_id).first() if repair.customer_id else None
    return create_repair_warranty_record(
        db=db,
        repair=repair,
        customer=customer,
        created_by_id=created_by_id,
    )


def create_repair_warranty_record(
    db: Session,
    repair: RepairTicket,
    customer: Customer | None,
    created_by_id: int | None = None,
) -> WarrantyRecord | None:
    existing = (
        db.query(WarrantyRecord)
        .filter(
            WarrantyRecord.repair_ticket_id == repair.id,
            WarrantyRecord.warranty_type.in_(["repair", "Repair Service"]),
            or_(WarrantyRecord.is_deleted == False, WarrantyRecord.is_deleted.is_(None)),  # noqa: E712
        )
        .first()
    )
    if existing:
        return existing

    rule = get_applicable_repair_warranty_rule(
        db,
        service_id=f"{repair.issue or ''} {repair.device_model or ''}".strip(),
        repair_ticket_id=repair.id,
    )
    coverage = normalize_coverage_type(getattr(rule, "coverage_type", None))
    if coverage == "no_warranty":
        return None

    start_date = repair.delivered_at or utcnow()
    _, end_date, days = calculate_warranty_dates(rule, start_date)
    if days <= 0:
        return None

    row = WarrantyRecord(
        warranty_code=None,
        warranty_number=None,
        invoice_id=repair.final_sale_id,
        invoice_item_id=None,
        repair_ticket_id=repair.id,
        sale_item_id=None,
        warranty_rule_id=rule.id if rule else None,
        product_id=None,
        variant_id=None,
        serial_id=None,
        item_id=None,
        customer_id=customer.id if customer else repair.customer_id,
        customer_name=customer.name if customer else "Walk-in",
        customer_phone=customer.phone if customer else None,
        product_or_service_name=f"Repair Service - {repair.issue[:90] if repair.issue else repair.device_model}",
        product_category="Repair Service",
        brand=None,
        supplier_name=None,
        device_brand_model=repair.device_model,
        imei=repair.imei,
        imei_or_serial=repair.imei,
        serial_number=repair.imei,
        warranty_type="repair",
        start_date=start_date,
        end_date=end_date,
        status=_normalize_record_status(end_date),
        coverage_type=coverage,
        quantity_covered=1,
        warranty_days=days,
        conditions_json=_list_active_conditions_payload(db),
        notes=f"Auto-created from repair delivery {repair.ticket_no}",
        created_by_id=created_by_id,
    )
    db.add(row)
    db.flush()
    _set_warranty_numbers(db, row)
    return row


def expire_old_warranties(db: Session) -> int:
    now = utcnow()
    rows = (
        db.query(WarrantyRecord)
        .filter(
            WarrantyRecord.end_date < now,
            WarrantyRecord.status == WARRANTY_STATUS_ACTIVE,
            or_(WarrantyRecord.is_deleted == False, WarrantyRecord.is_deleted.is_(None)),  # noqa: E712
        )
        .all()
    )
    for row in rows:
        row.status = WARRANTY_STATUS_EXPIRED
    if rows:
        db.commit()
    return len(rows)


def void_warranty(
    db: Session,
    warranty_id: int,
    reason: str,
    performed_by_id: int | None = None,
) -> WarrantyRecord:
    row = db.query(WarrantyRecord).filter(WarrantyRecord.id == int(warranty_id)).first()
    if not row:
        raise ValueError("Warranty not found")
    row.status = WARRANTY_STATUS_VOIDED
    row.delete_reason = reason
    row.notes = f"{(row.notes or '').strip()}\nVoided: {reason}".strip()
    row.updated_at = utcnow()
    if performed_by_id:
        row.deleted_by = performed_by_id
    return row


def replace_warranty(
    db: Session,
    old_warranty_id: int,
    new_item: InventoryItem | None,
    claim_id: int | None = None,
    created_by_id: int | None = None,
    replacement_reason: str | None = None,
) -> WarrantyRecord | None:
    old = db.query(WarrantyRecord).filter(WarrantyRecord.id == int(old_warranty_id)).first()
    if not old:
        return None
    old.status = WARRANTY_STATUS_REPLACED
    old.updated_at = utcnow()
    if not new_item:
        return None

    variant_key = _variant_key_from_item(new_item)
    rule = get_applicable_warranty_rule(
        db,
        product_id=new_item.id,
        variant_id=variant_key,
        category_name=new_item.category,
    )
    coverage = normalize_coverage_type(getattr(rule, "coverage_type", None))
    if coverage == "no_warranty":
        return None

    start_date = utcnow()
    _, end_date, days = calculate_warranty_dates(rule, start_date)
    if days <= 0:
        return None

    row = WarrantyRecord(
        warranty_code=None,
        warranty_number=None,
        invoice_id=old.invoice_id,
        invoice_item_id=old.invoice_item_id,
        repair_ticket_id=old.repair_ticket_id,
        sale_item_id=old.sale_item_id,
        warranty_rule_id=rule.id if rule else None,
        product_id=new_item.id,
        variant_id=variant_key,
        serial_id=None,
        item_id=new_item.id,
        customer_id=old.customer_id,
        customer_name=old.customer_name,
        customer_phone=old.customer_phone,
        product_or_service_name=new_item.name,
        product_category=new_item.category,
        brand=new_item.brand,
        supplier_name=new_item.supplier.name if new_item.supplier else None,
        device_brand_model=" ".join([x for x in [new_item.brand, new_item.model, new_item.storage] if x]).strip() or None,
        imei=old.imei,
        imei_or_serial=old.imei_or_serial,
        serial_number=old.serial_number,
        warranty_type="replacement",
        start_date=start_date,
        end_date=end_date,
        status=_normalize_record_status(end_date),
        coverage_type=coverage,
        quantity_covered=1,
        warranty_days=days,
        conditions_json=old.conditions_json,
        notes=f"Replacement warranty for {old.warranty_code}",
        created_by_id=created_by_id,
    )
    db.add(row)
    db.flush()
    _set_warranty_numbers(db, row)

    if claim_id:
        replacement_row = WarrantyReplacement(
            old_warranty_id=old.id,
            new_warranty_id=row.id,
            claim_id=claim_id,
            old_product_id=old.product_id or old.item_id,
            new_product_id=new_item.id,
            old_serial_id=old.serial_id,
            new_serial_id=None,
            replacement_reason=replacement_reason,
            created_by=created_by_id,
        )
        db.add(replacement_row)
    return row


def _append_claim_event(
    db: Session,
    claim: WarrantyClaim,
    *,
    event_type: str,
    event_message: str,
    old_status: str | None,
    new_status: str | None,
    performed_by: int | None,
) -> None:
    db.add(
        WarrantyClaimEvent(
            claim_id=claim.id,
            event_type=event_type,
            event_message=event_message,
            old_status=old_status,
            new_status=new_status,
            performed_by=performed_by,
        )
    )


def apply_claim_status_to_warranty(warranty: WarrantyRecord, claim_status: str) -> None:
    status = normalize_claim_status(claim_status)
    if status == CLAIM_STATUS_REJECTED:
        warranty.status = WARRANTY_STATUS_REJECTED
        return
    if status == CLAIM_STATUS_REPLACED:
        warranty.status = WARRANTY_STATUS_REPLACED
        return
    if status in {CLAIM_STATUS_RESOLVED, CLAIM_STATUS_CLOSED}:
        warranty.status = _normalize_record_status(warranty.end_date, warranty.status)
        return
    warranty.status = WARRANTY_STATUS_CLAIMED


def stamp_claim_code(claim: WarrantyClaim, db: Session | None = None) -> None:
    if claim.claim_code and claim.claim_number:
        return
    if db:
        _set_claim_numbers(db, claim)
        return
    fallback = f"WCL-{int(claim.id or 0):06d}" if claim.id else f"WCL-{int(utcnow().timestamp()):06d}"
    if not claim.claim_code:
        claim.claim_code = fallback
    if not claim.claim_number:
        claim.claim_number = claim.claim_code


def create_claim(
    db: Session,
    warranty_id: int,
    complaint: str,
    created_by_id: int | None = None,
    customer_id: int | None = None,
    issue_description: str | None = None,
) -> WarrantyClaim:
    warranty = db.query(WarrantyRecord).filter(WarrantyRecord.id == int(warranty_id)).first()
    if not warranty:
        raise ValueError("Warranty not found")
    current_status = normalize_warranty_status(warranty.status)
    if current_status in {WARRANTY_STATUS_VOIDED, WARRANTY_STATUS_CANCELLED}:
        raise ValueError("Cannot create claim for voided/cancelled warranty")

    row = WarrantyClaim(
        warranty_id=warranty.id,
        customer_id=customer_id or warranty.customer_id,
        claim_date=utcnow(),
        issue_description=issue_description or complaint,
        customer_complaint=complaint,
        decision_status=CLAIM_STATUS_PENDING_INSPECTION,
        claim_status=claim_status_label(CLAIM_STATUS_PENDING_INSPECTION),
        processed_by_id=created_by_id,
        created_by=created_by_id,
    )
    db.add(row)
    db.flush()
    _set_claim_numbers(db, row)
    apply_claim_status_to_warranty(warranty, CLAIM_STATUS_PENDING_INSPECTION)
    _append_claim_event(
        db,
        row,
        event_type="claim_created",
        event_message="Warranty claim created.",
        old_status=None,
        new_status=CLAIM_STATUS_PENDING_INSPECTION,
        performed_by=created_by_id,
    )
    return row


def inspect_claim(
    db: Session,
    claim_id: int,
    technician_notes: str,
    technician_id: int | None = None,
) -> WarrantyClaim:
    row = db.query(WarrantyClaim).filter(WarrantyClaim.id == int(claim_id)).first()
    if not row:
        raise ValueError("Claim not found")
    old = normalize_claim_status(row.decision_status or row.claim_status)
    row.inspection_notes = technician_notes
    row.technician_inspection_note = technician_notes
    row.technician_id = technician_id
    row.processed_by_id = technician_id
    row.decision_status = CLAIM_STATUS_UNDER_REVIEW
    row.claim_status = claim_status_label(CLAIM_STATUS_UNDER_REVIEW)
    apply_claim_status_to_warranty(row.warranty, CLAIM_STATUS_UNDER_REVIEW)
    _append_claim_event(
        db,
        row,
        event_type="claim_inspected",
        event_message="Claim inspected by technician.",
        old_status=old,
        new_status=CLAIM_STATUS_UNDER_REVIEW,
        performed_by=technician_id,
    )
    return row


def approve_claim(
    db: Session,
    claim_id: int,
    approved_by_id: int | None = None,
) -> WarrantyClaim:
    row = db.query(WarrantyClaim).filter(WarrantyClaim.id == int(claim_id)).first()
    if not row:
        raise ValueError("Claim not found")
    old = normalize_claim_status(row.decision_status or row.claim_status)
    row.decision_status = CLAIM_STATUS_APPROVED
    row.claim_status = claim_status_label(CLAIM_STATUS_APPROVED)
    row.approved_by_id = approved_by_id
    row.approved_at = utcnow()
    row.processed_by_id = approved_by_id
    apply_claim_status_to_warranty(row.warranty, CLAIM_STATUS_APPROVED)
    _append_claim_event(
        db,
        row,
        event_type="claim_approved",
        event_message="Claim approved.",
        old_status=old,
        new_status=CLAIM_STATUS_APPROVED,
        performed_by=approved_by_id,
    )
    return row


def reject_claim(
    db: Session,
    claim_id: int,
    reason: str,
    rejected_by_id: int | None = None,
) -> WarrantyClaim:
    row = db.query(WarrantyClaim).filter(WarrantyClaim.id == int(claim_id)).first()
    if not row:
        raise ValueError("Claim not found")
    old = normalize_claim_status(row.decision_status or row.claim_status)
    row.rejection_reason = reason
    row.claim_decision = reason
    row.decision_status = CLAIM_STATUS_REJECTED
    row.claim_status = claim_status_label(CLAIM_STATUS_REJECTED)
    row.approved_by_id = rejected_by_id
    row.approved_at = utcnow()
    row.processed_by_id = rejected_by_id
    apply_claim_status_to_warranty(row.warranty, CLAIM_STATUS_REJECTED)
    _append_claim_event(
        db,
        row,
        event_type="claim_rejected",
        event_message=f"Claim rejected: {reason}",
        old_status=old,
        new_status=CLAIM_STATUS_REJECTED,
        performed_by=rejected_by_id,
    )
    return row


def resolve_claim(
    db: Session,
    claim_id: int,
    resolution_type: str,
    resolved_by_id: int | None = None,
) -> WarrantyClaim:
    row = db.query(WarrantyClaim).filter(WarrantyClaim.id == int(claim_id)).first()
    if not row:
        raise ValueError("Claim not found")
    old = normalize_claim_status(row.decision_status or row.claim_status)
    resolution_key = str(resolution_type or "").strip().lower()
    if resolution_key not in {"repair", "replacement", "refund", "no_action"}:
        resolution_key = "no_action"
    row.resolution_type = resolution_key
    row.decision_status = CLAIM_STATUS_RESOLVED
    row.claim_status = claim_status_label(CLAIM_STATUS_RESOLVED)
    row.resolved_at = utcnow()
    row.processed_by_id = resolved_by_id
    apply_claim_status_to_warranty(row.warranty, CLAIM_STATUS_RESOLVED)
    _append_claim_event(
        db,
        row,
        event_type="claim_resolved",
        event_message=f"Claim resolved with resolution_type={resolution_key}",
        old_status=old,
        new_status=CLAIM_STATUS_RESOLVED,
        performed_by=resolved_by_id,
    )
    return row


def create_repair_from_claim(
    db: Session,
    claim_id: int,
    performed_by_id: int | None = None,
) -> WarrantyClaim:
    row = db.query(WarrantyClaim).filter(WarrantyClaim.id == int(claim_id)).first()
    if not row:
        raise ValueError("Claim not found")
    old = normalize_claim_status(row.decision_status or row.claim_status)
    row.decision_status = CLAIM_STATUS_REPAIRING
    row.claim_status = claim_status_label(CLAIM_STATUS_REPAIRING)
    row.processed_by_id = performed_by_id
    row.linked_repair_ticket_id = row.linked_repair_ticket_id or row.warranty.repair_ticket_id
    apply_claim_status_to_warranty(row.warranty, CLAIM_STATUS_REPAIRING)
    _append_claim_event(
        db,
        row,
        event_type="claim_repair_started",
        event_message="Repair-under-warranty workflow started.",
        old_status=old,
        new_status=CLAIM_STATUS_REPAIRING,
        performed_by=performed_by_id,
    )
    return row


def create_replacement_from_claim(
    db: Session,
    claim_id: int,
    replacement_product_id: int | None,
    replacement_serial_id: int | None = None,
    replacement_reason: str | None = None,
    performed_by_id: int | None = None,
) -> tuple[WarrantyClaim, WarrantyRecord | None]:
    row = db.query(WarrantyClaim).filter(WarrantyClaim.id == int(claim_id)).first()
    if not row:
        raise ValueError("Claim not found")

    replacement_item = None
    if replacement_product_id:
        replacement_item = db.query(InventoryItem).filter(InventoryItem.id == int(replacement_product_id)).first()

    new_warranty = replace_warranty(
        db=db,
        old_warranty_id=row.warranty_id,
        new_item=replacement_item,
        claim_id=row.id,
        created_by_id=performed_by_id,
        replacement_reason=replacement_reason,
    )

    old = normalize_claim_status(row.decision_status or row.claim_status)
    row.replacement_product_id = replacement_product_id
    row.replacement_serial_id = replacement_serial_id
    row.resolution_type = "replacement"
    row.decision_status = CLAIM_STATUS_REPLACED
    row.claim_status = claim_status_label(CLAIM_STATUS_REPLACED)
    row.processed_by_id = performed_by_id
    row.resolved_at = utcnow()
    apply_claim_status_to_warranty(row.warranty, CLAIM_STATUS_REPLACED)
    _append_claim_event(
        db,
        row,
        event_type="claim_replaced",
        event_message="Replacement issued under warranty.",
        old_status=old,
        new_status=CLAIM_STATUS_REPLACED,
        performed_by=performed_by_id,
    )
    return row, new_warranty
