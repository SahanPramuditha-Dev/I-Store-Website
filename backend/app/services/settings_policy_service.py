import json
from datetime import timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.constants import SALE_INVENTORY_LINE_TYPES
from app.models import AppSetting, InventoryItem, User
from app.services.security_service import canonical_role_name
from app.utils.time import utcnow

SETTINGS_STATE_KEY = "settings_state_v2"


def _read_state(db: Session) -> dict[str, Any]:
    row = db.query(AppSetting).filter(AppSetting.key == SETTINGS_STATE_KEY).first()
    if not row or not row.value:
        return {}
    try:
        payload = json.loads(row.value)
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _get_role_discount_limit(discount_rules: dict[str, Any], role_name: str) -> float:
    role = canonical_role_name(role_name)
    if role == "owner":
        return float(discount_rules.get("max_discount_admin_percent", 100) or 100)
    if role == "admin":
        return float(discount_rules.get("max_discount_admin_percent", 100) or 100)
    if role == "manager":
        return float(discount_rules.get("max_discount_manager_percent", 25) or 25)
    return float(discount_rules.get("max_discount_cashier_percent", 10) or 10)


def _role_key(user: User | None) -> str:
    return canonical_role_name(getattr(user, "role", None) if user else None)


def _is_manager_or_higher(user: User | None) -> bool:
    return _role_key(user) in {"owner", "admin", "manager"}


def enforce_pos_checkout_policy(
    db: Session,
    *,
    user: User | None,
    customer_id: int | None,
    paid: bool,
    discount_amount: float,
    subtotal: float,
    total: float,
    lines: list[Any],
) -> None:
    state = _read_state(db)
    business_ops = (state.get("business_ops") or {}) if isinstance(state, dict) else {}
    sales_rules = business_ops.get("sales_pos_rules") or {}
    discount_rules = business_ops.get("discount_rules") or {}
    inventory_rules = business_ops.get("inventory_rules") or {}

    if subtotal > 0:
        max_discount_pct = _get_role_discount_limit(discount_rules, getattr(user, "role", None))
        applied_pct = (float(discount_amount or 0) / float(subtotal or 1)) * 100.0
        if applied_pct > max_discount_pct:
            raise HTTPException(
                status_code=400,
                detail=f"Discount exceeds allowed limit ({max_discount_pct:.2f}%) for your role.",
            )

    required_customer_above = float(sales_rules.get("require_customer_above", 0) or 0)
    if required_customer_above > 0 and float(total or 0) >= required_customer_above and not customer_id:
        raise HTTPException(
            status_code=400,
            detail=f"Customer is required for invoices above {required_customer_above:.2f}.",
        )

    allow_credit_sales = bool(sales_rules.get("allow_credit_sales", True))
    default_credit_limit = float(sales_rules.get("default_credit_limit", 0) or 0)
    if not paid:
        if not allow_credit_sales:
            raise HTTPException(status_code=400, detail="Credit sales are disabled by policy.")
        if default_credit_limit > 0 and float(total or 0) > default_credit_limit:
            raise HTTPException(
                status_code=400,
                detail=f"Credit sale exceeds allowed limit ({default_credit_limit:.2f}).",
            )

    allow_below_cost = bool(sales_rules.get("allow_selling_below_cost", False))
    allow_negative_stock = bool(inventory_rules.get("allow_negative_stock", False))
    line_item_ids = [int(getattr(line, "item_id")) for line in lines if getattr(line, "item_id", None)]
    if not line_item_ids:
        return
    item_rows = db.query(InventoryItem).filter(InventoryItem.id.in_(line_item_ids)).all()
    item_map = {int(row.id): row for row in item_rows}
    for line in lines:
        line_type = str(getattr(line, "line_type", "product") or "product").strip().lower()
        if line_type not in SALE_INVENTORY_LINE_TYPES:
            continue
        item_id = int(getattr(line, "item_id"))
        item = item_map.get(item_id)
        if not item:
            raise HTTPException(status_code=404, detail=f"Inventory item not found: {item_id}")
        qty = int(getattr(line, "quantity", 0) or 0)
        price = float(getattr(line, "price", 0) or 0)
        if qty <= 0:
            raise HTTPException(status_code=400, detail=f"Quantity must be positive for item {item_id}.")
        if (not allow_negative_stock) and int(item.quantity or 0) < qty:
            raise HTTPException(status_code=400, detail=f"Insufficient stock for item {item_id}.")
        if (not allow_below_cost) and price < float(item.cost_price or 0):
            raise HTTPException(status_code=400, detail=f"Selling below cost is blocked for item {item_id}.")


def apply_repair_create_policy(db: Session, payload: Any) -> None:
    state = _read_state(db)
    business_ops = (state.get("business_ops") or {}) if isinstance(state, dict) else {}
    repair_rules = business_ops.get("repair_rules") or {}

    require_advance = bool(repair_rules.get("require_advance_payment", False))
    minimum_advance_percent = float(repair_rules.get("minimum_advance_percent", 0) or 0)
    estimated_cost = float(getattr(payload, "estimated_cost", 0) or 0)
    advance_payment = float(getattr(payload, "advance_payment", 0) or 0)
    if require_advance and estimated_cost > 0:
        required_amount = round((estimated_cost * minimum_advance_percent) / 100.0, 2)
        if advance_payment < required_amount:
            raise HTTPException(
                status_code=400,
                detail=f"Advance payment must be at least {required_amount:.2f} for this repair.",
            )

    if getattr(payload, "estimated_completion", None):
        return
    now = utcnow()
    priority = str(getattr(payload, "priority", "Normal") or "Normal").strip().lower()
    sla_standard_hours = int(repair_rules.get("sla_target_standard_hours", 24) or 24)
    sla_urgent_hours = int(repair_rules.get("sla_target_urgent_hours", 4) or 4)
    if priority in {"urgent", "vip", "high"}:
        setattr(payload, "estimated_completion", now + timedelta(hours=max(1, sla_urgent_hours)))
    else:
        setattr(payload, "estimated_completion", now + timedelta(hours=max(1, sla_standard_hours)))


def enforce_repair_delivery_policy(db: Session, repair: Any) -> None:
    state = _read_state(db)
    business_ops = (state.get("business_ops") or {}) if isinstance(state, dict) else {}
    repair_rules = business_ops.get("repair_rules") or {}
    require_full_settlement = bool(repair_rules.get("require_full_settlement_before_delivery", True))
    if not require_full_settlement:
        return
    outstanding = float(getattr(repair, "outstanding_balance", 0) or 0)
    if outstanding > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Repair cannot be delivered with outstanding balance ({outstanding:.2f}).",
        )


def enforce_void_refund_policy(
    db: Session,
    *,
    user: User | None,
    action: str,
    amount: float,
) -> None:
    if not void_refund_approval_required(db, action=action, amount=amount):
        return
    if _is_manager_or_higher(user):
        return
    threshold = _void_refund_threshold(db, action=action)
    raise HTTPException(
        status_code=403,
        detail=(
            f"{action.title()} above {threshold:.2f} requires Manager/Admin/Owner approval."
        ),
    )


def _void_refund_threshold(db: Session, *, action: str) -> float:
    state = _read_state(db)
    business_ops = (state.get("business_ops") or {}) if isinstance(state, dict) else {}
    sales_rules = business_ops.get("sales_pos_rules") or {}
    notifications = (state.get("notifications_alerts") or {}).get("in_app_notifications", {})

    default_threshold = float(
        (
            notifications.get("large_transaction_alert", {}) or {}
        ).get("amount", 100000)
        or 100000
    )
    if str(action).lower() == "refund":
        return float(sales_rules.get("refund_approval_threshold", default_threshold) or default_threshold)
    return float(sales_rules.get("void_approval_threshold", default_threshold) or default_threshold)


def void_refund_approval_required(
    db: Session,
    *,
    action: str,
    amount: float,
) -> bool:
    threshold = _void_refund_threshold(db, action=action)
    if threshold <= 0 or amount <= threshold:
        return False
    return True


def enforce_stock_adjustment_policy(
    db: Session,
    *,
    user: User | None,
    quantity_change: int,
    unit_cost: float,
) -> None:
    if not stock_adjustment_approval_required(db, quantity_change=quantity_change, unit_cost=unit_cost):
        return
    if _is_manager_or_higher(user):
        return
    raise HTTPException(
        status_code=403,
        detail=(
            "Stock adjustment exceeds approval threshold and requires Manager/Admin/Owner approval."
        ),
    )


def stock_adjustment_approval_required(
    db: Session,
    *,
    quantity_change: int,
    unit_cost: float,
) -> bool:
    state = _read_state(db)
    business_ops = (state.get("business_ops") or {}) if isinstance(state, dict) else {}
    inventory_rules = business_ops.get("inventory_rules") or {}
    qty_threshold = int(inventory_rules.get("stock_adjustment_approval_threshold_qty", 25) or 25)
    value_threshold = float(inventory_rules.get("stock_adjustment_approval_threshold_value", 50000) or 50000)

    qty_abs = abs(int(quantity_change or 0))
    value_abs = abs(float(quantity_change or 0) * float(unit_cost or 0))
    needs_approval = (qty_threshold > 0 and qty_abs >= qty_threshold) or (
        value_threshold > 0 and value_abs >= value_threshold
    )
    return bool(needs_approval)
