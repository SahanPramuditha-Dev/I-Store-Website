import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Search,
  Shield,
  ShieldAlert,
  Trash2,
  UserCog,
  Users,
} from "lucide-react";
import api from "../lib/api";
import { useFeedback } from "../components/FeedbackProvider";
import { AppTableHead, AppTableShell, Badge, Button, Input, KpiCard, SectionCard, Select, SensitiveActionIndicators, Table, WorkstationNotice } from "../components/UI";
import { savePermissions } from "../lib/rbac";
import AppDrawer from "../components/layout/AppDrawer";
import AppModal from "../components/layout/AppModal";

function toBool(v) {
  return Boolean(v);
}

function toneForRole(name) {
  const key = String(name || "").toLowerCase();
  if (key === "owner") return "amber";
  if (key === "admin") return "violet";
  if (key === "manager") return "indigo";
  if (key === "accountant") return "sky";
  if (key === "storekeeper") return "green";
  if (key === "technician") return "sky";
  if (key === "viewer" || key === "view_only") return "slate";
  return "indigo";
}

function permissionCode(row) {
  return String(row?.permission_key || row?.code || "");
}

function normalizeRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

function permissionMap(rows) {
  const map = {};
  for (const row of normalizeRows(rows)) {
    map[String(permissionCode(row))] = toBool(row.allowed);
  }
  return map;
}

const DEFAULT_ROLE_FORM = {
  name: "",
  display_name: "",
  description: "",
  level: 1,
};

export default function PermissionManagement() {
  const { toast, confirm } = useFeedback();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("roles");

  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [historyRows, setHistoryRows] = useState([]);

  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [selectedRolePermissions, setSelectedRolePermissions] = useState([]);
  const [sourceMap, setSourceMap] = useState({});
  const [draftMap, setDraftMap] = useState({});
  const [simulationRole, setSimulationRole] = useState(null);

  const [roleSearch, setRoleSearch] = useState("");
  const [permissionSearch, setPermissionSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [sensitiveOnly, setSensitiveOnly] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const [confirmSensitive, setConfirmSensitive] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  const [roleModal, setRoleModal] = useState({ open: false, mode: "create", values: { ...DEFAULT_ROLE_FORM } });

  const [selectedUserId, setSelectedUserId] = useState("");
  const [userOverrides, setUserOverrides] = useState([]);
  const [effectivePermissions, setEffectivePermissions] = useState([]);
  const [simulationUser, setSimulationUser] = useState(null);
  const [overrideDraft, setOverrideDraft] = useState({ permission_id: "", override_type: "allow", reason: "" });

  const selectedRole = useMemo(
    () => normalizeRows(roles).find((row) => Number(row.id) === Number(selectedRoleId)) || null,
    [roles, selectedRoleId]
  );

  const filteredRoles = useMemo(() => {
    const q = String(roleSearch || "").trim().toLowerCase();
    if (!q) return normalizeRows(roles);
    return normalizeRows(roles).filter((row) => {
      const hay = `${row.display_name || ""} ${row.name || ""} ${row.description || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [roles, roleSearch]);

  const roleUserIds = useMemo(
    () =>
      new Set(
        normalizeRows(employees)
          .filter((row) => Number(row.role_id) === Number(selectedRoleId))
          .map((row) => Number(row.id))
      ),
    [employees, selectedRoleId]
  );

  const affectedUsers = useMemo(
    () => normalizeRows(employees).filter((row) => roleUserIds.has(Number(row.id))),
    [employees, roleUserIds]
  );

  const affectedSessionsCount = useMemo(
    () => normalizeRows(sessions).filter((row) => roleUserIds.has(Number(row.user_id))).length,
    [sessions, roleUserIds]
  );

  const changedRows = useMemo(() => {
    const rows = [];
    const src = sourceMap || {};
    const draft = draftMap || {};
    for (const perm of permissions) {
      const code = permissionCode(perm);
      const a = toBool(src[code]);
      const b = toBool(draft[code]);
      if (a !== b) rows.push({ ...perm, old_allowed: a, new_allowed: b });
    }
    return rows;
  }, [permissions, sourceMap, draftMap]);

  const changedCount = changedRows.length;
  const sensitiveChanged = useMemo(
    () => changedRows.filter((row) => toBool(row.is_sensitive)),
    [changedRows]
  );

  const filteredPermissions = useMemo(() => {
    const q = String(permissionSearch || "").trim().toLowerCase();
    return normalizeRows(permissions).filter((row) => {
      const code = String(permissionCode(row)).toLowerCase();
      const module = String(row.module || "").toLowerCase();
      const action = String(row.action || "").toLowerCase();
      if (moduleFilter !== "all" && module !== String(moduleFilter || "").toLowerCase()) return false;
      if (sensitiveOnly && !toBool(row.is_sensitive)) return false;
      if (!q) return true;
      return code.includes(q) || module.includes(q) || action.includes(q);
    });
  }, [permissions, permissionSearch, moduleFilter, sensitiveOnly]);

  const modules = useMemo(
    () => [...new Set(normalizeRows(permissions).map((row) => String(row.module || "")))].filter(Boolean).sort(),
    [permissions]
  );

  const matrixByModule = useMemo(() => {
    const out = {};
    for (const row of filteredPermissions) {
      const module = String(row.module || "other");
      if (!out[module]) out[module] = [];
      out[module].push(row);
    }
    return out;
  }, [filteredPermissions]);

  const summaryKpis = useMemo(() => {
    const totalRoles = normalizeRows(roles).length;
    const totalPermissions = normalizeRows(permissions).length;
    const assignedPermissions = Object.values(draftMap || {}).filter(Boolean).length;
    const systemUsers = normalizeRows(employees).length;
    const customOverrides = userOverrides.length;
    const lockedRoles = normalizeRows(roles).filter((r) => r.is_locked || r.name === "owner").length;
    return [
      { title: "Total Roles", value: String(totalRoles), tone: "indigo" },
      { title: "Total Permissions", value: String(totalPermissions), tone: "sky" },
      { title: "Assigned Permissions", value: selectedRole ? String(assignedPermissions) : "-", tone: "green" },
      { title: "System Users", value: String(systemUsers), tone: "violet" },
      { title: "Custom Overrides", value: String(customOverrides), tone: "amber" },
      { title: "Locked Roles", value: String(lockedRoles), tone: "red" },
      { title: "Recent Changes", value: String(historyRows.length), tone: "indigo" },
    ];
  }, [roles, permissions, draftMap, selectedRole, employees, userOverrides.length, historyRows.length]);

  const loadBase = async () => {
    const [rolesRes, permsRes, usersRes, sessionsRes, historyRes] = await Promise.all([
      api.get("/access/roles"),
      api.get("/access/permissions"),
      api.get("/settings/employees"),
      api.get("/access/sessions").catch(() => ({ data: [] })),
      api.get("/access/permission-history?limit=120").catch(() => ({ data: { rows: [] } })),
    ]);
    const roleRows = normalizeRows(rolesRes?.data);
    const permsPayload = permsRes?.data || {};
    setRoles(roleRows);
    setPermissions(normalizeRows(permsPayload.permissions));
    setEmployees(normalizeRows(usersRes?.data));
    setSessions(normalizeRows(sessionsRes?.data));
    setHistoryRows(normalizeRows(historyRes?.data?.rows));
    if (!selectedRoleId && roleRows.length > 0) setSelectedRoleId(Number(roleRows[0].id));
  };

  const loadRolePermissions = async (roleId) => {
    if (!roleId) return;
    const { data } = await api.get(`/access/roles/${roleId}/permissions`);
    const rows = normalizeRows(data?.permissions);
    setSelectedRolePermissions(rows);
    const map = permissionMap(rows);
    setSourceMap(map);
    setDraftMap({ ...map });
    const sim = await api.get(`/access/simulate/role/${roleId}`).catch(() => ({ data: null }));
    setSimulationRole(sim?.data || null);
  };

  const loadUserOverrideContext = async (userId) => {
    if (!userId) {
      setUserOverrides([]);
      setEffectivePermissions([]);
      setSimulationUser(null);
      return;
    }
    const [ovRes, effRes, simRes] = await Promise.all([
      api.get(`/access/users/${userId}/overrides`),
      api.get(`/access/users/${userId}/effective-permissions`),
      api.get(`/access/simulate/user/${userId}`).catch(() => ({ data: null })),
    ]);
    setUserOverrides(normalizeRows(ovRes?.data?.overrides));
    setEffectivePermissions(normalizeRows(effRes?.data?.permissions));
    setSimulationUser(simRes?.data || null);
  };

  useEffect(() => {
    setLoading(true);
    loadBase()
      .catch((error) => toast(error?.response?.data?.detail || "Failed to load access control module", "error"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedRoleId) return;
    loadRolePermissions(selectedRoleId).catch((error) => {
      toast(error?.response?.data?.detail || "Failed to load role permissions", "error");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoleId]);

  useEffect(() => {
    loadUserOverrideContext(selectedUserId).catch((error) => {
      toast(error?.response?.data?.detail || "Failed to load user override context", "error");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId]);

  const setAllowed = (code, next) => {
    if (!selectedRole || selectedRole.is_locked || selectedRole.name === "owner") return;
    setDraftMap((prev) => ({ ...prev, [code]: toBool(next) }));
  };

  const saveRoleChanges = async (reviewed = false) => {
    if (!selectedRoleId || changedCount === 0) {
      toast("No permission changes to save", "warning");
      return;
    }
    if (String(changeReason || "").trim().length < 3) {
      toast("Enter a reason for this permission change", "warning");
      return;
    }
    if (sensitiveChanged.length > 0 && !confirmSensitive) {
      toast("Sensitive permission changes require confirmation", "warning");
      return;
    }
    if (!reviewed) {
      setReviewOpen(true);
      return;
    }
    const changes = changedRows.map((row) => ({
      permission_id: row.id,
      allowed: row.new_allowed,
    }));
    setSaving(true);
    try {
      const { data } = await api.put(`/access/roles/${selectedRoleId}/permissions`, {
        changes,
        reason: changeReason,
        confirm_sensitive: sensitiveChanged.length > 0 ? true : false,
      });
      if (Number(data?.revoked_sessions || 0) > 0) {
        toast(`Saved. ${data.revoked_sessions} sessions were revoked due to downgraded access.`, "warning");
      } else {
        toast("Role permissions updated", "success");
      }
      if (Number(selectedRole?.id || 0) === Number(localStorage.getItem("role_id") || 0)) {
        const permsRes = await api.get("/auth/me/permissions").catch(() => null);
        if (permsRes?.data?.permissions) savePermissions(permsRes.data.permissions);
      } else {
        const mePerms = await api.get("/auth/me/permissions").catch(() => null);
        if (mePerms?.data?.permissions) savePermissions(mePerms.data.permissions);
      }
      setChangeReason("");
      setConfirmSensitive(false);
      setReviewOpen(false);
      await loadBase();
      await loadRolePermissions(selectedRoleId);
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to save permission changes", "error");
    } finally {
      setSaving(false);
    }
  };

  const bulkRoleAction = async (action) => {
    if (!selectedRoleId) return;
    if ((selectedRole?.is_locked || selectedRole?.name === "owner") && action !== "copy") {
      toast("Locked role cannot be modified", "warning");
      return;
    }
    if (String(changeReason || "").trim().length < 3) {
      toast("Enter reason before applying bulk action", "warning");
      return;
    }
    const actionMap = {
      grant: "grant-all",
      revoke: "revoke-all",
      reset: "reset-defaults",
    };
    const target = actionMap[action];
    if (!target) return;
    try {
      await api.post(`/access/roles/${selectedRoleId}/${target}`, { reason: changeReason, confirm_sensitive: true });
      toast("Bulk permission action applied", "success");
      setChangeReason("");
      setConfirmSensitive(false);
      await loadBase();
      await loadRolePermissions(selectedRoleId);
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to apply bulk action", "error");
    }
  };

  const openCreateRole = () => {
    setRoleModal({ open: true, mode: "create", values: { ...DEFAULT_ROLE_FORM } });
  };

  const openEditRole = () => {
    if (!selectedRole) return;
    setRoleModal({
      open: true,
      mode: "edit",
      values: {
        name: selectedRole.name || "",
        display_name: selectedRole.display_name || "",
        description: selectedRole.description || "",
        level: Number(selectedRole.level || 1),
      },
    });
  };

  const submitRoleModal = async () => {
    const values = roleModal.values || {};
    const name = String(values.name || "").trim();
    const displayName = String(values.display_name || "").trim();
    if (!name || !displayName) {
      toast("Role name and display name are required", "warning");
      return;
    }
    try {
      if (roleModal.mode === "create") {
        const { data } = await api.post("/access/roles", values);
        setSelectedRoleId(Number(data?.id));
      } else if (selectedRoleId) {
        await api.patch(`/access/roles/${selectedRoleId}`, values);
      }
      setRoleModal({ open: false, mode: "create", values: { ...DEFAULT_ROLE_FORM } });
      await loadBase();
      toast("Role saved", "success");
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to save role", "error");
    }
  };

  const duplicateRole = async () => {
    if (!selectedRole) return;
    const ok = await confirm("Duplicate Role", `Create a copy of ${selectedRole.display_name || selectedRole.name}?`);
    if (!ok) return;
    try {
      const cloneName = `${selectedRole.name}_copy_${Date.now().toString().slice(-4)}`;
      const cloneDisplay = `${selectedRole.display_name || selectedRole.name} Copy`;
      const { data } = await api.post("/access/roles", {
        name: cloneName,
        display_name: cloneDisplay,
        description: `Copied from ${selectedRole.display_name || selectedRole.name}`,
        level: selectedRole.level || 1,
      });
      await api.post(`/access/roles/${data.id}/copy-from/${selectedRole.id}`, {
        reason: "Copied permissions from source role",
      });
      setSelectedRoleId(Number(data.id));
      await loadBase();
      toast("Role duplicated", "success");
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to duplicate role", "error");
    }
  };

  const deactivateRole = async () => {
    if (!selectedRole) return;
    if (selectedRole.is_locked || selectedRole.name === "owner") {
      toast("Locked role cannot be deactivated", "warning");
      return;
    }
    const ok = await confirm("Deactivate Role", `Deactivate ${selectedRole.display_name || selectedRole.name}?`);
    if (!ok) return;
    try {
      await api.patch(`/access/roles/${selectedRole.id}`, { is_active: false });
      await loadBase();
      toast("Role deactivated", "success");
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to deactivate role", "error");
    }
  };

  const deleteRole = async () => {
    if (!selectedRole) return;
    const ok = await confirm("Delete Role", `Delete ${selectedRole.display_name || selectedRole.name}?`);
    if (!ok) return;
    try {
      await api.delete(`/access/roles/${selectedRole.id}`);
      setSelectedRoleId(null);
      await loadBase();
      toast("Role deleted", "success");
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to delete role", "error");
    }
  };

  const addOverride = async () => {
    if (!selectedUserId) {
      toast("Select a user first", "warning");
      return;
    }
    if (!overrideDraft.permission_id) {
      toast("Select permission", "warning");
      return;
    }
    if (String(overrideDraft.reason || "").trim().length < 3) {
      toast("Override reason is required", "warning");
      return;
    }
    try {
      await api.put(`/access/users/${selectedUserId}/overrides`, {
        permission_id: Number(overrideDraft.permission_id),
        override_type: overrideDraft.override_type,
        reason: overrideDraft.reason,
      });
      setOverrideDraft({ permission_id: "", override_type: "allow", reason: "" });
      await loadUserOverrideContext(selectedUserId);
      toast("Override saved", "success");
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to save override", "error");
    }
  };

  const removeOverride = async (overrideId) => {
    try {
      await api.delete(`/access/users/${selectedUserId}/overrides/${overrideId}`);
      await loadUserOverrideContext(selectedUserId);
      toast("Override removed", "success");
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to remove override", "error");
    }
  };

  const forceLogoutSession = async (sessionId) => {
    try {
      await api.patch(`/access/sessions/${sessionId}/force-logout`, { reason: "Force logout from access control" });
      await loadBase();
      toast("Session terminated", "success");
    } catch (error) {
      toast(error?.response?.data?.detail || "Failed to terminate session", "error");
    }
  };

  if (loading) {
    return <div className="grid h-64 place-items-center text-slate-400">Loading Access Control Center...</div>;
  }

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pb-20 pr-1 xl:h-full xl:overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">I Store / Settings / Permission Management</div>
          <h1 className="text-xl font-black tracking-tight text-white flex items-center gap-3">
            <Shield className="text-indigo-300" />
            Permission Management
          </h1>
          <p className="text-xs text-slate-400 mt-1">Roles, permission matrix changes, user overrides, dry-run impact, and permission audit review.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={loadBase}>
            <RefreshCw size={14} /> Refresh
          </Button>
          <Button onClick={openCreateRole}>
            <Plus size={14} /> Add Role
          </Button>
        </div>
      </div>

      <WorkstationNotice
        tone="sky"
        title="Separated responsibility"
        text="Use Settings > Access Control for users, sessions, and login rules. Use this page for roles, permission matrix changes, user overrides, and permission audit review."
        right={<SensitiveActionIndicators items={["owner", "approval", "audit"]} />}
      />

      <div className="grid grid-cols-2 xl:grid-cols-7 gap-3">
        {summaryKpis.map((kpi) => (
          <KpiCard key={kpi.title} title={kpi.title} value={kpi.value} tone={kpi.tone} />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          ["roles", "Role Matrix"],
          ["overrides", "User Overrides"],
          ["sessions", "Sessions"],
          ["history", "Permission History"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
              activeTab === id ? "bg-indigo-500/20 border-indigo-400/40 text-indigo-100" : "bg-black/20 border-white/10 text-slate-400 hover:text-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "roles" && (
        <div className="grid min-h-[420px] flex-1 grid-cols-1 gap-3 xl:grid-cols-[260px_minmax(0,1fr)_320px] 2xl:grid-cols-[280px_minmax(0,1fr)_340px]">
          <SectionCard className="h-full min-h-0 flex flex-col" title="Roles">
            <div className="mb-2 relative">
              <Search size={13} className="absolute left-3 top-3 text-slate-500" />
              <Input className="pl-8" placeholder="Search roles..." value={roleSearch} onChange={(e) => setRoleSearch(e.target.value)} />
            </div>
            <div className="space-y-2 overflow-y-auto pr-1 custom-scrollbar">
              {filteredRoles.map((role) => {
                const selected = Number(selectedRoleId) === Number(role.id);
                return (
                  <button
                    key={role.id}
                    onClick={() => setSelectedRoleId(Number(role.id))}
                    className={`w-full text-left rounded-xl border px-3 py-2 transition-colors ${
                      selected ? "bg-indigo-500/15 border-indigo-400/40" : "bg-black/20 border-white/10 hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-sm text-slate-100">{role.display_name || role.name}</div>
                      <Badge tone={toneForRole(role.name)}>{role.name}</Badge>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 line-clamp-2">{role.description || "No description"}</div>
                    <div className="mt-1 text-[10px] text-slate-400 flex items-center gap-2">
                      <span>{role.user_count || 0} users</span>
                      <span>{role.permission_count || 0} perms</span>
                      {role.is_locked || role.name === "owner" ? <span className="text-amber-300 flex items-center gap-1"><Lock size={11} />Locked</span> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard
            className="h-full min-h-0 flex flex-col"
            title="Permission Matrix"
            subtitle="Toggle action-level permissions by module"
            right={
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => bulkRoleAction("grant")} disabled={!selectedRoleId || selectedRole?.is_locked}>
                  Grant All
                </Button>
                <Button size="sm" variant="secondary" onClick={() => bulkRoleAction("revoke")} disabled={!selectedRoleId || selectedRole?.is_locked}>
                  Revoke All
                </Button>
                <Button size="sm" variant="secondary" onClick={() => bulkRoleAction("reset")} disabled={!selectedRoleId || selectedRole?.is_locked}>
                  Reset Defaults
                </Button>
              </div>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2">
              <div className="md:col-span-2 relative">
                <Search size={13} className="absolute left-3 top-3 text-slate-500" />
                <Input className="pl-8" placeholder="Search permission..." value={permissionSearch} onChange={(e) => setPermissionSearch(e.target.value)} />
              </div>
              <Select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
                <option value="all">All Modules</option>
                {modules.map((module) => (
                  <option key={module} value={module}>
                    {module}
                  </option>
                ))}
              </Select>
              <button
                className={`rounded-xl border text-xs font-semibold px-3 py-2 ${sensitiveOnly ? "border-rose-400/40 text-rose-200 bg-rose-500/10" : "border-white/10 text-slate-300 bg-black/20"}`}
                onClick={() => setSensitiveOnly((v) => !v)}
              >
                Sensitive Only
              </button>
            </div>

            {(selectedRole?.is_locked || selectedRole?.name === "owner") && (
              <div className="mb-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 flex items-center gap-2">
                <ShieldAlert size={14} />
                Owner role is locked. Full system access cannot be modified.
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-white/10 bg-black/20">
              {Object.keys(matrixByModule).length === 0 ? (
                <div className="grid place-items-center h-full text-slate-500 text-sm">No permissions match current filters.</div>
              ) : (
                <div className="space-y-2 p-2">
                  {Object.entries(matrixByModule)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([module, rows]) => (
                      <div key={module} className="rounded-lg border border-white/10 overflow-hidden">
                        <div className="bg-white/5 px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-300">{module}</div>
                        <Table className="text-xs">
                          <thead>
                            <tr>
                              <th>Action</th>
                              <th>Permission Key</th>
                              <th>Sensitive</th>
                              <th>Allowed</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row) => {
                              const code = permissionCode(row);
                              const allowed = toBool(draftMap[code]);
                              return (
                                <tr key={code}>
                                  <td>{row.action}</td>
                                  <td className="font-mono">{code}</td>
                                  <td>{toBool(row.is_sensitive) ? <Badge tone="red">Sensitive</Badge> : <Badge tone="slate">No</Badge>}</td>
                                  <td>
                                    <label className="inline-flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={allowed}
                                        disabled={selectedRole?.is_locked || selectedRole?.name === "owner"}
                                        onChange={(e) => setAllowed(code, e.target.checked)}
                                      />
                                      <span className={allowed ? "text-emerald-300" : "text-slate-400"}>{allowed ? "Allowed" : "Blocked"}</span>
                                    </label>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </Table>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard className="h-full min-h-0 flex flex-col" title="Role Insights">
            {selectedRole ? (
              <>
                <div className="space-y-2 text-xs mb-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Role</span>
                    <Badge tone={toneForRole(selectedRole.name)}>{selectedRole.display_name || selectedRole.name}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Affected users</span>
                    <span className="text-slate-200 font-semibold">{affectedUsers.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Active sessions</span>
                    <span className="text-slate-200 font-semibold">{affectedSessionsCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Unsaved changes</span>
                    <span className="text-amber-200 font-semibold">{changedCount}</span>
                  </div>
                </div>

                {sensitiveChanged.length > 0 && (
                  <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100 mb-2">
                    <div className="font-semibold mb-1 flex items-center gap-1"><AlertTriangle size={13} /> Sensitive changes</div>
                    <div className="space-y-1 max-h-24 overflow-auto pr-1">
                      {sensitiveChanged.map((row) => (
                        <div key={row.id} className="font-mono">{permissionCode(row)}</div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-white/10 bg-black/25 p-2 mb-2">
                  <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-1">Access Simulation</div>
                  <div className="text-xs text-slate-300 mb-1">Visible Pages</div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {normalizeRows(simulationRole?.visible_sidebar_pages).slice(0, 8).map((path) => (
                      <Badge key={path} tone="green">{path}</Badge>
                    ))}
                  </div>
                  <div className="text-xs text-slate-300 mb-1">Blocked Actions</div>
                  <div className="max-h-20 overflow-auto pr-1 custom-scrollbar text-[11px] text-slate-400 space-y-1">
                    {normalizeRows(simulationRole?.blocked_actions).slice(0, 12).map((perm) => (
                      <div key={perm}>{perm}</div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-auto">
                  <Button size="sm" variant="secondary" onClick={openEditRole} disabled={selectedRole.is_locked || selectedRole.name === "owner"}>
                    <UserCog size={13} /> Edit
                  </Button>
                  <Button size="sm" variant="secondary" onClick={duplicateRole}>
                    <Copy size={13} /> Duplicate
                  </Button>
                  <Button size="sm" variant="secondary" onClick={deactivateRole} disabled={selectedRole.is_locked || selectedRole.name === "owner"}>
                    Deactivate
                  </Button>
                  <Button size="sm" variant="danger" onClick={deleteRole} disabled={selectedRole.is_system_role || selectedRole.is_locked || selectedRole.name === "owner"}>
                    <Trash2 size={13} /> Delete
                  </Button>
                </div>
              </>
            ) : (
              <div className="grid place-items-center h-full text-slate-500">Select a role to inspect</div>
            )}
          </SectionCard>
        </div>
      )}

      {activeTab === "overrides" && (
        <SectionCard title="User Permission Overrides" subtitle="Final permission = role permissions + allow overrides - deny overrides">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-2 mb-2">
            <Select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
              <option value="">Select user</option>
              {normalizeRows(employees).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name} (@{user.username})
                </option>
              ))}
            </Select>
            <Select value={overrideDraft.permission_id} onChange={(e) => setOverrideDraft((prev) => ({ ...prev, permission_id: e.target.value }))}>
              <option value="">Select permission</option>
              {normalizeRows(permissions).map((perm) => (
                <option key={perm.id} value={perm.id}>
                  {permissionCode(perm)}
                </option>
              ))}
            </Select>
            <Select value={overrideDraft.override_type} onChange={(e) => setOverrideDraft((prev) => ({ ...prev, override_type: e.target.value }))}>
              <option value="allow">Allow</option>
              <option value="deny">Deny</option>
            </Select>
            <Button onClick={addOverride}>
              <KeyRound size={13} /> Add Override
            </Button>
          </div>
          <Input
            placeholder="Override reason (required)"
            value={overrideDraft.reason}
            onChange={(e) => setOverrideDraft((prev) => ({ ...prev, reason: e.target.value }))}
            className="mb-3"
          />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <AppTableShell minWidth={680} maxHeightClass="max-h-[460px]" innerClassName="table table-compact text-xs" aria-label="User permission overrides">
                <AppTableHead>
                  <tr>
                    <th>Permission</th>
                    <th>Type</th>
                    <th>Reason</th>
                    <th>Action</th>
                  </tr>
                </AppTableHead>
                <tbody>
                  {userOverrides.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center py-6 text-slate-500">No overrides</td>
                    </tr>
                  )}
                  {userOverrides.map((row) => (
                    <tr key={row.id}>
                      <td className="font-mono">{row.permission_code}</td>
                      <td><Badge tone={row.override_type === "deny" ? "red" : "green"}>{row.override_type || row.effect}</Badge></td>
                      <td>{row.reason || "-"}</td>
                      <td>
                        <Button size="sm" variant="danger" onClick={() => removeOverride(row.id)}>Remove</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
            </AppTableShell>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">Effective Access</div>
              <div className="text-xs text-slate-300 mb-2">{effectivePermissions.length} permissions active</div>
              <div className="max-h-[150px] overflow-auto text-[11px] text-slate-400 space-y-1 mb-3">
                {effectivePermissions.slice(0, 120).map((code) => (
                  <div key={code} className="font-mono">{code}</div>
                ))}
              </div>
              <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-1">Simulation</div>
              <div className="text-xs text-slate-300 mb-1">Visible pages</div>
              <div className="flex flex-wrap gap-1 mb-2">
                {normalizeRows(simulationUser?.visible_sidebar_pages).slice(0, 10).map((path) => (
                  <Badge key={path} tone="green">{path}</Badge>
                ))}
              </div>
              <div className="text-xs text-slate-300 mb-1">Sensitive permissions</div>
              <div className="max-h-[80px] overflow-auto text-[11px] text-rose-200 space-y-1">
                {normalizeRows(simulationUser?.sensitive_permissions).map((code) => (
                  <div key={code}>{code}</div>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>
      )}

      {activeTab === "sessions" && (
        <SectionCard title="Active Sessions" subtitle="Force logout sessions after permission downgrades or security incidents">
          <AppTableShell minWidth={720} maxHeightClass="max-h-[min(560px,calc(100vh-260px))]" innerClassName="table table-compact text-xs" aria-label="Active user sessions">
              <AppTableHead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Device</th>
                  <th>IP</th>
                  <th>Login</th>
                  <th>Last Seen</th>
                  <th>Action</th>
                </tr>
              </AppTableHead>
              <tbody>
                {normalizeRows(sessions).map((row) => (
                  <tr key={row.session_id}>
                    <td>{row.user_name}</td>
                    <td>{row.role}</td>
                    <td>{row.device_name || "-"}</td>
                    <td>{row.ip_address || "-"}</td>
                    <td>{row.login_at || "-"}</td>
                    <td>{row.last_seen_at || "-"}</td>
                    <td>
                      <Button size="sm" variant="danger" onClick={() => forceLogoutSession(row.session_id)}>Force Logout</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
          </AppTableShell>
        </SectionCard>
      )}

      {activeTab === "history" && (
        <SectionCard title="Permission Change History" subtitle="Security-auditable change ledger">
          <AppTableShell minWidth={820} maxHeightClass="max-h-[min(560px,calc(100vh-260px))]" innerClassName="table table-compact text-xs" aria-label="Permission change history">
              <AppTableHead>
                <tr>
                  <th>Date</th>
                  <th>Changed By</th>
                  <th>Target</th>
                  <th>Permission</th>
                  <th>Old</th>
                  <th>New</th>
                  <th>Reason</th>
                  <th>Session</th>
                </tr>
              </AppTableHead>
              <tbody>
                {historyRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-6 text-slate-500">No permission changes found</td>
                  </tr>
                )}
                {historyRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.created_at || "-"}</td>
                    <td>{row.changed_by_name || row.changed_by || "-"}</td>
                    <td>{row.target_type}:{row.target_id}</td>
                    <td className="font-mono">{row.permission_key || "-"}</td>
                    <td>{row.old_value ? JSON.stringify(row.old_value) : "-"}</td>
                    <td>{row.new_value ? JSON.stringify(row.new_value) : "-"}</td>
                    <td>{row.reason || "-"}</td>
                    <td>{row.session_id || "-"}</td>
                  </tr>
                ))}
              </tbody>
          </AppTableShell>
        </SectionCard>
      )}

      {activeTab === "roles" && changedCount > 0 && (
        <div className="fixed bottom-3 left-0 right-0 px-4 z-40">
          <div className="mx-auto max-w-[1400px] rounded-xl border border-indigo-400/30 bg-slate-950/90 backdrop-blur-md px-3 py-3">
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_220px_220px] gap-2 items-center">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-center">
                <div className="text-xs text-slate-300">
                  <span className="font-semibold text-amber-200">{changedCount} unsaved changes</span> in {selectedRole?.display_name || "role"}.
                  {" "}Affected users: <span className="text-slate-100 font-semibold">{affectedUsers.length}</span>,
                  sessions: <span className="text-slate-100 font-semibold">{affectedSessionsCount}</span>.
                </div>
                <Input
                  placeholder="Reason for permission changes"
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                />
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={confirmSensitive} onChange={(e) => setConfirmSensitive(e.target.checked)} />
                Confirm Sensitive Changes
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setDraftMap({ ...(sourceMap || {}) })}>Discard</Button>
                <Button onClick={() => saveRoleChanges()} disabled={saving}>
                  <Save size={13} /> {saving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AppDrawer open={reviewOpen} onClose={() => setReviewOpen(false)} panelClassName="max-w-xl bg-slate-950">
            <div className="shrink-0 border-b border-white/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-300">Review Before Save</p>
                  <h3 className="mt-1 text-lg font-black text-white">Permission Change Summary</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    {selectedRole?.display_name || selectedRole?.name || "Selected role"} affects {affectedUsers.length} user(s) and {affectedSessionsCount} active session(s).
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setReviewOpen(false)}>Close</Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 custom-scrollbar">
              <WorkstationNotice
                tone="amber"
                title="Owner protection and audit policy"
                text="Owner permissions remain locked. Saving these changes records the reason, affected role, changed permissions, and session impact."
                right={<SensitiveActionIndicators items={["owner", "approval", "audit"]} />}
              />
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Changes</p>
                  <p className="mt-1 text-2xl font-black text-white">{changedCount}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Sensitive</p>
                  <p className="mt-1 text-2xl font-black text-amber-300">{sensitiveChanged.length}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Sessions</p>
                  <p className="mt-1 text-2xl font-black text-sky-300">{affectedSessionsCount}</p>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Reason</p>
                <p className="mt-1 text-sm text-slate-200">{changeReason || "No reason entered"}</p>
              </div>
              <div className="overflow-hidden rounded-xl border border-white/10">
                <Table className="table-compact table-sticky">
                  <thead>
                    <tr>
                      <th>Permission</th>
                      <th>Before</th>
                      <th>After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changedRows.slice(0, 14).map((row) => (
                      <tr key={permissionCode(row)}>
                        <td>
                          <p className="font-mono text-[11px] text-slate-200">{permissionCode(row)}</p>
                          {row.is_sensitive ? <Badge tone="amber">Sensitive</Badge> : null}
                        </td>
                        <td><Badge tone={row.old_allowed ? "green" : "slate"}>{row.old_allowed ? "Allowed" : "Denied"}</Badge></td>
                        <td><Badge tone={row.new_allowed ? "green" : "red"}>{row.new_allowed ? "Allowed" : "Denied"}</Badge></td>
                      </tr>
                    ))}
                    {changedRows.length > 14 ? (
                      <tr>
                        <td colSpan={3} className="text-center text-slate-500">+{changedRows.length - 14} more change(s)</td>
                      </tr>
                    ) : null}
                  </tbody>
                </Table>
              </div>
            </div>
            <div className="shrink-0 border-t border-white/10 p-4">
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={() => setReviewOpen(false)}>Back</Button>
                <Button variant="warning" onClick={() => saveRoleChanges(true)} disabled={saving}>
                  <Save size={13} /> {saving ? "Saving..." : "Confirm Save"}
                </Button>
              </div>
            </div>
      </AppDrawer>

      <AppModal
        open={roleModal.open}
        onClose={() => setRoleModal({ open: false, mode: "create", values: { ...DEFAULT_ROLE_FORM } })}
        title={roleModal.mode === "create" ? "Create Role" : "Edit Role"}
        panelClassName="max-w-xl bg-slate-950"
      >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-4">
              <Input
                placeholder="Role key (e.g. storekeeper)"
                value={roleModal.values.name}
                onChange={(e) => setRoleModal((prev) => ({ ...prev, values: { ...prev.values, name: e.target.value } }))}
                disabled={roleModal.mode === "edit"}
              />
              <Input
                placeholder="Display name"
                value={roleModal.values.display_name}
                onChange={(e) => setRoleModal((prev) => ({ ...prev, values: { ...prev.values, display_name: e.target.value } }))}
              />
              <Input
                placeholder="Description"
                className="md:col-span-2"
                value={roleModal.values.description}
                onChange={(e) => setRoleModal((prev) => ({ ...prev, values: { ...prev.values, description: e.target.value } }))}
              />
              <Input
                type="number"
                min={0}
                max={5}
                placeholder="Level"
                value={roleModal.values.level}
                onChange={(e) => setRoleModal((prev) => ({ ...prev, values: { ...prev.values, level: Number(e.target.value || 1) } }))}
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 bg-white/[0.02] p-4">
              <Button variant="secondary" onClick={() => setRoleModal({ open: false, mode: "create", values: { ...DEFAULT_ROLE_FORM } })}>
                Cancel
              </Button>
              <Button onClick={submitRoleModal}>
                <Check size={13} /> Save
              </Button>
            </div>
      </AppModal>
    </div>
  );
}
