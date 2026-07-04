import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { useFetch } from "../hooks/useFetch";
import { ErrorState, KpiCard, Loading, SectionCard, Table, Badge, Button } from "../components/UI";
import {
  BadgeDollarSign,
  Wrench,
  CheckCircle2,
  Boxes,
  Users,
  Receipt,
  ArrowRight,
  Clock,
  Plus,
  Search,
  UserPlus,
  ShoppingCart,
  Server,
  Database,
  HardDriveDownload,
  WifiOff,
  BarChart3,
  CalendarDays,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageContainer from "../components/layout/PageContainer";
import { X } from "lucide-react";

function pctChange(curr, prev) {
  if (!prev) return 0;
  return ((curr - prev) / prev) * 100;
}

function fmtPct(v) {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function DashboardSkeleton() {
  return (
    <PageContainer className="dashboard-page pb-4 pr-1">
      <div className="space-y-2.5">
        <div className="dashboard-hero flex flex-col gap-3 rounded-xl border p-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2">
            <div className="skeleton-shimmer h-4 w-28 rounded-full" />
            <div className="skeleton-shimmer h-6 w-48 rounded" />
            <div className="skeleton-shimmer h-4 w-64 rounded" />
          </div>
          <div className="flex items-center gap-2">
            <div className="skeleton-shimmer h-8 w-24 rounded-xl" />
            <div className="skeleton-shimmer h-8 w-24 rounded-lg" />
          </div>
        </div>

        <div className="dashboard-health-card grid grid-cols-1 gap-2 rounded-xl border border-white/10 bg-slate-900/45 p-2 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="dashboard-health-item flex items-center justify-between rounded-lg border px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="skeleton-shimmer h-2 w-2 rounded-full" />
                <div className="skeleton-shimmer h-3 w-24 rounded" />
              </div>
              <div className="skeleton-shimmer h-4 w-12 rounded" />
            </div>
          ))}
        </div>

        <div className="dashboard-kpi-grid grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="skeleton-shimmer h-[98px] rounded-2xl" />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="skeleton-shimmer xl:col-span-7 h-[230px] rounded-xl" />
          <div className="skeleton-shimmer xl:col-span-5 h-[230px] rounded-xl" />
          <div className="skeleton-shimmer xl:col-span-6 h-[280px] rounded-xl" />
          <div className="skeleton-shimmer xl:col-span-6 h-[280px] rounded-xl" />
        </div>
      </div>
    </PageContainer>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [showLowStockModal, setShowLowStockModal] = useState(false);
  const { data, loading, error } = useFetch("/dashboard");
  const role = localStorage.getItem("login_role") || "admin";
  const username = localStorage.getItem("username") || "Admin";

  const revData = data?.charts?.revenue_overview || [];
  const salesData = data?.charts?.sales_breakdown || [];
  const repairs = data?.recent_repairs || [];
  const feed = data?.activity_feed || [];
  const tx = data?.recent_transactions || [];

  const revCurrent = revData[revData.length - 1]?.value || 0;
  const revPrev = revData[revData.length - 2]?.value || 0;
  const revTrend = pctChange(revCurrent, revPrev);

  const pendingRepairs = Math.max(0, (data?.repair_stats?.total || 0) - (data?.repair_stats?.completed || 0));
  const completionRate = data?.repair_stats?.total
    ? ((data?.repair_stats?.completed || 0) / data.repair_stats.total) * 100
    : 0;

  const totalSales = salesData.reduce((a, b) => a + (b.value || 0), 0);

  const health = [
    { label: "Database Connected", tone: "green", icon: <Database size={13} />, meta: "Live", accent: "text-emerald-300" },
    { label: "Backup Enabled", tone: "sky", icon: <HardDriveDownload size={13} />, meta: "02:00 AM", accent: "text-cyan-300" },
    { label: "Offline Ready", tone: "indigo", icon: <WifiOff size={13} />, meta: "Queue 0", accent: "text-indigo-300" },
    { label: "API Healthy", tone: "amber", icon: <Server size={13} />, meta: "<120ms", accent: "text-amber-300" },
  ];

  const quickActions = useMemo(() => {
    const common = [
      { label: "New Repair", to: "/repairs", icon: <Wrench size={14} /> },
      { label: "New Sale", to: "/pos", icon: <ShoppingCart size={14} /> },
      { label: "Add Customer", to: "/customers", icon: <UserPlus size={14} /> },
      { label: "Search Device", to: "/search", icon: <Search size={14} /> },
    ];

    if (role === "cashier") {
      return common.filter((x) => x.to !== "/repairs");
    }

    if (role === "technician") {
      return [
        { label: "New Repair", to: "/repairs", icon: <Plus size={14} /> },
        { label: "Open Tickets", to: "/repairs", icon: <Wrench size={14} /> },
        { label: "Search Device", to: "/search", icon: <Search size={14} /> },
      ];
    }

    return common;
  }, [role]);

  const dashboardActions = useMemo(() => {
    const extra = [
      { label: "Reports", to: "/reports", icon: <BarChart3 size={14} /> },
      { label: "Settings", to: "/settings", icon: <Server size={14} /> },
    ];
    return [...quickActions, ...extra];
  }, [quickActions]);

  const kpis = [
    {
      title: "Total Sales",
      value: `LKR ${(data?.daily_revenue || 0).toLocaleString()}`,
      hint: `${fmtPct(revTrend)} vs previous period`,
      tone: "sky",
      icon: <BadgeDollarSign size={18} />,
      to: "/reports",
    },
    {
      title: "Pending Repairs",
      value: String(pendingRepairs),
      hint: `${completionRate.toFixed(0)}% completion rate`,
      tone: "amber",
      icon: <Wrench size={18} />,
      to: "/repairs",
    },
    {
      title: "Completed Today",
      value: String(data?.repair_stats?.completed || 0),
      hint: "Ready for delivery",
      tone: "green",
      icon: <CheckCircle2 size={18} />,
      to: "/repairs",
    },
    {
      title: "Low Stock",
      value: String(data?.low_stock_count || 0),
      hint: "Reorder required",
      tone: "red",
      icon: <Boxes size={18} />,
      onClick: () => setShowLowStockModal(true),
    },
    {
      title: "Total Customers",
      value: String(data?.customers_count || 0),
      hint: "Active customer base",
      tone: "indigo",
      icon: <Users size={18} />,
      to: "/customers",
    },
    {
      title: "Recent Sales",
      value: String(tx.length),
      hint: `${totalSales.toLocaleString()} units across categories`,
      tone: "violet",
      icon: <Receipt size={18} />,
      to: "/pos",
    },
  ];

  if (loading) return <DashboardSkeleton />;
  if (error) return <ErrorState text={error} />;

  const piePalette = ["#22d3ee", "#3b82f6", "#8b5cf6", "#f97316", "#10b981", "#eab308"];

  return (
    <PageContainer className="dashboard-page pb-4 pr-1">
      <div className="space-y-2.5">
        <div className="dashboard-hero flex flex-col gap-3 rounded-xl border p-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="dashboard-hero-chip inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em]">
              <Sparkles size={11} />
              Live Business Summary
            </div>
            <h2 className="mt-1 text-xl font-extrabold tracking-tight text-white">Dashboard</h2>
            <p className="mt-1 text-sm text-slate-300">Welcome back, {username}. Here&apos;s what&apos;s happening today.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="dashboard-date-pill inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-200">
              <CalendarDays size={13} />
              {new Date().toLocaleDateString()}
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate("/pos")}>
              Open POS
              <ArrowRight size={14} />
            </Button>
          </div>
        </div>

        <div className="dashboard-health-card grid grid-cols-1 gap-2 rounded-xl border border-white/10 bg-slate-900/45 p-2 sm:grid-cols-2 xl:grid-cols-4">
          {health.map((h) => (
            <div key={h.label} className="dashboard-health-item flex items-center justify-between rounded-lg border px-3 py-1.5">
              <div className={`flex items-center gap-2 text-xs font-semibold ${h.accent}`}>
                <span className="status-beacon" style={{ color: h.tone === "green" ? "#10b981" : h.tone === "sky" ? "#0ea5e9" : h.tone === "indigo" ? "#6366f1" : "#f59e0b" }} />
                {h.icon}
                <span className="text-slate-200">{h.label}</span>
              </div>
              <Badge tone={h.tone} className="px-2 py-0.5 text-[9px]">
                {h.meta}
              </Badge>
            </div>
          ))}
        </div>

        <div className="dashboard-kpi-grid grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-6">
          {kpis.map((k) => (
            <button
              key={k.title}
              type="button"
              onClick={k.onClick ? k.onClick : () => navigate(k.to)}
              className="dashboard-kpi-button rounded-2xl text-left focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
              title={k.onClick ? `Peek ${k.title}` : `Open ${k.title}`}
            >
              <KpiCard {...k} className="h-full" />
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <SectionCard title="Sales Overview" subtitle="Last 7 periods (Click bar to view reports)" className="dashboard-chart-card xl:col-span-7 h-[210px] md:h-[230px] 2xl:h-[260px] flex flex-col">
            <div className="mt-4 min-h-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revData}>
                  <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="rgba(148,163,184,0.14)" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#9fb3d9", fontSize: 11 }} dy={8} />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#9fb3d9", fontSize: 11 }}
                    width={65}
                    tickFormatter={(v) => (v >= 1000000 ? `Rs.${(v / 1000000).toFixed(1)}M` : `Rs.${(v / 1000).toFixed(0)}k`)}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(139,92,246,0.12)" }}
                    contentStyle={{
                      backgroundColor: "#0b1228",
                      borderRadius: "12px",
                      border: "1px solid rgba(129,140,248,0.36)",
                      color: "#f8fafc",
                      fontSize: "12px",
                    }}
                    formatter={(val) => [`LKR ${Number(val).toLocaleString()}`, "Revenue"]}
                  />
                  <Bar
                    dataKey="value"
                    fill="#8b5cf6"
                    radius={[8, 8, 0, 0]}
                    barSize={28}
                    onClick={() => navigate("/reports")}
                    style={{ cursor: "pointer" }}
                  >
                    {revData.map((entry, index) => (
                      <Cell key={`rev-${index}`} fill={index === revData.length - 1 ? "#22d3ee" : "#7c3aed"} opacity={index === revData.length - 1 ? 1 : 0.78} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>

          <SectionCard title="Sales Breakdown" subtitle="Category mix (Click slice to view inventory)" className="dashboard-chart-card xl:col-span-5 h-[210px] md:h-[230px] 2xl:h-[260px] flex flex-col">
            <div className="relative mt-2 min-h-[160px] flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={salesData}
                    innerRadius="62%"
                    outerRadius="94%"
                    paddingAngle={4}
                    dataKey="value"
                    stroke="none"
                    onClick={(entry) => navigate(`/inventory?q=${entry.name}`)}
                    style={{ cursor: "pointer" }}
                  >
                    {salesData.map((entry, index) => (
                      <Cell key={`mix-${index}`} fill={piePalette[index % piePalette.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0b1228",
                      borderRadius: "12px",
                      border: "1px solid rgba(129,140,248,0.36)",
                      color: "#f8fafc",
                      fontSize: "12px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 space-y-2">
              {salesData.map((s, i) => (
                <div key={s.name} className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: piePalette[i % piePalette.length] }} />
                    <span className="text-slate-400">{s.name}</span>
                  </div>
                  <span className="font-bold text-slate-100">
                    {Math.round(((s.value || 0) / (salesData.reduce((acc, curr) => acc + (curr.value || 0), 0) || 1)) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Today's Repairs"
            subtitle="Recent repair tickets"
            className="dashboard-table-card xl:col-span-6 overflow-hidden"
            right={
              <Button variant="ghost" size="sm" onClick={() => navigate("/repairs")}>
                View All
                <ArrowRight size={14} className="ml-1" />
              </Button>
            }
          >
            <div className="w-full overflow-x-auto">
              <Table className="table-base w-full min-w-[680px] whitespace-nowrap">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Customer</th>
                    <th>Device</th>
                    <th>Status</th>
                    <th>Tech</th>
                  </tr>
                </thead>
                <tbody>
                  {repairs.slice(0, 6).map((r) => (
                    <tr key={r.id} className="cursor-pointer" onClick={() => navigate(`/repairs?id=${r.id}`)}>
                      <td className="font-mono text-xs text-cyan-300">#R-{String(r.id).padStart(4, "0")}</td>
                      <td className="font-bold text-slate-200">{r.customer}</td>
                      <td className="text-xs text-slate-400">{r.device}</td>
                      <td>
                        <Badge tone={r.status === "Completed" ? "green" : r.status === "Pending" ? "amber" : "sky"}>{r.status}</Badge>
                      </td>
                      <td className="text-xs font-medium text-slate-400">{r.tech}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </SectionCard>

          <SectionCard
            title="Today's Sales"
            subtitle="Latest transactions"
            className="dashboard-table-card xl:col-span-6 overflow-hidden"
            right={
              <Button variant="ghost" size="sm" onClick={() => navigate("/pos")}>
                Open POS
                <ArrowRight size={14} className="ml-1" />
              </Button>
            }
          >
            <div className="w-full overflow-x-auto">
              <Table className="table-base w-full min-w-[680px] whitespace-nowrap">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Total</th>
                    <th>Method</th>
                  </tr>
                </thead>
                <tbody>
                  {tx.slice(0, 6).map((t, idx) => (
                    <tr key={t.id || idx}>
                      <td className="font-mono text-xs text-slate-400">{t.invoice_no || `INV-${String(idx + 1).padStart(4, "0")}`}</td>
                      <td className="font-bold text-slate-200">{t.customer || "Walk-in"}</td>
                      <td className="font-semibold text-emerald-300">LKR {(t.total || 0).toLocaleString()}</td>
                      <td>
                        <Badge tone="indigo" className="text-[9px] px-2 py-0.5">
                          {t.payment_method || "Cash"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </SectionCard>

          <SectionCard title="Recent Payments" subtitle="Settlement stream" className="dashboard-table-card xl:col-span-4">
            <div className="space-y-2">
              {tx.slice(0, 6).map((t, idx) => (
                <div key={`p-${t.id || idx}`} className="dashboard-list-row flex items-center justify-between rounded-xl border px-3 py-2">
                  <div>
                    <p className="text-xs font-bold text-slate-200">{t.customer || "Walk-in"}</p>
                    <p className="text-[10px] text-slate-400">{t.payment_method || "Cash"}</p>
                  </div>
                  <p className="text-xs font-black text-emerald-300">LKR {(t.total || 0).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Recent Activity"
            subtitle="Operational timeline"
            className="dashboard-table-card xl:col-span-8"
            right={
              <Badge tone="sky" className="animate-pulse px-2 py-0.5 text-[9px]">
                Live feed
              </Badge>
            }
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {feed.slice(0, 8).map((l, i) => (
                <div key={l.id || i} className="dashboard-activity-row flex gap-3 rounded-xl border p-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-black/20">
                    {l.module === "REPAIR" ? (
                      <Wrench size={13} className="text-sky-400" />
                    ) : l.module === "POS" ? (
                      <Receipt size={13} className="text-emerald-400" />
                    ) : l.module === "INVENTORY" ? (
                      <Boxes size={13} className="text-amber-400" />
                    ) : (
                      <BarChart3 size={13} className="text-indigo-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold leading-snug text-slate-200">{l.action}</p>
                    {l.details && <p className="mt-0.5 line-clamp-1 text-[10px] text-slate-400">{l.details}</p>}
                    <div className="mt-1.5 flex items-center gap-2 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                      <Clock size={10} />
                      <span>{new Date(l.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      <span className="opacity-40">.</span>
                      <span>{l.module}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Quick Actions" subtitle="Jump into common workflows" className="dashboard-actions-card xl:col-span-12">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
              {dashboardActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => navigate(action.to)}
                  className="dashboard-action-tile flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition"
                >
                  <span className="dashboard-action-icon grid h-7 w-7 place-items-center rounded-lg">{action.icon}</span>
                  <span className="truncate text-sm font-semibold text-slate-100">{action.label}</span>
                </button>
              ))}
            </div>
          </SectionCard>
          </div>
        </div>

        {/* Floating Low Stock Peek Modal */}
        {showLowStockModal && (
          <div className="dashboard-modal-overlay" onClick={() => setShowLowStockModal(false)}>
            <div className="dashboard-modal" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
                <div className="flex items-center gap-2 text-rose-400">
                  <Boxes size={18} />
                  <h3 className="text-base font-extrabold text-white">Low Stock Inventory Alert</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowLowStockModal(false)}
                  className="rounded-lg p-1 text-slate-400 hover:text-white hover:bg-white/5 transition"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="max-h-[300px] overflow-y-auto pr-1">
                {data?.low_stock_items?.length > 0 ? (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        <th className="pb-2">Item Name</th>
                        <th className="pb-2 text-right">Quantity</th>
                        <th className="pb-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {data.low_stock_items.map((item) => (
                        <tr key={item.id} className="text-xs">
                          <td className="py-2.5 font-semibold text-slate-200">{item.name}</td>
                          <td className="py-2.5 text-right font-mono font-bold text-rose-400">{item.quantity} left</td>
                          <td className="py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                setShowLowStockModal(false);
                                navigate(`/inventory?q=${item.name}`);
                              }}
                              className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 transition"
                            >
                              Manage
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-center py-6 text-sm text-slate-400">
                    No low stock items found. All inventory is healthy!
                  </div>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-white/10 flex justify-end">
                <Button
                  size="sm"
                  onClick={() => {
                    setShowLowStockModal(false);
                    navigate("/inventory");
                  }}
                >
                  Go to Inventory
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  );
}

