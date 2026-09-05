from datetime import datetime

from app.routers.audit_trail_router import _coerce_dt, _parse_dt


def test_audit_datetime_filters_normalize_timezone_aware_values():
    start = _parse_dt("2026-09-01")
    event = _coerce_dt("2026-09-05T22:27:57+00:00")

    assert start == datetime(2026, 9, 1)
    assert event == datetime(2026, 9, 5, 22, 27, 57)
    assert event >= start


def test_audit_end_date_remains_exclusive_after_normalization():
    end = _parse_dt("2026-09-05", end_exclusive=True)

    assert end == datetime(2026, 9, 6)

