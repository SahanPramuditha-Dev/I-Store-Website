import { useMemo } from "react";
import { Bell, Users, MessageSquare, AlertTriangle, Clock3, Percent, Send } from "lucide-react";
import { Input, Select, SectionCard, Table, Badge, Button } from "../../components/UI";
import SettingsSectionShell from "./SettingsSectionShell";

const DEFAULTS = {
  in_app_notifications: {
    low_stock_alert: { enabled: true, threshold: 5 },
    out_of_stock_alert: { enabled: true },
    overdue_payment_alert: { enabled: true, days: 7 },
    delayed_repair_alert: { enabled: true, mode: "past ETA" },
    new_repair_job_assigned: { enabled: true },
    repair_status_changed: { enabled: true },
    cash_reconciliation_reminder: { enabled: true, time: "19:00" },
    unsigned_closing_report: { enabled: true, time: "20:00" },
    goal_behind_target_alert: { enabled: true, threshold_percent: 70 },
    failed_login_alert: { enabled: true, attempts: 3 },
    large_transaction_alert: { enabled: true, amount: 100000 },
    large_discount_alert: { enabled: true, percent: 15 },
    void_deletion_alert: { enabled: true },
    budget_overspend_alert: { enabled: true },
    supplier_payment_due: { enabled: true, days_before: 3 },
  },
  notification_recipients: {
    owner: true,
    admin: true,
    manager: true,
    cashier: false,
    technician: false,
  },
  sms_notifications: {
    sms_gateway: "",
    api_key: "",
    sender_name: "iStore",
    send_job_received: true,
    send_job_completed: true,
    send_job_delivered: true,
    send_invoice_created: false,
    send_outstanding_payment_reminder: true,
    send_promotional_messages: false,
    template_job_received: "Dear {customer}, your {device} has been received. Job ID: {job_id}.",
    template_job_completed: "Dear {customer}, your repair is complete. Balance: LKR {balance}.",
  },
  alert_thresholds_summary: [
    { alert: "Low stock", trigger_value: "Below 5 units", notify: "Manager+" },
    { alert: "Overdue payment", trigger_value: "After 7 days", notify: "Manager+" },
    { alert: "Large transaction", trigger_value: "Above LKR 100,000", notify: "Admin+" },
    { alert: "Large discount", trigger_value: "Above 15%", notify: "Manager+" },
    { alert: "Failed logins", trigger_value: "After 3 attempts", notify: "Admin+" },
    { alert: "Budget overspend", trigger_value: "Above 100%", notify: "Manager+" },
  ],
};

const ALERT_ROWS = [
  ["low_stock_alert", "Low stock alert", "threshold", "units"],
  ["out_of_stock_alert", "Out of stock alert", null, null],
  ["overdue_payment_alert", "Overdue payment alert", "days", "days"],
  ["delayed_repair_alert", "Delayed repair alert", "mode", null],
  ["new_repair_job_assigned", "New repair assigned", null, null],
  ["repair_status_changed", "Repair status changed", null, null],
  ["cash_reconciliation_reminder", "Cash reconciliation reminder", "time", null],
  ["unsigned_closing_report", "Unsigned closing report", "time", null],
  ["goal_behind_target_alert", "Goal behind target", "threshold_percent", "%"],
  ["failed_login_alert", "Failed login alert", "attempts", "attempts"],
  ["large_transaction_alert", "Large transaction alert", "amount", "LKR"],
  ["large_discount_alert", "Large discount alert", "percent", "%"],
  ["void_deletion_alert", "Void / deletion alert", null, null],
  ["budget_overspend_alert", "Budget overspend alert", null, null],
  ["supplier_payment_due", "Supplier payment due", "days_before", "days"],
];

function validate(data) {
  const errors = [];
  const alerts = data?.in_app_notifications || {};
  if ((alerts?.low_stock_alert?.threshold || 0) < 0) errors.push("Low stock threshold cannot be negative.");
  if ((alerts?.overdue_payment_alert?.days || 0) < 0) errors.push("Overdue payment days cannot be negative.");
  if ((alerts?.goal_behind_target_alert?.threshold_percent || 0) < 0 || (alerts?.goal_behind_target_alert?.threshold_percent || 0) > 100) {
    errors.push("Goal threshold must be between 0% and 100%.");
  }
  if ((alerts?.large_discount_alert?.percent || 0) > 100) errors.push("Large discount threshold cannot exceed 100%.");
  if ((alerts?.failed_login_alert?.attempts || 0) < 1) errors.push("Failed login attempts threshold must be at least 1.");
  return errors;
}

function LabeledInput({ label, value, onChange, type = "text", hint }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
      <Input type={type} value={value || ""} onChange={(e) => onChange(type === "number" ? Number(e.target.value || 0) : e.target.value)} />
      {hint && <span className="text-[10px] text-slate-500">{hint}</span>}
    </label>
  );
}

function Toggle({ label, checked, onChange, hint }) {
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

export default function NotificationsSettingsPanel({ sectionValue, onSectionChange, onSaveSection, saving, toast, confirm }) {
  const kpis = useMemo(() => {
    const d = sectionValue || {};
    const alerts = d?.in_app_notifications || {};
    const enabledCount = ALERT_ROWS.filter(([key]) => alerts?.[key]?.enabled).length;
    const recipientsCount = Object.values(d?.notification_recipients || {}).filter(Boolean).length;
    return [
      { title: "Enabled Alerts", value: String(enabledCount), tone: "indigo", icon: <Bell size={16} /> },
      { title: "Recipients Enabled", value: String(recipientsCount), tone: "green", icon: <Users size={16} /> },
      { title: "SMS Gateway", value: d?.sms_notifications?.sms_gateway || "Not set", tone: "amber", icon: <MessageSquare size={16} /> },
      { title: "Low Stock Trigger", value: `${Number(alerts?.low_stock_alert?.threshold || 0)} units`, tone: "sky", icon: <AlertTriangle size={16} /> },
      { title: "Cash Reminder", value: alerts?.cash_reconciliation_reminder?.time || "-", tone: "violet", icon: <Clock3 size={16} /> },
      { title: "Goal Threshold", value: `${Number(alerts?.goal_behind_target_alert?.threshold_percent || 0)}%`, tone: "amber", icon: <Percent size={16} /> },
    ];
  }, [sectionValue]);

  const sections = [
    {
      id: "in_app",
      label: "In-App Notifications",
      icon: Bell,
      render: ({ data, updatePath }) => (
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
          <Table className="text-xs">
            <thead>
              <tr>
                <th>Alert</th>
                <th>Enabled</th>
                <th>Trigger</th>
              </tr>
            </thead>
            <tbody>
              {ALERT_ROWS.map(([key, label, triggerKey, unit]) => {
                const row = data.in_app_notifications[key] || {};
                return (
                  <tr key={key}>
                    <td>{label}</td>
                    <td>
                      <input type="checkbox" checked={!!row.enabled} onChange={(e) => updatePath(`in_app_notifications.${key}.enabled`, e.target.checked)} />
                    </td>
                    <td>
                      {!triggerKey && <span className="text-slate-500">-</span>}
                      {triggerKey && triggerKey === "time" && (
                        <Input type="time" value={row[triggerKey] || "19:00"} onChange={(e) => updatePath(`in_app_notifications.${key}.${triggerKey}`, e.target.value)} />
                      )}
                      {triggerKey && triggerKey === "mode" && (
                        <Select value={row[triggerKey] || "past ETA"} onChange={(e) => updatePath(`in_app_notifications.${key}.${triggerKey}`, e.target.value)}>
                          <option>past ETA</option>
                          <option>over SLA</option>
                        </Select>
                      )}
                      {triggerKey && !["time", "mode"].includes(triggerKey) && (
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            value={Number(row[triggerKey] || 0)}
                            onChange={(e) => updatePath(`in_app_notifications.${key}.${triggerKey}`, Number(e.target.value || 0))}
                          />
                          {unit ? <span className="px-2 py-2 rounded-lg border border-white/10 bg-white/5 text-xs text-slate-300">{unit}</span> : null}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      ),
    },
    {
      id: "recipients",
      label: "Notification Recipients",
      icon: Users,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Toggle label="Owner" checked={data.notification_recipients.owner} onChange={(v) => updatePath("notification_recipients.owner", v)} />
          <Toggle label="Admin" checked={data.notification_recipients.admin} onChange={(v) => updatePath("notification_recipients.admin", v)} />
          <Toggle label="Manager" checked={data.notification_recipients.manager} onChange={(v) => updatePath("notification_recipients.manager", v)} />
          <Toggle label="Cashier" checked={data.notification_recipients.cashier} onChange={(v) => updatePath("notification_recipients.cashier", v)} />
          <Toggle label="Technician" checked={data.notification_recipients.technician} onChange={(v) => updatePath("notification_recipients.technician", v)} />
        </div>
      ),
    },
    {
      id: "sms",
      label: "SMS Notifications",
      icon: MessageSquare,
      render: ({ data, updatePath }) => (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">SMS Gateway</span>
              <Select value={data.sms_notifications.sms_gateway || ""} onChange={(e) => updatePath("sms_notifications.sms_gateway", e.target.value)}>
                <option value="">Select provider</option>
                <option>Dialog</option>
                <option>Mobitel</option>
                <option>Twilio</option>
              </Select>
            </label>
            <LabeledInput label="API Key" value={data.sms_notifications.api_key} onChange={(v) => updatePath("sms_notifications.api_key", v)} />
            <LabeledInput label="Sender Name" value={data.sms_notifications.sender_name} onChange={(v) => updatePath("sms_notifications.sender_name", v)} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Toggle label="Send: job received" checked={data.sms_notifications.send_job_received} onChange={(v) => updatePath("sms_notifications.send_job_received", v)} />
            <Toggle label="Send: job completed" checked={data.sms_notifications.send_job_completed} onChange={(v) => updatePath("sms_notifications.send_job_completed", v)} />
            <Toggle label="Send: job delivered" checked={data.sms_notifications.send_job_delivered} onChange={(v) => updatePath("sms_notifications.send_job_delivered", v)} />
            <Toggle label="Send: invoice created" checked={data.sms_notifications.send_invoice_created} onChange={(v) => updatePath("sms_notifications.send_invoice_created", v)} />
            <Toggle
              label="Send: outstanding reminder"
              checked={data.sms_notifications.send_outstanding_payment_reminder}
              onChange={(v) => updatePath("sms_notifications.send_outstanding_payment_reminder", v)}
            />
            <Toggle label="Send: promotional messages" checked={data.sms_notifications.send_promotional_messages} onChange={(v) => updatePath("sms_notifications.send_promotional_messages", v)} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Template: Job Received</span>
              <textarea className="field min-h-[120px]" value={data.sms_notifications.template_job_received || ""} onChange={(e) => updatePath("sms_notifications.template_job_received", e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Template: Job Completed</span>
              <textarea className="field min-h-[120px]" value={data.sms_notifications.template_job_completed || ""} onChange={(e) => updatePath("sms_notifications.template_job_completed", e.target.value)} />
            </label>
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" onClick={() => toast("Test SMS template prepared. Configure gateway to send.", "info")}>
              <Send size={13} /> Send Test SMS
            </Button>
          </div>
        </div>
      ),
    },
    {
      id: "thresholds",
      label: "Thresholds Summary",
      icon: AlertTriangle,
      render: ({ data }) => (
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
          <Table className="text-xs">
            <thead>
              <tr>
                <th>Alert</th>
                <th>Trigger Value</th>
                <th>Notify</th>
              </tr>
            </thead>
            <tbody>
              {(data.alert_thresholds_summary || []).map((row, idx) => (
                <tr key={`${row.alert}-${idx}`}>
                  <td>{row.alert}</td>
                  <td>{row.trigger_value}</td>
                  <td>{row.notify}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ),
    },
  ];

  const sidePreview = ({ data }) => (
    <SectionCard title="Alerts Snapshot">
      <div className="space-y-2">
        {ALERT_ROWS.slice(0, 6).map(([key, label]) => (
          <div key={key} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-xs">
            <span className="text-slate-200">{label}</span>
            <Badge tone={data.in_app_notifications?.[key]?.enabled ? "green" : "slate"}>{data.in_app_notifications?.[key]?.enabled ? "On" : "Off"}</Badge>
          </div>
        ))}
      </div>
    </SectionCard>
  );

  return (
    <SettingsSectionShell
      title="Notifications & Alerts"
      subtitle="In-app alerts, recipients, SMS templates, and alert threshold governance."
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
