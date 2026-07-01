import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CalendarRange,
  FileDown,
  Filter,
  History,
  Lock,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { Badge, Button, KpiCard, SectionCard, Select, Table } from "../components/UI";
import { downloadCsv, downloadPdf, openPrintView, paginateRows } from "../lib/tableUtils";
import { useFeedback } from "../components/FeedbackProvider";
import api from "../lib/api";
import AppDrawer from "../components/layout/AppDrawer";

const TRACKED_MODULES_FALLBACK = [
  "Login/Auth",
  "POS/Billing",
  "Repairs",
  "Inventory",
  "Customers",
  "Suppliers",
  "Expenses",
  "Warranty",
  "Returns",
  "Reports",
  "Settings",
  "Backup & Restore",
  "Access Control",
];

const STATUS_OPTIONS = ["Success", "Failed", "Blocked", "Warning"];
const PAGE_SIZE = 40;

function initialDateRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    date_from: start.toISOString().slice(0, 10),
    date_to: now.toISOString().slice(0, 10),
  };
}

function toText(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toPrettyJson(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function shortText(value, max = 64) {
  const text = toText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function statusTone(status) {
  const key = String(status || "").toLowerCase();
  if (key === "failed" || key === "blocked") return "red";
  if (key === "warning") return "amber";
  return "green";
}

function severityTone(severity) {
  const key = String(severity || "").toLowerCase();
  if (key.includes("critical")) return "red";
  if (key.includes("warning")) return "amber";
  return "sky";
}

function formatUserAgent(ua) {
  if (!ua) return "";
  let browser = "Unknown Browser";
  let os = "Unknown OS";
  
  if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Edg")) browser = "Edge";
  else if (ua.includes("Chrome")) browser = "Chrome";
  else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
  
  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac OS") || ua.includes("Macintosh")) os = "Mac";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
  
  if (browser === "Unknown Browser" && os === "Unknown OS") return ua.length > 30 ? `${ua.substring(0, 30)}...` : ua;
  return `${os} (${browser})`;
}

function deviceIpLabel(row) {
  const ip = String(row?.ip_address || "").trim();
  const device = String(row?.device_info || "").trim();
  const formattedDevice = formatUserAgent(device);
  
  if (ip && formattedDevice) return `${ip} | ${formattedDevice}`;
  if (ip) return ip;
  if (formattedDevice) return formattedDevice;
  return "-";
}

function formatTargetRecord(value) {
  if (!value) return "-";
  let str = String(value);
  try { str = decodeURIComponent(str); } catch(e){}
  
  if (str.startsWith("/")) {
    const parts = str.split("?");
    const path = parts[0];
    const breadcrumbs = path.split("/").filter(Boolean).map(p => 
      p.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
    ).join(" > ");
    
    let queryDesc = "";
    if (parts[1]) {
      const q = new URLSearchParams(parts[1]);
      const params = Array.from(q.keys());
      if (params.length) queryDesc = ` (filters: ${params.join(", ")})`;
    }
    return breadcrumbs + queryDesc;
  }
  return str;
}

function formatPayload(value) {
  if (!value) return "-";
  
  let obj = value;
  if (typeof value === "string") {
    try {
      obj = JSON.parse(value);
    } catch {
      return value;
    }
  }
  
  if (typeof obj !== "object" || obj === null) return String(value);
  
  if (obj.method && obj.path) {
    return `API Request: ${obj.method} ${obj.path}`;
  }
  
  const entries = Object.entries(obj).filter(([k,v]) => v !== null && v !== undefined && v !== "");
  if (entries.length === 0) return "No changes";
  
  return entries.map(([k,v]) => {
    const keyName = k.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    let valStr = String(v);
    if (typeof v === "object") valStr = "{...}";
    return `${keyName}: ${valStr}`;
  }).join(" | ");
}

function formatDateTime(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString();
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

export default function ActivityLog() {
  const { toast, prompt } = useFeedback();
  const [filters, setFilters] = useState({
    ...initialDateRange(),
    user: "",
    role: "",
    module: "",
    action: "",
    status: "",
    search: "",
    invoice_id: "",
    repair_ticket_id: "",
    product_sku: "",
    customer_name: "",
    only_sensitive: false,
    include_archived: false,
  });
  const [payload, setPayload] = useState({
    summary: {
      todays_activities: 0,
      failed_login_attempts: 0,
      stock_changes: 0,
      invoice_voids: 0,
      permission_changes: 0,
      deleted_records: 0,
    },
    rows: [],
    security_alerts: [],
    module_counts: {},
    tracked_modules: TRACKED_MODULES_FALLBACK,
    meta: {},
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [archiveBusy, setArchiveBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setAccessDenied(false);

    const params = {
      date_from: filters.date_from || undefined,
      date_to: filters.date_to || undefined,
      user: filters.user || undefined,
      role: filters.role || undefined,
      module: filters.module || undefined,
      action: filters.action || undefined,
      status: filters.status || undefined,
      search: filters.search || undefined,
      invoice_id: filters.invoice_id || undefined,
      repair_ticket_id: filters.repair_ticket_id || undefined,
      product_sku: filters.product_sku || undefined,
      customer_name: filters.customer_name || undefined,
      only_sensitive: filters.only_sensitive || undefined,
      include_archived: filters.include_archived || undefined,
      limit: 5000,
      source_limit: 15000,
    };

    api
      .get("/audit-trail/events", { params })
      .then((res) => {
        if (!active) return;
        const next = res.data || {};
        setPayload({
          summary: next.summary || {},
          rows: Array.isArray(next.rows) ? next.rows : [],
          security_alerts: Array.isArray(next.security_alerts) ? next.security_alerts : [],
          module_counts: next.module_counts || {},
          tracked_modules: Array.isArray(next.tracked_modules) && next.tracked_modules.length ? next.tracked_modules : TRACKED_MODULES_FALLBACK,
          meta: next.meta || {},
        });
        setPage(1);
      })
      .catch((err) => {
        if (!active) return;
        if (err?.response?.status === 403) {
          setAccessDenied(true);
          return;
        }
        setError(err?.response?.data?.detail || err.message || "Failed to load audit trail.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filters, refreshToken]);

  const rows = payload.rows || [];
  const summary = payload.summary || {};
  const alerts = payload.security_alerts || [];
  const trackedModules = payload.tracked_modules || TRACKED_MODULES_FALLBACK;
  const moduleCounts = payload.module_counts || {};

  const userOptions = useMemo(() => uniqueSorted(rows.map((row) => row.user)), [rows]);
  const roleOptions = useMemo(() => uniqueSorted(rows.map((row) => row.role_key || row.role)), [rows]);
  const moduleOptions = useMemo(() => uniqueSorted([...trackedModules, ...rows.map((row) => row.module)]), [rows, trackedModules]);
  const actionOptions = useMemo(() => uniqueSorted(rows.map((row) => row.action)), [rows]);

  const { pageRows, totalPages } = useMemo(() => paginateRows(rows, page, PAGE_SIZE), [rows, page]);

  const exportColumns = useMemo(
    () => [
      { label: "Date & Time", value: (row) => formatDateTime(row.timestamp) },
      { label: "User", value: "user" },
      { label: "Role", value: "role" },
      { label: "Action", value: "action" },
      { label: "Module", value: "module" },
      { label: "Target Record", value: (row) => formatTargetRecord(row.target_record) },
      { label: "Old Value", value: (row) => formatPayload(row.old_value) },
      { label: "New Value", value: (row) => formatPayload(row.new_value) },
      { label: "Device/IP", value: (row) => deviceIpLabel(row) },
      { label: "Status", value: "status" },
    ],
    [],
  );

  const resetFilters = () => {
    setFilters({
      ...initialDateRange(),
      user: "",
      role: "",
      module: "",
      action: "",
      status: "",
      search: "",
      invoice_id: "",
      repair_ticket_id: "",
      product_sku: "",
      customer_name: "",
      only_sensitive: false,
      include_archived: false,
    });
  };

  const handleArchive = async (eventId) => {
    if (!eventId) return;
    try {
      setArchiveBusy(true);
      const reasonInput = await prompt("Archive Audit Logs", "Optional archive reason for the audit record.", {
        placeholder: "Reason",
        multiline: true,
      }) || "";
      await api.post("/audit-trail/archive", { event_ids: [eventId], reason: reasonInput.trim() || null });
      toast("Log archived successfully.", "success");
      setRefreshToken((v) => v + 1);
      if (selectedEvent?.event_id === eventId) {
        setSelectedEvent(null);
      }
    } catch (err) {
      toast(err?.response?.data?.detail || "Failed to archive log.", "error");
    } finally {
      setArchiveBusy(false);
    }
  };

  const runExportCsv = () => {
    api.post("/audit-trail/export", {
      export_format: "CSV",
      row_count: rows.length,
      date_from: filters.date_from || null,
      date_to: filters.date_to || null,
      filters,
    }).catch(() => {});
    const filename = `audit_trail_${filters.date_from || "from"}_${filters.date_to || "to"}.csv`;
    downloadCsv(filename, exportColumns, rows);
    toast("CSV export generated.", "success");
  };

  const runExportPdf = async () => {
    try {
      await api.post("/audit-trail/export", {
        export_format: "PDF",
        row_count: rows.length,
        date_from: filters.date_from || null,
        date_to: filters.date_to || null,
        filters,
      });
      await downloadPdf(
        `audit_trail_${filters.date_from || "from"}_${filters.date_to || "to"}`,
        "I Store Audit Trail",
        exportColumns,
        rows,
        { confidentialStamp: true, watermark: "Audit Trail" },
      );
      toast("PDF export generated.", "success");
    } catch (err) {
      toast(err?.response?.data?.detail || "Failed to export PDF.", "error");
    }
  };

  const runPrint = () => {
    api.post("/audit-trail/export", {
      export_format: "PRINT",
      row_count: rows.length,
      date_from: filters.date_from || null,
      date_to: filters.date_to || null,
      filters,
    }).catch(() => {});
    openPrintView("I Store Audit Trail", exportColumns, rows);
  };

  if (accessDenied) {
    return (
      <div className="h-full min-h-0 grid place-items-center">
        <div className="panel p-8 max-w-2xl text-center">
          <div className="inline-flex h-14 w-14 rounded-2xl border border-rose-400/35 bg-rose-500/15 items-center justify-center mb-4">
            <Lock className="text-rose-300" size={24} />
          </div>
          <h2 className="text-2xl font-black text-white">Owner/Admin Access Required</h2>
          <p className="mt-3 text-sm text-slate-300 leading-relaxed">
            Full audit trail visibility is restricted for security and accountability. You need Owner or Admin privileges to open this module.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 pb-3">
      <div className="space-y-3">
        <section className="panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black text-white flex items-center gap-2">
                <History size={22} className="text-indigo-300" />
                Audit Trail
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                Read-only accountability log across authentication, operations, security, and business control modules.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setRefreshToken((v) => v + 1)}>
                <RefreshCw size={14} /> Refresh
              </Button>
              <Button size="sm" variant="secondary" onClick={runExportCsv} disabled={rows.length === 0}>
                <FileDown size={14} /> Export CSV
              </Button>
              <Button size="sm" variant="secondary" onClick={runExportPdf} disabled={rows.length === 0}>
                <ShieldCheck size={14} /> Export PDF
              </Button>
              <Button size="sm" variant="secondary" onClick={runPrint} disabled={rows.length === 0}>
                <Printer size={14} /> Print
              </Button>
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-slate-300">
            <span className="font-bold text-indigo-200">Data Protection:</span> Logs are immutable and read-only. Entries can be archived but cannot be edited or permanently deleted.
          </div>
        </section>

        <SectionCard title="Filters" right={<Filter size={16} className="text-slate-400" />}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-2">
            <input
              type="date"
              className="field !py-2 !px-3 !text-xs"
              value={filters.date_from}
              onChange={(e) => setFilters((prev) => ({ ...prev, date_from: e.target.value }))}
            />
            <input
              type="date"
              className="field !py-2 !px-3 !text-xs"
              value={filters.date_to}
              onChange={(e) => setFilters((prev) => ({ ...prev, date_to: e.target.value }))}
            />
            <Select
              className="field !py-2 !px-3 !text-xs"
              value={filters.user}
              onChange={(e) => setFilters((prev) => ({ ...prev, user: e.target.value }))}
            >
              <option value="">User: All</option>
              {userOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
            <Select
              className="field !py-2 !px-3 !text-xs"
              value={filters.role}
              onChange={(e) => setFilters((prev) => ({ ...prev, role: e.target.value }))}
            >
              <option value="">Role: All</option>
              {roleOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
            <Select
              className="field !py-2 !px-3 !text-xs"
              value={filters.module}
              onChange={(e) => setFilters((prev) => ({ ...prev, module: e.target.value }))}
            >
              <option value="">Module: All</option>
              {moduleOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
            <Select
              className="field !py-2 !px-3 !text-xs"
              value={filters.action}
              onChange={(e) => setFilters((prev) => ({ ...prev, action: e.target.value }))}
            >
              <option value="">Action: All</option>
              {actionOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
            <Select
              className="field !py-2 !px-3 !text-xs"
              value={filters.status}
              onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
            >
              <option value="">Status: All</option>
              {STATUS_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2 mt-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                className="field !py-2 !pl-9 !pr-3 !text-xs"
                placeholder="Search user/action/module..."
                value={filters.search}
                onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              />
            </div>
            <input
              className="field !py-2 !px-3 !text-xs"
              placeholder="Invoice ID (INV-00001)"
              value={filters.invoice_id}
              onChange={(e) => setFilters((prev) => ({ ...prev, invoice_id: e.target.value }))}
            />
            <input
              className="field !py-2 !px-3 !text-xs"
              placeholder="Repair Ticket ID"
              value={filters.repair_ticket_id}
              onChange={(e) => setFilters((prev) => ({ ...prev, repair_ticket_id: e.target.value }))}
            />
            <input
              className="field !py-2 !px-3 !text-xs"
              placeholder="Product SKU"
              value={filters.product_sku}
              onChange={(e) => setFilters((prev) => ({ ...prev, product_sku: e.target.value }))}
            />
            <input
              className="field !py-2 !px-3 !text-xs"
              placeholder="Customer Name"
              value={filters.customer_name}
              onChange={(e) => setFilters((prev) => ({ ...prev, customer_name: e.target.value }))}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={filters.only_sensitive}
                  onChange={(e) => setFilters((prev) => ({ ...prev, only_sensitive: e.target.checked }))}
                />
                Sensitive events only
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={filters.include_archived}
                  onChange={(e) => setFilters((prev) => ({ ...prev, include_archived: e.target.checked }))}
                />
                Include archived logs
              </label>
            </div>
            <Button size="sm" variant="ghost" onClick={resetFilters}>
              Reset Filters
            </Button>
          </div>
        </SectionCard>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          <KpiCard title="Today's Activities" value={Number(summary.todays_activities || 0).toLocaleString()} icon={<CalendarRange size={17} />} />
          <KpiCard title="Failed Login Attempts" value={Number(summary.failed_login_attempts || 0).toLocaleString()} icon={<ShieldAlert size={17} />} tone="red" />
          <KpiCard title="Stock Changes" value={Number(summary.stock_changes || 0).toLocaleString()} icon={<RefreshCw size={17} />} tone="amber" />
          <KpiCard title="Invoice Voids" value={Number(summary.invoice_voids || 0).toLocaleString()} icon={<AlertTriangle size={17} />} tone="red" />
          <KpiCard title="Permission Changes" value={Number(summary.permission_changes || 0).toLocaleString()} icon={<Lock size={17} />} tone="indigo" />
          <KpiCard title="Deleted Records" value={Number(summary.deleted_records || 0).toLocaleString()} icon={<Archive size={17} />} tone="amber" />
        </div>

        <SectionCard title="Security Alerts" subtitle="Sensitive events are highlighted for rapid risk review.">
          <div className="space-y-2 max-h-52 overflow-auto custom-scrollbar pr-1">
            {alerts.length === 0 && <p className="text-xs text-slate-400">No sensitive alerts in the selected range.</p>}
            {alerts.map((row) => (
              <button
                key={row.event_id}
                onClick={() => setSelectedEvent(row)}
                className="w-full rounded-xl border border-red-500/25 bg-red-500/10 p-2.5 text-left hover:bg-red-500/15 transition"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-rose-100">
                    {row.alert_reason || "Sensitive Event"} - {row.action}
                  </p>
                  <Badge tone={severityTone(row.severity)}>{row.severity}</Badge>
                </div>
                <p className="text-[11px] text-slate-200 mt-1">{row.module} | {row.target_record}</p>
                <p className="text-[10px] text-slate-400 mt-1">{formatDateTime(row.timestamp)} | {row.user}</p>
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Activity Log"
          subtitle="Click a row to open full audit details."
          right={<Badge tone="sky">{rows.length.toLocaleString()} records</Badge>}
        >
          {loading && <div className="py-10 text-center text-slate-400 text-sm">Loading audit events...</div>}
          {!loading && error && <div className="py-8 text-sm text-rose-300">{error}</div>}
          {!loading && !error && (
            <>
              <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/25">
                <Table className="text-xs">
                  <thead>
                    <tr>
                      <th>Date & Time</th>
                      <th>User</th>
                      <th>Role</th>
                      <th>Action</th>
                      <th>Module</th>
                      <th>Target Record</th>
                      <th>Old Value</th>
                      <th>New Value</th>
                      <th>Device/IP</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.length === 0 && (
                      <tr>
                        <td colSpan={10} className="py-8 text-slate-400">
                          No audit events matched your filters.
                        </td>
                      </tr>
                    )}
                    {pageRows.map((row) => (
                      <tr
                        key={row.event_id}
                        className="cursor-pointer"
                        onClick={() => setSelectedEvent(row)}
                      >
                        <td>{formatDateTime(row.timestamp)}</td>
                        <td className="font-semibold text-slate-100">{row.user || "-"}</td>
                        <td>{row.role || "-"}</td>
                        <td>
                          <div className="flex items-center gap-1">
                            {row.is_sensitive ? <ShieldAlert size={12} className="text-rose-300" /> : null}
                            <span>{row.action || "-"}</span>
                          </div>
                        </td>
                        <td>{row.module || "-"}</td>
                        <td title={row.target_record}>{shortText(formatTargetRecord(row.target_record), 45)}</td>
                        <td title={toText(row.old_value)}>{shortText(formatPayload(row.old_value), 45)}</td>
                        <td title={toText(row.new_value)}>{shortText(formatPayload(row.new_value), 45)}</td>
                        <td title={deviceIpLabel(row)}>{shortText(deviceIpLabel(row), 38)}</td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                            <Badge tone={severityTone(row.severity)}>{row.severity}</Badge>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-slate-300">
                <div>
                  Page {Math.min(page, totalPages)} of {Math.max(totalPages, 1)}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    Prev
                  </Button>
                  <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </SectionCard>

        <SectionCard title="Tracked Modules Coverage">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {trackedModules.map((name) => (
              <div key={name} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-slate-300">{name}</span>
                <Badge tone={Number(moduleCounts[name] || 0) > 0 ? "indigo" : "slate"}>
                  {Number(moduleCounts[name] || 0).toLocaleString()}
                </Badge>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <AppDrawer open={!!selectedEvent} onClose={() => setSelectedEvent(null)} panelClassName="max-w-xl bg-slate-950/95">
        {selectedEvent && (
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-black text-white">Audit Event Details</h3>
                  <p className="text-xs text-slate-400 mt-1">Immutable record for accountability and forensic review.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedEvent(null)}
                  className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-300 hover:bg-white/10"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                  <p className="text-slate-500 uppercase tracking-widest text-[10px]">Timestamp</p>
                  <p className="text-slate-200 mt-1">{formatDateTime(selectedEvent.timestamp)}</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                  <p className="text-slate-500 uppercase tracking-widest text-[10px]">Status</p>
                  <div className="mt-1 flex items-center gap-1">
                    <Badge tone={statusTone(selectedEvent.status)}>{selectedEvent.status}</Badge>
                    <Badge tone={severityTone(selectedEvent.severity)}>{selectedEvent.severity}</Badge>
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                  <p className="text-slate-500 uppercase tracking-widest text-[10px]">User</p>
                  <p className="text-slate-200 mt-1">{selectedEvent.user || "-"}</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                  <p className="text-slate-500 uppercase tracking-widest text-[10px]">Role</p>
                  <p className="text-slate-200 mt-1">{selectedEvent.role || "-"}</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                  <p className="text-slate-500 uppercase tracking-widest text-[10px]">Action</p>
                  <p className="text-slate-200 mt-1">{selectedEvent.action || "-"}</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                  <p className="text-slate-500 uppercase tracking-widest text-[10px]">Module</p>
                  <p className="text-slate-200 mt-1">{selectedEvent.module || "-"}</p>
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-2.5">
                <p className="text-slate-500 uppercase tracking-widest text-[10px]">Target Record</p>
                <p className="text-slate-200 text-sm mt-1">{formatTargetRecord(selectedEvent.target_record) || "-"}</p>
              </div>

              <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-2.5">
                <p className="text-slate-500 uppercase tracking-widest text-[10px]">Detail</p>
                <p className="text-slate-200 text-sm mt-1 whitespace-pre-wrap">{selectedEvent.detail || "-"}</p>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2">
                <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
                  <p className="text-slate-500 uppercase tracking-widest text-[10px]">Before (Old Value)</p>
                  <pre className="mt-1 text-[11px] text-slate-200 whitespace-pre-wrap break-words">{toPrettyJson(selectedEvent.old_value)}</pre>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
                  <p className="text-slate-500 uppercase tracking-widest text-[10px]">After (New Value)</p>
                  <pre className="mt-1 text-[11px] text-slate-200 whitespace-pre-wrap break-words">{toPrettyJson(selectedEvent.new_value)}</pre>
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-2.5">
                <p className="text-slate-500 uppercase tracking-widest text-[10px]">Device / IP</p>
                <p className="text-slate-200 text-sm mt-1">{deviceIpLabel(selectedEvent)}</p>
              </div>

              {selectedEvent?.related && (
                <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-2.5">
                  <p className="text-slate-500 uppercase tracking-widest text-[10px]">Related Record References</p>
                  <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-200">
                    <div>Invoice ID: {selectedEvent.related.invoice_id || "-"}</div>
                    <div>Repair Ticket ID: {selectedEvent.related.repair_ticket_id || "-"}</div>
                    <div>Product SKU: {selectedEvent.related.product_sku || "-"}</div>
                    <div>Customer Name: {selectedEvent.related.customer_name || "-"}</div>
                  </div>
                </div>
              )}

              {selectedEvent?.archived_info && (
                <div className="mt-3 rounded-lg border border-amber-400/25 bg-amber-500/10 p-2.5 text-xs text-amber-100">
                  <p className="font-bold">Archive Metadata</p>
                  <p className="mt-1">Archived At: {selectedEvent.archived_info.archived_at ? formatDateTime(selectedEvent.archived_info.archived_at) : "-"}</p>
                  <p>Archived By: {selectedEvent.archived_info?.archived_by?.full_name || selectedEvent.archived_info?.archived_by?.username || "-"}</p>
                  <p>Reason: {selectedEvent.archived_info.reason || "-"}</p>
                </div>
              )}

              {selectedEvent.is_sensitive && (
                <div className="mt-3 rounded-lg border border-rose-400/35 bg-rose-500/10 p-2.5">
                  <p className="text-[11px] font-bold text-rose-100">
                    Security Alert: {selectedEvent.alert_reason || "Sensitive event"}
                  </p>
                </div>
              )}

              <div className="mt-4 flex items-center justify-between gap-2">
                <Button size="sm" variant="secondary" onClick={() => setSelectedEvent(null)}>
                  Close
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={archiveBusy || selectedEvent.archived}
                  onClick={() => handleArchive(selectedEvent.event_id)}
                >
                  <Archive size={14} />
                  {selectedEvent.archived ? "Archived" : archiveBusy ? "Archiving..." : "Archive Event"}
                </Button>
              </div>
            </div>
        )}
      </AppDrawer>
    </div>
  );
}

