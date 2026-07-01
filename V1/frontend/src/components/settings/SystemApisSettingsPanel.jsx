import { useMemo } from "react";
import { Settings2, Server, Printer, ScanLine, MessageSquare, Mail, PlugZap, ShieldCheck, Bug, KeyRound, Send } from "lucide-react";
import { Input, Select, SectionCard, Badge, Button, Table } from "../../components/UI";
import SettingsSectionShell from "./SettingsSectionShell";

const DEFAULTS = {
  system_information: {
    application_version: "v2.4.1",
    last_updated: "",
    database_size: "",
    total_records: 0,
    uptime: "",
    server_status: "Online",
  },
  printer_configuration: {
    default_receipt_printer: "",
    thermal_printer_repair_labels: "",
    label_printer_product_labels: "",
    paper_size_per_printer: "Configured per printer",
  },
  barcode_scanner: {
    scanner_input_mode: "USB HID (Keyboard)",
    scan_prefix_character: "None",
    scan_suffix_character: "Enter",
    auto_focus_scan_field: true,
    scan_beep_sound: true,
    camera_scan_mobile: true,
  },
  sms_gateway: {
    provider: "",
    api_key: "",
    api_secret: "",
    sender_id: "iStore",
  },
  email_configuration: {
    smtp_server: "",
    smtp_port: 587,
    email_address: "",
    password: "",
    sender_name: "iStore POS",
  },
  external_integrations: {
    whatsapp_business_api_connected: false,
    google_drive_backup_connected: false,
    payment_gateway_connected: false,
    accounting_software_connected: false,
  },
  license_subscription: {
    license_type: "Professional",
    licensed_to: "I Store",
    valid_until: "",
    devices_allowed: 3,
    devices_used: 1,
    support_expires: "",
    status: "Active",
  },
  developer_advanced: {
    debug_mode: false,
    api_access: false,
    api_key: "",
    webhook_url: "",
    log_level: "Error",
  },
};

function validate(data) {
  const errors = [];
  const port = Number(data?.email_configuration?.smtp_port || 0);
  if (port < 1 || port > 65535) errors.push("SMTP port must be between 1 and 65535.");
  if ((data?.license_subscription?.devices_used || 0) > (data?.license_subscription?.devices_allowed || 0)) {
    errors.push("Devices used cannot exceed devices allowed.");
  }
  return errors;
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

function Field({ label, value, onChange, type = "text", hint }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
      <Input type={type} value={value || ""} onChange={(e) => onChange(type === "number" ? Number(e.target.value || 0) : e.target.value)} />
      {hint && <span className="text-[10px] text-slate-500">{hint}</span>}
    </label>
  );
}

export default function SystemApisSettingsPanel({ sectionValue, onSectionChange, onSaveSection, saving, toast, confirm }) {
  const kpis = useMemo(() => {
    const d = sectionValue || {};
    return [
      { title: "Server", value: d?.system_information?.server_status || "Unknown", tone: d?.system_information?.server_status === "Online" ? "green" : "red", icon: <Server size={16} /> },
      { title: "Version", value: d?.system_information?.application_version || "-", tone: "indigo", icon: <Settings2 size={16} /> },
      { title: "DB Size", value: d?.system_information?.database_size || "-", tone: "sky", icon: <Server size={16} /> },
      { title: "SMS Provider", value: d?.sms_gateway?.provider || "Not set", tone: "amber", icon: <MessageSquare size={16} /> },
      { title: "License", value: d?.license_subscription?.status || "Unknown", tone: "violet", icon: <ShieldCheck size={16} /> },
      { title: "API Access", value: d?.developer_advanced?.api_access ? "Enabled" : "Disabled", tone: d?.developer_advanced?.api_access ? "green" : "slate", icon: <KeyRound size={16} /> },
    ];
  }, [sectionValue]);

  const sections = [
    {
      id: "system",
      label: "System Information",
      icon: Server,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Application version" value={data.system_information.application_version} onChange={(v) => updatePath("system_information.application_version", v)} />
          <Field label="Last updated" value={data.system_information.last_updated} onChange={(v) => updatePath("system_information.last_updated", v)} />
          <Field label="Database size" value={data.system_information.database_size} onChange={(v) => updatePath("system_information.database_size", v)} />
          <Field label="Total records" type="number" value={data.system_information.total_records} onChange={(v) => updatePath("system_information.total_records", v)} />
          <Field label="Uptime" value={data.system_information.uptime} onChange={(v) => updatePath("system_information.uptime", v)} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Server status</span>
            <Select value={data.system_information.server_status || "Online"} onChange={(e) => updatePath("system_information.server_status", e.target.value)}>
              <option>Online</option>
              <option>Maintenance</option>
              <option>Offline</option>
            </Select>
          </label>
        </div>
      ),
    },
    {
      id: "printer",
      label: "Printer Configuration",
      icon: Printer,
      render: ({ data, updatePath }) => (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Default receipt printer" value={data.printer_configuration.default_receipt_printer} onChange={(v) => updatePath("printer_configuration.default_receipt_printer", v)} />
            <Field label="Thermal printer (repair labels)" value={data.printer_configuration.thermal_printer_repair_labels} onChange={(v) => updatePath("printer_configuration.thermal_printer_repair_labels", v)} />
            <Field label="Label printer (product labels)" value={data.printer_configuration.label_printer_product_labels} onChange={(v) => updatePath("printer_configuration.label_printer_product_labels", v)} />
            <Field label="Paper size per printer" value={data.printer_configuration.paper_size_per_printer} onChange={(v) => updatePath("printer_configuration.paper_size_per_printer", v)} />
          </div>
          <Button size="sm" variant="secondary" onClick={() => toast("Test print sent (simulation).", "info")}>
            <Printer size={13} /> Print Test Receipt
          </Button>
        </div>
      ),
    },
    {
      id: "scanner",
      label: "Barcode Scanner",
      icon: ScanLine,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Scanner input mode</span>
            <Select value={data.barcode_scanner.scanner_input_mode || "USB HID (Keyboard)"} onChange={(e) => updatePath("barcode_scanner.scanner_input_mode", e.target.value)}>
              <option>USB HID (Keyboard)</option>
              <option>Bluetooth HID</option>
              <option>Serial</option>
            </Select>
          </label>
          <Field label="Scan prefix character" value={data.barcode_scanner.scan_prefix_character} onChange={(v) => updatePath("barcode_scanner.scan_prefix_character", v)} />
          <Field label="Scan suffix character" value={data.barcode_scanner.scan_suffix_character} onChange={(v) => updatePath("barcode_scanner.scan_suffix_character", v)} />
          <Toggle label="Auto-focus scan field" checked={data.barcode_scanner.auto_focus_scan_field} onChange={(v) => updatePath("barcode_scanner.auto_focus_scan_field", v)} />
          <Toggle label="Scan beep sound" checked={data.barcode_scanner.scan_beep_sound} onChange={(v) => updatePath("barcode_scanner.scan_beep_sound", v)} />
          <Toggle label="Camera scan (mobile)" checked={data.barcode_scanner.camera_scan_mobile} onChange={(v) => updatePath("barcode_scanner.camera_scan_mobile", v)} />
        </div>
      ),
    },
    {
      id: "sms",
      label: "SMS Gateway",
      icon: MessageSquare,
      render: ({ data, updatePath }) => (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Provider</span>
              <Select value={data.sms_gateway.provider || ""} onChange={(e) => updatePath("sms_gateway.provider", e.target.value)}>
                <option value="">Select provider</option>
                <option>Dialog</option>
                <option>Mobitel</option>
                <option>Twilio</option>
              </Select>
            </label>
            <Field label="API Key" value={data.sms_gateway.api_key} onChange={(v) => updatePath("sms_gateway.api_key", v)} />
            <Field label="API Secret" value={data.sms_gateway.api_secret} onChange={(v) => updatePath("sms_gateway.api_secret", v)} />
            <Field label="Sender ID" value={data.sms_gateway.sender_id} onChange={(v) => updatePath("sms_gateway.sender_id", v)} />
          </div>
          <Button size="sm" variant="secondary" onClick={() => toast("Test SMS sent (simulation).", "info")}>
            <Send size={13} /> Test SMS
          </Button>
        </div>
      ),
    },
    {
      id: "email",
      label: "Email Configuration",
      icon: Mail,
      render: ({ data, updatePath }) => (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="SMTP server" value={data.email_configuration.smtp_server} onChange={(v) => updatePath("email_configuration.smtp_server", v)} />
            <Field label="SMTP port" type="number" value={data.email_configuration.smtp_port} onChange={(v) => updatePath("email_configuration.smtp_port", v)} />
            <Field label="Email address" value={data.email_configuration.email_address} onChange={(v) => updatePath("email_configuration.email_address", v)} />
            <Field label="Password / App password" value={data.email_configuration.password} onChange={(v) => updatePath("email_configuration.password", v)} />
            <Field label="Sender name" value={data.email_configuration.sender_name} onChange={(v) => updatePath("email_configuration.sender_name", v)} />
          </div>
          <Button size="sm" variant="secondary" onClick={() => toast("Test email sent (simulation).", "info")}>
            <Mail size={13} /> Send Test Email
          </Button>
        </div>
      ),
    },
    {
      id: "integrations",
      label: "External Integrations",
      icon: PlugZap,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Toggle label="WhatsApp Business API" checked={data.external_integrations.whatsapp_business_api_connected} onChange={(v) => updatePath("external_integrations.whatsapp_business_api_connected", v)} />
          <Toggle label="Google Drive backup" checked={data.external_integrations.google_drive_backup_connected} onChange={(v) => updatePath("external_integrations.google_drive_backup_connected", v)} />
          <Toggle label="Payment gateway" checked={data.external_integrations.payment_gateway_connected} onChange={(v) => updatePath("external_integrations.payment_gateway_connected", v)} />
          <Toggle label="Accounting software" checked={data.external_integrations.accounting_software_connected} onChange={(v) => updatePath("external_integrations.accounting_software_connected", v)} />
        </div>
      ),
    },
    {
      id: "license",
      label: "License & Subscription",
      icon: ShieldCheck,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="License type" value={data.license_subscription.license_type} onChange={(v) => updatePath("license_subscription.license_type", v)} />
          <Field label="Licensed to" value={data.license_subscription.licensed_to} onChange={(v) => updatePath("license_subscription.licensed_to", v)} />
          <Field label="Valid until" value={data.license_subscription.valid_until} onChange={(v) => updatePath("license_subscription.valid_until", v)} />
          <Field label="Devices allowed" type="number" value={data.license_subscription.devices_allowed} onChange={(v) => updatePath("license_subscription.devices_allowed", v)} />
          <Field label="Devices used" type="number" value={data.license_subscription.devices_used} onChange={(v) => updatePath("license_subscription.devices_used", v)} />
          <Field label="Support expires" value={data.license_subscription.support_expires} onChange={(v) => updatePath("license_subscription.support_expires", v)} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Status</span>
            <Select value={data.license_subscription.status || "Active"} onChange={(e) => updatePath("license_subscription.status", e.target.value)}>
              <option>Active</option>
              <option>Expiring</option>
              <option>Expired</option>
            </Select>
          </label>
          <div className="md:col-span-2 flex items-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => toast("License renewal flow opened (simulation).", "info")}>
              Renew License
            </Button>
            <Button size="sm" variant="secondary" onClick={() => toast("Plan details opened (simulation).", "info")}>
              View Plan Details
            </Button>
          </div>
        </div>
      ),
    },
    {
      id: "advanced",
      label: "Developer / Advanced",
      icon: Bug,
      render: ({ data, updatePath }) => (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Toggle label="Debug mode" checked={data.developer_advanced.debug_mode} onChange={(v) => updatePath("developer_advanced.debug_mode", v)} />
            <Toggle label="API access enabled" checked={data.developer_advanced.api_access} onChange={(v) => updatePath("developer_advanced.api_access", v)} />
            <Field label="API key" value={data.developer_advanced.api_key} onChange={(v) => updatePath("developer_advanced.api_key", v)} />
            <Field label="Webhook URL" value={data.developer_advanced.webhook_url} onChange={(v) => updatePath("developer_advanced.webhook_url", v)} />
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Log level</span>
              <Select value={data.developer_advanced.log_level || "Error"} onChange={(e) => updatePath("developer_advanced.log_level", e.target.value)}>
                <option>Error</option>
                <option>Warning</option>
                <option>Info</option>
                <option>Debug</option>
              </Select>
            </label>
            <div className="flex items-end">
              <Button size="sm" variant="secondary" onClick={() => toast("Cache clear executed (simulation).", "warning")}>
                Clear Cache
              </Button>
            </div>
          </div>
        </div>
      ),
    },
  ];

  const sidePreview = ({ data }) => (
    <SectionCard title="Connection Matrix">
      <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
        <Table className="text-xs">
          <thead>
            <tr>
              <th>Service</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Server</td>
              <td>{data.system_information.server_status === "Online" ? <Badge tone="green">Online</Badge> : <Badge tone="red">Offline</Badge>}</td>
            </tr>
            <tr>
              <td>SMS Gateway</td>
              <td>{data.sms_gateway.provider ? <Badge tone="green">{data.sms_gateway.provider}</Badge> : <Badge tone="slate">Not set</Badge>}</td>
            </tr>
            <tr>
              <td>Email SMTP</td>
              <td>{data.email_configuration.smtp_server ? <Badge tone="green">Configured</Badge> : <Badge tone="amber">Pending</Badge>}</td>
            </tr>
            <tr>
              <td>WhatsApp API</td>
              <td>{data.external_integrations.whatsapp_business_api_connected ? <Badge tone="green">Connected</Badge> : <Badge tone="red">Disconnected</Badge>}</td>
            </tr>
          </tbody>
        </Table>
      </div>
    </SectionCard>
  );

  return (
    <SettingsSectionShell
      title="System & APIs"
      subtitle="System info, printers, scanner, SMS/email gateways, integrations, licensing, and developer controls."
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
