import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Wrench,
  ClipboardList,
  Boxes,
  ShoppingCart,
  Truck,
  Users,
  BarChart3,
  Settings,
  Database,
  LogOut,
  Bell,
  Search,
  Moon,
  Sun,
  Barcode,
  History,
  ShieldCheck,
  Shield,
  Printer,
  Search as SearchIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  RotateCcw,
  Wallet,
  RefreshCw,
  MessageSquare,
  X,
  CheckCheck,
  ExternalLink,
  AlertTriangle,
  ShieldAlert,
  Clock,
  Sparkles,
  Building2,
  Store,
  ChevronDown,
  Check,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFetch } from "../hooks/useFetch";
import { useCachedQuery } from "../hooks/useCachedQuery";
import { canAccessPath, clearAuthState, getAuthValue, hasPermission, loadPermissions, NAV_PERMISSION_MAP } from "../lib/rbac";
import { normalizeRepairStatus, isRepairDelivered } from "../lib/repairStatus";
import api from "../lib/api";
import { useStoreProfile } from "../hooks/useStoreProfile";
import { useCapabilities } from "../context/CapabilityContext";
import { Button, WorkstationNotice } from "./UI";
import AIAssistant from "./ai/AIAssistant";
import UpdateNotification from "./UpdateNotification";

const navGroups = [
  {
    label: "Core Workspace",
    items: [
      ["/dashboard", "Dashboard", LayoutDashboard],
      ["/pos", "POS / Billing", ShoppingCart],
      ["/search", "Search Hub", SearchIcon],
    ],
  },
  {
    label: "Store Operations",
    items: [
      ["/repairs", "Repair Management", Wrench],
      ["/inventory/products", "Inventory", Boxes],
      ["/returns", "Returns & Refunds", RotateCcw],
      ["/warranty", "Warranty", Shield],
      ["/reservations", "Reservations", ClipboardList],
    ],
  },
  {
    label: "Finance & Purchasing",
    items: [
      ["/purchase", "Purchasing", Truck],
      ["/advances", "Advance Payments", Wallet],
      ["/expenses", "Expenses", Wallet],
      ["/financials", "Financial Audit", ShieldCheck],
    ],
  },
  {
    label: "Customer Management",
    items: [
      ["/customers", "Customers", Users],
    ],
  },
  {
    label: "Tools & Reports",
    items: [
      ["/reports", "Reports", BarChart3],
      ["/barcodes", "Labels", Barcode],
      ["/print-center", "Print Center", Printer],
    ],
  },
  {
    label: "System Administration",
    items: [
      ["/permissions", "Permissions", Shield],
      ["/audit", "Audit Trail", History],
      ["/notifications", "Notifications", Bell],
      ["/whatsapp", "WhatsApp Hub", MessageSquare],
      ["/backup", "Backup", Database],
      ["/settings", "Settings", Settings],
    ],
  },
];

function initials(name) {
  const s = (name || "").trim();
  if (!s) return "IS";
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function getNotificationCategoryIcon(source, type) {
  const s = String(source || "").toLowerCase();
  const t = String(type || "").toLowerCase();
  if (s === "backup" || t.includes("backup")) return <Database size={13} className="text-purple-400 shrink-0" />;
  if (s === "inventory" || t.includes("stock")) return <Boxes size={13} className="text-amber-400 shrink-0" />;
  if (s === "repairs" || t.includes("repair")) return <Wrench size={13} className="text-blue-400 shrink-0" />;
  if (s === "pos" || t.includes("balance") || t.includes("payment")) return <Wallet size={13} className="text-emerald-400 shrink-0" />;
  if (s === "warranty" || t.includes("warranty")) return <Shield size={13} className="text-cyan-400 shrink-0" />;
  return <Bell size={13} className="text-slate-400 shrink-0" />;
}

function getNotificationAction(item) {
  if (item?.action_url && item?.action_label) {
    return { url: item.action_url, label: item.action_label };
  }
  const s = String(item?.source_module || "").toLowerCase();
  const t = String(item?.type || "").toLowerCase();
  if (s === "backup" || t.includes("backup")) return { url: "/settings", label: "Backup Settings" };
  if (s === "inventory" || t.includes("stock")) return { url: "/inventory/products", label: "View Stock" };
  if (s === "repairs" || t.includes("repair")) return { url: "/repairs", label: "View Repair" };
  if (s === "pos" || t.includes("balance") || t.includes("payment")) return { url: "/pos", label: "Open POS" };
  if (s === "warranty" || t.includes("warranty")) return { url: "/warranty", label: "View Warranty" };
  return null;
}

function sanitizeMessage(msg) {
  if (!msg) return "";
  return msg.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?/g, (isoStr) => {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  });
}

export default function Layout() {
  const location = useLocation();
  const n = useNavigate();
  const [dark, setDark] = useState(() => (localStorage.getItem("theme") ?? "dark") === "dark");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 1920 : window.innerWidth));
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationTab, setNotificationTab] = useState("all"); // "all" | "unread" | "critical"
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [backendStatus, setBackendStatus] = useState({ available: true });
  const [checkingBackend, setCheckingBackend] = useState(false);
  const [queueLength, setQueueLength] = useState(0);
  const [tenantContext, setTenantContext] = useState(null);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
  const { data: repairs } = useCachedQuery("repairs", () => api.get("/repairs").then((res) => res.data));
  const { data: dashboardData } = useFetch("/dashboard");
  const { data: apiNotifications, refresh: refreshNotifications } = useFetch("/notifications");
  const { identity } = useStoreProfile();

  const fetchTenantContext = useCallback(() => {
    api.get("/settings/tenant/context")
      .then((res) => setTenantContext(res.data))
      .catch((_err) => {});
  }, []);

  useEffect(() => {
    fetchTenantContext();
  }, [fetchTenantContext]);

  const handleSwitchBranch = async (branchId) => {
    if (isSwitchingBranch) return;
    setIsSwitchingBranch(true);
    try {
      await api.post(`/settings/tenant/switch-branch/${branchId}`);
      setShowBranchDropdown(false);
      fetchTenantContext();
      window.location.reload();
    } catch (err) {
      console.error("Failed to switch branch:", err);
    } finally {
      setIsSwitchingBranch(false);
    }
  };

  const permissions = useMemo(() => loadPermissions(), [location.pathname]);
  const pendingRepairs = useMemo(() => {
    const rows = Array.isArray(repairs) ? repairs : (repairs?.items || []);
    if (rows.length > 0) {
      return rows.filter((r) => normalizeRepairStatus(r.status) === "pending").length;
    }
    if (dashboardData?.repair_stats?.pending !== undefined) {
      return Number(dashboardData.repair_stats.pending || 0);
    }
    return 0;
  }, [repairs, dashboardData]);

  const notifications = useMemo(() => {
    const list = Array.isArray(apiNotifications) ? apiNotifications : [];
    // Ensure strict frontend deduplication so multiple duplicates collapse into a single card
    const seen = new Set();
    const deduped = [];
    for (const item of list) {
      const key = item.entity_type && item.entity_id != null
        ? `${item.source_module || ""}-${item.entity_type}-${item.entity_id}`
        : `${item.source_module || ""}-${item.title}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push({
          ...item,
          message: sanitizeMessage(item.message),
        });
      }
    }
    return deduped;
  }, [apiNotifications]);

  const unreadNotifCount = useMemo(() => {
    return notifications.filter((item) => !item.is_read || !item.is_acknowledged).length;
  }, [notifications]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    const updateQueue = () => {
      try {
        const q = JSON.parse(localStorage.getItem("istore_sync_events_queue")) || [];
        setQueueLength(q.length);
      } catch {
        setQueueLength(0);
      }
    };
    updateQueue();
    const interval = setInterval(updateQueue, 2000);
    return () => clearInterval(interval);
  }, []);

  const { hasCapability } = useCapabilities();

  const visibleNavGroups = useMemo(
    () =>
      navGroups
        .map((group) => ({
          ...group,
          items: group.items.filter(([to]) => {
            // 1. RBAC permission check
            if (!hasPermission(NAV_PERMISSION_MAP[to], permissions)) return false;
            // 2. Capability check
            if (to.startsWith("/repairs") && !hasCapability("repairs_management")) return false;
            if (to.startsWith("/warranty") && !hasCapability("warranty_management")) return false;
            return true;
          }),
        }))
        .filter((group) => group.items.length > 0),
    [permissions, hasCapability]
  );
  const visibleFlatNav = visibleNavGroups.flatMap((g) => g.items);
  const crumb = visibleFlatNav.find(([to]) => location.pathname.startsWith(to))?.[1] ?? "Dashboard";
  const canOpenPath = useCallback((to) => canAccessPath(String(to || ""), permissions), [permissions]);
  const navigateIfAllowed = useCallback(
    (to) => {
      if (canOpenPath(to)) {
        n(to);
        return true;
      }
      n("/access-denied");
      return false;
    },
    [canOpenPath, n]
  );
  const notificationsAllowed = canOpenPath("/notifications");
  const settingsAllowed = canOpenPath("/settings");
  const shopName = identity?.shopName || "I Point";
  const softwareName = identity?.softwareName || "E Store";
  const brandInitials = initials(shopName);
  const displayName = localStorage.getItem("username") || "Store Admin";
  const roleLabel = localStorage.getItem("login_role_label") || localStorage.getItem("login_role") || "Staff";
  const commands = useMemo(
    () =>
      [
        { id: "open-pos", label: "Open POS", hint: "F2", to: "/pos" },
        { id: "create-repair", label: "Create Repair", hint: "Ctrl+R", to: "/repairs" },
        { id: "search-imei", label: "Search IMEI", hint: "Ctrl+I", to: "/search?focus=imei" },
        { id: "open-customer", label: "Open Customers", hint: "F3", to: "/customers" },
        { id: "open-invoice", label: "Open Invoices", hint: "F4", to: "/pos" },
        { id: "open-advances", label: "Open Advance Payments", hint: "ADV", to: "/advances" },
        { id: "open-notifications", label: "Open Notifications", hint: "ALERT", to: "/notifications" },
        { id: "open-print-center", label: "Open Print Center", hint: "PRINT", to: "/print-center" },
        { id: "search-hub", label: "Open Search Hub", hint: "Ctrl+K", to: "/search" },
      ]
        .filter((command) => canOpenPath(command.to))
        .map((command) => ({ ...command, action: () => navigateIfAllowed(command.to) })),
    [canOpenPath, navigateIfAllowed]
  );
  const filteredCommands = useMemo(() => {
    const query = String(commandQuery || "").trim().toLowerCase();
    if (!query) return commands;
    return commands.filter((row) => row.label.toLowerCase().includes(query) || row.hint.toLowerCase().includes(query));
  }, [commands, commandQuery]);
  const connectionIssue = !isOnline || backendStatus?.available === false;
  const refreshBackendStatus = useCallback(async () => {
    setCheckingBackend(true);
    try {
      await api.get("/health", { timeout: 4000 });
      setIsOnline(typeof navigator === "undefined" ? true : navigator.onLine);
      setBackendStatus((current) => ({ ...(current || {}), available: true }));
    } catch (error) {
      setIsOnline(typeof navigator === "undefined" ? true : navigator.onLine);
      setBackendStatus((current) => ({
        ...(current || {}),
        available: false,
        error: error?.message || "Backend unavailable",
      }));
    } finally {
      setCheckingBackend(false);
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      const key = String(event.key || "");
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && key.toLowerCase() === "k") {
        event.preventDefault();
        setShowCommandPalette(true);
        return;
      }
      if (key === "Escape") {
        setShowCommandPalette(false);
        setShowNotifications(false);
        return;
      }
      if (key === "F2") {
        event.preventDefault();
        navigateIfAllowed("/pos");
      } else if (key === "F3") {
        event.preventDefault();
        navigateIfAllowed("/customers");
      } else if (key === "F4") {
        event.preventDefault();
        navigateIfAllowed("/pos");
      } else if (ctrl && key.toLowerCase() === "r") {
        event.preventDefault();
        navigateIfAllowed("/repairs");
      } else if (ctrl && key.toLowerCase() === "i") {
        event.preventDefault();
        navigateIfAllowed("/search?focus=invoice");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigateIfAllowed]);

  const isMobileShell = viewportWidth < 760;
  const autoCompactSidebar = viewportWidth < 1600;
  const forceIconSidebar = viewportWidth < 1320;
  const sidebarCollapsed = !isMobileShell && (collapsed || forceIconSidebar);
  const sidebarWidthClass = isMobileShell ? "w-[min(286px,86vw)]" : sidebarCollapsed ? "w-[72px]" : autoCompactSidebar ? "w-[224px]" : "w-[286px]";
  const showFullSidebarText = !sidebarCollapsed;

  return (
    <div className="app-shell transition-colors duration-300">
      <div className="flex h-dvh min-h-0 overflow-hidden">
        {isMobileShell && mobileSidebarOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm"
            onClick={() => setMobileSidebarOpen(false)}
          />
        ) : null}
        <aside
          className={`dashboard-sidebar ${sidebarWidthClass} ${
            isMobileShell
              ? `fixed inset-y-0 left-0 z-50 ${mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"}`
              : "relative translate-x-0"
          } px-3 py-3.5 flex min-h-0 flex-col h-full shrink-0 transition-all duration-300 ease-in-out`}
        >
          <div className={`dashboard-brand px-1 mb-3.5 pb-3 border-b border-[var(--sidebar-border)] flex items-center ${sidebarCollapsed ? "justify-center" : "justify-between"} gap-2.5`}>
            {showFullSidebarText && (
              <div className="flex items-center gap-2.5">
                <div className="dashboard-brand-mark h-9 w-9 rounded-xl grid place-items-center text-white font-extrabold text-sm shadow-sm shrink-0">
                  {brandInitials}
                </div>
                <div className="min-w-0">
                  <h1 className="text-base font-extrabold text-[var(--app-text)] leading-tight truncate">{shopName}</h1>
                  <p className="text-[10px] text-slate-400 font-medium truncate leading-tight">{softwareName} Business Suite</p>
                </div>
              </div>
            )}
            {sidebarCollapsed && (
              <div className="dashboard-brand-mark h-9 w-9 rounded-xl grid place-items-center text-white font-extrabold text-sm shadow-sm">
                {brandInitials}
              </div>
            )}
          </div>

          <nav className="flex-1 space-y-3 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
            {visibleNavGroups.map((group) => (
              <div key={group.label} className="space-y-0.5">
                {showFullSidebarText && (
                  <div className="dashboard-group-label px-2.5 pt-1.5 pb-1 text-[9.5px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500 select-none">
                    {group.label}
                  </div>
                )}
                {sidebarCollapsed && <div className="mx-2 my-2 h-px bg-white/10" />}
                <div className="space-y-0.5">
                  {group.items.map(([to, label, Icon]) => (
                    <NavLink
                      key={to}
                      to={to}
                      title={sidebarCollapsed ? label : ""}
                      className={({ isActive }) =>
                        `dashboard-nav-link group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-all outline-none focus:outline-none focus:ring-0 select-none ${
                          sidebarCollapsed ? "justify-center" : ""
                        } ${isActive ? "is-active" : ""}`
                      }
                      onClick={() => {
                        if (isMobileShell) setMobileSidebarOpen(false);
                      }}
                    >
                      <Icon size={17} className="shrink-0 opacity-80 group-hover:opacity-100 transition-opacity" />
                      {showFullSidebarText && <span className="truncate text-xs font-medium">{label}</span>}
                      {showFullSidebarText && to === "/repairs" && pendingRepairs > 0 && (
                        <span className="dashboard-nav-badge ml-auto">{pendingRepairs}</span>
                      )}
                      {sidebarCollapsed && to === "/repairs" && pendingRepairs > 0 && (
                        <div className="absolute right-2 top-2 h-2 w-2 rounded-full border border-[var(--sidebar-bg)] bg-rose-500" />
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="mt-auto border-t border-[var(--sidebar-border)] pt-2.5">
            {showFullSidebarText ? (
              <div className="dashboard-user-card mb-1.5 flex items-center gap-2.5 rounded-xl border px-2.5 py-2">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/20 bg-indigo-600 text-xs font-bold text-white shadow-sm">
                  {initials(displayName)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-[var(--app-text)] truncate leading-tight">{displayName}</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium truncate leading-tight mt-0.5">{roleLabel}</p>
                </div>
              </div>
            ) : (
              <div className="flex justify-center mb-1.5">
                <div className="grid h-8 w-8 place-items-center rounded-lg border border-white/20 bg-indigo-600 text-xs font-bold text-white shadow-sm">
                  {initials(displayName)}
                </div>
              </div>
            )}
            <button
              onClick={async () => {
                try {
                  const sessionId = getAuthValue("session_id");
                  await api.post("/auth/logout", { session_id: sessionId || null, logout_all: false });
                } catch {
                  // local logout fallback
                }
                clearAuthState();
                n("/login");
              }}
              className="dashboard-logout-btn w-full rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--sidebar-text)] transition flex items-center justify-center gap-2"
            >
              <LogOut size={16} />
              {showFullSidebarText && <span>Logout</span>}
            </button>
          </div>
        </aside>

        <main className="dashboard-main relative flex h-full min-w-0 min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden p-0">
          <div className="dashboard-topbar flex shrink-0 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <button
                onClick={() => {
                  if (isMobileShell) {
                    setMobileSidebarOpen(true);
                  } else {
                    setCollapsed(!collapsed);
                  }
                }}
                className="dashboard-icon-btn inline-grid"
                title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-label={isMobileShell ? "Open navigation" : sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {isMobileShell ? <Menu size={19} /> : sidebarCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
              </button>
              <div className="min-w-0 flex items-center gap-2">
                <div className="hidden sm:block">
                  <p className="dashboard-crumb text-xs text-slate-400">
                    {shopName} / <span className="font-semibold text-[var(--app-text)]">{crumb}</span>
                  </p>
                  <p className="truncate text-base font-bold text-[var(--app-text)]">{crumb}</p>
                </div>

                {/* Organization & Branch Context Pill */}
                {tenantContext && (
                  <div className="relative ml-2 sm:ml-4">
                    <button
                      onClick={() => tenantContext.can_switch_branches && setShowBranchDropdown((v) => !v)}
                      disabled={!tenantContext.can_switch_branches}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                        tenantContext.can_switch_branches
                          ? "bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800 dark:bg-slate-800/80 dark:hover:bg-slate-800 dark:border-slate-700/80 dark:text-slate-200 cursor-pointer shadow-sm active:scale-95"
                          : "bg-slate-100 border-slate-300 text-slate-700 dark:bg-slate-900/60 dark:border-slate-800 dark:text-slate-400 cursor-default"
                      }`}
                      title={tenantContext.can_switch_branches ? "Click to switch branch" : "Assigned Branch"}
                    >
                      <Building2 size={13} className="text-blue-600 dark:text-blue-400 shrink-0" />
                      <span className="max-w-[120px] md:max-w-[160px] truncate">
                        {tenantContext.active_branch?.name || "Main Branch"}
                      </span>
                      {tenantContext.can_switch_branches && tenantContext.is_multi_branch_enabled && (
                        <ChevronDown size={13} className={`text-slate-500 dark:text-slate-400 transition-transform ${showBranchDropdown ? "rotate-180" : ""}`} />
                      )}
                    </button>

                    {/* Branch Switcher Dropdown */}
                    {showBranchDropdown && tenantContext.can_switch_branches && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowBranchDropdown(false)} />
                        <div className="absolute left-0 mt-2 w-64 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                          <div className="px-2.5 py-1.5 border-b border-slate-200 dark:border-slate-800 mb-1.5">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Organization</p>
                            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{tenantContext.organization?.name}</p>
                            <span className="inline-block mt-0.5 text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                              {tenantContext.organization?.plan}
                            </span>
                          </div>

                          <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            Switch Branch / Outlet
                          </div>

                          <div className="space-y-0.5 max-h-48 overflow-y-auto custom-scrollbar">
                            {tenantContext.available_branches?.map((branch) => {
                              const isCurrent = branch.id === tenantContext.active_branch?.id;
                              return (
                                <button
                                  key={branch.id}
                                  onClick={() => handleSwitchBranch(branch.id)}
                                  disabled={isCurrent || isSwitchingBranch}
                                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium text-left transition-colors ${
                                    isCurrent
                                      ? "bg-blue-50 text-blue-600 dark:bg-blue-600/15 dark:text-blue-400 font-semibold"
                                      : "text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                                  }`}
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Store size={14} className={isCurrent ? "text-blue-600 dark:text-blue-400 shrink-0" : "text-slate-400 dark:text-slate-500 shrink-0"} />
                                    <div className="min-w-0">
                                      <p className="truncate leading-tight font-semibold">{branch.name}</p>
                                      <p className="text-[10px] text-slate-500 font-mono leading-tight">{branch.code}</p>
                                    </div>
                                  </div>
                                  {isCurrent && <Check size={14} className="text-blue-600 dark:text-blue-400 shrink-0 ml-2" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex min-w-0 shrink-0 items-center justify-end gap-2 xl:gap-3">
              <div className="dashboard-search relative hidden max-w-full md:block md:w-[260px] xl:w-[340px] 2xl:w-[380px]">
                <Search size={14} className="absolute left-3 top-[11px] text-slate-400" />
                <input
                  onClick={() => setShowCommandPalette(true)}
                  className="w-full rounded-xl pl-9 pr-16 py-2.5 text-sm text-[var(--app-text)] focus:outline-none"
                  placeholder="Command palette: search, repairs, customers..."
                  readOnly
                />
                <span className="dashboard-keycap">Ctrl + K</span>
              </div>
              {!isOnline && (
                <div
                  className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider animate-pulse"
                  title="Network connectivity is unavailable"
                >
                  Offline
                </div>
              )}
              {queueLength > 0 && (
                <div
                  className="rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider animate-pulse"
                  title="Offline events pending synchronization"
                >
                  Pending Sync: {queueLength}
                </div>
              )}
              {backendStatus && !backendStatus.available && (
                <div
                  className="rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider animate-pulse"
                  title="Backend service disconnected"
                >
                  Backend Down
                </div>
              )}
              {notificationsAllowed ? (
                <button
                  onClick={() => setShowNotifications((v) => !v)}
                  className="dashboard-icon-btn relative"
                  title={unreadNotifCount > 0 ? `${unreadNotifCount} active alert${unreadNotifCount > 1 ? "s" : ""}` : "Notifications"}
                >
                  <Bell size={18} />
                  {unreadNotifCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black text-white shadow-sm ring-2 ring-white dark:ring-slate-900 animate-in zoom-in-50">
                      {unreadNotifCount > 99 ? "99+" : unreadNotifCount}
                    </span>
                  )}
                </button>
              ) : null}
              <button
                className="dashboard-icon-btn"
                title={dark ? "Switch to light" : "Switch to dark"}
                onClick={() => setDark((d) => !d)}
              >
                {dark ? <Moon size={18} /> : <Sun size={18} />}
              </button>
              <button
                type="button"
                onClick={() => navigateIfAllowed("/settings")}
                title={settingsAllowed ? "Open account settings" : "Settings unavailable for this role"}
                disabled={!settingsAllowed}
                className="dashboard-avatar-btn"
              >
                {initials(displayName)}
              </button>
            </div>
          </div>

          {showNotifications && (
            <>
              {/* Backdrop for outside-click dismiss */}
              <div
                className="fixed inset-0 z-[9990]"
                onClick={() => setShowNotifications(false)}
              />
              <div className="dashboard-notifications animate-in fade-in slide-in-from-top-2 fixed sm:absolute right-3 sm:right-5 top-16 sm:top-20 z-[9995] w-[calc(100vw-1.5rem)] sm:w-[420px] max-h-[calc(100vh-5.5rem)] rounded-2xl p-0 shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-white/10 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl">
                {/* Header */}
                <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10 flex items-center justify-between gap-2 shrink-0 bg-slate-50/90 dark:bg-slate-950/60">
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-black uppercase tracking-widest text-slate-800 dark:text-slate-200">Alerts & Notifications</h4>
                    {unreadNotifCount > 0 && (
                      <span className="whitespace-nowrap inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 font-mono border border-rose-500/20 shrink-0">
                        {unreadNotifCount} new
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {unreadNotifCount > 0 && (
                      <button
                        type="button"
                        onClick={async () => {
                          await api.put("/notifications/read-all").catch(() => {});
                          refreshNotifications?.();
                        }}
                        className="text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-300 flex items-center gap-1 transition"
                        title="Mark all as read"
                      >
                        <CheckCheck size={12} /> Mark Read
                      </button>
                    )}
                    {notificationsAllowed ? (
                      <button
                        type="button"
                        onClick={() => {
                          setShowNotifications(false);
                          navigateIfAllowed("/notifications");
                        }}
                        className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-0.5"
                      >
                        Center <ExternalLink size={10} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setShowNotifications(false)}
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition"
                      title="Close"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {/* Filter Tabs */}
                <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-200/80 dark:border-white/5 bg-slate-100/50 dark:bg-slate-950/30 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setNotificationTab("all")}
                    className={`px-2.5 py-1 rounded-lg font-bold transition ${
                      notificationTab === "all"
                        ? "bg-white dark:bg-white/10 text-indigo-600 dark:text-indigo-300 shadow-sm"
                        : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                    }`}
                  >
                    All ({notifications.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setNotificationTab("unread")}
                    className={`px-2.5 py-1 rounded-lg font-bold transition ${
                      notificationTab === "unread"
                        ? "bg-white dark:bg-white/10 text-indigo-600 dark:text-indigo-300 shadow-sm"
                        : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                    }`}
                  >
                    Unread ({unreadNotifCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setNotificationTab("critical")}
                    className={`px-2.5 py-1 rounded-lg font-bold transition ${
                      notificationTab === "critical"
                        ? "bg-white dark:bg-white/10 text-rose-600 dark:text-rose-300 shadow-sm"
                        : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                    }`}
                  >
                    Critical (
                    {
                      notifications.filter((n) => {
                        const s = String(n.severity || "").toLowerCase();
                        return s === "critical" || s === "high";
                      }).length
                    }
                    )
                  </button>
                </div>

                {/* Notifications List */}
                <div className="p-3 overflow-y-auto space-y-2.5 flex-1 max-h-[calc(100vh-12rem)]">
                  {notifications
                    .filter((item) => {
                      if (notificationTab === "unread") return !item.is_read || !item.is_acknowledged;
                      if (notificationTab === "critical") {
                        const s = String(item.severity || "").toLowerCase();
                        return s === "critical" || s === "high";
                      }
                      return true;
                    })
                    .map((item) => {
                      const severity = String(item.severity || "info").toLowerCase();
                      const isCritical = severity === "critical" || severity === "danger";
                      const isWarning = severity === "warning" || severity === "high" || severity === "medium";
                      const isUnread = !item.is_read;
                      const relTime = formatRelativeTime(item.created_at);
                      const action = getNotificationAction(item);

                      return (
                        <div
                          key={item.id}
                          className={`group rounded-xl border p-3 transition text-left relative cursor-pointer ${
                            isUnread
                              ? isCritical
                                ? "border-rose-500/30 bg-rose-500/[0.04] dark:bg-rose-950/20 hover:border-rose-500/50"
                                : isWarning
                                ? "border-amber-500/30 bg-amber-500/[0.04] dark:bg-amber-950/20 hover:border-amber-500/50"
                                : "border-indigo-500/30 bg-indigo-500/[0.03] dark:bg-indigo-950/20 hover:border-indigo-500/50"
                              : "border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-slate-950/20 hover:border-slate-300 dark:hover:border-white/15 opacity-75 hover:opacity-100"
                          }`}
                          onClick={async () => {
                            if (!item?.id) return;
                            if (isUnread) {
                              await api.put(`/notifications/${item.id}/read`).catch(() => {});
                              refreshNotifications?.();
                            }
                            if (action?.url) {
                              setShowNotifications(false);
                              navigateIfAllowed(action.url);
                            }
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {getNotificationCategoryIcon(item.source_module, item.type)}
                              <p className="text-xs font-bold text-slate-900 dark:text-white leading-tight truncate">
                                {item.title}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {relTime && (
                                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                                  {relTime}
                                </span>
                              )}
                              <span
                                className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                                  isCritical
                                    ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                                    : isWarning
                                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                                    : "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20"
                                }`}
                              >
                                {String(item.severity || "info")}
                              </span>
                            </div>
                          </div>

                          <p className="mt-1.5 text-[11px] text-slate-600 dark:text-slate-300 leading-normal">
                            {item.message}
                          </p>

                          <div className="mt-2.5 flex items-center justify-between gap-2 pt-2 border-t border-slate-200/60 dark:border-white/5">
                            <span className="text-[9px] font-mono font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                              {item.source_module || "system"}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {action && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowNotifications(false);
                                    navigateIfAllowed(action.url);
                                  }}
                                  className="rounded-lg border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-600 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition flex items-center gap-1"
                                >
                                  {action.label} <ExternalLink size={10} />
                                </button>
                              )}
                              {!item.is_acknowledged ? (
                                <button
                                  type="button"
                                  onClick={async (event) => {
                                    event.stopPropagation();
                                    await api.put(`/notifications/${item.id}/ack`).catch(() => {});
                                    refreshNotifications?.();
                                  }}
                                  className="rounded-lg border border-slate-300 dark:border-white/10 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-white/5 hover:border-indigo-500/50 hover:bg-slate-50 dark:hover:bg-white/10 transition"
                                >
                                  Acknowledge
                                </button>
                              ) : (
                                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                  ✓ Ack
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                  {notifications.length === 0 && (
                    <div className="py-10 text-center flex flex-col items-center justify-center">
                      <div className="h-10 w-10 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-2">
                        <ShieldCheck size={20} />
                      </div>
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-300">All Clear!</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">No active alerts requiring attention.</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {showCommandPalette && (
            <div
              className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 p-4 sm:pt-24 backdrop-blur-sm animate-fade-in"
              onClick={() => {
                setShowCommandPalette(false);
                setCommandQuery("");
              }}
            >
              <div
                className="w-full max-w-2xl max-h-[80vh] overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="border-b border-slate-200 dark:border-white/10 p-3.5 flex items-center gap-2.5">
                  <Search size={18} className="text-slate-400 shrink-0" />
                  <input
                    autoFocus
                    value={commandQuery}
                    onChange={(event) => setCommandQuery(event.target.value)}
                    placeholder="Type a command or jump to page..."
                    className="w-full bg-transparent text-sm font-medium text-slate-900 dark:text-slate-100 placeholder-slate-400 outline-none"
                  />
                  <span className="dashboard-keycap text-[10px]">ESC</span>
                </div>
                <div className="max-h-[calc(80vh-64px)] overflow-y-auto p-2">
                  {filteredCommands.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => {
                        row.action();
                        setShowCommandPalette(false);
                        setCommandQuery("");
                      }}
                      className="mb-1 flex w-full items-center justify-between rounded-xl border border-transparent px-3.5 py-2.5 text-left text-sm font-medium text-slate-700 dark:text-slate-200 transition hover:border-indigo-400/40 hover:bg-indigo-50 dark:hover:bg-indigo-500/10"
                    >
                      <span className="text-slate-800 dark:text-slate-100">{row.label}</span>
                      <span className="rounded-md border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{row.hint}</span>
                    </button>
                  ))}
                  {filteredCommands.length === 0 && (
                    <p className="p-4 text-center text-sm text-slate-500">No commands match your search.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {connectionIssue ? (
            <WorkstationNotice
              tone={!isOnline ? "red" : "amber"}
              title={!isOnline ? "Offline mode active" : "Backend service unavailable"}
              text={
                !isOnline
                  ? "Network connectivity is unavailable. Keep this workstation open, but verify checkout, backup, restore, and print actions before committing work."
                  : "The local service is not responding. Existing screens may stay visible, but saves, checkout, reports, backups, and printing can fail until it reconnects."
              }
              className="mb-2 shrink-0 rounded-xl px-3 py-2"
              right={
                <Button
                  type="button"
                  size="sm"
                  variant={!isOnline ? "danger" : "warning"}
                  onClick={refreshBackendStatus}
                  disabled={checkingBackend}
                  className="min-h-9 shrink-0"
                >
                  <RefreshCw size={14} className={checkingBackend ? "animate-spin" : ""} />
                  Retry
                </Button>
              }
            />
          ) : null}

          <div className="app-workspace-host min-h-0 min-w-0 flex-1 w-full max-w-none overflow-x-auto overflow-y-auto custom-scrollbar px-3 sm:px-4 pb-3 sm:pb-4 pt-2 sm:pt-2.5">
            <Outlet />
          </div>
        </main>
        <UpdateNotification />
        <AIAssistant />
      </div>
    </div>
  );
}
