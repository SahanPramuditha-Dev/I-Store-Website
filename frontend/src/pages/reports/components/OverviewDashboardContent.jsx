import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  Clock3,
  HandCoins,
  Receipt,
  ShoppingCart,
  TrendingUp,
  Wallet,
  Wrench,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge, Button, KpiCard, SectionCard, Table } from "../../../components/UI";

const MONEY_LOCALE = "en-LK";
const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short" });
const DAY_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const PIE_COLORS = ["#38bdf8", "#6366f1", "#14b8a6", "#f59e0b", "#f97316", "#a78bfa"];

function money(value) {
  return `LKR ${Math.round(Number(value || 0)).toLocaleString(MONEY_LOCALE)}`;
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDayKey(value) {
  const date = toDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function toMonthKey(value) {
  const date = toDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addDays(dateLike, days) {
  const date = toDate(dateLike);
  if (!date) return null;
  const cloned = new Date(date);
  cloned.setDate(cloned.getDate() + days);
  return cloned;
}

function pctChange(current, previous) {
  const curr = Number(current || 0);
  const prev = Number(previous || 0);
  if (prev === 0) return curr === 0 ? 0 : 100;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isCompletedRepair(status) {
  const value = String(status || "").toLowerCase();
  return value === "completed" || value === "delivered";
}

function isCreditLike(paymentMethod) {
  const value = String(paymentMethod || "").toLowerCase();
  return value.includes("credit") || value.includes("due") || value.includes("partial");
}

function compareTone(value, invert = false) {
  if (value === 0) return "text-slate-400";
  const positive = value > 0;
  const success = invert ? !positive : positive;
  return success ? "text-emerald-300" : "text-rose-300";
}

function compareLabel(current, previous, compareToLabel, invert = false) {
  const delta = pctChange(current, previous);
  const prefix = delta >= 0 ? "+" : "-";
  return {
    text: `${prefix}${Math.abs(delta).toFixed(1)}% vs ${compareToLabel}`,
    className: compareTone(delta, invert),
  };
}

function MetricHint({ hint, className = "" }) {
  return <span className={`inline-flex items-center gap-1 ${className}`}>{hint}</span>;
}

function CompactTable({ columns, rows, emptyLabel = "No records found." }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
      <Table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.label}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="py-6 text-slate-400">
                {emptyLabel}
              </td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr key={row.id || row.key || index}>
              {columns.map((col) => (
                <td key={`${row.id || index}-${col.label}`}>
                  {typeof col.value === "function" ? col.value(row) : row[col.value]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function daySeries(count) {
  const rows = [];
  const today = new Date();
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    rows.push({
      dayKey: toDayKey(date),
      label: DAY_LABEL.format(date),
      revenue: 0,
      compare: 0,
    });
  }
  return rows;
}

export default function OverviewDashboardContent({
  salesRows,
  repairRows,
  repairTicketRows,
  inventoryRows,
  purchaseRows,
  movementRows,
  notificationsRows,
  summary,
  onOverviewComputed,
}) {
  const navigate = useNavigate();
  const [comparisonMode, setComparisonMode] = useState(false);
  const [clockNow, setClockNow] = useState(() => new Date());
  const [lastUpdated, setLastUpdated] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setLastUpdated(new Date());
  }, [salesRows, repairRows, repairTicketRows, inventoryRows, purchaseRows, movementRows, notificationsRows]);

  const analytics = useMemo(() => {
    const cleanSales = salesRows.filter((sale) => !sale.is_voided);
    const postedSales = cleanSales.filter((sale) => !sale.is_return);
    const completedRepairs = repairRows.filter((repair) => isCompletedRepair(repair.status));

    const today = new Date();
    const todayKey = toDayKey(today);
    const yesterdayKey = toDayKey(addDays(today, -1));

    const currentMonthKey = toMonthKey(today);
    const lastMonthKey = toMonthKey(addDays(new Date(today.getFullYear(), today.getMonth(), 1), -1));

    const dailyRevenue = {};
    const monthlyProductRevenue = {};
    const monthlyRepairRevenue = {};
    const paymentBreakdownMap = {};

    postedSales.forEach((sale) => {
      const dayKey = toDayKey(sale.created_at);
      const monthKey = toMonthKey(sale.created_at);
      const total = Number(sale.total || 0);
      if (dayKey) dailyRevenue[dayKey] = (dailyRevenue[dayKey] || 0) + total;
      if (monthKey) monthlyProductRevenue[monthKey] = (monthlyProductRevenue[monthKey] || 0) + total;
      const method = sale.payment_method || "Unknown";
      paymentBreakdownMap[method] = (paymentBreakdownMap[method] || 0) + total;
    });

    completedRepairs.forEach((repair) => {
      const recognizedAt = repair.delivered_at || repair.created_at;
      const dayKey = toDayKey(recognizedAt);
      const monthKey = toMonthKey(recognizedAt);
      const value = Number(repair.invoice_amount ?? repair.estimated_cost ?? 0);
      if (dayKey) dailyRevenue[dayKey] = (dailyRevenue[dayKey] || 0) + value;
      if (monthKey) monthlyRepairRevenue[monthKey] = (monthlyRepairRevenue[monthKey] || 0) + value;
    });

    const monthlyExpense = {};
    purchaseRows.forEach((po) => {
      const monthKey = toMonthKey(po.created_at);
      if (!monthKey) return;
      monthlyExpense[monthKey] = (monthlyExpense[monthKey] || 0) + Number(po.total_cost || 0);
    });

    const repairDueRows = repairRows
      .map((repair) => ({
        ...repair,
        due: Math.max(0, Number(repair.invoice_amount ?? repair.estimated_cost ?? 0) - Number(repair.advance_payment || 0)),
      }))
      .filter((repair) => repair.due > 0);

    const creditSales = salesRows.filter(
      (sale) => !sale.is_voided && (!sale.paid || isCreditLike(sale.payment_method)),
    );

    const outstandingValue =
      creditSales.reduce((acc, sale) => acc + Number(sale.total || 0), 0) +
      repairDueRows.reduce((acc, repair) => acc + Number(repair.due || 0), 0);

    const outstandingCustomers = new Set([
      ...creditSales.map((sale) => `sale-${sale.customer_id || "walk-in"}`),
      ...repairDueRows.map((repair) => `repair-${repair.customer_id || "walk-in"}`),
    ]).size;

    const monthProduct = monthlyProductRevenue[currentMonthKey] || 0;
    const monthRepair = monthlyRepairRevenue[currentMonthKey] || 0;
    const monthRevenue = monthProduct + monthRepair;
    const lastMonthRevenue =
      (monthlyProductRevenue[lastMonthKey] || 0) + (monthlyRepairRevenue[lastMonthKey] || 0);
    const monthExpenses = monthlyExpense[currentMonthKey] || 0;
    const lastMonthExpenses = monthlyExpense[lastMonthKey] || 0;
    const monthNet = monthRevenue - monthExpenses;
    const monthMargin = monthRevenue > 0 ? (monthNet / monthRevenue) * 100 : 0;

    const inventoryValue = inventoryRows.reduce(
      (acc, item) =>
        acc + Number(item.total_value || Number(item.cost_price || 0) * Number(item.quantity || 0)),
      0,
    );

    const lowStockItems = inventoryRows.filter((item) => {
      const qty = Number(item.quantity || 0);
      const threshold = Number(item.low_stock_threshold || 5);
      return qty <= threshold;
    });
    const outOfStockItems = inventoryRows.filter((item) => Number(item.quantity || 0) <= 0);

    const totalRevenue = Number(summary?.summary?.total_revenue || monthRevenue);
    const grossProfit = Number(summary?.summary?.gross_profit || monthNet);

    const totalBilled =
      postedSales.reduce((acc, sale) => acc + Number(sale.total || 0), 0) +
      completedRepairs.reduce((acc, repair) => acc + Number(repair.invoice_amount ?? repair.estimated_cost ?? 0), 0);
    const collectionRate = totalBilled > 0 ? clamp((totalBilled - outstandingValue) / totalBilled, 0, 1) : 1;

    const stockHealthyRatio =
      inventoryRows.length > 0
        ? clamp((inventoryRows.length - lowStockItems.length) / inventoryRows.length, 0, 1)
        : 1;
    const marginRatio = totalRevenue > 0 ? clamp(grossProfit / totalRevenue, 0, 1) : 0;

    const healthScore = Math.round(clamp(marginRatio * 35 + stockHealthyRatio * 30 + collectionRate * 35, 0, 100));
    const monthlyTarget = Math.max(lastMonthRevenue * 1.12, 250000);
    const goalProgress = monthlyTarget > 0 ? clamp((monthRevenue / monthlyTarget) * 100, 0, 160) : 0;

    const todayRevenue = dailyRevenue[todayKey] || 0;
    const yesterdayRevenue = dailyRevenue[yesterdayKey] || 0;

    const salesTrend = daySeries(30);
    for (let i = 0; i < salesTrend.length; i += 1) {
      salesTrend[i].revenue = Number(dailyRevenue[salesTrend[i].dayKey] || 0);
      const compareDay = addDays(new Date(`${salesTrend[i].dayKey}T00:00:00`), -30);
      salesTrend[i].compare = Number(dailyRevenue[toDayKey(compareDay)] || 0);
    }

    const monthKeysForBars = [];
    for (let i = 5; i >= 0; i -= 1) {
      const date = addDays(new Date(today.getFullYear(), today.getMonth(), 1), -i * 30);
      const key = toMonthKey(date);
      if (!monthKeysForBars.includes(key)) monthKeysForBars.push(key);
    }

    const repairVsProductData = monthKeysForBars.map((key) => {
      const [year, month] = key.split("-").map(Number);
      return {
        month: MONTH_LABEL.format(new Date(year, month - 1, 1)),
        product: Number(monthlyProductRevenue[key] || 0),
        repair: Number(monthlyRepairRevenue[key] || 0),
      };
    });

    const paymentBreakdown = Object.entries(paymentBreakdownMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    const topProducts = Object.values(
      movementRows.reduce((acc, movement) => {
        const type = String(movement.movement_type || "").toUpperCase();
        if (type !== "SALE" && type !== "RETURN") return acc;
        const name = movement.item_name || `Item #${movement.item_id}`;
        if (!acc[name]) acc[name] = { name, units: 0 };
        const qty = Math.abs(Number(movement.quantity || 0));
        acc[name].units += type === "SALE" ? qty : -qty;
        return acc;
      }, {}),
    )
      .filter((row) => row.units > 0)
      .sort((a, b) => b.units - a.units)
      .slice(0, 5);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const heatmapCells = [];
    let maxIncome = 0;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(today.getFullYear(), today.getMonth(), day);
      const value = Number(dailyRevenue[toDayKey(date)] || 0);
      if (value > maxIncome) maxIncome = value;
      heatmapCells.push({ day, value });
    }

    const currentYear = today.getFullYear();
    const prevYear = currentYear - 1;
    const monthlyGrowthData = Array.from({ length: 12 }, (_, index) => {
      const monthIndex = index + 1;
      const currentKey = `${currentYear}-${String(monthIndex).padStart(2, "0")}`;
      const previousKey = `${prevYear}-${String(monthIndex).padStart(2, "0")}`;
      return {
        month: MONTH_LABEL.format(new Date(currentYear, index, 1)),
        current: Number(monthlyProductRevenue[currentKey] || 0) + Number(monthlyRepairRevenue[currentKey] || 0),
        previous:
          Number(monthlyProductRevenue[previousKey] || 0) + Number(monthlyRepairRevenue[previousKey] || 0),
      };
    });

    const todayTransactions = salesRows
      .filter((sale) => toDayKey(sale.created_at) === todayKey)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10)
      .map((sale) => ({
        id: sale.id,
        invoice: sale.invoice_no || `INV-${String(sale.id).padStart(5, "0")}`,
        type: sale.is_return ? "Return" : "Sale",
        amount: Number(sale.total || 0),
        cashier: sale.cashier || "-",
      }));

    const pendingRepairsToday = (repairTicketRows.length ? repairTicketRows : repairRows)
      .filter((repair) => toDayKey(repair.created_at) === todayKey && !isCompletedRepair(repair.status))
      .slice(0, 10)
      .map((repair) => ({
        id: repair.id,
        device: repair.device || repair.device_model || "Unknown",
        technician: repair.technician || "Unassigned",
        status: repair.status || "Pending",
        eta: repair.estimated_completion ? DAY_LABEL.format(new Date(repair.estimated_completion)) : "Not set",
      }));

    const lowStockAlerts = lowStockItems
      .sort((a, b) => Number(a.quantity || 0) - Number(b.quantity || 0))
      .slice(0, 10)
      .map((item) => ({
        id: item.id,
        product: item.name,
        qty: Number(item.quantity || 0),
        threshold: Number(item.low_stock_threshold || 5),
      }));

    const delayedRepairsCount = repairRows.filter((repair) => {
      if (isCompletedRepair(repair.status)) return false;
      if (repair.estimated_completion) {
        const eta = new Date(repair.estimated_completion);
        return !Number.isNaN(eta.getTime()) && eta < today;
      }
      const created = toDate(repair.created_at);
      if (!created) return false;
      return (today - created) / (1000 * 60 * 60 * 24) > 3;
    }).length;

    const systemAlerts = [
      {
        id: "payments",
        title: "Overdue Payments",
        message: `${money(outstandingValue)} pending across ${outstandingCustomers} customers`,
        tone: outstandingValue > 0 ? "amber" : "green",
      },
      {
        id: "stock",
        title: "Out-of-Stock Items",
        message: `${outOfStockItems.length} products require immediate restock`,
        tone: outOfStockItems.length > 0 ? "red" : "green",
      },
      {
        id: "repairs",
        title: "Delayed Repairs",
        message: `${delayedRepairsCount} tickets are beyond ETA or aging`,
        tone: delayedRepairsCount > 0 ? "amber" : "green",
      },
    ];

    const notificationAlerts = [...notificationsRows]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 4)
      .map((alert) => ({
        id: `n-${alert.id}`,
        title: alert.title || "System Notification",
        message: alert.message || "",
        tone: alert.is_read ? "slate" : "amber",
      }));

    return {
      totalRevenue,
      monthRevenue,
      monthNet,
      grossProfit,
      todayRevenue,
      yesterdayRevenue,
      lastMonthRevenue,
      monthMargin,
      outstandingValue,
      outstandingCustomers,
      monthProduct,
      monthRepair,
      monthExpenses,
      lastMonthExpenses,
      inventoryValue,
      inventorySkuCount: inventoryRows.length,
      repairsDoneMonth: completedRepairs.filter(
        (repair) => toMonthKey(repair.delivered_at || repair.created_at) === currentMonthKey,
      ).length,
      invoicesMonth: postedSales.filter((sale) => toMonthKey(sale.created_at) === currentMonthKey).length,
      lowStockCount: lowStockItems.length,
      healthScore,
      marginRatio,
      stockHealthyRatio,
      collectionRate,
      monthlyTarget,
      goalProgress,
      salesTrend,
      repairVsProductData,
      paymentBreakdown,
      topProducts,
      heatmapCells,
      maxIncome,
      monthStart,
      monthlyGrowthData,
      todayTransactions,
      pendingRepairsToday,
      lowStockAlerts,
      systemAlerts,
      notificationAlerts,
      delayedRepairsCount,
    };
  }, [inventoryRows, movementRows, notificationsRows, purchaseRows, repairRows, repairTicketRows, salesRows, summary]);

  useEffect(() => {
    if (!onOverviewComputed) return;
    onOverviewComputed({
      totalRevenue: analytics.totalRevenue,
      monthRevenue: analytics.monthRevenue,
      monthNet: analytics.monthNet,
      outstandingValue: analytics.outstandingValue,
      healthScore: analytics.healthScore,
      lowStockCount: analytics.lowStockCount,
      delayedRepairsCount: analytics.delayedRepairsCount,
      goalProgress: analytics.goalProgress,
    });
  }, [analytics, onOverviewComputed]);

  const todayTrend = compareLabel(analytics.todayRevenue, analytics.yesterdayRevenue, "yesterday");
  const monthTrend = compareLabel(analytics.monthRevenue, analytics.lastMonthRevenue, "last month");
  const expenseTrend = compareLabel(analytics.monthExpenses, analytics.lastMonthExpenses, "last month", true);

  return (
    <>
      <SectionCard
        title="Overview Controls"
        subtitle="Live analytics health and comparison settings"
        right={
          <div className="flex items-center gap-2">
            <Badge tone="sky">
              <Clock3 size={12} />{" "}
              {clockNow.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </Badge>
            <Badge tone="slate">
              Last updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </Badge>
          </div>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className={`btn btn-sm ${comparisonMode ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setComparisonMode((prev) => !prev)}
          >
            Comparison Mode {comparisonMode ? "On" : "Off"}
          </button>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => navigate("/pos")}>
              <ShoppingCart size={14} /> New Sale
            </Button>
            <Button size="sm" variant="secondary" onClick={() => navigate("/repairs")}>
              <Wrench size={14} /> New Repair
            </Button>
            <Button size="sm" variant="secondary" onClick={() => navigate("/financials")}>
              <Wallet size={14} /> Add Expense
            </Button>
          </div>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard
          title="Total Revenue Today"
          value={money(analytics.todayRevenue)}
          icon={<TrendingUp size={18} />}
          hint={<MetricHint hint={todayTrend.text} className={todayTrend.className} />}
        />
        <KpiCard
          title="Total Revenue This Month"
          value={money(analytics.monthRevenue)}
          icon={<Receipt size={18} />}
          tone="green"
          hint={<MetricHint hint={monthTrend.text} className={monthTrend.className} />}
        />
        <KpiCard
          title="Net Profit (Month)"
          value={money(analytics.monthNet)}
          icon={<ArrowUpRight size={18} />}
          tone="indigo"
          hint={`${analytics.monthMargin.toFixed(1)}% margin`}
        />
        <KpiCard
          title="Outstanding Balances"
          value={money(analytics.outstandingValue)}
          icon={<HandCoins size={18} />}
          tone="amber"
          hint={`${analytics.outstandingCustomers} customers`}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard
          title="Repair Revenue (Month)"
          value={money(analytics.monthRepair)}
          icon={<Wrench size={18} />}
          tone="sky"
          hint={`${analytics.repairsDoneMonth} repairs done`}
        />
        <KpiCard
          title="Product Sales Revenue"
          value={money(analytics.monthProduct)}
          icon={<ShoppingCart size={18} />}
          tone="green"
          hint={`${analytics.invoicesMonth} invoices`}
        />
        <KpiCard
          title="Total Expenses (Month)"
          value={money(analytics.monthExpenses)}
          icon={<ArrowDownRight size={18} />}
          tone="red"
          hint={<MetricHint hint={expenseTrend.text} className={expenseTrend.className} />}
        />
        <KpiCard
          title="Inventory Value"
          value={money(analytics.inventoryValue)}
          icon={<Boxes size={18} />}
          tone="indigo"
          hint={`${analytics.inventorySkuCount} SKUs`}
        />
      </div>

      <SectionCard title="Sales Trend (30 Days)" subtitle="Combined product + repair revenue">
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={analytics.salesTrend}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.08)" />
              <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={72}
                tickFormatter={(value) => `${Math.round(value / 1000)}k`}
              />
              <Tooltip
                formatter={(value) => money(value)}
                contentStyle={{
                  backgroundColor: "#0f172a",
                  borderRadius: "12px",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              />
              {comparisonMode && (
                <Area
                  type="monotone"
                  dataKey="compare"
                  stroke="#94a3b8"
                  fill="rgba(148,163,184,0.15)"
                  strokeWidth={2}
                  name="Previous 30 days"
                />
              )}
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#38bdf8"
                fill="rgba(56,189,248,0.25)"
                strokeWidth={2.5}
                name="Current 30 days"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-8" title="Repair vs Product Revenue" subtitle="Monthly split (stacked)">
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.repairVsProductData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.08)" />
                <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={72}
                  tickFormatter={(value) => `${Math.round(value / 1000)}k`}
                />
                <Tooltip formatter={(value) => money(value)} />
                <Bar dataKey="product" stackId="rev" fill="#6366f1" radius={[6, 6, 0, 0]} name="Product" />
                <Bar dataKey="repair" stackId="rev" fill="#14b8a6" radius={[6, 6, 0, 0]} name="Repair" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-4" title="Payment Method Breakdown" subtitle="Cash / Card / Credit and others">
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={analytics.paymentBreakdown} dataKey="value" nameKey="name" innerRadius={58} outerRadius={85} stroke="none">
                  {analytics.paymentBreakdown.map((entry, index) => (
                    <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => money(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5">
            {analytics.paymentBreakdown.slice(0, 5).map((row, index) => (
              <div key={row.name} className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} />
                  <span>{row.name}</span>
                </div>
                <span className="font-bold text-white">{money(row.value)}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-5" title="Top 5 Products" subtitle="By sold units">
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={analytics.topProducts} margin={{ left: 12, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.08)" />
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: "#cbd5e1", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={120}
                />
                <Tooltip formatter={(value) => `${value} units`} />
                <Bar dataKey="units" fill="#38bdf8" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-7" title="Daily Income Heatmap" subtitle="Calendar view for the current month">
          <div className="grid grid-cols-7 gap-2">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name) => (
              <p key={name} className="text-[10px] text-slate-400 text-center uppercase tracking-wide">
                {name}
              </p>
            ))}
            {Array.from({ length: analytics.monthStart.getDay() }).map((_, index) => (
              <div key={`gap-${index}`} className="h-14 rounded-lg border border-transparent" />
            ))}
            {analytics.heatmapCells.map((cell) => {
              const intensity = analytics.maxIncome > 0 ? cell.value / analytics.maxIncome : 0;
              const bg = `rgba(56, 189, 248, ${0.12 + intensity * 0.65})`;
              return (
                <div
                  key={`cell-${cell.day}`}
                  className="h-14 rounded-lg border border-white/10 p-2"
                  style={{ backgroundColor: bg }}
                  title={`${cell.day}: ${money(cell.value)}`}
                >
                  <p className="text-[11px] font-bold text-white">{cell.day}</p>
                  <p className="text-[10px] text-slate-200 truncate">{cell.value > 0 ? money(cell.value) : "-"}</p>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-8" title="Monthly Growth" subtitle="Current year vs previous year overlay">
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics.monthlyGrowthData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.08)" />
                <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={72}
                  tickFormatter={(value) => `${Math.round(value / 1000)}k`}
                />
                <Tooltip formatter={(value) => money(value)} />
                <Line type="monotone" dataKey="current" stroke="#22c55e" strokeWidth={2.4} dot={false} name="Current Year" />
                <Line
                  type="monotone"
                  dataKey="previous"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  name="Previous Year"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-4" title="Business Health Score" subtitle="Profit margin, stock levels, payment collection">
          <div className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Health Index</p>
              <p className="mt-1 text-3xl font-black text-white">{analytics.healthScore}/100</p>
            </div>

            {[
              { label: "Profit Margin", value: analytics.marginRatio * 100 },
              { label: "Stock Health", value: analytics.stockHealthyRatio * 100 },
              { label: "Collection Rate", value: analytics.collectionRate * 100 },
            ].map((item) => (
              <div key={item.label}>
                <div className="flex items-center justify-between text-[11px] text-slate-300">
                  <span>{item.label}</span>
                  <span>{item.value.toFixed(1)}%</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-800/70">
                  <div className="h-2 rounded-full bg-sky-400" style={{ width: `${clamp(item.value, 0, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-6" title="Goal Tracker" subtitle="Monthly revenue target vs actual">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>Target {money(analytics.monthlyTarget)}</span>
              <span>{clamp(analytics.goalProgress, 0, 100).toFixed(1)}%</span>
            </div>
            <div className="h-3 rounded-full bg-slate-800/70 overflow-hidden">
              <div
                className="h-3 rounded-full bg-gradient-to-r from-sky-400 to-indigo-500"
                style={{ width: `${clamp(analytics.goalProgress, 0, 100)}%` }}
              />
            </div>
            <p className="text-xs text-slate-400">
              Actual this month: <span className="font-bold text-white">{money(analytics.monthRevenue)}</span>
            </p>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Announcements & Alerts" subtitle="Overdue payments, stock risk, and repair delays">
          <div className="space-y-2">
            {[...analytics.systemAlerts, ...analytics.notificationAlerts].slice(0, 7).map((alert) => (
              <div key={alert.id} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-white truncate">{alert.title}</p>
                  <Badge tone={alert.tone || "slate"}>{alert.tone === "red" ? "Critical" : "Info"}</Badge>
                </div>
                <p className="text-xs text-slate-400 mt-1">{alert.message}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <SectionCard title="Today's Transactions" subtitle="Last 10 invoices">
          <CompactTable
            columns={[
              { label: "ID", value: "invoice" },
              { label: "Type", value: "type" },
              { label: "Amount", value: (row) => money(row.amount) },
              { label: "Cashier", value: "cashier" },
            ]}
            rows={analytics.todayTransactions}
            emptyLabel="No invoices for today."
          />
        </SectionCard>

        <SectionCard title="Pending Repairs (Today)" subtitle="Device, technician, status, ETA">
          <CompactTable
            columns={[
              { label: "Device", value: "device" },
              { label: "Tech", value: "technician" },
              {
                label: "Status",
                value: (row) => (
                  <Badge
                    tone={
                      String(row.status || "").toLowerCase().includes("waiting")
                        ? "amber"
                        : String(row.status || "").toLowerCase().includes("diagn")
                          ? "indigo"
                          : "sky"
                    }
                  >
                    {row.status}
                  </Badge>
                ),
              },
              { label: "ETA", value: "eta" },
            ]}
            rows={analytics.pendingRepairsToday}
            emptyLabel="No pending repairs created today."
          />
        </SectionCard>

        <SectionCard title="Low Stock Alerts" subtitle="Qty remaining vs threshold">
          <CompactTable
            columns={[
              { label: "Product", value: "product" },
              { label: "Qty", value: (row) => row.qty.toLocaleString() },
              { label: "Threshold", value: (row) => row.threshold.toLocaleString() },
            ]}
            rows={analytics.lowStockAlerts}
            emptyLabel="No low stock items."
          />
        </SectionCard>
      </div>
    </>
  );
}


