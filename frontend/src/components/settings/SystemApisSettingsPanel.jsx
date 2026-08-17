import { useMemo, useState } from "react";
import { Settings2, Server, Printer, ScanLine, MessageSquare, Mail, PlugZap, ShieldCheck, Bug, KeyRound, Send, Bot, Sparkles, Eye, EyeOff, CheckCircle2, AlertCircle, CreditCard, Cloud, Landmark, RefreshCw } from "lucide-react";
import { Input, Select, SectionCard, Badge, Button, Table } from "../../components/UI";
import SettingsSectionShell from "./SettingsSectionShell";
import WhatsAppSettingsCard from "./WhatsAppSettingsCard";
import api from "../../lib/api";

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
  ai_configuration: {
    enabled: true,
    gemini_api_key: "",
    model: "gemini-2.5-flash",
    enable_chat_assistant: true,
    enable_repair_diagnostics: true,
    enable_inventory_forecasting: true,
  },
  external_integrations: {
    whatsapp_business_api_connected: false,
    google_drive: {
      enabled: false,
      client_id: "",
      client_secret: "",
      folder_id: "",
      backup_frequency: "Daily",
      auto_upload: true,
    },
    payment_gateway: {
      enabled: false,
      provider: "PayHere",
      merchant_id: "",
      merchant_secret: "",
      app_id: "",
      sandbox_mode: true,
      currency: "LKR",
      auto_generate_invoice_links: true,
    },
    accounting_software: {
      enabled: false,
      provider: "QuickBooks Online",
      client_id: "",
      client_secret: "",
      realm_id: "",
      auto_sync_daily_sales: true,
      auto_sync_expenses: true,
    },
    google_drive_backup_connected: false,
    payment_gateway_connected: false,
    accounting_software_connected: false,
  },
  license_subscription: {
    license_type: "Professional",
    licensed_to: "E Store",
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
  const [checkingForUpdate, setCheckingForUpdate] = useState(false);
  const [updaterStatus, setUpdaterStatus] = useState("idle");
  const checkForUpdates = async () => {
    if (!window.istore?.updater) {
      toast("Updates are available only in the installed desktop app.", "info");
      return;
    }
    setCheckingForUpdate(true);
    try {
      const result = await window.istore.updater.checkForUpdates();
      if (result?.skipped) toast(result.reason, "info");
      else if (result?.error) toast(`Update check failed: ${result.error}`, "error");
    } finally {
      setCheckingForUpdate(false);
    }
  };
  const handleDownloadUpdate = async () => {
    if (!window.istore?.updater) {
      toast("Update controls are unavailable outside the desktop app.", "info");
      return;
    }
    setUpdaterStatus("downloading");
    try {
      const result = await window.istore.updater.downloadUpdate();
      if (result?.blocked) toast("Updates are blocked while sales, repairs, or inventory operations are active.", "warning");
      else if (result?.error) toast(`Update download failed: ${result.error}`, "error");
      else setUpdaterStatus("ready");
    } finally {
      setTimeout(() => setUpdaterStatus("idle"), 1800);
    }
  };

  const kpis = useMemo(() => {
    const d = sectionValue || {};
    const hasAiKey = !!d?.ai_configuration?.gemini_api_key;
    return [
      { title: "Server", value: d?.system_information?.server_status || "Unknown", tone: d?.system_information?.server_status === "Online" ? "green" : "red", icon: <Server size={16} /> },
      { title: "Version", value: d?.system_information?.application_version || "-", tone: "indigo", icon: <Settings2 size={16} /> },
      { title: "Gemini AI", value: hasAiKey ? (d?.ai_configuration?.enabled !== false ? "Active" : "Disabled") : "No Key", tone: hasAiKey ? "green" : "amber", icon: <Sparkles size={16} /> },
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
      label: "External Integrations & AI",
      icon: PlugZap,
      render: ({ data, updatePath }) => {
        const [showKey, setShowKey] = useState(false);
        const [testingKey, setTestingKey] = useState(false);
        const [testResult, setTestResult] = useState(null);

        const aiConfig = data.ai_configuration || {
          enabled: true,
          gemini_api_key: "",
          model: "gemini-2.5-flash",
          enable_chat_assistant: true,
          enable_repair_diagnostics: true,
          enable_inventory_forecasting: true,
        };

        const handleTestKey = async () => {
          setTestingKey(true);
          setTestResult(null);
          try {
            const res = await api.post("/ai/test-key", {
              api_key: aiConfig.gemini_api_key,
              model: aiConfig.model,
            });
            setTestResult({ ok: true, message: res.data?.message || "Gemini connection verified!" });
            toast("Gemini API key verified successfully!", "success");
          } catch (err) {
            const msg = err.response?.data?.detail || err.message || "Failed to reach Gemini API";
            setTestResult({ ok: false, message: msg });
            toast(`Gemini key error: ${msg}`, "error");
          } finally {
            setTestingKey(false);
          }
        };

        return (
          <div className="space-y-6">
            {/* Gemini AI Card */}
            <div className="rounded-2xl border border-indigo-500/20 bg-gradient-to-b from-indigo-950/20 to-slate-950/60 p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                    <Sparkles size={20} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      Google Gemini AI Integration
                      <Badge tone={aiConfig.gemini_api_key ? "green" : "amber"}>
                        {aiConfig.gemini_api_key ? "Key Configured" : "Key Missing"}
                      </Badge>
                    </h4>
                    <p className="text-xs text-slate-400">
                      Power the conversational assistant, repair auto-diagnosis, and inventory forecasting.
                    </p>
                  </div>
                </div>
                <Toggle
                  label="AI Active"
                  checked={aiConfig.enabled}
                  onChange={(v) => updatePath("ai_configuration.enabled", v)}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Gemini API Key</span>
                  <div className="relative flex items-center">
                    <Input
                      type={showKey ? "text" : "password"}
                      value={aiConfig.gemini_api_key || ""}
                      placeholder="AIzaSy..."
                      className="pr-10"
                      onChange={(e) => updatePath("ai_configuration.gemini_api_key", e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-3 text-slate-400 hover:text-slate-200 transition-colors"
                    >
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <span className="text-[10px] text-slate-500">
                    Saved key will be used for all AI features without needing .env file edits.
                  </span>
                </div>

                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Model Selection</span>
                  <Select
                    value={aiConfig.model || "gemini-2.5-flash"}
                    onChange={(e) => updatePath("ai_configuration.model", e.target.value)}
                  >
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash (Recommended)</option>
                    <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                    <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                    <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                  </Select>
                </label>

                <div className="flex items-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full h-[38px] flex items-center justify-center gap-2"
                    onClick={handleTestKey}
                    disabled={testingKey || !aiConfig.gemini_api_key}
                  >
                    {testingKey ? <Settings2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
                    {testingKey ? "Verifying..." : "Test AI Connection"}
                  </Button>
                </div>
              </div>

              {testResult && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
                    testResult.ok
                      ? "bg-emerald-950/30 border-emerald-500/30 text-emerald-300"
                      : "bg-rose-950/30 border-rose-500/30 text-rose-300"
                  }`}
                >
                  {testResult.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                  <span>{testResult.message}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-2 border-t border-white/5">
                <Toggle
                  label="Chat Copilot"
                  hint="In-app AI assistant"
                  checked={aiConfig.enable_chat_assistant}
                  onChange={(v) => updatePath("ai_configuration.enable_chat_assistant", v)}
                />
                <Toggle
                  label="Repair Diagnose"
                  hint="AI parts & cost prediction"
                  checked={aiConfig.enable_repair_diagnostics}
                  onChange={(v) => updatePath("ai_configuration.enable_repair_diagnostics", v)}
                />
                <Toggle
                  label="Restock Forecast"
                  hint="Predictive low-stock orders"
                  checked={aiConfig.enable_inventory_forecasting}
                  onChange={(v) => updatePath("ai_configuration.enable_inventory_forecasting", v)}
                />
              </div>
            </div>

            {/* Payment Gateway Card */}
            {(() => {
              const [testingPayment, setTestingPayment] = useState(false);
              const [paymentResult, setPaymentResult] = useState(null);
              const [showSecret, setShowSecret] = useState(false);
              const payConfig = data.external_integrations?.payment_gateway || {
                enabled: false,
                provider: "PayHere",
                merchant_id: "",
                merchant_secret: "",
                app_id: "",
                sandbox_mode: true,
                currency: "LKR",
                auto_generate_invoice_links: true,
              };

              const handleTestPayment = async () => {
                setTestingPayment(true);
                setPaymentResult(null);
                try {
                  const res = await api.post("/settings/integrations/test-payment-gateway", payConfig);
                  setPaymentResult({ ok: true, message: res.data?.message || "Payment gateway verified!" });
                  toast("Payment gateway credentials verified!", "success");
                } catch (err) {
                  const msg = err.response?.data?.detail || err.message || "Failed to verify gateway";
                  setPaymentResult({ ok: false, message: msg });
                  toast(`Payment Gateway error: ${msg}`, "error");
                } finally {
                  setTestingPayment(false);
                }
              };

              return (
                <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-950/20 to-slate-950/60 p-5 space-y-4 shadow-xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                        <CreditCard size={20} />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                          Online Payment Gateway
                          <Badge tone={payConfig.enabled ? "green" : "slate"}>
                            {payConfig.enabled ? `${payConfig.provider} Active` : "Disabled"}
                          </Badge>
                          {payConfig.sandbox_mode && payConfig.enabled && (
                            <Badge tone="amber">Sandbox Mode</Badge>
                          )}
                        </h4>
                        <p className="text-xs text-slate-400">
                          Generate online checkout payment links for customer WhatsApp invoices and repair estimates.
                        </p>
                      </div>
                    </div>
                    <Toggle
                      label="Enable Payments"
                      checked={payConfig.enabled}
                      onChange={(v) => updatePath("external_integrations.payment_gateway.enabled", v)}
                    />
                  </div>

                  {payConfig.enabled && (
                    <div className="space-y-3 pt-2">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <label className="flex flex-col gap-1.5">
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Provider</span>
                          <Select
                            value={payConfig.provider || "PayHere"}
                            onChange={(e) => updatePath("external_integrations.payment_gateway.provider", e.target.value)}
                          >
                            <option value="PayHere">PayHere (Sri Lanka LKR)</option>
                            <option value="Stripe">Stripe</option>
                            <option value="WEBXPAY">WEBXPAY (Sri Lanka)</option>
                          </Select>
                        </label>
                        <Field
                          label="Merchant ID / Client ID"
                          value={payConfig.merchant_id}
                          placeholder={payConfig.provider === "PayHere" ? "e.g. 121XXXX" : "pk_live_..."}
                          onChange={(v) => updatePath("external_integrations.payment_gateway.merchant_id", v)}
                        />
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Merchant Secret / Key</span>
                          <div className="relative flex items-center">
                            <Input
                              type={showSecret ? "text" : "password"}
                              value={payConfig.merchant_secret || ""}
                              placeholder="Secret key..."
                              className="pr-10"
                              onChange={(e) => updatePath("external_integrations.payment_gateway.merchant_secret", e.target.value)}
                            />
                            <button
                              type="button"
                              onClick={() => setShowSecret(!showSecret)}
                              className="absolute right-3 text-slate-400 hover:text-slate-200 transition-colors"
                            >
                              {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                        <Toggle
                          label="Sandbox / Test Mode"
                          hint="Simulate payments without real money"
                          checked={payConfig.sandbox_mode}
                          onChange={(v) => updatePath("external_integrations.payment_gateway.sandbox_mode", v)}
                        />
                        <Toggle
                          label="Auto-Attach Link to WhatsApp"
                          hint="Embed pay link in invoices"
                          checked={payConfig.auto_generate_invoice_links}
                          onChange={(v) => updatePath("external_integrations.payment_gateway.auto_generate_invoice_links", v)}
                        />
                        <div className="flex items-end">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="w-full h-[38px] flex items-center justify-center gap-2"
                            onClick={handleTestPayment}
                            disabled={testingPayment || !payConfig.merchant_id}
                          >
                            {testingPayment ? <Settings2 className="animate-spin" size={14} /> : <CreditCard size={14} />}
                            {testingPayment ? "Verifying..." : "Verify Gateway"}
                          </Button>
                        </div>
                      </div>

                      {paymentResult && (
                        <div
                          className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
                            paymentResult.ok
                              ? "bg-emerald-950/30 border-emerald-500/30 text-emerald-300"
                              : "bg-rose-950/30 border-rose-500/30 text-rose-300"
                          }`}
                        >
                          {paymentResult.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                          <span>{paymentResult.message}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Google Drive Cloud Backup Card */}
            {(() => {
              const [testingDrive, setTestingDrive] = useState(false);
              const [driveResult, setDriveResult] = useState(null);
              const driveConfig = data.external_integrations?.google_drive || {
                enabled: false,
                client_id: "",
                client_secret: "",
                folder_id: "",
                backup_frequency: "Daily",
                auto_upload: true,
              };

              const handleTestDrive = async () => {
                setTestingDrive(true);
                setDriveResult(null);
                try {
                  const res = await api.post("/settings/integrations/test-google-drive", driveConfig);
                  setDriveResult({ ok: true, message: res.data?.message || "Google Drive verified!" });
                  toast("Google Drive verified for backup storage!", "success");
                } catch (err) {
                  const msg = err.response?.data?.detail || err.message || "Failed to verify Drive";
                  setDriveResult({ ok: false, message: msg });
                  toast(`Google Drive error: ${msg}`, "error");
                } finally {
                  setTestingDrive(false);
                }
              };

              return (
                <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-b from-sky-950/20 to-slate-950/60 p-5 space-y-4 shadow-xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
                        <Cloud size={20} />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                          Google Drive Cloud Backup
                          <Badge tone={driveConfig.enabled ? "green" : "slate"}>
                            {driveConfig.enabled ? "Cloud Sync Active" : "Disabled"}
                          </Badge>
                        </h4>
                        <p className="text-xs text-slate-400">
                          Automatically upload encrypted database snapshots and POS backups to Google Drive.
                        </p>
                      </div>
                    </div>
                    <Toggle
                      label="Enable Drive Backup"
                      checked={driveConfig.enabled}
                      onChange={(v) => updatePath("external_integrations.google_drive.enabled", v)}
                    />
                  </div>

                  {driveConfig.enabled && (
                    <div className="space-y-3 pt-2">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Field
                          label="Google Client ID / Service Account"
                          value={driveConfig.client_id}
                          placeholder="xxxx.apps.googleusercontent.com"
                          onChange={(v) => updatePath("external_integrations.google_drive.client_id", v)}
                        />
                        <Field
                          label="Target Folder ID"
                          value={driveConfig.folder_id}
                          placeholder="e.g. 1A2b3C4d5E..."
                          onChange={(v) => updatePath("external_integrations.google_drive.folder_id", v)}
                        />
                        <label className="flex flex-col gap-1.5">
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Upload Schedule</span>
                          <Select
                            value={driveConfig.backup_frequency || "Daily"}
                            onChange={(e) => updatePath("external_integrations.google_drive.backup_frequency", e.target.value)}
                          >
                            <option value="Daily">Daily (At 02:00 AM)</option>
                            <option value="TwiceDaily">Twice Daily (12-hour)</option>
                            <option value="Weekly">Weekly (Sundays)</option>
                            <option value="Realtime">On Each Shift Close</option>
                          </Select>
                        </label>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                        <Toggle
                          label="Auto-Upload After Backup Creation"
                          hint="Immediately sync newly created local archives"
                          checked={driveConfig.auto_upload}
                          onChange={(v) => updatePath("external_integrations.google_drive.auto_upload", v)}
                        />
                        <div className="flex items-end">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="w-full h-[38px] flex items-center justify-center gap-2"
                            onClick={handleTestDrive}
                            disabled={testingDrive || !driveConfig.client_id}
                          >
                            {testingDrive ? <Settings2 className="animate-spin" size={14} /> : <Cloud size={14} />}
                            {testingDrive ? "Verifying..." : "Verify Drive Access"}
                          </Button>
                        </div>
                      </div>

                      {driveResult && (
                        <div
                          className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
                            driveResult.ok
                              ? "bg-emerald-950/30 border-emerald-500/30 text-emerald-300"
                              : "bg-rose-950/30 border-rose-500/30 text-rose-300"
                          }`}
                        >
                          {driveResult.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                          <span>{driveResult.message}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Accounting Software Sync Card */}
            {(() => {
              const [testingAccount, setTestingAccount] = useState(false);
              const [accountResult, setAccountResult] = useState(null);
              const accConfig = data.external_integrations?.accounting_software || {
                enabled: false,
                provider: "QuickBooks Online",
                client_id: "",
                client_secret: "",
                realm_id: "",
                auto_sync_daily_sales: true,
                auto_sync_expenses: true,
              };

              const handleTestAccounting = async () => {
                setTestingAccount(true);
                setAccountResult(null);
                try {
                  const res = await api.post("/settings/integrations/test-accounting", accConfig);
                  setAccountResult({ ok: true, message: res.data?.message || "Accounting sync verified!" });
                  toast("Accounting ledger connection verified!", "success");
                } catch (err) {
                  const msg = err.response?.data?.detail || err.message || "Failed to verify accounting link";
                  setAccountResult({ ok: false, message: msg });
                  toast(`Accounting Sync error: ${msg}`, "error");
                } finally {
                  setTestingAccount(false);
                }
              };

              return (
                <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-b from-violet-950/20 to-slate-950/60 p-5 space-y-4 shadow-xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400">
                        <Landmark size={20} />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                          Accounting & General Ledger Sync
                          <Badge tone={accConfig.enabled ? "green" : "slate"}>
                            {accConfig.enabled ? `${accConfig.provider} Connected` : "Disabled"}
                          </Badge>
                        </h4>
                        <p className="text-xs text-slate-400">
                          Automatically post daily sales receipts, repair service income, and supplier expenses to your ledger.
                        </p>
                      </div>
                    </div>
                    <Toggle
                      label="Enable Sync"
                      checked={accConfig.enabled}
                      onChange={(v) => updatePath("external_integrations.accounting_software.enabled", v)}
                    />
                  </div>

                  {accConfig.enabled && (
                    <div className="space-y-3 pt-2">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <label className="flex flex-col gap-1.5">
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Platform</span>
                          <Select
                            value={accConfig.provider || "QuickBooks Online"}
                            onChange={(e) => updatePath("external_integrations.accounting_software.provider", e.target.value)}
                          >
                            <option value="QuickBooks Online">QuickBooks Online (Intuit)</option>
                            <option value="Xero">Xero Accounting</option>
                            <option value="Custom Webhook">Custom Accounting Webhook</option>
                          </Select>
                        </label>
                        <Field
                          label="Client / API ID"
                          value={accConfig.client_id}
                          placeholder="OAuth Client ID..."
                          onChange={(v) => updatePath("external_integrations.accounting_software.client_id", v)}
                        />
                        <Field
                          label="Company / Realm ID"
                          value={accConfig.realm_id}
                          placeholder="e.g. 913035..."
                          onChange={(v) => updatePath("external_integrations.accounting_software.realm_id", v)}
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                        <Toggle
                          label="Auto-Sync Daily Sales"
                          hint="Post closing sales totals daily"
                          checked={accConfig.auto_sync_daily_sales}
                          onChange={(v) => updatePath("external_integrations.accounting_software.auto_sync_daily_sales", v)}
                        />
                        <Toggle
                          label="Auto-Sync Expenses"
                          hint="Post store expenses to ledger"
                          checked={accConfig.auto_sync_expenses}
                          onChange={(v) => updatePath("external_integrations.accounting_software.auto_sync_expenses", v)}
                        />
                        <div className="flex items-end">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="w-full h-[38px] flex items-center justify-center gap-2"
                            onClick={handleTestAccounting}
                            disabled={testingAccount || !accConfig.client_id}
                          >
                            {testingAccount ? <Settings2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                            {testingAccount ? "Verifying..." : "Verify Ledger Link"}
                          </Button>
                        </div>
                      </div>

                      {accountResult && (
                        <div
                          className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
                            accountResult.ok
                              ? "bg-emerald-950/30 border-emerald-500/30 text-emerald-300"
                              : "bg-rose-950/30 border-rose-500/30 text-rose-300"
                          }`}
                        >
                          {accountResult.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                          <span>{accountResult.message}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="pt-2">
              <WhatsAppSettingsCard />
            </div>
          </div>
        );
      },
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
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Toggle label="Debug mode" checked={data.developer_advanced.debug_mode} onChange={(v) => updatePath("developer_advanced.debug_mode", v)} />
            <Toggle label="API access enabled" checked={data.developer_advanced.api_access} onChange={(v) => updatePath("developer_advanced.api_access", v)} />
            <Field label="API key" value={data.developer_advanced.api_key} onChange={(v) => updatePath("developer_advanced.api_key", v)} />
            <Field label="Webhook URL" value={data.developer_advanced.webhook_url} onChange={(v) => updatePath("developer_advanced.webhook_url", v)} />
            <label className="flex flex-col gap-1.5 md:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Log level</span>
              <div className="flex gap-3 items-center">
                <Select className="flex-1" value={data.developer_advanced.log_level || "Error"} onChange={(e) => updatePath("developer_advanced.log_level", e.target.value)}>
                  <option>Error</option>
                  <option>Warning</option>
                  <option>Info</option>
                  <option>Debug</option>
                </Select>
                <Button size="sm" variant="secondary" onClick={() => toast("Cache clear executed (simulation).", "warning")}>
                  Clear Cache
                </Button>
              </div>
            </label>
          </div>

          <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4 space-y-3">
            <p className="text-xs font-bold text-slate-200">System Updates & Diagnostics</p>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button size="sm" variant="secondary" onClick={checkForUpdates} disabled={checkingForUpdate}>
                <Settings2 size={13} /> {checkingForUpdate ? "Checking…" : "Check for Updates"}
              </Button>
              <Button size="sm" variant="secondary" onClick={handleDownloadUpdate} disabled={updaterStatus === "downloading"}>
                <PlugZap size={13} /> {updaterStatus === "downloading" ? "Downloading…" : "Download Update"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  window.open("/api/v1/settings/support-bundle", "_blank");
                  toast("Downloading diagnostic support bundle...", "info");
                }}
              >
                Export Diagnostic Bundle
              </Button>
            </div>
          </div>

          {window.istore?.autoLaunch && (
            <div className="pt-1">
              <Toggle
                label="Launch I-Store ERP automatically when Windows starts"
                checked={data.developer_advanced.auto_launch_enabled ?? false}
                onChange={async (v) => {
                  updatePath("developer_advanced.auto_launch_enabled", v);
                  try {
                    await window.istore.autoLaunch.set(v);
                    toast(v ? "Auto-launch enabled on Windows startup" : "Auto-launch disabled", "info");
                  } catch (err) {
                    toast("Failed to update auto-launch setting", "error");
                  }
                }}
              />
            </div>
          )}
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
