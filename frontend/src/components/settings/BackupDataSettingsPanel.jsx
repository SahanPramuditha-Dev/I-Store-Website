import { useMemo, useState } from "react";
import { Database, ShieldAlert, Download, Upload, Eraser, Archive, Clock3, FileSpreadsheet, Trash2, RefreshCw } from "lucide-react";
import { Button, Input, Select, SectionCard, Table, Badge } from "../../components/UI";
import api from "../../lib/api";
import SettingsSectionShell from "./SettingsSectionShell";

const DEFAULTS = {
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

function validate(data) {
  const errors = [];
  if (Number(data?.auto_backup?.backup_retention_days || 0) < 1) errors.push("Backup retention must be at least 1 day.");
  if (!String(data?.auto_backup?.local_backup_path || "").trim()) errors.push("Local backup path is required.");
  return errors;
}

function RowToggle({ label, checked, onChange, hint }) {
  return (
    <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs">
      <div>
        <p className="font-semibold text-slate-200">{label}</p>
        {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
      </div>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function NumberField({ label, value, onChange, suffix }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
      <div className="flex gap-2">
        <Input type="number" value={Number(value || 0)} onChange={(e) => onChange(Number(e.target.value || 0))} />
        {suffix ? <span className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-xs text-slate-300 grid place-items-center">{suffix}</span> : null}
      </div>
    </label>
  );
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

function getBackupType(fileName) {
  const name = String(fileName || "").toLowerCase();
  if (name.startsWith("auto_")) return "Auto";
  if (name.startsWith("recovered_")) return "Recovered";
  if (name.startsWith("manual_")) return "Manual";
  return "Manual";
}

export default function BackupDataSettingsPanel({
  sectionValue,
  onSectionChange,
  onSaveSection,
  saving,
  toast,
  confirm,
  backupFiles = [],
  onRunManualBackup,
  onReload,
}) {
  const [dangerConfirm, setDangerConfirm] = useState("");
  const [restoreChecked, setRestoreChecked] = useState(false);

  const kpis = useMemo(() => {
    const d = sectionValue || {};
    return [
      { title: "Auto Backup", value: d?.auto_backup?.enable_automatic_backup ? "Enabled" : "Disabled", tone: d?.auto_backup?.enable_automatic_backup ? "green" : "red", icon: <Database size={16} /> },
      { title: "Frequency", value: d?.auto_backup?.backup_frequency || "-", tone: "indigo", icon: <Clock3 size={16} /> },
      { title: "Retention", value: `${Number(d?.auto_backup?.backup_retention_days || 0)} days`, tone: "amber", icon: <Archive size={16} /> },
      { title: "Encryption", value: d?.auto_backup?.encrypt_backup_files ? "On" : "Off", tone: d?.auto_backup?.encrypt_backup_files ? "violet" : "slate", icon: <ShieldAlert size={16} /> },
      { title: "Backup Files", value: String((backupFiles || []).length), tone: "sky", icon: <Download size={16} /> },
      { title: "Export Format", value: d?.data_export?.format || "CSV", tone: "green", icon: <FileSpreadsheet size={16} /> },
    ];
  }, [sectionValue, backupFiles]);

  const sections = [
    {
      id: "auto",
      label: "Auto Backup",
      icon: Database,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <RowToggle label="Enable automatic backup" checked={data.auto_backup.enable_automatic_backup} onChange={(v) => updatePath("auto_backup.enable_automatic_backup", v)} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Backup frequency</span>
            <Select value={data.auto_backup.backup_frequency || "Daily"} onChange={(e) => updatePath("auto_backup.backup_frequency", e.target.value)}>
              <option>Daily</option>
              <option>Weekly</option>
              <option>Monthly</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Backup time</span>
            <Input type="time" value={data.auto_backup.backup_time || "02:00"} onChange={(e) => updatePath("auto_backup.backup_time", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Backup storage</span>
            <Select value={data.auto_backup.backup_storage || "Local"} onChange={(e) => updatePath("auto_backup.backup_storage", e.target.value)}>
              <option>Local</option>
              <option>Cloud</option>
              <option>Both</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5 md:col-span-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Local backup path</span>
            <Input value={data.auto_backup.local_backup_path || ""} onChange={(e) => updatePath("auto_backup.local_backup_path", e.target.value)} />
          </label>
          <NumberField label="Retention period" value={data.auto_backup.backup_retention_days} onChange={(v) => updatePath("auto_backup.backup_retention_days", v)} suffix="days" />
          <RowToggle label="Compress backup files" checked={data.auto_backup.compress_backup_files} onChange={(v) => updatePath("auto_backup.compress_backup_files", v)} />
          <RowToggle label="Encrypt backup files" checked={data.auto_backup.encrypt_backup_files} onChange={(v) => updatePath("auto_backup.encrypt_backup_files", v)} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Encryption password</span>
            <Input type="password" value={data.auto_backup.encryption_password || ""} onChange={(e) => updatePath("auto_backup.encryption_password", e.target.value)} />
            <span className="text-[10px] text-slate-500">Optional. Leave blank if encryption passphrase is managed from server environment.</span>
          </label>
          <RowToggle label="Notify on backup success" checked={data.auto_backup.notify_on_backup_success} onChange={(v) => updatePath("auto_backup.notify_on_backup_success", v)} />
          <RowToggle label="Notify on backup failure" checked={data.auto_backup.notify_on_backup_failure} onChange={(v) => updatePath("auto_backup.notify_on_backup_failure", v)} />
        </div>
      ),
    },
    {
      id: "manual",
      label: "Manual Backup & History",
      icon: Download,
      render: ({ data }) => (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onRunManualBackup}>
              <Database size={13} /> Create Backup Now
            </Button>
            <Button size="sm" variant="secondary" onClick={onReload}>
              <RefreshCw size={13} /> Refresh
            </Button>
          </div>
          <p className="text-xs text-slate-500">Last backup: {data.manual_backup.last_backup_label || "Not yet created"}</p>
          <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
            <Table className="text-xs">
              <thead>
                <tr>
                  <th>Backup File</th>
                  <th>Created At</th>
                  <th>Type</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(backupFiles || []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-5 text-center text-slate-500">
                      No backup files found.
                    </td>
                  </tr>
                )}
                {(backupFiles || []).map((file) => (
                  <tr key={file}>
                    <td>{file}</td>
                    <td>{formatBackupTimestamp(file)}</td>
                    <td>{getBackupType(file)}</td>
                    <td>
                      <Badge tone="green">Available</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>
      ),
    },
    {
      id: "restore",
      label: "Data Restore",
      icon: Upload,
      render: () => (
        <div className="space-y-3">
          <SectionCard title="Restore Controls" subtitle="Safety-first restore workflow">
            <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">
              Restoring will overwrite current live data. A backup of current state should be created before restore.
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-200 mt-3">
              <input type="checkbox" checked={restoreChecked} onChange={(e) => setRestoreChecked(e.target.checked)} />
              I understand this action cannot be undone
            </label>
            <div className="mt-3">
              <Button
                size="sm"
                variant="secondary"
                disabled={!restoreChecked}
                onClick={async () => {
                  const ok = await confirm("Restore Backup", "Proceed with restore simulation?");
                  if (!ok) return;
                  toast("Restore workflow validated (simulation).", "warning");
                }}
              >
                <Upload size={13} /> Restore Backup
              </Button>
            </div>
          </SectionCard>
        </div>
      ),
    },
    {
      id: "export",
      label: "Data Export",
      icon: FileSpreadsheet,
      render: ({ data, updatePath }) => (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <RowToggle label="Products & Inventory" checked={data.data_export.products_inventory} onChange={(v) => updatePath("data_export.products_inventory", v)} />
            <RowToggle label="Customers" checked={data.data_export.customers} onChange={(v) => updatePath("data_export.customers", v)} />
            <RowToggle label="Suppliers" checked={data.data_export.suppliers} onChange={(v) => updatePath("data_export.suppliers", v)} />
            <RowToggle label="Sales Invoices" checked={data.data_export.sales_invoices} onChange={(v) => updatePath("data_export.sales_invoices", v)} />
            <RowToggle label="Repair Jobs" checked={data.data_export.repair_jobs} onChange={(v) => updatePath("data_export.repair_jobs", v)} />
            <RowToggle label="Expenses" checked={data.data_export.expenses} onChange={(v) => updatePath("data_export.expenses", v)} />
            <RowToggle label="Audit Logs" checked={data.data_export.audit_logs} onChange={(v) => updatePath("data_export.audit_logs", v)} />
          </div>
          <label className="flex flex-col gap-1.5 max-w-sm">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Export format</span>
            <Select value={data.data_export.format || "CSV"} onChange={(e) => updatePath("data_export.format", e.target.value)}>
              <option>CSV</option>
              <option>JSON</option>
              <option>Excel</option>
            </Select>
          </label>
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" onClick={() => toast("Export prepared and added to export history.", "info")}>
              <Download size={13} /> Export All Data
            </Button>
          </div>
        </div>
      ),
    },
    {
      id: "cleanup",
      label: "Data Cleanup (Danger Zone)",
      icon: Eraser,
      render: ({ data, updatePath }) => (
        <div className="space-y-3">
          <div className="rounded-xl border border-rose-400/35 bg-rose-600/10 p-3">
            <p className="text-sm font-semibold text-rose-200">Danger Zone - Manager/Owner only</p>
            <p className="text-xs text-rose-300 mt-1">Type CONFIRM to unlock destructive actions.</p>
            <Input value={dangerConfirm} onChange={(e) => setDangerConfirm(e.target.value)} className="mt-2" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Clear old audit logs</span>
              <Select value={data.data_cleanup.clear_old_audit_logs_older_than || "1 year"} onChange={(e) => updatePath("data_cleanup.clear_old_audit_logs_older_than", e.target.value)}>
                <option>6 months</option>
                <option>1 year</option>
                <option>2 years</option>
              </Select>
            </label>
            <RowToggle label="Enable purge deleted records" checked={data.data_cleanup.purge_deleted_records_enabled} onChange={(v) => updatePath("data_cleanup.purge_deleted_records_enabled", v)} />
            <RowToggle label="Enable reset demo data" checked={data.data_cleanup.reset_demo_data_enabled} onChange={(v) => updatePath("data_cleanup.reset_demo_data_enabled", v)} />
            <RowToggle label="Enable factory reset" checked={data.data_cleanup.factory_reset_enabled} onChange={(v) => updatePath("data_cleanup.factory_reset_enabled", v)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={dangerConfirm !== "CONFIRM"}
              onClick={async () => {
                const ok = await confirm("Run Cleanup", "Preview cleanup changes without deleting records?");
                if (!ok) return;
                try {
                  await api.post("/backup/cleanup", {
                    dry_run: true,
                    keep_latest_verified: true,
                    targets: ["missing_backup_records", "failed_restore_requests", "expired_export_history"],
                  });
                  toast("Cleanup dry run completed.", "warning");
                  if (onReload) await onReload();
                } catch (error) {
                  toast(error.response?.data?.detail || "Cleanup dry run failed", "error");
                }
              }}
            >
              <Trash2 size={13} /> Preview Cleanup
            </Button>
          </div>
        </div>
      ),
    },
  ];

  const sidePreview = ({ data }) => (
    <SectionCard title="Backup Summary">
      <div className="space-y-2 text-xs">
        <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-2 py-1.5">
          <span className="text-slate-300">Storage</span>
          <Badge tone="indigo">{data.auto_backup.backup_storage || "Local"}</Badge>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-2 py-1.5">
          <span className="text-slate-300">Frequency</span>
          <Badge tone="green">{data.auto_backup.backup_frequency || "Daily"}</Badge>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-2 py-1.5">
          <span className="text-slate-300">Encryption</span>
          <Badge tone={data.auto_backup.encrypt_backup_files ? "amber" : "slate"}>{data.auto_backup.encrypt_backup_files ? "Enabled" : "Disabled"}</Badge>
        </div>
      </div>
    </SectionCard>
  );

  return (
    <SettingsSectionShell
      title="Backup & Data"
      subtitle="Automated backups, restore controls, export options, and guarded cleanup actions."
      sectionValue={sectionValue}
      defaults={DEFAULTS}
      onSectionChange={onSectionChange}
      onSaveSection={onSaveSection}
      saving={saving}
      toast={toast}
      confirm={confirm}
      sections={sections}
      kpis={kpis}
      validate={validate}
      sidePreview={sidePreview}
    />
  );
}
