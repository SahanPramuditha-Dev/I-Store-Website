REPAIR_STATUS_PENDING = "pending"
REPAIR_STATUS_DIAGNOSING = "diagnosing"
REPAIR_STATUS_WAITING_FOR_APPROVAL = "waiting_for_approval"
REPAIR_STATUS_WAITING_FOR_PARTS = "waiting_for_parts"
REPAIR_STATUS_REPAIRING = "repairing"
REPAIR_STATUS_QUALITY_CHECKING = "quality_checking"
REPAIR_STATUS_COMPLETED = "completed"
REPAIR_STATUS_DELIVERED = "delivered"
REPAIR_STATUS_CANCELLED = "cancelled"

REPAIR_STATUSES = [
    REPAIR_STATUS_PENDING,
    REPAIR_STATUS_DIAGNOSING,
    REPAIR_STATUS_WAITING_FOR_APPROVAL,
    REPAIR_STATUS_WAITING_FOR_PARTS,
    REPAIR_STATUS_REPAIRING,
    REPAIR_STATUS_QUALITY_CHECKING,
    REPAIR_STATUS_COMPLETED,
    REPAIR_STATUS_DELIVERED,
    REPAIR_STATUS_CANCELLED,
]

REPAIR_STATUS_ALIASES = {
    "pending": REPAIR_STATUS_PENDING,
    "received": REPAIR_STATUS_PENDING,
    "diagnosing": REPAIR_STATUS_DIAGNOSING,
    "in progress": REPAIR_STATUS_REPAIRING,
    "in-progress": REPAIR_STATUS_REPAIRING,
    "repairing": REPAIR_STATUS_REPAIRING,
    "waiting for approval": REPAIR_STATUS_WAITING_FOR_APPROVAL,
    "waiting_for_approval": REPAIR_STATUS_WAITING_FOR_APPROVAL,
    "waiting approval": REPAIR_STATUS_WAITING_FOR_APPROVAL,
    "waiting for parts": REPAIR_STATUS_WAITING_FOR_PARTS,
    "waiting_for_parts": REPAIR_STATUS_WAITING_FOR_PARTS,
    "quality checking": REPAIR_STATUS_QUALITY_CHECKING,
    "quality_checking": REPAIR_STATUS_QUALITY_CHECKING,
    "quality check": REPAIR_STATUS_QUALITY_CHECKING,
    "completed": REPAIR_STATUS_COMPLETED,
    "delivered": REPAIR_STATUS_DELIVERED,
    "cancelled": REPAIR_STATUS_CANCELLED,
    "canceled": REPAIR_STATUS_CANCELLED,
}

REPAIR_STATUS_LABELS = {
    REPAIR_STATUS_PENDING: "Pending",
    REPAIR_STATUS_DIAGNOSING: "Diagnosing",
    REPAIR_STATUS_WAITING_FOR_APPROVAL: "Waiting for Approval",
    REPAIR_STATUS_WAITING_FOR_PARTS: "Waiting for Parts",
    REPAIR_STATUS_REPAIRING: "Repairing",
    REPAIR_STATUS_QUALITY_CHECKING: "Quality Checking",
    REPAIR_STATUS_COMPLETED: "Completed",
    REPAIR_STATUS_DELIVERED: "Delivered",
    REPAIR_STATUS_CANCELLED: "Cancelled",
}

SALE_LINE_TYPES = {"product", "spare_part", "labor", "service", "discount", "adjustment", "manual_product"}
SALE_INVENTORY_LINE_TYPES = {"product", "spare_part"}

REPAIR_CLOSED_STATUSES = {
    REPAIR_STATUS_COMPLETED,
    REPAIR_STATUS_DELIVERED,
    REPAIR_STATUS_CANCELLED,
}


def normalize_repair_status(value: str | None) -> str:
    key = str(value or "").strip().lower()
    return REPAIR_STATUS_ALIASES.get(key, key)


def is_repair_closed_status(value: str | None) -> bool:
    return normalize_repair_status(value) in REPAIR_CLOSED_STATUSES


def is_repair_delivered_status(value: str | None) -> bool:
    return normalize_repair_status(value) == REPAIR_STATUS_DELIVERED


def is_repair_cancelled_status(value: str | None) -> bool:
    return normalize_repair_status(value) == REPAIR_STATUS_CANCELLED
