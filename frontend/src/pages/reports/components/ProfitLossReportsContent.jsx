import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  Calculator,
  DollarSign,
  HandCoins,
  Percent,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Badge, KpiCard, SectionCard, Table, Select } from "../../../components/UI";

const MONEY_LOCALE = "en-LK";
const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short" });
const MONTH_YEAR_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" });
const EXPENSE_COLORS = ["#38bdf8", "#f59e0b", "#6366f1", "#22c55e"];

function money(value) {
  return `LKR ${Math.round(Number(value || 0)).toLocaleString(MONEY_LOCALE)}`;
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toMonthKey(value) {
  const date = toDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parseDateInput(value, endExclusive = false) {
  if (!value) return null;
  const date = toDate(`${value}T00:00:00`);
  if (!date) return null;
  if (!endExclusive) return date;
  const cloned = new Date(date);
  cloned.setDate(cloned.getDate() + 1);
  return cloned;
}

function endOfDay(dateLike) {
  const date = toDate(dateLike);
  if (!date) return null;
  const cloned = new Date(date);
  cloned.setHours(23, 59, 59, 999);
  return cloned;
}

function startOfMonth(dateLike) {
  const date = toDate(dateLike);
  if (!date) return null;
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfQuarter(dateLike) {
  const date = toDate(dateLike);
  if (!date) return null;
  const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3;
  return new Date(date.getFullYear(), quarterStartMonth, 1);
}

function startOfYear(dateLike) {
  const date = toDate(dateLike);
  if (!date) return null;
  return new Date(date.getFullYear(), 0, 1);
}

function withinRange(value, start, endExclusive) {
  const date = toDate(value);
  if (!date) return false;
  if (start && date < start) return false;
  if (endExclusive && date >= endExclusive) return false;
  return true;
}

function shiftYear(monthKey, yearOffset) {
  const [year, month] = monthKey.split("-").map(Number);
  return `${year + yearOffset}-${String(month).padStart(2, "0")}`;
}

function classifyExpenseCategory(row) {
  const text = `${row.category || ""} ${row.description || ""} ${row.note || ""} ${row.po_number || ""}`.toLowerCase();
  if (text.includes("rent") || text.includes("lease")) return "Rent";
  if (text.includes("salary") || text.includes("wage") || text.includes("payroll") || text.includes("staff")) return "Salaries";
  if (text.includes("utility") || text.includes("electric") || text.includes("water") || text.includes("internet") || text.includes("phone")) return "Utilities";
  return "Miscellaneous";
}

function monthSpanFromRange(start, end) {
  const startDate = startOfMonth(start);
  const endDate = startOfMonth(end);
  if (!startDate || !endDate || startDate > endDate) return [];
  const rows = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    rows.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return rows;
}

function monthSpanRolling(endDate, count) {
  const endMonth = startOfMonth(endDate);
  if (!endMonth) return [];
  const rows = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(endMonth.getFullYear(), endMonth.getMonth() - i, 1);
    rows.push(date);
  }
  return rows;
}

function allocationRatios(productRevenue, repairRevenue) {
  const total = Number(productRevenue || 0) + Number(repairRevenue || 0);
  if (total <= 0) return { salesShare: 0.5, repairShare: 0.5 };
  return {
    salesShare: Number(productRevenue || 0) / total,
    repairShare: Number(repairRevenue || 0) / total,
  };
}

function pickCategoryView(metrics, categoryFilter) {
  if (categoryFilter === "sales") {
    return {
      revenue: metrics.productRevenue,
      cogs: metrics.productCogs,
      expenses: metrics.expensesAllocatedSales,
    };
  }
  if (categoryFilter === "repairs") {
    return {
      revenue: metrics.repairRevenue,
      cogs: metrics.repairCogs,
      expenses: metrics.expensesAllocatedRepairs,
    };
  }
  return {
    revenue: metrics.totalRevenue,
    cogs: metrics.totalCogs,
    expenses: metrics.totalExpenses,
  };
}

function MiniTable({ columns, rows, emptyLabel = "No records found." }) {
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
                  {typeof col.value === "function" ? col.value(row, index) : row[col.value]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export default function ProfitLossReportsContent({
  salesRows,
  repairRows,
  expenseRows,
  dateFrom,
  dateTo,
  onPrepared,
}) {
  const [periodPreset, setPeriodPreset] = useState("month");
  const [categoryFilter, setCategoryFilter] = useState("both");
  const [scenarioExpensePct, setScenarioExpensePct] = useState(10);
  const [previousYearCompare, setPreviousYearCompare] = useState(false);

  const referenceDate = useMemo(() => {
    return toDate(dateTo) || new Date();
  }, [dateTo]);

  const activeRange = useMemo(() => {
    if (periodPreset === "custom") {
      return {
        start: parseDateInput(dateFrom),
        endExclusive: parseDateInput(dateTo, true),
      };
    }
    if (periodPreset === "month") {
      const start = startOfMonth(referenceDate);
      const endExclusive = new Date(referenceDate);
      endExclusive.setDate(endExclusive.getDate() + 1);
      return { start, endExclusive };
    }
    if (periodPreset === "quarter") {
      const start = startOfQuarter(referenceDate);
      const endExclusive = new Date(referenceDate);
      endExclusive.setDate(endExclusive.getDate() + 1);
      return { start, endExclusive };
    }
    const start = startOfYear(referenceDate);
    const endExclusive = new Date(referenceDate);
    endExclusive.setDate(endExclusive.getDate() + 1);
    return { start, endExclusive };
  }, [dateFrom, dateTo, periodPreset, referenceDate]);

  const filteredSales = useMemo(() => {
    return salesRows.filter(
      (sale) =>
        !sale.is_voided &&
        !sale.is_return &&
        withinRange(sale.created_at, activeRange.start, activeRange.endExclusive),
    );
  }, [activeRange.endExclusive, activeRange.start, salesRows]);

  const filteredRepairs = useMemo(() => {
    return repairRows.filter((repair) => {
      if (String(repair.status || "").toLowerCase().includes("cancel")) return false;
      const revenueDate = repair.delivered_at || repair.created_at;
      return withinRange(revenueDate, activeRange.start, activeRange.endExclusive);
    });
  }, [activeRange.endExclusive, activeRange.start, repairRows]);

  const filteredExpenses = useMemo(() => {
    return expenseRows.filter((expense) =>
      withinRange(expense.expense_date || expense.created_at, activeRange.start, activeRange.endExclusive),
    );
  }, [activeRange.endExclusive, activeRange.start, expenseRows]);

  const analytics = useMemo(() => {
    const productRevenue = filteredSales.reduce((acc, row) => acc + Number(row.total || 0), 0);
    const productCogs = filteredSales.reduce(
      (acc, row) =>
        acc +
        (row.lines || []).reduce((sum, line) => sum + Number(line.line_cost || 0), 0),
      0,
    );
    const repairRevenue = filteredRepairs.reduce((acc, row) => acc + Number(row.invoice_amount ?? row.estimated_cost ?? 0), 0);
    const repairCogs = filteredRepairs.reduce((acc, row) => acc + Number(row.parts_cost_total || 0), 0);

    const expenseBreakdown = filteredExpenses.reduce(
      (acc, row) => {
        const category = classifyExpenseCategory(row);
        const amount = Number(row.amount || row.total_cost || 0);
        acc[category] += amount;
        return acc;
      },
      { Rent: 0, Salaries: 0, Utilities: 0, Miscellaneous: 0 },
    );

    const totalRevenue = productRevenue + repairRevenue;
    const totalCogs = productCogs + repairCogs;
    const grossProfit = totalRevenue - totalCogs;
    const totalExpenses = Object.values(expenseBreakdown).reduce((acc, value) => acc + value, 0);
    const netProfit = grossProfit - totalExpenses;
    const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    const { salesShare, repairShare } = allocationRatios(productRevenue, repairRevenue);
    const expensesAllocatedSales = totalExpenses * salesShare;
    const expensesAllocatedRepairs = totalExpenses * repairShare;

    const breakEvenPoint = totalRevenue > 0 && grossProfit > 0
      ? totalExpenses / (grossProfit / totalRevenue)
      : 0;

    const monthDates = monthSpanFromRange(activeRange.start, endOfDay(referenceDate));
    const monthMap = Object.fromEntries(
      monthDates.map((date) => {
        const key = toMonthKey(date);
        return [
          key,
          {
            monthKey: key,
            monthLabel: MONTH_YEAR_LABEL.format(date),
            productRevenue: 0,
            repairRevenue: 0,
            productCogs: 0,
            repairCogs: 0,
            expenses: 0,
          },
        ];
      }),
    );

    filteredSales.forEach((sale) => {
      const key = toMonthKey(sale.created_at);
      if (!monthMap[key]) return;
      monthMap[key].productRevenue += Number(sale.total || 0);
      monthMap[key].productCogs += (sale.lines || []).reduce(
        (sum, line) => sum + Number(line.line_cost || 0),
        0,
      );
    });

    filteredRepairs.forEach((repair) => {
      const key = toMonthKey(repair.delivered_at || repair.created_at);
      if (!monthMap[key]) return;
      monthMap[key].repairRevenue += Number(repair.invoice_amount ?? repair.estimated_cost ?? 0);
      monthMap[key].repairCogs += Number(repair.parts_cost_total || 0);
    });

    filteredExpenses.forEach((expense) => {
      const key = toMonthKey(expense.expense_date || expense.created_at);
      if (!monthMap[key]) return;
      monthMap[key].expenses += Number(expense.amount || expense.total_cost || 0);
    });

    const monthlyRows = Object.values(monthMap)
      .map((row) => {
        const monthlyRevenue = row.productRevenue + row.repairRevenue;
        const monthlyCogs = row.productCogs + row.repairCogs;
        const monthlyGross = monthlyRevenue - monthlyCogs;
        const monthlyNet = monthlyGross - row.expenses;
        return {
          ...row,
          totalRevenue: monthlyRevenue,
          totalCogs: monthlyCogs,
          grossProfit: monthlyGross,
          netProfit: monthlyNet,
          marginPct: monthlyRevenue > 0 ? (monthlyNet / monthlyRevenue) * 100 : 0,
        };
      })
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

    const rollingMonths = monthSpanRolling(referenceDate, 12);
    const rollingRows = rollingMonths.map((date) => {
      const key = toMonthKey(date);
      const base = monthlyRows.find((row) => row.monthKey === key) || {
        totalRevenue: 0,
        totalCogs: 0,
        grossProfit: 0,
        expenses: 0,
        netProfit: 0,
        marginPct: 0,
      };
      return {
        monthKey: key,
        monthLabel: MONTH_LABEL.format(date),
        ...base,
      };
    });

    const previousYearMap = {};
    if (previousYearCompare) {
      const previousRangeStart = new Date(activeRange.start || referenceDate);
      const previousRangeEnd = new Date(activeRange.endExclusive || referenceDate);
      previousRangeStart.setFullYear(previousRangeStart.getFullYear() - 1);
      previousRangeEnd.setFullYear(previousRangeEnd.getFullYear() - 1);

      salesRows
        .filter(
          (sale) =>
            !sale.is_voided &&
            !sale.is_return &&
            withinRange(sale.created_at, previousRangeStart, previousRangeEnd),
        )
        .forEach((sale) => {
          const key = shiftYear(toMonthKey(sale.created_at), 1);
          if (!previousYearMap[key]) previousYearMap[key] = { revenue: 0 };
          previousYearMap[key].revenue += Number(sale.total || 0);
        });

      repairRows
        .filter((repair) => {
          if (String(repair.status || "").toLowerCase().includes("cancel")) return false;
          const revenueDate = repair.delivered_at || repair.created_at;
          return withinRange(revenueDate, previousRangeStart, previousRangeEnd);
        })
        .forEach((repair) => {
          const key = shiftYear(toMonthKey(repair.delivered_at || repair.created_at), 1);
          if (!previousYearMap[key]) previousYearMap[key] = { revenue: 0 };
          previousYearMap[key].revenue += Number(repair.invoice_amount ?? repair.estimated_cost ?? 0);
        });
    }

    const revenueExpenseRows = rollingRows.map((row) => ({
      month: row.monthLabel,
      revenue: row.totalRevenue || 0,
      expenses: row.expenses || 0,
      prevRevenue: previousYearMap[row.monthKey]?.revenue || 0,
    }));

    const grossNetRows = rollingRows.map((row) => ({
      month: row.monthLabel,
      gross: row.grossProfit || 0,
      net: row.netProfit || 0,
    }));

    const expensePie = Object.entries(expenseBreakdown).map(([name, value]) => ({
      name,
      value,
    }));

    const productMargins = {};
    filteredSales.forEach((sale) => {
      (sale.lines || []).forEach((line) => {
        const key = line.item_name || `Item #${line.item_id}`;
        if (!productMargins[key]) {
          productMargins[key] = { product: key, revenue: 0, cost: 0, profit: 0 };
        }
        productMargins[key].revenue += Number(line.line_revenue || 0);
        productMargins[key].cost += Number(line.line_cost || 0);
        productMargins[key].profit += Number(line.line_profit || 0);
      });
    });

    const marginDistributionRows = Object.values(productMargins)
      .map((row) => ({
        ...row,
        marginPct: row.revenue > 0 ? (row.profit / row.revenue) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 25);

    const ytdStart = startOfYear(referenceDate);
    const ytdEnd = new Date(referenceDate);
    ytdEnd.setDate(ytdEnd.getDate() + 1);
    const ytdSales = salesRows.filter(
      (sale) => !sale.is_voided && !sale.is_return && withinRange(sale.created_at, ytdStart, ytdEnd),
    );
    const ytdRepairs = repairRows.filter((repair) => {
      if (String(repair.status || "").toLowerCase().includes("cancel")) return false;
      return withinRange(repair.delivered_at || repair.created_at, ytdStart, ytdEnd);
    });
    const ytdExpensesRows = expenseRows.filter((expense) =>
      withinRange(expense.expense_date || expense.created_at, ytdStart, ytdEnd),
    );
    const ytdRevenue =
      ytdSales.reduce((acc, row) => acc + Number(row.total || 0), 0) +
      ytdRepairs.reduce((acc, row) => acc + Number(row.invoice_amount ?? row.estimated_cost ?? 0), 0);
    const ytdCogs =
      ytdSales.reduce(
        (acc, row) => acc + (row.lines || []).reduce((sum, line) => sum + Number(line.line_cost || 0), 0),
        0,
      ) + ytdRepairs.reduce((acc, row) => acc + Number(row.parts_cost_total || 0), 0);
    const ytdExpenses = ytdExpensesRows.reduce((acc, row) => acc + Number(row.amount || row.total_cost || 0), 0);
    const ytdNet = ytdRevenue - ytdCogs - ytdExpenses;

    const scenarioIncreasedExpenses = totalExpenses * (1 + Number(scenarioExpensePct || 0) / 100);
    const scenarioNetProfit = grossProfit - scenarioIncreasedExpenses;

    const statementRows = [
      { line: "REVENUE", amount: null, kind: "header" },
      { line: "Product Sales Revenue", amount: productRevenue },
      { line: "Repair Revenue", amount: repairRevenue },
      { line: "Total Revenue", amount: totalRevenue, kind: "total" },
      { line: "COST OF GOODS SOLD", amount: null, kind: "header" },
      { line: "Product Purchase Cost", amount: productCogs },
      { line: "Spare Parts Cost", amount: repairCogs },
      { line: "Total COGS", amount: totalCogs, kind: "total" },
      { line: "Gross Profit", amount: grossProfit, kind: "total" },
      { line: "OPERATING EXPENSES", amount: null, kind: "header" },
      { line: "Rent", amount: expenseBreakdown.Rent },
      { line: "Salaries", amount: expenseBreakdown.Salaries },
      { line: "Utilities", amount: expenseBreakdown.Utilities },
      { line: "Miscellaneous", amount: expenseBreakdown.Miscellaneous },
      { line: "Total Expenses", amount: totalExpenses, kind: "total" },
      { line: "NET PROFIT / (LOSS)", amount: netProfit, kind: "net" },
      { line: "Profit Margin", amount: `${profitMargin.toFixed(2)}%`, kind: "net" },
    ];

    const categorySplitRows = [
      {
        department: "Sales Department",
        revenue: productRevenue,
        cogs: productCogs,
        gross: productRevenue - productCogs,
        expenses: expensesAllocatedSales,
        net: productRevenue - productCogs - expensesAllocatedSales,
      },
      {
        department: "Repairs Department",
        revenue: repairRevenue,
        cogs: repairCogs,
        gross: repairRevenue - repairCogs,
        expenses: expensesAllocatedRepairs,
        net: repairRevenue - repairCogs - expensesAllocatedRepairs,
      },
    ];

    const selectedView = pickCategoryView(
      {
        productRevenue,
        repairRevenue,
        totalRevenue,
        productCogs,
        repairCogs,
        totalCogs,
        totalExpenses,
        expensesAllocatedSales,
        expensesAllocatedRepairs,
      },
      categoryFilter,
    );
    const selectedGross = selectedView.revenue - selectedView.cogs;
    const selectedNet = selectedGross - selectedView.expenses;
    const selectedMargin = selectedView.revenue > 0 ? (selectedNet / selectedView.revenue) * 100 : 0;

    return {
      productRevenue,
      repairRevenue,
      totalRevenue,
      productCogs,
      repairCogs,
      totalCogs,
      grossProfit,
      totalExpenses,
      netProfit,
      profitMargin,
      breakEvenPoint,
      expenseBreakdown,
      monthlyRows,
      rollingRows,
      revenueExpenseRows,
      grossNetRows,
      expensePie,
      marginDistributionRows,
      statementRows,
      categorySplitRows,
      ytdRevenue,
      ytdCogs,
      ytdExpenses,
      ytdNet,
      scenarioIncreasedExpenses,
      scenarioNetProfit,
      selectedView,
      selectedGross,
      selectedNet,
      selectedMargin,
    };
  }, [
    activeRange.endExclusive,
    activeRange.start,
    categoryFilter,
    filteredExpenses,
    filteredRepairs,
    filteredSales,
    periodPreset,
    previousYearCompare,
    expenseRows,
    referenceDate,
    repairRows,
    salesRows,
    scenarioExpensePct,
  ]);

  useEffect(() => {
    if (!onPrepared) return;
    onPrepared({
      exportColumns: [
        { label: "Month", value: "monthLabel" },
        { label: "Revenue", value: (row) => Number(row.totalRevenue || 0) },
        { label: "COGS", value: (row) => Number(row.totalCogs || 0) },
        { label: "Gross Profit", value: (row) => Number(row.grossProfit || 0) },
        { label: "Expenses", value: (row) => Number(row.expenses || 0) },
        { label: "Net Profit", value: (row) => Number(row.netProfit || 0) },
        { label: "Margin %", value: (row) => Number((row.marginPct || 0).toFixed(2)) },
      ],
      exportRows: analytics.monthlyRows,
    });
  }, [analytics.monthlyRows, onPrepared]);

  return (
    <>
      <SectionCard title="P&L Filters" subtitle="Date range mode and category scope">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="flex flex-wrap gap-2">
            {["month", "quarter", "year", "custom"].map((preset) => (
              <button
                key={preset}
                type="button"
                className={`btn btn-sm ${periodPreset === preset ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setPeriodPreset(preset)}
              >
                {preset === "month"
                  ? "Month"
                  : preset === "quarter"
                    ? "Quarter"
                    : preset === "year"
                      ? "Year"
                      : "Custom"}
              </button>
            ))}
          </div>

          <Select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          >
            <option value="both">Sales + Repairs</option>
            <option value="sales">Sales Only</option>
            <option value="repairs">Repairs Only</option>
          </Select>

          <button
            type="button"
            className={`btn btn-sm ${previousYearCompare ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setPreviousYearCompare((prev) => !prev)}
          >
            Previous Year Comparison {previousYearCompare ? "On" : "Off"}
          </button>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard title="Gross Revenue" value={money(analytics.selectedView.revenue)} icon={<DollarSign size={18} />} />
        <KpiCard title="Total Cost Of Goods (COGS)" value={money(analytics.selectedView.cogs)} icon={<HandCoins size={18} />} tone="amber" />
        <KpiCard title="Gross Profit" value={money(analytics.selectedGross)} icon={<TrendingUp size={18} />} tone="indigo" />
        <KpiCard title="Total Expenses" value={money(analytics.selectedView.expenses)} icon={<Wallet size={18} />} tone="red" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <KpiCard title="Net Profit" value={money(analytics.selectedNet)} icon={<BarChart3 size={18} />} tone={analytics.selectedNet >= 0 ? "green" : "red"} />
        <KpiCard title="Profit Margin %" value={`${analytics.selectedMargin.toFixed(2)}%`} icon={<Percent size={18} />} tone="sky" />
        <KpiCard title="Break-even Point (Monthly)" value={money(analytics.breakEvenPoint)} icon={<Calculator size={18} />} tone="violet" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-8" title="Revenue vs Expenses" subtitle="Dual-axis monthly trend">
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={analytics.revenueExpenseRows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.08)" />
                <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={72}
                  tickFormatter={(value) => `${Math.round(value / 1000)}k`}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={72}
                  tickFormatter={(value) => `${Math.round(value / 1000)}k`}
                />
                <Tooltip formatter={(value) => money(value)} />
                <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#38bdf8" strokeWidth={2.5} dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="expenses" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
                {previousYearCompare && (
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="prevRevenue"
                    stroke="#a78bfa"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-4" title="Expense Breakdown">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={analytics.expensePie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={88} stroke="none">
                  {analytics.expensePie.map((entry, index) => (
                    <Cell key={entry.name} fill={EXPENSE_COLORS[index % EXPENSE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => money(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5">
            {analytics.expensePie.map((row, index) => (
              <div key={row.name} className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: EXPENSE_COLORS[index % EXPENSE_COLORS.length] }} />
                  <span>{row.name}</span>
                </div>
                <span className="font-bold text-white">{money(row.value)}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-6" title="Gross vs Net Profit" subtitle="Monthly side-by-side comparison">
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.grossNetRows}>
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
                <Bar dataKey="gross" fill="#22c55e" radius={[8, 8, 0, 0]} />
                <Bar dataKey="net" fill="#6366f1" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Profit Trend" subtitle="12-month rolling area">
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analytics.rollingRows.map((row) => ({ month: row.monthLabel, net: row.netProfit || 0 }))}>
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
                <Area type="monotone" dataKey="net" stroke="#38bdf8" fill="rgba(56,189,248,0.25)" strokeWidth={2.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Product Margin Distribution" subtitle="Revenue vs margin%">
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ left: 20, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
              <XAxis
                type="number"
                dataKey="revenue"
                name="Revenue"
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                tickFormatter={(value) => `${Math.round(value / 1000)}k`}
              />
              <YAxis type="number" dataKey="marginPct" name="Margin %" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                formatter={(value, name) =>
                  name === "marginPct" ? `${Number(value).toFixed(2)}%` : money(value)
                }
              />
              <Scatter data={analytics.marginDistributionRows} fill="#6366f1" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <SectionCard title="P&L Statement">
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
          <table className="table w-full">
            <thead>
              <tr>
                <th>Line Item</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {analytics.statementRows.map((row, index) => (
                <tr key={`${row.line}-${index}`}>
                  <td className={row.kind === "header" ? "font-black text-slate-200" : row.kind ? "font-bold" : ""}>
                    {row.line}
                  </td>
                  <td className={row.kind === "net" ? "font-black" : row.kind === "total" ? "font-bold" : ""}>
                    {typeof row.amount === "number" ? money(row.amount) : row.amount || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-8" title="Monthly P&L Comparison (12 Months)">
          <MiniTable
            columns={[
              { label: "Month", value: "monthLabel" },
              { label: "Revenue", value: (row) => money(row.totalRevenue) },
              { label: "COGS", value: (row) => money(row.totalCogs) },
              { label: "Gross", value: (row) => money(row.grossProfit) },
              { label: "Expenses", value: (row) => money(row.expenses) },
              { label: "Net", value: (row) => money(row.netProfit) },
              { label: "Margin %", value: (row) => `${Number(row.marginPct || 0).toFixed(2)}%` },
            ]}
            rows={analytics.rollingRows}
            emptyLabel="No monthly rows."
          />
        </SectionCard>

        <SectionCard className="xl:col-span-4" title="Category P&L Split">
          <MiniTable
            columns={[
              { label: "Department", value: "department" },
              { label: "Revenue", value: (row) => money(row.revenue) },
              { label: "COGS", value: (row) => money(row.cogs) },
              { label: "Net", value: (row) => money(row.net) },
            ]}
            rows={analytics.categorySplitRows}
            emptyLabel="No split data."
          />
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-6" title="Scenario Calculator" subtitle="What if expenses increase by X%">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="50"
                value={scenarioExpensePct}
                onChange={(event) => setScenarioExpensePct(Number(event.target.value))}
                className="w-full accent-sky-500"
              />
              <Badge tone="indigo">{scenarioExpensePct}%</Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Scenario Expenses</p>
                <p className="mt-1 text-2xl font-black text-white">{money(analytics.scenarioIncreasedExpenses)}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Scenario Net Profit</p>
                <p className={`mt-1 text-2xl font-black ${analytics.scenarioNetProfit >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {money(analytics.scenarioNetProfit)}
                </p>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-3" title="Break-even Widget">
          <div className="space-y-2">
            <p className="text-xs text-slate-400">Estimated monthly break-even revenue</p>
            <p className="text-2xl font-black text-white">{money(analytics.breakEvenPoint)}</p>
            <p className="text-xs text-slate-400">
              Based on gross contribution in selected period.
            </p>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-3" title="YTD Summary">
          <div className="space-y-2">
            <p className="text-xs text-slate-400">Year-to-date net result</p>
            <p className={`text-2xl font-black ${analytics.ytdNet >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
              {money(analytics.ytdNet)}
            </p>
            <p className="text-xs text-slate-400">Revenue {money(analytics.ytdRevenue)}</p>
            <p className="text-xs text-slate-400">COGS + Expenses {money(analytics.ytdCogs + analytics.ytdExpenses)}</p>
          </div>
        </SectionCard>
      </div>
    </>
  );
}


