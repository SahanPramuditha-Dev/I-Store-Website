const REPAIR_STATUS_ALIASES = {
  pending: "pending",
  received: "pending",
  diagnosing: "diagnosing",
  "in progress": "repairing",
  "in-progress": "repairing",
  repairing: "repairing",
  "waiting for approval": "waiting_for_approval",
  waiting_for_approval: "waiting_for_approval",
  "waiting approval": "waiting_for_approval",
  "waiting for parts": "waiting_for_parts",
  waiting_for_parts: "waiting_for_parts",
  "quality checking": "quality_checking",
  quality_checking: "quality_checking",
  "quality check": "quality_checking",
  completed: "completed",
  delivered: "delivered",
  cancelled: "cancelled",
  canceled: "cancelled",
};

export function normalizeRepairStatus(value) {
  const key = String(value || "").trim().toLowerCase();
  return REPAIR_STATUS_ALIASES[key] || key;
}

export function isRepairDelivered(value) {
  return normalizeRepairStatus(value) === "delivered";
}

export function isRepairCancelled(value) {
  return normalizeRepairStatus(value) === "cancelled";
}

export function isRepairClosed(value) {
  const status = normalizeRepairStatus(value);
  return status === "completed" || status === "delivered" || status === "cancelled";
}

export function repairStatusLabel(value) {
  const status = normalizeRepairStatus(value);
  const labels = {
    pending: "Pending",
    diagnosing: "Diagnosing",
    waiting_for_approval: "Waiting for Approval",
    waiting_for_parts: "Waiting for Parts",
    repairing: "Repairing",
    quality_checking: "Quality Checking",
    completed: "Completed",
    delivered: "Delivered",
    cancelled: "Cancelled",
  };
  return labels[status] || String(value || "");
}
