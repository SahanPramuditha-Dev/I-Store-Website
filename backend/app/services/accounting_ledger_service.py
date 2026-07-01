import json
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models import AccountingLedgerEntry, User
from app.services.numbering_service import next_number
from app.utils.money import to_float
from app.utils.time import utcnow


def _money(value: float | int | None) -> float:
    return to_float(value)


def record_ledger_entry(
    db: Session,
    *,
    module: str,
    entry_type: str,
    direction: str,
    amount: float | int,
    account_code: str | None = None,
    reference_type: str | None = None,
    reference_id: int | None = None,
    reference_number: str | None = None,
    source_table: str | None = None,
    source_id: int | None = None,
    counterparty_type: str | None = None,
    counterparty_id: int | None = None,
    counterparty_name: str | None = None,
    description: str | None = None,
    metadata: dict[str, Any] | None = None,
    user: User | None = None,
    entry_date: datetime | None = None,
    currency: str = "LKR",
) -> AccountingLedgerEntry:
    normalized_amount = _money(amount)
    if normalized_amount < 0:
        raise ValueError("Ledger amount cannot be negative")
    normalized_direction = str(direction or "").strip().lower()
    if normalized_direction not in {"debit", "credit", "memo"}:
        raise ValueError("Ledger direction must be debit, credit, or memo")

    row = AccountingLedgerEntry(
        entry_number=next_number(db, "LED"),
        entry_date=entry_date or utcnow(),
        module=str(module or "").strip(),
        entry_type=str(entry_type or "").strip(),
        direction=normalized_direction,
        amount=normalized_amount,
        currency=currency,
        account_code=account_code,
        reference_type=reference_type,
        reference_id=reference_id,
        reference_number=reference_number,
        source_table=source_table,
        source_id=source_id,
        counterparty_type=counterparty_type,
        counterparty_id=counterparty_id,
        counterparty_name=counterparty_name,
        description=description,
        metadata_json=json.dumps(metadata or {}, sort_keys=True, default=str),
        created_by_user_id=user.id if user else None,
    )
    db.add(row)
    db.flush()
    return row


def serialize_ledger_entry(row: AccountingLedgerEntry) -> dict[str, Any]:
    metadata: dict[str, Any] = {}
    if row.metadata_json:
        try:
            parsed = json.loads(row.metadata_json)
            metadata = parsed if isinstance(parsed, dict) else {}
        except Exception:
            metadata = {}
    return {
        "id": row.id,
        "entry_number": row.entry_number,
        "entry_date": row.entry_date.isoformat() if row.entry_date else None,
        "module": row.module,
        "entry_type": row.entry_type,
        "direction": row.direction,
        "amount": float(row.amount or 0),
        "currency": row.currency,
        "account_code": row.account_code,
        "counterparty_type": row.counterparty_type,
        "counterparty_id": row.counterparty_id,
        "counterparty_name": row.counterparty_name,
        "reference_type": row.reference_type,
        "reference_id": row.reference_id,
        "reference_number": row.reference_number,
        "source_table": row.source_table,
        "source_id": row.source_id,
        "description": row.description,
        "metadata": metadata,
        "created_by_user_id": row.created_by_user_id,
        "created_by_name": row.created_by.full_name if row.created_by else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
