import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Eye,
  FileSpreadsheet,
  FileText,
  Mail,
  PackageOpen,
  Printer,
  ShieldCheck,
} from "lucide-react";
import * as XLSX from "xlsx";
import { Badge, Button, KpiCard, SectionCard, Table, Select } from "../../../components/UI";
import api from "../../../lib/api";
import {
  downloadCsv,
  downloadPdf,
  downloadXlsx,
  downloadZipBundle,
  openPrintView,
  toCsvString,
} from "../../../lib/tableUtils";

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDayKey(value) {
  const date = toDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function toMonthKey(value) {
  const date = toDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function weekStartKey(value) {
  const date = toDate(value);
  if (!date) return "";
  const copy = new Date(date);
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  return toDayKey(copy);
}

function formatBytes(size) {
  const value = Number(size || 0);
  if (!value) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function isCompletedRepair(status) {
  const value = String(status || "").toLowerCase();
  return value === "completed" || value === "delivered";
}

function toWorkbookBlob(columns, rows, sheetName = "Report") {
  const header = columns.map((column) => column.label);
  const body = (rows || []).map((row) =>
    columns.map((column) => (typeof column.value === "function" ? column.value(row) : row[column.value])),
  );
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function sanitizeFilename(text) {
  return String(text || "report")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
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

export default function ExportCenterContent({
  salesRows,
  repairRows,
  inventoryRows,
  purchaseRows,
  movementRows,
  auditActivityRows,
  dateFrom,
  dateTo,
  onPrepared,
}) {
  const [selectedReportKey, setSelectedReportKey] = useState("daily-summary");
  const [selectedFormat, setSelectedFormat] = useState("PDF");
  const [previewMode, setPreviewMode] = useState(true);
  const [draggingField, setDraggingField] = useState(null);
  const [selectedFieldIds, setSelectedFieldIds] = useState([]);
  const [bulkSelectedKeys, setBulkSelectedKeys] = useState([]);
  const [historyRows, setHistoryRows] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [permissions, setPermissions] = useState({});
  const [currentUser, setCurrentUser] = useState(null);
  const [emailTo, setEmailTo] = useState("");
  const [scheduleForm, setScheduleForm] = useState({
    reportKey: "daily-summary",
    format: "PDF",
    frequency: "Daily",
    deliveryTime: "09:00",
    emailTo: "",
  });
  const [options, setOptions] = useState({
    branding: { shop_name: "", shop_address: "", shop_logo_text: "" },
    watermark_text: "",
    confidential_stamp: false,
  });

  const reportCatalog = useMemo(
    () => [
      {
        group: "Templates",
        items: [
          { key: "daily-summary", label: "Daily Summary", quickFormats: ["PDF"] },
          { key: "weekly-sales", label: "Weekly Sales Report", quickFormats: ["PDF", "CSV"] },
          { key: "monthly-pl", label: "Monthly P&L", quickFormats: ["PDF"] },
          { key: "tax-report", label: "Tax Report", quickFormats: ["PDF"] },
          { key: "inventory-valuation", label: "Inventory Valuation", quickFormats: ["CSV", "XLSX"] },
          { key: "outstanding-payments", label: "Outstanding Payments List", quickFormats: ["PDF"] },
          { key: "technician-performance", label: "Technician Performance", quickFormats: ["PDF"] },
          { key: "full-audit-log", label: "Full Audit Log", quickFormats: ["CSV"] },
        ],
      },
      {
        group: "Custom Reports",
        items: [
          { key: "sales-ledger", label: "Sales Ledger", quickFormats: ["CSV", "XLSX", "PDF"] },
          { key: "repairs-ledger", label: "Repair Ledger", quickFormats: ["CSV", "XLSX", "PDF"] },
          { key: "stock-movements", label: "Stock Movements", quickFormats: ["CSV", "XLSX"] },
        ],
      },
    ],
    [],
  );

  const allCatalogItems = useMemo(
    () => reportCatalog.flatMap((group) => group.items),
    [reportCatalog],
  );

  const reportByKey = useMemo(
    () => Object.fromEntries(allCatalogItems.map((item) => [item.key, item])),
    [allCatalogItems],
  );

  const reportDataByKey = useMemo(() => {
    const cleanSales = (salesRows || []).filter((sale) => !sale.is_voided);
    const postedSales = cleanSales.filter((sale) => !sale.is_return);
    const cleanRepairs = (repairRows || []).filter((repair) => !String(repair.status || "").toLowerCase().includes("cancel"));

    const dailyMap = {};
    postedSales.forEach((sale) => {
      const key = toDayKey(sale.created_at);
      if (!key) return;
      if (!dailyMap[key]) dailyMap[key] = { day: key, salesRevenue: 0, repairRevenue: 0, salesCount: 0, repairCount: 0 };
      dailyMap[key].salesRevenue += Number(sale.total || 0);
      dailyMap[key].salesCount += 1;
    });
    cleanRepairs.forEach((repair) => {
      const key = toDayKey(repair.delivered_at || repair.created_at);
      if (!key) return;
      if (!dailyMap[key]) dailyMap[key] = { day: key, salesRevenue: 0, repairRevenue: 0, salesCount: 0, repairCount: 0 };
      dailyMap[key].repairRevenue += Number(repair.invoice_amount ?? repair.estimated_cost ?? 0);
      dailyMap[key].repairCount += 1;
    });
    const dailySummaryRows = Object.values(dailyMap)
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((row) => ({
        ...row,
        totalRevenue: row.salesRevenue + row.repairRevenue,
      }));

    const weeklyMap = {};
    postedSales.forEach((sale) => {
      const key = weekStartKey(sale.created_at);
      if (!key) return;
      if (!weeklyMap[key]) weeklyMap[key] = { weekStart: key, salesCount: 0, total: 0, cash: 0, card: 0, credit: 0 };
      weeklyMap[key].salesCount += 1;
      weeklyMap[key].total += Number(sale.total || 0);
      weeklyMap[key].cash += Number(sale.cash_amount || 0);
      weeklyMap[key].card += Number(sale.card_amount || 0);
      weeklyMap[key].credit += Math.max(0, Number(sale.total || 0) - Number(sale.cash_amount || 0) - Number(sale.card_amount || 0));
    });
    const weeklySalesRows = Object.values(weeklyMap).sort((a, b) => a.weekStart.localeCompare(b.weekStart));

    const monthlyMap = {};
    postedSales.forEach((sale) => {
      const month = toMonthKey(sale.created_at);
      if (!month) return;
      if (!monthlyMap[month]) monthlyMap[month] = { month, revenue: 0, expenses: 0, tax: 0 };
      monthlyMap[month].revenue += Number(sale.total || 0);
      monthlyMap[month].tax += Number(sale.tax_amount || 0);
    });
    cleanRepairs.forEach((repair) => {
      const month = toMonthKey(repair.delivered_at || repair.created_at);
      if (!month) return;
      if (!monthlyMap[month]) monthlyMap[month] = { month, revenue: 0, expenses: 0, tax: 0 };
      monthlyMap[month].revenue += Number(repair.invoice_amount ?? repair.estimated_cost ?? 0);
    });
    (purchaseRows || []).forEach((purchase) => {
      const month = toMonthKey(purchase.created_at);
      if (!month) return;
      if (!monthlyMap[month]) monthlyMap[month] = { month, revenue: 0, expenses: 0, tax: 0 };
      monthlyMap[month].expenses += Number(purchase.total_cost || 0);
    });
    const monthlyPlRows = Object.values(monthlyMap)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((row) => ({
        ...row,
        netProfit: row.revenue - row.expenses,
        marginPct: row.revenue > 0 ? ((row.revenue - row.expenses) / row.revenue) * 100 : 0,
      }));

    const taxRows = cleanSales
      .map((sale) => ({
        date: sale.created_at,
        transactionType: "Sale",
        grossAmount: Number(sale.total || 0),
        taxPct: Number(sale.total || 0) > 0 ? (Number(sale.tax_amount || 0) / Number(sale.total || 1)) * 100 : 0,
        taxAmount: Number(sale.tax_amount || 0),
        netAmount: Number(sale.total || 0) - Number(sale.tax_amount || 0),
        invoiceRef: sale.invoice_no || `INV-${sale.id}`,
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    const inventoryValuationRows = (inventoryRows || []).map((item) => ({
      product: item.name,
      category: item.category || "-",
      brand: item.brand || "-",
      qty: Number(item.quantity || 0),
      costPrice: Number(item.cost_price || 0),
      sellPrice: Number(item.sale_price || 0),
      totalValue: Number(item.quantity || 0) * Number(item.cost_price || 0),
    }));

    const outstandingSalesRows = cleanSales
      .map((sale) => {
        const total = Number(sale.total || 0);
        const paid = Number(sale.cash_amount || 0) + Number(sale.card_amount || 0);
        const balance = Math.max(0, total - paid);
        return {
          reference: sale.invoice_no || `INV-${sale.id}`,
          date: sale.created_at,
          type: "Sale",
          total,
          paid,
          balance,
        };
      })
      .filter((row) => row.balance > 0);
    const outstandingRepairRows = cleanRepairs
      .map((repair) => {
        const total = Number(repair.invoice_amount ?? repair.estimated_cost ?? 0);
        const paid = Number(repair.advance_payment || 0);
        const balance = Math.max(0, total - paid);
        return {
          reference: repair.ticket_no || `JOB-${repair.id}`,
          date: repair.created_at,
          type: "Repair",
          total,
          paid,
          balance,
        };
      })
      .filter((row) => row.balance > 0);
    const outstandingRows = [...outstandingSalesRows, ...outstandingRepairRows].sort(
      (a, b) => new Date(b.date) - new Date(a.date),
    );

    const technicianMap = {};
    cleanRepairs.forEach((repair) => {
      const tech = repair.technician || "Unassigned";
      if (!technicianMap[tech]) {
        technicianMap[tech] = { technician: tech, jobs: 0, completed: 0, revenue: 0 };
      }
      technicianMap[tech].jobs += 1;
      if (isCompletedRepair(repair.status)) technicianMap[tech].completed += 1;
      technicianMap[tech].revenue += Number(repair.invoice_amount ?? repair.estimated_cost ?? 0);
    });
    const technicianRows = Object.values(technicianMap)
      .map((row) => ({
        ...row,
        completionPct: row.jobs > 0 ? (row.completed / row.jobs) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const fullAuditRows = (auditActivityRows || []).length
      ? (auditActivityRows || []).map((row) => ({
          timestamp: row.timestamp || row.created_at,
          user: row.user || "System",
          actionType: row.action_type || row.action || "Activity",
          module: row.module || row.entity_type || "System",
          recordId: row.record_id ?? row.entity_id ?? row.id,
          oldValue: row.old_value_raw || row.old_value || "-",
          newValue: row.new_value_raw || row.new_value || "-",
          severity: row.severity || "Info",
        }))
      : (movementRows || []).map((movement) => ({
          timestamp: movement.created_at,
          user: "System",
          actionType: movement.movement_type || "Stock Movement",
          module: "Inventory",
          recordId: movement.reference_id || movement.id,
          oldValue: "-",
          newValue: movement.note || movement.item_name || "-",
          severity: movement.movement_type === "ADJUSTMENT" ? "Warning" : "Info",
        }));

    const salesLedgerRows = postedSales.map((sale) => ({
      date: sale.created_at,
      invoice: sale.invoice_no || `INV-${sale.id}`,
      paymentMethod: sale.payment_method || "Cash",
      subtotal: Number(sale.subtotal || 0),
      discount: Number(sale.discount_amount || 0),
      tax: Number(sale.tax_amount || 0),
      total: Number(sale.total || 0),
    }));

    const repairLedgerRows = cleanRepairs.map((repair) => ({
      date: repair.created_at,
      ticket: repair.ticket_no || `JOB-${repair.id}`,
      customer: repair.customer_name || "Unknown",
      technician: repair.technician || "Unassigned",
      status: repair.status || "Pending",
      estimate: Number(repair.invoice_amount ?? repair.estimated_cost ?? 0),
      advance: Number(repair.advance_payment || 0),
      balance: Math.max(0, Number(repair.invoice_amount ?? repair.estimated_cost ?? 0) - Number(repair.advance_payment || 0)),
    }));

    const stockMovementRows = (movementRows || []).map((movement) => ({
      date: movement.created_at,
      product: movement.item_name || `Item #${movement.item_id}`,
      movementType: movement.movement_type || "-",
      qtyChange: Number(movement.quantity || 0),
      reference: movement.reference_type || "-",
      note: movement.note || "-",
    }));

    return {
      "daily-summary": {
        title: "Daily Summary",
        columns: [
          { label: "Date", value: "day" },
          { label: "Sales Revenue", value: (row) => Number(row.salesRevenue || 0) },
          { label: "Repair Revenue", value: (row) => Number(row.repairRevenue || 0) },
          { label: "Total Revenue", value: (row) => Number(row.totalRevenue || 0) },
          { label: "Sales Count", value: (row) => Number(row.salesCount || 0) },
          { label: "Repair Count", value: (row) => Number(row.repairCount || 0) },
        ],
        rows: dailySummaryRows,
      },
      "weekly-sales": {
        title: "Weekly Sales Report",
        columns: [
          { label: "Week Start", value: "weekStart" },
          { label: "Sales Count", value: (row) => Number(row.salesCount || 0) },
          { label: "Cash", value: (row) => Number(row.cash || 0) },
          { label: "Card", value: (row) => Number(row.card || 0) },
          { label: "Credit", value: (row) => Number(row.credit || 0) },
          { label: "Total", value: (row) => Number(row.total || 0) },
        ],
        rows: weeklySalesRows,
      },
      "monthly-pl": {
        title: "Monthly P&L",
        columns: [
          { label: "Month", value: "month" },
          { label: "Revenue", value: (row) => Number(row.revenue || 0) },
          { label: "Expenses", value: (row) => Number(row.expenses || 0) },
          { label: "Tax", value: (row) => Number(row.tax || 0) },
          { label: "Net Profit", value: (row) => Number(row.netProfit || 0) },
          { label: "Margin %", value: (row) => Number((row.marginPct || 0).toFixed(2)) },
        ],
        rows: monthlyPlRows,
      },
      "tax-report": {
        title: "Tax Report",
        columns: [
          { label: "Date", value: "date" },
          { label: "Transaction Type", value: "transactionType" },
          { label: "Gross Amount", value: (row) => Number(row.grossAmount || 0) },
          { label: "Tax %", value: (row) => Number((row.taxPct || 0).toFixed(2)) },
          { label: "Tax Amount", value: (row) => Number(row.taxAmount || 0) },
          { label: "Net Amount", value: (row) => Number(row.netAmount || 0) },
          { label: "Invoice Ref", value: "invoiceRef" },
        ],
        rows: taxRows,
      },
      "inventory-valuation": {
        title: "Inventory Valuation",
        columns: [
          { label: "Product", value: "product" },
          { label: "Category", value: "category" },
          { label: "Brand", value: "brand" },
          { label: "Qty", value: (row) => Number(row.qty || 0) },
          { label: "Cost Price", value: (row) => Number(row.costPrice || 0) },
          { label: "Sell Price", value: (row) => Number(row.sellPrice || 0) },
          { label: "Total Value", value: (row) => Number(row.totalValue || 0) },
        ],
        rows: inventoryValuationRows,
      },
      "outstanding-payments": {
        title: "Outstanding Payments",
        columns: [
          { label: "Reference", value: "reference" },
          { label: "Date", value: "date" },
          { label: "Type", value: "type" },
          { label: "Total", value: (row) => Number(row.total || 0) },
          { label: "Paid", value: (row) => Number(row.paid || 0) },
          { label: "Balance", value: (row) => Number(row.balance || 0) },
        ],
        rows: outstandingRows,
      },
      "technician-performance": {
        title: "Technician Performance",
        columns: [
          { label: "Technician", value: "technician" },
          { label: "Jobs", value: (row) => Number(row.jobs || 0) },
          { label: "Completed", value: (row) => Number(row.completed || 0) },
          { label: "Completion %", value: (row) => Number((row.completionPct || 0).toFixed(2)) },
          { label: "Revenue", value: (row) => Number(row.revenue || 0) },
        ],
        rows: technicianRows,
      },
      "full-audit-log": {
        title: "Full Audit Log",
        columns: [
          { label: "Timestamp", value: "timestamp" },
          { label: "User", value: "user" },
          { label: "Action Type", value: "actionType" },
          { label: "Module", value: "module" },
          { label: "Record ID", value: (row) => row.recordId ?? "-" },
          { label: "Old Value", value: "oldValue" },
          { label: "New Value", value: "newValue" },
          { label: "Severity", value: "severity" },
        ],
        rows: fullAuditRows,
      },
      "sales-ledger": {
        title: "Sales Ledger",
        columns: [
          { label: "Date", value: "date" },
          { label: "Invoice", value: "invoice" },
          { label: "Payment Method", value: "paymentMethod" },
          { label: "Subtotal", value: (row) => Number(row.subtotal || 0) },
          { label: "Discount", value: (row) => Number(row.discount || 0) },
          { label: "Tax", value: (row) => Number(row.tax || 0) },
          { label: "Total", value: (row) => Number(row.total || 0) },
        ],
        rows: salesLedgerRows,
      },
      "repairs-ledger": {
        title: "Repair Ledger",
        columns: [
          { label: "Date", value: "date" },
          { label: "Ticket", value: "ticket" },
          { label: "Customer", value: "customer" },
          { label: "Technician", value: "technician" },
          { label: "Status", value: "status" },
          { label: "Estimate", value: (row) => Number(row.estimate || 0) },
          { label: "Advance", value: (row) => Number(row.advance || 0) },
          { label: "Balance", value: (row) => Number(row.balance || 0) },
        ],
        rows: repairLedgerRows,
      },
      "stock-movements": {
        title: "Stock Movements",
        columns: [
          { label: "Date", value: "date" },
          { label: "Product", value: "product" },
          { label: "Movement Type", value: "movementType" },
          { label: "Qty Change", value: (row) => Number(row.qtyChange || 0) },
          { label: "Reference", value: "reference" },
          { label: "Note", value: "note" },
        ],
        rows: stockMovementRows,
      },
    };
  }, [auditActivityRows, inventoryRows, movementRows, purchaseRows, repairRows, salesRows]);

  const activeReportData = reportDataByKey[selectedReportKey] || { title: "Report", columns: [], rows: [] };

  const fieldDefs = useMemo(
    () =>
      activeReportData.columns.map((column, index) => ({
        id: `${column.label}-${index}`,
        label: column.label,
        column,
      })),
    [activeReportData.columns],
  );

  useEffect(() => {
    setSelectedFieldIds(fieldDefs.map((field) => field.id));
  }, [fieldDefs]);

  useEffect(() => {
    let active = true;
    api
      .get("/reports/export-center/state")
      .then((response) => {
        if (!active) return;
        const payload = response.data || {};
        setSchedules(Array.isArray(payload.schedules) ? payload.schedules : []);
        setHistoryRows(Array.isArray(payload.history) ? payload.history : []);
        setPermissions(payload.permissions || {});
        setOptions(
          payload.options || {
            branding: { shop_name: "", shop_address: "", shop_logo_text: "" },
            watermark_text: "",
            confidential_stamp: false,
          },
        );
        setCurrentUser(payload.current_user || null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const rolePermissions = useMemo(() => {
    const role = String(currentUser?.role || "employee").toLowerCase();
    return permissions?.[role] || { can_export: true, allowed_reports: ["*"] };
  }, [currentUser?.role, permissions]);

  const canExportReport = (reportKey) => {
    if (!rolePermissions?.can_export) return false;
    const list = rolePermissions.allowed_reports || [];
    if (list.includes("*")) return true;
    return list.includes(reportKey);
  };

  const selectedColumns = useMemo(() => {
    const map = Object.fromEntries(fieldDefs.map((field) => [field.id, field.column]));
    return selectedFieldIds.map((id) => map[id]).filter(Boolean);
  }, [fieldDefs, selectedFieldIds]);

  const availableFields = useMemo(
    () => fieldDefs.filter((field) => !selectedFieldIds.includes(field.id)),
    [fieldDefs, selectedFieldIds],
  );

  const previewRows = useMemo(
    () => (activeReportData.rows || []).slice(0, 8),
    [activeReportData.rows],
  );

  useEffect(() => {
    if (!onPrepared) return;
    onPrepared({
      exportColumns: selectedColumns,
      exportRows: activeReportData.rows || [],
    });
  }, [onPrepared, selectedColumns, activeReportData.rows]);

  const persistSchedules = async (nextSchedules) => {
    setSchedules(nextSchedules);
    try {
      await api.put("/reports/export-center/schedules", nextSchedules);
    } catch {
      // Silent fallback keeps UI responsive even if save fails.
    }
  };

  const appendHistory = async (entry) => {
    const payload = {
      ...entry,
      generated_by: entry.generated_by || currentUser?.full_name || currentUser?.username || "System",
      generated_at: entry.generated_at || new Date().toISOString(),
    };
    setHistoryRows((prev) => [payload, ...prev]);
    try {
      await api.post("/reports/export-center/history", payload);
    } catch {
      // Keep optimistic row locally if API save fails.
    }
  };

  const doSingleExport = async (reportKey, formatOverride = null, forceColumns = null) => {
    const report = reportDataByKey[reportKey];
    if (!report) return;
    if (!canExportReport(reportKey)) return;

    const format = (formatOverride || selectedFormat || "PDF").toUpperCase();
    const columns = forceColumns || (reportKey === selectedReportKey ? selectedColumns : report.columns);
    const rows = report.rows || [];
    if (!columns || columns.length === 0) return;
    const safeBase = `${sanitizeFilename(report.title)}_${dateFrom}_${dateTo}`;
    let fileSize = "-";

    if (format === "CSV") {
      const size = downloadCsv(`${safeBase}.csv`, columns, rows);
      fileSize = formatBytes(size);
    } else if (format === "XLSX") {
      const size = downloadXlsx(`${safeBase}.xlsx`, columns, rows, report.title);
      fileSize = formatBytes(size);
    } else if (format === "PRINT") {
      openPrintView(report.title, columns, rows);
      fileSize = "-";
    } else {
      const size = await downloadPdf(safeBase, report.title, columns, rows, {
        branding: options.branding,
        watermark: options.watermark_text,
        confidentialStamp: options.confidential_stamp,
      });
      fileSize = formatBytes(size);
    }

    await appendHistory({
      report_name: report.title,
      report_key: reportKey,
      format,
      file_size: fileSize,
      status: "Success",
      delivery_channel: "Download",
    });
  };

  const doBulkExport = async () => {
    const keys = bulkSelectedKeys.filter((key) => canExportReport(key));
    if (keys.length === 0) return;

    const format = selectedFormat.toUpperCase();
    const files = [];
    for (const key of keys) {
      const report = reportDataByKey[key];
      if (!report) continue;
      const fileBase = `${sanitizeFilename(report.title)}_${dateFrom}_${dateTo}`;

      if (format === "CSV") {
        files.push({
          name: `${fileBase}.csv`,
          content: toCsvString(report.columns, report.rows),
        });
      } else if (format === "XLSX") {
        const blob = toWorkbookBlob(report.columns, report.rows, report.title);
        files.push({
          name: `${fileBase}.xlsx`,
          content: await blob.arrayBuffer(),
        });
      } else if (format === "PDF") {
        const payload = {
          title: report.title,
          columns: report.columns.map((column) => ({ label: column.label })),
          rows: (report.rows || []).map((row) =>
            report.columns.map((column) =>
              typeof column.value === "function" ? column.value(row) : row[column.value],
            ),
          ),
          branding: options.branding,
          watermark: options.watermark_text,
          confidential_stamp: Boolean(options.confidential_stamp),
        };
        const res = await api.post("/reports/export-pdf", payload, { responseType: "blob" });
        files.push({
          name: `${fileBase}.pdf`,
          content: await res.data.arrayBuffer(),
        });
      } else {
        files.push({
          name: `${fileBase}.txt`,
          content: `Print format is not bundled. Report: ${report.title}`,
        });
      }
    }

    const zipSize = await downloadZipBundle(`bulk_reports_${dateFrom}_${dateTo}.zip`, files);
    await appendHistory({
      report_name: `Bulk Export (${keys.length} reports)`,
      report_key: "bulk",
      format: "ZIP",
      file_size: formatBytes(zipSize),
      status: "Success",
      delivery_channel: "Download",
    });
  };

  const sendEmailReport = async () => {
    if (!emailTo.trim()) return;
    const report = reportDataByKey[selectedReportKey];
    if (!report) return;
    try {
      await api.post("/reports/export-center/send-email", {
        report_name: report.title,
        report_key: selectedReportKey,
        format: selectedFormat.toUpperCase(),
        to_email: emailTo.trim(),
        notes: "Triggered from Export Center",
      });
      await appendHistory({
        report_name: report.title,
        report_key: selectedReportKey,
        format: selectedFormat.toUpperCase(),
        file_size: "-",
        status: "Prepared",
        delivery_channel: "Local Export",
        email_to: emailTo.trim(),
      });
      setEmailTo("");
    } catch {
      await appendHistory({
        report_name: report.title,
        report_key: selectedReportKey,
        format: selectedFormat.toUpperCase(),
        file_size: "-",
        status: "Prepare Failed",
        delivery_channel: "Local Export",
        email_to: emailTo.trim(),
      });
    }
  };

  const activeTemplates = reportCatalog[0]?.items || [];
  const isAdmin = String(currentUser?.role || "").toLowerCase() === "admin";

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
      <div className="xl:col-span-3 space-y-3">
        <SectionCard title="Report Types">
          <div className="space-y-3">
            {reportCatalog.map((group) => (
              <div key={group.group}>
                <p className="text-[11px] font-bold text-slate-300 mb-1">{group.group}</p>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const selected = selectedReportKey === item.key;
                    return (
                      <button
                        key={item.key}
                        className={`w-full text-left rounded-lg border px-2.5 py-2 text-xs ${
                          selected
                            ? "border-indigo-400/50 bg-indigo-500/20 text-indigo-100"
                            : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                        }`}
                        onClick={() => setSelectedReportKey(item.key)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span>{item.label}</span>
                          {!canExportReport(item.key) && <Badge tone="red">No Access</Badge>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Quick Templates">
          <div className="space-y-2">
            {activeTemplates.map((template) => (
              <div key={template.key} className="rounded-lg border border-white/10 bg-white/5 p-2">
                <p className="text-xs text-slate-100">{template.label}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {template.quickFormats.map((fmt) => (
                    <Button
                      key={`${template.key}-${fmt}`}
                      size="sm"
                      variant="secondary"
                      onClick={() => doSingleExport(template.key, fmt)}
                      disabled={!canExportReport(template.key)}
                    >
                      {fmt}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="xl:col-span-5 space-y-3">
        <SectionCard title="Export Configuration">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Select
              value={selectedFormat}
              onChange={(event) => setSelectedFormat(event.target.value)}
              className="field !py-2 !px-3 !text-xs"
            >
              <option value="PDF">PDF (Branded)</option>
              <option value="CSV">CSV</option>
              <option value="XLSX">Excel (XLSX)</option>
              <option value="PRINT">Print View</option>
            </Select>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => doSingleExport(selectedReportKey)}
                disabled={!canExportReport(selectedReportKey)}
              >
                Generate Export
              </Button>
              <Button
                variant="secondary"
                onClick={() => setPreviewMode((value) => !value)}
              >
                {previewMode ? "Hide Preview" : "Show Preview"}
              </Button>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-slate-300">
            <div className="rounded-lg border border-white/10 bg-white/5 p-2">
              <p className="text-slate-400">Report</p>
              <p className="font-bold text-slate-100">{activeReportData.title}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-2">
              <p className="text-slate-400">Rows</p>
              <p className="font-bold text-slate-100">{(activeReportData.rows || []).length.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-2">
              <p className="text-slate-400">Fields Selected</p>
              <p className="font-bold text-slate-100">{selectedColumns.length.toLocaleString()}</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Custom Report Builder" subtitle="Drag fields between lists to include/exclude in ad-hoc exports.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div
              className="rounded-lg border border-white/10 bg-white/5 p-2 min-h-36"
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (!draggingField || draggingField.from !== "selected") return;
                setSelectedFieldIds((prev) => prev.filter((id) => id !== draggingField.id));
                setDraggingField(null);
              }}
            >
              <p className="text-[11px] font-bold text-slate-300 mb-2">Available Fields</p>
              <div className="flex flex-wrap gap-1">
                {availableFields.map((field) => (
                  <button
                    key={field.id}
                    draggable
                    onDragStart={() => setDraggingField({ id: field.id, from: "available" })}
                    className="rounded-md border border-white/15 bg-slate-800 px-2 py-1 text-[11px] text-slate-200"
                  >
                    {field.label}
                  </button>
                ))}
                {availableFields.length === 0 && (
                  <p className="text-[11px] text-slate-500">All fields selected.</p>
                )}
              </div>
            </div>

            <div
              className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-2 min-h-36"
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (!draggingField || draggingField.from !== "available") return;
                setSelectedFieldIds((prev) => (prev.includes(draggingField.id) ? prev : [...prev, draggingField.id]));
                setDraggingField(null);
              }}
            >
              <p className="text-[11px] font-bold text-indigo-100 mb-2">Selected Fields</p>
              <div className="flex flex-wrap gap-1">
                {selectedColumns.map((column) => {
                  const field = fieldDefs.find((item) => item.column === column);
                  if (!field) return null;
                  return (
                    <button
                      key={field.id}
                      draggable
                      onDragStart={() => setDraggingField({ id: field.id, from: "selected" })}
                      className="rounded-md border border-indigo-300/40 bg-indigo-500/20 px-2 py-1 text-[11px] text-indigo-50"
                    >
                      {field.label}
                    </button>
                  );
                })}
                {selectedColumns.length === 0 && (
                  <p className="text-[11px] text-slate-400">Drag at least one field here.</p>
                )}
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Scheduled Reports">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
            <Select
              value={scheduleForm.reportKey}
              onChange={(event) => setScheduleForm((prev) => ({ ...prev, reportKey: event.target.value }))}
              className="field !py-2 !px-3 !text-xs"
            >
              {allCatalogItems.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </Select>
            <Select
              value={scheduleForm.format}
              onChange={(event) => setScheduleForm((prev) => ({ ...prev, format: event.target.value }))}
              className="field !py-2 !px-3 !text-xs"
            >
              <option value="PDF">PDF</option>
              <option value="CSV">CSV</option>
              <option value="XLSX">XLSX</option>
            </Select>
            <Select
              value={scheduleForm.frequency}
              onChange={(event) => setScheduleForm((prev) => ({ ...prev, frequency: event.target.value }))}
              className="field !py-2 !px-3 !text-xs"
            >
              <option value="Daily">Daily</option>
              <option value="Weekly">Weekly</option>
              <option value="Monthly">Monthly</option>
            </Select>
            <input
              type="time"
              value={scheduleForm.deliveryTime}
              onChange={(event) => setScheduleForm((prev) => ({ ...prev, deliveryTime: event.target.value }))}
              className="field !py-2 !px-3 !text-xs"
            />
            <input
              value={scheduleForm.emailTo}
              onChange={(event) => setScheduleForm((prev) => ({ ...prev, emailTo: event.target.value }))}
              className="field !py-2 !px-3 !text-xs"
              placeholder="Optional email"
            />
            <Button
              onClick={async () => {
                const item = reportByKey[scheduleForm.reportKey];
                if (!item) return;
                const nextSchedules = [
                  {
                    id: `schedule-${Date.now()}`,
                    report_key: scheduleForm.reportKey,
                    report_name: item.label,
                    format: scheduleForm.format,
                    frequency: scheduleForm.frequency,
                    delivery_time: scheduleForm.deliveryTime,
                    email_to: scheduleForm.emailTo?.trim() || null,
                    enabled: true,
                    created_by: currentUser?.full_name || currentUser?.username || "System",
                    created_at: new Date().toISOString(),
                  },
                  ...schedules,
                ];
                await persistSchedules(nextSchedules);
              }}
            >
              Add Schedule
            </Button>
          </div>
          <div className="mt-2">
            <MiniTable
              columns={[
                { label: "Report", value: "report_name" },
                { label: "Format", value: "format" },
                { label: "Frequency", value: "frequency" },
                { label: "Time", value: "delivery_time" },
                { label: "Email", value: (row) => row.email_to || "-" },
                {
                  label: "Enabled",
                  value: (row) => (
                    <button
                      className={`rounded-md px-2 py-1 text-[11px] ${row.enabled ? "bg-emerald-500/20 text-emerald-200" : "bg-slate-600/30 text-slate-300"}`}
                      onClick={async () => {
                        const next = schedules.map((item) =>
                          item.id === row.id ? { ...item, enabled: !item.enabled } : item,
                        );
                        await persistSchedules(next);
                      }}
                    >
                      {row.enabled ? "Enabled" : "Disabled"}
                    </button>
                  ),
                },
                {
                  label: "Action",
                  value: (row) => (
                    <button
                      className="rounded-md bg-red-500/20 px-2 py-1 text-[11px] text-red-200"
                      onClick={async () => {
                        const next = schedules.filter((item) => item.id !== row.id);
                        await persistSchedules(next);
                      }}
                    >
                      Delete
                    </button>
                  ),
                },
              ]}
              rows={schedules}
              emptyLabel="No schedules configured."
            />
          </div>
        </SectionCard>

        <SectionCard title="Bulk Export">
          <div className="flex flex-wrap gap-2">
            {allCatalogItems.map((item) => (
              <label key={`bulk-${item.key}`} className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200">
                <input
                  type="checkbox"
                  checked={bulkSelectedKeys.includes(item.key)}
                  onChange={(event) => {
                    setBulkSelectedKeys((prev) =>
                      event.target.checked ? [...new Set([...prev, item.key])] : prev.filter((key) => key !== item.key),
                    );
                  }}
                />
                {item.label}
              </label>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={doBulkExport} disabled={bulkSelectedKeys.length === 0}>
              Download ZIP ({bulkSelectedKeys.length})
            </Button>
            <p className="text-xs text-slate-400">ZIP uses the currently selected format.</p>
          </div>
        </SectionCard>

        <SectionCard title="Branding, Watermark & Permissions">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              value={options.branding?.shop_name || ""}
              onChange={(event) =>
                setOptions((prev) => ({
                  ...prev,
                  branding: { ...(prev.branding || {}), shop_name: event.target.value },
                }))
              }
              className="field !py-2 !px-3 !text-xs"
              placeholder="Shop name"
            />
            <input
              value={options.branding?.shop_address || ""}
              onChange={(event) =>
                setOptions((prev) => ({
                  ...prev,
                  branding: { ...(prev.branding || {}), shop_address: event.target.value },
                }))
              }
              className="field !py-2 !px-3 !text-xs"
              placeholder="Shop address"
            />
            <input
              value={options.branding?.shop_logo_text || ""}
              onChange={(event) =>
                setOptions((prev) => ({
                  ...prev,
                  branding: { ...(prev.branding || {}), shop_logo_text: event.target.value },
                }))
              }
              className="field !py-2 !px-3 !text-xs"
              placeholder="Logo text"
            />
            <input
              value={options.watermark_text || ""}
              onChange={(event) => setOptions((prev) => ({ ...prev, watermark_text: event.target.value }))}
              className="field !py-2 !px-3 !text-xs md:col-span-2"
              placeholder="Watermark text"
            />
            <label className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={Boolean(options.confidential_stamp)}
                onChange={(event) => setOptions((prev) => ({ ...prev, confidential_stamp: event.target.checked }))}
              />
              Confidential Stamp
            </label>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await api.put("/reports/export-center/options", options);
                } catch {
                  // keep local state
                }
              }}
            >
              Save Branding Options
            </Button>
          </div>

          {isAdmin && (
            <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-2">
              <p className="text-xs font-bold text-slate-200 mb-2">Export Permissions (role-level)</p>
              {Object.entries(permissions || {}).map(([role, rule]) => (
                <div key={role} className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-2">
                  <p className="text-xs text-slate-300 md:col-span-1 self-center">{role}</p>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-200 md:col-span-1">
                    <input
                      type="checkbox"
                      checked={Boolean(rule?.can_export)}
                      onChange={(event) =>
                        setPermissions((prev) => ({
                          ...prev,
                          [role]: { ...(prev[role] || {}), can_export: event.target.checked },
                        }))
                      }
                    />
                    Can Export
                  </label>
                  <input
                    value={(rule?.allowed_reports || []).join(",")}
                    onChange={(event) =>
                      setPermissions((prev) => ({
                        ...prev,
                        [role]: {
                          ...(prev[role] || {}),
                          allowed_reports: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        },
                      }))
                    }
                    className="field !py-2 !px-3 !text-xs md:col-span-3"
                    placeholder="Allowed report keys, comma-separated"
                  />
                </div>
              ))}
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  try {
                    await api.put("/reports/export-center/permissions", { permissions });
                  } catch {
                    // keep local
                  }
                }}
              >
                Save Permissions
              </Button>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="xl:col-span-4 space-y-3">
        <SectionCard title="Preview Pane">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs text-slate-300">{activeReportData.title}</p>
            <Badge tone={previewMode ? "green" : "amber"}>{previewMode ? "Preview On" : "Preview Off"}</Badge>
          </div>
          {previewMode ? (
            <MiniTable columns={selectedColumns} rows={previewRows} emptyLabel="No preview rows." />
          ) : (
            <p className="text-xs text-slate-400">Preview mode is currently disabled.</p>
          )}
        </SectionCard>

        <SectionCard title="Email Report">
          <div className="flex flex-wrap gap-2">
            <input
              value={emailTo}
              onChange={(event) => setEmailTo(event.target.value)}
              className="field !py-2 !px-3 !text-xs flex-1 min-w-[200px]"
              placeholder="name@example.com"
            />
            <Button onClick={sendEmailReport} disabled={!emailTo.trim()}>
              Send
            </Button>
          </div>
        </SectionCard>

        <SectionCard title="Recent Exports History">
          <MiniTable
            columns={[
              { label: "Report Name", value: "report_name" },
              { label: "Date Generated", value: (row) => (row.generated_at ? new Date(row.generated_at).toLocaleString() : "-") },
              { label: "Format", value: "format" },
              { label: "Generated By", value: "generated_by" },
              { label: "File Size", value: "file_size" },
              {
                label: "Download",
                value: (row) => (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (!row.report_key || !reportDataByKey[row.report_key]) return;
                      doSingleExport(row.report_key, row.format);
                    }}
                    disabled={!row.report_key || !reportDataByKey[row.report_key]}
                  >
                    Re-Generate
                  </Button>
                ),
              },
              {
                label: "Status",
                value: (row) => (
                  <Badge
                    tone={
                      String(row.status || "").toLowerCase().includes("fail")
                        ? "red"
                        : String(row.status || "").toLowerCase().includes("prepared")
                          ? "amber"
                          : "green"
                    }
                  >
                    {row.status || "Success"}
                  </Badge>
                ),
              },
            ]}
            rows={historyRows}
            emptyLabel="No export history recorded yet."
          />
        </SectionCard>

        <div className="grid grid-cols-1 gap-3">
          <KpiCard title="Scheduled Reports" value={schedules.length.toLocaleString()} icon={<CalendarClock size={18} />} />
          <KpiCard title="History Entries" value={historyRows.length.toLocaleString()} icon={<FileText size={18} />} tone="indigo" />
          <KpiCard title="Bulk Items Selected" value={bulkSelectedKeys.length.toLocaleString()} icon={<PackageOpen size={18} />} tone="amber" />
          <KpiCard title="Preview Fields" value={selectedColumns.length.toLocaleString()} icon={<Eye size={18} />} tone="green" />
        </div>

        <SectionCard title="Legend">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-white/10 bg-white/5 p-2 flex items-center gap-2"><FileText size={14} /> PDF branded exports</div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-2 flex items-center gap-2"><FileSpreadsheet size={14} /> XLSX with formatting</div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-2 flex items-center gap-2"><Printer size={14} /> Browser print view</div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-2 flex items-center gap-2"><PackageOpen size={14} /> ZIP bulk bundles</div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-2 flex items-center gap-2"><Mail size={14} /> Export prepared</div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-2 flex items-center gap-2"><ShieldCheck size={14} /> Role permissions</div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}


