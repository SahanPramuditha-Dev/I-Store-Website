import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Bell,
  Check,
  CheckCircle2,
  Clock3,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import api from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import { useFeedback } from "../components/FeedbackProvider";
import { Badge, Button, ErrorState, Input, KpiCard, Loading, SectionCard, Select } from "../components/UI";
import PageContainer from "../components/layout/PageContainer";

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function severityTone(severity) {
  const key = String(severity || "").toLowerCase();
  if (key === "critical") return "red";
  if (key === "high") return "amber";
  if (key === "medium") return "indigo";
  return "slate";
}

function severityIcon(severity) {
  const key = String(severity || "").toLowerCase();
  if (key === "critical") return <ShieldAlert size={16} />;
  if (key === "high") return <AlertTriangle size={16} />;
  return <Bell size={16} />;
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
  const { toast, confirm } = useFeedback();
  const { data, loading, error, refresh } = useFetch("/notifications");
  const [query, setQuery] = useState("");
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
      if (severityFilter !== "all" && severity !== severityFilter) return false;
      if (stateFilter === "unread" && row.is_read) return false;
      if (stateFilter === "unacknowledged" && row.is_acknowledged) return false;
      if (stateFilter === "acknowledged" && !row.is_acknowledged) return false;
      return rowMatchesQuery(row, query);
    });
  }, [rows, query, severityFilter, stateFilter]);

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Operations</p>
          <h1 className="text-2xl font-black tracking-tight text-white">Notifications</h1>
          <p className="mt-1 text-sm text-slate-400">Prioritized alerts for stock, repairs, warranties, payments, and system checks.</p>
        </div>
        <div className="flex flex-wrap gap-2">
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
            <Archive size={13} /> Clear
          </Button>
        </div>
      </div>

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
          <div className="relative lg:col-span-6">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notifications..." className="!pl-9 !text-xs" />
          </div>
          <Select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)} className="lg:col-span-3 !text-xs">
            <option value="all">All Severity</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
          <Select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} className="lg:col-span-3 !text-xs">
            <option value="open">All Current</option>
            <option value="unread">Unread</option>
            <option value="unacknowledged">Unacknowledged</option>
            <option value="acknowledged">Acknowledged</option>
          </Select>
        </div>

        <div className="space-y-2">
          {filteredRows.map((row) => {
            const severity = String(row.severity || "medium").toLowerCase();
            return (
              <div
                key={row.id}
                className={`rounded-xl border p-3 transition ${
                  row.is_acknowledged
                    ? "border-white/10 bg-white/[0.025]"
                    : severity === "critical"
                    ? "border-rose-400/40 bg-rose-500/10"
                    : severity === "high"
                    ? "border-amber-400/35 bg-amber-500/10"
                    : "border-white/10 bg-white/[0.04]"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-200">
                      {severityIcon(severity)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-black text-white">{row.title || row.type || "Notification"}</h3>
                        <Badge tone={severityTone(severity)}>{severity}</Badge>
                        {!row.is_read ? <Badge tone="sky">Unread</Badge> : null}
                        {row.is_acknowledged ? <Badge tone="green">Acknowledged</Badge> : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-300">{row.message || "No message provided."}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        <span>{row.source_module || "system"}</span>
                        <span>{row.type || "alert"}</span>
                        <span>{formatDateTime(row.created_at)}</span>
                        {row.due_at ? <span>Due {formatDateTime(row.due_at)}</span> : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
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
