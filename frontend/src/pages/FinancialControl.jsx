import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Download,
  FileText,
  Filter,
  Flag,
  Search,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import api from "../lib/api";
import { useFeedback } from "../components/FeedbackProvider";
import { Badge, Button, Input, KpiCard, SectionCard, Select, Table } from "../components/UI";
import { downloadCsv, downloadPdf } from "../lib/tableUtils";
import AppDrawer from "../components/layout/AppDrawer";

const TABS = [
  { key: "overview", label: "1. Audit Overview" },
  { key: "cash", label: "2. Cash Reconciliation" },
  { key: "closing", label: "3. Daily Closing" },
  { key: "transactions", label: "4. Transaction Verification" },
  { key: "discounts", label: "5. Discount & Override" },
  { key: "voids", label: "6. Void & Deletion" },
  { key: "payments", label: "7. Payment Integrity" },
  { key: "outstanding", label: "8. Outstanding Reconciliation" },
  { key: "expenses", label: "9. Expense Audit" },
  { key: "stock", label: "10. Stock vs Sales" },
  { key: "technician", label: "11. Technician Billing" },
  { key: "flags", label: "12. Flags & Alerts" },
];

const TAB_MODULE = {
  overview: "Audit Overview",
  cash: "Cash Reconciliation",
  closing: "Daily Closing",
  transactions: "Transaction Verification",
  discounts: "Discount & Override",
  voids: "Void & Deletion Audit",
  payments: "Payment Integrity",
  outstanding: "Outstanding Reconciliation",
  expenses: "Expense Audit",
  stock: "Stock vs Sales Reconciliation",
  technician: "Technician Billing",
  flags: "Audit Flags & Alerts",
};

const TAB_COLUMNS = {
  overview_active_flags: [
    { label: "Flag ID", value: "flag_id" },
    { label: "Severity", value: "severity" },
    { label: "Module", value: "module" },
    { label: "Description", value: "description" },
    { label: "Status", value: "status_badge" },
  ],
  overview_recent_activity: [
    { label: "Timestamp", value: "timestamp" },
    { label: "User", value: "user" },
    { label: "Action", value: "action" },
    { label: "Module", value: "module" },
    { label: "Description", value: "description" },
    { label: "Status", value: "status_badge" },
  ],
  overview_staff_activity: [
    { label: "Staff", value: "staff" },
    { label: "Transactions", value: "transactions" },
    { label: "Cash Handled", value: "cash_handled" },
    { label: "Discounts", value: "discounts" },
    { label: "Status", value: "status_badge" },
  ],
  cash: [
    { label: "Date", value: "date" },
    { label: "Cashier", value: "cashier" },
    { label: "System Total", value: "system_total" },
    { label: "Cash Counted", value: "cash_counted" },
    { label: "Difference", value: "difference" },
    { label: "Status", value: "status_badge" },
    { label: "Verified By", value: "verified_by" },
  ],
  closing: [
    { label: "Date", value: "date" },
    { label: "Generated At", value: "generated_at" },
    { label: "Verified By", value: "verified_by" },
    { label: "Status", value: "status_badge" },
    { label: "Net Revenue", value: "net_revenue" },
    { label: "Cash Variance", value: "variance" },
  ],
  transactions: [
    { label: "Timestamp", value: "timestamp" },
    { label: "Transaction ID", value: "transaction_id" },
    { label: "Type", value: "transaction_type" },
    { label: "Customer", value: "customer" },
    { label: "Amount", value: "amount" },
    { label: "Payment Method", value: "payment_method" },
    { label: "Status", value: "status_badge" },
  ],
  discounts: [
    { label: "Date", value: "date" },
    { label: "Invoice", value: "invoice_no" },
    { label: "Item/Service", value: "product_or_service" },
    { label: "Original", value: "original_price" },
    { label: "Discount %", value: "discount_pct" },
    { label: "Discount Amt", value: "discount_amount" },
    { label: "Final", value: "final_price" },
    { label: "Status", value: "status_badge" },
  ],
  voids: [
    { label: "Timestamp", value: "timestamp" },
    { label: "Record Type", value: "record_type" },
    { label: "Record ID", value: "record_id" },
    { label: "Description", value: "description" },
    { label: "Actor", value: "actor" },
    { label: "Recoverable", value: (row) => (row.recoverable ? "Yes" : "No") },
    { label: "Status", value: "status_badge" },
  ],
  payments: [
    { label: "Date", value: "date" },
    { label: "Payment ID", value: "payment_id" },
    { label: "Invoice/Job Ref", value: "invoice_ref" },
    { label: "Customer", value: "customer" },
    { label: "Amount", value: "amount" },
    { label: "Method", value: "method" },
    { label: "Matched", value: (row) => (row.matched ? "Yes" : "No") },
    { label: "Reconciled", value: (row) => (row.reconciled ? "Yes" : "No") },
    { label: "Status", value: "status_badge" },
  ],
  outstanding: [
    { label: "Customer", value: "customer" },
    { label: "# Invoices", value: "invoice_count" },
    { label: "Total Billed", value: "total_billed" },
    { label: "Total Paid", value: "total_paid" },
    { label: "Balance", value: "balance" },
    { label: "Risk", value: "risk_level" },
    { label: "Status", value: "status_badge" },
  ],
  expenses: [
    { label: "Date", value: "date" },
    { label: "Category", value: "category" },
    { label: "Description", value: "description" },
    { label: "Amount", value: "amount" },
    { label: "Receipt Ref", value: "receipt_ref" },
    { label: "Verified", value: (row) => (row.verified ? "Yes" : "No") },
    { label: "Flag", value: "flag" },
    { label: "Status", value: "status_badge" },
  ],
  stock: [
    { label: "Product", value: "product" },
    { label: "Opening", value: "opening_stock" },
    { label: "Purchased", value: "purchased" },
    { label: "Sold", value: "sold_pos" },
    { label: "Used Repairs", value: "used_repairs" },
    { label: "Expected", value: "expected_closing" },
    { label: "Actual", value: "actual_closing" },
    { label: "Difference", value: "difference" },
    { label: "Status", value: "status_badge" },
  ],
  technician: [
    { label: "Job ID", value: "job_id" },
    { label: "Date Completed", value: "date_completed" },
    { label: "Technician", value: "technician" },
    { label: "Device", value: "device" },
    { label: "Customer", value: "customer" },
    { label: "Invoice Created", value: (row) => (row.invoice_created ? "Yes" : "No") },
    { label: "Invoice Amount", value: "invoice_amount" },
    { label: "Collected", value: "amount_collected" },
    { label: "Balance", value: "balance" },
    { label: "Status", value: "status_badge" },
  ],
  flags: [
    { label: "Flag ID", value: "flag_id" },
    { label: "Date Raised", value: "date_raised" },
    { label: "Severity", value: "severity" },
    { label: "Module", value: "module" },
    { label: "Description", value: "description" },
    { label: "Raised By", value: "raised_by" },
    { label: "Assigned To", value: "assigned_to" },
    { label: "Status", value: "status_badge" },
  ],
};

function toneFrom(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("red") || normalized.includes("critical")) return "red";
  if (normalized.includes("amber") || normalized.includes("orange") || normalized.includes("high")) return "amber";
  if (normalized.includes("green") || normalized.includes("verified")) return "green";
  if (normalized.includes("indigo")) return "indigo";
  if (normalized.includes("violet")) return "violet";
  return "sky";
}

function statusTone(status) {
  if (status === "Verified" || status === "Resolved") return "green";
  if (status === "Flagged") return "red";
  if (status === "Pending Review") return "amber";
  return "indigo";
}

function formatCell(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const asText = String(value);
  if (asText.includes("T") && asText.includes(":") && !Number.isNaN(new Date(asText).getTime())) {
    return new Date(asText).toLocaleString();
  }
  return asText;
}

function resolveValue(column, row) {
  return typeof column.value === "function" ? column.value(row) : row[column.value];
}

function MiniBars({ title, data = [], labelKey = "label", valueKey = "value", limit = 8 }) {
  const maxValue = Math.max(1, ...data.map((row) => Number(row[valueKey] || 0)));
  const rows = data.slice(0, limit);
  return (
    <SectionCard title={title} className="h-full">
      <div className="space-y-2">
        {rows.length === 0 && <div className="text-xs text-slate-500">No data available.</div>}
        {rows.map((row, idx) => {
          const value = Number(row[valueKey] || 0);
          const width = Math.max(2, Math.round((value / maxValue) * 100));
          return (
            <div key={`${title}-${idx}`} className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-300">
                <span className="truncate max-w-[70%]">{String(row[labelKey] ?? "-")}</span>
                <span className="font-bold">{value.toLocaleString()}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-sky-400 to-emerald-400" style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function CompactTable({
  columns,
  rows,
  onResolve,
  onEscalate,
  onReview,
  resolveEnabled = true,
  limit = 200,
}) {
  const pageRows = rows.slice(0, limit);
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/25">
      <Table className="text-xs">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.label}>{col.label}</th>
            ))}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="py-6 text-center text-slate-500">
                No records found.
              </td>
            </tr>
          )}
          {pageRows.map((row, idx) => {
            const status = row.status_badge || row.status || "Pending Review";
            const canResolve = resolveEnabled && status !== "Resolved" && status !== "Verified";
            return (
              <tr key={row.id || row.flag_id || row.transaction_id || idx}>
                {columns.map((col) => {
                  const value = resolveValue(col, row);
                  if (col.value === "status_badge" || col.value === "status") {
                    return (
                      <td key={`${idx}-${col.label}`}>
                        <Badge tone={statusTone(String(value || status))}>{String(value || status)}</Badge>
                      </td>
                    );
                  }
                  return <td key={`${idx}-${col.label}`}>{formatCell(value)}</td>;
                })}
                <td>
                  <div className="flex gap-1">
                    {onReview && (
                      <button
                        className="px-2 py-1 rounded bg-sky-500/20 text-sky-200 hover:bg-sky-500/30"
                        onClick={() => onReview(row)}
                      >
                        Verify
                      </button>
                    )}
                    {canResolve && (
                      <button
                        className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
                        onClick={() => onResolve(row)}
                      >
                        Resolve
                      </button>
                    )}
                    {canResolve && onEscalate && (
                      <button
                        className="px-2 py-1 rounded bg-amber-500/20 text-amber-100 hover:bg-amber-500/30"
                        onClick={() => onEscalate(row)}
                      >
                        Escalate
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}

function ResolveDrawer({ open, title, row, notes, setNotes, onClose, onSubmit, busy }) {
  return (
    <AppDrawer open={open} onClose={onClose} panelClassName="max-w-md bg-slate-950">
      <div className="flex min-h-full flex-col p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-white uppercase tracking-widest">{title}</h3>
          <button className="text-slate-400 hover:text-white" onClick={onClose}>Close</button>
        </div>
        <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4 text-xs text-slate-200 space-y-2">
          <div><span className="text-slate-400">Record:</span> {row?.flag_id || row?.recon_id || row?.transaction_id || row?.job_id || row?.invoice_no || "-"}</div>
          <div><span className="text-slate-400">Module:</span> {row?.module || "-"}</div>
          <div><span className="text-slate-400">Status:</span> {row?.status_badge || row?.status || "-"}</div>
          {row?.description && <div><span className="text-slate-400">Description:</span> {row.description}</div>}
        </div>
        <label className="text-xs font-bold text-slate-300 mt-4 mb-2 uppercase tracking-widest">Resolution Notes</label>
        <textarea
          className="field min-h-[140px] resize-none"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Add investigation notes, root cause, and corrective action."
        />
        <div className="mt-auto pt-4 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" onClick={onSubmit} disabled={busy || !notes.trim()}>
            {busy ? "Saving..." : "Mark Resolved"}
          </Button>
        </div>
      </div>
    </AppDrawer>
  );
}

function buildExportData(activeTab, stateData) {
  if (!stateData) return { title: "Financial Audit", columns: [], rows: [] };
  const map = {
    overview: {
      title: "Audit Overview - Active Flags",
      columns: TAB_COLUMNS.overview_active_flags,
      rows: stateData.overview?.active_flags || [],
    },
    cash: {
      title: "Cash Reconciliation",
      columns: TAB_COLUMNS.cash,
      rows: stateData.cash_reconciliation?.rows || [],
    },
    closing: {
      title: "Daily Closing Reports",
      columns: TAB_COLUMNS.closing,
      rows: stateData.daily_closing?.rows || [],
    },
    transactions: {
      title: "Transaction Verification",
      columns: TAB_COLUMNS.transactions,
      rows: stateData.transaction_verification?.rows || [],
    },
    discounts: {
      title: "Discount & Override Audit",
      columns: TAB_COLUMNS.discounts,
      rows: stateData.discount_override?.rows || [],
    },
    voids: {
      title: "Void & Deletion Audit",
      columns: TAB_COLUMNS.voids,
      rows: stateData.void_deletion?.rows || [],
    },
    payments: {
      title: "Payment Integrity Check",
      columns: TAB_COLUMNS.payments,
      rows: stateData.payment_integrity?.rows || [],
    },
    outstanding: {
      title: "Outstanding Reconciliation",
      columns: TAB_COLUMNS.outstanding,
      rows: stateData.outstanding_reconciliation?.rows || [],
    },
    expenses: {
      title: "Expense Audit",
      columns: TAB_COLUMNS.expenses,
      rows: stateData.expense_audit?.rows || [],
    },
    stock: {
      title: "Stock vs Sales Reconciliation",
      columns: TAB_COLUMNS.stock,
      rows: stateData.stock_sales_reconciliation?.rows || [],
    },
    technician: {
      title: "Technician Billing Audit",
      columns: TAB_COLUMNS.technician,
      rows: stateData.technician_billing?.rows || [],
    },
    flags: {
      title: "Audit Flags & Alerts",
      columns: TAB_COLUMNS.flags,
      rows: stateData.flags_alerts?.rows || [],
    },
  };
  return map[activeTab] || map.overview;
}

export default function FinancialControl() {
  const { toast } = useFeedback();
  const [activeTab, setActiveTab] = useState("overview");
  const [stateData, setStateData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [form, setForm] = useState({
    recon_date: new Date().toISOString().slice(0, 10),
    shift: "Full Day",
    opening_float: 0,
    closing_float: 0,
    counted_cash_total: 0,
    notes: "",
  });

  const [filters, setFilters] = useState(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      date_from: from.toISOString().slice(0, 10),
      date_to: now.toISOString().slice(0, 10),
      staff_id: "all",
      module: "all",
      flag_status: "all",
    };
  });

  const fetchState = async () => {
    try {
      setLoading(true);
      const params = {
        date_from: filters.date_from,
        date_to: filters.date_to,
        module: filters.module,
        flag_status: filters.flag_status,
      };
      if (filters.staff_id !== "all") params.staff_id = Number(filters.staff_id);
      const { data } = await api.get("/financial-audit/state", { params });
      setStateData(data);
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to load financial audit state", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchState();
  }, [filters.date_from, filters.date_to, filters.staff_id, filters.module, filters.flag_status]);

  const runResolveAction = async () => {
    if (!selectedRow || !resolutionNotes.trim()) return;
    try {
      setBusy(true);
      if (activeTab === "cash" && selectedRow.id) {
        await api.put(`/financial-audit/cash-reconciliation/${selectedRow.id}/resolve`, {
          resolution_notes: resolutionNotes.trim(),
          status: "Resolved",
        });
      } else if (activeTab === "flags" && selectedRow.id) {
        await api.put(`/financial-audit/flags/${selectedRow.id}/resolve`, {
          resolution_notes: resolutionNotes.trim(),
          status: "Resolved",
        });
      } else if (activeTab === "transactions") {
        const tx = String(selectedRow.id || "");
        const [prefix, rawId] = tx.split("-");
        const transactionType = prefix === "R" ? "Repair" : "Sale";
        await api.put(`/financial-audit/transactions/${transactionType}/${Number(rawId)}/review`, {
          status: "Resolved",
          notes: resolutionNotes.trim(),
        });
      } else {
        const created = await api.post("/financial-audit/flags", {
          severity: "Medium",
          module: TAB_MODULE[activeTab],
          flag_type: "Manual row review",
          description: resolutionNotes.trim(),
          reference_code: `manual-${activeTab}-${Date.now()}`,
          amount: Number(selectedRow.amount || selectedRow.balance || selectedRow.difference || 0),
        });
        await api.put(`/financial-audit/flags/${created.data.id}/resolve`, {
          resolution_notes: resolutionNotes.trim(),
          status: "Resolved",
        });
      }
      toast("Flag resolved and logged.", "success");
      setDrawerOpen(false);
      setResolutionNotes("");
      setSelectedRow(null);
      await fetchState();
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to resolve item", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleEscalate = async (row) => {
    try {
      if (!row?.id) return;
      await api.put(`/financial-audit/flags/${row.id}/escalate`);
      toast("Flag escalated.", "info");
      await fetchState();
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to escalate flag", "error");
    }
  };

  const handleTransactionReview = async (row) => {
    try {
      const tx = String(row.id || "");
      const [prefix, rawId] = tx.split("-");
      const transactionType = prefix === "R" ? "Repair" : "Sale";
      await api.put(`/financial-audit/transactions/${transactionType}/${Number(rawId)}/review`, {
        status: "Verified",
        notes: "Verified from Financial Audit module.",
      });
      toast("Transaction verified.", "success");
      await fetchState();
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to verify transaction", "error");
    }
  };

  const handleCreateReconciliation = async () => {
    try {
      setBusy(true);
      await api.post("/financial-audit/cash-reconciliation", {
        recon_date: form.recon_date,
        shift: form.shift,
        opening_float: Number(form.opening_float || 0),
        closing_float: Number(form.closing_float || 0),
        counted_cash_total: Number(form.counted_cash_total || 0),
        notes: form.notes || null,
      });
      toast("Cash reconciliation entry created.", "success");
      setForm((prev) => ({ ...prev, opening_float: 0, closing_float: 0, counted_cash_total: 0, notes: "" }));
      await fetchState();
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to create reconciliation", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateDailyClosing = async () => {
    try {
      setBusy(true);
      await api.post("/financial-audit/daily-closing/generate", {
        report_date: filters.date_to,
      });
      toast("Daily closing report generated.", "success");
      await fetchState();
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to generate daily closing", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyClosing = async (row) => {
    try {
      setBusy(true);
      await api.put(`/financial-audit/daily-closing/${row.id}/verify`, {
        notes: "Signed from Financial Audit module.",
      });
      toast("Daily closing signed successfully.", "success");
      await fetchState();
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to sign daily closing", "error");
    } finally {
      setBusy(false);
    }
  };

  const openResolveDrawer = (row) => {
    setSelectedRow(row);
    setResolutionNotes("");
    setDrawerOpen(true);
  };

  const filteredSearchRows = (rows) => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(q));
  };

  const exportData = useMemo(() => buildExportData(activeTab, stateData), [activeTab, stateData]);

  const onExportCsv = async () => {
    const rows = filteredSearchRows(exportData.rows || []);
    const size = downloadCsv(`${activeTab}-financial-audit.csv`, exportData.columns, rows);
    toast(`CSV exported (${Math.max(1, Math.round(size / 1024))} KB).`, "success");
  };

  const onExportPdf = async () => {
    try {
      const rows = filteredSearchRows(exportData.rows || []);
      const size = await downloadPdf(
        `${activeTab}-financial-audit`,
        exportData.title,
        exportData.columns,
        rows,
        { watermark: "Confidential" },
      );
      toast(`PDF exported (${Math.max(1, Math.round(size / 1024))} KB).`, "success");
    } catch {
      toast("PDF export failed", "error");
    }
  };

  if (loading && !stateData) {
    return <div className="h-full min-h-0 grid place-items-center text-slate-400">Loading Financial Audit module...</div>;
  }

  const overview = stateData?.overview || {};
  const cash = stateData?.cash_reconciliation || {};
  const closing = stateData?.daily_closing || {};
  const transactions = stateData?.transaction_verification || {};
  const discounts = stateData?.discount_override || {};
  const voids = stateData?.void_deletion || {};
  const payments = stateData?.payment_integrity || {};
  const outstanding = stateData?.outstanding_reconciliation || {};
  const expenses = stateData?.expense_audit || {};
  const stock = stateData?.stock_sales_reconciliation || {};
  const technician = stateData?.technician_billing || {};
  const flags = stateData?.flags_alerts || {};

  return (
    <div className="flex flex-col h-full gap-4 pb-4">
      <div className="flex flex-wrap items-end justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-3">
            <ShieldCheck className="text-rose-400" /> Financial Audit
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time financial integrity layer for reconciliation, verification, and risk controls.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onExportCsv} variant="secondary"><Download size={14} /> Export CSV</Button>
          <Button onClick={onExportPdf}><FileText size={14} /> Export PDF</Button>
        </div>
      </div>

      <div className="sticky top-0 z-20 rounded-2xl border border-white/10 bg-slate-950/90 backdrop-blur p-3">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Date From</label>
            <Input type="date" value={filters.date_from} onChange={(event) => setFilters((prev) => ({ ...prev, date_from: event.target.value }))} />
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Date To</label>
            <Input type="date" value={filters.date_to} onChange={(event) => setFilters((prev) => ({ ...prev, date_to: event.target.value }))} />
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Staff</label>
            <Select value={filters.staff_id} onChange={(event) => setFilters((prev) => ({ ...prev, staff_id: event.target.value }))}>
              <option value="all">All Staff</option>
              {(stateData?.filters?.staff || []).map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Module</label>
            <Select value={filters.module} onChange={(event) => setFilters((prev) => ({ ...prev, module: event.target.value }))}>
              <option value="all">All Modules</option>
              {(stateData?.filters?.modules || []).map((row) => (
                <option key={row} value={row}>{row}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Flag Status</label>
            <Select value={filters.flag_status} onChange={(event) => setFilters((prev) => ({ ...prev, flag_status: event.target.value }))}>
              {(stateData?.filters?.flag_statuses || ["all", "Open", "Resolved"]).map((row) => (
                <option key={row} value={row}>{row}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Search Rows</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-3 text-slate-500" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-8" placeholder="Search record..." />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider border transition ${
              activeTab === tab.key
                ? "bg-rose-500/20 border-rose-400/40 text-rose-200"
                : "bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4 custom-scrollbar">
        {activeTab === "overview" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {(overview.kpis_row_1 || []).map((kpi) => (
                <KpiCard key={kpi.label} title={kpi.label} value={formatCell(kpi.value)} tone={toneFrom(kpi.tone)} />
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {(overview.kpis_row_2 || []).map((kpi) => (
                <KpiCard key={kpi.label} title={kpi.label} value={formatCell(kpi.value)} tone={toneFrom(kpi.tone)} />
              ))}
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <SectionCard title="Active Flags List">
                <CompactTable
                  columns={TAB_COLUMNS.overview_active_flags}
                  rows={filteredSearchRows(overview.active_flags || [])}
                  onResolve={openResolveDrawer}
                  onEscalate={handleEscalate}
                />
              </SectionCard>
              <SectionCard title="Recent Activity Feed">
                <CompactTable
                  columns={TAB_COLUMNS.overview_recent_activity}
                  rows={filteredSearchRows(overview.recent_activity || [])}
                  onResolve={openResolveDrawer}
                />
              </SectionCard>
            </div>
            <SectionCard title="Staff Financial Activity Today">
              <CompactTable
                columns={TAB_COLUMNS.overview_staff_activity}
                rows={filteredSearchRows(overview.staff_financial_activity || [])}
                resolveEnabled={false}
              />
            </SectionCard>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <MiniBars title="Flag Trend (30 days)" data={overview.charts?.flag_trend_line || []} labelKey="date" valueKey="flags" />
              <MiniBars title="Cash vs System (Counted)" data={overview.charts?.cash_vs_system_revenue || []} labelKey="date" valueKey="counted" />
              <MiniBars title="Flag Distribution" data={overview.charts?.flag_type_distribution || []} labelKey="type" valueKey="count" />
              <MiniBars title="Resolution Rate (%)" data={overview.charts?.resolution_rate_trend || []} labelKey="date" valueKey="rate" />
            </div>
          </>
        )}

        {activeTab === "cash" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {(cash.kpis || []).map((kpi) => (
                <KpiCard key={kpi.label} title={kpi.label} value={formatCell(kpi.value)} tone={toneFrom(kpi.tone)} />
              ))}
            </div>
            <SectionCard title="Reconciliation Entry Form" subtitle="Create shift/day cash reconciliation records with automatic variance detection.">
              <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
                <Input type="date" value={form.recon_date} onChange={(event) => setForm((prev) => ({ ...prev, recon_date: event.target.value }))} />
                <Select value={form.shift} onChange={(event) => setForm((prev) => ({ ...prev, shift: event.target.value }))}>
                  <option value="Full Day">Full Day</option>
                  <option value="Morning">Morning</option>
                  <option value="Evening">Evening</option>
                </Select>
                <Input type="number" value={form.opening_float} onChange={(event) => setForm((prev) => ({ ...prev, opening_float: event.target.value }))} placeholder="Opening Float" />
                <Input type="number" value={form.counted_cash_total} onChange={(event) => setForm((prev) => ({ ...prev, counted_cash_total: event.target.value }))} placeholder="Counted Cash" />
                <Input type="number" value={form.closing_float} onChange={(event) => setForm((prev) => ({ ...prev, closing_float: event.target.value }))} placeholder="Closing Float" />
                <Button onClick={handleCreateReconciliation} disabled={busy}><ClipboardCheck size={14} /> Submit</Button>
              </div>
              <Input className="mt-2" value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} placeholder="Variance explanation notes..." />
            </SectionCard>
            <SectionCard title="Reconciliation History">
              <CompactTable
                columns={TAB_COLUMNS.cash}
                rows={filteredSearchRows(cash.rows || [])}
                onResolve={openResolveDrawer}
              />
            </SectionCard>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <MiniBars title="Daily Cash Variance" data={cash.charts?.daily_cash_variance || []} labelKey="date" valueKey="variance" />
              <MiniBars title="Cashier Variance" data={cash.charts?.cashier_variance || []} labelKey="cashier" valueKey="variance" />
              <MiniBars title="Running Balance" data={cash.charts?.running_cash_balance || []} labelKey="date" valueKey="running_balance" />
            </div>
          </>
        )}

        {activeTab === "closing" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(closing.kpis || []).map((kpi) => (
                <KpiCard key={kpi.label} title={kpi.label} value={formatCell(kpi.value)} tone={toneFrom(kpi.tone)} />
              ))}
            </div>
            <SectionCard
              title="Daily Closing Reports"
              right={<Button onClick={handleGenerateDailyClosing} disabled={busy}><CircleDollarSign size={14} /> Generate Daily Closing</Button>}
            >
              <CompactTable
                columns={TAB_COLUMNS.closing}
                rows={filteredSearchRows(closing.rows || [])}
                onResolve={openResolveDrawer}
                onReview={handleVerifyClosing}
              />
            </SectionCard>
          </>
        )}

        {activeTab === "transactions" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {(transactions.kpis || []).map((kpi) => (
                <KpiCard key={kpi.label} title={kpi.label} value={formatCell(kpi.value)} tone={toneFrom(kpi.tone)} />
              ))}
            </div>
            <SectionCard title="Transaction Log (Master)">
              <CompactTable
                columns={TAB_COLUMNS.transactions}
                rows={filteredSearchRows(transactions.rows || [])}
                onResolve={openResolveDrawer}
                onReview={handleTransactionReview}
              />
            </SectionCard>
          </>
        )}

        {activeTab === "discounts" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {(discounts.kpis || []).map((kpi) => (
                <KpiCard key={kpi.label} title={kpi.label} value={formatCell(kpi.value)} tone={toneFrom(kpi.tone)} />
              ))}
            </div>
            <SectionCard title="Discount Log">
              <CompactTable columns={TAB_COLUMNS.discounts} rows={filteredSearchRows(discounts.rows || [])} onResolve={openResolveDrawer} />
            </SectionCard>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <MiniBars title="Discount by Staff" data={discounts.charts?.discount_by_staff || []} labelKey="staff" valueKey="amount" />
              <MiniBars title="Discount Trend" data={discounts.charts?.discount_trend || []} labelKey="date" valueKey="amount" />
              <MiniBars title="Discount by Category" data={discounts.charts?.discount_by_category || []} labelKey="category" valueKey="amount" />
              <MiniBars title="Threshold Distribution" data={discounts.charts?.threshold_distribution || []} labelKey="type" valueKey="count" />
            </div>
          </>
        )}

        {activeTab === "voids" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {(voids.kpis || []).map((kpi) => (
                <KpiCard key={kpi.label} title={kpi.label} value={formatCell(kpi.value)} tone={toneFrom(kpi.tone)} />
              ))}
            </div>
            <SectionCard title="Void / Deletion Log">
              <CompactTable columns={TAB_COLUMNS.voids} rows={filteredSearchRows(voids.rows || [])} onResolve={openResolveDrawer} />
            </SectionCard>
          </>
        )}

        {activeTab === "payments" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {(payments.kpis || []).map((kpi) => (
                <KpiCard key={kpi.label} title={kpi.label} value={formatCell(kpi.value)} tone={toneFrom(kpi.tone)} />
              ))}
            </div>
            <SectionCard title="Payment Verification Table">
              <CompactTable columns={TAB_COLUMNS.payments} rows={filteredSearchRows(payments.rows || [])} onResolve={openResolveDrawer} />
            </SectionCard>
          </>
        )}

        {activeTab === "outstanding" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
              {(outstanding.kpis || []).map((kpi) => (
                <KpiCard key={kpi.label} title={kpi.label} value={formatCell(kpi.value)} tone={toneFrom(kpi.tone)} />
              ))}
            </div>
            <SectionCard title="Outstanding Reconciliation">
              <CompactTable columns={TAB_COLUMNS.outstanding} rows={filteredSearchRows(outstanding.rows || [])} onResolve={openResolveDrawer} />
            </SectionCard>
          </>
        )}

        {activeTab === "expenses" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {(expenses.kpis || []).map((kpi) => (
                <KpiCard key={kpi.label} title={kpi.label} value={formatCell(kpi.value)} tone={toneFrom(kpi.tone)} />
              ))}
            </div>
            <SectionCard title="Expense Audit Table">
              <CompactTable columns={TAB_COLUMNS.expenses} rows={filteredSearchRows(expenses.rows || [])} onResolve={openResolveDrawer} />
            </SectionCard>
          </>
        )}

        {activeTab === "stock" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {(stock.kpis || []).map((kpi) => (
                <KpiCard key={kpi.label} title={kpi.label} value={formatCell(kpi.value)} tone={toneFrom(kpi.tone)} />
              ))}
            </div>
            <SectionCard title="Stock Reconciliation Table">
              <CompactTable columns={TAB_COLUMNS.stock} rows={filteredSearchRows(stock.rows || [])} onResolve={openResolveDrawer} />
            </SectionCard>
          </>
        )}

        {activeTab === "technician" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {(technician.kpis || []).map((kpi) => (
                <KpiCard key={kpi.label} title={kpi.label} value={formatCell(kpi.value)} tone={toneFrom(kpi.tone)} />
              ))}
            </div>
            <SectionCard title="Technician Billing Table">
              <CompactTable columns={TAB_COLUMNS.technician} rows={filteredSearchRows(technician.rows || [])} onResolve={openResolveDrawer} />
            </SectionCard>
          </>
        )}

        {activeTab === "flags" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {(flags.kpis || []).map((kpi) => (
                <KpiCard key={kpi.label} title={kpi.label} value={formatCell(kpi.value)} tone={toneFrom(kpi.tone)} />
              ))}
            </div>
            <SectionCard title="All Flags">
              <CompactTable columns={TAB_COLUMNS.flags} rows={filteredSearchRows(flags.rows || [])} onResolve={openResolveDrawer} onEscalate={handleEscalate} />
            </SectionCard>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
              <MiniBars title="Open by Severity" data={flags.charts?.open_by_severity || []} labelKey="severity" valueKey="count" />
              <MiniBars title="Flags per Day" data={flags.charts?.flags_per_day || []} labelKey="date" valueKey="flags" />
              <MiniBars title="Flags by Module" data={flags.charts?.flags_by_module || []} labelKey="module" valueKey="count" />
              <MiniBars title="Resolution Histogram" data={flags.charts?.resolution_histogram || []} labelKey="days_bucket" valueKey="count" />
              <MiniBars title="Staff Involvement" data={flags.charts?.staff_involvement || []} labelKey="staff" valueKey="count" />
            </div>
          </>
        )}
      </div>

      <ResolveDrawer
        open={drawerOpen}
        title="Resolve Audit Item"
        row={selectedRow}
        notes={resolutionNotes}
        setNotes={setResolutionNotes}
        onClose={() => setDrawerOpen(false)}
        onSubmit={runResolveAction}
        busy={busy}
      />
    </div>
  );
}
