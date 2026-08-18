import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
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
import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import PageContainer from "../components/layout/PageContainer";
import { useFeedback } from "../components/FeedbackProvider";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { X, RefreshCw } from "lucide-react";
import api from "../lib/api";

function ChartEmptyState({ message }) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700/70 bg-slate-950/20 px-4 text-center">
      <BarChart3 size={22} className="text-slate-500" aria-hidden="true" />
      <p className="text-xs text-slate-400">{message}</p>
    </div>
  );
}

function formatPercentage(value, total) {
  const numValue = Number(value || 0);
  const numTotal = Number(total || 0);
  if (numTotal <= 0 || numValue <= 0) return "0%";
  const ratio = (numValue / numTotal) * 100;
  if (ratio >= 100) return "100%";
  if (ratio > 99.9 && ratio < 100) return "99.9%";
  if (ratio > 0 && ratio < 0.1) return "< 0.1%";
  return ratio % 1 === 0 ? `${ratio.toFixed(0)}%` : `${ratio.toFixed(1)}%`;
}

function formatTransactionDate(dateVal) {
  if (!dateVal) return { text: "-", isToday: false, isYesterday: false, dateLabel: "", timeStr: "-" };
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return { text: "-", isToday: false, isYesterday: false, dateLabel: "", timeStr: "-" };

  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();

  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateLabel = isToday ? "Today" : isYesterday ? "Yesterday" : d.toLocaleDateString([], { month: "short", day: "numeric" });

  return { isToday, isYesterday, dateLabel, timeStr };
}

function AnalyticsSection() {
  const [isOpen, setIsOpen] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all([
        api.get('/api/analytics/today-sales'),
        api.get('/api/analytics/low-stock'),
        api.get('/api/analytics/unpaid-balances'),
        api.get('/api/analytics/delayed-repairs'),
        api.get('/api/analytics/peak-hours')
      ]);
      setData({
        sales: results[0].data,
        lowStock: results[1].data,
        unpaid: results[2].data,
        delayedRepairs: results[3].data,
        peakHours: results[4].data
      });
    } catch (err) {
      setError("Failed to fetch analytics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900/60 mb-4">
      <div className="flex items-center justify-between mb-3.5">
        <button 
          onClick={() => setIsOpen(!isOpen)} 
          className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white"
        >
          <span>📊 Live Business Intelligence</span>
          <span className="text-[10px] font-medium text-slate-400">({isOpen ? 'Hide' : 'Show'})</span>
        </button>
        <Button variant="ghost" size="sm" onClick={fetchAnalytics} disabled={loading} className="h-7 w-7 p-0 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </Button>
      </div>

      {isOpen && (
        <>
          {loading ? (
             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
               {[1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton-shimmer h-[120px] rounded-xl" />)}
             </div>
          ) : error ? (
            <div className="text-xs text-rose-600 dark:text-rose-400 p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-500/20 rounded-xl">{error}</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {/* Today's Sales */}
              <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:border-slate-300 dark:border-white/5 dark:bg-slate-950/40 transition-all flex flex-col justify-between">
                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Today's Sales</p>
                <div className="my-1.5">
                  <span className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">LKR {(data?.sales?.total_sales || 0).toLocaleString()}</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{data?.sales?.total_orders || 0} Orders today</p>
              </div>

              {/* Low Stock Alert */}
              <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:border-slate-300 dark:border-white/5 dark:bg-slate-950/40 transition-all flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Low Stock Alert</p>
                  {(data?.lowStock?.count || 0) > 0 && (
                    <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                  )}
                </div>
                <div className="my-1.5">
                  <span className="text-lg font-extrabold text-slate-900 dark:text-white tabular-nums">{data?.lowStock?.count || 0} <span className="text-xs font-semibold text-slate-500">Items</span></span>
                </div>
                <div className="flex flex-col gap-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                  {(data?.lowStock?.top_items || []).slice(0, 2).map((item, i) => (
                    <span key={i} className="truncate">• {item.name} ({item.stock})</span>
                  ))}
                  {(!data?.lowStock?.top_items || data?.lowStock?.top_items.length === 0) && (
                    <span>All items well-stocked</span>
                  )}
                </div>
              </div>

              {/* Unpaid Balances */}
              <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:border-slate-300 dark:border-white/5 dark:bg-slate-950/40 transition-all flex flex-col justify-between">
                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Unpaid Balances</p>
                <div className="my-1.5">
                  <span className="text-lg font-extrabold text-rose-600 dark:text-rose-400 tabular-nums">LKR {(data?.unpaid?.total_amount || 0).toLocaleString()}</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{data?.unpaid?.total_customers || 0} Customers Pending</p>
              </div>

              {/* Delayed Repairs */}
              <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:border-slate-300 dark:border-white/5 dark:bg-slate-950/40 transition-all flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Delayed Repairs</p>
                  {(data?.delayedRepairs?.count || 0) > 0 && (
                    <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
                  )}
                </div>
                <div className="my-1.5">
                  <span className="text-lg font-extrabold text-slate-900 dark:text-white tabular-nums">{data?.delayedRepairs?.count || 0} <span className="text-xs font-semibold text-slate-500">Overdue</span></span>
                </div>
                <div className="flex flex-col gap-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                  {(data?.delayedRepairs?.top_repairs || []).slice(0, 2).map((repair, i) => (
                    <span key={i} className="truncate">• {repair.job_number} ({repair.days_late}d late)</span>
                  ))}
                  {(!data?.delayedRepairs?.top_repairs || data?.delayedRepairs?.top_repairs.length === 0) && (
                    <span>No overdue repair jobs</span>
                  )}
                </div>
              </div>

              {/* Peak Hours */}
              <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:border-slate-300 dark:border-white/5 dark:bg-slate-950/40 transition-all flex flex-col justify-between">
                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Peak Traffic Hours</p>
                <div className="my-1 flex flex-col gap-1 text-[11px]">
                  {(data?.peakHours?.top_hours || []).slice(0, 2).map((ph, i) => (
                    <div key={i} className="flex justify-between items-center text-slate-700 dark:text-slate-300">
                      <span>{ph.hour}</span>
                      <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-1.5 py-0.5 rounded text-[10px]">{ph.count} tx</span>
                    </div>
                  ))}
                  {(!data?.peakHours?.top_hours || data?.peakHours?.top_hours.length === 0) && (
                    <span className="text-[11px] text-slate-400">Awaiting traffic data</span>
                  )}
                </div>
                <p className="text-[10px] text-slate-400">Busiest POS volume periods</p>
              </div>
            </div>
          )}
        </>
      )}
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
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [showLowStockModal, setShowLowStockModal] = useState(false);
  const [sendingZReport, setSendingZReport] = useState(false);
  const [salesRange, setSalesRange] = useState("12m");
  const [activePieIndex, setActivePieIndex] = useState(null);

  const handleSendZReport = async () => {
    setSendingZReport(true);
    try {
      const res = await api.post("/api/whatsapp/send-daily-summary");
      toast({
        title: "Daily Closing Summary Dispatched",
        description: res.data?.message || "Z-Report successfully sent to Owner's WhatsApp.",
        tone: "success",
        iconType: "whatsapp",
        timeoutMs: 4500
      });
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || "Failed to dispatch Daily Summary.";
      toast({
        title: "Dispatch Failed",
        description: detail,
        tone: "error",
        timeoutMs: 5000
      });
    } finally {
      setSendingZReport(false);
    }
  };
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

  if (loading && !data) return <DashboardSkeleton />;
  if (error && !data) return <ErrorState text={error} />;

  const piePalette = ["#06b6d4", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#a855f7"];
  const actionCenter = data?.action_center || {};

  return (
    <PageContainer className="dashboard-page pb-4 pr-1">
      <div className="space-y-2.5">
        <PageHeader
          title="Dashboard"
          subtitle={`Welcome back, ${username}. Here's what's happening today.`}
          action={
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSendZReport}
                disabled={sendingZReport}
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                title="Send today's financial and operational Z-Report to Owner's WhatsApp"
              >
                <MessageCircle size={14} className="text-emerald-400" />
                {sendingZReport ? "Sending..." : "Z-Report (WhatsApp)"}
              </Button>
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

        <AnalyticsSection />

        {/* ACTION CENTER */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-slate-900/60">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
              <span className="flex h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
              <span>Action Center (Requires Attention)</span>
            </div>
            <span className="text-[10px] text-slate-400">Real-time operational alerts</span>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {/* Overdue Repairs */}
            <div
              onClick={() => navigate("/repairs")}
              className="flex items-center justify-between cursor-pointer rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50/80 dark:border-white/10 dark:bg-slate-950/40 dark:hover:bg-slate-900 p-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:border-slate-300 transition-all group"
            >
              <div className="flex items-center gap-2.5">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 group-hover:bg-rose-500/20 transition-colors">
                  <Sparkles size={16} />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100">Overdue Repairs</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Waiting &gt; 7 days</p>
                </div>
              </div>
              <Badge tone="red" className="font-mono font-bold">{actionCenter.overdue_repairs || 0}</Badge>
            </div>

            {/* Low & Out of Stock */}
            <div
              onClick={() => setShowLowStockModal(true)}
              className="flex items-center justify-between cursor-pointer rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50/80 dark:border-white/10 dark:bg-slate-950/40 dark:hover:bg-slate-900 p-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:border-slate-300 transition-all group"
            >
              <div className="flex items-center gap-2.5">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 group-hover:bg-amber-500/20 transition-colors">
                  <Boxes size={16} />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100">Low & Out of Stock</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Items below minimum</p>
                </div>
              </div>
              <Badge tone="amber" className="font-mono font-bold">{(actionCenter.low_stock_items || 0) + (actionCenter.out_of_stock_items || 0)}</Badge>
            </div>

            {/* Supplier Payables */}
            <div
              onClick={() => navigate("/suppliers")}
              className="flex items-center justify-between cursor-pointer rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50/80 dark:border-white/10 dark:bg-slate-950/40 dark:hover:bg-slate-900 p-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:border-slate-300 transition-all group"
            >
              <div className="flex items-center gap-2.5">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 group-hover:bg-indigo-500/20 transition-colors">
                  <Users size={16} />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100">Supplier Payables</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Pending GRN bills</p>
                </div>
              </div>
              <Badge tone="indigo" className="font-mono font-bold">LKR {(actionCenter.pending_supplier_payables || 0).toLocaleString()}</Badge>
            </div>

            {/* Expiring Warranties */}
            <div
              onClick={() => navigate("/warranty")}
              className="flex items-center justify-between cursor-pointer rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50/80 dark:border-white/10 dark:bg-slate-950/40 dark:hover:bg-slate-900 p-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:border-slate-300 transition-all group"
            >
              <div className="flex items-center gap-2.5">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-sky-500/10 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400 group-hover:bg-sky-500/20 transition-colors">
                  <Clock size={16} />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100">Expiring Warranties</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Next 30 days</p>
                </div>
              </div>
              <Badge tone="sky" className="font-mono font-bold">{actionCenter.expiring_warranties || 0}</Badge>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <SectionCard
            title="Sales Overview"
            subtitle={`${data?.sales_period_label || "Sales trend"} · Click a bar to view reports`}
            className="dashboard-chart-card xl:col-span-7 min-h-[340px] flex flex-col"
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
                  <AreaChart data={revData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="salesRevenueGlow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
                    <XAxis
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: 600 }}
                      dy={8}
                      interval={salesRange === "30d" ? 4 : 0}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: 600 }}
                      width={65}
                      tickFormatter={(v) => (v >= 1000000 ? `LKR ${(v / 1000000).toFixed(1)}M` : `LKR ${(v / 1000).toFixed(0)}k`)}
                    />
                    <Tooltip
                      cursor={{ stroke: "#06b6d4", strokeWidth: 1.5, strokeDasharray: "4 4" }}
                      contentStyle={{
                        backgroundColor: "#0f172a",
                        borderRadius: "12px",
                        border: "1px solid rgba(6, 182, 212, 0.4)",
                        boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.7)",
                        padding: "10px 14px",
                      }}
                      itemStyle={{ color: "#ffffff", fontWeight: 700, fontSize: "13px" }}
                      labelStyle={{ color: "#38bdf8", fontWeight: 800, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}
                      formatter={(val) => [`LKR ${Number(val).toLocaleString()}`, "Revenue"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#06b6d4"
                      strokeWidth={3}
                      fillOpacity={1}
                      fill="url(#salesRevenueGlow)"
                      activeDot={{ r: 6, fill: "#22d3ee", stroke: "#0f172a", strokeWidth: 3 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmptyState message="Sales will appear here once invoices are completed." />
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Sales Breakdown"
            subtitle={`${data?.sales_period_label || "Selected period"} · Click category to inspect`}
            className="dashboard-chart-card xl:col-span-5 min-h-[340px] flex flex-col justify-between"
            bodyClassName="flex min-h-0 flex-1 flex-col justify-between"
          >
            {hasSalesBreakdown ? (
              <div className="mt-2 flex flex-col items-center justify-between gap-6 md:flex-row md:items-center">
                {/* Donut Chart with Interactive Center Total Badge */}
                <div className="relative flex h-[210px] w-full items-center justify-center md:w-1/2">
                  <ResponsiveContainer width="100%" height={210}>
                    <PieChart>
                      <Pie
                        data={activeSalesData}
                        innerRadius="64%"
                        outerRadius="88%"
                        paddingAngle={activeSalesData.length > 1 ? 4 : 0}
                        cornerRadius={activeSalesData.length > 1 ? 6 : 0}
                        dataKey="value"
                        stroke="none"
                        onClick={(entry) => navigate(`/inventory?q=${entry.name}`)}
                        onMouseEnter={(_, index) => setActivePieIndex(index)}
                        onMouseLeave={() => setActivePieIndex(null)}
                        style={{ cursor: "pointer" }}
                      >
                        {activeSalesData.map((entry, index) => {
                          const isHovered = activePieIndex === index;
                          const isOtherHovered = activePieIndex !== null && !isHovered;
                          return (
                            <Cell
                              key={`mix-${index}`}
                              fill={piePalette[index % piePalette.length]}
                              opacity={isOtherHovered ? 0.35 : 1}
                              className="transition-all duration-300"
                            />
                          );
                        })}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>

                  {/* Clean Dynamic Center Badge */}
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                    <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-slate-950/90 p-2 backdrop-blur-md border border-white/10 shadow-[0_0_25px_rgba(6,182,212,0.2)] transition-all duration-200">
                      {activePieIndex !== null && activeSalesData[activePieIndex] ? (
                        <>
                          <span
                            className="max-w-[78px] truncate text-[9px] font-black uppercase tracking-wider"
                            style={{ color: piePalette[activePieIndex % piePalette.length] }}
                          >
                            {activeSalesData[activePieIndex].name}
                          </span>
                          <span className="mt-0.5 text-xs font-black text-white tabular-nums tracking-tight">
                            LKR {Number(activeSalesData[activePieIndex].value || 0) >= 1000000
                              ? `${(Number(activeSalesData[activePieIndex].value || 0) / 1000000).toFixed(1)}M`
                              : Number(activeSalesData[activePieIndex].value || 0).toLocaleString()}
                          </span>
                          <span className="text-[9px] font-bold text-slate-400">
                            {formatPercentage(activeSalesData[activePieIndex].value, totalSales)} of sales
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-[9px] font-black uppercase tracking-wider text-cyan-400">Total Sales</span>
                          <span className="mt-0.5 text-xs font-black text-white tabular-nums tracking-tight">
                            LKR {totalSales >= 1000000 ? `${(totalSales / 1000000).toFixed(1)}M` : totalSales.toLocaleString()}
                          </span>
                          <span className="text-[9px] font-medium text-slate-500">
                            {activeSalesData.length} {activeSalesData.length === 1 ? "Category" : "Categories"}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Interactive Category Legend List */}
                <div className="w-full space-y-2.5 md:w-1/2">
                  {activeSalesData.map((s, i) => {
                    const color = piePalette[i % piePalette.length];
                    const pctStr = formatPercentage(s.value, totalSales);
                    const valNum = Number(s.value || 0);
                    const barWidth = totalSales > 0 ? Math.min(100, Math.max((valNum / totalSales) * 100, valNum > 0 ? 2 : 0)) : 0;
                    const isActive = activePieIndex === i;
                    return (
                      <div
                        key={s.name}
                        onClick={() => navigate(`/inventory?q=${s.name}`)}
                        onMouseEnter={() => setActivePieIndex(i)}
                        onMouseLeave={() => setActivePieIndex(null)}
                        className={`group flex flex-col rounded-xl border p-3 transition-all duration-200 cursor-pointer shadow-sm ${
                          isActive
                            ? "border-cyan-400/60 bg-slate-800/90 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                            : "border-white/5 bg-slate-900/60 hover:border-white/20 hover:bg-slate-800/60"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className="h-3 w-3 shrink-0 rounded-full transition-transform duration-200 group-hover:scale-110"
                              style={{
                                backgroundColor: color,
                                boxShadow: `0 0 10px ${color}80`,
                              }}
                            />
                            <span className="truncate text-xs font-bold text-slate-200 group-hover:text-white">
                              {s.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 text-xs">
                            <span className="font-bold tabular-nums font-mono text-white">
                              LKR {Number(s.value || 0).toLocaleString()}
                            </span>
                            <span
                              className="rounded-md px-2 py-0.5 text-[10px] font-extrabold shadow-sm"
                              style={{ backgroundColor: `${color}25`, color: color, border: `1px solid ${color}50` }}
                            >
                              {pctStr}
                            </span>
                          </div>
                        </div>
                        {/* Progress Bar */}
                        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-950/80">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${barWidth}%`,
                              backgroundColor: color,
                              boxShadow: `0 0 8px ${color}80`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <ChartEmptyState message="Category sales will appear after your first sale." />
            )}
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
            title="Recent Transactions"
            subtitle="Latest sales & quick actions"
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
                    <th>Date / Time</th>
                    <th>Total</th>
                    <th>Method</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tx.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-sm text-slate-400">No recent transactions found.</td>
                    </tr>
                  ) : tx.slice(0, 6).map((t, idx) => (
                    <tr key={t.id || idx}>
                      <td className="font-mono text-xs text-slate-400">{t.invoice_no || `INV-${String(idx + 1).padStart(4, "0")}`}</td>
                      <td className="font-bold text-slate-200">
                        <div>{t.customer || "Walk-in"}</div>
                        {t.customer_phone && <div className="text-[10px] text-slate-400 font-normal">{t.customer_phone}</div>}
                      </td>
                      <td className="text-xs font-mono">
                        {(() => {
                          const { isToday, dateLabel, timeStr } = formatTransactionDate(t.date || t.created_at || t.timestamp);
                          if (timeStr === "-") return <span className="text-slate-400">-</span>;
                          return (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-slate-200 font-medium">{timeStr}</span>
                              <span className={`text-[10px] font-semibold tracking-wide ${isToday ? "text-emerald-400" : "text-slate-400"}`}>
                                {dateLabel}
                              </span>
                            </div>
                          );
                        })()}
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
                              const printUrl = window.location.protocol === "file:"
                                ? `/#/invoice/${t.id}?autoprint=1`
                                : `/invoice/${t.id}?autoprint=1`;
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
                              onClick={async () => {
                                let phone = (t.customer_phone || "").replace(/[^\d]/g, "");
                                if (phone.startsWith("0")) phone = "94" + phone.slice(1);
                                if (!phone) return;

                                const portalBase = "https://i-store-customer-portal-one.vercel.app";
                                const s = `${t.invoice_no}istore_secure_salt_2026`;
                                let hashVal = 0;
                                for (let i = 0; i < s.length; i++) {
                                  hashVal = (hashVal << 5) - hashVal + s.charCodeAt(i);
                                  hashVal |= 0;
                                }
                                const token = `sec_${Math.abs(hashVal).toString(16).padStart(8, '0')}`.slice(0, 12);
                                const billUrl = `${portalBase}/invoice/${t.invoice_no}?token=${token}`;
                                const msg = `*Receipt from I-Store*\n\nHello ${t.customer || "Customer"},\nThank you for your purchase!\n\n*Invoice No:* ${t.invoice_no}\n*Total:* LKR ${(t.total || 0).toLocaleString()}\n\n*View & Download Digital Bill:* ${billUrl}\n\nHave a great day!`;

                                // Use the configured api client — routes to backend (:8000) with auth and error mapping
                                try {
                                  const res = await api.post("/api/whatsapp/send-direct", {
                                    phone,
                                    message: msg
                                  });
                                  if (res.data?.ok) {
                                    toast({
                                      title: "WhatsApp Invoice Dispatched",
                                      description: `Invoice #${t.invoice_no} (LKR ${(t.total || 0).toLocaleString()}) sent to ${t.customer || "Customer"}`,
                                      details: `Recipient: +${phone} • Message ID: ${res.data?.message_id || "sent"}`,
                                      tone: "success",
                                      iconType: "whatsapp",
                                      timeoutMs: 4500
                                    });
                                  } else {
                                    const detail = res.data?.detail || res.data?.error || "Unknown error";
                                    toast({
                                      title: "WhatsApp Dispatch Failed",
                                      description: detail,
                                      details: `Recipient: +${phone}`,
                                      tone: "error",
                                      iconType: "whatsapp",
                                      timeoutMs: 4500
                                    });
                                  }
                                } catch (err) {
                                  const detail = err.response?.data?.detail || err.userMessage || err.message || "Unknown error";
                                  if (typeof detail === "string" && (detail.toLowerCase().includes("not registered") || detail.includes("422"))) {
                                    toast({
                                      title: "Recipient Not On WhatsApp",
                                      description: `The number +${phone} is not registered with an active WhatsApp account.`,
                                      details: `Customer: ${t.customer || "Unknown"}`,
                                      tone: "warning",
                                      iconType: "whatsapp",
                                      timeoutMs: 4500
                                    });
                                  } else if (typeof detail === "string" && (detail.toLowerCase().includes("not reachable") || detail.toLowerCase().includes("offline"))) {
                                    toast({
                                      title: "WhatsApp Microservice Offline",
                                      description: "The background WhatsApp service is not responding. Please ensure node server.js is running.",
                                      tone: "error",
                                      timeoutMs: 5000
                                    });
                                  } else if (typeof detail === "string" && (detail.toLowerCase().includes("ack_error") || detail.toLowerCase().includes("rejected"))) {
                                    toast({
                                      title: "WhatsApp Message Rejected",
                                      description: "WhatsApp server rejected the dispatch. The account may be rate-limited from multiple rapid sends.",
                                      details: "Please wait a few minutes before trying again.",
                                      tone: "warning",
                                      iconType: "whatsapp",
                                      timeoutMs: 5000
                                    });
                                  } else {
                                    toast({
                                      title: "WhatsApp Send Failed",
                                      description: String(detail),
                                      tone: "error",
                                      timeoutMs: 4500
                                    });
                                  }
                                }
                              }}
                              className="rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 p-1.5 text-emerald-300 transition cursor-pointer"
                              title="Send WhatsApp Invoice Directly"
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
                  <div key={item.name + idx} className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-950/30 p-2.5">
                    <div className="flex items-center gap-3">
                      <span className="grid h-6 w-6 place-items-center rounded-lg bg-indigo-500/20 text-xs font-black text-indigo-700 dark:text-indigo-300">
                        #{idx + 1}
                      </span>
                      <div>
                        <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{item.name}</p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">{item.qty} units sold</p>
                      </div>
                    </div>
                    <p className="text-xs font-black text-emerald-600 dark:text-emerald-300">LKR {item.sales.toLocaleString()}</p>
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
            ) : (() => {
              const totalPmAmount = data.payment_methods.reduce((sum, item) => sum + Number(item.amount || 0), 0);
              const pmPalette = { Cash: "#10b981", Card: "#3b82f6", Transfer: "#8b5cf6", Credit: "#f59e0b" };
              return (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {data.payment_methods.map((pm) => {
                    const pctStr = formatPercentage(pm.amount, totalPmAmount);
                    const channelColor = pmPalette[pm.name] || "#06b6d4";
                    return (
                      <div key={pm.name} className="flex flex-col justify-between rounded-xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-900/60 p-3 transition-all hover:border-cyan-500/30">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">{pm.name}</span>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{pm.count} transactions</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-black text-slate-900 dark:text-white tabular-nums">LKR {pm.amount.toLocaleString()}</p>
                            <span
                              className="mt-0.5 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-extrabold"
                              style={{ backgroundColor: `${channelColor}25`, color: channelColor, border: `1px solid ${channelColor}40` }}
                            >
                              {pctStr} share
                            </span>
                          </div>
                        </div>
                        {/* Progress Bar */}
                        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-950/80">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: pctStr,
                              backgroundColor: channelColor,
                              boxShadow: `0 0 8px ${channelColor}80`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
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
              <div className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-950/20 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">Total Stock Value (Cost)</span>
                <p className="text-base font-black text-amber-900 dark:text-amber-200 mt-1">LKR {(data?.inventory_stats?.worth_cost || 0).toLocaleString()}</p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">Retail Worth: LKR {(data?.inventory_stats?.worth_retail || 0).toLocaleString()}</p>
              </div>

              <div className="rounded-xl border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-950/20 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">Dead Stock Tied Value</span>
                <p className="text-base font-black text-rose-900 dark:text-rose-200 mt-1">LKR {(data?.inventory_stats?.dead_stock_value || 0).toLocaleString()}</p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">{data?.inventory_stats?.dead_stock_count || 0} Products Unsold &gt; 90 Days</p>
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
                  <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{action.label}</span>
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

