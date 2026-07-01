from datetime import datetime

from sqlalchemy import text
from sqlalchemy.orm import Session
from app.utils.time import utcnow


SUPPORTED_PREFIXES = {
    "INV",
    "RINV",
    "JOB",
    "PO",
    "GRN",
    "RET",
    "RFD",
    "CRD",
    "EXC",
    "WRN",
    "WCL",
    "ADV",
    "PAY",
    "LED",
    "APR",
    "RSV",
    "ORD",
}


def _utcnow() -> datetime:
    return utcnow()


def next_number(db: Session, prefix: str, now: datetime | None = None) -> str:
    prefix_upper = str(prefix or "").strip().upper()
    if prefix_upper not in SUPPORTED_PREFIXES:
        raise ValueError(f"Unsupported sequence prefix: {prefix}")

    timestamp = now or _utcnow()
    year = int(timestamp.year)
    current_ts = timestamp.isoformat()

    # Atomic sequence increment for SQLite using ON CONFLICT upsert.
    # This prevents duplicate numbers under concurrent requests.
    stmt = text(
        """
        INSERT INTO number_sequences (entity, year, current_value, updated_at)
        VALUES (:entity, :year, 1, :updated_at)
        ON CONFLICT(entity, year)
        DO UPDATE SET
            current_value = number_sequences.current_value + 1,
            updated_at = :updated_at
        RETURNING current_value
        """
    )
    current_value = db.execute(
        stmt,
        {
            "entity": prefix_upper,
            "year": year,
            "updated_at": current_ts,
        },
    ).scalar_one()
    return f"{prefix_upper}-{year}-{int(current_value):06d}"
