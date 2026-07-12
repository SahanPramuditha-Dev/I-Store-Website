import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  BriefcaseBusiness,
  Coins,
  Edit3,
  Palette,
  Printer,
  Receipt,
  Save,
  Settings as SettingsIcon,
  Shield,
  Store,
  Trash2,
  UserPlus,
  Users,
  Wrench,
} from "lucide-react";
import api from "../lib/api";
import { useFeedback } from "../components/FeedbackProvider";
import { AppTableEmptyRow, AppTableHead, AppTableShell, Badge, Button, Input, Loading, SectionCard, Select, Table } from "../components/UI";
import InvoiceJobLabelCustomizer from "../components/settings/InvoiceJobLabelCustomizer";
import StoreProfileSettings from "../components/settings/StoreProfileSettings";
import AccessControlSettingsPanel from "../components/settings/AccessControlSettingsPanel";
import BusinessOpsSettings from "../components/settings/BusinessOpsSettings";
import FinancialSettingsPanel from "../components/settings/FinancialSettingsPanel";
import RepairSettingsPanel from "../components/settings/RepairSettingsPanel";
import NotificationsSettingsPanel from "../components/settings/NotificationsSettingsPanel";
import AppearanceSettingsPanel from "../components/settings/AppearanceSettingsPanel";
import SystemApisSettingsPanel from "../components/settings/SystemApisSettingsPanel";
import AppModal from "../components/layout/AppModal";

const TABS = [
  { id: "store_profile", label: "Store Profile", group: "Core", icon: Store },
  { id: "access_control", label: "Access Control", group: "Security", icon: Users },
  { id: "business_ops", label: "Business Ops", group: "Operations", icon: BriefcaseBusiness },
  { id: "financial_settings", label: "Financial Settings", group: "Finance", icon: Coins },
  { id: "repair_settings", label: "Repair Settings", group: "Operations", icon: Wrench },
  { id: "invoice_receipt_design", label: "Invoice & Receipt Design", group: "Documents", icon: Receipt },
  { id: "notifications_alerts", label: "Notifications & Alerts", group: "System", icon: Bell },
  { id: "appearance_display", label: "Appearance & Display", group: "System", icon: Palette },
  { id: "system_apis", label: "System & APIs", group: "System", icon: SettingsIcon },
];

const EMPTY_EMPLOYEE_FORM = {
  username: "",
  full_name: "",
  password: "",
  confirm_password: "",
  phone_number: "",
  email: "",
  role: "Cashier / Staff",
  pin: "",
  notes: "",
};

const SECTION_KEYS = [
  "store_profile",
  "access_control",
  "business_ops",
  "financial_settings",
  "repair_settings",
  "invoice_receipt_design",
  "notifications_alerts",
  "appearance_display",
  "backup_data",
  "system_apis",
];

const DEFAULT_SECTION_FORMS = {
  store_profile: {
    business_identity: {
      shop_name: "I Point",
      business_type: "Mobile Phone Shop",
      registration_number: "",
      tax_vat_number: "",
      shop_tagline: "",
    },
    contact_information: {
      primary_phone: "",
      secondary_phone: "",
      whatsapp_number: "",
      email_address: "",
      website_url: "",
    },
    address: {
      address_line_1: "",
      address_line_2: "",
      city: "",
      district: "",
      province: "",
      postal_code: "",
      country: "Sri Lanka",
    },
  },
  access_control: {
    role_definitions: [
      { role: "Owner", level: 5, description: "Full system access" },
      { role: "Admin", level: 4, description: "Administrative access" },
      { role: "Manager", level: 3, description: "Operations + reports" },
      { role: "Technician", level: 2, description: "Repair jobs only" },
      { role: "Cashier / Staff", level: 1, description: "POS + customers" },
      { role: "View Only", level: 0, description: "Read-only access" },
    ],
    permission_matrix: [
      { module: "Dashboard", owner: true, admin: true, manager: true, technician: true, cashier: true, view_only: true },
      { module: "POS / Billing", owner: true, admin: true, manager: true, technician: false, cashier: true, view_only: false },
      { module: "Repair Management", owner: true, admin: true, manager: true, technician: true, cashier: false, view_only: false },
      { module: "Inventory", owner: true, admin: true, manager: true, technician: false, cashier: false, view_only: false },
      { module: "Settings", owner: true, admin: true, manager: false, technician: false, cashier: false, view_only: false },
    ],
    session_security_rules: {
      session_timeout_minutes: 30,
      max_failed_login_attempts: 5,
      account_lockout_duration_minutes: 15,
      minimum_password_length: 8,
      require_complex_password: true,
      allow_concurrent_logins: false,
      pos_pin_login_enabled: true,
    },
  },
  business_ops: {
    sales_pos_rules: {
      allow_credit_sales: true,
      default_credit_limit: 50000,
      allow_split_payments: true,
      default_payment_method: "Cash",
    },
    discount_rules: {
      max_discount_cashier_percent: 10,
      max_discount_manager_percent: 25,
      max_discount_admin_percent: 100,
    },
    inventory_rules: {
      low_stock_threshold_default: 5,
      auto_generate_sku: true,
      sku_prefix: "IST-",
      sku_format: "IST-####",
    },
    repair_rules: {
      default_warranty_days: 30,
      sla_target_standard_hours: 24,
      sla_target_urgent_hours: 4,
      job_number_prefix: "JOB-",
      job_number_format: "JOB-YYYYMMDD-###",
    },
    customer_rules: {
      require_phone_for_new_customer: true,
      allow_duplicate_phone_numbers: false,
      customer_id_format: "CUS-####",
      dormant_customer_threshold_days: 90,
    },
    expense_rules: {
      require_receipt_reference_above: 1000,
      approval_required_above: 10000,
      petty_cash_limit: 5000,
      expense_categories: ["Rent", "Salary", "Utilities", "Marketing", "Miscellaneous"],
    },
  },
  financial_settings: {
    currency_locale: {
      currency: "LKR",
      currency_symbol: "LKR",
      decimal_places: 2,
      date_format: "DD/MM/YYYY",
      time_format: "12-hour",
    },
    tax_configuration: {
      enable_tax_on_sales: true,
      tax_name: "VAT",
      tax_rate_percent: 0,
      tax_mode: "Exclusive",
    },
    payment_methods: {
      cash: true,
      card: true,
      bank_transfer: true,
      credit: true,
      cheque: false,
      online_payment: false,
    },
    advance_payment_settings: {
      enable_repair_advance: true,
      enable_product_reservation_advance: true,
      require_advance_above_amount: 10000,
      default_minimum_advance_percentage: 30,
      allow_advance_greater_than_estimate: false,
      manager_approval_required_for_refund: true,
      manager_approval_required_for_cancellation: true,
      auto_apply_advance_to_final_invoice: true,
      reservation_expiry_days: 14,
    },
  },
  repair_settings: {
    repair_status_workflow: [
      { name: "Received", color: "blue", default: true },
      { name: "Diagnosing", color: "yellow", default: false },
      { name: "Repairing", color: "purple", default: false },
      { name: "Completed", color: "green", default: false },
      { name: "Delivered", color: "gray", default: false },
    ],
    repair_categories: ["Screen Replacement", "Battery Replacement", "Software / Flashing"],
    device_brands: ["Samsung", "Apple", "Redmi"],
  },
  invoice_receipt_design: {
    receipt_format: {
      paper_size: "80mm Thermal",
      orientation: "Portrait",
      font_size: "Medium",
    },
    header_configuration: {
      show_shop_logo: true,
      show_shop_name: true,
      show_address: true,
      show_phone_number: true,
    },
    body_configuration: {
      show_invoice_number: true,
      show_date_time: true,
      show_customer_name: true,
      show_tax_line: true,
    },
    footer_configuration: {
      show_thank_you_message: true,
      thank_you_text: "Thank you for your purchase!",
      show_return_policy: true,
      return_policy_text: "Items can be returned within 7 days.",
    },
  },
  notifications_alerts: {
    in_app_notifications: {
      low_stock_alert: { enabled: true, threshold: 5 },
      overdue_payment_alert: { enabled: true, days: 7 },
      failed_login_alert: { enabled: true, attempts: 3 },
    },
    notification_recipients: {
      owner: true,
      admin: true,
      manager: true,
      cashier: false,
      technician: false,
    },
  },
  appearance_display: {
    theme: {
      color_theme: "Dark",
      compact_mode: true,
    },
    table_display: {
      rows_per_page_default: 25,
      table_density: "Compact",
      sticky_table_headers: true,
    },
  },
  backup_data: {
    auto_backup: {
      enable_automatic_backup: true,
      backup_frequency: "Daily",
      backup_time: "02:00",
      backup_retention_days: 90,
    },
    data_export: {
      products_inventory: true,
      customers: true,
      suppliers: true,
      format: "CSV",
    },
  },
  system_apis: {
    system_information: {
      application_version: "v2.4.1",
      server_status: "Online",
    },
    barcode_scanner: {
      scanner_input_mode: "USB HID (Keyboard)",
      scan_suffix_character: "Enter",
      auto_focus_scan_field: true,
    },
    sms_gateway: {
      provider: "",
      sender_id: "iStore",
    },
  },
};

function buildClientFallbackState({ employees = [], lastBackup = null } = {}) {
  const state = {};
  for (const key of SECTION_KEYS) {
    state[key] = clone(DEFAULT_SECTION_FORMS[key] || {});
  }
  state._header = {
    total_staff: employees.length,
    active_logins: employees.filter((row) => row?.is_active).length,
    receipt_format: state.invoice_receipt_design?.receipt_format?.paper_size || "-",
    last_backup: lastBackup || null,
    system_version: "Local Fallback",
    license_status: "Unknown",
  };
  return hydrateSections(state);
}

function deepMergeDefaults(defaults, value) {
  if (Array.isArray(defaults)) {
    if (Array.isArray(value) && value.length > 0) return value;
    return defaults;
  }
  if (defaults && typeof defaults === "object") {
    const source = value && typeof value === "object" ? value : {};
    const out = { ...source };
    for (const [key, defaultVal] of Object.entries(defaults)) {
      out[key] = deepMergeDefaults(defaultVal, source[key]);
    }
    return out;
  }
  if (value === undefined || value === null) return defaults;
  return value;
}

function hydrateSections(inputState) {
  if (!inputState || typeof inputState !== "object") return inputState;
  const next = { ...inputState };
  for (const key of SECTION_KEYS) {
    next[key] = deepMergeDefaults(DEFAULT_SECTION_FORMS[key] || {}, inputState[key]);
  }
  return next;
}

function buildLegacyFallbackState({ printProfile, uiPreferences, businessPreferences, integrations, employees, lastBackup }) {
  const state = {
    store_profile: {
      business_identity: {
        shop_name: printProfile?.store_name || "I Point",
        registration_number: printProfile?.business_reg_no || "",
        tax_vat_number: printProfile?.tax_number || "",
        shop_tagline: printProfile?.slogan || "",
      },
      contact_information: {
        primary_phone: printProfile?.store_phone || "",
        email_address: printProfile?.store_email || "",
        website_url: printProfile?.store_website || "",
      },
      address: {
        address_line_1: printProfile?.store_address || "",
      },
    },
    access_control: {
      role_definitions: [
        { role: "Cashier / Staff", level: 1, description: "POS + basic operations" },
        { role: "Admin", level: 4, description: "System administration" },
      ],
      permission_matrix: [],
      session_security_rules: {},
    },
    business_ops: {},
    financial_settings: {
      currency_locale: {
        currency: businessPreferences?.currency || "LKR",
        date_format: businessPreferences?.date_format || "DD/MM/YYYY",
      },
      tax_configuration: {
        tax_rate_percent: businessPreferences?.tax_rate || 0,
      },
    },
    repair_settings: {},
    invoice_receipt_design: {
      receipt_format: {
        paper_size: printProfile?.format || "A4",
      },
      header_configuration: {
        show_shop_logo: !!printProfile?.show_logo,
      },
      footer_configuration: {
        thank_you_text: printProfile?.footer_note || "",
      },
    },
    notifications_alerts: {},
    appearance_display: {
      theme: {
        color_theme: uiPreferences?.theme === "light" ? "Light" : "Dark",
        compact_mode: !!uiPreferences?.compact_mode,
      },
    },
    backup_data: {},
    system_apis: {
      sms_gateway: {
        api_key: integrations?.whatsapp_api_key || "",
      },
    },
    _header: {
      total_staff: (employees || []).length,
      active_logins: (employees || []).filter((row) => row?.is_active).length,
      receipt_format: printProfile?.format || "-",
      last_backup: lastBackup || null,
      system_version: "Legacy API",
      license_status: "Unknown",
    },
  };

  for (const key of SECTION_KEYS) {
    if (!state[key]) state[key] = {};
  }
  return hydrateSections(state);
}

function titleCase(text) {
  return String(text || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function ObjectEditor({ value, path = "", onChange, depth = 0 }) {
  if (value === null || value === undefined) return null;

  const entries = Object.entries(value);
  return (
    <div className={`space-y-3 ${depth > 0 ? "rounded-xl border border-white/10 bg-black/20 p-3" : ""}`}>
      {entries.map(([key, val]) => {
        const label = titleCase(key);
        const nextPath = path ? `${path}.${key}` : key;

        if (typeof val === "boolean") {
          return (
            <label key={nextPath} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
              <span className="text-xs font-semibold text-slate-200">{label}</span>
              <input type="checkbox" checked={val} onChange={(event) => onChange(nextPath, event.target.checked)} />
            </label>
          );
        }

        if (typeof val === "number") {
          return (
            <label key={nextPath} className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
              <Input type="number" value={val} onChange={(event) => onChange(nextPath, toNumber(event.target.value, 0))} />
            </label>
          );
        }

        if (typeof val === "string") {
          const isLong = val.length > 80 || val.includes("\n");
          return (
            <label key={nextPath} className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
              {isLong ? (
                <textarea className="field min-h-[90px]" value={val} onChange={(event) => onChange(nextPath, event.target.value)} />
              ) : (
                <Input value={val} onChange={(event) => onChange(nextPath, event.target.value)} />
              )}
            </label>
          );
        }

        if (Array.isArray(val)) {
          const primitiveList = val.every((item) => typeof item === "string" || typeof item === "number");
          if (primitiveList) {
            return (
              <label key={nextPath} className="flex flex-col gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
                <textarea
                  className="field min-h-[90px]"
                  value={val.join("\n")}
                  onChange={(event) => {
                    const list = event.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean);
                    onChange(nextPath, list);
                  }}
                />
                <span className="text-[10px] text-slate-500">One item per line</span>
              </label>
            );
          }
          return (
            <label key={nextPath} className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
              <textarea
                className="field min-h-[120px] font-mono text-[11px]"
                value={JSON.stringify(val, null, 2)}
                onChange={(event) => {
                  try {
                    const parsed = JSON.parse(event.target.value);
                    onChange(nextPath, parsed);
                  } catch {
                    // ignore invalid json while typing
                  }
                }}
              />
              <span className="text-[10px] text-slate-500">JSON array editor</span>
            </label>
          );
        }

        if (typeof val === "object") {
          return (
            <SectionCard key={nextPath} title={label}>
              <ObjectEditor value={val} path={nextPath} onChange={onChange} depth={depth + 1} />
            </SectionCard>
          );
        }

        return null;
      })}
    </div>
  );
}

export default function Settings() {
  const { toast, confirm, prompt } = useFeedback();
  const [activeTab, setActiveTab] = useState("store_profile");
  const [state, setState] = useState(() => buildClientFallbackState());
  const [legacyMode, setLegacyMode] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [employeeForm, setEmployeeForm] = useState(EMPTY_EMPLOYEE_FORM);
  const [editingEmployee, setEditingEmployee] = useState(null);

  const roleOptions = useMemo(() => {
    const defs = state?.access_control?.role_definitions || [];
    return defs.map((role) => role.role).filter(Boolean);
  }, [state]);
  const activeTabMeta = TABS.find((tab) => tab.id === activeTab) || TABS[0];

  const load = async () => {
    setLoading(true);
    let staffRows = [];
    let lastBackup = null;
    try {
      const employeesRes = await api.get("/settings/employees");
      staffRows = employeesRes.data || [];
      setEmployees(staffRows);
    } catch {
      setEmployees([]);
      staffRows = [];
    }

    try {
      try {
        const stateRes = await api.get("/settings/state");
        const payload = stateRes?.data;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          throw new Error("Invalid settings payload");
        }
        setState(hydrateSections(payload));
        setLegacyMode(false);
      } catch (stateError) {
        const status = stateError?.response?.status;
        if (status && status !== 404) throw stateError;

        const [printRes, uiRes, bizRes, integrationRes, backupRes] = await Promise.all([
          api.get("/settings/print-profile").catch(() => ({ data: {} })),
          api.get("/settings/ui-preferences").catch(() => ({ data: {} })),
          api.get("/settings/business-preferences").catch(() => ({ data: {} })),
          api.get("/settings/integrations").catch(() => ({ data: {} })),
          api.get("/backup/last").catch(() => ({ data: { last_backup_at: null } })),
        ]);
        lastBackup = backupRes?.data?.last_backup_at || null;

        const fallback = buildLegacyFallbackState({
          printProfile: printRes.data,
          uiPreferences: uiRes.data,
          businessPreferences: bizRes.data,
          integrations: integrationRes.data,
          employees: staffRows,
          lastBackup,
        });
        setState(hydrateSections(fallback));
        setLegacyMode(true);
        toast("Running in legacy settings mode. Restart backend to enable full Settings API.", "warning");
      }

    } catch (error) {
      setState(buildClientFallbackState({ employees: staffRows, lastBackup }));
      toast(error.response?.data?.detail || "Failed to load settings", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setSection = (section, updater) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = clone(prev);
      next[section] = typeof updater === "function" ? updater(next[section]) : updater;
      return next;
    });
  };

  const setByPath = (section, path, value) => {
    setSection(section, (src) => {
      const next = clone(src || {});
      const keys = path.split(".");
      let target = next;
      for (let i = 0; i < keys.length - 1; i += 1) {
        const k = keys[i];
        if (typeof target[k] !== "object" || target[k] === null) target[k] = {};
        target = target[k];
      }
      target[keys[keys.length - 1]] = value;
      return next;
    });
  };

  const resetSectionToDefaults = (section) => {
    setSection(section, (src) => deepMergeDefaults(DEFAULT_SECTION_FORMS[section] || {}, src || {}));
  };

  const saveSection = async (section) => {
    if (!state?.[section]) return;
    if (legacyMode) {
      toast("Legacy backend detected. Restart backend to enable section-based save.", "warning");
      return false;
    }
    setSaving((prev) => ({ ...prev, [section]: true }));
    try {
      await api.put(`/settings/section/${section}`, state[section]);
      const refreshed = await api.get("/settings/state");
      setState(hydrateSections(refreshed.data));
      toast(`${titleCase(section)} saved`, "success");
      return true;
    } catch (error) {
      toast(error.response?.data?.detail || `Failed to save ${titleCase(section)}`, "error");
      return false;
    } finally {
      setSaving((prev) => ({ ...prev, [section]: false }));
    }
  };

  const saveAll = async () => {
    if (!state) return;
    if (legacyMode) {
      toast("Legacy backend detected. Restart backend to enable full Save All.", "warning");
      return;
    }
    setSaving((prev) => ({ ...prev, all: true }));
    try {
      const payload = clone(state);
      delete payload._header;
      const res = await api.put("/settings/state", payload);
      setState(hydrateSections(res.data));
      toast("All settings saved", "success");
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to save all settings", "error");
    } finally {
      setSaving((prev) => ({ ...prev, all: false }));
    }
  };

  const createEmployee = async () => {
    if (!employeeForm.username || !employeeForm.full_name || !employeeForm.password) {
      toast("Username, full name, and password are required", "warning");
      return;
    }
    if (employeeForm.password !== employeeForm.confirm_password) {
      toast("Password confirmation does not match", "warning");
      return;
    }

    try {
      const payload = {
        username: employeeForm.username,
        full_name: employeeForm.full_name,
        password: employeeForm.password,
        role: employeeForm.role,
        phone_number: employeeForm.phone_number,
        email: employeeForm.email,
        pin: employeeForm.pin,
        notes: employeeForm.notes,
        is_active: true,
      };
      const { data } = await api.post("/settings/employees", payload);
      setEmployees((prev) => [...prev, data]);
      setEmployeeForm(EMPTY_EMPLOYEE_FORM);
      await load();
      toast("Employee account provisioned", "success");
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to create employee", "error");
    }
  };

  const toggleEmployee = async (employee) => {
    try {
      await api.put(`/settings/employees/${employee.id}`, { is_active: !employee.is_active });
      await load();
      toast("Employee status updated", "success");
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to update employee", "error");
    }
  };

  const saveEmployeeEdit = async () => {
    if (!editingEmployee) return;
    try {
      const payload = {
        full_name: editingEmployee.full_name,
        role: editingEmployee.role,
        phone_number: editingEmployee.phone_number,
        email: editingEmployee.email,
        pin: editingEmployee.pin,
        notes: editingEmployee.notes,
      };
      if (editingEmployee.new_password) payload.password = editingEmployee.new_password;
      await api.put(`/settings/employees/${editingEmployee.id}`, payload);
      setEditingEmployee(null);
      await load();
      toast("Employee updated", "success");
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to update employee", "error");
    }
  };

  const deleteEmployee = async (employee) => {
    const ok = await confirm("Delete Employee", `Delete ${employee.full_name}? This cannot be undone.`);
    if (!ok) return;
    try {
      await api.delete(`/settings/employees/${employee.id}`);
      await load();
      toast("Employee deleted", "success");
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to delete employee", "error");
    }
  };


  const renderAccessControl = () => {
    const matrix = state?.access_control?.permission_matrix || [];
    return (
      <div className="space-y-4">
        <SectionCard title="Create New Account">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input placeholder="Username" value={employeeForm.username} onChange={(e) => setEmployeeForm((p) => ({ ...p, username: e.target.value }))} />
            <Input placeholder="Full Name" value={employeeForm.full_name} onChange={(e) => setEmployeeForm((p) => ({ ...p, full_name: e.target.value }))} />
            <Input placeholder="Phone Number" value={employeeForm.phone_number} onChange={(e) => setEmployeeForm((p) => ({ ...p, phone_number: e.target.value }))} />
            <Input placeholder="Email" value={employeeForm.email} onChange={(e) => setEmployeeForm((p) => ({ ...p, email: e.target.value }))} />
            <Select value={employeeForm.role} onChange={(e) => setEmployeeForm((p) => ({ ...p, role: e.target.value }))}>
              {(roleOptions.length ? roleOptions : ["Cashier / Staff", "Manager", "Admin", "Owner"]).map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </Select>
            <Input placeholder="PIN (4-digit)" value={employeeForm.pin} onChange={(e) => setEmployeeForm((p) => ({ ...p, pin: e.target.value }))} />
            <Input type="password" placeholder="Password" value={employeeForm.password} onChange={(e) => setEmployeeForm((p) => ({ ...p, password: e.target.value }))} />
            <Input type="password" placeholder="Confirm Password" value={employeeForm.confirm_password} onChange={(e) => setEmployeeForm((p) => ({ ...p, confirm_password: e.target.value }))} />
            <Input placeholder="Notes" value={employeeForm.notes} onChange={(e) => setEmployeeForm((p) => ({ ...p, notes: e.target.value }))} />
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={createEmployee}><UserPlus size={14} /> Provision Account</Button>
          </div>
        </SectionCard>

        <SectionCard title="Staff List">
          <AppTableShell minWidth={680} maxHeightClass="max-h-[min(520px,calc(100vh-300px))]" innerClassName="table table-compact table-sticky text-xs" aria-label="Staff list">
              <AppTableHead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Actions</th>
                </tr>
              </AppTableHead>
              <tbody>
                {employees.length === 0 && (
                  <AppTableEmptyRow colSpan={6} title="No employees found" text="Provision staff accounts to manage role-based access." />
                )}
                {employees.map((employee) => (
                  <tr key={employee.id}>
                    <td>{employee.full_name}</td>
                    <td>@{employee.username}</td>
                    <td>{employee.role}</td>
                    <td><Badge tone={employee.is_active ? "green" : "red"}>{employee.is_active ? "Active" : "Inactive"}</Badge></td>
                    <td>{formatDateTime(employee.last_login)}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="px-2 py-1 rounded bg-sky-500/20 text-sky-200" onClick={() => setEditingEmployee({ ...employee, new_password: "" })}><Edit3 size={12} /></button>
                        <button className="px-2 py-1 rounded bg-amber-500/20 text-amber-100" onClick={() => toggleEmployee(employee)}>{employee.is_active ? "Disable" : "Enable"}</button>
                        <button className="px-2 py-1 rounded bg-rose-500/20 text-rose-200" onClick={() => deleteEmployee(employee)}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
          </AppTableShell>
        </SectionCard>

        <SectionCard title="Permission Matrix">
          <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/25">
            <Table className="text-xs">
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Owner</th>
                  <th>Admin</th>
                  <th>Manager</th>
                  <th>Technician</th>
                  <th>Cashier</th>
                  <th>View</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((row, idx) => (
                  <tr key={`${row.module}-${idx}`}>
                    <td>{row.module}</td>
                    {["owner", "admin", "manager", "technician", "cashier", "view_only"].map((col) => (
                      <td key={`${row.module}-${col}`}>
                        <input
                          type="checkbox"
                          checked={!!row[col]}
                          onChange={(event) => {
                            const next = clone(matrix);
                            next[idx][col] = event.target.checked;
                            setByPath("access_control", "permission_matrix", next);
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </SectionCard>

        <SectionCard title="Session & Security Rules">
          <ObjectEditor value={state?.access_control?.session_security_rules || {}} onChange={(path, value) => setByPath("access_control", `session_security_rules.${path}`, value)} />
        </SectionCard>

        <div className="flex justify-end">
          <Button onClick={() => saveSection("access_control")} disabled={saving.access_control}><Save size={14} /> {saving.access_control ? "Saving..." : "Save Access Control"}</Button>
        </div>
      </div>
    );
  };

  const renderGenericSection = (section) => {
    const sectionValue = state?.[section] || {};
    const isEmptyObject = typeof sectionValue === "object" && !Array.isArray(sectionValue) && Object.keys(sectionValue).length === 0;

    return (
      <div className="space-y-4">
        <SectionCard title={titleCase(section)}>
          {isEmptyObject ? (
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
              <p className="font-semibold">No fields found for this section.</p>
              <p className="mt-1 text-amber-200/80">You can restore the default structure for this tab.</p>
              <div className="mt-3">
                <Button variant="secondary" onClick={() => resetSectionToDefaults(section)}>Load Default Fields</Button>
              </div>
            </div>
          ) : (
            <ObjectEditor value={sectionValue} onChange={(path, value) => setByPath(section, path, value)} />
          )}
        </SectionCard>
      <div className="flex justify-end">
        <Button onClick={() => saveSection(section)} disabled={saving[section]}><Save size={14} /> {saving[section] ? "Saving..." : `Save ${titleCase(section)}`}</Button>
      </div>
      </div>
    );
  };

  const renderInvoiceCustomizer = () => (
    <InvoiceJobLabelCustomizer
      sectionValue={state?.invoice_receipt_design || {}}
      onSectionChange={(nextSection) => setSection("invoice_receipt_design", nextSection)}
      onSaveSection={() => saveSection("invoice_receipt_design")}
      saving={!!saving.invoice_receipt_design}
      toast={toast}
      confirm={confirm}
      prompt={prompt}
      storeProfile={state?.store_profile || {}}
    />
  );

  const renderStoreProfile = () => (
    <StoreProfileSettings
      sectionValue={state?.store_profile || {}}
      onSectionChange={(nextSection) => setSection("store_profile", nextSection)}
      onSaveSection={() => saveSection("store_profile")}
      saving={!!saving.store_profile}
      toast={toast}
      confirm={confirm}
      prompt={prompt}
    />
  );

  const renderAccessControlPanel = () => (
    <AccessControlSettingsPanel
      sectionValue={state?.access_control || {}}
      onSectionChange={(nextSection) => setSection("access_control", nextSection)}
      onSaveSection={() => saveSection("access_control")}
      saving={!!saving.access_control}
      toast={toast}
      confirm={confirm}
      employees={employees}
      onReload={load}
    />
  );

  const renderBusinessOps = () => (
    <BusinessOpsSettings
      sectionValue={state?.business_ops || {}}
      onSectionChange={(nextSection) => setSection("business_ops", nextSection)}
      onSaveSection={() => saveSection("business_ops")}
      saving={!!saving.business_ops}
      toast={toast}
      confirm={confirm}
    />
  );

  const renderFinancialSettings = () => (
    <FinancialSettingsPanel
      sectionValue={state?.financial_settings || {}}
      onSectionChange={(nextSection) => setSection("financial_settings", nextSection)}
      onSaveSection={() => saveSection("financial_settings")}
      saving={!!saving.financial_settings}
      toast={toast}
      confirm={confirm}
    />
  );

  const renderRepairSettings = () => (
    <RepairSettingsPanel
      sectionValue={state?.repair_settings || {}}
      onSectionChange={(nextSection) => setSection("repair_settings", nextSection)}
      onSaveSection={() => saveSection("repair_settings")}
      saving={!!saving.repair_settings}
      toast={toast}
      confirm={confirm}
    />
  );

  const renderNotificationsSettings = () => (
    <NotificationsSettingsPanel
      sectionValue={state?.notifications_alerts || {}}
      onSectionChange={(nextSection) => setSection("notifications_alerts", nextSection)}
      onSaveSection={() => saveSection("notifications_alerts")}
      saving={!!saving.notifications_alerts}
      toast={toast}
      confirm={confirm}
    />
  );

  const renderAppearanceSettings = () => (
    <AppearanceSettingsPanel
      sectionValue={state?.appearance_display || {}}
      onSectionChange={(nextSection) => setSection("appearance_display", nextSection)}
      onSaveSection={() => saveSection("appearance_display")}
      saving={!!saving.appearance_display}
      toast={toast}
      confirm={confirm}
    />
  );

  const renderSystemApisSettings = () => (
    <SystemApisSettingsPanel
      sectionValue={state?.system_apis || {}}
      onSectionChange={(nextSection) => setSection("system_apis", nextSection)}
      onSaveSection={() => saveSection("system_apis")}
      saving={!!saving.system_apis}
      toast={toast}
      confirm={confirm}
    />
  );

  if (loading) return <Loading text="Loading settings module..." />;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl font-black tracking-tight text-white flex items-center gap-3">
            <Shield className="text-indigo-300" /> Settings - System Configuration
          </h1>
          <p className="text-xs text-slate-400 mt-1">Complete store, operations, finance, repair, notification, and infrastructure settings.</p>
          {legacyMode && (
            <p className="text-xs text-amber-300 mt-1">
              Legacy backend mode: `/settings/state` is unavailable. Restart backend to enable full settings persistence.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link to="/print-center" className="btn btn-secondary btn-sm">
            <Printer size={14} /> Print Center
          </Link>
          <Button onClick={saveAll} disabled={saving.all}><Save size={14} /> {saving.all ? "Saving..." : "Save All"}</Button>
        </div>
      </div>

      <div className="app-tab-strip shrink-0 rounded-2xl border border-white/10 bg-slate-900/60 p-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider border transition flex items-center gap-2 ${
                activeTab === tab.id ? "bg-indigo-500/20 border-indigo-400/40 text-indigo-100" : "bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10"
              }`}
            >
              <Icon size={13} /> {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-900/35 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-indigo-200">
            {activeTabMeta.group}
          </span>
          <span className="truncate text-sm font-bold text-slate-100">{activeTabMeta.label}</span>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Unsaved changes use section or Save All actions</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 custom-scrollbar">
        <div className="min-h-0 pr-1">
        {activeTab === "access_control"
          ? renderAccessControlPanel()
          : activeTab === "store_profile"
          ? renderStoreProfile()
          : activeTab === "business_ops"
          ? renderBusinessOps()
          : activeTab === "financial_settings"
          ? renderFinancialSettings()
          : activeTab === "repair_settings"
          ? renderRepairSettings()
          : activeTab === "invoice_receipt_design"
          ? renderInvoiceCustomizer()
          : activeTab === "notifications_alerts"
          ? renderNotificationsSettings()
          : activeTab === "appearance_display"
          ? renderAppearanceSettings()
          : activeTab === "system_apis"
          ? renderSystemApisSettings()
          : renderGenericSection(activeTab)}
        </div>
      </div>

      <AppModal
        open={!!editingEmployee}
        onClose={() => setEditingEmployee(null)}
        title="Edit Employee"
        panelClassName="max-w-2xl bg-slate-950"
      >
        {editingEmployee && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-5">
              <Input placeholder="Full Name" value={editingEmployee.full_name || ""} onChange={(e) => setEditingEmployee((p) => ({ ...p, full_name: e.target.value }))} />
              <Input placeholder="Role" value={editingEmployee.role || ""} onChange={(e) => setEditingEmployee((p) => ({ ...p, role: e.target.value }))} />
              <Input placeholder="Phone" value={editingEmployee.phone_number || ""} onChange={(e) => setEditingEmployee((p) => ({ ...p, phone_number: e.target.value }))} />
              <Input placeholder="Email" value={editingEmployee.email || ""} onChange={(e) => setEditingEmployee((p) => ({ ...p, email: e.target.value }))} />
              <Input placeholder="PIN" value={editingEmployee.pin || ""} onChange={(e) => setEditingEmployee((p) => ({ ...p, pin: e.target.value }))} />
              <Input placeholder="New Password" type="password" value={editingEmployee.new_password || ""} onChange={(e) => setEditingEmployee((p) => ({ ...p, new_password: e.target.value }))} />
              <Input className="md:col-span-2" placeholder="Notes" value={editingEmployee.notes || ""} onChange={(e) => setEditingEmployee((p) => ({ ...p, notes: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 bg-white/[0.02] p-5">
              <Button variant="secondary" onClick={() => setEditingEmployee(null)}>Cancel</Button>
              <Button onClick={saveEmployeeEdit}>Save</Button>
            </div>
          </>
        )}
      </AppModal>
    </div>
  );
}
