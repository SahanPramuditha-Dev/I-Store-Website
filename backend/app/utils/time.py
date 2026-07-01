from datetime import datetime, timezone


def utcnow() -> datetime:
    """
    Return naive UTC datetime without using deprecated datetime.utcnow().
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)

