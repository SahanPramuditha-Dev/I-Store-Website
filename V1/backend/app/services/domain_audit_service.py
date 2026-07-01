import json
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import AccountingPeriod, AuditLog, SecurityAuditLog, User
from app.utils.time import utcnow


def _json(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, default=str, sort_keys=True)


def record_domain_audit(
    db: Session,
    *,
    module: str,
    action: str,
    target_type: str,
    target_id: int | None,
    user: User | None,
    old_value: Any = None,
    new_value: Any = None,
    reason: str | None = None,
    permission: str | None = None,
    ip_address: str | None = None,
    device_name: str | None = None,
    result: str = "success",
) -> AuditLog:
    metadata = {
        "reason": reason,
        "permission": permission,
        "immutable": True,
        "old_value": old_value,
        "new_value": new_value,
    }
    row = AuditLog(
        user_id=user.id if user else None,
        module=str(module or "domain").upper(),
        action=action,
        target_type=target_type,
        target_id=target_id,
        old_value=_json(old_value),
        new_value=_json(new_value),
        ip_address=ip_address,
        device_name=device_name,
        created_at=utcnow(),
    )
    db.add(row)
    db.add(
        SecurityAuditLog(
            user_id=user.id if user else None,
            action=f"{module}.{action}",
            target_type=target_type,
            target_id=target_id,
            target_ref=str(target_id) if target_id is not None else None,
            detail=reason or f"{module} {action}",
            ip_address=ip_address,
            device_info=device_name,
            result=result,
            metadata_json=_json(metadata),
            created_at=utcnow(),
        )
    )
    return row


def assert_accounting_period_open(
    db: Session,
    *,
    when,
    action: str,
) -> None:
    if when is None:
        when = utcnow()
    row = (
        db.query(AccountingPeriod)
        .filter(
            AccountingPeriod.status == "closed",
            AccountingPeriod.start_date <= when,
            AccountingPeriod.end_date >= when,
        )
        .first()
    )
    if row:
        raise HTTPException(
            status_code=423,
            detail=f"Accounting period {row.period_code} is closed; cannot {action}.",
        )
