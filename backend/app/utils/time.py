from datetime import datetime, timezone
from typing import Optional


def utcnow() -> datetime:
    """
    Return naive UTC datetime without using deprecated datetime.utcnow().
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


def format_iso_utc(dt: Optional[datetime]) -> Optional[str]:
    """
    Ensures datetime is exported with standard 'Z' UTC indicator
    so frontend browsers correctly convert to the user's local timezone.
    """
    if not dt:
        return None
    iso = dt.isoformat()
    if iso.endswith("Z") or "+" in iso:
        return iso
    return iso + "Z"
