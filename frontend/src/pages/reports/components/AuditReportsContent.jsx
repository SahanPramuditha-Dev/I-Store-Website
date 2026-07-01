import { useEffect, useMemo, useState } from "react";
import {
  Eye,
  FilePenLine,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  UserCheck,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge, KpiCard, SectionCard, Table, Select } from "../../../components/UI";

const DAY_MS = 1000 * 60 * 60 * 24;
const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const PIE_COLORS = ["#22c55e", "#38bdf8", "#f59e0b", "#ef4444", "#a78bfa", "#14b8a6"];
const SUB_REPORT_TABS = [
  { key: "system-activity", label: "System Activity Log" },
  { key: "invoice-edits", label: "Invoice Edit Log" },
  { key: "deleted-records", label: "Deleted Records Log" },
  { key: "stock-adjustments", label: "Stock Adjustment Log" },
  { key: "login-history", label: "Login History" },
  { key: "repair-status", label: "Repair Status Change Log" },
  { key: "permission-change", label: "Permission Change Log" },
  { key: "discount-override", label: "Discount Override Log" },
  { key: "price-change", label: "Price Change Log" },
  { key: "cash-drawer", label: "Cash Drawer Open Events" },
  { key: "export-log", label: "Report Export Log" },
  { key: "backup-log", label: "Data Backup Log" },
  { key: "suspicious-flags", label: "Suspicious Activity Flags" },
];

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateInput(value, endExclusive = false) {
  if (!value) return null;
  const date = toDate(`${value}T00:00:00`);
  if (!date) return null;
  if (!endExclusive) return date;
  const copy = new Date(date);
  copy.setDate(copy.getDate() + 1);
  return copy;
}

function inDateRange(value, start, endExclusive) {
  const date = toDate(value);
  if (!date) return false;
  if (start && date < start) return false;
  if (endExclusive && date >= endExclusive) return false;
  return true;
}

function toDayKey(value) {
  const date = toDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function toHour(value) {
  const date = toDate(value);
  if (!date) return null;
  return date.getHours();
}

function toneForSeverity(severity) {
  const value = String(severity || "").toLowerCase();
  if (value.includes("critical")) return "red";
  if (value.includes("warning")) return "amber";
  return "indigo";
}

function inferSeverityFromAction(action, description) {
  const actionText = String(action || "").toLowerCase();
  const detail = String(description || "").toLowerCase();
  if (actionText.includes("delete") || actionText.includes("void") || actionText.includes("failed")) {
    return "Critical";
  }
  if (actionText.includes("adjust") || actionText.includes("update") || detail.includes("override")) {
    return "Warning";
  }
  return "Info";
}

function safeJsonText(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseBackupFilename(name) {
  if (!name || typeof name !== "string") return null;
  const match = name.match(/^(manual|auto|pre_restore)_([0-9]{8})_([0-9]{6})\.db$/);
  if (!match) return null;
  const [, type, datePart, timePart] = match;
  const isoLike = `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T${timePart.slice(
    0,
    2,
  )}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}`;
  const parsed = toDate(isoLike);
  return {
    type,
    timestamp: parsed ? parsed.toISOString() : null,
  };
}

function MiniTable({ columns, rows, emptyLabel = "No records found." }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
      <Table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.label}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="py-6 text-slate-400">
                {emptyLabel}
              </td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr key={row.id || row.key || index}>
              {columns.map((col) => (
                <td key={`${row.id || index}-${col.label}`}>
                  {typeof col.value === "function" ? col.value(row, index) : row[col.value]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export default function AuditReportsContent({
  salesRows,
  repairRows,
  inventoryRows,
  movementRows,
  notificationsRows,
  dashboard,
  auditActivityRows,
  auditRepairHistoryRows,
  priceAdjustmentRows,
  discountsRows,
  backupRows,
  employeesRows,
  dateFrom,
  dateTo,
  query,
  onPrepared,
}) {
  const [activeSubReport, setActiveSubReport] = useState("system-activity");
  const [rangeFrom, setRangeFrom] = useState(dateFrom || "");
  const [rangeTo, setRangeTo] = useState(dateTo || "");
  const [userFilter, setUserFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");

  useEffect(() => {
    setRangeFrom(dateFrom || "");
    setRangeTo(dateTo || "");
  }, [dateFrom, dateTo]);

  const rangeStart = useMemo(() => parseDateInput(rangeFrom), [rangeFrom]);
  const rangeEnd = useMemo(() => parseDateInput(rangeTo, true), [rangeTo]);
  const normalizedQuery = (query || "").trim().toLowerCase();

  const inventoryById = useMemo(
    () => Object.fromEntries((inventoryRows || []).map((item) => [String(item.id), item])),
    [inventoryRows],
  );

  const fallbackActivityRows = useMemo(() => {
    const rows = [];

    (notificationsRows || []).forEach((notification) => {
      rows.push({
        id: `notif-${notification.id}`,
        timestamp: notification.created_at,
        user: "System",
        actionType: "Notification",
        module: notification.entity_type || notification.type || "System",
        recordId: notification.entity_id || notification.id,
        oldValue: null,
        newValue: notification.message || notification.title,
        ipAddress: "-",
        device: "-",
        severity: String(notification.type || "").toLowerCase().includes("overdue") ? "Critical" : "Info",
        description: notification.title || "Notification Event",
      });
    });

    (movementRows || []).forEach((movement) => {
      rows.push({
        id: `move-${movement.id}`,
        timestamp: movement.created_at,
        user: "System",
        actionType: movement.movement_type === "ADJUSTMENT" ? "Adjustment" : "Stock Movement",
        module: "Inventory",
        recordId: movement.reference_id || movement.id,
        oldValue: null,
        newValue: `${movement.item_name || "Item"} qty ${movement.quantity}`,
        ipAddress: "-",
        device: "-",
        severity: movement.movement_type === "ADJUSTMENT" ? "Warning" : "Info",
        description: movement.note || movement.reference_type || movement.movement_type,
      });
    });

    (salesRows || [])
      .filter((sale) => sale.is_voided || sale.is_return || Number(sale.discount_amount || 0) > 0)
      .forEach((sale) => {
        rows.push({
          id: `sale-${sale.id}`,
          timestamp: sale.created_at,
          user: "System",
          actionType: sale.is_voided ? "Void" : sale.is_return ? "Return" : "Update",
          module: "Sales",
          recordId: sale.id,
          oldValue: null,
          newValue: `Invoice ${sale.invoice_no || sale.id}`,
          ipAddress: "-",
          device: "-",
          severity: sale.is_voided ? "Critical" : "Warning",
          description: sale.void_reason || "Invoice event",
        });
      });

    (repairRows || [])
      .filter((repair) => String(repair.status || "").toLowerCase().includes("cancel"))
      .forEach((repair) => {
        rows.push({
          id: `repair-cancel-${repair.id}`,
          timestamp: repair.cancelled_at || repair.created_at,
          user: "System",
          actionType: "Delete",
          module: "Repairs",
          recordId: repair.id,
          oldValue: repair.status,
          newValue: "Cancelled",
          ipAddress: "-",
          device: "-",
          severity: "Critical",
          description: repair.cancellation_reason || "Repair cancelled",
        });
      });

    if (Array.isArray(dashboard?.activity_feed)) {
      dashboard.activity_feed.forEach((event, index) => {
        rows.push({
          id: `dash-${event.id || index}`,
          timestamp: event.timestamp,
          user: event.user || "System",
          actionType: event.action || "Activity",
          module: event.module || "System",
          recordId: event.id || index,
          oldValue: null,
          newValue: event.details || null,
          ipAddress: "-",
          device: "-",
          severity: inferSeverityFromAction(event.action, event.details),
          description: event.details || event.action || "Activity feed event",
        });
      });
    }

    return rows;
  }, [dashboard, movementRows, notificationsRows, repairRows, salesRows]);

  const baseSystemActivityRows = useMemo(() => {
    if ((auditActivityRows || []).length > 0) {
      return (auditActivityRows || []).map((row) => ({
        id: `act-${row.id}`,
        timestamp: row.timestamp || row.created_at,
        user: row.user || "System",
        actionType: row.action_type || row.action || "Activity",
        module: row.module || row.entity_type || "System",
        recordId: row.record_id ?? row.entity_id ?? row.id,
        oldValue: row.old_value ?? row.old_value_raw ?? null,
        newValue: row.new_value ?? row.new_value_raw ?? null,
        ipAddress: row.ip_address || "-",
        device: row.device || row.device_info || "-",
        severity: row.severity || inferSeverityFromAction(row.action_type || row.action, row.description),
        description: row.description || "-",
        recoverable: Boolean(row.recoverable),
      }));
    }
    return fallbackActivityRows;
  }, [auditActivityRows, fallbackActivityRows]);

  const options = useMemo(() => {
    const users = new Set();
    const actions = new Set();
    const modules = new Set();
    const severities = new Set(["Info", "Warning", "Critical"]);
    baseSystemActivityRows.forEach((row) => {
      users.add(row.user || "System");
      actions.add(row.actionType || "Activity");
      modules.add(row.module || "System");
      severities.add(row.severity || "Info");
    });
    return {
      users: [...users].sort((a, b) => a.localeCompare(b)),
      actions: [...actions].sort((a, b) => a.localeCompare(b)),
      modules: [...modules].sort((a, b) => a.localeCompare(b)),
      severities: [...severities].sort((a, b) => a.localeCompare(b)),
    };
  }, [baseSystemActivityRows]);

  const filteredSystemActivityRows = useMemo(() => {
    return baseSystemActivityRows
      .filter((row) => {
        if (!inDateRange(row.timestamp, rangeStart, rangeEnd)) return false;
        if (userFilter !== "all" && row.user !== userFilter) return false;
        if (actionFilter !== "all" && row.actionType !== actionFilter) return false;
        if (moduleFilter !== "all" && row.module !== moduleFilter) return false;
        if (severityFilter !== "all" && String(row.severity || "").toLowerCase() !== severityFilter) {
          return false;
        }
        if (!normalizedQuery) return true;
        const hay = `${row.user} ${row.actionType} ${row.module} ${row.recordId} ${row.ipAddress} ${row.device} ${safeJsonText(row.oldValue)} ${safeJsonText(row.newValue)} ${row.description}`.toLowerCase();
        return hay.includes(normalizedQuery);
      })
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [
    baseSystemActivityRows,
    rangeStart,
    rangeEnd,
    userFilter,
    actionFilter,
    moduleFilter,
    severityFilter,
    normalizedQuery,
  ]);

  const invoiceEditRows = useMemo(() => {
    const auditRows = filteredSystemActivityRows
      .filter((row) => String(row.module || "").toLowerCase().includes("sale"))
      .filter((row) => {
        const action = String(row.actionType || "").toLowerCase();
        return action.includes("update") || action.includes("void") || action.includes("edit");
      })
      .map((row) => ({
        id: `invoice-audit-${row.id}`,
        timestamp: row.timestamp,
        invoiceNo: `INV-${String(row.recordId || "").padStart(5, "0")}`,
        fieldChanged: row.actionType || "Update",
        oldValue: safeJsonText(row.oldValue),
        newValue: safeJsonText(row.newValue),
        editedBy: row.user,
        reason: row.description || "-",
      }));

    const saleRows = (salesRows || [])
      .filter((sale) => inDateRange(sale.created_at, rangeStart, rangeEnd))
      .filter((sale) => sale.is_voided || Number(sale.discount_amount || 0) > 0 || Number(sale.tax_amount || 0) > 0)
      .map((sale) => ({
        id: `invoice-sale-${sale.id}`,
        timestamp: sale.created_at,
        invoiceNo: sale.invoice_no || `INV-${sale.id}`,
        fieldChanged: sale.is_voided ? "Voided" : Number(sale.discount_amount || 0) > 0 ? "Discount Override" : "Tax Applied",
        oldValue: "-",
        newValue: sale.is_voided ? "Voided" : `Discount LKR ${Number(sale.discount_amount || 0).toFixed(2)}`,
        editedBy: "System",
        reason: sale.void_reason || "-",
      }));

    return [...auditRows, ...saleRows].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [filteredSystemActivityRows, salesRows, rangeStart, rangeEnd]);

  const deletedRecordsRows = useMemo(() => {
    const fromAudit = filteredSystemActivityRows
      .filter((row) => {
        const action = String(row.actionType || "").toLowerCase();
        return action.includes("delete") || action.includes("void") || action.includes("cancel");
      })
      .map((row) => ({
        id: `del-${row.id}`,
        timestamp: row.timestamp,
        recordType: row.module || "System",
        recordId: row.recordId,
        details: row.description || safeJsonText(row.newValue),
        deletedBy: row.user || "System",
        recoverable: row.recoverable ? "Yes" : "No",
      }));

    return fromAudit.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [filteredSystemActivityRows]);

  const stockAdjustmentRows = useMemo(() => {
    const fromAudit = filteredSystemActivityRows
      .filter((row) => {
        const action = String(row.actionType || "").toLowerCase();
        const module = String(row.module || "").toLowerCase();
        return action.includes("adjust") || module.includes("inventory");
      })
      .map((row) => {
        const oldQty = Number(row.oldValue?.quantity ?? row.oldValue?.qty ?? 0);
        const newQty = Number(row.newValue?.quantity ?? row.newValue?.qty ?? 0);
        const itemId = String(row.recordId || "");
        return {
          id: `adj-audit-${row.id}`,
          date: row.timestamp,
          product: inventoryById[itemId]?.name || `Item #${itemId}`,
          qtyBefore: oldQty || null,
          qtyAfter: newQty || null,
          reason: row.description || "-",
          adjustedBy: row.user || "System",
          approvedBy: "System",
        };
      });

    const fromMovements = (movementRows || [])
      .filter((movement) => String(movement.movement_type || "").toLowerCase() === "adjustment")
      .filter((movement) => inDateRange(movement.created_at, rangeStart, rangeEnd))
      .map((movement) => {
        const item = inventoryById[String(movement.item_id)];
        const qtyAfter = Number(item?.quantity || 0);
        const qtyBefore = qtyAfter - Number(movement.quantity || 0);
        return {
          id: `adj-mov-${movement.id}`,
          date: movement.created_at,
          product: movement.item_name || item?.name || `Item #${movement.item_id}`,
          qtyBefore,
          qtyAfter,
          reason: movement.note || "Manual stock adjustment",
          adjustedBy: "System",
          approvedBy: "System",
        };
      });

    return [...fromAudit, ...fromMovements].sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [filteredSystemActivityRows, movementRows, rangeStart, rangeEnd, inventoryById]);

  const loginHistoryRows = useMemo(() => {
    const fromAudit = filteredSystemActivityRows
      .filter((row) => {
        const action = String(row.actionType || "").toLowerCase();
        const description = String(row.description || "").toLowerCase();
        return action.includes("login") || action.includes("logout") || action.includes("auth") || description.includes("login");
      })
      .map((row) => {
        const actionText = String(row.actionType || "").toLowerCase();
        let action = "Login";
        if (actionText.includes("logout")) action = "Logout";
        if (actionText.includes("failed") || String(row.description || "").toLowerCase().includes("failed")) {
          action = "Failed";
        }
        return {
          id: `login-${row.id}`,
          timestamp: row.timestamp,
          user: row.user || "Unknown",
          action,
          ipAddress: row.ipAddress || "-",
          device: row.device || "-",
          sessionDuration: "-",
        };
      });
    return fromAudit.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [filteredSystemActivityRows]);

  const repairStatusChangeRows = useMemo(() => {
    if ((auditRepairHistoryRows || []).length > 0) {
      return (auditRepairHistoryRows || [])
        .filter((row) => inDateRange(row.timestamp, rangeStart, rangeEnd))
        .map((row) => ({
          id: `rep-h-${row.id}`,
          timestamp: row.timestamp,
          jobId: row.job_id || `Repair #${row.repair_id}`,
          oldStatus: row.old_status || "-",
          newStatus: row.new_status || "-",
          changedBy: row.changed_by || "System",
          notes: row.notes || "-",
        }))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    return (repairRows || [])
      .filter((row) => inDateRange(row.created_at, rangeStart, rangeEnd))
      .map((row) => ({
        id: `rep-f-${row.id}`,
        timestamp: row.delivered_at || row.created_at,
        jobId: row.ticket_no || `Repair #${row.id}`,
        oldStatus: "Intake",
        newStatus: row.status || "Pending",
        changedBy: row.technician || "System",
        notes: row.cancellation_reason || "-",
      }))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [auditRepairHistoryRows, repairRows, rangeStart, rangeEnd]);

  const permissionChangeRows = useMemo(() => {
    const fromAudit = filteredSystemActivityRows
      .filter((row) => {
        const action = String(row.actionType || "").toLowerCase();
        const module = String(row.module || "").toLowerCase();
        const detail = String(row.description || "").toLowerCase();
        return module.includes("user") || detail.includes("role") || detail.includes("permission") || action.includes("permission");
      })
      .map((row) => ({
        id: `perm-${row.id}`,
        timestamp: row.timestamp,
        employee: row.recordId ? `User #${row.recordId}` : row.user,
        change: row.description || row.actionType,
        oldAccess: safeJsonText(row.oldValue),
        newAccess: safeJsonText(row.newValue),
        changedBy: row.user || "System",
      }));

    return fromAudit.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [filteredSystemActivityRows]);

  const discountOverrideRows = useMemo(() => {
    const thresholdPct = 10;
    return (salesRows || [])
      .filter((sale) => inDateRange(sale.created_at, rangeStart, rangeEnd))
      .map((sale) => {
        const subtotal = Number(sale.subtotal || 0);
        const discount = Number(sale.discount_amount || 0);
        const pct = subtotal > 0 ? (discount / subtotal) * 100 : 0;
        return { sale, subtotal, discount, pct };
      })
      .filter((row) => row.discount > 0 && row.pct >= thresholdPct)
      .map((row) => ({
        id: `disc-${row.sale.id}`,
        timestamp: row.sale.created_at,
        invoiceNo: row.sale.invoice_no || `INV-${row.sale.id}`,
        subtotal: row.subtotal,
        discount: row.discount,
        discountPct: row.pct,
        overriddenBy: "System",
        reason: "Discount exceeded threshold",
      }))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [salesRows, rangeStart, rangeEnd]);

  const priceChangeRows = useMemo(() => {
    return (priceAdjustmentRows || [])
      .filter((row) => inDateRange(row.created_at, rangeStart, rangeEnd))
      .map((row) => ({
        id: `price-${row.id}`,
        timestamp: row.created_at,
        product: row.item_name || `Item #${row.item_id}`,
        oldSalePrice: Number(row.old_sale_price || 0),
        newSalePrice: Number(row.new_sale_price || 0),
        oldCostPrice: Number(row.old_cost_price || 0),
        newCostPrice: Number(row.new_cost_price || 0),
        reason: row.reason || "-",
        changedBy: "System",
      }))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [priceAdjustmentRows, rangeStart, rangeEnd]);

  const cashDrawerOpenRows = useMemo(() => {
    return filteredSystemActivityRows
      .filter((row) => {
        const action = String(row.actionType || "").toLowerCase();
        const detail = String(row.description || "").toLowerCase();
        return action.includes("drawer") || detail.includes("drawer") || detail.includes("cash open");
      })
      .map((row) => ({
        id: `drawer-${row.id}`,
        timestamp: row.timestamp,
        user: row.user || "System",
        reason: row.description || "-",
      }))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [filteredSystemActivityRows]);

  const exportLogRows = useMemo(() => {
    return filteredSystemActivityRows
      .filter((row) => {
        const action = String(row.actionType || "").toLowerCase();
        const detail = String(row.description || "").toLowerCase();
        return action.includes("export") || detail.includes("export") || detail.includes("report");
      })
      .map((row) => ({
        id: `export-${row.id}`,
        timestamp: row.timestamp,
        user: row.user || "System",
        reportName: row.module || "Report",
        format: String(row.description || "").toLowerCase().includes("pdf") ? "PDF" : "CSV/Other",
        details: row.description || "-",
      }))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [filteredSystemActivityRows]);

  const backupLogRows = useMemo(() => {
    return (backupRows || [])
      .map((name, index) => {
        const parsed = parseBackupFilename(name);
        return {
          id: `backup-${index}`,
          fileName: name,
          timestamp: parsed?.timestamp || null,
          backupType:
            parsed?.type === "auto" ? "Auto" : parsed?.type === "manual" ? "Manual" : "Pre-Restore",
          status: "Success",
          details: parsed ? `${parsed.type} backup file present` : "Backup file detected",
        };
      })
      .filter((row) => !row.timestamp || inDateRange(row.timestamp, rangeStart, rangeEnd))
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  }, [backupRows, rangeStart, rangeEnd]);

  const suspiciousFlagsRows = useMemo(() => {
    const flags = [];

    discountOverrideRows.forEach((row) => {
      flags.push({
        id: `flag-discount-${row.id}`,
        timestamp: row.timestamp,
        type: "Large Discount",
        severity: row.discountPct >= 25 ? "Critical" : "Warning",
        detail: `${row.invoiceNo} discount ${row.discountPct.toFixed(1)}%`,
        user: row.overriddenBy,
      });
    });

    loginHistoryRows
      .filter((row) => row.action === "Failed")
      .forEach((row) => {
        flags.push({
          id: `flag-login-failed-${row.id}`,
          timestamp: row.timestamp,
          type: "Failed Login",
          severity: "Critical",
          detail: `${row.user} failed login`,
          user: row.user,
        });
      });

    loginHistoryRows
      .filter((row) => {
        const hour = toHour(row.timestamp);
        return hour !== null && (hour < 6 || hour > 22);
      })
      .forEach((row) => {
        flags.push({
          id: `flag-login-afterhours-${row.id}`,
          timestamp: row.timestamp,
          type: "After-hours Login",
          severity: "Warning",
          detail: `${row.user} login at ${toDate(row.timestamp)?.toLocaleTimeString() || "-"}`,
          user: row.user,
        });
      });

    stockAdjustmentRows
      .filter((row) => Math.abs(Number(row.qtyAfter || 0) - Number(row.qtyBefore || 0)) >= 20)
      .forEach((row) => {
        flags.push({
          id: `flag-adjust-${row.id}`,
          timestamp: row.date,
          type: "Large Stock Adjustment",
          severity: "Warning",
          detail: `${row.product} adjusted ${Number(row.qtyAfter || 0) - Number(row.qtyBefore || 0)}`,
          user: row.adjustedBy,
        });
      });

    return flags.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [discountOverrideRows, loginHistoryRows, stockAdjustmentRows]);

  const kpis = useMemo(() => {
    const failedLogins = loginHistoryRows.filter((row) => row.action === "Failed").length;
    const today = new Date();
    const todayKey = toDayKey(today);
    const activeUsersToday = new Set(
      filteredSystemActivityRows
        .filter((row) => toDayKey(row.timestamp) === todayKey)
        .map((row) => row.user || "System"),
    ).size;
    return {
      totalSystemActions: filteredSystemActivityRows.length,
      invoiceEdits: invoiceEditRows.length,
      deletedRecords: deletedRecordsRows.length,
      stockAdjustments: stockAdjustmentRows.length,
      failedLoginAttempts: failedLogins,
      activeUsersToday,
    };
  }, [filteredSystemActivityRows, invoiceEditRows, deletedRecordsRows, stockAdjustmentRows, loginHistoryRows]);

  const activityByUserRows = useMemo(() => {
    const map = {};
    filteredSystemActivityRows.forEach((row) => {
      const user = row.user || "System";
      map[user] = (map[user] || 0) + 1;
    });
    return Object.entries(map)
      .map(([user, actions]) => ({ user, actions }))
      .sort((a, b) => b.actions - a.actions)
      .slice(0, 12);
  }, [filteredSystemActivityRows]);

  const actionTypeDistributionRows = useMemo(() => {
    const map = {};
    filteredSystemActivityRows.forEach((row) => {
      const key = row.actionType || "Activity";
      map[key] = (map[key] || 0) + 1;
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredSystemActivityRows]);

  const activityHeatmapRows = useMemo(() => {
    const daySet = new Set();
    filteredSystemActivityRows.forEach((row) => {
      const day = toDayKey(row.timestamp);
      if (day) daySet.add(day);
    });
    const days = [...daySet].sort((a, b) => a.localeCompare(b)).slice(-7);
    const grid = days.map((day) => ({
      day,
      label: MONTH_LABEL.format(new Date(`${day}T00:00:00`)),
      hours: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        count: 0,
      })),
    }));
    const byDay = Object.fromEntries(grid.map((row) => [row.day, row]));
    filteredSystemActivityRows.forEach((row) => {
      const day = toDayKey(row.timestamp);
      const hour = toHour(row.timestamp);
      if (!day || hour === null || !byDay[day]) return;
      byDay[day].hours[hour].count += 1;
    });
    return grid;
  }, [filteredSystemActivityRows]);

  const maxHeat = useMemo(() => {
    let max = 0;
    activityHeatmapRows.forEach((row) => {
      row.hours.forEach((h) => {
        if (h.count > max) max = h.count;
      });
    });
    return max || 1;
  }, [activityHeatmapRows]);

  const criticalEventsRows = useMemo(() => {
    return filteredSystemActivityRows
      .filter((row) => String(row.severity || "").toLowerCase() === "critical")
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 50);
  }, [filteredSystemActivityRows]);

  const selectedSubReportPayload = useMemo(() => {
    const payloads = {
      "system-activity": {
        exportColumns: [
          { label: "Timestamp", value: "timestamp" },
          { label: "User", value: "user" },
          { label: "Action Type", value: "actionType" },
          { label: "Module", value: "module" },
          { label: "Record ID", value: (row) => row.recordId ?? "-" },
          { label: "Old Value", value: (row) => safeJsonText(row.oldValue) },
          { label: "New Value", value: (row) => safeJsonText(row.newValue) },
          { label: "IP Address", value: "ipAddress" },
          { label: "Device", value: "device" },
          { label: "Severity", value: "severity" },
        ],
        exportRows: filteredSystemActivityRows,
      },
      "invoice-edits": {
        exportColumns: [
          { label: "Timestamp", value: "timestamp" },
          { label: "Invoice No.", value: "invoiceNo" },
          { label: "Field Changed", value: "fieldChanged" },
          { label: "Old Value", value: "oldValue" },
          { label: "New Value", value: "newValue" },
          { label: "Edited By", value: "editedBy" },
          { label: "Reason", value: "reason" },
        ],
        exportRows: invoiceEditRows,
      },
      "deleted-records": {
        exportColumns: [
          { label: "Timestamp", value: "timestamp" },
          { label: "Record Type", value: "recordType" },
          { label: "Record ID", value: "recordId" },
          { label: "Details", value: "details" },
          { label: "Deleted By", value: "deletedBy" },
          { label: "Recoverable?", value: "recoverable" },
        ],
        exportRows: deletedRecordsRows,
      },
      "stock-adjustments": {
        exportColumns: [
          { label: "Date", value: "date" },
          { label: "Product", value: "product" },
          { label: "Qty Before", value: (row) => row.qtyBefore ?? "-" },
          { label: "Qty After", value: (row) => row.qtyAfter ?? "-" },
          { label: "Reason", value: "reason" },
          { label: "Adjusted By", value: "adjustedBy" },
          { label: "Approved By", value: "approvedBy" },
        ],
        exportRows: stockAdjustmentRows,
      },
      "login-history": {
        exportColumns: [
          { label: "Timestamp", value: "timestamp" },
          { label: "User", value: "user" },
          { label: "Action", value: "action" },
          { label: "IP Address", value: "ipAddress" },
          { label: "Device", value: "device" },
          { label: "Session Duration", value: "sessionDuration" },
        ],
        exportRows: loginHistoryRows,
      },
      "repair-status": {
        exportColumns: [
          { label: "Timestamp", value: "timestamp" },
          { label: "Job ID", value: "jobId" },
          { label: "Old Status", value: "oldStatus" },
          { label: "New Status", value: "newStatus" },
          { label: "Changed By", value: "changedBy" },
          { label: "Notes", value: "notes" },
        ],
        exportRows: repairStatusChangeRows,
      },
      "permission-change": {
        exportColumns: [
          { label: "Timestamp", value: "timestamp" },
          { label: "Employee", value: "employee" },
          { label: "Change", value: "change" },
          { label: "Old Access", value: "oldAccess" },
          { label: "New Access", value: "newAccess" },
          { label: "Changed By", value: "changedBy" },
        ],
        exportRows: permissionChangeRows,
      },
      "discount-override": {
        exportColumns: [
          { label: "Timestamp", value: "timestamp" },
          { label: "Invoice", value: "invoiceNo" },
          { label: "Subtotal", value: (row) => Number(row.subtotal || 0) },
          { label: "Discount", value: (row) => Number(row.discount || 0) },
          { label: "Discount %", value: (row) => Number((row.discountPct || 0).toFixed(2)) },
          { label: "Overridden By", value: "overriddenBy" },
          { label: "Reason", value: "reason" },
        ],
        exportRows: discountOverrideRows,
      },
      "price-change": {
        exportColumns: [
          { label: "Timestamp", value: "timestamp" },
          { label: "Product", value: "product" },
          { label: "Old Sale Price", value: (row) => Number(row.oldSalePrice || 0) },
          { label: "New Sale Price", value: (row) => Number(row.newSalePrice || 0) },
          { label: "Old Cost Price", value: (row) => Number(row.oldCostPrice || 0) },
          { label: "New Cost Price", value: (row) => Number(row.newCostPrice || 0) },
          { label: "Reason", value: "reason" },
          { label: "Changed By", value: "changedBy" },
        ],
        exportRows: priceChangeRows,
      },
      "cash-drawer": {
        exportColumns: [
          { label: "Timestamp", value: "timestamp" },
          { label: "User", value: "user" },
          { label: "Reason", value: "reason" },
        ],
        exportRows: cashDrawerOpenRows,
      },
      "export-log": {
        exportColumns: [
          { label: "Timestamp", value: "timestamp" },
          { label: "User", value: "user" },
          { label: "Report", value: "reportName" },
          { label: "Format", value: "format" },
          { label: "Details", value: "details" },
        ],
        exportRows: exportLogRows,
      },
      "backup-log": {
        exportColumns: [
          { label: "Timestamp", value: "timestamp" },
          { label: "Type", value: "backupType" },
          { label: "Status", value: "status" },
          { label: "File", value: "fileName" },
          { label: "Details", value: "details" },
        ],
        exportRows: backupLogRows,
      },
      "suspicious-flags": {
        exportColumns: [
          { label: "Timestamp", value: "timestamp" },
          { label: "Type", value: "type" },
          { label: "Severity", value: "severity" },
          { label: "Detail", value: "detail" },
          { label: "User", value: "user" },
        ],
        exportRows: suspiciousFlagsRows,
      },
    };
    return payloads[activeSubReport] || payloads["system-activity"];
  }, [
    activeSubReport,
    backupLogRows,
    cashDrawerOpenRows,
    deletedRecordsRows,
    discountOverrideRows,
    exportLogRows,
    filteredSystemActivityRows,
    invoiceEditRows,
    loginHistoryRows,
    permissionChangeRows,
    priceChangeRows,
    repairStatusChangeRows,
    stockAdjustmentRows,
    suspiciousFlagsRows,
  ]);

  useEffect(() => {
    if (!onPrepared) return;
    onPrepared({
      exportColumns: selectedSubReportPayload.exportColumns,
      exportRows: selectedSubReportPayload.exportRows,
    });
  }, [onPrepared, selectedSubReportPayload.exportColumns, selectedSubReportPayload.exportRows]);

  const renderSubReport = () => {
    if (activeSubReport === "system-activity") {
      return (
        <SectionCard title="System Activity Log">
          <MiniTable
            columns={[
              { label: "Timestamp", value: (row) => (row.timestamp ? new Date(row.timestamp).toLocaleString() : "-") },
              { label: "User", value: "user" },
              { label: "Action Type", value: "actionType" },
              { label: "Module", value: "module" },
              { label: "Record ID", value: (row) => row.recordId ?? "-" },
              { label: "Old Value", value: (row) => safeJsonText(row.oldValue) },
              { label: "New Value", value: (row) => safeJsonText(row.newValue) },
              { label: "IP", value: "ipAddress" },
              { label: "Device", value: "device" },
              { label: "Severity", value: (row) => <Badge tone={toneForSeverity(row.severity)}>{row.severity}</Badge> },
            ]}
            rows={filteredSystemActivityRows}
            emptyLabel="No system activity records found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "invoice-edits") {
      return (
        <SectionCard title="Invoice Edit Log">
          <MiniTable
            columns={[
              { label: "Timestamp", value: (row) => (row.timestamp ? new Date(row.timestamp).toLocaleString() : "-") },
              { label: "Invoice", value: "invoiceNo" },
              { label: "Field", value: "fieldChanged" },
              { label: "Old", value: "oldValue" },
              { label: "New", value: "newValue" },
              { label: "Edited By", value: "editedBy" },
              { label: "Reason", value: "reason" },
            ]}
            rows={invoiceEditRows}
            emptyLabel="No invoice edits found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "deleted-records") {
      return (
        <SectionCard title="Deleted Records Log">
          <MiniTable
            columns={[
              { label: "Timestamp", value: (row) => (row.timestamp ? new Date(row.timestamp).toLocaleString() : "-") },
              { label: "Record Type", value: "recordType" },
              { label: "Record ID", value: "recordId" },
              { label: "Details", value: "details" },
              { label: "Deleted By", value: "deletedBy" },
              { label: "Recoverable?", value: (row) => <Badge tone={row.recoverable === "Yes" ? "green" : "red"}>{row.recoverable}</Badge> },
            ]}
            rows={deletedRecordsRows}
            emptyLabel="No deleted records found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "stock-adjustments") {
      return (
        <SectionCard title="Stock Adjustment Log">
          <MiniTable
            columns={[
              { label: "Date", value: (row) => (row.date ? new Date(row.date).toLocaleString() : "-") },
              { label: "Product", value: "product" },
              { label: "Qty Before", value: (row) => (row.qtyBefore ?? "-") },
              { label: "Qty After", value: (row) => (row.qtyAfter ?? "-") },
              { label: "Reason", value: "reason" },
              { label: "Adjusted By", value: "adjustedBy" },
              { label: "Approved By", value: "approvedBy" },
            ]}
            rows={stockAdjustmentRows}
            emptyLabel="No stock adjustments found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "login-history") {
      return (
        <SectionCard title="Login History">
          <MiniTable
            columns={[
              { label: "Timestamp", value: (row) => (row.timestamp ? new Date(row.timestamp).toLocaleString() : "-") },
              { label: "User", value: "user" },
              { label: "Action", value: (row) => <Badge tone={row.action === "Failed" ? "red" : "indigo"}>{row.action}</Badge> },
              { label: "IP Address", value: "ipAddress" },
              { label: "Device", value: "device" },
              { label: "Session Duration", value: "sessionDuration" },
            ]}
            rows={loginHistoryRows}
            emptyLabel="No login/logout telemetry found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "repair-status") {
      return (
        <SectionCard title="Repair Status Change Log">
          <MiniTable
            columns={[
              { label: "Timestamp", value: (row) => (row.timestamp ? new Date(row.timestamp).toLocaleString() : "-") },
              { label: "Job ID", value: "jobId" },
              { label: "Old Status", value: "oldStatus" },
              { label: "New Status", value: "newStatus" },
              { label: "Changed By", value: "changedBy" },
              { label: "Notes", value: "notes" },
            ]}
            rows={repairStatusChangeRows}
            emptyLabel="No repair status changes found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "permission-change") {
      return (
        <SectionCard
          title="Permission Change Log"
          subtitle={`Current active employees: ${(employeesRows || []).filter((row) => row.is_active).length}`}
        >
          <MiniTable
            columns={[
              { label: "Timestamp", value: (row) => (row.timestamp ? new Date(row.timestamp).toLocaleString() : "-") },
              { label: "Employee", value: "employee" },
              { label: "Change", value: "change" },
              { label: "Old Access", value: "oldAccess" },
              { label: "New Access", value: "newAccess" },
              { label: "Changed By", value: "changedBy" },
            ]}
            rows={permissionChangeRows}
            emptyLabel="No permission change records found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "discount-override") {
      return (
        <SectionCard title="Discount Override Log">
          <MiniTable
            columns={[
              { label: "Timestamp", value: (row) => (row.timestamp ? new Date(row.timestamp).toLocaleString() : "-") },
              { label: "Invoice", value: "invoiceNo" },
              { label: "Subtotal", value: (row) => Number(row.subtotal || 0).toLocaleString() },
              { label: "Discount", value: (row) => Number(row.discount || 0).toLocaleString() },
              { label: "Discount %", value: (row) => `${Number(row.discountPct || 0).toFixed(2)}%` },
              { label: "Overridden By", value: "overriddenBy" },
              { label: "Reason", value: "reason" },
            ]}
            rows={discountOverrideRows}
            emptyLabel="No high-threshold discount overrides detected."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "price-change") {
      return (
        <SectionCard title="Price Change Log">
          <MiniTable
            columns={[
              { label: "Timestamp", value: (row) => (row.timestamp ? new Date(row.timestamp).toLocaleString() : "-") },
              { label: "Product", value: "product" },
              { label: "Old Sale", value: (row) => Number(row.oldSalePrice || 0).toLocaleString() },
              { label: "New Sale", value: (row) => Number(row.newSalePrice || 0).toLocaleString() },
              { label: "Old Cost", value: (row) => Number(row.oldCostPrice || 0).toLocaleString() },
              { label: "New Cost", value: (row) => Number(row.newCostPrice || 0).toLocaleString() },
              { label: "Reason", value: "reason" },
              { label: "Changed By", value: "changedBy" },
            ]}
            rows={priceChangeRows}
            emptyLabel="No price adjustments in selected range."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "cash-drawer") {
      return (
        <SectionCard title="Cash Drawer Open Events">
          <MiniTable
            columns={[
              { label: "Timestamp", value: (row) => (row.timestamp ? new Date(row.timestamp).toLocaleString() : "-") },
              { label: "User", value: "user" },
              { label: "Reason", value: "reason" },
            ]}
            rows={cashDrawerOpenRows}
            emptyLabel="No cash drawer open events found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "export-log") {
      return (
        <SectionCard title="Report Export Log">
          <MiniTable
            columns={[
              { label: "Timestamp", value: (row) => (row.timestamp ? new Date(row.timestamp).toLocaleString() : "-") },
              { label: "User", value: "user" },
              { label: "Report", value: "reportName" },
              { label: "Format", value: "format" },
              { label: "Details", value: "details" },
            ]}
            rows={exportLogRows}
            emptyLabel="No report export records found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "backup-log") {
      return (
        <SectionCard title="Data Backup Log">
          <MiniTable
            columns={[
              { label: "Timestamp", value: (row) => (row.timestamp ? new Date(row.timestamp).toLocaleString() : "-") },
              { label: "Type", value: "backupType" },
              { label: "Status", value: (row) => <Badge tone={row.status === "Success" ? "green" : "red"}>{row.status}</Badge> },
              { label: "File", value: "fileName" },
              { label: "Details", value: "details" },
            ]}
            rows={backupLogRows}
            emptyLabel="No backup history files found."
          />
        </SectionCard>
      );
    }

    return (
      <SectionCard title="Suspicious Activity Flags">
        <MiniTable
          columns={[
            { label: "Timestamp", value: (row) => (row.timestamp ? new Date(row.timestamp).toLocaleString() : "-") },
            { label: "Type", value: "type" },
            { label: "Severity", value: (row) => <Badge tone={toneForSeverity(row.severity)}>{row.severity}</Badge> },
            { label: "Detail", value: "detail" },
            { label: "User", value: "user" },
          ]}
          rows={suspiciousFlagsRows}
          emptyLabel="No suspicious activities detected."
        />
      </SectionCard>
    );
  };

  return (
    <div className="space-y-3">
      <SectionCard title="Audit Filters">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2">
          <input
            type="date"
            value={rangeFrom}
            onChange={(event) => setRangeFrom(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
            aria-label="Audit from date"
          />
          <input
            type="date"
            value={rangeTo}
            onChange={(event) => setRangeTo(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
            aria-label="Audit to date"
          />
          <Select
            value={userFilter}
            onChange={(event) => setUserFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          >
            <option value="all">User: All</option>
            {options.users.map((user) => (
              <option key={user} value={user}>
                {user}
              </option>
            ))}
          </Select>
          <Select
            value={actionFilter}
            onChange={(event) => setActionFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          >
            <option value="all">Action: All</option>
            {options.actions.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </Select>
          <Select
            value={moduleFilter}
            onChange={(event) => setModuleFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          >
            <option value="all">Module: All</option>
            {options.modules.map((module) => (
              <option key={module} value={module}>
                {module}
              </option>
            ))}
          </Select>
          <Select
            value={severityFilter}
            onChange={(event) => setSeverityFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          >
            <option value="all">Severity: All</option>
            {options.severities.map((severity) => (
              <option key={severity} value={String(severity).toLowerCase()}>
                {severity}
              </option>
            ))}
          </Select>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <KpiCard
          title="Total System Actions (Period)"
          value={kpis.totalSystemActions.toLocaleString()}
          icon={<Eye size={18} />}
        />
        <KpiCard
          title="Invoice Edits"
          value={kpis.invoiceEdits.toLocaleString()}
          icon={<FilePenLine size={18} />}
          tone="indigo"
        />
        <KpiCard
          title="Deleted Records"
          value={kpis.deletedRecords.toLocaleString()}
          icon={<Trash2 size={18} />}
          tone="red"
        />
        <KpiCard
          title="Stock Adjustments"
          value={kpis.stockAdjustments.toLocaleString()}
          icon={<SlidersHorizontal size={18} />}
          tone="amber"
        />
        <KpiCard
          title="Failed Login Attempts"
          value={kpis.failedLoginAttempts.toLocaleString()}
          icon={<ShieldAlert size={18} />}
          tone="red"
        />
        <KpiCard
          title="Active Users Today"
          value={kpis.activeUsersToday.toLocaleString()}
          icon={<UserCheck size={18} />}
          tone="green"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <SectionCard title="Activity by User">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activityByUserRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="user" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip />
                <Bar dataKey="actions" fill="#38bdf8" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Action Type Distribution">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={actionTypeDistributionRows} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} stroke="none">
                  {actionTypeDistributionRows.map((entry, index) => (
                    <Cell key={`${entry.name}-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <SectionCard title="Activity Timeline (Hour-by-Hour Heatmap)">
          <div className="space-y-2">
            {activityHeatmapRows.length === 0 && (
              <p className="text-xs text-slate-400">No activity data for heatmap.</p>
            )}
            {activityHeatmapRows.map((dayRow) => (
              <div key={dayRow.day} className="grid grid-cols-[70px_1fr] items-center gap-2">
                <p className="text-[11px] text-slate-300">{dayRow.label}</p>
                <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-1">
                  {dayRow.hours.map((hourRow) => {
                    const intensity = hourRow.count / maxHeat;
                    const alpha = intensity === 0 ? 0.08 : Math.min(0.92, 0.18 + intensity * 0.74);
                    return (
                      <div
                        key={`${dayRow.day}-${hourRow.hour}`}
                        className="h-4 rounded"
                        style={{ backgroundColor: `rgba(56, 189, 248, ${alpha})` }}
                        title={`${dayRow.day} ${String(hourRow.hour).padStart(2, "0")}:00 - ${hourRow.count} actions`}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
            <p className="text-[10px] text-slate-500">24-hour scale from 00:00 to 23:00 for last 7 active days.</p>
          </div>
        </SectionCard>

        <SectionCard title="Critical Events Timeline">
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {criticalEventsRows.length === 0 && (
              <p className="text-xs text-slate-400">No critical events in selected range.</p>
            )}
            {criticalEventsRows.map((row) => (
              <div key={row.id} className="rounded-lg border border-red-500/30 bg-red-500/10 p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-red-200">
                    {row.actionType} - {row.module}
                  </p>
                  <Badge tone="red">Critical</Badge>
                </div>
                <p className="text-[11px] text-slate-200">{row.description || safeJsonText(row.newValue)}</p>
                <p className="text-[10px] text-slate-400 mt-1">
                  {row.timestamp ? new Date(row.timestamp).toLocaleString() : "-"} | {row.user || "System"}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Audit Report Tables">
        <div className="flex flex-wrap gap-2">
          {SUB_REPORT_TABS.map((tab) => (
            <button
              key={tab.key}
              className={`btn btn-xs ${activeSubReport === tab.key ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveSubReport(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          IP and device fields now use best-available security audit telemetry and may be blank only for legacy events.
        </p>
      </SectionCard>

      {renderSubReport()}
    </div>
  );
}
