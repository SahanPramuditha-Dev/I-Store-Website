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
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFetch } from "../hooks/useFetch";
import { canAccessPath, clearAuthState, getAuthValue, hasPermission, loadPermissions, NAV_PERMISSION_MAP } from "../lib/rbac";
import { isRepairDelivered } from "../lib/repairStatus";
import api from "../lib/api";
import { useStoreProfile } from "../hooks/useStoreProfile";
import { Button, WorkstationNotice } from "./UI";

const navGroups = [
  {
    label: "Main",
    items: [
      ["/dashboard", "Dashboard", LayoutDashboard],
      ["/search", "Search Hub", SearchIcon],
    ],
  },
  {
    label: "Operations",
    items: [
      ["/repairs", "Repair Management", Wrench],
      ["/reservations", "Reservations", ClipboardList],
      ["/warranty", "Warranty", Shield],
      ["/returns", "Returns & Refunds", RotateCcw],
      ["/advances", "Advance Payments", Wallet],
      ["/inventory/products", "Inventory", Boxes],
      ["/purchase", "Purchasing", Truck],
      ["/expenses", "Expenses", Wallet],
      ["/pos", "POS / Billing", ShoppingCart],
    ],
  },
  {
    label: "People",
    items: [["/customers", "Customers", Users]],
  },
  {
    label: "Analytics",
    items: [
      ["/reports", "Reports", BarChart3],
      ["/financials", "Financial Audit", ShieldCheck],
      ["/barcodes", "Labels", Barcode],
      ["/print-center", "Print Center", Printer],
    ],
  },
  {
    label: "System",
    items: [
      ["/permissions", "Permissions", Shield],
      ["/notifications", "Notifications", Bell],
      ["/audit", "Audit Trail", History],
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

export default function Layout() {
  const location = useLocation();
  const n = useNavigate();
  const [dark, setDark] = useState(() => (localStorage.getItem("theme") ?? "dark") === "dark");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 1920 : window.innerWidth));
  const [showNotifications, setShowNotifications] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [backendStatus, setBackendStatus] = useState({ available: true });
  const [checkingBackend, setCheckingBackend] = useState(false);
  const [queueLength, setQueueLength] = useState(0);
  const { data: repairs } = useFetch("/repairs");
  const { data: dashboardData } = useFetch("/dashboard");
  const { data: apiNotifications, refresh: refreshNotifications } = useFetch("/notifications");
  const { identity } = useStoreProfile();

  const permissions = useMemo(() => loadPermissions(), [location.pathname]);
  const pendingRepairs = useMemo(() => {
    const rows = Array.isArray(repairs) ? repairs : [];
    return rows.filter((r) => r.status && !isRepairDelivered(r.status)).length;
  }, [repairs]);

  const notifications = useMemo(() => {
    return [...(apiNotifications || [])];
  }, [apiNotifications]);

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

  const visibleNavGroups = useMemo(
    () =>
      navGroups
        .map((group) => ({
          ...group,
          items: group.items.filter(([to]) => hasPermission(NAV_PERMISSION_MAP[to], permissions)),
        }))
        .filter((group) => group.items.length > 0),
    [permissions]
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
  const softwareName = identity?.softwareName || "I Store";
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
          } px-3 py-4 xl:py-5 flex min-h-0 flex-col h-full shrink-0 transition-all duration-300 ease-in-out`}
        >
          <div className={`dashboard-brand px-2 mb-7 flex items-center ${sidebarCollapsed ? "justify-center" : "justify-between"} gap-3`}>
            {showFullSidebarText && (
              <div className="flex items-center gap-3">
                <div className="dashboard-brand-mark h-10 w-10 rounded-xl grid place-items-center text-white font-extrabold text-sm">
                  {brandInitials}
                </div>
                <div>
                  <h1 className="text-xl font-extrabold text-[var(--app-text)]">{shopName}</h1>
                  <p className="text-[11px] text-slate-400">{softwareName} Business Suite</p>
                </div>
              </div>
            )}
            {sidebarCollapsed && (
              <div className="dashboard-brand-mark h-10 w-10 rounded-xl grid place-items-center text-white font-extrabold text-sm">
                {brandInitials}
              </div>
            )}
          </div>

          <nav className="flex-1 space-y-0 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
            {visibleNavGroups.map((group) => (
              <div key={group.label} className="mb-5">
                {showFullSidebarText && (
                  <div className="dashboard-group-label px-3 text-[10px] font-black uppercase tracking-widest mb-2">
                    {group.label}
                  </div>
                )}
                {sidebarCollapsed && <div className="mx-2 mb-4 h-px bg-white/10" />}
                <div className="space-y-1.5">
                  {group.items.map(([to, label, Icon]) => (
                    <NavLink
                      key={to}
                      to={to}
                      title={sidebarCollapsed ? label : ""}
                      className={({ isActive }) =>
                        `dashboard-nav-link group relative flex items-center gap-3 rounded-xl p-3 transition-all ${
                          sidebarCollapsed ? "justify-center" : ""
                        } ${isActive ? "is-active" : ""}`
                      }
                      onClick={() => {
                        if (isMobileShell) setMobileSidebarOpen(false);
                      }}
                    >
                      <Icon size={19} className="shrink-0" />
                      {showFullSidebarText && <span className="truncate text-sm font-medium">{label}</span>}
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

          <div className="mt-auto border-t border-[var(--sidebar-border)] pt-4">
            {showFullSidebarText ? (
              <div className="dashboard-user-card mb-2 flex items-center gap-3 rounded-2xl border px-3 py-4">
                <div className="grid h-10 w-10 place-items-center rounded-full border-2 border-white/20 bg-indigo-500 text-xs font-black text-white">
                  {initials(displayName)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-[var(--app-text)] truncate">{displayName}</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium truncate">{roleLabel}</p>
                </div>
              </div>
            ) : (
              <div className="flex justify-center mb-2">
                <div className="grid h-10 w-10 place-items-center rounded-full border-2 border-white/20 bg-indigo-500 text-xs font-black text-white">
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
              className="dashboard-logout-btn w-full rounded-xl p-3 text-[var(--sidebar-text)] transition justify-center"
            >
              <LogOut size={18} />
              {showFullSidebarText && <span className="text-sm font-medium">Logout</span>}
            </button>
          </div>
        </aside>

        <main className="dashboard-main relative flex h-full min-w-0 min-h-0 flex-1 flex-col overflow-hidden p-2 transition-all duration-300 sm:p-3 xl:p-4 2xl:p-5">
          <div className="dashboard-topbar mb-2 flex shrink-0 items-center justify-between gap-2 2xl:mb-4">
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
              <div className="min-w-0">
                <p className="dashboard-crumb hidden text-xs text-slate-400 sm:block">
                  {shopName} / <span className="font-semibold text-[var(--app-text)]">{crumb}</span>
                </p>
                <p className="truncate text-base font-bold text-[var(--app-text)]">{crumb}</p>
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
              <div
                className={`hidden lg:block rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                  isOnline ? "border-emerald-500/40 text-emerald-300" : "border-rose-500/40 text-rose-300"
                }`}
                title="Network connectivity status"
              >
                {isOnline ? "Online" : "Offline"}
              </div>
              {queueLength > 0 && (
                <div
                  className="rounded-lg border border-amber-500/40 text-amber-300 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider animate-pulse"
                  title="Offline events pending synchronization"
                >
                  Pending Sync: {queueLength}
                </div>
              )}
              <div
                className={`hidden lg:block rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                  backendStatus?.available ? "border-sky-500/40 text-sky-300" : "border-amber-500/40 text-amber-300"
                }`}
                title="Backend service health"
              >
                {backendStatus?.available ? "Backend OK" : "Backend Down"}
              </div>
              {notificationsAllowed ? (
                <button onClick={() => setShowNotifications((v) => !v)} className="dashboard-icon-btn relative" title="Notifications">
                  <Bell size={18} />
                  {notifications.length > 0 && <span className="dashboard-notify-dot" />}
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
            <div className="dashboard-notifications animate-in fade-in slide-in-from-top-2 absolute right-3 top-16 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-2xl p-4 shadow-2xl xl:right-5 xl:top-20">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h4 className="text-xs font-black uppercase tracking-widest text-slate-500">Notifications</h4>
                {notificationsAllowed ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowNotifications(false);
                      navigateIfAllowed("/notifications");
                    }}
                    className="text-[10px] font-black uppercase tracking-wider text-indigo-300 hover:text-indigo-100"
                  >
                    Open Center
                  </button>
                ) : null}
              </div>
              <div className="space-y-2">
                {notifications.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-xl border p-3 ${item.is_read ? "opacity-60" : ""}`}
                    onClick={async () => {
                      if (!item?.id) return;
                      await api.put(`/notifications/${item.id}/read`).catch(() => {});
                      refreshNotifications?.();
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-white">{item.title}</p>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{String(item.severity || "info")}</span>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">{item.message}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[9px] text-slate-500">{item.source_module || "system"}</span>
                      {!item.is_acknowledged ? (
                        <button
                          type="button"
                          onClick={async (event) => {
                            event.stopPropagation();
                            await api.put(`/notifications/${item.id}/ack`).catch(() => {});
                            refreshNotifications?.();
                          }}
                          className="rounded-md border border-white/10 px-2 py-1 text-[9px] font-bold text-indigo-200 hover:border-indigo-400/50"
                        >
                          Acknowledge
                        </button>
                      ) : (
                        <span className="text-[9px] font-semibold text-emerald-300">Acknowledged</span>
                      )}
                    </div>
                  </div>
                ))}
                {notifications.length === 0 && <p className="py-4 text-center text-xs text-slate-500">No alerts</p>}
              </div>
            </div>
          )}

          {showCommandPalette && (
            <div className="absolute inset-0 z-[60] flex items-start justify-center bg-black/50 p-3 sm:p-6 backdrop-blur-sm">
              <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-white/10 bg-slate-900/95 shadow-2xl">
                <div className="border-b border-white/10 p-3">
                  <input
                    autoFocus
                    value={commandQuery}
                    onChange={(event) => setCommandQuery(event.target.value)}
                    placeholder="Type a command..."
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400/60"
                  />
                </div>
                <div className="max-h-[calc(90vh-72px)] overflow-y-auto p-2">
                  {filteredCommands.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => {
                        row.action();
                        setShowCommandPalette(false);
                        setCommandQuery("");
                      }}
                      className="mb-1 flex w-full items-center justify-between rounded-lg border border-transparent px-3 py-2 text-left text-sm text-slate-200 transition hover:border-indigo-400/40 hover:bg-indigo-500/10"
                    >
                      <span>{row.label}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{row.hint}</span>
                    </button>
                  ))}
                  {filteredCommands.length === 0 && (
                    <p className="p-3 text-sm text-slate-500">No commands match your search.</p>
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

          <div className="app-workspace-host min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto custom-scrollbar">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
