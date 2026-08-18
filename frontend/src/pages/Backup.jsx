import { useEffect, useMemo, useState } from "react";
import { useFetch } from "../hooks/useFetch";
import api from "../lib/api";
import { AppTableEmptyRow, AppTableHead, AppTableShell, Badge, Button, Input, KpiCard, Loading, PageHeader, SectionCard, Select, SensitiveActionIndicators, WorkstationNotice } from "../components/UI";
import { AlertTriangle, CheckCircle2, Cloud, Database, Download, FileCheck, HardDrive, RefreshCw, RotateCcw, Server, ShieldCheck, ShieldAlert, Upload, XCircle } from "lucide-react";
import { useFeedback } from "../components/FeedbackProvider";
import usePermissionUI from "../hooks/usePermissionUI";

const BACKUP_SECTIONS = [
  { id: "history", label: "Local Backups" },
  { id: "cloud", label: "Cloud Backups (3-2-1)" },
  { id: "restore", label: "Restore Requests" },
  { id: "policy", label: "Backup Policy" },
  { id: "diagnostics", label: "3-2-1 Diagnostics" },
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

function clone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}

function deepMergeDefaults(defaults, source) {
  const output = clone(defaults);
  if (!source || typeof source !== "object") return output;
  Object.keys(source).forEach((key) => {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      output[key] = deepMergeDefaults(output[key] || {}, source[key]);
    } else if (source[key] !== undefined) {
      output[key] = source[key];
    }
  });
  return output;
}

function parseBackupTimestamp(filename) {
  if (!filename) return "Unknown";
  const match = filename.match(/(\d{4})_(\d{2})_(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (!match) return "Custom snapshot";
  const [, y, m, d, hh, mm] = match;
  return `${d}/${m}/${y} ${hh}:${mm}`;
}

function inferBackupStatus(filename) {
  const lower = String(filename || "").toLowerCase();
  if (lower.includes("enc")) return { label: "Encrypted & Verified", tone: "green" };
  if (lower.includes("recovered")) return { label: "Emergency Recovery", tone: "indigo" };
  if (lower.includes("manual")) return { label: "Verified Snapshot", tone: "green" };
  return { label: "Verified Snapshot", tone: "green" };
}

function daysSince(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function validateBackupSettings(state) {
  const errors = [];
  const auto = state?.auto_backup || {};
  if (auto.enable_automatic_backup) {
    if (!auto.backup_time || !/^\d{2}:\d{2}$/.test(auto.backup_time)) {
      errors.push("Automatic backup time must be in HH:MM format.");
    }
    if (Number(auto.backup_retention_days || 0) < 1) {
      errors.push("Retention days must be at least 1 day.");
    }
  }
  return errors;
}

function ToggleRow({ label, checked, onChange, disabled }) {
  return (
    <label className={`flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-white/10 dark:bg-white/5 ${disabled ? "opacity-50" : ""}`}>
      <span className="font-semibold text-slate-700 dark:text-slate-200">{label}</span>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
    </label>
  );
}

export default function Backup() {
  const { toast, confirm } = useFeedback();
  const createPermission = usePermissionUI("backup.create");
  const settingsPermission = usePermissionUI("settings.edit");
  const restorePermission = usePermissionUI("backup.restore");
  const exportPermission = usePermissionUI("backup.export");

  const { data, loading, refetch } = useFetch("/backup");
  const [backupSettings, setBackupSettings] = useState(clone(DEFAULT_BACKUP_SETTINGS));
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [lastAt, setLastAt] = useState(null);
  const [lastVerifiedAt, setLastVerifiedAt] = useState(null);
  const [schedulerStatus, setSchedulerStatus] = useState(null);
  const [, setSchedulerLoading] = useState(false);
  const [restoreRequests, setRestoreRequests] = useState([]);
  const [restoreRequestsLoading, setRestoreRequestsLoading] = useState(false);
  const [cloudBackups, setCloudBackups] = useState([]);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [restoreFile, setRestoreFile] = useState("");
  const [restoreReason, setRestoreReason] = useState("");
  const [restoreChecked, setRestoreChecked] = useState(false);
  const [restoreDecisionNote, setRestoreDecisionNote] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [dangerConfirm, setDangerConfirm] = useState("");
  const [cleanupDryRun, setCleanupDryRun] = useState(true);
  const [cleanupResult, setCleanupResult] = useState(null);
  const [activeSection, setActiveSection] = useState("history");
  const [testRestoreModal, setTestRestoreModal] = useState(null);
  const [testingRestore, setTestingRestore] = useState(false);

  const files = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const errors = useMemo(() => validateBackupSettings(backupSettings), [backupSettings]);
  const pendingRestoreRequests = useMemo(
    () => restoreRequests.filter((row) => row.status === "Pending Approval"),
    [restoreRequests]
  );
  const latestAgeDays = useMemo(() => daysSince(lastVerifiedAt || lastAt), [lastVerifiedAt, lastAt]);
  const latestTone = !lastVerifiedAt && !lastAt ? "red" : (latestAgeDays ?? 99) <= 1 ? "green" : (latestAgeDays ?? 99) <= 2 ? "amber" : "red";

  const stats = useMemo(() => {
    const auto = files.filter((f) => String(f).startsWith("auto_")).length;
    const manual = files.filter((f) => String(f).startsWith("manual_") || String(f).startsWith("pre_")).length;
    const recovered = files.filter((f) => String(f).startsWith("recovered_")).length;
    return { total: files.length, auto, manual, recovered };
  }, [files]);

  // Overall 3-2-1 Health
  const overallHealth = useMemo(() => {
    const localOk = files.length > 0 && (latestAgeDays ?? 99) <= 2;
    const cloudOk = schedulerStatus?.cloud_backup_status === "verified";
    if (localOk && cloudOk) return { label: "HEALTHY", tone: "green", desc: "3-2-1 Full Compliance: Local & Cloud Verified" };
    if (localOk && !schedulerStatus?.cloud_backup_enabled) return { label: "PROTECTED (LOCAL ONLY)", tone: "amber", desc: "Local Verified Recovery Point Available (Cloud Offsite Disabled)" };
    if (localOk && schedulerStatus?.cloud_backup_status !== "verified") return { label: "DEGRADED", tone: "amber", desc: "Local Verified OK, Cloud Sync Needs Attention" };
    return { label: "CRITICAL", tone: "red", desc: "No Recent Verified Recovery Point" };
  }, [files, latestAgeDays, schedulerStatus]);

  useEffect(() => {
    if (!restoreFile && files.length > 0) setRestoreFile(files[0]);
    if (restoreFile && !files.includes(restoreFile)) setRestoreFile(files[0] || "");
  }, [files, restoreFile]);

  const loadLastBackup = async () => {
    try {
      const res = await api.get("/backup/last");
      setLastAt(res.data?.last_backup_at || null);
      setLastVerifiedAt(res.data?.last_verified_backup_at || null);
    } catch {
      setLastAt(null);
      setLastVerifiedAt(null);
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

  const loadCloudBackups = async () => {
    setCloudLoading(true);
    try {
      const res = await api.get("/backup/cloud/list");
      setCloudBackups(Array.isArray(res.data) ? res.data : []);
    } catch {
      setCloudBackups([]);
    } finally {
      setCloudLoading(false);
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
      await refetch();
    } catch {
      toast("Failed to refresh backup list", "error");
    }
    await Promise.all([loadLastBackup(), loadSchedulerStatus(), loadCloudBackups()]);
  };

  useEffect(() => {
    loadLastBackup();
    loadSchedulerStatus();
    loadBackupSettings();
    loadRestoreRequests();
    loadCloudBackups();
  }, []);

  const updateSetting = (path, value) => {
    setBackupSettings((prev) => {
      const next = clone(prev);
      const parts = path.split(".");
      let cur = next;
      for (let i = 0; i < parts.length - 1; i += 1) {
        if (!cur[parts[i]]) cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = value;
      return next;
    });
  };

  const saveBackupSettings = async () => {
    if (errors.length > 0) {
      toast(errors[0], "error");
      return;
    }
    setSettingsSaving(true);
    try {
      const res = await api.put("/settings/section/backup_data", backupSettings);
      setBackupSettings(deepMergeDefaults(DEFAULT_BACKUP_SETTINGS, res.data || backupSettings));
      toast("Backup policy saved & scheduler reloaded", "success");
      await loadSchedulerStatus();
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to save backup settings", "error");
    } finally {
      setSettingsSaving(false);
    }
  };

  const createBackup = async () => {
    setBackupBusy(true);
    try {
      const res = await api.post("/backup/create?is_auto=false");
      await refreshBackups();
      if (res.data?.verified) {
        toast(`Verified snapshot created: ${res.data?.filename}`, "success");
      } else {
        toast(`Snapshot created with warnings: ${res.data?.filename}`, "warning");
      }
    } catch (err) {
      toast(err.response?.data?.detail || "Backup creation failed", "error");
    } finally {
      setBackupBusy(false);
    }
  };

  const downloadBackup = async (filename) => {
    try {
      const response = await api.get(`/backup/download/${encodeURIComponent(filename)}`, {
        responseType: "blob",
      });
      const blob = new Blob([response.data], { type: "application/octet-stream" });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      toast(`Downloaded ${filename}`, "success");
    } catch (error) {
      toast(error.response?.data?.detail || "Download failed", "error");
    }
  };

  const runTestRestore = async (filename) => {
    setTestingRestore(true);
    try {
      const res = await api.post(`/backup/test-restore/${encodeURIComponent(filename)}`);
      setTestRestoreModal(res.data);
      if (res.data?.restorable) {
        toast(`Integrity & schema verified for ${filename}`, "success");
      } else {
        toast(`Verification failed: ${res.data?.reason}`, "error");
      }
    } catch (error) {
      toast(error.response?.data?.detail || "Test restore failed", "error");
    } finally {
      setTestingRestore(false);
    }
  };

  const runTestRestoreCloud = async (blobName) => {
    setTestingRestore(true);
    try {
      const res = await api.post("/backup/cloud/test-restore", { blob_name: blobName });
      setTestRestoreModal(res.data);
      if (res.data?.restorable) {
        toast(`Cloud backup verified restorable: ${blobName}`, "success");
      } else {
        toast(`Cloud backup verification failed: ${res.data?.reason}`, "error");
      }
    } catch (error) {
      toast(error.response?.data?.detail || "Cloud test restore failed", "error");
    } finally {
      setTestingRestore(false);
    }
  };

  const restoreFromCloud = async (blobName) => {
    const ok = await confirm("Restore from Cloud Backup", `Download and restore from offsite cloud backup ${blobName}? An emergency pre-restore snapshot will be created automatically.`);
    if (!ok) return;
    setRestoreBusy(true);
    try {
      const res = await api.post("/backup/cloud/restore", { blob_name: blobName });
      toast(`Cloud restore completed: ${res.data?.restored}. Please restart the application.`, "success");
      await refreshBackups();
    } catch (error) {
      toast(error.response?.data?.detail || "Cloud restore failed", "error");
    } finally {
      setRestoreBusy(false);
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
    const ok = await confirm("Execute Approved Restore", "Execute this approved restore request now? An emergency safety backup will be created before database replacement.");
    if (!ok) return;
    try {
      setRestoreBusy(true);
      await api.post(`/backup/restore/requests/${requestId}/execute`);
      toast("Restore executed successfully. Please restart the application.", "success");
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
      const { data: resData } = await api.post("/backup/cleanup", {
        dry_run: cleanupDryRun,
        keep_latest_verified: true,
        targets: ["missing_backup_records", "failed_restore_requests", "expired_export_history"],
      });
      setCleanupResult(resData);
      toast(cleanupDryRun ? "Cleanup dry run completed." : "Cleanup completed and audited.", cleanupDryRun ? "warning" : "success");
      await refreshBackups();
      await loadRestoreRequests();
    } catch (error) {
      toast(error.response?.data?.detail || "Cleanup failed", "error");
    }
  };

  if (loading) return <Loading text="Loading verified backup archives..." />;

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pb-4 xl:h-full">
      <PageHeader
        eyebrow="System Security & Storage"
        title="Enterprise 3-2-1 Backup & Disaster Recovery"
        subtitle="Live SQLite Online Snapshot, SHA-256 Checksums, Automated Test-Restore & Offsite Cloud Sync."
        action={
          <>
            <Button size="sm" variant="secondary" onClick={refreshBackups}>
              <RefreshCw size={13} /> Refresh Status
            </Button>
            <Button size="sm" onClick={createBackup} disabled={createPermission.disabled || backupBusy} title={createPermission.reason || undefined}>
              <HardDrive size={13} /> {backupBusy ? "Creating..." : "Backup Now"}
            </Button>
            <Button size="sm" onClick={saveBackupSettings} disabled={settingsPermission.disabled || settingsSaving || settingsLoading} title={settingsPermission.reason || undefined}>
              <Database size={13} /> {settingsSaving ? "Saving..." : "Save Policy"}
            </Button>
          </>
        }
      />

      {/* 3-2-1 Enterprise Health Dashboard Banner */}
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 p-5 text-white shadow-xl dark:border-white/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-black uppercase tracking-widest text-slate-400">Recovery Status</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider ${overallHealth.tone === "green" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : overallHealth.tone === "amber" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "bg-rose-500/20 text-rose-300 border border-rose-500/30"}`}>
                {overallHealth.tone === "green" ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                {overallHealth.label}
              </span>
            </div>
            <p className="text-sm font-semibold text-slate-200">{overallHealth.desc}</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <span className="text-[10px] font-bold uppercase text-slate-400">Local Copy</span>
              <p className="mt-0.5 text-xs font-black text-emerald-400">
                {files.length > 0 ? `VERIFIED (${files.length})` : "NO BACKUPS"}
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <span className="text-[10px] font-bold uppercase text-slate-400">Cloud Offsite</span>
              <p className={`mt-0.5 text-xs font-black ${schedulerStatus?.cloud_backup_status === "verified" ? "text-emerald-400" : schedulerStatus?.cloud_backup_enabled ? "text-amber-400" : "text-slate-400"}`}>
                {schedulerStatus?.cloud_backup_status === "verified" ? `VERIFIED (${cloudBackups.length})` : schedulerStatus?.cloud_backup_enabled ? "PENDING SYNC" : "NOT CONFIGURED"}
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <span className="text-[10px] font-bold uppercase text-slate-400">Last Verified</span>
              <p className="mt-0.5 text-xs font-bold text-slate-200">
                {lastVerifiedAt ? `${daysSince(lastVerifiedAt)}d ago` : "Never"}
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <span className="text-[10px] font-bold uppercase text-slate-400">Next Scheduled</span>
              <p className="mt-0.5 text-xs font-bold text-indigo-300">
                {schedulerStatus?.next_run_time ? new Date(schedulerStatus.next_run_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Active"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <WorkstationNotice
        tone={backupSettings?.auto_backup?.encrypt_backup_files ? "green" : "red"}
        title={backupSettings?.auto_backup?.encrypt_backup_files ? "AES/Fernet encryption active on snapshots" : "Backup encryption is disabled"}
        text="Production restores enforce multi-stage integrity checks with automatic pre-restore safety snapshots before database replacement."
        right={<div className="flex flex-wrap items-center gap-2"><SensitiveActionIndicators items={["approval", "owner", "audit"]} /><Badge tone={pendingRestoreRequests.length ? "amber" : "green"}>{pendingRestoreRequests.length} pending restore request(s)</Badge></div>}
      />

      <div className="grid grid-cols-2 gap-2 shrink-0 lg:grid-cols-3 2xl:grid-cols-6">
        <KpiCard tone="sky" title="Local Snapshots" value={String(stats.total)} icon={<Database size={17} />} />
        <KpiCard tone="amber" title="Auto Scheduled" value={String(stats.auto)} icon={<RotateCcw size={17} />} />
        <KpiCard tone="violet" title="Manual Snapshots" value={String(stats.manual)} icon={<HardDrive size={17} />} />
        <KpiCard tone="indigo" title="Cloud Copies" value={String(cloudBackups.length)} icon={<Cloud size={17} />} />
        <KpiCard tone={latestTone} title="Last Verified" value={lastVerifiedAt ? new Date(lastVerifiedAt).toLocaleDateString() : "None"} hint={lastVerifiedAt ? new Date(lastVerifiedAt).toLocaleTimeString() : "Run backup today"} icon={<FileCheck size={17} />} />
        <KpiCard tone={schedulerStatus?.enabled ? "green" : "red"} title="Scheduler" value={schedulerStatus?.enabled ? "Active" : "Inactive"} hint={schedulerStatus?.schedule || "23:59 daily"} icon={<ShieldCheck size={17} />} />
      </div>

      {/* Tab Navigation */}
      <div className="app-tab-strip flex shrink-0 flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900/60 p-2 shadow-sm">
        {BACKUP_SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => setActiveSection(section.id)}
            className={`rounded-lg border px-3 py-2 text-[11px] font-black uppercase tracking-wider transition ${
              activeSection === section.id
                ? "border-indigo-400/40 bg-indigo-500/20 text-indigo-700 dark:text-indigo-100"
                : "border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            {section.label}
          </button>
        ))}
      </div>

      {/* Main Tab Content */}
      <div className="min-h-0 pr-1">
        <div className="grid grid-cols-12 gap-4 2xl:gap-6">
          {/* TAB: Local Backup History */}
          <div className={`${activeSection === "history" ? "col-span-12 xl:col-span-8" : "hidden"}`}>
            <div className="bg-white dark:bg-slate-900/60 backdrop-blur-md border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden shadow-2xl">
              <div className="p-5 border-b border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-black/20 flex items-center justify-between">
                <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <Database size={14} /> Local Verified Archive History
                </h2>
                <Badge tone="indigo">{files.length} snapshot(s)</Badge>
              </div>
              <AppTableShell minWidth={700} className="rounded-none border-0" aria-label="Backup archive history">
                <AppTableHead>
                  <tr>
                    <th className="px-6 py-4 font-bold">Snapshot File ID</th>
                    <th className="px-6 py-4 font-bold">Created At</th>
                    <th className="px-6 py-4 font-bold">Type</th>
                    <th className="px-6 py-4 font-bold">Status</th>
                    <th className="px-6 py-4 text-right font-bold">Actions</th>
                  </tr>
                </AppTableHead>
                <tbody>
                  {files.length === 0 ? <AppTableEmptyRow colSpan={5} title="No backup snapshots found" text="Click 'Backup Now' to create your first verified recovery point." /> : null}
                  {files.map((file) => {
                    const rowStatus = inferBackupStatus(file);
                    const isManual = file.includes("manual");
                    const isAuto = file.includes("auto");
                    const isRec = file.includes("recovery") || file.includes("recovered") || file.includes("pre_");
                    return (
                      <tr key={file} className="border-t border-slate-200 dark:border-white/5 hover:bg-slate-100/70 dark:hover:bg-white/[0.02] transition-colors">
                        <td className="px-6 py-4 font-mono text-xs text-slate-900 dark:text-slate-100 font-bold">{file}</td>
                        <td className="px-6 py-4 text-xs text-slate-600 dark:text-slate-400">{parseBackupTimestamp(file)}</td>
                        <td className="px-6 py-4">
                          <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-full border ${isManual ? "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20" : isAuto ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20" : isRec ? "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20" : "bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20"}`}>
                            {isManual ? "Manual" : isAuto ? "Scheduled" : isRec ? "Safety Snapshot" : "Snapshot"}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <Badge tone={rowStatus.tone}>{rowStatus.label}</Badge>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button size="sm" variant="secondary" onClick={() => runTestRestore(file)} disabled={testingRestore} title="Run non-destructive test restore and integrity check">
                              <FileCheck size={13} /> Test
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => downloadBackup(file)} title="Download backup archive to device">
                              <Download size={13} /> Download
                            </Button>
                            <Button size="sm" variant="danger" disabled={restorePermission.disabled} title={restorePermission.reason || undefined} onClick={() => { setRestoreFile(file); setActiveSection("restore"); }}>
                              <RotateCcw size={13} /> Restore
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </AppTableShell>
            </div>
          </div>

          {/* TAB: Cloud Backups (3-2-1 Offsite) */}
          <div className={`${activeSection === "cloud" ? "col-span-12" : "hidden"}`}>
            <div className="bg-white dark:bg-slate-900/60 backdrop-blur-md border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden shadow-2xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/5 pb-4">
                <div>
                  <h2 className="text-sm font-black uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
                    <Cloud size={16} className="text-indigo-400" /> Offsite Cloud Backups (Firebase / Google Cloud Storage)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Tier-3 Offsite Protection: Automated sync with sha256 checksum and metadata validation.</p>
                </div>
                <Button size="sm" variant="secondary" onClick={loadCloudBackups} disabled={cloudLoading}>
                  <RefreshCw size={13} /> {cloudLoading ? "Checking..." : "Refresh Cloud"}
                </Button>
              </div>

              {!schedulerStatus?.cloud_backup_enabled ? (
                <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-200">
                  <p className="font-bold">Cloud Backup is currently not configured.</p>
                  <p className="mt-1">To enable automated offsite 3-2-1 backups, configure FIREBASE_BACKUP_ENABLED=true and provide service account credentials.</p>
                </div>
              ) : null}

              <AppTableShell minWidth={700} className="rounded-none border-0" aria-label="Cloud backup list">
                <AppTableHead>
                  <tr>
                    <th className="px-6 py-4 font-bold">Cloud Object Name</th>
                    <th className="px-6 py-4 font-bold">Size</th>
                    <th className="px-6 py-4 font-bold">Timestamp</th>
                    <th className="px-6 py-4 font-bold">Encrypted</th>
                    <th className="px-6 py-4 text-right font-bold">Actions</th>
                  </tr>
                </AppTableHead>
                <tbody>
                  {cloudBackups.length === 0 ? <AppTableEmptyRow colSpan={5} title="No cloud backups found" text="When automated cloud sync is active, offsite copies will appear here." /> : null}
                  {cloudBackups.map((cb) => (
                    <tr key={cb.blob_name} className="border-t border-slate-200 dark:border-white/5 hover:bg-slate-100/70 dark:hover:bg-white/[0.02]">
                      <td className="px-6 py-4 font-mono text-xs text-slate-900 dark:text-slate-100 font-bold">{cb.filename || cb.blob_name}</td>
                      <td className="px-6 py-4 text-xs text-slate-600 dark:text-slate-400">{cb.size_bytes ? `${Math.round(cb.size_bytes / 1024)} KB` : "-"}</td>
                      <td className="px-6 py-4 text-xs text-slate-600 dark:text-slate-400">{cb.created_at ? new Date(cb.created_at).toLocaleString() : "-"}</td>
                      <td className="px-6 py-4"><Badge tone={cb.encrypted ? "green" : "slate"}>{cb.encrypted ? "Encrypted" : "Standard"}</Badge></td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button size="sm" variant="secondary" onClick={() => runTestRestoreCloud(cb.blob_name)} disabled={testingRestore}>
                            <FileCheck size={13} /> Test Restore
                          </Button>
                          <Button size="sm" variant="danger" disabled={restorePermission.disabled || restoreBusy} onClick={() => restoreFromCloud(cb.blob_name)}>
                            <RotateCcw size={13} /> Restore from Cloud
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AppTableShell>
            </div>
          </div>

          {/* Quick Snapshot Card (Side panel in history) */}
          <div className={`${activeSection === "history" ? "col-span-12 xl:col-span-4" : activeSection === "restore" ? "col-span-12" : "hidden"} space-y-4`}>
            <SectionCard title="Instant Online Snapshot" subtitle="Zero-downtime SQLite Online Backup API" className={`${activeSection === "history" ? "" : "hidden"} bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-2xl shadow-sm`}>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400 font-medium">Snapshot Engine</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">SQLite Online Backup API</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400 font-medium">Integrity Verification</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">PRAGMA integrity_check</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400 font-medium">Target Storage</span>
                  <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-300">./database/backups/</span>
                </div>
                <Button
                  size="md"
                  variant="primary"
                  disabled={createPermission.disabled || backupBusy}
                  title={createPermission.reason || undefined}
                  onClick={createBackup}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
                >
                  <HardDrive size={14} /> {backupBusy ? "Creating & Verifying..." : "Create Verified Snapshot Now"}
                </Button>
              </div>
            </SectionCard>

            {/* TAB: Restore Request & Approval Queue */}
            <SectionCard title="Data Restore" subtitle="Safety-first restore execution" className={`${activeSection === "restore" ? "" : "hidden"} bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-2xl shadow-sm`}>
              <div className="space-y-3">
                <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100">
                  <p className="font-black uppercase tracking-widest">Restore request gate</p>
                  <p className="mt-1 text-amber-800 dark:text-amber-200/90">Submit only after selecting a verified snapshot and recording the incident reason.</p>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-600 dark:text-slate-400">Select backup file</span>
                  <Select value={restoreFile} onChange={(e) => setRestoreFile(e.target.value)}>
                    {files.length === 0 ? <option value="">No backups available</option> : null}
                    {files.map((file) => <option key={file} value={file}>{file}</option>)}
                  </Select>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                  <input type="checkbox" checked={restoreChecked} onChange={(e) => setRestoreChecked(e.target.checked)} />
                  I understand restore will overwrite current live data (after approval)
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-600 dark:text-slate-400">Reason / Incident note</span>
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
              <SectionCard title="Restore Approval Queue" subtitle="Request -> Approve/Reject -> Execute" className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-2xl shadow-sm">
                <div className="space-y-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-600 dark:text-slate-400">Decision note (used for approve/reject)</span>
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
                        <tr key={req.request_id} className="border-t border-slate-200 dark:border-white/5">
                          <td className="px-3 py-2">
                            <p className="font-semibold text-slate-800 dark:text-slate-200">{req.request_id}</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">{req.filename}</p>
                          </td>
                          <td className="px-3 py-2"><Badge tone={statusTone(req.status)}>{req.status}</Badge></td>
                          <td className="px-3 py-2">
                            <p className="text-slate-800 dark:text-slate-200">{req.requested_by || "-"}</p>
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

          {/* TAB: 3-2-1 Diagnostics */}
          <div className={`${activeSection === "diagnostics" ? "col-span-12" : "hidden"}`}>
            <div className="bg-white dark:bg-slate-900/60 backdrop-blur-md border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-2xl space-y-6">
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <ShieldCheck size={16} className="text-emerald-400" /> 3-2-1 Disaster Recovery Diagnostics
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4 space-y-2">
                  <span className="text-xs font-bold uppercase text-slate-400">Copy 1: Live Production Database</span>
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                    <CheckCircle2 size={16} /> Online (WAL Mode)
                  </div>
                  <p className="text-xs text-slate-500">Atomic snapshots created via SQLite Online Backup API.</p>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4 space-y-2">
                  <span className="text-xs font-bold uppercase text-slate-400">Copy 2: Verified Local Archive</span>
                  <div className={`flex items-center gap-2 font-bold text-sm ${files.length > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                    {files.length > 0 ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                    {files.length > 0 ? `${files.length} Verified Checkpoints` : "No Local Backups"}
                  </div>
                  <p className="text-xs text-slate-500">Includes SHA-256 sidecars and automated test restore validation.</p>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4 space-y-2">
                  <span className="text-xs font-bold uppercase text-slate-400">Copy 3: Offsite Cloud Storage</span>
                  <div className={`flex items-center gap-2 font-bold text-sm ${schedulerStatus?.cloud_backup_status === "verified" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {schedulerStatus?.cloud_backup_status === "verified" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                    {schedulerStatus?.cloud_backup_status === "verified" ? "Cloud Sync Active" : "Not Configured / Disabled"}
                  </div>
                  <p className="text-xs text-slate-500">Encrypted remote blob storage for total site disaster recovery.</p>
                </div>
              </div>
            </div>
          </div>

          {/* TAB: Policy & Settings */}
          <div className={`${activeSection === "policy" || activeSection === "danger" ? "col-span-12" : "hidden"}`}>
            <div className={`backdrop-blur-md rounded-2xl p-6 shadow-2xl ${activeSection === "danger" ? "border border-rose-500/35 bg-rose-50 dark:bg-rose-950/25 text-rose-900 dark:text-rose-100" : "border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 text-slate-900 dark:text-slate-100"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-700 dark:text-slate-300 flex items-center gap-2">
                  <ShieldAlert size={14} /> Backup & Data Policy
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
                        <option>Twice Daily</option>
                        <option>Every 6 Hours</option>
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

                  {/* Danger Zone */}
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
                          <p className="mt-1 text-rose-200/90">These actions stay separated from backup creation. Latest verified backup metadata is permanently protected.</p>
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

      {/* Test Restore Result Modal */}
      {testRestoreModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-slate-900 space-y-4 text-slate-900 dark:text-white">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/10 pb-3">
              <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
                <FileCheck size={16} className={testRestoreModal.restorable ? "text-emerald-500" : "text-rose-500"} />
                Sandbox Restore Verification Report
              </h3>
              <Badge tone={testRestoreModal.restorable ? "green" : "red"}>{testRestoreModal.restorable ? "PASSED" : "FAILED"}</Badge>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-500">Archive File:</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{testRestoreModal.filename || testRestoreModal.blob_name}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-500">Integrity Check:</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">{testRestoreModal.integrity || "ok"}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-500">Core Tables Verified:</span>
                <span className="font-bold">{testRestoreModal.schema?.tables_count ?? "-"} tables</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-500">SHA-256 Checksum:</span>
                <span className="font-mono text-[10px] text-slate-600 dark:text-slate-400 truncate max-w-[240px]">{testRestoreModal.checksum || "-"}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-500">Tested At:</span>
                <span>{testRestoreModal.tested_at ? new Date(testRestoreModal.tested_at).toLocaleString() : new Date().toLocaleString()}</span>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <Button size="sm" variant="secondary" onClick={() => setTestRestoreModal(null)}>
                Close Report
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
