import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  Bell,
  Boxes,
  Check,
  CheckCircle2,
  Clock3,
  Database,
  ExternalLink,
  Filter,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  Wallet,
  Wrench,
} from "lucide-react";
import api from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import { useFeedback } from "../components/FeedbackProvider";
import { Badge, Button, ErrorState, Input, KpiCard, Loading, PageHeader, SectionCard, Select } from "../components/UI";
import PageContainer from "../components/layout/PageContainer";

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function severityTone(severity) {
  const key = String(severity || "").toLowerCase();
  if (key === "critical") return "red";
  if (key === "high") return "amber";
  if (key === "medium") return "indigo";
  return "slate";
}

function getCategoryIcon(source, type, severity) {
  const s = String(source || "").toLowerCase();
  const t = String(type || "").toLowerCase();
  const sev = String(severity || "").toLowerCase();

  if (sev === "critical") return <ShieldAlert size={16} className="text-rose-400" />;
  if (s === "backup" || t.includes("backup")) return <Database size={16} className="text-purple-400" />;
  if (s === "inventory" || t.includes("stock")) return <Boxes size={16} className="text-amber-400" />;
  if (s === "repairs" || t.includes("repair")) return <Wrench size={16} className="text-blue-400" />;
  if (s === "pos" || t.includes("balance") || t.includes("payment")) return <Wallet size={16} className="text-emerald-400" />;
  if (s === "warranty" || t.includes("warranty")) return <Shield size={16} className="text-cyan-400" />;
  return <Bell size={16} className="text-slate-400" />;
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function rowMatchesQuery(row, query) {
  if (!query.trim()) return true;
  const haystack = [row.title, row.message, row.type, row.source_module, row.entity_type]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

export default function Notifications() {
  const navigate = useNavigate();
  const { toast, confirm } = useFeedback();
  const { data, loading, error, refresh } = useFetch("/notifications");
  const [query, setQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("open");
  const [busy, setBusy] = useState("");

  const rows = useMemo(() => {
    return [...(data || [])].sort((a, b) => {
      const severityDelta = (SEVERITY_ORDER[String(a.severity || "").toLowerCase()] ?? 9) - (SEVERITY_ORDER[String(b.severity || "").toLowerCase()] ?? 9);
      if (severityDelta !== 0) return severityDelta;
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });
  }, [data]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const severity = String(row.severity || "medium").toLowerCase();
      const source = String(row.source_module || "").toLowerCase();
      if (moduleFilter !== "all" && source !== moduleFilter) return false;
      if (severityFilter !== "all" && severity !== severityFilter) return false;
      if (stateFilter === "unread" && row.is_read) return false;
      if (stateFilter === "unacknowledged" && row.is_acknowledged) return false;
      if (stateFilter === "acknowledged" && !row.is_acknowledged) return false;
      return rowMatchesQuery(row, query);
    });
  }, [rows, query, moduleFilter, severityFilter, stateFilter]);

  const stats = useMemo(() => {
    const unread = rows.filter((row) => !row.is_read).length;
    const unacknowledged = rows.filter((row) => !row.is_acknowledged).length;
    const critical = rows.filter((row) => String(row.severity || "").toLowerCase() === "critical").length;
    const high = rows.filter((row) => String(row.severity || "").toLowerCase() === "high").length;
    return { unread, unacknowledged, critical, high };
  }, [rows]);

  const runAction = async (label, action, successMessage) => {
    try {
      setBusy(label);
      await action();
      refresh();
      toast(successMessage, "success");
    } catch (err) {
      toast(err?.response?.data?.detail || "Notification action failed", "error");
    } finally {
      setBusy("");
    }
  };

  const refreshNotifications = () =>
    runAction("refresh", () => api.post("/notifications/refresh"), "Notifications refreshed");

  const markRead = (id) =>
    runAction(`read-${id}`, () => api.put(`/notifications/${id}/read`), "Marked as read");

  const acknowledge = (id) =>
    runAction(`ack-${id}`, () => api.put(`/notifications/${id}/ack`), "Notification acknowledged");

  const markAllRead = () =>
    runAction("read-all", () => api.put("/notifications/read-all"), "All notifications marked as read");

  const acknowledgeAll = () =>
    runAction("ack-all", () => api.put("/notifications/ack-all"), "All notifications acknowledged");

  const clearAll = async () => {
    const ok = await confirm("Clear Notifications", "Archive all current notifications from this center?");
    if (!ok) return;
    runAction("clear-all", () => api.delete("/notifications/clear-all"), "Notifications archived");
  };

  if (loading) return <Loading />;
  if (error) return <ErrorState text={error} />;

  return (
    <PageContainer className="pb-4 pr-1">
      <PageHeader
        eyebrow="Operations"
        title="Notifications"
        subtitle="Prioritized alerts for stock, repairs, warranties, payments, and system checks."
        action={
          <>
            <Button size="sm" variant="secondary" onClick={refreshNotifications} disabled={busy === "refresh"}>
              <RefreshCw size={13} /> {busy === "refresh" ? "Refreshing..." : "Refresh"}
            </Button>
            <Button size="sm" variant="secondary" onClick={markAllRead} disabled={!stats.unread || busy === "read-all"}>
              <Check size={13} /> Mark Read
            </Button>
            <Button size="sm" onClick={acknowledgeAll} disabled={!stats.unacknowledged || busy === "ack-all"}>
              <CheckCircle2 size={13} /> Acknowledge All
            </Button>
            <Button size="sm" variant="danger" onClick={clearAll} disabled={!rows.length || busy === "clear-all"}>
              <Archive size={13} /> Clear All
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Critical" value={stats.critical.toLocaleString()} tone="red" icon={<ShieldAlert size={18} />} />
        <KpiCard title="High Priority" value={stats.high.toLocaleString()} tone="amber" icon={<AlertTriangle size={18} />} />
        <KpiCard title="Unread" value={stats.unread.toLocaleString()} tone="sky" icon={<Bell size={18} />} />
        <KpiCard title="Need Acknowledgement" value={stats.unacknowledged.toLocaleString()} tone="indigo" icon={<Clock3 size={18} />} />
      </div>

      <SectionCard
        title="Notification Queue"
        subtitle={`${filteredRows.length.toLocaleString()} of ${rows.length.toLocaleString()} current alerts`}
        right={
          <Badge tone={stats.unacknowledged ? "amber" : "green"}>
            {stats.unacknowledged ? "Action Needed" : "All Clear"}
          </Badge>
        }
      >
        <div className="mb-3 grid grid-cols-1 gap-2 lg:grid-cols-12">
          <div className="relative lg:col-span-4">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notifications..." className="!pl-9 !text-xs" />
          </div>
          <Select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)} className="lg:col-span-3 !text-xs">
            <option value="all">All Modules</option>
            <option value="inventory">Inventory / Stock</option>
            <option value="repairs">Repairs</option>
            <option value="pos">POS / Billing</option>
            <option value="backup">Backup / System</option>
            <option value="warranty">Warranty</option>
          </Select>
          <Select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)} className="lg:col-span-2.5 !text-xs">
            <option value="all">All Severity</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
          <Select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} className="lg:col-span-2.5 !text-xs">
            <option value="open">All Current</option>
            <option value="unread">Unread</option>
            <option value="unacknowledged">Unacknowledged</option>
            <option value="acknowledged">Acknowledged</option>
          </Select>
        </div>

        <div className="space-y-2.5">
          {filteredRows.map((row) => {
            const severity = String(row.severity || "medium").toLowerCase();
            const isCritical = severity === "critical" || severity === "danger";
            const isWarning = severity === "warning" || severity === "high";
            const relTime = formatRelativeTime(row.created_at);

            return (
              <div
                key={row.id}
                className={`rounded-xl border p-3.5 transition ${
                  row.is_acknowledged
                    ? "border-white/10 bg-white/[0.02] opacity-80"
                    : isCritical
                    ? "border-rose-400/40 bg-rose-500/10 dark:bg-rose-950/20"
                    : isWarning
                    ? "border-amber-400/35 bg-amber-500/10 dark:bg-amber-950/20"
                    : "border-white/10 bg-white/[0.04]"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/20 text-slate-200">
                      {getCategoryIcon(row.source_module, row.type, severity)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-black text-slate-900 dark:text-white leading-tight">
                          {row.title || row.type || "Notification"}
                        </h3>
                        <Badge tone={severityTone(severity)}>{severity}</Badge>
                        {!row.is_read ? <Badge tone="sky">Unread</Badge> : null}
                        {row.is_acknowledged ? <Badge tone="green">Acknowledged</Badge> : null}
                        {relTime && (
                          <span className="text-[10px] text-slate-400 font-mono">
                            • {relTime}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                        {row.message || "No message provided."}
                      </p>
                      <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        <span className="bg-slate-100 dark:bg-white/5 px-1.5 py-0.5 rounded border border-slate-200 dark:border-white/5">
                          {row.source_module || "system"}
                        </span>
                        <span>Created {formatDateTime(row.created_at)}</span>
                        {row.due_at ? (
                          <span className="text-amber-500 dark:text-amber-400 font-semibold">
                            Due {formatDateTime(row.due_at)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {row.action_url && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => navigate(row.action_url)}
                        className="flex items-center gap-1 text-indigo-600 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/30"
                      >
                        {row.action_label || "Open"} <ExternalLink size={12} />
                      </Button>
                    )}
                    {!row.is_read ? (
                      <Button size="sm" variant="secondary" onClick={() => markRead(row.id)} disabled={busy === `read-${row.id}`}>
                        Mark Read
                      </Button>
                    ) : null}
                    {!row.is_acknowledged ? (
                      <Button size="sm" onClick={() => acknowledge(row.id)} disabled={busy === `ack-${row.id}`}>
                        Acknowledge
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}

          {!filteredRows.length ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-black/20 py-12 text-center">
              <Filter size={26} className="mx-auto text-slate-600" />
              <p className="mt-3 text-sm font-bold text-slate-300">No notifications match these filters.</p>
              <p className="mt-1 text-xs text-slate-500">Refresh or clear filters to review the full queue.</p>
            </div>
          ) : null}
        </div>
      </SectionCard>
    </PageContainer>
  );
}

