import { useEffect, useMemo, useState } from "react";
import { useFetch } from "../hooks/useFetch";
import api from "../lib/api";
import { AppTableEmptyRow, AppTableHead, AppTableShell, Badge, Button, Input, KpiCard, Loading, SectionCard, Select, SensitiveActionIndicators, WorkstationNotice } from "../components/UI";
import { AlertTriangle, Cloud, Database, Download, HardDrive, RefreshCw, RotateCcw, Server, ShieldCheck, ShieldAlert, Upload } from "lucide-react";
import { useFeedback } from "../components/FeedbackProvider";
import usePermissionUI from "../hooks/usePermissionUI";

const BACKUP_SECTIONS = [
  { id: "history", label: "Backup History" },
  { id: "restore", label: "Restore Requests" },
  { id: "policy", label: "Backup Policy" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "danger", label: "Danger Zone" },
];

const DEFAULT_BACKUP_SETTINGS = {
  auto_backup: {
    enable_automatic_backup: true,
    backup_frequency: "Daily",
    backup_time: "02:00",
    backup_storage: "Local",
    local_backup_path: "/backups/istore/",
    backup_retention_days: 90,
    compress_backup_files: true,
    encrypt_backup_files: true,
    encryption_password: "",
    notify_on_backup_success: true,
    notify_on_backup_failure: true,
  },
  manual_backup: {
    last_backup_label: "Not yet created",
  },
  data_restore: {
    require_confirmation_checkbox: true,
  },
  data_export: {
    products_inventory: true,
    customers: true,
    suppliers: true,
    sales_invoices: true,
    repair_jobs: true,
    expenses: true,
    audit_logs: true,
    format: "CSV",
  },
  data_cleanup: {
    clear_old_audit_logs_older_than: "1 year",
    purge_deleted_records_enabled: false,
    reset_demo_data_enabled: false,
    factory_reset_enabled: false,
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepMergeDefaults(defaultVal, incomingVal) {
  if (Array.isArray(defaultVal)) {
    return Array.isArray(incomingVal) ? incomingVal : clone(defaultVal);
  }
  if (defaultVal && typeof defaultVal === "object") {
    const source = incomingVal && typeof incomingVal === "object" ? incomingVal : {};
    const out = { ...source };
    Object.entries(defaultVal).forEach(([key, nested]) => {
      out[key] = deepMergeDefaults(nested, source[key]);
    });
    return out;
  }
  return incomingVal === undefined || incomingVal === null ? defaultVal : incomingVal;
}

function setByPath(target, path, value) {
  const keys = String(path || "").split(".").filter(Boolean);
  if (!keys.length) return;
  let ptr = target;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (!ptr[key] || typeof ptr[key] !== "object") ptr[key] = {};
    ptr = ptr[key];
  }
  ptr[keys[keys.length - 1]] = value;
}

function parseBackupTimestamp(fileName) {
  const name = String(fileName || "");
  if (!name) return null;

  // manual_2026_05_16_210659.sqlite.gz
  let match = name.match(/^(?:manual|auto|recovered)_(\d{4})_(\d{2})_(\d{2})_(\d{2})(\d{2})(\d{2})/i);
  if (match) {
    const [, y, m, d, hh, mm, ss] = match;
    const parsed = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  // auto_20260516_145434.db / recovered_20260516_145004.db
  match = name.match(/^(?:auto|manual|recovered)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/i);
  if (match) {
    const [, y, m, d, hh, mm, ss] = match;
    const parsed = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function formatBackupTimestamp(fileName) {
  const parsed = parseBackupTimestamp(fileName);
  return parsed ? parsed.toLocaleString() : "-";
}

function daysSince(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 86400000));
}

function getBackupType(fileName) {
  const name = String(fileName || "").toLowerCase();
  if (name.startsWith("auto_")) return "Auto";
  if (name.startsWith("recovered_")) return "Recovered";
  if (name.startsWith("manual_")) return "Manual";
  return "Manual";
}

function validateBackupSettings(data) {
  const errors = [];
  if (Number(data?.auto_backup?.backup_retention_days || 0) < 1) errors.push("Backup retention must be at least 1 day.");
  if (!String(data?.auto_backup?.local_backup_path || "").trim()) errors.push("Local backup path is required.");
  return errors;
}

function ToggleRow({ label, checked, onChange, hint }) {
  return (
    <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs">
      <div>
        <p className="font-semibold text-slate-200">{label}</p>
        {hint ? <p className="text-[10px] text-slate-500">{hint}</p> : null}
      </div>
      <input type="checkbox" checked={!!checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

export default function Backup() {
  const { toast, confirm } = useFeedback();
  const { data, setData, loading } = useFetch("/backup");
  const createPermission = usePermissionUI("backup.create", "Your role cannot create or trigger backups.");
  const restorePermission = usePermissionUI("backup.restore", "Your role cannot request, approve, execute, or clean up restore workflows.");
  const exportPermission = usePermissionUI("backup.export", "Your role cannot export backup data.");
  const settingsPermission = usePermissionUI("settings.edit", "Your role cannot edit backup policy settings.");

  const [lastAt, setLastAt] = useState(null);
  const [schedulerStatus, setSchedulerStatus] = useState(null);
  const [schedulerLoading, setSchedulerLoading] = useState(false);

  const [backupSettings, setBackupSettings] = useState(DEFAULT_BACKUP_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [restoreChecked, setRestoreChecked] = useState(false);
  const [restoreFile, setRestoreFile] = useState("");
  const [restoreReason, setRestoreReason] = useState("");
  const [restoreDecisionNote, setRestoreDecisionNote] = useState("");
  const [restoreRequests, setRestoreRequests] = useState([]);
  const [restoreRequestsLoading, setRestoreRequestsLoading] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [dangerConfirm, setDangerConfirm] = useState("");
  const [cleanupDryRun, setCleanupDryRun] = useState(true);
  const [cleanupResult, setCleanupResult] = useState(null);
  const [activeSection, setActiveSection] = useState("history");

  const files = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const errors = useMemo(() => validateBackupSettings(backupSettings), [backupSettings]);
  const pendingRestoreRequests = useMemo(
    () => restoreRequests.filter((row) => row.status === "Pending Approval"),
    [restoreRequests]
  );
  const latestAgeDays = useMemo(() => daysSince(lastAt), [lastAt]);
  const latestTone = !lastAt ? "red" : latestAgeDays <= 1 ? "green" : latestAgeDays <= 3 ? "amber" : "red";

  const stats = useMemo(() => {
    const auto = files.filter((f) => String(f).startsWith("auto_")).length;
    const manual = files.filter((f) => String(f).startsWith("manual_")).length;
    const recovered = files.filter((f) => String(f).startsWith("recovered_")).length;
    return { total: files.length, auto, manual, recovered };
  }, [files]);

  useEffect(() => {
    if (!restoreFile && files.length > 0) setRestoreFile(files[0]);
    if (restoreFile && !files.includes(restoreFile)) setRestoreFile(files[0] || "");
  }, [files, restoreFile]);

  const loadLastBackup = async () => {
    try {
      const res = await api.get("/backup/last");
      setLastAt(res.data?.last_backup_at || null);
    } catch {
      setLastAt(null);
    }
  };

  const loadSchedulerStatus = async () => {
    setSchedulerLoading(true);
    try {
      const res = await api.get("/backup/scheduler/status");
      setSchedulerStatus(res.data || null);
    } catch {
      setSchedulerStatus({ enabled: false, reason: "Unavailable" });
    } finally {
      setSchedulerLoading(false);
    }
  };

  const loadBackupSettings = async () => {
    setSettingsLoading(true);
    try {
      const res = await api.get("/settings/section/backup_data");
      setBackupSettings(deepMergeDefaults(DEFAULT_BACKUP_SETTINGS, res.data || {}));
    } catch {
      setBackupSettings(clone(DEFAULT_BACKUP_SETTINGS));
    } finally {
      setSettingsLoading(false);
    }
  };

  const loadRestoreRequests = async () => {
    setRestoreRequestsLoading(true);
    try {
      const res = await api.get("/backup/restore/requests");
      setRestoreRequests(Array.isArray(res.data) ? res.data : []);
    } catch {
      setRestoreRequests([]);
    } finally {
      setRestoreRequestsLoading(false);
    }
  };

  const refreshBackups = async () => {
    try {
      const list = await api.get("/backup");
      setData(Array.isArray(list.data) ? list.data : []);
    } catch {
      toast("Failed to refresh backup list", "error");
    }
    await loadLastBackup();
  };

  useEffect(() => {
    loadLastBackup();
    loadSchedulerStatus();
    loadBackupSettings();
    loadRestoreRequests();
  }, []);

  const updateSetting = (path, value) => {
    setBackupSettings((prev) => {
      const next = clone(prev);
      setByPath(next, path, value);
      return next;
    });
  };

  const saveBackupSettings = async () => {
    if (errors.length > 0) {
      toast("Please resolve backup settings validation issues before saving.", "warning");
      return;
    }
    setSettingsSaving(true);
    try {
      const res = await api.put("/settings/section/backup_data", backupSettings);
      setBackupSettings(deepMergeDefaults(DEFAULT_BACKUP_SETTINGS, res.data || backupSettings));
      toast("Backup policy saved", "success");
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to save backup settings", "error");
    } finally {
      setSettingsSaving(false);
    }
  };

  const createBackup = async () => {
    try {
      await api.post("/backup/create?is_auto=false");
      await refreshBackups();
      toast("Manual snapshot created successfully", "success");
    } catch {
      toast("Backup creation failed", "error");
    }
  };

  const triggerScheduledBackupNow = async () => {
    try {
      await api.post("/backup/scheduler/trigger-now");
      await refreshBackups();
      toast("Scheduled backup job triggered", "success");
    } catch {
      toast("Failed to trigger scheduled backup", "error");
    }
  };

  const submitRestoreRequest = async (filename) => {
    if (!restoreChecked) {
      toast("Please confirm the restore acknowledgment first.", "warning");
      return;
    }
    const ok = await confirm("Submit Restore Request", `Create restore request for ${filename}?`);
    if (!ok) return;
    try {
      setRestoreBusy(true);
      await api.post("/backup/restore/request", {
        filename,
        reason: restoreReason || "",
      });
      toast("Restore request submitted for approval.", "success");
      await loadRestoreRequests();
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to submit restore request", "error");
    } finally {
      setRestoreBusy(false);
    }
  };

  const approveRestoreRequest = async (requestId) => {
    try {
      setRestoreBusy(true);
      await api.post(`/backup/restore/requests/${requestId}/approve`, { note: restoreDecisionNote || "" });
      toast("Restore request approved.", "success");
      await loadRestoreRequests();
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to approve restore request", "error");
    } finally {
      setRestoreBusy(false);
    }
  };

  const rejectRestoreRequest = async (requestId) => {
    try {
      setRestoreBusy(true);
      await api.post(`/backup/restore/requests/${requestId}/reject`, { note: restoreDecisionNote || "" });
      toast("Restore request rejected.", "warning");
      await loadRestoreRequests();
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to reject restore request", "error");
    } finally {
      setRestoreBusy(false);
    }
  };

  const executeRestoreRequest = async (requestId) => {
    const ok = await confirm("Execute Approved Restore", "Execute this approved restore request now?");
    if (!ok) return;
    try {
      setRestoreBusy(true);
      await api.post(`/backup/restore/requests/${requestId}/execute`);
      toast("Restore executed. Please restart the application.", "success");
      await Promise.all([loadRestoreRequests(), refreshBackups()]);
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to execute restore request", "error");
    } finally {
      setRestoreBusy(false);
    }
  };

  const exportSystemData = async () => {
    try {
      const payload = { ...(backupSettings?.data_export || {}) };
      const response = await api.post("/backup/export-data", payload, { responseType: "blob" });

      const disposition = response.headers["content-disposition"] || "";
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || `system_export_${Date.now()}`;

      const blob = new Blob([response.data], { type: response.headers["content-type"] || "application/octet-stream" });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);

      toast(`Export ready: ${filename}`, "success");
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to export data", "error");
    }
  };

  const statusTone = (status) => {
    const value = String(status || "").toLowerCase();
    if (value.includes("approved")) return "green";
    if (value.includes("executed")) return "indigo";
    if (value.includes("rejected") || value.includes("failed")) return "red";
    return "amber";
  };

  const runCleanup = async () => {
    if (dangerConfirm !== "CONFIRM") {
      toast("Type CONFIRM to unlock cleanup actions.", "warning");
      return;
    }
    const ok = await confirm("Run Data Cleanup", cleanupDryRun ? "Preview cleanup changes without deleting records?" : "Execute cleanup now? This will audit the action.");
    if (!ok) return;
    try {
      const { data } = await api.post("/backup/cleanup", {
        dry_run: cleanupDryRun,
        keep_latest_verified: true,
        targets: ["missing_backup_records", "failed_restore_requests", "expired_export_history"],
      });
      setCleanupResult(data);
      toast(cleanupDryRun ? "Cleanup dry run completed." : "Cleanup completed and audited.", cleanupDryRun ? "warning" : "success");
      await refreshBackups();
      await loadRestoreRequests();
    } catch (error) {
      toast(error.response?.data?.detail || "Cleanup failed", "error");
    }
  };

  if (loading) return <Loading text="Loading backup archives..." />;

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pb-4 xl:h-full xl:overflow-hidden">
      <div className="flex flex-wrap justify-between items-end gap-3 shrink-0">
        <div>
          <h1 className="text-xl font-black tracking-tight text-white flex items-center gap-3">
            <Server className="text-emerald-400" /> Backup Center
          </h1>
          <p className="text-xs text-slate-400 mt-1">Unified backup, restore, export, and retention controls for offline-first operations.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={async () => { await refreshBackups(); await loadSchedulerStatus(); await loadRestoreRequests(); }}>
            <RefreshCw size={13} /> Refresh
          </Button>
          <Button size="sm" onClick={createBackup} disabled={createPermission.disabled} title={createPermission.reason || undefined}>
            <HardDrive size={13} /> Generate Manual Snapshot
          </Button>
          <Button size="sm" onClick={saveBackupSettings} disabled={settingsPermission.disabled || settingsSaving || settingsLoading} title={settingsPermission.reason || undefined}>
            <Database size={13} /> {settingsSaving ? "Saving..." : "Save Backup Policy"}
          </Button>
        </div>
      </div>

      <WorkstationNotice
        tone={backupSettings?.auto_backup?.encrypt_backup_files ? "green" : "red"}
        title={backupSettings?.auto_backup?.encrypt_backup_files ? "Backup encryption is enabled" : "Backup encryption is disabled"}
        text="Production restores must go through the approval queue. Direct restore controls stay out of the live workflow."
        right={<div className="flex flex-wrap items-center gap-2"><SensitiveActionIndicators items={["approval", "owner", "audit"]} /><Badge tone={pendingRestoreRequests.length ? "amber" : "green"}>{pendingRestoreRequests.length} pending restore request(s)</Badge></div>}
      />

      <div className="grid grid-cols-1 gap-3 shrink-0 lg:grid-cols-3">
        <SectionCard
          title="Encryption Status"
          subtitle={backupSettings?.auto_backup?.encrypt_backup_files ? "Snapshots are marked for encryption" : "Enable encryption before production restore"}
          className={backupSettings?.auto_backup?.encrypt_backup_files ? "border-emerald-400/20 bg-emerald-500/5" : "border-rose-400/25 bg-rose-500/10"}
          right={<Badge tone={backupSettings?.auto_backup?.encrypt_backup_files ? "green" : "red"}>{backupSettings?.auto_backup?.encrypt_backup_files ? "Enabled" : "Disabled"}</Badge>}
        >
          <p className="text-xs text-slate-400">Compression, retention, and passphrase policy remain controlled in Backup Policy.</p>
        </SectionCard>
        <SectionCard
          title="Last Backup / Verified"
          subtitle={lastAt ? new Date(lastAt).toLocaleString() : "No successful checkpoint recorded"}
          className="border-white/10 bg-slate-900/60"
          right={<Badge tone={latestTone}>{lastAt ? `${latestAgeDays ?? 0}d old` : "Missing"}</Badge>}
        >
          <p className="text-xs text-slate-400">{lastAt ? "Use Backup History to request a restore from a known snapshot." : "Generate a manual snapshot before any risky maintenance."}</p>
        </SectionCard>
        <SectionCard
          title="Restore Queue"
          subtitle="Approval-first execution"
          className={pendingRestoreRequests.length ? "border-amber-400/25 bg-amber-500/10" : "border-white/10 bg-slate-900/60"}
          right={<Badge tone={pendingRestoreRequests.length ? "amber" : "green"}>{pendingRestoreRequests.length} waiting</Badge>}
        >
          <p className="text-xs text-slate-400">Requests move through approval, decision note, and final execute controls.</p>
        </SectionCard>
      </div>

      <div className="grid grid-cols-2 gap-2 shrink-0 lg:grid-cols-3 2xl:grid-cols-6">
        <KpiCard tone="sky" title="Local Snapshots" value={String(stats.total)} icon={<Database size={17} />} />
        <KpiCard tone="amber" title="Auto Backups" value={String(stats.auto)} icon={<RotateCcw size={17} />} />
        <KpiCard tone="violet" title="Manual Backups" value={String(stats.manual)} icon={<HardDrive size={17} />} />
        <KpiCard tone="indigo" title="Recovered Copies" value={String(stats.recovered)} icon={<Upload size={17} />} />
        <KpiCard tone="green" title="Latest Checkpoint" value={lastAt ? new Date(lastAt).toLocaleDateString() : "None"} hint={lastAt ? new Date(lastAt).toLocaleTimeString() : "Run one today"} icon={<Cloud size={17} />} />
        <KpiCard tone={schedulerStatus?.enabled ? "green" : "red"} title="Scheduler" value={schedulerStatus?.enabled ? "Active" : "Inactive"} hint={schedulerStatus?.enabled ? (schedulerStatus?.schedule || "Running") : (schedulerStatus?.reason || "Disabled")} icon={<ShieldCheck size={17} />} />
      </div>

      <div className="app-tab-strip flex shrink-0 flex-wrap gap-2 rounded-2xl border border-white/10 bg-slate-900/60 p-2">
        {BACKUP_SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => setActiveSection(section.id)}
            className={`rounded-lg border px-3 py-2 text-[11px] font-black uppercase tracking-wider transition ${
              activeSection === section.id
                ? "border-indigo-400/40 bg-indigo-500/20 text-indigo-100"
                : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
            }`}
          >
            {section.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 pr-1">
        <div className="grid grid-cols-12 gap-4 2xl:gap-6">
          <div className={`${activeSection === "history" ? "col-span-12 xl:col-span-8" : "hidden"}`}>
            <div className="bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
              <div className="p-5 border-b border-white/5 bg-black/20 flex items-center justify-between">
                <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                  <Database size={14} /> Archive History
                </h2>
                <Badge tone="indigo">{files.length} files</Badge>
              </div>
              <AppTableShell minWidth={680} className="rounded-none border-0" aria-label="Backup archive history">
                <AppTableHead>
                  <tr>
                    <th className="px-6 py-4 font-bold">Snapshot File ID</th>
                    <th className="px-6 py-4 font-bold">Created At</th>
                    <th className="px-6 py-4 font-bold">Type</th>
                    <th className="px-6 py-4 font-bold">Status</th>
                    <th className="px-6 py-4 text-right font-bold">Actions</th>
                  </tr>
                </AppTableHead>
                <tbody className="divide-y divide-white/5">
                  {files.map((f) => (
                    <tr key={f} className="hover:bg-white/[0.02] transition-colors group">
                      <td className="px-6 py-4">
                        <span className="font-mono text-xs font-bold text-slate-300 bg-black/40 px-3 py-1.5 rounded-lg border border-white/5 group-hover:text-indigo-300 transition-colors">
                          {f}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-300">{formatBackupTimestamp(f)}</td>
                      <td className="px-6 py-4">
                        <Badge tone={getBackupType(f) === "Auto" ? "amber" : getBackupType(f) === "Recovered" ? "indigo" : "sky"} className="text-[10px] uppercase tracking-wider px-2 py-0.5">
                          {getBackupType(f)}
                        </Badge>
                      </td>
                      <td className="px-6 py-4"><Badge tone="green">Available</Badge></td>
                      <td className="px-6 py-4 text-right">
                        <Button size="sm" variant="warning" disabled={restorePermission.disabled} title={restorePermission.reason || undefined} onClick={() => submitRestoreRequest(f)} className="ml-auto">
                          <RotateCcw size={12} /> Request Restore
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {files.length === 0 && <AppTableEmptyRow colSpan={5} title="No backup archives found" text="Generate a manual snapshot to create the first restore point." />}
                </tbody>
              </AppTableShell>
            </div>
          </div>

          <div className={`${activeSection === "restore" || activeSection === "diagnostics" ? "col-span-12 grid grid-cols-1 gap-4 xl:grid-cols-2" : activeSection === "history" ? "col-span-12 xl:col-span-4 flex flex-col gap-6" : "hidden"}`}>
            <div className={`${activeSection === "diagnostics" || activeSection === "history" ? "" : "hidden"} bg-emerald-500/5 border border-emerald-500/20 backdrop-blur-md rounded-3xl p-6 shadow-[0_0_40px_rgba(16,185,129,0.05)]`}>
              <h3 className="text-xs font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2 mb-4">
                <ShieldCheck size={16} /> Runtime Protection
              </h3>
              <div className="space-y-3">
                <div className="p-4 bg-black/20 border border-white/5 rounded-2xl">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Latest Successful Backup</p>
                  <p className="text-sm font-black text-slate-200">{lastAt ? new Date(lastAt).toLocaleString() : "No record"}</p>
                </div>
                <div className="p-4 bg-black/20 border border-white/5 rounded-2xl">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Scheduler Status</p>
                  {schedulerLoading ? (
                    <p className="text-xs text-slate-400">Checking scheduler...</p>
                  ) : (
                    <p className={`text-sm font-black ${schedulerStatus?.enabled ? "text-emerald-300" : "text-rose-300"}`}>
                      {schedulerStatus?.enabled ? "Active" : `Inactive - ${schedulerStatus?.reason || "unknown"}`}
                    </p>
                  )}
                  {schedulerStatus?.enabled ? (
                    <p className="text-[11px] text-slate-400 mt-1">{schedulerStatus?.schedule || "Scheduled"}</p>
                  ) : null}
                </div>
                <Button size="sm" variant="secondary" disabled={createPermission.disabled} title={createPermission.reason || undefined} onClick={triggerScheduledBackupNow}>
                  <RotateCcw size={13} /> Trigger Scheduled Backup Now
                </Button>
              </div>
            </div>

            <SectionCard title="Data Restore" subtitle="Safety-first restore execution" className={`${activeSection === "restore" ? "" : "hidden"} bg-slate-900/60 border border-white/10 rounded-2xl`}>
              <div className="space-y-3">
                <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-xs text-amber-100">
                  <p className="font-black uppercase tracking-widest">Restore request gate</p>
                  <p className="mt-1 text-amber-200/90">Submit only after selecting a verified snapshot and recording the incident reason.</p>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-400">Select backup file</span>
                  <Select value={restoreFile} onChange={(e) => setRestoreFile(e.target.value)}>
                    {files.length === 0 ? <option value="">No backups available</option> : null}
                    {files.map((file) => <option key={file} value={file}>{file}</option>)}
                  </Select>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input type="checkbox" checked={restoreChecked} onChange={(e) => setRestoreChecked(e.target.checked)} />
                  I understand restore will overwrite current live data (after approval)
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-400">Reason / Incident note</span>
                  <Input value={restoreReason} onChange={(e) => setRestoreReason(e.target.value)} placeholder="Why restore is needed..." />
                </label>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={restorePermission.disabled || !restoreChecked || !restoreFile || restoreBusy}
                  title={restorePermission.reason || undefined}
                  onClick={() => submitRestoreRequest(restoreFile)}
                >
                  <Upload size={13} /> Submit Restore Request
                </Button>
              </div>
            </SectionCard>

            <div className={activeSection === "restore" ? "" : "hidden"}>
            <SectionCard title="Restore Approval Queue" subtitle="Request -> Approve/Reject -> Execute" className="bg-slate-900/60 border border-white/10 rounded-2xl">
              <div className="space-y-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-400">Decision note (used for approve/reject)</span>
                  <Input value={restoreDecisionNote} onChange={(e) => setRestoreDecisionNote(e.target.value)} placeholder="Optional manager note" />
                </label>
                <AppTableShell minWidth={620} className="max-h-[300px]" aria-label="Restore approval queue">
                  <AppTableHead>
                    <tr>
                      <th className="px-3 py-2 text-left">Request</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">Requested By</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </AppTableHead>
                  <tbody>
                    {restoreRequestsLoading ? <AppTableEmptyRow colSpan={4} title="Loading restore requests" text="Checking the approval queue..." /> : null}
                    {!restoreRequestsLoading && restoreRequests.length === 0 ? <AppTableEmptyRow colSpan={4} title="No restore requests yet" text="Restore requests submitted from Backup History appear here." /> : null}
                    {!restoreRequestsLoading && restoreRequests.map((req) => (
                      <tr key={req.request_id} className="border-t border-white/5">
                        <td className="px-3 py-2">
                          <p className="font-semibold text-slate-200">{req.request_id}</p>
                          <p className="text-[11px] text-slate-400">{req.filename}</p>
                        </td>
                        <td className="px-3 py-2"><Badge tone={statusTone(req.status)}>{req.status}</Badge></td>
                        <td className="px-3 py-2">
                          <p className="text-slate-200">{req.requested_by || "-"}</p>
                          <p className="text-[11px] text-slate-500">{req.requested_at ? new Date(req.requested_at).toLocaleString() : "-"}</p>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            {req.status === "Pending Approval" ? (
                              <>
                                <Button size="sm" variant="secondary" disabled={restorePermission.disabled || restoreBusy} title={restorePermission.reason || undefined} onClick={() => approveRestoreRequest(req.request_id)}>Approve</Button>
                                <Button size="sm" variant="danger" disabled={restorePermission.disabled || restoreBusy} title={restorePermission.reason || undefined} onClick={() => rejectRestoreRequest(req.request_id)}>Reject</Button>
                              </>
                            ) : null}
                            {req.status === "Approved" ? (
                              <Button size="sm" variant="danger" disabled={restorePermission.disabled || restoreBusy} title={restorePermission.reason || undefined} onClick={() => executeRestoreRequest(req.request_id)}>Execute</Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </AppTableShell>
              </div>
            </SectionCard>
            </div>
          </div>

          <div className={`${activeSection === "policy" || activeSection === "danger" ? "col-span-12" : "hidden"}`}>
            <div className={`backdrop-blur-md rounded-2xl p-6 shadow-2xl ${activeSection === "danger" ? "border border-rose-500/35 bg-rose-950/25" : "border border-white/10 bg-slate-900/60"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-300 flex items-center gap-2">
                  <ShieldAlert size={14} /> Backup & Data Policy (Merged From Settings)
                </h3>
                <Badge tone={errors.length ? "red" : "green"}>{errors.length ? `${errors.length} issue(s)` : "Valid configuration"}</Badge>
              </div>

              {errors.length > 0 ? (
                <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-200 mb-4">
                  {errors.map((msg, idx) => <p key={`${msg}-${idx}`}>{msg}</p>)}
                </div>
              ) : null}

              <div className={`grid grid-cols-1 gap-6 ${activeSection === "danger" ? "" : "xl:grid-cols-2"}`}>
                <SectionCard title="Auto Backup Settings" subtitle="Controls for schedule, retention, and storage" className={activeSection === "policy" ? "" : "hidden"}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <ToggleRow label="Enable automatic backup" checked={backupSettings.auto_backup.enable_automatic_backup} onChange={(v) => updateSetting("auto_backup.enable_automatic_backup", v)} />
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Backup frequency</span>
                      <Select value={backupSettings.auto_backup.backup_frequency || "Daily"} onChange={(e) => updateSetting("auto_backup.backup_frequency", e.target.value)}>
                        <option>Daily</option>
                        <option>Weekly</option>
                        <option>Monthly</option>
                      </Select>
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Backup time</span>
                      <Input type="time" value={backupSettings.auto_backup.backup_time || "02:00"} onChange={(e) => updateSetting("auto_backup.backup_time", e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Backup storage</span>
                      <Select value={backupSettings.auto_backup.backup_storage || "Local"} onChange={(e) => updateSetting("auto_backup.backup_storage", e.target.value)}>
                        <option>Local</option>
                        <option>Cloud</option>
                        <option>Both</option>
                      </Select>
                    </label>
                    <label className="flex flex-col gap-1.5 md:col-span-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Local backup path</span>
                      <Input value={backupSettings.auto_backup.local_backup_path || ""} onChange={(e) => updateSetting("auto_backup.local_backup_path", e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Retention period (days)</span>
                      <Input type="number" value={Number(backupSettings.auto_backup.backup_retention_days || 0)} onChange={(e) => updateSetting("auto_backup.backup_retention_days", Number(e.target.value || 0))} />
                    </label>
                    <ToggleRow label="Compress backup files" checked={backupSettings.auto_backup.compress_backup_files} onChange={(v) => updateSetting("auto_backup.compress_backup_files", v)} />
                    <ToggleRow label="Encrypt backup files" checked={backupSettings.auto_backup.encrypt_backup_files} onChange={(v) => updateSetting("auto_backup.encrypt_backup_files", v)} />
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Encryption password</span>
                      <Input type="password" value={backupSettings.auto_backup.encryption_password || ""} onChange={(e) => updateSetting("auto_backup.encryption_password", e.target.value)} />
                      <span className="text-[10px] text-slate-500">Optional. Leave blank if passphrase is managed in server environment.</span>
                    </label>
                    <ToggleRow label="Notify on backup success" checked={backupSettings.auto_backup.notify_on_backup_success} onChange={(v) => updateSetting("auto_backup.notify_on_backup_success", v)} />
                    <ToggleRow label="Notify on backup failure" checked={backupSettings.auto_backup.notify_on_backup_failure} onChange={(v) => updateSetting("auto_backup.notify_on_backup_failure", v)} />
                  </div>
                </SectionCard>

                <div className="space-y-6">
                  <SectionCard title="Data Export" subtitle="Choose entities and export format" className={activeSection === "policy" ? "" : "hidden"}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <ToggleRow label="Products & Inventory" checked={backupSettings.data_export.products_inventory} onChange={(v) => updateSetting("data_export.products_inventory", v)} />
                      <ToggleRow label="Customers" checked={backupSettings.data_export.customers} onChange={(v) => updateSetting("data_export.customers", v)} />
                      <ToggleRow label="Suppliers" checked={backupSettings.data_export.suppliers} onChange={(v) => updateSetting("data_export.suppliers", v)} />
                      <ToggleRow label="Sales Invoices" checked={backupSettings.data_export.sales_invoices} onChange={(v) => updateSetting("data_export.sales_invoices", v)} />
                      <ToggleRow label="Repair Jobs" checked={backupSettings.data_export.repair_jobs} onChange={(v) => updateSetting("data_export.repair_jobs", v)} />
                      <ToggleRow label="Expenses" checked={backupSettings.data_export.expenses} onChange={(v) => updateSetting("data_export.expenses", v)} />
                      <ToggleRow label="Audit Logs" checked={backupSettings.data_export.audit_logs} onChange={(v) => updateSetting("data_export.audit_logs", v)} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 items-end">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Export format</span>
                        <Select value={backupSettings.data_export.format || "CSV"} onChange={(e) => updateSetting("data_export.format", e.target.value)}>
                          <option>CSV</option>
                          <option>JSON</option>
                          <option>Excel</option>
                        </Select>
                      </label>
                      <Button size="sm" variant="secondary" disabled={exportPermission.disabled} title={exportPermission.reason || undefined} onClick={exportSystemData}>
                        <Download size={13} /> Export Data
                      </Button>
                    </div>
                  </SectionCard>

                  <SectionCard
                    title="Danger Zone"
                    subtitle="Restricted cleanup actions"
                    className={activeSection === "danger" ? "border-rose-500/40 bg-rose-950/30" : "hidden"}
                    right={<SensitiveActionIndicators items={["owner", "audit", "confirmation"]} />}
                  >
                    <div className="mb-3 rounded-xl border border-rose-400/35 bg-rose-600/10 p-3 text-xs text-rose-100">
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose-300" />
                        <div>
                          <p className="font-black uppercase tracking-widest">Isolated destructive workflow</p>
                          <p className="mt-1 text-rose-200/90">These actions stay separated from backup creation and restore requests. Latest verified backup metadata is protected.</p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-rose-400/35 bg-rose-600/10 p-3">
                      <p className="text-sm font-semibold text-rose-200">Manager/Owner only</p>
                      <p className="text-xs text-rose-300 mt-1">Type CONFIRM to unlock cleanup actions.</p>
                      <Input className="mt-2" value={dangerConfirm} onChange={(e) => setDangerConfirm(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Clear old audit logs</span>
                        <Select value={backupSettings.data_cleanup.clear_old_audit_logs_older_than || "1 year"} onChange={(e) => updateSetting("data_cleanup.clear_old_audit_logs_older_than", e.target.value)}>
                          <option>6 months</option>
                          <option>1 year</option>
                          <option>2 years</option>
                        </Select>
                      </label>
                      <ToggleRow label="Purge deleted records" checked={backupSettings.data_cleanup.purge_deleted_records_enabled} onChange={(v) => updateSetting("data_cleanup.purge_deleted_records_enabled", v)} />
                      <ToggleRow label="Reset demo data" checked={backupSettings.data_cleanup.reset_demo_data_enabled} onChange={(v) => updateSetting("data_cleanup.reset_demo_data_enabled", v)} />
                      <ToggleRow label="Factory reset mode" checked={backupSettings.data_cleanup.factory_reset_enabled} onChange={(v) => updateSetting("data_cleanup.factory_reset_enabled", v)} />
                      <ToggleRow label="Dry run only" checked={cleanupDryRun} onChange={setCleanupDryRun} />
                    </div>
                    {cleanupResult ? (
                      <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
                        <p className="font-black uppercase tracking-widest text-slate-400">{cleanupResult.dry_run ? "Dry Run Result" : "Execution Result"}</p>
                        {Object.entries(cleanupResult.targets || {}).map(([key, value]) => (
                          <p key={key} className="mt-1">
                            {key.replaceAll("_", " ")}: checked {value.checked ?? 0}, removed {value.removed ?? 0}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-3">
                      <Button size="sm" variant="danger" disabled={restorePermission.disabled || dangerConfirm !== "CONFIRM"} title={restorePermission.reason || undefined} onClick={runCleanup}>
                        <ShieldAlert size={13} /> {cleanupDryRun ? "Preview Cleanup" : "Run Cleanup"}
                      </Button>
                    </div>
                  </SectionCard>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
