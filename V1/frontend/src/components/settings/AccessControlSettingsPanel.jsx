import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  MonitorSmartphone,
  Power,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Shield,
  ShieldPlus,
  Trash2,
  UserCog,
  UserPlus,
  Users,
} from "lucide-react";
import api from "../../lib/api";
import { Badge, Button, Input, KpiCard, SectionCard, Select, Table } from "../../components/UI";
import AppModal from "../layout/AppModal";
import { clone, deepMergeDefaults, formatDateTime, setPath } from "./utils";

const SUB_TABS = [
  { id: "staff_accounts", label: "Staff Accounts", icon: Users },
  { id: "active_sessions", label: "Active Sessions", icon: MonitorSmartphone },
  { id: "security_rules", label: "Security Rules", icon: KeyRound },
  { id: "audit_logs", label: "Audit Logs", icon: ScrollText },
];

const DEFAULTS = {
  role_definitions: [
    { role: "Owner", level: 5, description: "Full system access, billing, all settings" },
    { role: "Admin", level: 4, description: "All features except billing/license" },
    { role: "Manager", level: 3, description: "Operations + reports, no system settings" },
    { role: "Technician", level: 2, description: "Repair module only + own jobs" },
    { role: "Cashier / Staff", level: 1, description: "POS, basic customer operations" },
    { role: "View Only", level: 0, description: "Read-only access, no edits" },
  ],
  permission_matrix: [
    { module: "Dashboard", owner: true, admin: true, manager: true, technician: true, cashier: true, view_only: true },
    { module: "POS / Billing", owner: true, admin: true, manager: true, technician: false, cashier: true, view_only: false },
    { module: "Repair Management", owner: true, admin: true, manager: true, technician: true, cashier: false, view_only: false },
    { module: "Inventory", owner: true, admin: true, manager: true, technician: false, cashier: false, view_only: false },
    { module: "Customers", owner: true, admin: true, manager: true, technician: false, cashier: true, view_only: false },
    { module: "Reports (View)", owner: true, admin: true, manager: true, technician: false, cashier: false, view_only: true },
    { module: "Reports (Export)", owner: true, admin: true, manager: true, technician: false, cashier: false, view_only: false },
    { module: "Financial Audit", owner: true, admin: true, manager: true, technician: false, cashier: false, view_only: false },
    { module: "Audit Trail", owner: true, admin: true, manager: false, technician: false, cashier: false, view_only: false },
    { module: "Labels", owner: true, admin: true, manager: true, technician: true, cashier: true, view_only: false },
    { module: "Suppliers", owner: true, admin: true, manager: true, technician: false, cashier: false, view_only: false },
    { module: "Expenses", owner: true, admin: true, manager: true, technician: false, cashier: false, view_only: false },
    { module: "Settings", owner: true, admin: true, manager: false, technician: false, cashier: false, view_only: false },
    { module: "Backup", owner: true, admin: true, manager: false, technician: false, cashier: false, view_only: false },
  ],
  session_security_rules: {
    session_timeout_minutes: 30,
    max_failed_login_attempts: 5,
    account_lockout_duration_minutes: 15,
    require_password_change_days: 90,
    minimum_password_length: 8,
    require_complex_password: true,
    allow_concurrent_logins: false,
    after_hours_login_mode: "Alert only",
    pos_pin_login_enabled: true,
    pin_length: 4,
  },
  active_sessions: [],
};

const EMPTY_FORM = {
  full_name: "",
  username: "",
  phone_number: "",
  email: "",
  role: "Cashier / Staff",
  pin: "",
  password: "",
  confirm_password: "",
  notes: "",
};

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "NA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function roleToKey(roleName) {
  const key = String(roleName || "").toLowerCase();
  if (key.includes("owner")) return "owner";
  if (key.includes("admin")) return "admin";
  if (key.includes("manager")) return "manager";
  if (key.includes("technician")) return "technician";
  if (key.includes("view")) return "view_only";
  return "cashier";
}

function normalizeRoleTone(roleName) {
  const key = roleToKey(roleName);
  if (key === "owner") return "amber";
  if (key === "admin") return "violet";
  if (key === "manager") return "indigo";
  if (key === "technician") return "sky";
  if (key === "view_only") return "slate";
  return "green";
}

function isSuspiciousSession(session) {
  if (session?.is_suspicious) return true;
  const ip = String(session?.ip_address || "");
  if (!ip) return false;
  if (ip === "127.0.0.1" || ip.startsWith("192.168.") || ip.startsWith("10.")) return false;
  return true;
}

function makeFallbackSessions(employees) {
  const now = Date.now();
  return (employees || [])
    .filter((row) => row?.is_active)
    .slice(0, 8)
    .map((row, idx) => {
      const started = row?.last_login ? new Date(row.last_login).getTime() : now - (idx + 1) * 45 * 60 * 1000;
      return {
        session_id: `sess-${row.id}-${idx + 1}`,
        user_id: row.id,
        user_name: row.full_name,
        role: row.role,
        device_info: idx % 2 === 0 ? "Windows Desktop - Chrome" : "Android Tablet - WebView",
        ip_address: idx === 0 ? "127.0.0.1" : idx % 3 === 0 ? "8.214.53.19" : `192.168.1.${10 + idx}`,
        location: idx % 3 === 0 ? "External Network" : "Store LAN",
        login_time: new Date(started).toISOString(),
        status: "Active",
        is_current: idx === 0,
      };
    });
}

function isOwnerProtected(employee, roleDefinitions) {
  if (!employee) return false;
  const byName = String(employee.role || "").toLowerCase().includes("owner");
  if (byName) return true;
  const matched = (roleDefinitions || []).find((row) => String(row.role || "").toLowerCase() === String(employee.role || "").toLowerCase());
  if (matched && Number(matched.level || 0) >= 5) return true;
  if (String(employee.username || "").toLowerCase() === "owner") return true;
  return false;
}

export default function AccessControlSettingsPanel({
  sectionValue,
  onSectionChange,
  onSaveSection,
  saving,
  toast,
  confirm,
  employees = [],
  onReload,
}) {
  const data = useMemo(() => deepMergeDefaults(DEFAULTS, sectionValue || {}), [sectionValue]);
  const [subTab, setSubTab] = useState("staff_accounts");
  const [searchText, setSearchText] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editor, setEditor] = useState({ mode: "create", employeeId: null, values: clone(EMPTY_FORM) });
  const [showPin, setShowPin] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState(data?.role_definitions?.[0]?.role || "Owner");
  const [auditRows, setAuditRows] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [permissionCatalog, setPermissionCatalog] = useState([]);
  const [overrideModal, setOverrideModal] = useState({ open: false, user: null });
  const [overrideRows, setOverrideRows] = useState([]);
  const [overrideDraft, setOverrideDraft] = useState({ permission_id: "", effect: "allow", reason: "" });

  useEffect(() => {
    if (!SUB_TABS.some((tab) => tab.id === subTab)) setSubTab("staff_accounts");
  }, [subTab]);

  const patchSection = (mutate) => {
    const next = clone(data);
    mutate(next);
    onSectionChange(next);
  };

  const updatePath = (path, value) => patchSection((next) => setPath(next, path, value));

  const roleDefinitions = data.role_definitions || [];
  const roleOptions = roleDefinitions.map((row) => row.role).filter(Boolean);

  const effectiveSessions = useMemo(() => {
    if (Array.isArray(data.active_sessions) && data.active_sessions.length > 0) return data.active_sessions;
    return makeFallbackSessions(employees);
  }, [data.active_sessions, employees]);

  const onlineIds = useMemo(
    () =>
      new Set(
        effectiveSessions
          .filter((row) => row?.status === "Active")
          .map((row) => Number(row.user_id))
          .filter(Boolean)
      ),
    [effectiveSessions]
  );

  const filteredEmployees = useMemo(() => {
    const q = String(searchText || "").trim().toLowerCase();
    return (employees || []).filter((row) => {
      if (!row) return false;
      if (q) {
        const hay = `${row.full_name || ""} ${row.username || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (roleFilter !== "all" && String(row.role || "") !== roleFilter) return false;
      if (statusFilter !== "all") {
        const isOnline = onlineIds.has(Number(row.id));
        if (statusFilter === "online" && !isOnline) return false;
        if (statusFilter === "offline" && isOnline) return false;
      }
      return true;
    });
  }, [employees, onlineIds, roleFilter, searchText, statusFilter]);

  const selectedRoleDescription =
    roleDefinitions.find((row) => String(row.role || "") === String(editor.values.role || ""))?.description || "No description available.";

  const selectedRoleKey = roleToKey(selectedRole);
  const ownerRoleSelected = selectedRoleKey === "owner";
  const permissionCount = useMemo(() => {
    const matrix = data.permission_matrix || [];
    const enabled = matrix.filter((row) => !!row[selectedRoleKey]).length;
    return { enabled, total: matrix.length };
  }, [data.permission_matrix, selectedRoleKey]);

  const kpis = useMemo(() => {
    const staffCount = (employees || []).length;
    const onlineCount = (employees || []).filter((row) => onlineIds.has(Number(row.id))).length;
    const pendingReview = effectiveSessions.filter((row) => row.status === "Active" && isSuspiciousSession(row)).length;
    const lockoutMinutes = Number(data?.session_security_rules?.account_lockout_duration_minutes || 0);
    return [
      { title: "Total Staff", value: String(staffCount), tone: "indigo", icon: <Users size={16} /> },
      { title: "Online Staff", value: String(onlineCount), tone: onlineCount > 0 ? "green" : "slate", icon: <Power size={16} /> },
      { title: "Active Sessions", value: String(effectiveSessions.filter((row) => row.status === "Active").length), tone: "sky", icon: <MonitorSmartphone size={16} /> },
      { title: "Suspicious Sessions", value: String(pendingReview), tone: pendingReview > 0 ? "red" : "green", icon: <AlertTriangle size={16} /> },
      {
        title: "Permissions",
        value: `${permissionCount.enabled}/${permissionCount.total}`,
        tone: permissionCount.enabled === permissionCount.total ? "green" : "amber",
        icon: <Shield size={16} />,
      },
      { title: "Lockout Duration", value: `${lockoutMinutes} min`, tone: "violet", icon: <KeyRound size={16} /> },
    ];
  }, [data.session_security_rules, effectiveSessions, employees, onlineIds, permissionCount]);

  const loadAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const { data: payload } = await api.get("/settings/access-control/audit-logs", {
        params: { limit: 120, offset: 0 },
      });
      setAuditRows(payload?.rows || []);
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to load security audit logs.", "error");
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const { data: payload } = await api.get("/settings/access-control/rbac");
        setPermissionCatalog(payload?.permissions || []);
      } catch {
        setPermissionCatalog([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (subTab === "audit_logs") {
      loadAuditLogs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab]);

  const openCreate = () => {
    setEditor({
      mode: "create",
      employeeId: null,
      values: { ...clone(EMPTY_FORM), role: roleOptions[0] || "Cashier / Staff" },
    });
    setShowPin(false);
    setShowPassword(false);
    setModalOpen(true);
  };

  const openEdit = (employee) => {
    setEditor({
      mode: "edit",
      employeeId: employee.id,
      values: {
        full_name: employee.full_name || "",
        username: employee.username || "",
        phone_number: employee.phone_number || "",
        email: employee.email || "",
        role: employee.role || roleOptions[0] || "Cashier / Staff",
        pin: employee.pin || "",
        password: "",
        confirm_password: "",
        notes: employee.notes || "",
      },
    });
    setShowPin(false);
    setShowPassword(false);
    setModalOpen(true);
  };

  const submitAccount = async () => {
    const values = editor.values || {};
    if (!String(values.full_name || "").trim()) {
      toast("Full name is required.", "warning");
      return;
    }
    if (editor.mode === "create" && !String(values.username || "").trim()) {
      toast("Username is required.", "warning");
      return;
    }
    if (editor.mode === "create" && !String(values.password || "").trim()) {
      toast("Password is required.", "warning");
      return;
    }
    if ((values.password || values.confirm_password) && values.password !== values.confirm_password) {
      toast("Password confirmation does not match.", "warning");
      return;
    }

    try {
      if (editor.mode === "create") {
        await api.post("/settings/employees", {
          username: String(values.username || "").trim(),
          full_name: String(values.full_name || "").trim(),
          password: values.password,
          role: values.role,
          phone_number: values.phone_number || "",
          email: values.email || "",
          pin: values.pin || "",
          notes: values.notes || "",
          is_active: true,
        });
        toast("Staff account created.", "success");
      } else {
        const payload = {
          full_name: String(values.full_name || "").trim(),
          role: values.role,
          phone_number: values.phone_number || "",
          email: values.email || "",
          pin: values.pin || "",
          notes: values.notes || "",
        };
        if (values.password) payload.password = values.password;
        await api.put(`/settings/employees/${editor.employeeId}`, payload);
        toast("Staff account updated.", "success");
      }
      setModalOpen(false);
      if (onReload) await onReload();
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to save account.", "error");
    }
  };

  const toggleAccount = async (employee) => {
    if (isOwnerProtected(employee, roleDefinitions)) {
      toast("Owner account cannot be deactivated.", "warning");
      return;
    }
    try {
      await api.put(`/settings/employees/${employee.id}`, { is_active: !employee.is_active });
      toast("Account status updated.", "success");
      if (onReload) await onReload();
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to update account status.", "error");
    }
  };

  const deleteAccount = async (employee) => {
    if (isOwnerProtected(employee, roleDefinitions)) {
      toast("Owner account cannot be deleted.", "warning");
      return;
    }
    const ok = await confirm("Delete Account", `Delete ${employee.full_name}? This action cannot be undone.`);
    if (!ok) return;
    try {
      await api.delete(`/settings/employees/${employee.id}`);
      toast("Account deleted.", "success");
      if (onReload) await onReload();
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to delete account.", "error");
    }
  };

  const resetPassword = async (employee) => {
    const ok = await confirm("Reset Password", `Reset password for ${employee.full_name}?`);
    if (!ok) return;
    const tempPassword = `IST@${Math.random().toString(36).slice(-6)}A1`;
    try {
      await api.post(`/auth/users/${employee.id}/reset-password`, { new_password: tempPassword });
      toast(`Temporary password set: ${tempPassword}`, "success");
      if (onReload) await onReload();
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to reset password.", "error");
    }
  };

  const unlockAccount = async (employee) => {
    try {
      await api.post(`/settings/access-control/users/${employee.id}/unlock`);
      toast("Account unlocked.", "success");
      if (onReload) await onReload();
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to unlock account.", "error");
    }
  };

  const openOverrides = async (employee) => {
    setOverrideModal({ open: true, user: employee });
    setOverrideRows([]);
    setOverrideDraft({ permission_id: "", effect: "allow", reason: "" });
    try {
      const { data: payload } = await api.get(`/settings/access-control/users/${employee.id}/overrides`);
      setOverrideRows(payload?.overrides || []);
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to load permission overrides.", "error");
    }
  };

  const addOverride = async () => {
    if (!overrideModal.user) return;
    if (!overrideDraft.permission_id) {
      toast("Select a permission first.", "warning");
      return;
    }
    try {
      await api.put(`/settings/access-control/users/${overrideModal.user.id}/overrides`, {
        permission_id: Number(overrideDraft.permission_id),
        effect: overrideDraft.effect,
        reason: overrideDraft.reason || "",
      });
      const { data: payload } = await api.get(`/settings/access-control/users/${overrideModal.user.id}/overrides`);
      setOverrideRows(payload?.overrides || []);
      setOverrideDraft({ permission_id: "", effect: "allow", reason: "" });
      toast("Override saved.", "success");
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to save override.", "error");
    }
  };

  const removeOverride = async (permissionId) => {
    if (!overrideModal.user) return;
    try {
      await api.delete(`/settings/access-control/users/${overrideModal.user.id}/overrides/${permissionId}`);
      setOverrideRows((prev) => prev.filter((row) => Number(row.permission_id) !== Number(permissionId)));
      toast("Override removed.", "success");
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to remove override.", "error");
    }
  };

  const updatePermission = (moduleIndex, value) => {
    if (ownerRoleSelected) return;
    patchSection((next) => {
      if (!next.permission_matrix?.[moduleIndex]) return;
      next.permission_matrix[moduleIndex][selectedRoleKey] = value;
    });
  };

  const setAllPermissions = (value) => {
    if (ownerRoleSelected) return;
    patchSection((next) => {
      next.permission_matrix = (next.permission_matrix || []).map((row) => ({ ...row, [selectedRoleKey]: value }));
    });
  };

  const forceLogoutSession = async (sessionId) => {
    try {
      await api.post(`/settings/access-control/sessions/${encodeURIComponent(sessionId)}/terminate`);
      toast("Session terminated.", "success");
      if (onReload) await onReload();
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to terminate session.", "error");
    }
  };

  const forceLogoutAll = async () => {
    const ok = await confirm("Force Logout All", "Terminate all active sessions except current admin session?");
    if (!ok) return;
    try {
      await api.post("/settings/access-control/sessions/terminate-all", {});
      toast("All other sessions terminated.", "success");
      if (onReload) await onReload();
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to terminate sessions.", "error");
    }
  };

  const terminateSuspicious = async (sessionId) => forceLogoutSession(sessionId);

  const saveAccessControl = async () => {
    await onSaveSection();
    if (onReload) await onReload();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.title} title={kpi.title} value={kpi.value} tone={kpi.tone} icon={kpi.icon} />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-400/25 bg-sky-500/10 px-3 py-2.5">
        <div>
          <p className="text-sm font-bold text-sky-100">Access Control handles staff accounts, sessions, and login rules.</p>
          <p className="mt-0.5 text-xs text-sky-100/75">Role matrices, permission overrides, and risky permission changes are managed in the dedicated Permission Management page.</p>
        </div>
        <Link to="/permissions" className="btn btn-secondary btn-sm">
          <Shield size={13} /> Permission Management
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider border transition flex items-center gap-2 ${
                subTab === tab.id ? "bg-indigo-500/20 border-indigo-400/40 text-indigo-100" : "bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10"
              }`}
            >
              <Icon size={13} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {subTab === "staff_accounts" && (
        <div className="space-y-4">
          <SectionCard
            title="Staff Accounts"
            subtitle="Search, filter, and manage staff users."
            right={
              <div className="flex gap-2">
                <Button variant="secondary" onClick={onReload}>
                  <RefreshCw size={13} />
                  Refresh
                </Button>
                <Button onClick={openCreate}>
                  <UserPlus size={13} />
                  New Account
                </Button>
              </div>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
              <label className="md:col-span-2 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
                <Search size={14} className="text-slate-400" />
                <input
                  className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  placeholder="Search by name or username"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                />
              </label>
              <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                <option value="all">All Roles</option>
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </Select>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All Status</option>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
              </Select>
            </div>

            <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/25">
              <Table className="text-xs">
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Last Login</th>
                    <th>Created</th>
                    <th>Active</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-6 text-slate-500">
                        No staff records match the current filters.
                      </td>
                    </tr>
                  )}
                  {filteredEmployees.map((row) => {
                    const ownerProtected = isOwnerProtected(row, roleDefinitions);
                    const isOnline = onlineIds.has(Number(row.id));
                    return (
                      <tr key={row.id}>
                        <td>
                          <div className="flex items-center gap-2">
                            <span className="h-7 w-7 rounded-full bg-indigo-500/30 border border-indigo-300/30 grid place-items-center text-[10px] font-black text-indigo-100">
                              {initials(row.full_name)}
                            </span>
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-100 truncate">{row.full_name}</p>
                              {ownerProtected && <p className="text-[10px] text-amber-300">Protected account</p>}
                            </div>
                          </div>
                        </td>
                        <td>@{row.username}</td>
                        <td>
                          <Badge tone={normalizeRoleTone(row.role)}>{row.role || "-"}</Badge>
                        </td>
                        <td>
                          <div className="inline-flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${isOnline ? "bg-emerald-400" : "bg-slate-500"}`} />
                            <span className={isOnline ? "text-emerald-300" : "text-slate-400"}>{isOnline ? "Online" : "Offline"}</span>
                            {row.account_locked && <Badge tone="red">Locked</Badge>}
                          </div>
                        </td>
                        <td>{formatDateTime(row.last_login)}</td>
                        <td>{formatDateTime(row.created_on)}</td>
                        <td>
                          <label className="inline-flex items-center gap-2">
                            <input type="checkbox" checked={!!row.is_active} disabled={ownerProtected} onChange={() => toggleAccount(row)} />
                            <span className="text-slate-300">{row.is_active ? "Active" : "Inactive"}</span>
                          </label>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="secondary" onClick={() => openEdit(row)}>
                              <UserCog size={12} />
                              Edit
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => resetPassword(row)}>
                              <RotateCcw size={12} />
                              Reset
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => openOverrides(row)}>
                              <ShieldPlus size={12} />
                              Overrides
                            </Button>
                            <Button size="sm" variant="secondary" disabled={ownerProtected} onClick={() => toggleAccount(row)}>
                              <Power size={12} />
                              {row.is_active ? "Deactivate" : "Activate"}
                            </Button>
                            {row.account_locked && (
                              <Button size="sm" variant="secondary" onClick={() => unlockAccount(row)}>
                                <Lock size={12} />
                                Unlock
                              </Button>
                            )}
                            <Button size="sm" variant="danger" disabled={ownerProtected} onClick={() => deleteAccount(row)}>
                              <Trash2 size={12} />
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          </SectionCard>
        </div>
      )}

      {subTab === "roles_permissions" && (
        <div className="space-y-4">
          {ownerRoleSelected && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              Owner role is protected. All permissions are always granted and cannot be disabled.
            </div>
          )}
          <SectionCard
            title="Roles & Permissions"
            subtitle="Configure module access by role."
            right={
              <div className="inline-flex items-center gap-2">
                <Badge tone={permissionCount.enabled === permissionCount.total ? "green" : "amber"}>
                  {permissionCount.enabled}/{permissionCount.total} enabled
                </Badge>
              </div>
            }
          >
            <div className="flex flex-wrap gap-2 mb-4">
              {roleOptions.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setSelectedRole(role)}
                  className={`px-3 py-1.5 rounded-full border text-xs font-bold ${
                    selectedRole === role ? "border-indigo-400/50 bg-indigo-500/20 text-indigo-100" : "border-white/10 bg-white/5 text-slate-300"
                  }`}
                >
                  {role}
                </button>
              ))}
            </div>

            <div className="flex gap-2 mb-4">
              <Button size="sm" variant="secondary" disabled={ownerRoleSelected} onClick={() => setAllPermissions(true)}>
                Grant All
              </Button>
              <Button size="sm" variant="secondary" disabled={ownerRoleSelected} onClick={() => setAllPermissions(false)}>
                Revoke All
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {(data.permission_matrix || []).map((row, idx) => {
                const enabled = !!row[selectedRoleKey];
                return (
                  <button
                    key={`${row.module}-${idx}`}
                    type="button"
                    disabled={ownerRoleSelected}
                    onClick={() => updatePermission(idx, !enabled)}
                    className={`text-left rounded-xl border px-3 py-2.5 transition ${
                      enabled ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100" : "border-white/10 bg-black/20 text-slate-300"
                    } ${ownerRoleSelected ? "opacity-80 cursor-not-allowed" : "hover:border-indigo-400/40"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{row.module}</span>
                      <Badge tone={enabled ? "green" : "slate"}>{enabled ? "Allowed" : "Blocked"}</Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          </SectionCard>
        </div>
      )}

      {subTab === "active_sessions" && (
        <div className="space-y-4">
          <SectionCard
            title="Active Sessions"
            subtitle="Monitor sessions and terminate suspicious or unauthorized activity."
            right={
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={onReload}>
                  <RefreshCw size={13} />
                  Refresh
                </Button>
                <Button size="sm" variant="danger" onClick={forceLogoutAll}>
                  <Power size={13} />
                  Force Logout All
                </Button>
              </div>
            }
          >
            <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/25">
              <Table className="text-xs">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Device</th>
                    <th>IP</th>
                    <th>Location</th>
                    <th>Login Time</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {effectiveSessions.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-6 text-slate-500">
                        No active sessions.
                      </td>
                    </tr>
                  )}
                  {effectiveSessions.map((row) => {
                    const suspicious = isSuspiciousSession(row);
                    return (
                      <tr key={row.session_id || `${row.user_id}-${row.login_time}`} className={suspicious ? "bg-rose-500/10" : ""}>
                        <td>{row.user_name || "-"}</td>
                        <td>
                          <Badge tone={normalizeRoleTone(row.role)}>{row.role || "-"}</Badge>
                        </td>
                        <td>{row.device_info || "-"}</td>
                        <td>{row.ip_address || "-"}</td>
                        <td>{row.location || "-"}</td>
                        <td>{formatDateTime(row.login_time)}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <Badge tone={row.status === "Active" ? "green" : "slate"}>{row.status || "Unknown"}</Badge>
                            {suspicious && <Badge tone="red">Suspicious</Badge>}
                            {row.is_current && <Badge tone="sky">Current</Badge>}
                          </div>
                        </td>
                        <td>
                          <div className="flex gap-1">
                            <Button size="sm" variant="secondary" onClick={() => forceLogoutSession(row.session_id)}>
                              Force Logout
                            </Button>
                            {suspicious && (
                              <Button size="sm" variant="danger" onClick={() => terminateSuspicious(row.session_id)}>
                                Terminate Now
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          </SectionCard>
        </div>
      )}

      {subTab === "security_rules" && (
        <div className="space-y-4">
          <SectionCard title="Security Rules" subtitle="Authentication, lockout, PIN, and password policy settings.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Session timeout</span>
                <Input
                  type="number"
                  value={Number(data.session_security_rules.session_timeout_minutes || 0)}
                  onChange={(e) => updatePath("session_security_rules.session_timeout_minutes", Number(e.target.value || 0))}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Max failed login attempts</span>
                <Input
                  type="number"
                  value={Number(data.session_security_rules.max_failed_login_attempts || 0)}
                  onChange={(e) => updatePath("session_security_rules.max_failed_login_attempts", Number(e.target.value || 0))}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Account lockout duration (minutes)</span>
                <Input
                  type="number"
                  value={Number(data.session_security_rules.account_lockout_duration_minutes || 0)}
                  onChange={(e) => updatePath("session_security_rules.account_lockout_duration_minutes", Number(e.target.value || 0))}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">After-hours login mode</span>
                <Select
                  value={data.session_security_rules.after_hours_login_mode || "Alert only"}
                  onChange={(e) => updatePath("session_security_rules.after_hours_login_mode", e.target.value)}
                >
                  <option>Allow</option>
                  <option>Alert only</option>
                  <option>Block</option>
                </Select>
              </label>
              <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs">
                <span className="font-semibold text-slate-200">Block concurrent logins</span>
                <input
                  type="checkbox"
                  checked={!data.session_security_rules.allow_concurrent_logins}
                  onChange={(e) => updatePath("session_security_rules.allow_concurrent_logins", !e.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs">
                <span className="font-semibold text-slate-200">Enable POS PIN login</span>
                <input
                  type="checkbox"
                  checked={!!data.session_security_rules.pos_pin_login_enabled}
                  onChange={(e) => updatePath("session_security_rules.pos_pin_login_enabled", e.target.checked)}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">PIN length</span>
                <Select value={Number(data.session_security_rules.pin_length || 4)} onChange={(e) => updatePath("session_security_rules.pin_length", Number(e.target.value || 4))}>
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                  <option value={6}>6</option>
                </Select>
              </label>
              <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs">
                <span className="font-semibold text-slate-200">Require complex password</span>
                <input
                  type="checkbox"
                  checked={!!data.session_security_rules.require_complex_password}
                  onChange={(e) => updatePath("session_security_rules.require_complex_password", e.target.checked)}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Minimum password length</span>
                <Input
                  type="number"
                  value={Number(data.session_security_rules.minimum_password_length || 0)}
                  onChange={(e) => updatePath("session_security_rules.minimum_password_length", Number(e.target.value || 0))}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Force password reset interval (days)</span>
                <Input
                  type="number"
                  value={Number(data.session_security_rules.require_password_change_days || 0)}
                  onChange={(e) => updatePath("session_security_rules.require_password_change_days", Number(e.target.value || 0))}
                />
              </label>
            </div>
          </SectionCard>
        </div>
      )}

      {subTab === "audit_logs" && (
        <div className="space-y-4">
          <SectionCard
            title="Security Audit Logs"
            subtitle="Authentication, permission, and session-control events."
            right={(
              <Button size="sm" variant="secondary" onClick={loadAuditLogs} disabled={auditLoading}>
                <RefreshCw size={13} />
                {auditLoading ? "Loading..." : "Refresh"}
              </Button>
            )}
          >
            <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/25">
              <Table className="text-xs">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>User</th>
                    <th>Action</th>
                    <th>Target</th>
                    <th>Result</th>
                    <th>IP</th>
                    <th>Device</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {!auditLoading && auditRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-6 text-slate-500">
                        No security audit entries yet.
                      </td>
                    </tr>
                  )}
                  {auditRows.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDateTime(row.created_at)}</td>
                      <td>{row.user_name || "-"}</td>
                      <td>
                        <Badge tone="slate">{row.action || "-"}</Badge>
                      </td>
                      <td>{row.target_ref || row.target_type || "-"}</td>
                      <td>
                        <Badge tone={row.result === "success" ? "green" : row.result === "blocked" ? "amber" : "red"}>
                          {row.result || "-"}
                        </Badge>
                      </td>
                      <td>{row.ip_address || "-"}</td>
                      <td className="max-w-[240px] truncate" title={row.device_info || ""}>{row.device_info || "-"}</td>
                      <td className="max-w-[320px] truncate" title={row.detail || ""}>{row.detail || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </SectionCard>
        </div>
      )}

      <div className="sticky bottom-0 z-20">
        <div className="rounded-2xl border border-indigo-400/30 bg-slate-950/95 backdrop-blur p-3 flex items-center justify-between gap-3">
          <div className="text-sm text-slate-300">Save staff accounts, session controls, and login/security policy changes.</div>
          <Button onClick={saveAccessControl} disabled={saving}>
            <Shield size={13} />
            {saving ? "Saving..." : "Save Access Control"}
          </Button>
        </div>
      </div>

      <AppModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editor.mode === "create" ? "Create Staff Account" : "Edit Staff Account"}
        panelClassName="max-w-4xl bg-slate-950"
        headerActions={
          <button className="text-slate-400 hover:text-white" onClick={() => setModalOpen(false)}>
            Close
          </button>
        }
      >

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-5">
              <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Full Name</span>
                  <Input value={editor.values.full_name} onChange={(e) => setEditor((prev) => ({ ...prev, values: { ...prev.values, full_name: e.target.value } }))} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Username</span>
                  <Input
                    value={editor.values.username}
                    disabled={editor.mode === "edit"}
                    onChange={(e) => setEditor((prev) => ({ ...prev, values: { ...prev.values, username: e.target.value } }))}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Phone</span>
                  <Input value={editor.values.phone_number} onChange={(e) => setEditor((prev) => ({ ...prev, values: { ...prev.values, phone_number: e.target.value } }))} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Email</span>
                  <Input value={editor.values.email} onChange={(e) => setEditor((prev) => ({ ...prev, values: { ...prev.values, email: e.target.value } }))} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Role</span>
                  <Select value={editor.values.role} onChange={(e) => setEditor((prev) => ({ ...prev, values: { ...prev.values, role: e.target.value } }))}>
                    {roleOptions.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">PIN</span>
                  <div className="flex gap-2">
                    <Input
                      type={showPin ? "text" : "password"}
                      value={editor.values.pin}
                      onChange={(e) => setEditor((prev) => ({ ...prev, values: { ...prev.values, pin: e.target.value } }))}
                    />
                    <Button type="button" variant="secondary" onClick={() => setShowPin((prev) => !prev)}>
                      {showPin ? <EyeOff size={13} /> : <Eye size={13} />}
                    </Button>
                  </div>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    {editor.mode === "create" ? "Password" : "New Password (optional)"}
                  </span>
                  <div className="flex gap-2">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={editor.values.password}
                      onChange={(e) => setEditor((prev) => ({ ...prev, values: { ...prev.values, password: e.target.value } }))}
                    />
                    <Button type="button" variant="secondary" onClick={() => setShowPassword((prev) => !prev)}>
                      {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                    </Button>
                  </div>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Confirm Password</span>
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={editor.values.confirm_password}
                    onChange={(e) => setEditor((prev) => ({ ...prev, values: { ...prev.values, confirm_password: e.target.value } }))}
                  />
                  {editor.values.password || editor.values.confirm_password ? (
                    <span className={`text-[10px] ${editor.values.password === editor.values.confirm_password ? "text-emerald-300" : "text-rose-300"}`}>
                      {editor.values.password === editor.values.confirm_password ? "Passwords match" : "Passwords do not match"}
                    </span>
                  ) : null}
                </label>
                <label className="md:col-span-2 flex flex-col gap-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Notes</span>
                  <textarea
                    className="field min-h-[90px]"
                    value={editor.values.notes}
                    onChange={(e) => setEditor((prev) => ({ ...prev, values: { ...prev.values, notes: e.target.value } }))}
                  />
                </label>
              </div>

              <div className="space-y-3">
                <SectionCard title="Role Description">
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Selected Role</p>
                  <Badge tone={normalizeRoleTone(editor.values.role)}>{editor.values.role || "-"}</Badge>
                  <p className="text-sm text-slate-200 mt-3">{selectedRoleDescription}</p>
                </SectionCard>
                {String(editor.values.role || "").toLowerCase().includes("owner") && (
                  <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                    Owner accounts are protected and cannot be deleted or deactivated.
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-white/10 bg-white/[0.02] p-5">
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={submitAccount}>{editor.mode === "create" ? "Create Account" : "Save Changes"}</Button>
            </div>
      </AppModal>

      <AppModal
        open={overrideModal.open}
        onClose={() => setOverrideModal({ open: false, user: null })}
        title={`Permission Overrides - ${overrideModal.user?.full_name || "-"}`}
        panelClassName="max-w-4xl bg-slate-950"
        headerActions={
          <button className="text-slate-400 hover:text-white" onClick={() => setOverrideModal({ open: false, user: null })}>
            Close
          </button>
        }
      >

            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 p-5">
              <Select value={overrideDraft.permission_id} onChange={(e) => setOverrideDraft((p) => ({ ...p, permission_id: e.target.value }))}>
                <option value="">Select Permission</option>
                {permissionCatalog.map((perm) => (
                  <option key={perm.id} value={perm.id}>
                    {perm.module}.{perm.action}
                  </option>
                ))}
              </Select>
              <Select value={overrideDraft.effect} onChange={(e) => setOverrideDraft((p) => ({ ...p, effect: e.target.value }))}>
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
              </Select>
              <Input
                className="md:col-span-2"
                placeholder="Reason (optional)"
                value={overrideDraft.reason}
                onChange={(e) => setOverrideDraft((p) => ({ ...p, reason: e.target.value }))}
              />
            </div>
            <div className="flex justify-end px-5">
              <Button size="sm" onClick={addOverride}>Save Override</Button>
            </div>

            <div className="mx-5 mb-5 overflow-x-auto rounded-xl border border-white/10 bg-black/25">
              <Table className="text-xs">
                <thead>
                  <tr>
                    <th>Permission</th>
                    <th>Effect</th>
                    <th>Reason</th>
                    <th>Applied At</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {overrideRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-6 text-slate-500">
                        No user-specific overrides.
                      </td>
                    </tr>
                  )}
                  {overrideRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.permission_code}</td>
                      <td><Badge tone={row.effect === "allow" ? "green" : "red"}>{row.effect}</Badge></td>
                      <td>{row.reason || "-"}</td>
                      <td>{formatDateTime(row.created_at)}</td>
                      <td>
                        <Button size="sm" variant="danger" onClick={() => removeOverride(row.permission_id)}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
      </AppModal>
    </div>
  );
}
