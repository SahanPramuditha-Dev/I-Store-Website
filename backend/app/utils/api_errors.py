from dataclasses import dataclass
from typing import Any


ERROR_INSUFFICIENT_STOCK = "INSUFFICIENT_STOCK"
ERROR_REPAIR_NOT_FOUND = "REPAIR_NOT_FOUND"
ERROR_INVALID_STATUS_TRANSITION = "INVALID_STATUS_TRANSITION"
ERROR_PERMISSION_DENIED = "PERMISSION_DENIED"
ERROR_CUSTOMER_NOT_FOUND = "CUSTOMER_NOT_FOUND"
ERROR_INVOICE_LOCKED = "INVOICE_LOCKED"
ERROR_INVALID_PAYMENT = "INVALID_PAYMENT"
ERROR_BACKUP_FAILED = "BACKUP_FAILED"
ERROR_VALIDATION_FAILED = "VALIDATION_FAILED"
ERROR_NOT_FOUND = "NOT_FOUND"
ERROR_UNAUTHORIZED = "UNAUTHORIZED"
ERROR_INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR"


@dataclass
class ApiError(Exception):
    message: str
    error_code: str
    status_code: int = 400
    details: Any | None = None


def map_http_error_code(status_code: int, detail: Any) -> str:
    text = str(detail or "").strip().lower()
    if status_code == 401:
        return ERROR_UNAUTHORIZED
    if status_code == 403:
        return ERROR_PERMISSION_DENIED
    if status_code == 404:
        if "repair" in text:
            return ERROR_REPAIR_NOT_FOUND
        if "customer" in text:
            return ERROR_CUSTOMER_NOT_FOUND
        return ERROR_NOT_FOUND
    if status_code == 422:
        return ERROR_VALIDATION_FAILED
    if "insufficient stock" in text or "not enough stock" in text:
        return ERROR_INSUFFICIENT_STOCK
    if "invalid repair status transition" in text or "invalid status transition" in text:
        return ERROR_INVALID_STATUS_TRANSITION
    if "invoice has been locked" in text or "invoice locked" in text:
        return ERROR_INVOICE_LOCKED
    if "invalid payment" in text:
        return ERROR_INVALID_PAYMENT
    if "backup" in text and ("failed" in text or "error" in text):
        return ERROR_BACKUP_FAILED
    return ERROR_INTERNAL_SERVER_ERROR if status_code >= 500 else ERROR_VALIDATION_FAILED
