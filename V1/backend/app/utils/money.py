from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

MONEY_QUANT = Decimal("0.01")
MONEY_TOLERANCE = Decimal("0.01")


def to_decimal(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0.00")
    if isinstance(value, Decimal):
        raw = value
    else:
        try:
            raw = Decimal(str(value))
        except (InvalidOperation, ValueError, TypeError):
            raw = Decimal("0.00")
    return raw.quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)


def to_float(value: Any) -> float:
    return float(to_decimal(value))


def add(*values: Any) -> Decimal:
    total = Decimal("0.00")
    for value in values:
        total += to_decimal(value)
    return to_decimal(total)


def sub(left: Any, right: Any) -> Decimal:
    return to_decimal(to_decimal(left) - to_decimal(right))


def mul(left: Any, right: Any) -> Decimal:
    return to_decimal(to_decimal(left) * to_decimal(right))


def equals(left: Any, right: Any, *, tolerance: Decimal = MONEY_TOLERANCE) -> bool:
    return abs(to_decimal(left) - to_decimal(right)) <= tolerance


def compare(left: Any, right: Any) -> int:
    a = to_decimal(left)
    b = to_decimal(right)
    if equals(a, b):
        return 0
    return 1 if a > b else -1
