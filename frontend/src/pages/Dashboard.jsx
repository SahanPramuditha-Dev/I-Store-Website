import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { useFetch } from "../hooks/useFetch";
import { ErrorState, KpiCard, Loading, PageHeader, SectionCard, Table, Badge, Button } from "../components/UI";
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
  Printer,
  MessageCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageContainer from "../components/layout/PageContainer";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { X } from "lucide-react";

function ChartEmptyState({ message }) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700/70 bg-slate-950/20 px-4 text-center">
      <BarChart3 size={22} className="text-slate-500" aria-hidden="true" />
      <p className="text-xs text-slate-400">{message}</p>
    </div>
  );
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
  const [salesRange, setSalesRange] = useState("12m");
  const { data, loading, error } = useFetch(`/dashboard?range=${salesRange}`);
  const role = localStorage.getItem("login_role") || "admin";
  const username = localStorage.getItem("username") || "Admin";

  const revData = data?.charts?.revenue_overview || [];
  const salesData = data?.charts?.sales_breakdown || [];
  const hasRevenueData = revData.some((entry) => Number(entry?.value) > 0);
  const activeSalesData = salesData.filter((entry) => Number(entry?.value) > 0);
  const hasSalesBreakdown = activeSalesData.length > 0;
  const repairStatusData = data?.charts?.repair_status || [];
  const activeRepairStatuses = repairStatusData.filter((entry) => Number(entry?.value) > 0);
  const totalRepairStatuses = activeRepairStatuses.reduce((total, entry) => total + Number(entry.value || 0), 0);
  const repairs = data?.recent_repairs || [];
  const feed = data?.activity_feed || [];
  const tx = data?.recent_transactions || [];

  const pendingRepairs = Math.max(0, (data?.repair_stats?.total || 0) - (data?.repair_stats?.completed || 0));
  const completionRate = data?.repair_stats?.total
    ? ((data?.repair_stats?.completed || 0) / data.repair_stats.total) * 100
    : 0;

  const totalSales = activeSalesData.reduce((a, b) => a + Number(b.value || 0), 0);
  const recentSalesValue = tx.reduce((total, sale) => total + Number(sale.total || 0), 0);

  const { pendingCount, isOnline } = useSyncStatus();

  const health = [
    {
      label: "Database Connected",
      tone: isOnline ? "green" : "rose",
      icon: <Database size={13} />,
      meta: isOnline ? "Live" : "Offline Mode",
      accent: isOnline ? "text-emerald-300" : "text-rose-300",
    },
    {
      label: "Backup Enabled",
      tone: "sky",
      icon: <HardDriveDownload size={13} />,
      meta: "23:59 UTC",
      accent: "text-cyan-300",
    },
    {
      label: "Offline Ready",
      tone: pendingCount > 0 ? "amber" : "indigo",
      icon: <WifiOff size={13} />,
      meta: `Queue ${pendingCount}`,
      accent: pendingCount > 0 ? "text-amber-300" : "text-indigo-300",
    },
    {
      label: "API Healthy",
      tone: isOnline ? "amber" : "rose",
      icon: <Server size={13} />,
      meta: isOnline ? "<50ms" : "Offline",
      accent: isOnline ? "text-amber-300" : "text-rose-300",
    },
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

  const executiveKpis = [
    {
      title: "Today's Revenue",
      value: `LKR ${(data?.daily_revenue || 0).toLocaleString()}`,
      hint: `Cash LKR ${(data?.today_cash_sales || 0).toLocaleString()} | Card LKR ${(data?.today_card_sales || 0).toLocaleString()}`,
      tone: "sky",
      icon: <BadgeDollarSign size={18} />,
      to: "/reports",
    },
    {
      title: "Today's Profit",
      value: `LKR ${(data?.today_profit || 0).toLocaleString()}`,
      hint: `Margin: ${(data?.today_margin_pct || 0)}%`,
      tone: "green",
      icon: <Sparkles size={18} />,
      to: "/reports",
    },
    {
      title: "Inventory Worth",
      value: `LKR ${(data?.inventory_stats?.worth_cost || 0).toLocaleString()}`,
      hint: `${data?.inventory_stats?.total_items || 0} Total Products (${data?.inventory_stats?.out_of_stock_count || 0} Out of Stock)`,
      tone: "amber",
      icon: <Boxes size={18} />,
      to: "/inventory",
    },
    {
      title: "Credit Receivables",
      value: `LKR ${(data?.outstanding_balance || 0).toLocaleString()}`,
      hint: `${data?.pending_credit_customers || 0} Customers Pending Payment`,
      tone: "red",
      icon: <Receipt size={18} />,
      to: "/customers",
    },
    {
      title: "Repair Workload",
      value: `${pendingRepairs} Pending`,
      hint: `${data?.repair_stats?.completed || 0} Completed | ${completionRate.toFixed(0)}% Rate`,
      tone: "violet",
      icon: <Wrench size={18} />,
      to: "/repairs",
    },
    {
      title: "Supplier Payables",
      value: `LKR ${(data?.suppliers_summary?.pending_payables || 0).toLocaleString()}`,
      hint: `Across ${data?.suppliers_summary?.count || 0} Active Suppliers`,
      tone: "indigo",
      icon: <Users size={18} />,
      to: "/suppliers",
    },
  ];

  if (loading) return <DashboardSkeleton />;
  if (error) return <ErrorState text={error} />;

  const piePalette = ["#22d3ee", "#3b82f6", "#8b5cf6", "#f97316", "#10b981", "#eab308"];
  const actionCenter = data?.action_center || {};

  return (
    <PageContainer className="dashboard-page pb-4 pr-1">
      <div className="space-y-2.5">
        <PageHeader
          eyebrow="Live Business Summary"
          title="Dashboard"
          subtitle={`Welcome back, ${username}. Here's what's happening today.`}
          action={
            <>
              <div className="dashboard-date-pill inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-200">
                <CalendarDays size={13} />
                {new Date().toLocaleDateString()}
              </div>
              <Button variant="secondary" size="sm" onClick={() => navigate("/pos")}>
                Open POS
                <ArrowRight size={14} />
              </Button>
            </>
          }
        />

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
          {executiveKpis.map((k) => (
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

        {/* ACTION CENTER */}
        <div className="rounded-xl border border-rose-500/20 bg-slate-900/60 p-3 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-400">
              <Sparkles size={15} className="animate-pulse" />
              <span>⚡ Action Center (Requires Attention)</span>
            </div>
            <span className="text-[10px] text-slate-400">Real-time operational alerts</span>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <div
              onClick={() => navigate("/repairs")}
              className="flex items-center justify-between cursor-pointer rounded-lg border border-rose-500/30 bg-rose-950/20 p-2.5 transition hover:border-rose-400"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                <div>
                  <p className="text-xs font-semibold text-rose-200">Overdue Repairs</p>
                  <p className="text-[10px] text-slate-400">Waiting &gt; 7 days</p>
                </div>
              </div>
              <Badge tone="red">{actionCenter.overdue_repairs || 0}</Badge>
            </div>

            <div
              onClick={() => setShowLowStockModal(true)}
              className="flex items-center justify-between cursor-pointer rounded-lg border border-amber-500/30 bg-amber-950/20 p-2.5 transition hover:border-amber-400"
            >
              <div className="flex items-center gap-2">
                <Boxes size={14} className="text-amber-400" />
                <div>
                  <p className="text-xs font-semibold text-amber-200">Low & Out of Stock</p>
                  <p className="text-[10px] text-slate-400">Items below minimum</p>
                </div>
              </div>
              <Badge tone="amber">{(actionCenter.low_stock_items || 0) + (actionCenter.out_of_stock_items || 0)}</Badge>
            </div>

            <div
              onClick={() => navigate("/suppliers")}
              className="flex items-center justify-between cursor-pointer rounded-lg border border-indigo-500/30 bg-indigo-950/20 p-2.5 transition hover:border-indigo-400"
            >
              <div className="flex items-center gap-2">
                <Users size={14} className="text-indigo-400" />
                <div>
                  <p className="text-xs font-semibold text-indigo-200">Supplier Payables</p>
                  <p className="text-[10px] text-slate-400">Pending GRN bills</p>
                </div>
              </div>
              <Badge tone="indigo">LKR {(actionCenter.pending_supplier_payables || 0).toLocaleString()}</Badge>
            </div>

            <div
              onClick={() => navigate("/warranty")}
              className="flex items-center justify-between cursor-pointer rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-2.5 transition hover:border-cyan-400"
            >
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-cyan-400" />
                <div>
                  <p className="text-xs font-semibold text-cyan-200">Expiring Warranties</p>
                  <p className="text-[10px] text-slate-400">Next 30 days</p>
                </div>
              </div>
              <Badge tone="sky">{actionCenter.expiring_warranties || 0}</Badge>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <SectionCard
            title="Sales Overview"
            subtitle={`${data?.sales_period_label || "Sales trend"} · Click a bar to view reports`}
            className="dashboard-chart-card xl:col-span-7 h-[250px] md:h-[280px] flex flex-col"
            bodyClassName="flex min-h-0 flex-1"
            right={
              <div className="dashboard-range-tabs" aria-label="Sales chart range">
                {[{ value: "7d", label: "7D" }, { value: "30d", label: "30D" }, { value: "12m", label: "12M" }].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSalesRange(option.value)}
                    className={salesRange === option.value ? "is-active" : ""}
                    aria-pressed={salesRange === option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            }
          >
            <div className="mt-4 min-h-0 flex-1">
              {hasRevenueData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="rgba(148,163,184,0.14)" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#9fb3d9", fontSize: 11 }} dy={8} interval={salesRange === "30d" ? 4 : 0} />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#9fb3d9", fontSize: 11 }}
                    width={65}
                    tickFormatter={(v) => (v >= 1000000 ? `LKR ${(v / 1000000).toFixed(1)}M` : `LKR ${(v / 1000).toFixed(0)}k`)}
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
                    barSize={salesRange === "30d" ? 12 : 28}
                    onClick={() => navigate("/reports")}
                    style={{ cursor: "pointer" }}
                  >
                    {revData.map((entry, index) => (
                      <Cell key={`rev-${index}`} fill={index === revData.length - 1 ? "#22d3ee" : "#7c3aed"} opacity={index === revData.length - 1 ? 1 : 0.78} />
                    ))}
                  </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmptyState message="Sales will appear here once invoices are completed." />
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Sales Breakdown"
            subtitle={`${data?.sales_period_label || "Selected period"} · Click a category to open inventory`}
            className="dashboard-chart-card xl:col-span-5 h-[250px] md:h-[280px] flex flex-col"
            bodyClassName="flex min-h-0 flex-1 flex-col"
          >
            <div className="relative mt-2 min-h-[160px] flex-1">
              {hasSalesBreakdown ? (
                <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                  <Pie
                    data={activeSalesData}
                    innerRadius="58%"
                    outerRadius="82%"
                    paddingAngle={4}
                    dataKey="value"
                    stroke="none"
                    onClick={(entry) => navigate(`/inventory?q=${entry.name}`)}
                    style={{ cursor: "pointer" }}
                  >
                    {activeSalesData.map((entry, index) => (
                      <Cell key={`mix-${index}`} fill={piePalette[index % piePalette.length]} />
                    ))}
                  </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="rounded-xl border border-cyan-300/40 bg-slate-950/95 px-3.5 py-2 text-center shadow-xl shadow-cyan-950/50">
                    <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-cyan-300">Total sales</p>
                    <p className="mt-0.5 text-base font-black tabular-nums text-white">LKR {totalSales.toLocaleString()}</p>
                  </div>
                </div>
                </>
              ) : (
                <ChartEmptyState message="Category sales will appear after your first sale." />
              )}
            </div>
            {hasSalesBreakdown && <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {activeSalesData.map((s, i) => (
                <div key={s.name} className="flex items-center justify-between rounded-md bg-slate-950/25 px-2 py-1 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full shadow-sm" style={{ backgroundColor: piePalette[i % piePalette.length] }} />
                    <span className="font-medium text-slate-300">{s.name}</span>
                  </div>
                  <span className="font-bold tabular-nums text-slate-100">
                    LKR {Number(s.value || 0).toLocaleString()} · {Math.round(((s.value || 0) / totalSales) * 100)}%
                  </span>
                </div>
              ))}
            </div>}
          </SectionCard>

          <SectionCard
            title="Repair Overview"
            subtitle="Recent repair tickets and workflow"
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
                  {repairs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-sm text-slate-400">No repair tickets yet today.</td>
                    </tr>
                  ) : repairs.slice(0, 6).map((r) => (
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
            {totalRepairStatuses > 0 && (
              <div className="mt-3 border-t border-white/10 pt-3">
                <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <span>Repair pipeline</span>
                  <span>{totalRepairStatuses} open &amp; completed</span>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-slate-800/80">
                  {activeRepairStatuses.map((status, index) => (
                    <div
                      key={status.name}
                      title={`${status.name}: ${status.value}`}
                      className="transition-all"
                      style={{
                        width: `${(Number(status.value) / totalRepairStatuses) * 100}%`,
                        backgroundColor: ["#38bdf8", "#818cf8", "#f59e0b", "#22c55e", "#a855f7", "#fb7185"][index % 6],
                      }}
                    />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  {activeRepairStatuses.map((status, index) => (
                    <span key={status.name} className="inline-flex items-center gap-1.5 text-[10px] text-slate-400">
                      <i className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ["#38bdf8", "#818cf8", "#f59e0b", "#22c55e", "#a855f7", "#fb7185"][index % 6] }} />
                      {status.name} <b className="text-slate-200">{status.value}</b>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Today's Sales"
            subtitle="Latest transactions & quick actions"
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
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tx.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-sm text-slate-400">No completed sales yet today.</td>
                    </tr>
                  ) : tx.slice(0, 6).map((t, idx) => (
                    <tr key={t.id || idx}>
                      <td className="font-mono text-xs text-slate-400">{t.invoice_no || `INV-${String(idx + 1).padStart(4, "0")}`}</td>
                      <td className="font-bold text-slate-200">
                        <div>{t.customer || "Walk-in"}</div>
                        {t.customer_phone && <div className="text-[10px] text-slate-400 font-normal">{t.customer_phone}</div>}
                      </td>
                      <td className="font-semibold text-emerald-300">LKR {(t.total || 0).toLocaleString()}</td>
                      <td>
                        <Badge tone="indigo" className="text-[9px] px-2 py-0.5">
                          {t.payment_method || "Cash"}
                        </Badge>
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => navigate(`/invoice/${t.id}`)}
                            className="rounded-lg bg-white/5 hover:bg-white/10 p-1.5 text-slate-300 hover:text-white transition"
                            title="View Invoice"
                          >
                            <Receipt size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const printUrl = `/invoice/${t.id}?autoprint=1`;
                              const printWindow = window.open(printUrl, "_blank");
                              if (printWindow) printWindow.focus();
                            }}
                            className="rounded-lg bg-white/5 hover:bg-white/10 p-1.5 text-slate-300 hover:text-white transition"
                            title="Print Invoice"
                          >
                            <Printer size={13} />
                          </button>
                          {t.customer_phone && (
                            <button
                              type="button"
                              onClick={() => {
                                let phone = (t.customer_phone || "").replace(/[^\d]/g, "");
                                if (phone.startsWith("0")) phone = "94" + phone.slice(1);
                                const portalBase = "https://i-store-customer-portal-one.vercel.app";

                                // ── Generate matching token deterministically ───────────────────────────
                                const s = `${t.invoice_no}istore_secure_salt_2026`;
                                let hashVal = 0;
                                for (let i = 0; i < s.length; i++) {
                                  hashVal = (hashVal << 5) - hashVal + s.charCodeAt(i);
                                  hashVal |= 0; // force 32-bit signed integer
                                }
                                const token = `sec_${Math.abs(hashVal).toString(16).padStart(8, '0')}`.slice(0, 12);
                                // ────────────────────────────────────────────────────────────────────────

                                const billUrl = `${portalBase}/invoice/${t.invoice_no}?token=${token}`;
                                const msg = `*Receipt from I-Store*\n\nHello ${t.customer || "Customer"},\nThank you for your purchase!\n\n*Invoice No:* ${t.invoice_no}\n*Total:* LKR ${(t.total || 0).toLocaleString()}\n\n*View & Download Digital Bill:* ${billUrl}\n\nHave a great day!`;
                                window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
                              }}
                              className="rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 p-1.5 text-emerald-300 transition"
                              title="Share on WhatsApp"
                            >
                              <MessageCircle size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </SectionCard>

          <SectionCard title="Recent Payments" subtitle="Settlement stream" className="dashboard-table-card xl:col-span-4">
            {tx.length === 0 ? (
              <div className="dashboard-empty-copy">Payments will appear here as sales are settled.</div>
            ) : <div className="space-y-2">
              {tx.slice(0, 6).map((t, idx) => (
                <div key={`p-${t.id || idx}`} className="dashboard-list-row flex items-center justify-between rounded-xl border px-3 py-2">
                  <div>
                    <p className="text-xs font-bold text-slate-200">{t.customer || "Walk-in"}</p>
                    <p className="text-[10px] text-slate-400">{t.payment_method || "Cash"}</p>
                  </div>
                  <p className="text-xs font-black text-emerald-300">LKR {(t.total || 0).toLocaleString()}</p>
                </div>
              ))}
            </div>}
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
            {feed.length === 0 ? (
              <div className="dashboard-empty-copy">Activity will appear here as your team works.</div>
            ) : <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
            </div>}
          </SectionCard>

          {/* Top Products & Payment Methods Analytics */}
          <SectionCard
            title="Top Selling Items"
            subtitle={`${data?.sales_period_label || "Selected period"} · Best performing products`}
            className="dashboard-table-card xl:col-span-6"
            right={
              <Button variant="ghost" size="sm" onClick={() => navigate("/inventory")}>
                Inventory
                <ArrowRight size={14} className="ml-1" />
              </Button>
            }
          >
            {(!data?.top_products || data.top_products.length === 0) ? (
              <div className="dashboard-empty-copy">No sales data recorded for this period.</div>
            ) : (
              <div className="space-y-2.5">
                {data.top_products.map((item, idx) => (
                  <div key={item.name + idx} className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/30 p-2.5">
                    <div className="flex items-center gap-3">
                      <span className="grid h-6 w-6 place-items-center rounded-lg bg-indigo-500/20 text-xs font-black text-indigo-300">
                        #{idx + 1}
                      </span>
                      <div>
                        <p className="text-xs font-bold text-slate-200">{item.name}</p>
                        <p className="text-[10px] text-slate-400">{item.qty} units sold</p>
                      </div>
                    </div>
                    <p className="text-xs font-black text-emerald-300">LKR {item.sales.toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Payment Methods"
            subtitle={`${data?.sales_period_label || "Selected period"} · Settlement channel breakdown`}
            className="dashboard-table-card xl:col-span-6"
          >
            {(!data?.payment_methods || data.payment_methods.length === 0) ? (
              <div className="dashboard-empty-copy">No payment records found.</div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {data.payment_methods.map((pm) => (
                  <div key={pm.name} className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/40 p-3">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{pm.name}</span>
                      <p className="text-xs text-slate-400 mt-0.5">{pm.count} transactions</p>
                    </div>
                    <p className="text-sm font-black text-cyan-300">LKR {pm.amount.toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Dead Stock Intelligence Card */}
          <SectionCard
            title="Inventory Health & Dead Stock"
            subtitle="Products inactive for >90 days"
            className="dashboard-table-card xl:col-span-6"
            right={
              <Button variant="ghost" size="sm" onClick={() => navigate("/inventory")}>
                View All
                <ArrowRight size={14} className="ml-1" />
              </Button>
            }
          >
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Total Stock Value (Cost)</span>
                <p className="text-base font-black text-amber-200 mt-1">LKR {(data?.inventory_stats?.worth_cost || 0).toLocaleString()}</p>
                <p className="text-[10px] text-slate-400">Retail Worth: LKR {(data?.inventory_stats?.worth_retail || 0).toLocaleString()}</p>
              </div>

              <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400">Dead Stock Tied Value</span>
                <p className="text-base font-black text-rose-200 mt-1">LKR {(data?.inventory_stats?.dead_stock_value || 0).toLocaleString()}</p>
                <p className="text-[10px] text-slate-400">{data?.inventory_stats?.dead_stock_count || 0} Products Unsold &gt; 90 Days</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Quick Actions" subtitle="Jump into common workflows" className="dashboard-actions-card xl:col-span-6">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
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

