import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  DollarSign,
  Receipt,
  RefreshCcw,
  ShoppingCart,
  Tag,
  Users,
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
import { Badge, Button, KpiCard, SectionCard, Table, Select } from "../../../components/UI";
import { openPrintCenter } from "../../../lib/printCenter";

const MONEY_LOCALE = "en-LK";
const DAY_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const HOUR_LABEL = new Intl.DateTimeFormat("en-US", { hour: "numeric" });
const PIE_COLORS = ["#38bdf8", "#6366f1", "#14b8a6", "#f59e0b", "#f97316", "#a78bfa", "#22c55e"];
const SUB_REPORT_TABS = [
  { key: "daily", label: "Daily Report" },
  { key: "weekly", label: "Weekly Report" },
  { key: "monthly", label: "Monthly Report" },
  { key: "custom", label: "Custom Range" },
  { key: "product", label: "Product-wise Sales" },
  { key: "category", label: "Category-wise Sales" },
  { key: "cashier", label: "Cashier-wise Sales" },
  { key: "top-products", label: "Top Selling Products" },
  { key: "insights", label: "Advanced Insights" },
];

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

function monthKey(value) {
  const date = toDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addDays(value, days) {
  const date = toDate(value);
  if (!date) return null;
  const cloned = new Date(date);
  cloned.setDate(cloned.getDate() + days);
  return cloned;
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

function enumerateDays(fromValue, toValue) {
  const from = parseDateInput(fromValue);
  const toExclusive = parseDateInput(toValue, true);
  if (!from || !toExclusive || from >= toExclusive) return [];
  const rows = [];
  const cursor = new Date(from);
  while (cursor < toExclusive) {
    rows.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return rows;
}

function paymentBucket(row) {
  const cash = Number(row.cash_amount || 0);
  const card = Number(row.card_amount || 0);
  const credit = Number(row.credit_amount || 0);
  const channels = [cash > 0, card > 0, credit > 0].filter(Boolean).length;
  const method = String(row.payment_method || "").toLowerCase();
  if (channels >= 2 || method.includes("mixed") || method.includes("multiple")) return "Mixed";
  if (credit > 0 || method.includes("credit") || method.includes("due") || method.includes("partial")) return "Credit";
  if (card > 0 || method.includes("card") || method.includes("bank")) return "Card";
  return "Cash";
}

function invoiceType(row) {
  if (row.invoice_type) return row.invoice_type;
  if (!row.paid) return "Pending";
  return paymentBucket(row) === "Credit" ? "Partial" : "Full";
}

function statusLabel(row) {
  if (row.status) return row.status;
  if (row.is_voided) return "Cancelled";
  if (row.is_return || Number(row.total || 0) < 0) return "Refunded";
  if (!row.paid) return "Pending";
  return "Paid";
}

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("cancel")) return "red";
  if (value.includes("refund")) return "amber";
  if (value.includes("pending")) return "indigo";
  return "green";
}

function pct(part, total) {
  const denominator = Number(total || 0);
  if (!denominator) return 0;
  return (Number(part || 0) / denominator) * 100;
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

export default function SalesReportsContent({
  salesRows,
  inventoryRows,
  dateFrom,
  dateTo,
  query,
  onPrepared,
}) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("daily");
  const [page, setPage] = useState(1);
  const [dailyFocusDate, setDailyFocusDate] = useState(dateTo || dateFrom || "");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [invoiceTypeFilter, setInvoiceTypeFilter] = useState("all");
  const pageSize = 12;

  useEffect(() => {
    setDailyFocusDate(dateTo || dateFrom || "");
  }, [dateFrom, dateTo]);

  const filterOptions = useMemo(() => {
    const cashiers = new Set(["N/A"]);
    const products = new Map();
    const categories = new Set();
    salesRows.forEach((row) => {
      cashiers.add(row.cashier || "N/A");
      (row.lines || []).forEach((line) => {
        const itemId = String(line.item_id ?? line.item_name);
        if (!products.has(itemId)) {
          products.set(itemId, {
            value: itemId,
            label: line.item_name || `Item #${line.item_id}`,
          });
        }
        if (line.category) categories.add(line.category);
      });
    });

    if (products.size === 0) {
      inventoryRows.forEach((item) => {
        const id = String(item.id);
        products.set(id, { value: id, label: item.name });
        if (item.category) categories.add(item.category);
      });
    }

    return {
      cashiers: [...cashiers].sort((a, b) => a.localeCompare(b)),
      products: [...products.values()].sort((a, b) => a.label.localeCompare(b.label)),
      categories: [...categories].sort((a, b) => a.localeCompare(b)),
    };
  }, [inventoryRows, salesRows]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const start = parseDateInput(dateFrom);
    const end = parseDateInput(dateTo, true);

    return salesRows.filter((row) => {
      const createdAt = toDate(row.created_at);
      if (start && createdAt && createdAt < start) return false;
      if (end && createdAt && createdAt >= end) return false;

      if (employeeFilter !== "all" && (row.cashier || "N/A") !== employeeFilter) return false;
      if (productFilter !== "all") {
        const hasProduct = (row.lines || []).some((line) => String(line.item_id ?? line.item_name) === productFilter);
        if (!hasProduct) return false;
      }
      if (categoryFilter !== "all") {
        const hasCategory = (row.lines || []).some((line) => (line.category || "Unknown") === categoryFilter);
        if (!hasCategory) return false;
      }
      if (paymentFilter !== "all" && paymentBucket(row).toLowerCase() !== paymentFilter) return false;
      if (invoiceTypeFilter !== "all" && invoiceType(row).toLowerCase() !== invoiceTypeFilter) return false;

      if (!normalizedQuery) return true;
      const searchable = [
        row.invoice_no,
        row.customer_name,
        row.payment_method,
        row.cashier,
        statusLabel(row),
        ...(row.lines || []).map((line) => `${line.item_name || ""} ${line.category || ""}`),
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [
    categoryFilter,
    dateFrom,
    dateTo,
    employeeFilter,
    invoiceTypeFilter,
    paymentFilter,
    productFilter,
    query,
    salesRows,
  ]);

  useEffect(() => {
    setPage(1);
  }, [employeeFilter, productFilter, categoryFilter, paymentFilter, invoiceTypeFilter, query, dateFrom, dateTo]);

  const analytics = useMemo(() => {
    const netRows = filteredRows.filter((row) => !row.is_voided);
    const salesAmount = netRows.reduce((acc, row) => acc + Number(row.total || 0), 0);
    const invoiceCount = netRows.length;
    const avgInvoiceValue = invoiceCount > 0 ? salesAmount / invoiceCount : 0;
    const discountTotal = netRows.reduce((acc, row) => acc + Number(row.discount_amount || 0), 0);
    const taxTotal = netRows.reduce((acc, row) => acc + Number(row.tax_amount || 0), 0);
    const cashTotal = netRows.reduce((acc, row) => acc + Number(row.cash_amount || 0), 0);
    const cardTotal = netRows.reduce((acc, row) => acc + Number(row.card_amount || 0), 0);
    const creditTotal = netRows.reduce((acc, row) => acc + Number(row.credit_amount || 0), 0);

    const dayList = enumerateDays(dateFrom, dateTo);
    const dailyMap = {};
    dayList.forEach((date) => {
      const key = toDayKey(date);
      dailyMap[key] = {
        dayKey: key,
        label: DAY_LABEL.format(date),
        total: 0,
        cash: 0,
        card: 0,
        credit: 0,
        invoices: 0,
      };
    });

    netRows.forEach((row) => {
      const dayKey = toDayKey(row.created_at);
      if (!dailyMap[dayKey]) {
        const date = toDate(row.created_at);
        if (!date) return;
        dailyMap[dayKey] = {
          dayKey,
          label: DAY_LABEL.format(date),
          total: 0,
          cash: 0,
          card: 0,
          credit: 0,
          invoices: 0,
        };
      }
      dailyMap[dayKey].total += Number(row.total || 0);
      dailyMap[dayKey].cash += Number(row.cash_amount || 0);
      dailyMap[dayKey].card += Number(row.card_amount || 0);
      dailyMap[dayKey].credit += Number(row.credit_amount || 0);
      dailyMap[dayKey].invoices += 1;
    });

    const dailyChartRows = Object.values(dailyMap).sort((a, b) => a.dayKey.localeCompare(b.dayKey));
    const weeklyRows = dailyChartRows.slice(-7);

    const categoryMap = {};
    const productMap = {};
    const cashierMap = {};
    const hourMap = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: HOUR_LABEL.format(new Date(2026, 0, 1, hour)),
      revenue: 0,
      invoices: 0,
    }));

    netRows.forEach((row) => {
      const cashier = row.cashier || "N/A";
      if (!cashierMap[cashier]) {
        cashierMap[cashier] = { cashier, invoices: 0, revenue: 0, discount: 0 };
      }
      cashierMap[cashier].invoices += 1;
      cashierMap[cashier].revenue += Number(row.total || 0);
      cashierMap[cashier].discount += Number(row.discount_amount || 0);

      const created = toDate(row.created_at);
      if (created) {
        const hr = created.getHours();
        hourMap[hr].revenue += Number(row.total || 0);
        hourMap[hr].invoices += 1;
      }

      const lines = row.lines || [];
      lines.forEach((line) => {
        const name = line.item_name || `Item #${line.item_id}`;
        const category = line.category || "Unknown";
        const quantity = Math.abs(Number(line.quantity || 0));
        const revenue = Number(line.line_revenue || quantity * Number(line.unit_price || 0));
        const profit = Number(line.line_profit || 0);

        if (!categoryMap[category]) categoryMap[category] = { category, qty: 0, revenue: 0 };
        categoryMap[category].qty += quantity;
        categoryMap[category].revenue += revenue;

        if (!productMap[name]) {
          productMap[name] = {
            product: name,
            qty: 0,
            revenue: 0,
            profit: 0,
            trend: {},
          };
        }
        productMap[name].qty += quantity;
        productMap[name].revenue += revenue;
        productMap[name].profit += profit;
        const dKey = toDayKey(row.created_at);
        productMap[name].trend[dKey] = (productMap[name].trend[dKey] || 0) + quantity;
      });
    });

    const categoryRows = Object.values(categoryMap)
      .sort((a, b) => b.revenue - a.revenue)
      .map((row) => ({
        ...row,
        avgPrice: row.qty > 0 ? row.revenue / row.qty : 0,
      }));

    const categoryPie = categoryRows.slice(0, 7).map((row) => ({ name: row.category, value: row.revenue }));
    const cashierRows = Object.values(cashierMap)
      .sort((a, b) => b.revenue - a.revenue)
      .map((row) => ({
        ...row,
        avgSale: row.invoices > 0 ? row.revenue / row.invoices : 0,
      }));

    const productRowsBase = Object.values(productMap).sort((a, b) => b.revenue - a.revenue);
    const productRows = productRowsBase.map((row) => ({
      ...row,
      pctTotal: pct(row.revenue, salesAmount),
    }));
    const topProducts = [...productRows].sort((a, b) => b.qty - a.qty).slice(0, 10);

    const rangeDays = Math.max(1, dailyChartRows.length || 1);
    const productVelocityRows = productRows.map((row) => ({
      ...row,
      velocity: row.qty / rangeDays,
    }));

    const refundRows = filteredRows
      .filter((row) => row.is_return || Number(row.total || 0) < 0)
      .map((row) => ({
        id: row.id,
        invoice: row.invoice_no,
        date: row.created_at,
        amount: Math.abs(Number(row.total || 0)),
        reason: row.void_reason || "N/A",
      }));

    const cancelledRows = filteredRows
      .filter((row) => row.is_voided)
      .map((row) => ({
        id: row.id,
        invoice: row.invoice_no,
        cancelledBy: row.cancelled_by || "Unknown",
        cancelledAt: row.cancelled_at || row.created_at,
        reason: row.void_reason || "N/A",
      }));

    const discountRows = netRows
      .filter((row) => Number(row.discount_amount || 0) > 0)
      .map((row) => ({
        id: row.id,
        invoice: row.invoice_no,
        cashier: row.cashier || "N/A",
        customer: row.customer_name || "Walk-in",
        discount: Number(row.discount_amount || 0),
        products: (row.lines || []).map((line) => line.item_name).slice(0, 3).join(", ") || "-",
      }))
      .sort((a, b) => b.discount - a.discount);

    const bundleMap = {};
    netRows.forEach((row) => {
      const items = [...new Set((row.lines || []).map((line) => line.item_name).filter(Boolean))];
      if (items.length < 2) return;
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const pair = [items[i], items[j]].sort().join(" + ");
          bundleMap[pair] = (bundleMap[pair] || 0) + 1;
        }
      }
    });
    const bundleRows = Object.entries(bundleMap)
      .map(([bundle, soldTogether]) => ({ bundle, soldTogether }))
      .sort((a, b) => b.soldTogether - a.soldTogether)
      .slice(0, 10);

    const peakHours = [...hourMap]
      .filter((hour) => hour.invoices > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);

    const zeroSalesDays = dailyChartRows.filter((day) => day.invoices === 0);
    const maxHourRevenue = Math.max(1, ...hourMap.map((hour) => hour.revenue));

    const monthlyRows = dailyChartRows.filter((row) => monthKey(row.dayKey) === monthKey(dateTo || dateFrom || new Date()));
    const monthlyTotals = {
      total: monthlyRows.reduce((acc, row) => acc + row.total, 0),
      invoices: monthlyRows.reduce((acc, row) => acc + row.invoices, 0),
    };

    return {
      netRows,
      salesAmount,
      invoiceCount,
      avgInvoiceValue,
      discountTotal,
      taxTotal,
      cashTotal,
      cardTotal,
      creditTotal,
      dailyChartRows,
      weeklyRows,
      categoryPie,
      categoryRows,
      cashierRows,
      hourMap,
      maxHourRevenue,
      productRows,
      topProducts,
      productVelocityRows,
      refundRows,
      cancelledRows,
      discountRows,
      bundleRows,
      peakHours,
      zeroSalesDays,
      monthlyRows,
      monthlyTotals,
    };
  }, [dateFrom, dateTo, filteredRows]);

  useEffect(() => {
    if (!onPrepared) return;
    onPrepared({
      exportColumns: [
        { label: "Invoice", value: "invoice_no" },
        { label: "Date Time", value: "created_at" },
        { label: "Customer", value: (row) => row.customer_name || "Walk-in" },
        { label: "Items", value: (row) => Number(row.item_qty || 0) },
        { label: "Subtotal", value: (row) => Number(row.subtotal || 0) },
        { label: "Discount", value: (row) => Number(row.discount_amount || 0) },
        { label: "Tax", value: (row) => Number(row.tax_amount || 0) },
        { label: "Total", value: (row) => Number(row.total || 0) },
        { label: "Payment", value: (row) => paymentBucket(row) },
        { label: "Cashier", value: (row) => row.cashier || "N/A" },
        { label: "Status", value: (row) => statusLabel(row) },
      ],
      exportRows: filteredRows,
    });
  }, [filteredRows, onPrepared]);

  const pagedRows = useMemo(() => {
    const sorted = [...filteredRows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [filteredRows, page]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const fromRow = filteredRows.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const toRow = filteredRows.length === 0 ? 0 : Math.min(page * pageSize, filteredRows.length);

  const dailyBreakdownRows = useMemo(() => {
    const dayKey = dailyFocusDate || dateTo || dateFrom;
    const rows = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: HOUR_LABEL.format(new Date(2026, 0, 1, hour)),
      invoices: 0,
      revenue: 0,
    }));
    analytics.netRows.forEach((row) => {
      if (toDayKey(row.created_at) !== dayKey) return;
      const date = toDate(row.created_at);
      if (!date) return;
      rows[date.getHours()].invoices += 1;
      rows[date.getHours()].revenue += Number(row.total || 0);
    });
    return rows;
  }, [analytics.netRows, dailyFocusDate, dateFrom, dateTo]);

  const renderTabContent = () => {
    if (activeTab === "daily") {
      return (
        <SectionCard
          title="Daily Report"
          subtitle="Single-day hour-by-hour breakdown"
          right={
            <input
              type="date"
              className="field !py-1.5 !px-2.5 !text-xs w-40"
              value={dailyFocusDate}
              onChange={(event) => setDailyFocusDate(event.target.value)}
            />
          }
        >
          <MiniTable
            columns={[
              { label: "Hour", value: "label" },
              { label: "Invoices", value: (row) => row.invoices.toLocaleString() },
              { label: "Revenue", value: (row) => money(row.revenue) },
            ]}
            rows={dailyBreakdownRows}
            emptyLabel="No sales for this day."
          />
        </SectionCard>
      );
    }

    if (activeTab === "weekly") {
      return (
        <SectionCard title="Weekly Report" subtitle="7-day comparison">
          <MiniTable
            columns={[
              { label: "Date", value: "label" },
              { label: "Invoices", value: (row) => row.invoices.toLocaleString() },
              { label: "Cash", value: (row) => money(row.cash) },
              { label: "Card", value: (row) => money(row.card) },
              { label: "Credit", value: (row) => money(row.credit) },
              { label: "Total", value: (row) => money(row.total) },
            ]}
            rows={analytics.weeklyRows}
            emptyLabel="No weekly data available."
          />
        </SectionCard>
      );
    }

    if (activeTab === "monthly") {
      return (
        <SectionCard title="Monthly Report" subtitle="Day-by-day table with totals row">
          <MiniTable
            columns={[
              { label: "Date", value: "label" },
              { label: "Invoices", value: (row) => row.invoices.toLocaleString() },
              { label: "Revenue", value: (row) => money(row.total) },
            ]}
            rows={[
              ...analytics.monthlyRows,
              {
                key: "total-row",
                label: "Total",
                invoices: analytics.monthlyTotals.invoices,
                total: analytics.monthlyTotals.total,
              },
            ]}
            emptyLabel="No monthly sales data."
          />
        </SectionCard>
      );
    }

    if (activeTab === "custom") {
      return (
        <SectionCard title="Custom Range Summary" subtitle={`From ${dateFrom} to ${dateTo}`}>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Invoices</p>
              <p className="mt-1 text-2xl font-black text-white">{analytics.invoiceCount.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Revenue</p>
              <p className="mt-1 text-2xl font-black text-white">{money(analytics.salesAmount)}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Discounts</p>
              <p className="mt-1 text-2xl font-black text-amber-300">{money(analytics.discountTotal)}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Tax Collected</p>
              <p className="mt-1 text-2xl font-black text-emerald-300">{money(analytics.taxTotal)}</p>
            </div>
          </div>
        </SectionCard>
      );
    }

    if (activeTab === "product") {
      return (
        <SectionCard title="Product-wise Sales" subtitle="Qty, revenue, profit, and share of total">
          <MiniTable
            columns={[
              { label: "Product", value: "product" },
              { label: "Qty Sold", value: (row) => row.qty.toLocaleString() },
              { label: "Revenue", value: (row) => money(row.revenue) },
              { label: "Profit", value: (row) => money(row.profit) },
              { label: "% Total", value: (row) => `${row.pctTotal.toFixed(1)}%` },
            ]}
            rows={analytics.productRows}
            emptyLabel="No product sales rows."
          />
        </SectionCard>
      );
    }

    if (activeTab === "category") {
      return (
        <SectionCard title="Category-wise Sales" subtitle="Category quantity, revenue, and average price">
          <MiniTable
            columns={[
              { label: "Category", value: "category" },
              { label: "Qty", value: (row) => row.qty.toLocaleString() },
              { label: "Revenue", value: (row) => money(row.revenue) },
              { label: "Avg Price", value: (row) => money(row.avgPrice) },
            ]}
            rows={analytics.categoryRows}
            emptyLabel="No category rows."
          />
        </SectionCard>
      );
    }

    if (activeTab === "cashier") {
      return (
        <SectionCard title="Cashier-wise Sales" subtitle="Invoice count, revenue, discounts, and average sale">
          <MiniTable
            columns={[
              { label: "Cashier", value: "cashier" },
              { label: "# Invoices", value: (row) => row.invoices.toLocaleString() },
              { label: "Revenue", value: (row) => money(row.revenue) },
              { label: "Discount Given", value: (row) => money(row.discount) },
              { label: "Avg Sale", value: (row) => money(row.avgSale) },
            ]}
            rows={analytics.cashierRows}
            emptyLabel="No cashier rows."
          />
        </SectionCard>
      );
    }

    if (activeTab === "top-products") {
      return (
        <SectionCard title="Top Selling Products" subtitle="Ranked by quantity with sparkline trend">
          <MiniTable
            columns={[
              { label: "Rank", value: "rank" },
              { label: "Product", value: "product" },
              { label: "Qty", value: (row) => row.qty.toLocaleString() },
              { label: "Revenue", value: (row) => money(row.revenue) },
              {
                label: "Trend",
                value: (row) => {
                  const trendRows = analytics.dailyChartRows.slice(-7).map((day) => ({
                    day: day.label,
                    qty: row.trend[day.dayKey] || 0,
                  }));
                  return (
                    <div className="w-24 h-8">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendRows}>
                          <Line type="monotone" dataKey="qty" stroke="#38bdf8" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  );
                },
              },
            ]}
            rows={analytics.topProducts.map((row, index) => ({ ...row, rank: index + 1 }))}
            emptyLabel="No top products."
          />
        </SectionCard>
      );
    }

    return (
      <SectionCard title="Advanced Insights" subtitle="Refunds, discounts, bundles, peak hours, velocity, zero-sales, cancellations">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <SectionCard title="Refund / Return Tracking">
            <MiniTable
              columns={[
                { label: "Invoice", value: "invoice" },
                { label: "Date", value: (row) => new Date(row.date).toLocaleString() },
                { label: "Amount", value: (row) => money(row.amount) },
                { label: "Reason", value: "reason" },
              ]}
              rows={analytics.refundRows.slice(0, 10)}
              emptyLabel="No refunds/returns in range."
            />
          </SectionCard>

          <SectionCard title="Discount Analysis">
            <MiniTable
              columns={[
                { label: "Invoice", value: "invoice" },
                { label: "Cashier", value: "cashier" },
                { label: "Customer", value: "customer" },
                { label: "Discount", value: (row) => money(row.discount) },
                { label: "Products", value: "products" },
              ]}
              rows={analytics.discountRows.slice(0, 10)}
              emptyLabel="No discounts applied."
            />
          </SectionCard>

          <SectionCard title="Bundled Sales Tracking">
            <MiniTable
              columns={[
                { label: "Bundle", value: "bundle" },
                { label: "Sold Together", value: (row) => row.soldTogether.toLocaleString() },
              ]}
              rows={analytics.bundleRows}
              emptyLabel="No repeated bundles detected."
            />
          </SectionCard>

          <SectionCard title="Peak Hours Analysis">
            <MiniTable
              columns={[
                { label: "Hour", value: "label" },
                { label: "Invoices", value: (row) => row.invoices.toLocaleString() },
                { label: "Revenue", value: (row) => money(row.revenue) },
              ]}
              rows={analytics.peakHours}
              emptyLabel="No hourly peaks."
            />
          </SectionCard>

          <SectionCard title="Sales Velocity (Units / Day)">
            <MiniTable
              columns={[
                { label: "Product", value: "product" },
                { label: "Qty Sold", value: (row) => row.qty.toLocaleString() },
                { label: "Units / Day", value: (row) => row.velocity.toFixed(2) },
              ]}
              rows={[...analytics.productVelocityRows].sort((a, b) => b.velocity - a.velocity).slice(0, 12)}
              emptyLabel="No velocity rows."
            />
          </SectionCard>

          <SectionCard title="Zero-Sales Days Alert">
            <MiniTable
              columns={[
                { label: "Date", value: "label" },
                { label: "Invoices", value: (row) => row.invoices.toLocaleString() },
              ]}
              rows={analytics.zeroSalesDays}
              emptyLabel="No zero-sales days in selected range."
            />
          </SectionCard>

          <SectionCard title="Cancelled Invoice Log" className="xl:col-span-2">
            <MiniTable
              columns={[
                { label: "Invoice", value: "invoice" },
                { label: "Cancelled By", value: "cancelledBy" },
                { label: "Cancelled At", value: (row) => new Date(row.cancelledAt).toLocaleString() },
                { label: "Reason", value: "reason" },
              ]}
              rows={analytics.cancelledRows}
              emptyLabel="No cancelled invoices found."
            />
          </SectionCard>
        </div>
      </SectionCard>
    );
  };

  return (
    <>
      <SectionCard title="Sales Filters" subtitle="Refine by employee, product, category, payment and invoice type">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2">
          <Select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">All Cashiers</option>
            {filterOptions.cashiers.map((cashier) => (
              <option key={cashier} value={cashier}>{cashier}</option>
            ))}
          </Select>

          <Select value={productFilter} onChange={(event) => setProductFilter(event.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">All Products</option>
            {filterOptions.products.map((product) => (
              <option key={product.value} value={product.value}>{product.label}</option>
            ))}
          </Select>

          <Select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">All Categories</option>
            {filterOptions.categories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </Select>

          <Select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">All Payment Methods</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="credit">Credit</option>
            <option value="mixed">Mixed</option>
          </Select>

          <Select value={invoiceTypeFilter} onChange={(event) => setInvoiceTypeFilter(event.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">All Invoice Types</option>
            <option value="full">Full</option>
            <option value="partial">Partial</option>
            <option value="pending">Pending</option>
          </Select>

          <Button variant="secondary" size="sm" onClick={() => {
            setEmployeeFilter("all");
            setProductFilter("all");
            setCategoryFilter("all");
            setPaymentFilter("all");
            setInvoiceTypeFilter("all");
          }}>
            <RefreshCcw size={14} /> Reset
          </Button>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        <KpiCard title="Total Sales Amount" value={money(analytics.salesAmount)} icon={<DollarSign size={18} />} />
        <KpiCard title="Number of Invoices" value={analytics.invoiceCount.toLocaleString()} icon={<Receipt size={18} />} tone="indigo" />
        <KpiCard title="Average Invoice Value" value={money(analytics.avgInvoiceValue)} icon={<BarChart3 size={18} />} tone="sky" />
        <KpiCard title="Discount Amount Given" value={money(analytics.discountTotal)} icon={<Tag size={18} />} tone="amber" />
        <KpiCard title="Total Tax Collected" value={money(analytics.taxTotal)} icon={<ShoppingCart size={18} />} tone="green" />
      </div>

      <SectionCard title="Payment Channel Split">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="text-xs text-slate-400 uppercase tracking-wider">Cash Sales</p>
            <p className="mt-1 text-2xl font-black text-white">{money(analytics.cashTotal)}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="text-xs text-slate-400 uppercase tracking-wider">Card Sales</p>
            <p className="mt-1 text-2xl font-black text-white">{money(analytics.cardTotal)}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="text-xs text-slate-400 uppercase tracking-wider">Credit Sales</p>
            <p className="mt-1 text-2xl font-black text-white">{money(analytics.creditTotal)}</p>
          </div>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-8" title="Daily Sales Bar Chart" subtitle="Per day in selected range">
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.dailyChartRows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.08)" />
                <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} width={72} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                <Tooltip formatter={(value) => money(value)} />
                <Bar dataKey="total" fill="#38bdf8" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-4" title="Category-wise Sales" subtitle="Revenue split by category">
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={analytics.categoryPie} dataKey="value" nameKey="name" innerRadius={52} outerRadius={85} stroke="none">
                  {analytics.categoryPie.map((entry, index) => (
                    <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => money(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5">
            {analytics.categoryPie.slice(0, 5).map((row, index) => (
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
        <SectionCard className="xl:col-span-6" title="Cashier Performance Bar Chart" subtitle="Revenue per cashier">
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.cashierRows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.08)" />
                <XAxis dataKey="cashier" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} width={72} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                <Tooltip formatter={(value) => money(value)} />
                <Bar dataKey="revenue" fill="#6366f1" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Payment Method Trend" subtitle="Cash vs Card vs Credit over time">
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analytics.dailyChartRows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.08)" />
                <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} width={72} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                <Tooltip formatter={(value) => money(value)} />
                <Area type="monotone" dataKey="cash" stackId="payment" stroke="#22c55e" fill="rgba(34,197,94,0.3)" />
                <Area type="monotone" dataKey="card" stackId="payment" stroke="#38bdf8" fill="rgba(56,189,248,0.28)" />
                <Area type="monotone" dataKey="credit" stackId="payment" stroke="#f59e0b" fill="rgba(245,158,11,0.25)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Hourly Sales Heatmap" subtitle="Peak selling hours">
        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-12 gap-2">
          {analytics.hourMap.map((hour) => {
            const intensity = hour.revenue / analytics.maxHourRevenue;
            const bg = `rgba(56, 189, 248, ${0.14 + intensity * 0.68})`;
            return (
              <div key={hour.hour} className="rounded-lg border border-white/10 p-2" style={{ backgroundColor: bg }}>
                <p className="text-[11px] font-bold text-white">{hour.label}</p>
                <p className="text-[10px] text-slate-200">{hour.invoices} invoices</p>
                <p className="text-[10px] text-slate-100">{money(hour.revenue)}</p>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Sub-Report Views">
        <div className="flex flex-wrap gap-2">
          {SUB_REPORT_TABS.map((tab) => (
            <button
              key={tab.key}
              className={`btn btn-sm ${activeTab === tab.key ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </SectionCard>

      {renderTabContent()}

      <SectionCard title="Invoice Summary" subtitle="Detailed invoice table with pagination">
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
          <Table>
            <thead>
              <tr>
                <th>Invoice No.</th>
                <th>Date &amp; Time</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Subtotal</th>
                <th>Discount</th>
                <th>Tax</th>
                <th>Total</th>
                <th>Payment Method</th>
                <th>Cashier</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.length === 0 && (
                <tr>
                  <td colSpan={12} className="py-6 text-slate-400">
                    No invoices match the filters.
                  </td>
                </tr>
              )}
              {pagedRows.map((row) => (
                <tr key={row.id}>
                  <td className="font-mono">{row.invoice_no}</td>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>{row.customer_name || "Walk-in"}</td>
                  <td>{Number(row.item_qty || 0).toLocaleString()}</td>
                  <td>{money(row.subtotal)}</td>
                  <td>{money(row.discount_amount)}</td>
                  <td>{money(row.tax_amount)}</td>
                  <td className="font-bold">{money(row.total)}</td>
                  <td>{paymentBucket(row)}</td>
                  <td>{row.cashier || "N/A"}</td>
                  <td>
                    <Badge tone={statusTone(statusLabel(row))}>{statusLabel(row)}</Badge>
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/invoice/${row.id}`)}>View</Button>
                      <Button size="sm" variant="secondary" onClick={() => openPrintCenter(navigate, { type: "sales_receipt", ref: row.id, paper: "thermal_80" })}>Print</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-400">
            Showing {fromRow} to {toRow} of {filteredRows.length} invoices
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page <= 1}>
              Previous
            </Button>
            <Badge tone="indigo">Page {page} / {totalPages}</Badge>
            <Button size="sm" variant="secondary" onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={page >= totalPages}>
              Next
            </Button>
          </div>
        </div>
      </SectionCard>

      {(analytics.zeroSalesDays.length > 0 || analytics.cancelledRows.length > 0) && (
        <SectionCard title="Sales Alerts" subtitle="Auto-flagged risk signals">
          <div className="space-y-2">
            {analytics.zeroSalesDays.length > 0 && (
              <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-amber-100 text-sm flex items-center gap-2">
                <AlertTriangle size={14} />
                Zero-sales days detected: {analytics.zeroSalesDays.length} day(s) in selected range.
              </div>
            )}
            {analytics.cancelledRows.length > 0 && (
              <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-rose-100 text-sm flex items-center gap-2">
                <Users size={14} />
                Cancelled invoices logged: {analytics.cancelledRows.length} invoice(s).
              </div>
            )}
          </div>
        </SectionCard>
      )}
    </>
  );
}
