import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clock4,
  Download,
  FileSearch,
  FileText,
  Layers3,
  LineChart as LineChartIcon,
  Plus,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Wrench,
  XCircle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import api from "../lib/api";
import { printHtmlDocument } from "../lib/printBridge";
import { openPrintCenter } from "../lib/printCenter";
import { useFeedback } from "../components/FeedbackProvider";
import { AppTableEmptyRow, AppTableHead, AppTableShell, Button, KpiCard, Loading, SectionCard, Select, StatusBadge } from "../components/UI";
import AppDrawer from "../components/layout/AppDrawer";
import AppModal from "../components/layout/AppModal";

const CLAIM_STATUS_FLOW = [
  "Pending Inspection",
  "Approved",
  "Rejected",
  "Repaired",
  "Replaced",
  "Closed",
];

const WARRANTY_STATUS_FLOW = ["Active", "Expired", "Claimed", "Rejected", "Replaced"];

const CHART_COLORS = ["#22c55e", "#f59e0b", "#ef4444", "#6366f1", "#06b6d4", "#a855f7"];

function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function toHumanDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

function dayDiff(from, to = new Date()) {
  const start = new Date(from);
  if (Number.isNaN(start.getTime())) return 0;
  const end = new Date(to);
  return Math.max(0, Math.floor((end - start) / (1000 * 60 * 60 * 24)));
}

function formatPct(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0.0%";
  return `${num.toFixed(1)}%`;
}

function toCsvValue(value) {
  const raw = value === null || value === undefined ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((value) => toCsvValue(value)).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function normalizeIssueLabel(text) {
  const src = String(text || "").trim();
  if (!src) return "Unspecified";
  const normalized = src
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
  return normalized
    .split(" ")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function OverviewKpiCard({ title, value, deltaLabel, tone = "sky", icon, sparkData = [] }) {
  const toneMap = {
    green: "from-emerald-500/20 to-emerald-300/10 border-emerald-400/30 text-emerald-200",
    amber: "from-amber-500/20 to-amber-300/10 border-amber-400/30 text-amber-200",
    red: "from-rose-500/20 to-rose-300/10 border-rose-400/30 text-rose-200",
    violet: "from-violet-500/20 to-violet-300/10 border-violet-400/30 text-violet-200",
    sky: "from-sky-500/20 to-sky-300/10 border-sky-400/30 text-sky-200",
    cyan: "from-cyan-500/20 to-cyan-300/10 border-cyan-400/30 text-cyan-200",
  };
  const toneClasses = toneMap[tone] || toneMap.sky;
  const trendData = (sparkData || []).map((value, index) => ({ i: index, value: Number(value || 0) }));
  return (
    <div className={`rounded-xl border bg-gradient-to-br px-3 py-2.5 ${toneClasses}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-300/85">{title}</p>
          <p className="mt-1 text-lg font-black text-white leading-none truncate">{value}</p>
          <p className="mt-1 text-[10px] text-slate-300/80">{deltaLabel}</p>
        </div>
        <div className="grid h-8 w-8 place-items-center rounded-lg border border-white/15 bg-black/20 text-white/90">
          {icon}
        </div>
      </div>
      <div className="mt-1.5 h-8">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trendData}>
            <Line type="monotone" dataKey="value" stroke="currentColor" strokeWidth={1.8} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StatusPill({ label, tone }) {
  return <StatusBadge status={label || "-"} label={label || "-"} tone={tone} size="xs" />;
}

function resolveTabToneClass(tone = "sky") {
  if (tone === "green") return "tab-tone-green";
  if (tone === "amber") return "tab-tone-amber";
  if (tone === "red") return "tab-tone-red";
  if (tone === "violet") return "tab-tone-violet";
  if (tone === "cyan") return "tab-tone-cyan";
  if (tone === "indigo") return "tab-tone-indigo";
  return "tab-tone-sky";
}

function ToneTabButton({ label, count = null, tone = "sky", active = false, onClick }) {
  const toneClass = resolveTabToneClass(tone);
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition border ${
        active ? `${toneClass} is-active` : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
      }`}
      onClick={onClick}
    >
      {label}
      {count !== null && (
        <span className="inline-flex min-w-5 items-center justify-center rounded-full border border-white/15 bg-black/20 px-1.5 py-0.5 text-[10px] leading-none text-slate-200">
          {Number(count || 0).toLocaleString()}
        </span>
      )}
    </button>
  );
}

function MiniTable({
  columns,
  rows,
  emptyLabel = "No data found.",
  shellClassName = "",
  tableClassName = "",
  maxHeightClass = "max-h-[320px]",
}) {
  return (
    <AppTableShell
      className={`${maxHeightClass} ${shellClassName}`}
      innerClassName={`table table-compact ${tableClassName}`}
      aria-label={emptyLabel}
    >
        <AppTableHead>
          <tr>
            {columns.map((col) => (
              <th key={col.label}>{col.label}</th>
            ))}
          </tr>
        </AppTableHead>
        <tbody>
          {!rows.length && (
            <AppTableEmptyRow colSpan={columns.length} title={emptyLabel} text="" />
          )}
          {rows.map((row, index) => (
            <tr key={row.id || row.warranty_id || row.claim_id || index}>
              {columns.map((col) => (
                <td key={`${col.label}-${row.id || row.warranty_id || row.claim_id || index}`}>
                  {typeof col.value === "function" ? col.value(row, index) : row[col.value]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
    </AppTableShell>
  );
}

export default function Warranty() {
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight : 900,
  );
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showAllKpis, setShowAllKpis] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [records, setRecords] = useState([]);
  const [claims, setClaims] = useState([]);
  const [rules, setRules] = useState([]);
  const [conditions, setConditions] = useState([]);
  const [reports, setReports] = useState(null);
  const [lookupRows, setLookupRows] = useState([]);
  const [activeTab, setActiveTab] = useState("overview");
  const [datePreset, setDatePreset] = useState("last30");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedWarranty, setSelectedWarranty] = useState(null);
  const [selectedWarrantyStatus, setSelectedWarrantyStatus] = useState("Active");
  const [selectedWarrantyNote, setSelectedWarrantyNote] = useState("");
  const [showCreateWarranty, setShowCreateWarranty] = useState(false);
  const [createWarrantyForm, setCreateWarrantyForm] = useState({
    customer_name: "",
    customer_phone: "",
    product_or_service_name: "",
    warranty_type: "Product",
    start_date: toDateInput(new Date()),
    warranty_days: 30,
    imei_or_serial: "",
    notes: "",
  });

  const [filters, setFilters] = useState({
    q: "",
    status: "all",
    warranty_type: "all",
    category: "all",
    brand: "all",
    supplier: "all",
    date_from: "",
    date_to: "",
  });
  const [lookupQuery, setLookupQuery] = useState("");
  const [filterOptions, setFilterOptions] = useState({
    categories: [],
    brands: [],
    suppliers: [],
    customers: [],
    inventory_items: [],
    repairs: [],
    invoices: [],
  });

  const [claimForm, setClaimForm] = useState({
    warranty_id: "",
    customer_complaint: "",
    technician_inspection_note: "",
    claim_status: "Pending Inspection",
    claim_decision: "",
    replacement_item: "",
    repair_action: "",
  });

  const [ruleForm, setRuleForm] = useState({
    rule_name: "",
    scope_type: "product_category",
    scope_value: "*",
    warranty_days: 30,
    description: "",
    is_active: true,
  });

  const [conditionForm, setConditionForm] = useState({
    condition_code: "",
    title: "",
    description: "",
    is_covered: false,
    is_active: true,
    sort_order: 0,
  });

  const buildParams = useCallback((values) => {
    const params = new URLSearchParams();
    Object.entries(values || {}).forEach(([key, value]) => {
      if (value === null || value === undefined) return;
      if (value === "") return;
      if (String(value).toLowerCase() === "all") return;
      params.set(key, String(value));
    });
    return params.toString();
  }, []);

  const loadCore = useCallback(async () => {
    setLoading(true);
    try {
      const query = buildParams(filters);
      const [dashRes, recordsRes, claimsRes] = await Promise.all([
        api.get(`/warranty/dashboard${query ? `?${query}` : ""}`),
        api.get(`/warranty/records${query ? `?${query}` : ""}`),
        api.get(`/warranty/claims${query ? `?${query}` : ""}`),
      ]);
      setDashboard(dashRes.data || null);
      setRecords(Array.isArray(recordsRes.data) ? recordsRes.data : []);
      setClaims(Array.isArray(claimsRes.data) ? claimsRes.data : []);
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to load warranty data", "error");
    } finally {
      setLoading(false);
    }
  }, [buildParams, filters, toast]);

  const loadReferenceData = useCallback(async () => {
    try {
      const [rulesRes, conditionsRes, filtersRes, reportsRes] = await Promise.all([
        api.get("/warranty/rules"),
        api.get("/warranty/conditions"),
        api.get("/warranty/filters"),
        api.get("/warranty/reports"),
      ]);
      setRules(Array.isArray(rulesRes.data) ? rulesRes.data : []);
      setConditions(Array.isArray(conditionsRes.data) ? conditionsRes.data : []);
      setFilterOptions(filtersRes.data || {});
      setReports(reportsRes.data || null);
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to load warranty reference data", "error");
    }
  }, [toast]);

  useEffect(() => {
    loadCore();
  }, [loadCore]);

  useEffect(() => {
    loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadCore(), loadReferenceData()]);
  }, [loadCore, loadReferenceData]);

  const applyDatePreset = useCallback(
    (preset) => {
      const now = new Date();
      const end = toDateInput(now);
      let start = "";
      if (preset === "last7") {
        const d = new Date(now);
        d.setDate(d.getDate() - 6);
        start = toDateInput(d);
      } else if (preset === "last30") {
        const d = new Date(now);
        d.setDate(d.getDate() - 29);
        start = toDateInput(d);
      } else if (preset === "thisMonth") {
        const d = new Date(now.getFullYear(), now.getMonth(), 1);
        start = toDateInput(d);
      } else if (preset === "all") {
        start = "";
      } else if (preset === "custom") {
        setDatePreset("custom");
        return;
      }
      setDatePreset(preset);
      setFilters((prev) => ({ ...prev, date_from: start, date_to: end }));
    },
    [],
  );

  useEffect(() => {
    applyDatePreset("last30");
  }, [applyDatePreset]);

  const exportOverviewCsv = useCallback(() => {
    const kpiLocal = dashboard?.kpis || {};
    const exportRows = [
      ["Report", "Warranty Dashboard Overview"],
      ["Generated At", new Date().toLocaleString()],
      [],
      ["KPI", "Value"],
      ["Total Warranties", Number(kpiLocal.total_warranties || 0)],
      ["Active Warranties", Number(kpiLocal.active_warranties || 0)],
      ["Expiring Soon", Number(kpiLocal.expiring_soon || 0)],
      ["Expired Warranties", Number(kpiLocal.expired_warranties || 0)],
      ["Pending Claims", Number(kpiLocal.pending_claims || 0)],
      ["Approved Claims", Number(kpiLocal.approved_claims || 0)],
      ["Rejected Claims", Number(kpiLocal.rejected_claims || 0)],
      [],
      ["Expiring Warranties", "", "", "", ""],
      ["Warranty ID", "Customer", "Product", "End Date", "Days Left"],
      ...(dashboard?.top_expiring || []).map((row) => [
        row.warranty_id,
        row.customer_name,
        row.product_or_service_name,
        toHumanDate(row.end_date),
        row.days_left,
      ]),
      [],
      ["Recent Claims", "", "", "", ""],
      ["Claim ID", "Customer", "Product", "Status", "Created"],
      ...claims.slice(0, 120).map((row) => [
        row.claim_id,
        row.customer_name,
        row.product_or_service_name,
        row.claim_status,
        toHumanDate(row.created_at),
      ]),
    ];
    downloadCsv(`warranty-overview-${toDateInput(new Date())}.csv`, exportRows);
    toast("Warranty overview CSV exported", "success");
  }, [claims, dashboard, toast]);

  const exportOverviewPdf = useCallback(async () => {
    const kpiLocal = dashboard?.kpis || {};
    const trendRows = (reports?.claim_trend || [])
      .slice(-6)
      .map((row) => `<tr><td>${row.month}</td><td>${row.total_claims}</td><td>${row.approved}</td><td>${row.rejected}</td></tr>`)
      .join("");
    const html = `
      <html>
        <head>
          <title>Warranty Overview</title>
          <style>
            body { font-family: Segoe UI, Arial, sans-serif; margin: 20px; color: #0f172a; }
            h1 { margin: 0; font-size: 24px; }
            p { margin: 4px 0 0; color: #334155; }
            .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 16px; }
            .card { border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px; }
            .k { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .08em; }
            .v { font-size: 22px; font-weight: 800; margin-top: 4px; }
            table { width: 100%; border-collapse: collapse; margin-top: 14px; }
            th, td { border: 1px solid #e2e8f0; padding: 7px; font-size: 12px; text-align: left; }
            th { background: #f1f5f9; }
          </style>
        </head>
        <body>
          <h1>Warranty Dashboard</h1>
          <p>Generated: ${new Date().toLocaleString()}</p>
          <div class="grid">
            <div class="card"><div class="k">Total Warranties</div><div class="v">${Number(kpiLocal.total_warranties || 0).toLocaleString()}</div></div>
            <div class="card"><div class="k">Active</div><div class="v">${Number(kpiLocal.active_warranties || 0).toLocaleString()}</div></div>
            <div class="card"><div class="k">Pending Claims</div><div class="v">${Number(kpiLocal.pending_claims || 0).toLocaleString()}</div></div>
            <div class="card"><div class="k">Rejected Claims</div><div class="v">${Number(kpiLocal.rejected_claims || 0).toLocaleString()}</div></div>
          </div>
          <table>
            <thead><tr><th>Month</th><th>Total Claims</th><th>Approved</th><th>Rejected</th></tr></thead>
            <tbody>${trendRows || "<tr><td colspan='4'>No trend data available.</td></tr>"}</tbody>
          </table>
        </body>
      </html>`;
    try {
      await printHtmlDocument(html, { silent: false });
    } catch (error) {
      toast(error.message || "Failed to open warranty print preview", "error");
    }
  }, [dashboard, reports?.claim_trend, toast]);

  const submitCreateWarranty = useCallback(async () => {
    if (!createWarrantyForm.customer_name.trim() || !createWarrantyForm.product_or_service_name.trim() || !createWarrantyForm.start_date) {
      toast("Customer, product/service, and start date are required.", "warning");
      return;
    }
    setBusy(true);
    try {
      await api.post("/warranty/records", {
        customer_name: createWarrantyForm.customer_name.trim(),
        customer_phone: createWarrantyForm.customer_phone.trim() || null,
        product_or_service_name: createWarrantyForm.product_or_service_name.trim(),
        warranty_type: createWarrantyForm.warranty_type,
        start_date: new Date(createWarrantyForm.start_date).toISOString(),
        warranty_days: Number(createWarrantyForm.warranty_days || 0),
        imei_or_serial: createWarrantyForm.imei_or_serial.trim() || null,
        notes: createWarrantyForm.notes.trim() || null,
      });
      toast("Warranty record created", "success");
      setShowCreateWarranty(false);
      setCreateWarrantyForm({
        customer_name: "",
        customer_phone: "",
        product_or_service_name: "",
        warranty_type: "Product",
        start_date: toDateInput(new Date()),
        warranty_days: 30,
        imei_or_serial: "",
        notes: "",
      });
      await loadCore();
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to create warranty record", "error");
    } finally {
      setBusy(false);
    }
  }, [createWarrantyForm, loadCore, toast]);

  const performLookup = useCallback(async () => {
    const trimmed = lookupQuery.trim();
    if (!trimmed) {
      setLookupRows([]);
      return;
    }
    try {
      const res = await api.get(`/warranty/lookup?q=${encodeURIComponent(trimmed)}`);
      setLookupRows(Array.isArray(res.data) ? res.data : []);
      if (!res.data?.length) {
        toast("No matching warranty records found", "warning");
      }
    } catch (error) {
      toast(error.response?.data?.detail || "Lookup failed", "error");
    }
  }, [lookupQuery, toast]);

  const openWarrantyDrawer = useCallback(
    async (record) => {
      if (!record?.id) return;
      setDrawerOpen(true);
      setBusy(true);
      try {
        const res = await api.get(`/warranty/records/${record.id}`);
        const payload = res.data || null;
        setSelectedWarranty(payload);
        setSelectedWarrantyStatus(payload?.status || "Active");
        setSelectedWarrantyNote(payload?.notes || "");
        setClaimForm((prev) => ({
          ...prev,
          warranty_id: String(payload?.id || ""),
        }));
      } catch (error) {
        toast(error.response?.data?.detail || "Failed to load warranty details", "error");
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const openWarrantyCertificate = useCallback(
    (record) => {
      if (!record?.id) {
        toast("Open a warranty record before printing its certificate.", "warning");
        return;
      }

      openPrintCenter(navigate, {
        type: "warranty",
        ref: record.id,
        paper: "a4",
        template: "certificate",
      });
    },
    [navigate, toast],
  );

  const updateSelectedWarrantyStatus = useCallback(async () => {
    if (!selectedWarranty?.id) return;
    setBusy(true);
    try {
      await api.put(
        `/warranty/records/${selectedWarranty.id}/status?status=${encodeURIComponent(
          selectedWarrantyStatus,
        )}&notes=${encodeURIComponent(selectedWarrantyNote || "")}`,
      );
      toast("Warranty status updated", "success");
      await loadCore();
      const refreshed = await api.get(`/warranty/records/${selectedWarranty.id}`);
      setSelectedWarranty(refreshed.data || null);
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to update warranty status", "error");
    } finally {
      setBusy(false);
    }
  }, [loadCore, selectedWarranty, selectedWarrantyNote, selectedWarrantyStatus, toast]);

  const quickRenewWarranty = useCallback(
    async (row) => {
      if (!row?.id) return;
      setBusy(true);
      try {
        await api.put(
          `/warranty/records/${row.id}/status?status=${encodeURIComponent("Active")}&notes=${encodeURIComponent(
            "Renewed from overview quick action",
          )}`,
        );
        toast("Warranty status renewed to Active", "success");
        await loadCore();
      } catch (error) {
        toast(error.response?.data?.detail || "Failed to renew warranty", "error");
      } finally {
        setBusy(false);
      }
    },
    [loadCore, toast],
  );

  const quickClaimWarranty = useCallback((row) => {
    if (!row?.id) return;
    setActiveTab("claims");
    setClaimForm((prev) => ({ ...prev, warranty_id: String(row.id) }));
  }, []);

  const submitClaim = useCallback(async () => {
    if (!claimForm.warranty_id || !claimForm.customer_complaint.trim()) {
      toast("Warranty and complaint are required", "warning");
      return;
    }
    setBusy(true);
    try {
      await api.post("/warranty/claims", {
        ...claimForm,
        warranty_id: Number(claimForm.warranty_id),
      });
      toast("Warranty claim created", "success");
      setClaimForm({
        warranty_id: claimForm.warranty_id,
        customer_complaint: "",
        technician_inspection_note: "",
        claim_status: "Pending Inspection",
        claim_decision: "",
        replacement_item: "",
        repair_action: "",
      });
      await loadCore();
      if (selectedWarranty?.id) {
        const refreshed = await api.get(`/warranty/records/${selectedWarranty.id}`);
        setSelectedWarranty(refreshed.data || null);
      }
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to create claim", "error");
    } finally {
      setBusy(false);
    }
  }, [claimForm, loadCore, selectedWarranty?.id, toast]);

  const updateClaimStatus = useCallback(
    async (claimId, nextStatus) => {
      setBusy(true);
      try {
        await api.put(`/warranty/claims/${claimId}`, {
          claim_status: nextStatus,
        });
        toast(`Claim moved to ${nextStatus}`, "success");
        await loadCore();
        if (selectedWarranty?.id) {
          const refreshed = await api.get(`/warranty/records/${selectedWarranty.id}`);
          setSelectedWarranty(refreshed.data || null);
        }
      } catch (error) {
        toast(error.response?.data?.detail || "Failed to update claim status", "error");
      } finally {
        setBusy(false);
      }
    },
    [loadCore, selectedWarranty?.id, toast],
  );

  const submitRule = useCallback(async () => {
    if (!ruleForm.rule_name.trim() || !ruleForm.scope_type.trim()) {
      toast("Rule name and scope are required", "warning");
      return;
    }
    setBusy(true);
    try {
      await api.post("/warranty/rules", {
        ...ruleForm,
        warranty_days: Number(ruleForm.warranty_days || 0),
      });
      toast("Warranty rule added", "success");
      setRuleForm({
        rule_name: "",
        scope_type: "product_category",
        scope_value: "*",
        warranty_days: 30,
        description: "",
        is_active: true,
      });
      await loadReferenceData();
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to add rule", "error");
    } finally {
      setBusy(false);
    }
  }, [loadReferenceData, ruleForm, toast]);

  const toggleRuleActive = useCallback(
    async (rule) => {
      setBusy(true);
      try {
        await api.put(`/warranty/rules/${rule.id}`, {
          ...rule,
          is_active: !rule.is_active,
        });
        toast("Rule updated", "success");
        await loadReferenceData();
      } catch (error) {
        toast(error.response?.data?.detail || "Failed to update rule", "error");
      } finally {
        setBusy(false);
      }
    },
    [loadReferenceData, toast],
  );

  const submitCondition = useCallback(async () => {
    if (!conditionForm.condition_code.trim() || !conditionForm.title.trim()) {
      toast("Condition code and title are required", "warning");
      return;
    }
    setBusy(true);
    try {
      await api.post("/warranty/conditions", {
        ...conditionForm,
        sort_order: Number(conditionForm.sort_order || 0),
      });
      toast("Warranty condition added", "success");
      setConditionForm({
        condition_code: "",
        title: "",
        description: "",
        is_covered: false,
        is_active: true,
        sort_order: 0,
      });
      await loadReferenceData();
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to add condition", "error");
    } finally {
      setBusy(false);
    }
  }, [conditionForm, loadReferenceData, toast]);

  const toggleConditionActive = useCallback(
    async (condition) => {
      setBusy(true);
      try {
        await api.put(`/warranty/conditions/${condition.id}`, {
          ...condition,
          is_active: !condition.is_active,
        });
        toast("Condition updated", "success");
        await loadReferenceData();
      } catch (error) {
        toast(error.response?.data?.detail || "Failed to update condition", "error");
      } finally {
        setBusy(false);
      }
    },
    [loadReferenceData, toast],
  );

  const recordsByStatusChart = useMemo(() => {
    const map = {};
    records.forEach((row) => {
      const status = row.status || "Unknown";
      map[status] = (map[status] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [records]);

  const claimsByStatusChart = useMemo(() => {
    const map = {};
    claims.forEach((row) => {
      const status = row.claim_status || "Unknown";
      map[status] = (map[status] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [claims]);

  const warrantyExpiringSoonRows = useMemo(() => {
    const now = new Date();
    return records
      .filter((row) => row.status === "Active")
      .map((row) => ({
        ...row,
        daysLeft: dayDiff(now, new Date(row.end_date || now)),
      }))
      .filter((row) => row.daysLeft <= 30)
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 20);
  }, [records]);

  const subReportRows = useMemo(() => {
    if (!reports) return [];
    if (activeTab === "reports-active") return reports.active_warranties || [];
    if (activeTab === "reports-expired") return reports.expired_warranties || [];
    if (activeTab === "reports-rejected") return reports.rejected_claims || [];
    if (activeTab === "reports-replaced") return reports.replacement_history || [];
    return [];
  }, [activeTab, reports]);

  const isCompactHeight = viewportHeight <= 920;

  const kpi = dashboard?.kpis || {
    active_warranties: 0,
    expired_warranties: 0,
    pending_claims: 0,
    approved_claims: 0,
    rejected_claims: 0,
    expiring_soon: 0,
    total_warranties: 0,
    total_claims: 0,
  };

  const statusOverviewChart = useMemo(() => {
    const activeRows = records.filter((row) => row.status === "Active");
    const expiringSoonRows = activeRows.filter((row) => {
      const end = row.end_date ? new Date(row.end_date) : null;
      if (!end || Number.isNaN(end.getTime())) return false;
      return dayDiff(new Date(), end) <= 30;
    });
    const expiredRows = records.filter((row) => row.status === "Expired");
    const claimedRows = records.filter((row) => row.status === "Claimed");
    const voidedRows = records.filter((row) => String(row.status || "").toLowerCase() === "voided");
    return [
      { name: "Active", value: activeRows.length, color: "#22c55e" },
      { name: "Expiring Soon", value: expiringSoonRows.length, color: "#f59e0b" },
      { name: "Expired", value: expiredRows.length, color: "#ef4444" },
      { name: "Claimed", value: claimedRows.length, color: "#6366f1" },
      { name: "Voided", value: voidedRows.length, color: "#64748b" },
    ];
  }, [records]);

  const productCategoryChart = useMemo(() => {
    const map = new Map();
    records.forEach((row) => {
      const key = String(row.product_category || "Others").trim() || "Others";
      map.set(key, (map.get(key) || 0) + 1);
    });
    const sorted = Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
    const fallback = ["Smartphones", "Accessories", "Spare Parts", "Tablets", "Smart Watches", "Audio Devices"];
    if (!sorted.length) {
      return fallback.map((name, index) => ({ name, value: 0, color: CHART_COLORS[index % CHART_COLORS.length] }));
    }
    return sorted.map((row, index) => ({ ...row, color: CHART_COLORS[index % CHART_COLORS.length] }));
  }, [records]);

  const expiringOpsRows = useMemo(() => {
    const now = new Date();
    return records
      .filter((row) => row.status === "Active" || row.status === "Expired")
      .map((row) => {
        const end = row.end_date ? new Date(row.end_date) : null;
        const daysLeft = end && !Number.isNaN(end.getTime()) ? Math.floor((end - now) / (1000 * 60 * 60 * 24)) : null;
        return { ...row, daysLeft };
      })
      .filter((row) => row.daysLeft !== null && row.daysLeft <= 30)
      .sort((a, b) => Number(a.daysLeft) - Number(b.daysLeft))
      .slice(0, 100);
  }, [records]);

  const recentClaimRows = useMemo(() => {
    return claims
      .map((row) => {
        const created = row.created_at ? new Date(row.created_at) : null;
        const closed = row.closed_at ? new Date(row.closed_at) : null;
        let resolutionDays = null;
        if (created && closed && !Number.isNaN(created.getTime()) && !Number.isNaN(closed.getTime())) {
          resolutionDays = Math.max(0, Math.round((closed - created) / (1000 * 60 * 60 * 24)));
        }
        return {
          ...row,
          resolutionDays,
          technician: row.processed_by || row.approved_by || "-",
        };
      })
      .slice(0, 160);
  }, [claims]);

  const claimApprovalRate = useMemo(() => {
    const total = Number(kpi.total_claims || 0);
    if (!total) return 0;
    return (Number(kpi.approved_claims || 0) / total) * 100;
  }, [kpi.approved_claims, kpi.total_claims]);

  const avgResolutionDays = useMemo(() => {
    const resolved = recentClaimRows.filter((row) => row.resolutionDays !== null);
    if (!resolved.length) return 0;
    const total = resolved.reduce((sum, row) => sum + Number(row.resolutionDays || 0), 0);
    return total / resolved.length;
  }, [recentClaimRows]);

  const topClaimedProducts = useMemo(() => {
    const map = new Map();
    claims.forEach((row) => {
      const key = row.product_or_service_name || "Unknown";
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [claims]);

  const topIssueTypes = useMemo(() => {
    const map = new Map();
    claims.forEach((row) => {
      const key = normalizeIssueLabel(row.customer_complaint);
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [claims]);

  const repairWarrantyRatio = useMemo(() => {
    if (!records.length) return 0;
    const linked = records.filter((row) => !!row.repair_ticket_id).length;
    return (linked / records.length) * 100;
  }, [records]);

  const repeatedIssuePct = useMemo(() => {
    if (!claims.length) return 0;
    const byCustomer = new Map();
    claims.forEach((row) => {
      const key = String(row.customer_name || "Unknown");
      byCustomer.set(key, (byCustomer.get(key) || 0) + 1);
    });
    const repeatedCount = Array.from(byCustomer.values()).filter((count) => count > 1).length;
    return (repeatedCount / byCustomer.size) * 100;
  }, [claims]);

  const technicianPerformance = useMemo(() => {
    const map = new Map();
    recentClaimRows.forEach((row) => {
      const key = row.technician || "Unassigned";
      if (!map.has(key)) {
        map.set(key, { technician: key, total: 0, resolved: 0, days: 0, samples: 0 });
      }
      const entry = map.get(key);
      entry.total += 1;
      if (row.claim_status === "Approved" || row.claim_status === "Resolved" || row.claim_status === "Closed" || row.claim_status === "Repaired") {
        entry.resolved += 1;
      }
      if (row.resolutionDays !== null) {
        entry.days += Number(row.resolutionDays || 0);
        entry.samples += 1;
      }
    });
    return Array.from(map.values())
      .map((row) => ({
        ...row,
        resolution_avg: row.samples ? row.days / row.samples : 0,
        resolve_rate: row.total ? (row.resolved / row.total) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [recentClaimRows]);

  const highRiskAlerts = useMemo(() => {
    const alerts = [];
    const riskyProducts = topClaimedProducts.filter((row) => row.value >= 3).slice(0, 3);
    riskyProducts.forEach((row) => {
      alerts.push({
        type: "High Risk Product",
        detail: `${row.name} has ${row.value} claims.`,
        severity: "amber",
      });
    });
    if (repeatedIssuePct >= 25) {
      alerts.push({
        type: "Repeated Issue Spike",
        detail: `${formatPct(repeatedIssuePct)} of customers have repeated claims.`,
        severity: "red",
      });
    }
    const pendingRatio = Number(kpi.total_claims || 0) ? (Number(kpi.pending_claims || 0) / Number(kpi.total_claims || 0)) * 100 : 0;
    if (pendingRatio >= 40) {
      alerts.push({
        type: "Claim Backlog",
        detail: `${formatPct(pendingRatio)} of claims are pending inspection.`,
        severity: "amber",
      });
    }
    if (!alerts.length) {
      alerts.push({
        type: "Operationally Stable",
        detail: "No elevated warranty risk indicators at this time.",
        severity: "green",
      });
    }
    return alerts;
  }, [kpi.pending_claims, kpi.total_claims, repeatedIssuePct, topClaimedProducts]);

  const revenueImpactPct = useMemo(() => {
    if (!kpi.total_warranties) return 0;
    const impactBase = Number(kpi.pending_claims || 0) + Number(kpi.approved_claims || 0) + Number(kpi.rejected_claims || 0);
    return (impactBase / Number(kpi.total_warranties || 1)) * 100;
  }, [kpi.approved_claims, kpi.pending_claims, kpi.rejected_claims, kpi.total_warranties]);

  const claimTrendSeries = useMemo(() => {
    const source = Array.isArray(reports?.claim_trend) ? reports.claim_trend.slice(-8) : [];
    if (!source.length) {
      return {
        total: [0, 0, 0, 0, 0, 0, 0, 0],
        approved: [0, 0, 0, 0, 0, 0, 0, 0],
        rejected: [0, 0, 0, 0, 0, 0, 0, 0],
      };
    }
    return {
      total: source.map((row) => Number(row.total_claims || 0)),
      approved: source.map((row) => Number(row.approved || 0)),
      rejected: source.map((row) => Number(row.rejected || 0)),
    };
  }, [reports?.claim_trend]);

  const overviewKpis = useMemo(() => {
    return [
      {
        key: "total_warranties",
        title: "Total Warranties",
        value: Number(kpi.total_warranties || 0).toLocaleString(),
        delta: `${records.length ? formatPct((kpi.active_warranties / Math.max(1, kpi.total_warranties)) * 100) : "0.0%"} active`,
        tone: "sky",
        icon: <Layers3 size={15} />,
        spark: [kpi.total_warranties, kpi.active_warranties, kpi.expiring_soon, kpi.expired_warranties],
      },
      {
        key: "active",
        title: "Active Warranties",
        value: Number(kpi.active_warranties || 0).toLocaleString(),
        delta: `${formatPct((Number(kpi.active_warranties || 0) / Math.max(1, Number(kpi.total_warranties || 1))) * 100)} of total`,
        tone: "green",
        icon: <ShieldCheck size={15} />,
        spark: statusOverviewChart.map((row) => row.value),
      },
      {
        key: "expiring",
        title: "Expiring Soon",
        value: Number(kpi.expiring_soon || 0).toLocaleString(),
        delta: `${expiringOpsRows.filter((row) => Number(row.daysLeft) <= 7).length} within 7 days`,
        tone: "amber",
        icon: <Clock4 size={15} />,
        spark: expiringOpsRows.slice(0, 8).map((row) => Math.max(0, Number(row.daysLeft || 0))).reverse(),
      },
      {
        key: "expired",
        title: "Expired Warranties",
        value: Number(kpi.expired_warranties || 0).toLocaleString(),
        delta: `${formatPct((Number(kpi.expired_warranties || 0) / Math.max(1, Number(kpi.total_warranties || 1))) * 100)} of total`,
        tone: "red",
        icon: <ShieldX size={15} />,
        spark: [kpi.total_warranties, kpi.expired_warranties, kpi.rejected_claims, kpi.pending_claims],
      },
      {
        key: "pending",
        title: "Pending Claims",
        value: Number(kpi.pending_claims || 0).toLocaleString(),
        delta: `${formatPct((Number(kpi.pending_claims || 0) / Math.max(1, Number(kpi.total_claims || 1))) * 100)} of claims`,
        tone: "violet",
        icon: <ShieldAlert size={15} />,
        spark: claimTrendSeries.total,
      },
      {
        key: "approved",
        title: "Approved Claims",
        value: Number(kpi.approved_claims || 0).toLocaleString(),
        delta: `${formatPct(claimApprovalRate)} approval rate`,
        tone: "green",
        icon: <CheckCircle2 size={15} />,
        spark: claimTrendSeries.approved,
      },
      {
        key: "rejected",
        title: "Rejected Claims",
        value: Number(kpi.rejected_claims || 0).toLocaleString(),
        delta: `${formatPct((Number(kpi.rejected_claims || 0) / Math.max(1, Number(kpi.total_claims || 1))) * 100)} rejection ratio`,
        tone: "red",
        icon: <XCircle size={15} />,
        spark: claimTrendSeries.rejected,
      },
      {
        key: "impact",
        title: "Warranty Revenue Impact",
        value: formatPct(revenueImpactPct),
        delta: "claim footprint vs warranty base",
        tone: "cyan",
        icon: <LineChartIcon size={15} />,
        spark: [revenueImpactPct, claimApprovalRate, repeatedIssuePct, repairWarrantyRatio],
      },
    ];
  }, [claimApprovalRate, claimTrendSeries.approved, claimTrendSeries.rejected, claimTrendSeries.total, expiringOpsRows, kpi.active_warranties, kpi.approved_claims, kpi.expired_warranties, kpi.expiring_soon, kpi.pending_claims, kpi.rejected_claims, kpi.total_claims, kpi.total_warranties, records.length, repairWarrantyRatio, repeatedIssuePct, revenueImpactPct, statusOverviewChart]);

  const topTabs = useMemo(
    () => [
      { key: "overview", label: "Overview", tone: "sky", count: null },
      { key: "records", label: "Warranty Records", tone: "cyan", count: records.length },
      { key: "claims", label: "Claims Desk", tone: "violet", count: claims.length },
      { key: "rules", label: "Warranty Rules", tone: "amber", count: rules.length },
      { key: "conditions", label: "Coverage Conditions", tone: "indigo", count: conditions.length },
      { key: "reports", label: "Reports", tone: "green", count: 4 },
    ],
    [claims.length, conditions.length, records.length, rules.length],
  );

  const reportTabs = useMemo(
    () => [
      { key: "reports-active", label: "Active Warranties", tone: "green", count: reports?.active_warranties?.length || 0 },
      { key: "reports-expired", label: "Expired Warranties", tone: "amber", count: reports?.expired_warranties?.length || 0 },
      { key: "reports-rejected", label: "Rejected Claims", tone: "red", count: reports?.rejected_claims?.length || 0 },
      { key: "reports-replaced", label: "Replacement History", tone: "indigo", count: reports?.replacement_history?.length || 0 },
    ],
    [reports],
  );

  const warrantySelectorOptions = useMemo(
    () =>
      records.map((row) => ({
        id: row.id,
        label: `${row.warranty_id} - ${row.product_or_service_name} (${row.customer_name})`,
      })),
    [records],
  );

  const isOverviewTab = activeTab === "overview";
  const isRecordsTab = activeTab === "records";
  const isClaimsTab = activeTab === "claims";
  const isRulesTab = activeTab === "rules";
  const isConditionsTab = activeTab === "conditions";
  const isReportsTab = activeTab === "reports";
  const isReportDetailTab = activeTab.startsWith("reports-");
  const isReportsContext = isReportsTab || isReportDetailTab;

  const tabMeta = useMemo(() => {
    if (isRecordsTab) {
      return {
        title: "Warranty Records",
        subtitle: "Invoice, repair, customer and serial-linked warranty records",
      };
    }
    if (isClaimsTab) {
      return {
        title: "Claims Desk",
        subtitle: "Inspection, approval and resolution workflow for warranty claims",
      };
    }
    if (isRulesTab) {
      return {
        title: "Warranty Rules",
        subtitle: "Priority-based policy engine for category, product and repair coverage",
      };
    }
    if (isConditionsTab) {
      return {
        title: "Coverage Conditions",
        subtitle: "Inclusion, exclusion and policy wording controls",
      };
    }
    if (isReportsContext) {
      return {
        title: "Warranty Reports",
        subtitle: "Operational reporting and trend analysis",
      };
    }
    return {
      title: "Warranty Dashboard",
      subtitle: "Operational overview of warranty lifecycle and claims management",
    };
  }, [isClaimsTab, isConditionsTab, isRecordsTab, isReportsContext, isRulesTab]);

  const workspaceKpis = useMemo(() => {
    if (isRecordsTab) {
      return [
        { key: "active_warranties", title: "Active Warranties", value: kpi.active_warranties, icon: <ShieldCheck size={18} />, tone: "green" },
        { key: "expiring_soon", title: "Expiring Soon", value: kpi.expiring_soon, icon: <AlertTriangle size={18} />, tone: "amber" },
        { key: "expired_warranties", title: "Expired Warranties", value: kpi.expired_warranties, icon: <ShieldX size={18} />, tone: "red" },
        { key: "total_warranties", title: "Total Warranties", value: kpi.total_warranties, icon: <Layers3 size={18} />, tone: "sky" },
      ];
    }
    if (isClaimsTab) {
      return [
        { key: "pending_claims", title: "Pending Claims", value: kpi.pending_claims, icon: <Clock4 size={18} />, tone: "amber" },
        { key: "approved_claims", title: "Approved Claims", value: kpi.approved_claims, icon: <BadgeCheck size={18} />, tone: "indigo" },
        { key: "rejected_claims", title: "Rejected Claims", value: kpi.rejected_claims, icon: <XCircle size={18} />, tone: "red" },
        { key: "total_claims", title: "Total Claims", value: kpi.total_claims, icon: <Wrench size={18} />, tone: "violet" },
      ];
    }
    return [];
  }, [isClaimsTab, isRecordsTab, kpi.active_warranties, kpi.approved_claims, kpi.expired_warranties, kpi.expiring_soon, kpi.pending_claims, kpi.rejected_claims, kpi.total_claims, kpi.total_warranties]);

  const visibleWorkspaceKpis = useMemo(() => {
    if (!isCompactHeight || showAllKpis) return workspaceKpis;
    return workspaceKpis.slice(0, 4);
  }, [isCompactHeight, showAllKpis, workspaceKpis]);

  if (loading && !dashboard) {
    return <Loading text="Loading warranty module..." />;
  }

  return (
    <div className="min-h-0 min-w-0 max-w-full overflow-x-clip overflow-y-auto pr-1 xl:h-full xl:overflow-y-hidden">
      <div className={`space-y-3 pb-3 ${isCompactHeight ? "warranty-compact" : ""}`}>
        <section className="panel p-4 space-y-3">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
            <div className="xl:col-span-4 min-w-0">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-lg border border-indigo-400/35 bg-indigo-500/15 text-indigo-200">
                  <Shield size={16} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-xl font-black text-white leading-none">{tabMeta.title}</h2>
                  <p className="text-xs text-slate-400 mt-1">
                    {tabMeta.subtitle}
                  </p>
                </div>
              </div>
            </div>

            <div className="xl:col-span-8 min-w-0">
              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                <Select
                  className="!text-xs"
                  minWidth={190}
                  maxWidth={220}
                  fullWidth={false}
                  value={datePreset}
                  onChange={(event) => applyDatePreset(event.target.value)}
                >
                  <option value="last7">Last 7 Days</option>
                  <option value="last30">Last 30 Days</option>
                  <option value="thisMonth">This Month</option>
                  <option value="all">All Dates</option>
                  <option value="custom">Custom Range</option>
                </Select>
                {datePreset === "custom" && (
                  <>
                    <input
                      type="date"
                      className="field !h-10 !py-2 !px-3 !text-xs min-w-[150px]"
                      value={filters.date_from}
                      onChange={(event) => setFilters((prev) => ({ ...prev, date_from: event.target.value }))}
                    />
                    <input
                      type="date"
                      className="field !h-10 !py-2 !px-3 !text-xs min-w-[150px]"
                      value={filters.date_to}
                      onChange={(event) => setFilters((prev) => ({ ...prev, date_to: event.target.value }))}
                    />
                  </>
                )}
                {(isOverviewTab || isReportsContext) && (
                  <>
                    <Button size="sm" className="!h-10 !px-3.5" variant="secondary" onClick={exportOverviewPdf}>
                      <FileText size={13} /> Export PDF
                    </Button>
                    <Button size="sm" className="!h-10 !px-3.5" variant="secondary" onClick={exportOverviewCsv}>
                      <Download size={13} /> Export CSV
                    </Button>
                  </>
                )}
                {(isOverviewTab || isRecordsTab) && (
                  <Button size="sm" className="!h-10 !px-3.5" onClick={() => setShowCreateWarranty(true)}>
                    <Plus size={13} /> Create Warranty
                  </Button>
                )}
                {(isOverviewTab || isClaimsTab) && (
                  <Button size="sm" className="!h-10 !px-3.5" variant="ghost" onClick={() => setActiveTab("claims")}>
                    <ShieldAlert size={13} /> Quick Claim
                  </Button>
                )}
                {isReportDetailTab && (
                  <Button size="sm" className="!h-10 !px-3.5" variant="ghost" onClick={() => setActiveTab("reports")}>
                    <LineChartIcon size={13} /> Back To Reports
                  </Button>
                )}
                <Button variant="secondary" className="!h-10 !px-3.5" size="sm" onClick={refreshAll} disabled={busy}>
                  Refresh
                </Button>
              </div>
            </div>
          </div>

          {isOverviewTab && (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_120px_120px] gap-2 items-center">
            <div className="relative min-w-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                className="field !h-10 !py-2 !pl-9 !pr-20 !text-xs"
                placeholder="Search warranty, IMEI, serial, customer, claim ID..."
                value={lookupQuery}
                onChange={(event) => setLookupQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    performLookup();
                  }
                }}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                Ctrl + K
              </span>
            </div>
            <Button size="sm" className="!h-10 !w-full !px-3" onClick={performLookup} disabled={busy}>
              Lookup
            </Button>
            <Button size="sm" variant="ghost" className="!h-10 !w-full !px-3" onClick={() => setLookupRows([])}>
              Clear
            </Button>
          </div>
          )}
          {isOverviewTab && lookupRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-slate-400">Lookup results:</span>
              {lookupRows.slice(0, 4).map((row) => (
                <button
                  key={row.id}
                  className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-[11px] text-indigo-200 hover:bg-indigo-500/20 transition"
                  onClick={() => openWarrantyDrawer(row)}
                >
                  {row.warranty_id || row.warranty_number || `WRN-${row.id}`}
                </button>
              ))}
              {lookupRows.length > 4 && (
                <span className="text-[11px] text-slate-500">+{lookupRows.length - 4} more</span>
              )}
            </div>
          )}
        </section>

        {(isOverviewTab || workspaceKpis.length > 0) && (
        <section className="space-y-2">
          {isOverviewTab ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8 gap-2">
              {overviewKpis.map((row) => (
                <OverviewKpiCard
                  key={row.key}
                  title={row.title}
                  value={row.value}
                  deltaLabel={row.delta}
                  tone={row.tone}
                  icon={row.icon}
                  sparkData={row.spark}
                />
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                {visibleWorkspaceKpis.map((row) => (
                  <KpiCard
                    key={row.key}
                    title={row.title}
                    value={Number(row.value || 0).toLocaleString()}
                    icon={row.icon}
                    tone={row.tone}
                  />
                ))}
              </div>
              {isCompactHeight && workspaceKpis.length > 4 && (
                <div className="flex justify-end">
                  <Button size="sm" variant="ghost" onClick={() => setShowAllKpis((prev) => !prev)}>
                    {showAllKpis ? "Show Fewer KPIs" : "Show All KPIs"}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
        )}

        {isRecordsTab && (
        <SectionCard
          title="Filters"
          subtitle="Search-first compact workflow"
          className={isCompactHeight ? "!p-4" : ""}
          right={
            isCompactHeight ? (
              <Button size="sm" variant="ghost" onClick={() => setShowAdvancedFilters((prev) => !prev)}>
                {showAdvancedFilters ? "Hide Advanced" : "More Filters"}
              </Button>
            ) : null
          }
        >
          <div className={`grid grid-cols-1 md:grid-cols-2 ${isCompactHeight ? "xl:grid-cols-3" : "xl:grid-cols-7"} gap-2`}>
            <input
              className="field !py-2 !px-3 !text-xs"
              placeholder="Search warranty records..."
              value={filters.q}
              onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
            />
            <Select
              className="field !py-2 !px-3 !text-xs"
              value={filters.status}
              onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
            >
              <option value="all">Status: All</option>
              {WARRANTY_STATUS_FLOW.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
            <Select
              className="field !py-2 !px-3 !text-xs"
              value={filters.warranty_type}
              onChange={(event) => setFilters((prev) => ({ ...prev, warranty_type: event.target.value }))}
            >
              <option value="all">Type: All</option>
              <option value="Product">Product</option>
              <option value="Spare Part">Spare Part</option>
              <option value="Repair Service">Repair Service</option>
            </Select>
            {(!isCompactHeight || showAdvancedFilters) && (
              <>
                <Select
                  className="field !py-2 !px-3 !text-xs"
                  value={filters.category}
                  onChange={(event) => setFilters((prev) => ({ ...prev, category: event.target.value }))}
                >
                  <option value="all">Category: All</option>
                  {(filterOptions.categories || []).map((row) => (
                    <option key={row} value={row}>
                      {row}
                    </option>
                  ))}
                </Select>
                <Select
                  className="field !py-2 !px-3 !text-xs"
                  value={filters.brand}
                  onChange={(event) => setFilters((prev) => ({ ...prev, brand: event.target.value }))}
                >
                  <option value="all">Brand: All</option>
                  {(filterOptions.brands || []).map((row) => (
                    <option key={row} value={row}>
                      {row}
                    </option>
                  ))}
                </Select>
                <input
                  type="date"
                  className="field !py-2 !px-3 !text-xs"
                  value={filters.date_from}
                  onChange={(event) => setFilters((prev) => ({ ...prev, date_from: event.target.value }))}
                />
                <input
                  type="date"
                  className="field !py-2 !px-3 !text-xs"
                  value={filters.date_to}
                  onChange={(event) => setFilters((prev) => ({ ...prev, date_to: event.target.value }))}
                />
              </>
            )}
          </div>
        </SectionCard>
        )}

        <SectionCard title="Warranty Workspace" className={isCompactHeight ? "!p-4" : ""}>
          <div className="flex flex-wrap gap-2 mb-3">
            {topTabs.map((tab) => (
              <ToneTabButton
                key={tab.key}
                label={tab.label}
                count={tab.count}
                tone={tab.tone}
                active={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key)}
              />
            ))}
          </div>

          {activeTab === "overview" && (
            <div className="space-y-3 warranty-overview-grid">
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
                <SectionCard title="Warranty Status Overview" className="xl:col-span-3 !p-3">
                  <div className={isCompactHeight ? "h-40" : "h-48"}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={statusOverviewChart} dataKey="value" nameKey="name" innerRadius={44} outerRadius={72} stroke="none">
                          {statusOverviewChart.map((entry, index) => (
                            <Cell key={`${entry.name}-${index}`} fill={entry.color || CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 space-y-1">
                    {statusOverviewChart.map((row) => (
                      <div key={`status-${row.name}`} className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-300">{row.name}</span>
                        <span className="font-bold text-white">{Number(row.value || 0).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Warranty Distribution by Product Type" className="xl:col-span-3 !p-3">
                  <div className={isCompactHeight ? "h-40" : "h-48"}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={productCategoryChart} dataKey="value" nameKey="name" innerRadius={42} outerRadius={72} stroke="none">
                          {productCategoryChart.map((entry, index) => (
                            <Cell key={`${entry.name}-${index}`} fill={entry.color || CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 space-y-1">
                    {productCategoryChart.map((row) => {
                      const pct = records.length ? (Number(row.value || 0) / records.length) * 100 : 0;
                      return (
                        <div key={`cat-${row.name}`} className="flex items-center justify-between text-[11px]">
                          <span className="truncate pr-2 text-slate-300">{row.name}</span>
                          <span className="font-bold text-white">{formatPct(pct)}</span>
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>

                <SectionCard
                  title="Expiring Warranties"
                  subtitle="Operational urgency desk"
                  className="xl:col-span-6 !p-3"
                  right={<button className="text-[11px] text-indigo-300 hover:text-indigo-100" onClick={() => setActiveTab("records")}>View All</button>}
                >
                  <AppTableShell minWidth={760} className={`ops-table-shell ${isCompactHeight ? "max-h-[220px]" : "max-h-[250px]"}`} innerClassName="table-compact">
                      <AppTableHead>
                        <tr>
                          <th>Product</th>
                          <th>IMEI / Serial</th>
                          <th>Customer</th>
                          <th>End Date</th>
                          <th>Days</th>
                          <th>Type</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </AppTableHead>
                      <tbody>
                        {!expiringOpsRows.length && (
                          <AppTableEmptyRow colSpan={8} title="No expiring warranties" text="" />
                        )}
                        {expiringOpsRows.slice(0, 35).map((row) => {
                          const days = Number(row.daysLeft || 0);
                          const urgencyTone = days < 0 ? "red" : days === 0 ? "red" : days <= 7 ? "amber" : "green";
                          return (
                            <tr key={`exp-${row.id}`}>
                              <td>{row.product_or_service_name}</td>
                              <td>{row.imei_or_serial || "-"}</td>
                              <td>{row.customer_name || "-"}</td>
                              <td>{toHumanDate(row.end_date)}</td>
                              <td>
                                <StatusPill
                                  tone={urgencyTone}
                                  label={days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Expired today" : `${days}d left`}
                                />
                              </td>
                              <td>{row.warranty_type || "-"}</td>
                              <td><StatusPill label={row.status || "-"} /></td>
                              <td>
                                <div className="flex gap-1">
                                  <Button size="sm" variant="ghost" onClick={() => quickRenewWarranty(row)}>Renew</Button>
                                  <Button size="sm" variant="ghost" onClick={() => quickClaimWarranty(row)}>Claim</Button>
                                  <Button size="sm" variant="ghost" onClick={() => openWarrantyDrawer(row)}>View</Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                  </AppTableShell>
                </SectionCard>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
                <SectionCard
                  title="Recent Claims Monitor"
                  subtitle="Claim workflow queue and technician actions"
                  className="xl:col-span-8 !p-3"
                  right={<button className="text-[11px] text-indigo-300 hover:text-indigo-100" onClick={() => setActiveTab("claims")}>Open Claims Desk</button>}
                >
                  <AppTableShell minWidth={820} className={`ops-table-shell ${isCompactHeight ? "max-h-[220px]" : "max-h-[240px]"}`} innerClassName="table-compact">
                      <AppTableHead>
                        <tr>
                          <th>Claim ID</th>
                          <th>Product</th>
                          <th>Customer</th>
                          <th>Issue</th>
                          <th>Technician</th>
                          <th>Claim Status</th>
                          <th>Approval</th>
                          <th>Resolution</th>
                          <th>Actions</th>
                        </tr>
                      </AppTableHead>
                      <tbody>
                        {!recentClaimRows.length && (
                          <AppTableEmptyRow colSpan={9} title="No claims yet" text="" />
                        )}
                        {recentClaimRows.slice(0, 40).map((row) => (
                          <tr key={`claim-${row.id}`}>
                            <td>{row.claim_id || "-"}</td>
                            <td>{row.product_or_service_name || "-"}</td>
                            <td>{row.customer_name || "-"}</td>
                            <td className="max-w-[220px] truncate">{row.customer_complaint || "-"}</td>
                            <td>{row.technician || "-"}</td>
                            <td><StatusPill label={row.claim_status || "-"} /></td>
                            <td>{row.approved_by ? <StatusPill tone="green" label="Approved" /> : <StatusPill tone="amber" label="Pending" />}</td>
                            <td>{row.resolutionDays === null ? "-" : `${row.resolutionDays}d`}</td>
                            <td>
                              <Select
                                className="field !py-1 !px-2 !text-xs min-w-[130px]"
                                value={row.claim_status}
                                onChange={(event) => updateClaimStatus(row.id, event.target.value)}
                              >
                                {CLAIM_STATUS_FLOW.map((status) => (
                                  <option key={`${row.id}-${status}`} value={status}>{status}</option>
                                ))}
                              </Select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                  </AppTableShell>
                </SectionCard>

                <SectionCard title="Warranty Performance" className="xl:col-span-4 !p-3">
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider">Approval Rate</p>
                        <p className="text-lg font-black text-emerald-300">{formatPct(claimApprovalRate)}</p>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider">Avg Resolution</p>
                        <p className="text-lg font-black text-sky-300">{avgResolutionDays.toFixed(1)}d</p>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider">Repair-Warranty</p>
                        <p className="text-lg font-black text-violet-300">{formatPct(repairWarrantyRatio)}</p>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider">Repeated Issues</p>
                        <p className="text-lg font-black text-amber-300">{formatPct(repeatedIssuePct)}</p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Claim Trend</p>
                      <div className={isCompactHeight ? "h-20" : "h-24"}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={reports?.claim_trend || []}>
                            <Line type="monotone" dataKey="total_claims" stroke="#38bdf8" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="approved" stroke="#22c55e" strokeWidth={1.8} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Top Claimed Products</p>
                        <div className="space-y-1">
                          {topClaimedProducts.slice(0, 3).map((row) => (
                            <div key={`top-prod-${row.name}`} className="flex justify-between text-[11px]">
                              <span className="truncate pr-2 text-slate-300">{row.name}</span>
                              <span className="font-bold text-white">{row.value}</span>
                            </div>
                          ))}
                          {!topClaimedProducts.length && <div className="text-[11px] text-slate-500">No data</div>}
                        </div>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Top Issue Types</p>
                        <div className="space-y-1">
                          {topIssueTypes.slice(0, 3).map((row) => (
                            <div key={`top-issue-${row.name}`} className="flex justify-between text-[11px]">
                              <span className="truncate pr-2 text-slate-300">{row.name}</span>
                              <span className="font-bold text-white">{row.value}</span>
                            </div>
                          ))}
                          {!topIssueTypes.length && <div className="text-[11px] text-slate-500">No data</div>}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Technician Warranty Performance</p>
                      <div className="space-y-1">
                        {technicianPerformance.slice(0, 4).map((row) => (
                          <div key={`tech-${row.technician}`} className="flex items-center justify-between text-[11px]">
                            <span className="truncate pr-2 text-slate-300">{row.technician}</span>
                            <span className="text-slate-200">{formatPct(row.resolve_rate)} | {row.resolution_avg.toFixed(1)}d</span>
                          </div>
                        ))}
                        {!technicianPerformance.length && <div className="text-[11px] text-slate-500">No technician claim activity.</div>}
                      </div>
                    </div>
                  </div>
                </SectionCard>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
                <SectionCard title="Warranty Rules & Policies" className="xl:col-span-4 !p-3">
                  <div className="space-y-1.5 text-[11px]">
                    {rules.slice(0, 8).map((row) => (
                      <div key={`rule-${row.id}`} className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 flex items-center justify-between gap-2">
                        <span className="truncate text-slate-300">{row.rule_name}</span>
                        <span className="font-bold text-white">{Number(row.warranty_days || 0)}d</span>
                      </div>
                    ))}
                    {!rules.length && <p className="text-slate-500">No rules configured.</p>}
                  </div>
                </SectionCard>

                <SectionCard title="Warranty Alerts" className="xl:col-span-4 !p-3">
                  <div className="space-y-1.5">
                    {highRiskAlerts.map((row, index) => (
                      <div key={`alert-${index}`} className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-bold text-white">{row.type}</p>
                          <StatusPill tone={row.severity} label={String(row.severity || "").toUpperCase()} />
                        </div>
                        <p className="text-[11px] text-slate-300 mt-0.5">{row.detail}</p>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Quick Actions" className="xl:col-span-4 !p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" onClick={() => setShowCreateWarranty(true)}><Plus size={12} /> Create Warranty</Button>
                    <Button size="sm" variant="secondary" onClick={() => setActiveTab("claims")}><ShieldAlert size={12} /> Create Claim</Button>
                    <Button size="sm" variant="secondary" onClick={() => setLookupQuery((prev) => prev)}><Search size={12} /> Verify IMEI</Button>
                    <Button size="sm" variant="secondary" onClick={performLookup}><FileSearch size={12} /> Warranty Lookup</Button>
                    <Button size="sm" variant="secondary" onClick={exportOverviewPdf}><FileText size={12} /> Print Card/Report</Button>
                    <Button size="sm" variant="secondary" onClick={exportOverviewCsv}><Download size={12} /> Export Report</Button>
                  </div>
                </SectionCard>
              </div>
            </div>
          )}

          {activeTab === "records" && (
            <div className="space-y-3">
              <SectionCard
                title="Warranty Register"
                subtitle="Invoice, repair, customer and serial-linked warranty records"
                className="!p-3"
                right={<Button size="sm" onClick={() => setShowCreateWarranty(true)}><Plus size={12} /> Create Warranty</Button>}
              >
                <MiniTable
                  columns={[
                    { label: "Warranty ID", value: "warranty_id" },
                    { label: "Invoice", value: (row) => row.invoice_no || "-" },
                    { label: "Repair Ticket", value: (row) => row.repair_ticket_no || "-" },
                    { label: "Customer", value: "customer_name" },
                    { label: "Phone", value: "customer_phone" },
                    { label: "Product / Service", value: "product_or_service_name" },
                    { label: "Brand / Model", value: (row) => row.device_brand_model || "-" },
                    { label: "Serial / IMEI", value: (row) => row.imei_or_serial || "-" },
                    { label: "Type", value: "warranty_type" },
                    { label: "Start", value: (row) => toHumanDate(row.start_date) },
                    { label: "End Date", value: (row) => toHumanDate(row.end_date) },
                    {
                      label: "Status",
                      value: (row) => <StatusPill label={row.status || "-"} />,
                    },
                    {
                      label: "Actions",
                      value: (row) => (
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openWarrantyDrawer(row)}>
                            View
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => openWarrantyCertificate(row)}>
                            Certificate
                          </Button>
                        </div>
                      ),
                    },
                  ]}
                  rows={records}
                  tableClassName="min-w-[700px]"
                  maxHeightClass={isCompactHeight ? "max-h-[240px]" : "max-h-[330px]"}
                  emptyLabel="No warranty records found for the current filters."
                />
              </SectionCard>

              <SectionCard
                title="Warranty Expiring Soon"
                subtitle="Operational queue for upcoming expiries"
                className="!p-3"
                right={<Button size="sm" variant="ghost" onClick={() => setActiveTab("overview")}>Open Overview Queue</Button>}
              >
                <MiniTable
                  columns={[
                    { label: "Warranty ID", value: "warranty_id" },
                    { label: "Customer", value: "customer_name" },
                    { label: "Product", value: "product_or_service_name" },
                    { label: "End Date", value: (row) => toHumanDate(row.end_date) },
                    { label: "Days Left", value: (row) => <StatusPill tone={Number(row.daysLeft || 0) <= 7 ? "amber" : "green"} label={`${Number(row.daysLeft || 0)}d`} /> },
                    {
                      label: "Status",
                      value: (row) => <StatusPill label={row.status || "-"} />,
                    },
                  ]}
                  rows={warrantyExpiringSoonRows}
                  tableClassName="min-w-[680px]"
                  maxHeightClass={isCompactHeight ? "max-h-[220px]" : "max-h-[280px]"}
                  emptyLabel="No expiring warranties in the next 30 days."
                />
              </SectionCard>
            </div>
          )}

          {activeTab === "claims" && (
            <div className="space-y-3">
              <SectionCard title="Create Warranty Claim" subtitle="Staff inspection intake and decision workflow" className="!p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                  <Select
                    className="field !py-2 !px-3 !text-xs xl:col-span-2"
                    value={claimForm.warranty_id}
                    onChange={(event) => setClaimForm((prev) => ({ ...prev, warranty_id: event.target.value }))}
                  >
                    <option value="">Select Warranty</option>
                    {warrantySelectorOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  <Select
                    className="field !py-2 !px-3 !text-xs"
                    value={claimForm.claim_status}
                    onChange={(event) => setClaimForm((prev) => ({ ...prev, claim_status: event.target.value }))}
                  >
                    {CLAIM_STATUS_FLOW.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </Select>
                  <input
                    className="field !py-2 !px-3 !text-xs"
                    placeholder="Decision (repair / replace / reject)"
                    value={claimForm.claim_decision}
                    onChange={(event) => setClaimForm((prev) => ({ ...prev, claim_decision: event.target.value }))}
                  />
                  <input
                    className="field !py-2 !px-3 !text-xs xl:col-span-2"
                    placeholder="Customer complaint"
                    value={claimForm.customer_complaint}
                    onChange={(event) => setClaimForm((prev) => ({ ...prev, customer_complaint: event.target.value }))}
                  />
                  <input
                    className="field !py-2 !px-3 !text-xs xl:col-span-2"
                    placeholder="Technician inspection note"
                    value={claimForm.technician_inspection_note}
                    onChange={(event) =>
                      setClaimForm((prev) => ({
                        ...prev,
                        technician_inspection_note: event.target.value,
                      }))
                    }
                  />
                  <input
                    className="field !py-2 !px-3 !text-xs"
                    placeholder="Replacement item"
                    value={claimForm.replacement_item}
                    onChange={(event) => setClaimForm((prev) => ({ ...prev, replacement_item: event.target.value }))}
                  />
                  <input
                    className="field !py-2 !px-3 !text-xs"
                    placeholder="Repair action"
                    value={claimForm.repair_action}
                    onChange={(event) => setClaimForm((prev) => ({ ...prev, repair_action: event.target.value }))}
                  />
                </div>
                <div className="mt-3">
                  <Button size="sm" onClick={submitClaim} disabled={busy}>
                    Save Claim
                  </Button>
                </div>
              </SectionCard>

              <SectionCard title="Claim Monitoring" subtitle="Live claim queue with inline status transitions" className="!p-3">
                <MiniTable
                  columns={[
                    { label: "Claim ID", value: "claim_id" },
                    { label: "Warranty", value: "warranty_code" },
                    { label: "Customer", value: "customer_name" },
                    { label: "Product / Service", value: "product_or_service_name" },
                    { label: "Complaint", value: (row) => <span className="inline-block max-w-[220px] truncate">{row.customer_complaint || "-"}</span> },
                    { label: "Inspection Note", value: (row) => <span className="inline-block max-w-[220px] truncate">{row.technician_inspection_note || "-"}</span> },
                    {
                      label: "Claim Status",
                      value: (row) => <StatusPill label={row.claim_status || "-"} />,
                    },
                    { label: "Decision", value: (row) => row.claim_decision || "-" },
                    { label: "Replacement", value: (row) => row.replacement_item || "-" },
                    { label: "Repair Action", value: (row) => row.repair_action || "-" },
                    {
                      label: "Move",
                      value: (row) => (
                        <Select
                          className="field !py-1 !px-2 !text-xs min-w-[150px]"
                          value={row.claim_status}
                          onChange={(event) => updateClaimStatus(row.id, event.target.value)}
                        >
                          {CLAIM_STATUS_FLOW.map((status) => (
                            <option key={`${row.id}-${status}`} value={status}>
                              {status}
                            </option>
                          ))}
                        </Select>
                      ),
                    },
                  ]}
                  rows={claims}
                  tableClassName="min-w-[820px]"
                  maxHeightClass={isCompactHeight ? "max-h-[245px]" : "max-h-[335px]"}
                  emptyLabel="No warranty claims found."
                />
              </SectionCard>
            </div>
          )}

          {activeTab === "rules" && (
            <div className="space-y-3">
              <SectionCard title="Add Warranty Rule" className="!p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2">
                  <input
                    className="field !py-2 !px-3 !text-xs xl:col-span-2"
                    placeholder="Rule name"
                    value={ruleForm.rule_name}
                    onChange={(event) => setRuleForm((prev) => ({ ...prev, rule_name: event.target.value }))}
                  />
                  <Select
                    className="field !py-2 !px-3 !text-xs"
                    value={ruleForm.scope_type}
                    onChange={(event) => setRuleForm((prev) => ({ ...prev, scope_type: event.target.value }))}
                  >
                    <option value="product_category">Product Category</option>
                    <option value="repair_service">Repair Service</option>
                    <option value="spare_part">Spare Part</option>
                    <option value="product">Product</option>
                  </Select>
                  <input
                    className="field !py-2 !px-3 !text-xs"
                    placeholder="Scope value (or *)"
                    value={ruleForm.scope_value}
                    onChange={(event) => setRuleForm((prev) => ({ ...prev, scope_value: event.target.value }))}
                  />
                  <input
                    type="number"
                    min="0"
                    className="field !py-2 !px-3 !text-xs"
                    placeholder="Warranty days"
                    value={ruleForm.warranty_days}
                    onChange={(event) => setRuleForm((prev) => ({ ...prev, warranty_days: Number(event.target.value || 0) }))}
                  />
                  <input
                    className="field !py-2 !px-3 !text-xs"
                    placeholder="Description"
                    value={ruleForm.description}
                    onChange={(event) => setRuleForm((prev) => ({ ...prev, description: event.target.value }))}
                  />
                </div>
                <div className="mt-3">
                  <Button size="sm" onClick={submitRule} disabled={busy}>
                    Add Rule
                  </Button>
                </div>
              </SectionCard>

              <SectionCard title="Rules Registry" subtitle="Coverage policy controls and activation state" className="!p-3">
                <MiniTable
                  columns={[
                    { label: "Rule Name", value: "rule_name" },
                    { label: "Scope Type", value: "scope_type" },
                    { label: "Scope Value", value: "scope_value" },
                    { label: "Warranty Days", value: (row) => Number(row.warranty_days || 0).toLocaleString() },
                    { label: "Description", value: (row) => row.description || "-" },
                    {
                      label: "Active",
                      value: (row) => <StatusPill tone={row.is_active ? "green" : "red"} label={row.is_active ? "Active" : "Disabled"} />,
                    },
                    {
                      label: "Action",
                      value: (row) => (
                        <Button size="sm" variant="ghost" onClick={() => toggleRuleActive(row)}>
                          {row.is_active ? "Disable" : "Enable"}
                        </Button>
                      ),
                    },
                  ]}
                  rows={rules}
                  tableClassName="min-w-[740px]"
                  maxHeightClass={isCompactHeight ? "max-h-[245px]" : "max-h-[320px]"}
                  emptyLabel="No warranty rules found."
                />
              </SectionCard>
            </div>
          )}

          {activeTab === "conditions" && (
            <div className="space-y-3">
              <SectionCard title="Add Warranty Condition" className="!p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2">
                  <input
                    className="field !py-2 !px-3 !text-xs"
                    placeholder="Condition code"
                    value={conditionForm.condition_code}
                    onChange={(event) =>
                      setConditionForm((prev) => ({
                        ...prev,
                        condition_code: event.target.value.toUpperCase().replace(/\s+/g, "_"),
                      }))
                    }
                  />
                  <input
                    className="field !py-2 !px-3 !text-xs xl:col-span-2"
                    placeholder="Condition title"
                    value={conditionForm.title}
                    onChange={(event) => setConditionForm((prev) => ({ ...prev, title: event.target.value }))}
                  />
                  <input
                    className="field !py-2 !px-3 !text-xs xl:col-span-2"
                    placeholder="Description"
                    value={conditionForm.description}
                    onChange={(event) =>
                      setConditionForm((prev) => ({ ...prev, description: event.target.value }))
                    }
                  />
                  <input
                    type="number"
                    className="field !py-2 !px-3 !text-xs"
                    placeholder="Sort order"
                    value={conditionForm.sort_order}
                    onChange={(event) =>
                      setConditionForm((prev) => ({
                        ...prev,
                        sort_order: Number(event.target.value || 0),
                      }))
                    }
                  />
                  <Select
                    className="field !py-2 !px-3 !text-xs"
                    value={conditionForm.is_covered ? "covered" : "not-covered"}
                    onChange={(event) =>
                      setConditionForm((prev) => ({
                        ...prev,
                        is_covered: event.target.value === "covered",
                      }))
                    }
                  >
                    <option value="not-covered">Not Covered</option>
                    <option value="covered">Covered</option>
                  </Select>
                  <Select
                    className="field !py-2 !px-3 !text-xs"
                    value={conditionForm.is_active ? "active" : "inactive"}
                    onChange={(event) =>
                      setConditionForm((prev) => ({
                        ...prev,
                        is_active: event.target.value === "active",
                      }))
                    }
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </Select>
                </div>
                <div className="mt-3">
                  <Button size="sm" onClick={submitCondition} disabled={busy}>
                    Add Condition
                  </Button>
                </div>
              </SectionCard>

              <SectionCard title="Conditions Registry" subtitle="Coverage inclusion/exclusion control center" className="!p-3">
                <MiniTable
                  columns={[
                    { label: "Code", value: "condition_code" },
                    { label: "Title", value: "title" },
                    { label: "Description", value: (row) => row.description || "-" },
                    {
                      label: "Coverage",
                      value: (row) => <StatusPill tone={row.is_covered ? "green" : "amber"} label={row.is_covered ? "Covered" : "Not Covered"} />,
                    },
                    {
                      label: "Status",
                      value: (row) => <StatusPill tone={row.is_active ? "green" : "red"} label={row.is_active ? "Active" : "Disabled"} />,
                    },
                    {
                      label: "Action",
                      value: (row) => (
                        <Button size="sm" variant="ghost" onClick={() => toggleConditionActive(row)}>
                          {row.is_active ? "Disable" : "Enable"}
                        </Button>
                      ),
                    },
                  ]}
                  rows={conditions}
                  tableClassName="min-w-[780px]"
                  maxHeightClass={isCompactHeight ? "max-h-[245px]" : "max-h-[320px]"}
                  emptyLabel="No warranty conditions found."
                />
              </SectionCard>
            </div>
          )}

          {activeTab === "reports" && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                <SectionCard title="Warranty Status Distribution" className="!p-3">
                  <div className={isCompactHeight ? "h-52" : "h-64"}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={recordsByStatusChart} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} stroke="none">
                          {recordsByStatusChart.map((entry, index) => (
                            <Cell key={`${entry.name}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>

                <SectionCard title="Claim Status Distribution" className="!p-3">
                  <div className={isCompactHeight ? "h-52" : "h-64"}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={claimsByStatusChart}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.2)" />
                        <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="#6366f1" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>

                <SectionCard title="Claim Trend (Monthly)" className="xl:col-span-2 !p-3">
                  <div className={isCompactHeight ? "h-56" : "h-64"}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={reports?.claim_trend || []}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.2)" />
                        <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="total_claims" stroke="#22c55e" strokeWidth={2.5} dot={false} />
                        <Line type="monotone" dataKey="approved" stroke="#38bdf8" strokeWidth={2.2} dot={false} />
                        <Line type="monotone" dataKey="rejected" stroke="#ef4444" strokeWidth={2.2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </SectionCard>
              </div>

              <SectionCard title="Sub Reports" subtitle="Drill down into operational warranty report sets" className="!p-3">
                <div className="flex flex-wrap gap-2 mb-3">
                  {reportTabs.map((tab) => (
                    <ToneTabButton
                      key={tab.key}
                      label={tab.label}
                      count={tab.count}
                      tone={tab.tone}
                      active={activeTab === tab.key}
                      onClick={() => setActiveTab(tab.key)}
                    />
                  ))}
                </div>
                <p className="text-xs text-slate-400">
                  Includes Active Warranties, Expired Warranties, Claims Summary, Rejected Claims, and Replacement History.
                </p>
              </SectionCard>
            </div>
          )}

          {activeTab.startsWith("reports-") && (
            <SectionCard title="Report Table" subtitle="Operational report rows with customer and status linkage" className="!p-3">
              <MiniTable
                columns={[
                  { label: "Warranty / Claim ID", value: (row) => row.warranty_id || row.claim_id || "-" },
                  { label: "Customer", value: (row) => row.customer_name || "-" },
                  { label: "Phone", value: (row) => row.customer_phone || "-" },
                  { label: "Product / Service", value: (row) => row.product_or_service_name || "-" },
                  {
                    label: "Status",
                    value: (row) => <StatusPill label={row.status || row.claim_status || "-"} />,
                  },
                  { label: "Start Date", value: (row) => toHumanDate(row.start_date || row.created_at) },
                  { label: "End Date", value: (row) => toHumanDate(row.end_date || row.updated_at) },
                ]}
                rows={subReportRows}
                tableClassName="min-w-[740px]"
                maxHeightClass={isCompactHeight ? "max-h-[260px]" : "max-h-[340px]"}
                emptyLabel="No rows in this report section."
              />
              <div className="mt-3">
                <Button variant="secondary" size="sm" onClick={() => setActiveTab("reports")}>
                  Back To Report Dashboard
                </Button>
              </div>
            </SectionCard>
          )}
        </SectionCard>
      </div>

      <AppModal
        open={showCreateWarranty}
        onClose={() => setShowCreateWarranty(false)}
        title="Create Warranty Record"
        panelClassName="max-w-2xl bg-slate-950"
      >
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                className="field !py-2 !px-3 !text-xs"
                placeholder="Customer name"
                value={createWarrantyForm.customer_name}
                onChange={(event) => setCreateWarrantyForm((prev) => ({ ...prev, customer_name: event.target.value }))}
              />
              <input
                className="field !py-2 !px-3 !text-xs"
                placeholder="Customer phone"
                value={createWarrantyForm.customer_phone}
                onChange={(event) => setCreateWarrantyForm((prev) => ({ ...prev, customer_phone: event.target.value }))}
              />
              <input
                className="field !py-2 !px-3 !text-xs md:col-span-2"
                placeholder="Product / service"
                value={createWarrantyForm.product_or_service_name}
                onChange={(event) =>
                  setCreateWarrantyForm((prev) => ({ ...prev, product_or_service_name: event.target.value }))
                }
              />
              <Select
                className="field !py-2 !px-3 !text-xs"
                value={createWarrantyForm.warranty_type}
                onChange={(event) => setCreateWarrantyForm((prev) => ({ ...prev, warranty_type: event.target.value }))}
              >
                <option value="Product">Product</option>
                <option value="Spare Part">Spare Part</option>
                <option value="Repair Service">Repair Service</option>
              </Select>
              <input
                type="date"
                className="field !py-2 !px-3 !text-xs"
                value={createWarrantyForm.start_date}
                onChange={(event) => setCreateWarrantyForm((prev) => ({ ...prev, start_date: event.target.value }))}
              />
              <input
                type="number"
                min="0"
                className="field !py-2 !px-3 !text-xs"
                placeholder="Warranty days"
                value={createWarrantyForm.warranty_days}
                onChange={(event) =>
                  setCreateWarrantyForm((prev) => ({ ...prev, warranty_days: Number(event.target.value || 0) }))
                }
              />
              <input
                className="field !py-2 !px-3 !text-xs"
                placeholder="IMEI / Serial"
                value={createWarrantyForm.imei_or_serial}
                onChange={(event) => setCreateWarrantyForm((prev) => ({ ...prev, imei_or_serial: event.target.value }))}
              />
              <input
                className="field !py-2 !px-3 !text-xs md:col-span-2"
                placeholder="Notes"
                value={createWarrantyForm.notes}
                onChange={(event) => setCreateWarrantyForm((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 px-4 py-3">
              <Button size="sm" variant="secondary" onClick={() => setShowCreateWarranty(false)}>Cancel</Button>
              <Button size="sm" onClick={submitCreateWarranty} disabled={busy}>Create Warranty</Button>
            </div>
      </AppModal>

      <AppDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={selectedWarranty?.warranty_id || "Warranty Details"}
        subtitle="Warranty Details"
        panelClassName="sm:max-w-xl bg-slate-950"
        headerActions={selectedWarranty ? (
          <Button size="sm" variant="secondary" onClick={() => openWarrantyCertificate(selectedWarranty)}>
            <FileText size={12} /> Print Certificate
          </Button>
        ) : null}
      >
            <div className="p-4 space-y-3 min-h-0 flex-1 overflow-y-auto custom-scrollbar">
              {busy && !selectedWarranty && <div className="text-sm text-slate-400">Loading warranty details...</div>}
              {selectedWarranty && (
                <>
                  <SectionCard title="Primary Record">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <InfoRow label="Customer" value={selectedWarranty.customer_name} />
                      <InfoRow label="Phone" value={selectedWarranty.customer_phone || "-"} />
                      <InfoRow label="Invoice" value={selectedWarranty.invoice_no || "-"} />
                      <InfoRow label="Repair Ticket" value={selectedWarranty.repair_ticket_no || "-"} />
                      <InfoRow label="Product / Service" value={selectedWarranty.product_or_service_name || "-"} />
                      <InfoRow label="Type" value={selectedWarranty.warranty_type || "-"} />
                      <InfoRow label="Brand / Model" value={selectedWarranty.device_brand_model || "-"} />
                      <InfoRow label="Serial / IMEI" value={selectedWarranty.imei_or_serial || "-"} />
                      <InfoRow label="Start Date" value={toHumanDate(selectedWarranty.start_date)} />
                      <InfoRow label="End Date" value={toHumanDate(selectedWarranty.end_date)} />
                    </div>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
                      <Select
                        className="field !py-2 !px-3 !text-xs"
                        value={selectedWarrantyStatus}
                        onChange={(event) => setSelectedWarrantyStatus(event.target.value)}
                      >
                        {WARRANTY_STATUS_FLOW.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </Select>
                      <input
                        className="field !py-2 !px-3 !text-xs md:col-span-2"
                        placeholder="Status note"
                        value={selectedWarrantyNote}
                        onChange={(event) => setSelectedWarrantyNote(event.target.value)}
                      />
                      <Button size="sm" onClick={updateSelectedWarrantyStatus} disabled={busy}>
                        Update Status
                      </Button>
                    </div>
                  </SectionCard>

                  <SectionCard title="Coverage Conditions">
                    <MiniTable
                      columns={[
                        { label: "Code", value: (row) => row.code || "-" },
                        { label: "Title", value: (row) => row.title || "-" },
                        { label: "Coverage", value: (row) => (row.is_covered ? "Covered" : "Not Covered") },
                      ]}
                      rows={selectedWarranty.conditions || []}
                      emptyLabel="No condition metadata available."
                    />
                  </SectionCard>

                  <SectionCard title="Claim Timeline">
                    <MiniTable
                      columns={[
                        { label: "Claim ID", value: "claim_id" },
                        { label: "Status", value: (row) => <StatusPill label={row.claim_status || "-"} /> },
                        { label: "Complaint", value: "customer_complaint" },
                        { label: "Decision", value: (row) => row.claim_decision || "-" },
                        { label: "Updated", value: (row) => toHumanDate(row.updated_at) },
                      ]}
                      rows={selectedWarranty.claims || []}
                      emptyLabel="No claims for this warranty yet."
                    />
                  </SectionCard>
                </>
              )}
            </div>
      </AppDrawer>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-0.5 text-xs text-slate-200">{value}</p>
    </div>
  );
}
