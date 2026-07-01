import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  DollarSign,
  Gauge,
  Percent,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge, KpiCard, SectionCard, Table, Select } from "../../../components/UI";

const DAY_MS = 1000 * 60 * 60 * 24;
const MONEY_LOCALE = "en-LK";
const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" });
const SERIES_COLORS = ["#38bdf8", "#6366f1", "#14b8a6", "#f59e0b", "#f97316", "#a78bfa", "#22c55e"];
const BRAND_COLORS = ["#22c55e", "#38bdf8", "#6366f1", "#f59e0b", "#ef4444", "#14b8a6", "#a78bfa"];
const SUB_REPORT_TABS = [
  { key: "best-sellers", label: "Best Sellers" },
  { key: "low-performers", label: "Low Performers" },
  { key: "category-performance", label: "Category Performance" },
  { key: "brand-performance", label: "Brand Performance" },
  { key: "profit-per-product", label: "Profit per Product" },
  { key: "movement-trend", label: "Movement Trend" },
];

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
  const copy = new Date(date);
  copy.setDate(copy.getDate() + 1);
  return copy;
}

function inDateRange(value, start, endExclusive) {
  const date = toDate(value);
  if (!date) return false;
  if (start && date < start) return false;
  if (endExclusive && date >= endExclusive) return false;
  return true;
}

function daysSince(value, now = new Date()) {
  const date = toDate(value);
  if (!date) return 0;
  return Math.max(0, Math.floor((now - date) / DAY_MS));
}

function performanceTone(tag) {
  if (tag === "Top") return "green";
  if (tag === "Low") return "red";
  return "indigo";
}

function stockRatioTag(ratio) {
  if (ratio > 3) return "Overstocked";
  if (ratio < 0.5) return "Understocked";
  return "Balanced";
}

function elasticityTag(value) {
  if (value === null || Number.isNaN(value)) return "Insufficient Data";
  const abs = Math.abs(value);
  if (abs >= 1.5) return "High Elasticity";
  if (abs >= 0.7) return "Moderate Elasticity";
  return "Low Elasticity";
}

function lifecycleStage({ firstSaleAt, recentQty, previousQty, totalQty }) {
  if (!firstSaleAt || totalQty <= 0) return "Introductory";
  const ageDays = daysSince(firstSaleAt);
  if (ageDays <= 45) return "Introductory";
  if (recentQty > previousQty * 1.2) return "Growth";
  if (recentQty < previousQty * 0.8) return "Declining";
  return "Mature";
}

function MiniSparkline({ points }) {
  const width = 96;
  const height = 26;
  const values = (points || []).map((value) => Number(value || 0));
  if (values.length === 0) {
    return <span className="text-slate-500">-</span>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length === 1 ? width : width / (values.length - 1);
  const coords = values
    .map((value, index) => {
      const x = index * stepX;
      const y = height - ((value - min) / range) * (height - 2) - 1;
      return `${x},${y}`;
    })
    .join(" ");
  const trendUp = values[values.length - 1] >= values[0];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
      <polyline
        fill="none"
        stroke={trendUp ? "#22c55e" : "#ef4444"}
        strokeWidth="2"
        points={coords}
      />
    </svg>
  );
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

export default function ProductPerformanceContent({
  salesRows,
  inventoryRows,
  movementRows,
  suppliersRows,
  dateFrom,
  dateTo,
  query,
  onPrepared,
}) {
  const [activeSubReport, setActiveSubReport] = useState("best-sellers");
  const [rangeFrom, setRangeFrom] = useState(dateFrom || "");
  const [rangeTo, setRangeTo] = useState(dateTo || "");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [performanceStatusFilter, setPerformanceStatusFilter] = useState("all");
  const [selectedTrendProduct, setSelectedTrendProduct] = useState("");

  useEffect(() => {
    setRangeFrom(dateFrom || "");
    setRangeTo(dateTo || "");
  }, [dateFrom, dateTo]);

  const inventoryById = useMemo(
    () => Object.fromEntries((inventoryRows || []).map((item) => [String(item.id), item])),
    [inventoryRows],
  );

  const suppliersById = useMemo(
    () =>
      Object.fromEntries(
        (suppliersRows || []).map((supplier) => [
          String(supplier.id),
          supplier.name || `Supplier #${supplier.id}`,
        ]),
      ),
    [suppliersRows],
  );

  const rangeStart = useMemo(() => parseDateInput(rangeFrom), [rangeFrom]);
  const rangeEnd = useMemo(() => parseDateInput(rangeTo, true), [rangeTo]);
  const normalizedQuery = (query || "").trim().toLowerCase();

  const rawProductRows = useMemo(() => {
    const map = {};
    const categorySeasonalMap = {};
    const basketPairMap = {};
    const monthSet = new Set();

    (salesRows || []).forEach((sale) => {
      if (sale.is_voided) return;
      if (!inDateRange(sale.created_at, rangeStart, rangeEnd)) return;
      const saleMonth = toMonthKey(sale.created_at);
      if (saleMonth) monthSet.add(saleMonth);
      const lines = Array.isArray(sale.lines) ? sale.lines : [];
      const saleProductKeys = new Set();

      lines.forEach((line) => {
        const key = String(line.item_id ?? line.item_name ?? "");
        if (!key) return;
        const inventoryItem = inventoryById[key];
        const productName = line.item_name || inventoryItem?.name || `Item #${key}`;
        const category = line.category || inventoryItem?.category || "Uncategorized";
        const brand = inventoryItem?.brand || "Unbranded";
        const supplierId = inventoryItem?.supplier_id;
        const supplierName = suppliersById[String(supplierId)] || "Unspecified";
        const qty = Number(line.quantity || 0);
        const unitPrice = Number(line.unit_price || line.price || 0);
        const lineRevenueRaw = Number(line.line_revenue ?? qty * unitPrice);
        const lineCostRaw = Number(line.line_cost ?? qty * Number(line.cost_price || inventoryItem?.cost_price || 0));

        if (!map[key]) {
          map[key] = {
            id: key,
            product: productName,
            brand,
            category,
            supplierId: String(supplierId || "unspecified"),
            supplier: supplierName,
            qtySold: 0,
            returnQty: 0,
            grossRevenue: 0,
            returnedValue: 0,
            grossCost: 0,
            grossProfit: 0,
            stockLeft: Number(inventoryItem?.quantity || 0),
            monthlyQty: {},
            monthlyRevenue: {},
            monthlyAvgPrice: {},
            firstSaleAt: null,
            lastSaleAt: null,
          };
        }

        const row = map[key];
        if (!row.firstSaleAt || new Date(sale.created_at) < new Date(row.firstSaleAt)) {
          row.firstSaleAt = sale.created_at;
        }
        if (!row.lastSaleAt || new Date(sale.created_at) > new Date(row.lastSaleAt)) {
          row.lastSaleAt = sale.created_at;
        }

        if (sale.is_return || qty < 0 || lineRevenueRaw < 0) {
          row.returnQty += Math.abs(qty);
          row.returnedValue += Math.abs(lineRevenueRaw);
        } else {
          const soldQty = Math.max(0, qty);
          const soldRevenue = Math.max(0, lineRevenueRaw);
          const soldCost = Math.max(0, lineCostRaw);
          row.qtySold += soldQty;
          row.grossRevenue += soldRevenue;
          row.grossCost += soldCost;
          row.grossProfit += soldRevenue - soldCost;
          if (saleMonth) {
            row.monthlyQty[saleMonth] = (row.monthlyQty[saleMonth] || 0) + soldQty;
            row.monthlyRevenue[saleMonth] = (row.monthlyRevenue[saleMonth] || 0) + soldRevenue;
            row.monthlyAvgPrice[saleMonth] = {
              qty: (row.monthlyAvgPrice[saleMonth]?.qty || 0) + soldQty,
              revenue: (row.monthlyAvgPrice[saleMonth]?.revenue || 0) + soldRevenue,
            };
            if (!categorySeasonalMap[saleMonth]) categorySeasonalMap[saleMonth] = {};
            categorySeasonalMap[saleMonth][category] =
              (categorySeasonalMap[saleMonth][category] || 0) + soldRevenue;
          }
          saleProductKeys.add(key);
        }
      });

      const keys = [...saleProductKeys];
      for (let i = 0; i < keys.length; i += 1) {
        for (let j = i + 1; j < keys.length; j += 1) {
          const a = keys[i];
          const b = keys[j];
          const pairKey = a < b ? `${a}__${b}` : `${b}__${a}`;
          basketPairMap[pairKey] = (basketPairMap[pairKey] || 0) + 1;
        }
      }
    });

    const sortedMonths = [...monthSet].sort((a, b) => a.localeCompare(b));
    const latestMonth = sortedMonths[sortedMonths.length - 1] || "";
    const prevMonth = sortedMonths[sortedMonths.length - 2] || "";

    const rows = Object.values(map).map((row) => {
      const netRevenue = Math.max(0, row.grossRevenue - row.returnedValue);
      const netProfit = row.grossProfit - row.returnedValue;
      const marginPct = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;
      const returnRatePct = row.qtySold > 0 ? (row.returnQty / row.qtySold) * 100 : 0;
      const stockToSalesRatio = row.qtySold > 0 ? row.stockLeft / row.qtySold : row.stockLeft;
      const stockRatioStatus = stockRatioTag(stockToSalesRatio);

      const firstPriceMonth = sortedMonths.find((month) => (row.monthlyAvgPrice[month]?.qty || 0) > 0);
      const lastPriceMonth = [...sortedMonths]
        .reverse()
        .find((month) => (row.monthlyAvgPrice[month]?.qty || 0) > 0);
      let elasticity = null;
      if (firstPriceMonth && lastPriceMonth && firstPriceMonth !== lastPriceMonth) {
        const firstQty = row.monthlyAvgPrice[firstPriceMonth].qty || 0;
        const lastQty = row.monthlyAvgPrice[lastPriceMonth].qty || 0;
        const firstPrice = firstQty > 0 ? row.monthlyAvgPrice[firstPriceMonth].revenue / firstQty : 0;
        const lastPrice = lastQty > 0 ? row.monthlyAvgPrice[lastPriceMonth].revenue / lastQty : 0;
        const pctPrice = firstPrice > 0 ? (lastPrice - firstPrice) / firstPrice : 0;
        const pctQty = firstQty > 0 ? (lastQty - firstQty) / firstQty : 0;
        elasticity = pctPrice !== 0 ? pctQty / pctPrice : null;
      }

      const recentQty = latestMonth ? Number(row.monthlyQty[latestMonth] || 0) : 0;
      const previousQty = prevMonth ? Number(row.monthlyQty[prevMonth] || 0) : 0;
      const lifecycle = lifecycleStage({
        firstSaleAt: row.firstSaleAt,
        recentQty,
        previousQty,
        totalQty: row.qtySold,
      });

      const trendSeries = sortedMonths.map((month) => Number(row.monthlyQty[month] || 0));
      const trendDirection =
        trendSeries.length >= 2 && trendSeries[trendSeries.length - 1] > trendSeries[0]
          ? "Up"
          : trendSeries.length >= 2 && trendSeries[trendSeries.length - 1] < trendSeries[0]
            ? "Down"
            : "Flat";

      return {
        ...row,
        netRevenue,
        netCost: row.grossCost,
        netProfit,
        marginPct,
        returnRatePct,
        stockToSalesRatio,
        stockRatioStatus,
        elasticity,
        elasticityTag: elasticityTag(elasticity),
        lifecycle,
        trendSeries,
        trendDirection,
        recentQty,
        previousQty,
      };
    });

    const pairRows = Object.entries(basketPairMap)
      .map(([pairKey, count]) => {
        const [a, b] = pairKey.split("__");
        return {
          pairKey,
          productA: map[a]?.product || `Item #${a}`,
          productB: map[b]?.product || `Item #${b}`,
          count: Number(count || 0),
        };
      })
      .sort((a, b) => b.count - a.count);

    return {
      rows,
      sortedMonths,
      categorySeasonalMap,
      crossSellPairs: pairRows,
    };
  }, [inventoryById, rangeEnd, rangeStart, salesRows, suppliersById]);

  const rankedRows = useMemo(() => {
    const sorted = [...rawProductRows.rows].sort((a, b) => b.netRevenue - a.netRevenue);
    const length = sorted.length;
    const chunk = Math.max(1, Math.round(length * 0.2));
    return sorted.map((row, index) => {
      const tag = index < chunk ? "Top" : index >= length - chunk ? "Low" : "Average";
      return {
        ...row,
        performanceTag: tag,
      };
    });
  }, [rawProductRows.rows]);

  const filterOptions = useMemo(() => {
    const categories = new Set();
    const brands = new Set();
    const suppliers = new Set();
    rankedRows.forEach((row) => {
      categories.add(row.category || "Uncategorized");
      brands.add(row.brand || "Unbranded");
      suppliers.add(row.supplierId || "unspecified");
    });
    return {
      categories: [...categories].sort((a, b) => a.localeCompare(b)),
      brands: [...brands].sort((a, b) => a.localeCompare(b)),
      suppliers: [...suppliers].sort((a, b) => {
        const aName = suppliersById[a] || (a === "unspecified" ? "Unspecified" : `Supplier #${a}`);
        const bName = suppliersById[b] || (b === "unspecified" ? "Unspecified" : `Supplier #${b}`);
        return aName.localeCompare(bName);
      }),
    };
  }, [rankedRows, suppliersById]);

  const filteredRows = useMemo(() => {
    return rankedRows.filter((row) => {
      if (categoryFilter !== "all" && row.category !== categoryFilter) return false;
      if (brandFilter !== "all" && row.brand !== brandFilter) return false;
      if (supplierFilter !== "all" && row.supplierId !== supplierFilter) return false;
      if (
        performanceStatusFilter !== "all" &&
        row.performanceTag.toLowerCase() !== performanceStatusFilter
      ) {
        return false;
      }
      if (!normalizedQuery) return true;
      const hay = `${row.product} ${row.brand} ${row.category} ${row.supplier}`.toLowerCase();
      return hay.includes(normalizedQuery);
    });
  }, [brandFilter, categoryFilter, normalizedQuery, performanceStatusFilter, rankedRows, supplierFilter]);

  const sortedByRevenue = useMemo(
    () => [...filteredRows].sort((a, b) => b.netRevenue - a.netRevenue),
    [filteredRows],
  );
  const sortedByQty = useMemo(
    () => [...filteredRows].sort((a, b) => b.qtySold - a.qtySold),
    [filteredRows],
  );
  const sortedByMargin = useMemo(
    () =>
      [...filteredRows]
        .filter((row) => row.netRevenue > 0)
        .sort((a, b) => b.marginPct - a.marginPct),
    [filteredRows],
  );

  useEffect(() => {
    if (!selectedTrendProduct && sortedByQty.length > 0) {
      setSelectedTrendProduct(sortedByQty[0].id);
    } else if (selectedTrendProduct && !filteredRows.some((row) => row.id === selectedTrendProduct)) {
      setSelectedTrendProduct(filteredRows[0]?.id || "");
    }
  }, [filteredRows, selectedTrendProduct, sortedByQty]);

  const totalProductsTracked = filteredRows.length;
  const bestSellingProduct = sortedByQty[0];
  const highestRevenueProduct = sortedByRevenue[0];
  const highestMarginProduct = sortedByMargin[0];
  const lowestPerformingProduct = [...filteredRows].sort((a, b) => a.netRevenue - b.netRevenue)[0];
  const averageProductMarginPct =
    filteredRows.length > 0
      ? filteredRows.reduce((sum, row) => sum + Number(row.marginPct || 0), 0) / filteredRows.length
      : 0;

  const categoryPerformanceRows = useMemo(() => {
    const map = {};
    filteredRows.forEach((row) => {
      if (!map[row.category]) {
        map[row.category] = {
          category: row.category,
          revenue: 0,
          qty: 0,
          profit: 0,
        };
      }
      map[row.category].revenue += row.netRevenue;
      map[row.category].qty += row.qtySold;
      map[row.category].profit += row.netProfit;
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }, [filteredRows]);

  const brandPerformanceRows = useMemo(() => {
    const map = {};
    filteredRows.forEach((row) => {
      if (!map[row.brand]) {
        map[row.brand] = {
          brand: row.brand,
          revenue: 0,
          qty: 0,
          profit: 0,
        };
      }
      map[row.brand].revenue += row.netRevenue;
      map[row.brand].qty += row.qtySold;
      map[row.brand].profit += row.netProfit;
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }, [filteredRows]);

  const selectedTrendProductRow = useMemo(
    () => filteredRows.find((row) => row.id === selectedTrendProduct),
    [filteredRows, selectedTrendProduct],
  );

  const salesTrendPerProductRows = useMemo(() => {
    if (!selectedTrendProductRow) return [];
    return rawProductRows.sortedMonths.map((month) => ({
      month,
      label: MONTH_LABEL.format(new Date(`${month}-01T00:00:00`)),
      qty: Number(selectedTrendProductRow.monthlyQty[month] || 0),
      revenue: Number(selectedTrendProductRow.monthlyRevenue[month] || 0),
    }));
  }, [rawProductRows.sortedMonths, selectedTrendProductRow]);

  const marginScatterRows = useMemo(
    () =>
      filteredRows
        .filter((row) => row.netRevenue > 0)
        .map((row) => ({
          product: row.product,
          price: row.qtySold > 0 ? row.netRevenue / row.qtySold : 0,
          marginPct: row.marginPct,
          revenue: row.netRevenue,
        })),
    [filteredRows],
  );

  const seasonalTrendRows = useMemo(() => {
    const topCategories = categoryPerformanceRows.slice(0, 4).map((row) => row.category);
    return rawProductRows.sortedMonths.map((month) => {
      const row = {
        month,
        label: MONTH_LABEL.format(new Date(`${month}-01T00:00:00`)),
      };
      topCategories.forEach((category) => {
        row[category] = Number(rawProductRows.categorySeasonalMap[month]?.[category] || 0);
      });
      return row;
    });
  }, [categoryPerformanceRows, rawProductRows.categorySeasonalMap, rawProductRows.sortedMonths]);

  const movementTrendRows = useMemo(() => {
    const baseMap = {};
    filteredRows.forEach((row) => {
      baseMap[row.id] = {
        productId: row.id,
        product: row.product,
        inQty: 0,
        outQty: 0,
        adjustQty: 0,
        returnQty: row.returnQty,
      };
    });

    (movementRows || []).forEach((movement) => {
      if (!inDateRange(movement.created_at, rangeStart, rangeEnd)) return;
      const key = String(movement.item_id || "");
      if (!baseMap[key]) return;
      const type = String(movement.movement_type || "").toUpperCase();
      const qty = Number(movement.quantity || 0);
      if (type === "IN" || qty > 0) baseMap[key].inQty += Math.max(0, qty);
      if (["OUT", "SALE", "REPAIR_CONSUME"].includes(type) || qty < 0) {
        baseMap[key].outQty += Math.abs(Math.min(0, qty)) + (qty > 0 && ["OUT", "SALE", "REPAIR_CONSUME"].includes(type) ? qty : 0);
      }
      if (type === "ADJUSTMENT") baseMap[key].adjustQty += qty;
    });

    return Object.values(baseMap)
      .map((row) => ({
        ...row,
        netMovement: row.inQty - row.outQty + row.adjustQty,
      }))
      .sort((a, b) => Math.abs(b.netMovement) - Math.abs(a.netMovement));
  }, [filteredRows, movementRows, rangeEnd, rangeStart]);

  const crossSellRows = useMemo(() => {
    const allowedIds = new Set(filteredRows.map((row) => row.id));
    return rawProductRows.crossSellPairs
      .filter((pair) => {
        const [a, b] = pair.pairKey.split("__");
        return allowedIds.has(a) || allowedIds.has(b);
      })
      .slice(0, 20);
  }, [filteredRows, rawProductRows.crossSellPairs]);

  const selectedSubReportPayload = useMemo(() => {
    const baseColumns = [
      { label: "Product", value: "product" },
      { label: "Brand", value: "brand" },
      { label: "Category", value: "category" },
      { label: "Qty Sold", value: (row) => Number(row.qtySold || 0) },
      { label: "Revenue", value: (row) => Number(row.netRevenue || 0) },
      { label: "Cost", value: (row) => Number(row.netCost || 0) },
      { label: "Profit", value: (row) => Number(row.netProfit || 0) },
      { label: "Margin %", value: (row) => Number((row.marginPct || 0).toFixed(2)) },
      { label: "Stock Left", value: (row) => Number(row.stockLeft || 0) },
      { label: "Performance Tag", value: "performanceTag" },
    ];

    const payloadMap = {
      "best-sellers": {
        exportColumns: baseColumns,
        exportRows: sortedByRevenue.slice(0, 20),
      },
      "low-performers": {
        exportColumns: baseColumns,
        exportRows: [...sortedByRevenue].reverse().slice(0, 20),
      },
      "category-performance": {
        exportColumns: [
          { label: "Category", value: "category" },
          { label: "Revenue", value: (row) => Number(row.revenue || 0) },
          { label: "Qty Sold", value: (row) => Number(row.qty || 0) },
          { label: "Profit", value: (row) => Number(row.profit || 0) },
        ],
        exportRows: categoryPerformanceRows,
      },
      "brand-performance": {
        exportColumns: [
          { label: "Brand", value: "brand" },
          { label: "Revenue", value: (row) => Number(row.revenue || 0) },
          { label: "Qty Sold", value: (row) => Number(row.qty || 0) },
          { label: "Profit", value: (row) => Number(row.profit || 0) },
        ],
        exportRows: brandPerformanceRows,
      },
      "profit-per-product": {
        exportColumns: [
          { label: "Product", value: "product" },
          { label: "Revenue", value: (row) => Number(row.netRevenue || 0) },
          { label: "Cost", value: (row) => Number(row.netCost || 0) },
          { label: "Profit", value: (row) => Number(row.netProfit || 0) },
          { label: "Margin %", value: (row) => Number((row.marginPct || 0).toFixed(2)) },
        ],
        exportRows: sortedByRevenue,
      },
      "movement-trend": {
        exportColumns: [
          { label: "Product", value: "product" },
          { label: "IN Qty", value: (row) => Number(row.inQty || 0) },
          { label: "OUT Qty", value: (row) => Number(row.outQty || 0) },
          { label: "Adjust Qty", value: (row) => Number(row.adjustQty || 0) },
          { label: "Net Movement", value: (row) => Number(row.netMovement || 0) },
          { label: "Return Qty", value: (row) => Number(row.returnQty || 0) },
        ],
        exportRows: movementTrendRows,
      },
    };

    return payloadMap[activeSubReport] || payloadMap["best-sellers"];
  }, [activeSubReport, brandPerformanceRows, categoryPerformanceRows, movementTrendRows, sortedByRevenue]);

  useEffect(() => {
    if (!onPrepared) return;
    onPrepared({
      exportColumns: selectedSubReportPayload.exportColumns,
      exportRows: selectedSubReportPayload.exportRows,
    });
  }, [onPrepared, selectedSubReportPayload.exportColumns, selectedSubReportPayload.exportRows]);

  const renderSubReport = () => {
    if (activeSubReport === "best-sellers") {
      return (
        <SectionCard title="Best Sellers" subtitle="Top 20 products by revenue">
          <MiniTable
            columns={[
              { label: "Product", value: "product" },
              { label: "Brand", value: "brand" },
              { label: "Category", value: "category" },
              { label: "Qty Sold", value: (row) => Number(row.qtySold || 0).toLocaleString() },
              { label: "Revenue", value: (row) => money(row.netRevenue) },
              { label: "Margin", value: (row) => `${Number(row.marginPct || 0).toFixed(1)}%` },
            ]}
            rows={sortedByRevenue.slice(0, 20)}
            emptyLabel="No best-seller rows found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "low-performers") {
      return (
        <SectionCard title="Low Performers" subtitle="Bottom 20 by revenue">
          <MiniTable
            columns={[
              { label: "Product", value: "product" },
              { label: "Brand", value: "brand" },
              { label: "Category", value: "category" },
              { label: "Qty Sold", value: (row) => Number(row.qtySold || 0).toLocaleString() },
              { label: "Revenue", value: (row) => money(row.netRevenue) },
              { label: "Stock Left", value: (row) => Number(row.stockLeft || 0).toLocaleString() },
              { label: "Tag", value: (row) => <Badge tone={performanceTone(row.performanceTag)}>{row.performanceTag}</Badge> },
            ]}
            rows={[...sortedByRevenue].reverse().slice(0, 20)}
            emptyLabel="No low-performer rows found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "category-performance") {
      return (
        <SectionCard title="Category Performance">
          <MiniTable
            columns={[
              { label: "Category", value: "category" },
              { label: "Qty Sold", value: (row) => Number(row.qty || 0).toLocaleString() },
              { label: "Revenue", value: (row) => money(row.revenue) },
              { label: "Profit", value: (row) => money(row.profit) },
              { label: "Margin %", value: (row) => (row.revenue > 0 ? `${((row.profit / row.revenue) * 100).toFixed(1)}%` : "0.0%") },
            ]}
            rows={categoryPerformanceRows}
            emptyLabel="No category performance rows found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "brand-performance") {
      return (
        <SectionCard title="Brand Performance">
          <MiniTable
            columns={[
              { label: "Brand", value: "brand" },
              { label: "Qty Sold", value: (row) => Number(row.qty || 0).toLocaleString() },
              { label: "Revenue", value: (row) => money(row.revenue) },
              { label: "Profit", value: (row) => money(row.profit) },
              { label: "Margin %", value: (row) => (row.revenue > 0 ? `${((row.profit / row.revenue) * 100).toFixed(1)}%` : "0.0%") },
            ]}
            rows={brandPerformanceRows}
            emptyLabel="No brand performance rows found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "profit-per-product") {
      return (
        <SectionCard title="Profit per Product">
          <MiniTable
            columns={[
              { label: "Product", value: "product" },
              { label: "Revenue", value: (row) => money(row.netRevenue) },
              { label: "Cost", value: (row) => money(row.netCost) },
              { label: "Profit", value: (row) => money(row.netProfit) },
              { label: "Margin %", value: (row) => `${Number(row.marginPct || 0).toFixed(1)}%` },
              { label: "Elasticity", value: (row) => row.elasticityTag },
            ]}
            rows={sortedByRevenue}
            emptyLabel="No profitability rows."
          />
        </SectionCard>
      );
    }

    return (
      <SectionCard title="Movement Trend" subtitle="Inventory movement, cross-sell, returns, and stock-to-sales signal">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <SectionCard title="Movement Summary">
            <MiniTable
              columns={[
                { label: "Product", value: "product" },
                { label: "IN", value: (row) => Number(row.inQty || 0).toLocaleString() },
                { label: "OUT", value: (row) => Number(row.outQty || 0).toLocaleString() },
                { label: "Adjust", value: (row) => Number(row.adjustQty || 0).toLocaleString() },
                { label: "Net", value: (row) => Number(row.netMovement || 0).toLocaleString() },
              ]}
              rows={movementTrendRows.slice(0, 30)}
              emptyLabel="No movement trend data."
            />
          </SectionCard>

          <SectionCard title="Cross-sell Analysis">
            <MiniTable
              columns={[
                { label: "Product A", value: "productA" },
                { label: "Product B", value: "productB" },
                { label: "Sold Together", value: (row) => Number(row.count || 0).toLocaleString() },
              ]}
              rows={crossSellRows}
              emptyLabel="No cross-sell pairs found."
            />
          </SectionCard>

          <SectionCard title="Return Rate per Product">
            <MiniTable
              columns={[
                { label: "Product", value: "product" },
                { label: "Qty Sold", value: (row) => Number(row.qtySold || 0).toLocaleString() },
                { label: "Returned", value: (row) => Number(row.returnQty || 0).toLocaleString() },
                { label: "Return Rate", value: (row) => `${Number(row.returnRatePct || 0).toFixed(1)}%` },
              ]}
              rows={[...filteredRows].sort((a, b) => b.returnRatePct - a.returnRatePct).slice(0, 20)}
              emptyLabel="No return-rate rows."
            />
          </SectionCard>

          <SectionCard title="Stock-to-Sales Ratio">
            <MiniTable
              columns={[
                { label: "Product", value: "product" },
                { label: "Stock Left", value: (row) => Number(row.stockLeft || 0).toLocaleString() },
                { label: "Qty Sold", value: (row) => Number(row.qtySold || 0).toLocaleString() },
                { label: "Ratio", value: (row) => Number(row.stockToSalesRatio || 0).toFixed(2) },
                {
                  label: "Indicator",
                  value: (row) => (
                    <Badge tone={row.stockRatioStatus === "Overstocked" ? "amber" : row.stockRatioStatus === "Understocked" ? "red" : "green"}>
                      {row.stockRatioStatus}
                    </Badge>
                  ),
                },
              ]}
              rows={[...filteredRows].sort((a, b) => b.stockToSalesRatio - a.stockToSalesRatio).slice(0, 20)}
              emptyLabel="No stock/sales ratio rows."
            />
          </SectionCard>
        </div>
      </SectionCard>
    );
  };

  return (
    <>
      <SectionCard title="Product Performance Filters" subtitle="Date range, category, brand, supplier, and performance status">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2">
          <input
            type="date"
            value={rangeFrom}
            onChange={(event) => setRangeFrom(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          />
          <input
            type="date"
            value={rangeTo}
            onChange={(event) => setRangeTo(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          />
          <Select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">All Categories</option>
            {filterOptions.categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
          <Select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">All Brands</option>
            {filterOptions.brands.map((brand) => (
              <option key={brand} value={brand}>
                {brand}
              </option>
            ))}
          </Select>
          <Select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">All Suppliers</option>
            {filterOptions.suppliers.map((supplierId) => (
              <option key={supplierId} value={supplierId}>
                {suppliersById[supplierId] || (supplierId === "unspecified" ? "Unspecified" : `Supplier #${supplierId}`)}
              </option>
            ))}
          </Select>
          <Select value={performanceStatusFilter} onChange={(event) => setPerformanceStatusFilter(event.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">Performance: All</option>
            <option value="top">Top</option>
            <option value="average">Average</option>
            <option value="low">Low</option>
          </Select>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
        <KpiCard title="Total Products Tracked" value={totalProductsTracked.toLocaleString()} icon={<Boxes size={18} />} />
        <KpiCard title="Best Selling Product" value={bestSellingProduct ? `${bestSellingProduct.product} (${bestSellingProduct.qtySold})` : "-"} icon={<TrendingUp size={18} />} tone="green" />
        <KpiCard title="Highest Revenue Product" value={highestRevenueProduct ? highestRevenueProduct.product : "-"} icon={<DollarSign size={18} />} tone="indigo" />
        <KpiCard title="Highest Margin Product" value={highestMarginProduct ? `${highestMarginProduct.product} (${highestMarginProduct.marginPct.toFixed(1)}%)` : "-"} icon={<Percent size={18} />} tone="sky" />
        <KpiCard title="Lowest Performing Product" value={lowestPerformingProduct ? lowestPerformingProduct.product : "-"} icon={<TrendingDown size={18} />} tone="red" />
        <KpiCard title="Average Product Margin %" value={`${averageProductMarginPct.toFixed(2)}%`} icon={<Gauge size={18} />} tone="amber" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-6" title="Top 10 Products by Revenue" subtitle="Horizontal bar">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={sortedByRevenue.slice(0, 10)} margin={{ left: 20, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="product" width={140} tick={{ fill: "#cbd5e1", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => money(value)} contentStyle={{ background: "#020617", border: "1px solid #334155" }} />
                <Bar dataKey="netRevenue" fill="#38bdf8" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Top 10 by Quantity Sold" subtitle="Horizontal bar">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={sortedByQty.slice(0, 10)} margin={{ left: 20, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="product" width={140} tick={{ fill: "#cbd5e1", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => Number(value || 0).toLocaleString()} contentStyle={{ background: "#020617", border: "1px solid #334155" }} />
                <Bar dataKey="qtySold" fill="#14b8a6" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Category Performance" subtitle="Grouped bar chart">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryPerformanceRows.slice(0, 8)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="category" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} width={84} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                <Tooltip formatter={(value) => Number(value || 0).toLocaleString()} contentStyle={{ background: "#020617", border: "1px solid #334155" }} />
                <Bar dataKey="revenue" fill="#6366f1" radius={[6, 6, 0, 0]} />
                <Bar dataKey="profit" fill="#22c55e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Brand Comparison" subtitle="Pie chart">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={brandPerformanceRows.slice(0, 8)} dataKey="revenue" nameKey="brand" innerRadius={55} outerRadius={90} stroke="none">
                  {brandPerformanceRows.slice(0, 8).map((row, index) => (
                    <Cell key={`${row.brand}-${index}`} fill={BRAND_COLORS[index % BRAND_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => money(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard
          className="xl:col-span-6"
          title="Sales Trend per Product"
          subtitle="Line chart by selected product"
          right={
            <Select
              value={selectedTrendProduct}
              onChange={(event) => setSelectedTrendProduct(event.target.value)}
              className="field !py-1.5 !px-2.5 !text-xs w-52"
            >
              {filteredRows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.product}
                </option>
              ))}
            </Select>
          }
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={salesTrendPerProductRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value, key) => (key === "revenue" ? money(value) : Number(value || 0).toLocaleString())} contentStyle={{ background: "#020617", border: "1px solid #334155" }} />
                <Line type="monotone" dataKey="qty" stroke="#38bdf8" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Margin Distribution" subtitle="Scatter: price vs margin">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" dataKey="price" name="Price" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis type="number" dataKey="marginPct" name="Margin %" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(value, key) => (key === "marginPct" ? `${Number(value || 0).toFixed(1)}%` : money(value))} />
                <Scatter data={marginScatterRows} fill="#f59e0b" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-12" title="Seasonal Trend" subtitle="Multi-month line by top categories">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={seasonalTrendRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} width={84} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                <Tooltip formatter={(value) => money(value)} contentStyle={{ background: "#020617", border: "1px solid #334155" }} />
                {categoryPerformanceRows.slice(0, 4).map((row, index) => (
                  <Line
                    key={row.category}
                    type="monotone"
                    dataKey={row.category}
                    stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                    strokeWidth={2.2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Product Performance Table" subtitle="Deep product-level sales and profitability metrics">
        <MiniTable
          columns={[
            { label: "Product", value: "product" },
            { label: "Brand", value: "brand" },
            { label: "Category", value: "category" },
            { label: "Qty Sold", value: (row) => Number(row.qtySold || 0).toLocaleString() },
            { label: "Revenue", value: (row) => money(row.netRevenue) },
            { label: "Cost", value: (row) => money(row.netCost) },
            { label: "Profit", value: (row) => money(row.netProfit) },
            { label: "Margin %", value: (row) => `${Number(row.marginPct || 0).toFixed(1)}%` },
            { label: "Trend", value: (row) => <MiniSparkline points={row.trendSeries} /> },
            { label: "Stock Left", value: (row) => Number(row.stockLeft || 0).toLocaleString() },
            {
              label: "Performance Tag",
              value: (row) => <Badge tone={performanceTone(row.performanceTag)}>{row.performanceTag}</Badge>,
            },
          ]}
          rows={sortedByRevenue}
          emptyLabel="No product performance rows for selected filters."
        />
      </SectionCard>

      <SectionCard title="Sub-Report Views" subtitle="Specialized product performance cuts">
        <div className="mb-3 flex flex-wrap gap-2">
          {SUB_REPORT_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveSubReport(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                activeSubReport === tab.key
                  ? "bg-indigo-500/25 border border-indigo-500/40 text-indigo-100"
                  : "bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {renderSubReport()}
      </SectionCard>

      <SectionCard title="Extended Product Signals" subtitle="Lifecycle, elasticity, returns, and feedback hook">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <SectionCard title="Lifecycle Stage & Elasticity">
            <MiniTable
              columns={[
                { label: "Product", value: "product" },
                { label: "Lifecycle", value: "lifecycle" },
                { label: "Elasticity", value: "elasticityTag" },
                { label: "Return Rate", value: (row) => `${Number(row.returnRatePct || 0).toFixed(1)}%` },
              ]}
              rows={sortedByRevenue.slice(0, 25)}
              emptyLabel="No lifecycle rows available."
            />
          </SectionCard>

          <SectionCard title="Review / Rating System Hook">
            <MiniTable
              columns={[
                { label: "Product", value: "product" },
                { label: "Rating", value: () => "N/A" },
                { label: "Review Count", value: () => "N/A" },
                { label: "Hook Status", value: () => <Badge tone="indigo">Placeholder</Badge> },
              ]}
              rows={sortedByRevenue.slice(0, 25)}
              emptyLabel="No rows for feedback hook."
            />
          </SectionCard>
        </div>
      </SectionCard>
    </>
  );
}
