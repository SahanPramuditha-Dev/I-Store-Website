import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  Gauge,
  PackageMinus,
  PackageSearch,
  TimerReset,
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
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge, Button, KpiCard, SectionCard, Table, Select } from "../../../components/UI";

const MONEY_LOCALE = "en-LK";
const DEAD_STOCK_DAYS = 90;
const REORDER_LEAD_DAYS = 14;
const DAY_MS = 1000 * 60 * 60 * 24;
const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" });
const STATUS_PIE_COLORS = ["#22c55e", "#f59e0b", "#ef4444"];
const SERIES_COLORS = ["#38bdf8", "#6366f1", "#14b8a6", "#f59e0b", "#f97316", "#a78bfa", "#22c55e"];
const SUB_REPORT_TABS = [
  { key: "valuation", label: "Valuation Report" },
  { key: "low-stock", label: "Low Stock Report" },
  { key: "out-of-stock", label: "Out of Stock Report" },
  { key: "dead-stock", label: "Dead Stock Report" },
  { key: "fast-moving", label: "Fast-Moving Items" },
  { key: "movement-history", label: "Stock Movement History" },
  { key: "spare-parts", label: "Spare Parts Usage" },
  { key: "supplier-purchases", label: "Supplier Purchases" },
  { key: "stock-aging", label: "Stock Aging Report" },
  { key: "shrinkage", label: "Shrinkage Report" },
  { key: "reorder", label: "Reorder Suggestions" },
  { key: "po-history", label: "Purchase Order History" },
  { key: "stock-returns", label: "Stock Return Report" },
  { key: "abc", label: "ABC Analysis" },
  { key: "forecast", label: "Inventory Forecast" },
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
  const parsed = toDate(`${value}T00:00:00`);
  if (!parsed) return null;
  if (!endExclusive) return parsed;
  const copy = new Date(parsed);
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

function daysSince(value, base = new Date()) {
  const date = toDate(value);
  if (!date) return null;
  return Math.max(0, Math.floor((base - date) / DAY_MS));
}

function movementTypeLabel(movementType) {
  const type = String(movementType || "").toUpperCase();
  if (type === "SALE" || type === "OUT") return "Sale";
  if (type === "IN") return "Purchase";
  if (type === "ADJUSTMENT") return "Adjustment";
  if (type === "RETURN" || type === "VOID_RETURN") return "Return";
  if (type === "REPAIR_CONSUME") return "Repair Usage";
  return movementType || "Unknown";
}

function statusTone(status) {
  if (status === "Out of Stock") return "red";
  if (status === "Low Stock") return "amber";
  if (status === "Dead Stock") return "indigo";
  return "green";
}

function buildReference(row) {
  if (row.reference_type && row.reference_id !== undefined && row.reference_id !== null) {
    return `${String(row.reference_type).toUpperCase()} #${row.reference_id}`;
  }
  if (row.reference_type) return String(row.reference_type).toUpperCase();
  return row.note || "-";
}

function classifyShrinkage(note = "") {
  const value = String(note).toLowerCase();
  if (value.includes("damage")) return "Damage";
  if (value.includes("theft") || value.includes("stolen")) return "Theft";
  if (value.includes("loss") || value.includes("missing")) return "Loss";
  return "Unexplained";
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

export default function InventoryReportsContent({
  inventoryRows,
  movementRows,
  suppliersRows,
  purchaseRows,
  repairRows,
  salesRows,
  dateFrom,
  dateTo,
  query,
  onPrepared,
}) {
  const navigate = useNavigate();
  const [activeSubReport, setActiveSubReport] = useState("valuation");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [stockStatusFilter, setStockStatusFilter] = useState("all");
  const [movementFrom, setMovementFrom] = useState(dateFrom || "");
  const [movementTo, setMovementTo] = useState(dateTo || "");

  useEffect(() => {
    setMovementFrom(dateFrom || "");
    setMovementTo(dateTo || "");
  }, [dateFrom, dateTo]);

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

  const inventoryById = useMemo(
    () => Object.fromEntries((inventoryRows || []).map((item) => [String(item.id), item])),
    [inventoryRows],
  );

  const normalizedQuery = (query || "").trim().toLowerCase();

  const filterOptions = useMemo(() => {
    const categories = new Set();
    const brands = new Set();
    const suppliers = new Set();
    (inventoryRows || []).forEach((item) => {
      categories.add(item.category || "Uncategorized");
      brands.add(item.brand || "Unbranded");
      suppliers.add(String(item.supplier_id || "unspecified"));
    });
    return {
      categories: [...categories].sort((a, b) => a.localeCompare(b)),
      brands: [...brands].sort((a, b) => a.localeCompare(b)),
      suppliers: [...suppliers].sort((a, b) => {
        const aLabel = suppliersById[a] || (a === "unspecified" ? "Unspecified" : `Supplier #${a}`);
        const bLabel = suppliersById[b] || (b === "unspecified" ? "Unspecified" : `Supplier #${b}`);
        return aLabel.localeCompare(bLabel);
      }),
    };
  }, [inventoryRows, suppliersById]);

  const movementRangeStart = useMemo(() => parseDateInput(movementFrom), [movementFrom]);
  const movementRangeEnd = useMemo(() => parseDateInput(movementTo, true), [movementTo]);
  const movementRangeDays = useMemo(() => {
    if (movementRangeStart && movementRangeEnd) {
      return Math.max(1, Math.round((movementRangeEnd - movementRangeStart) / DAY_MS));
    }
    return 30;
  }, [movementRangeEnd, movementRangeStart]);

  const movementRowsInRange = useMemo(
    () =>
      (movementRows || []).filter((row) => {
        if (!movementRangeStart && !movementRangeEnd) return true;
        return inDateRange(row.created_at, movementRangeStart, movementRangeEnd);
      }),
    [movementRows, movementRangeEnd, movementRangeStart],
  );

  const usageStats = useMemo(() => {
    const saleByItem = {};
    const reorderByItem = {};
    const inboundByItem = {};
    const movementByItem = {};
    const monthlyTurnoverMap = {};

    (movementRows || []).forEach((row) => {
      const itemId = String(row.item_id || "");
      if (!itemId) return;
      const type = String(row.movement_type || "").toUpperCase();
      const quantity = Number(row.quantity || 0);
      const existing = movementByItem[itemId] || {
        lastSaleAt: null,
        lastInboundAt: null,
        lastReorderAt: null,
        soldQtyAllTime: 0,
      };

      if (["SALE", "OUT", "REPAIR_CONSUME"].includes(type)) {
        existing.soldQtyAllTime += Math.abs(quantity);
        if (!existing.lastSaleAt || new Date(row.created_at) > new Date(existing.lastSaleAt)) {
          existing.lastSaleAt = row.created_at;
        }
      }

      if (quantity > 0 || type === "IN" || type === "RETURN" || type === "VOID_RETURN") {
        if (!existing.lastInboundAt || new Date(row.created_at) > new Date(existing.lastInboundAt)) {
          existing.lastInboundAt = row.created_at;
        }
        if (type === "IN") {
          if (!existing.lastReorderAt || new Date(row.created_at) > new Date(existing.lastReorderAt)) {
            existing.lastReorderAt = row.created_at;
          }
        }
      }

      movementByItem[itemId] = existing;
    });

    movementRowsInRange.forEach((row) => {
      const itemId = String(row.item_id || "");
      if (!itemId) return;
      const type = String(row.movement_type || "").toUpperCase();
      const quantity = Number(row.quantity || 0);
      const item = inventoryById[itemId];
      const month = toMonthKey(row.created_at);

      if (["SALE", "OUT", "REPAIR_CONSUME"].includes(type)) {
        saleByItem[itemId] = (saleByItem[itemId] || 0) + Math.abs(quantity);
        if (month) {
          if (!monthlyTurnoverMap[month]) monthlyTurnoverMap[month] = { month, outQty: 0, outCost: 0 };
          monthlyTurnoverMap[month].outQty += Math.abs(quantity);
          monthlyTurnoverMap[month].outCost += Math.abs(quantity) * Number(item?.cost_price || 0);
        }
      }

      if (type === "IN" || quantity > 0) {
        reorderByItem[itemId] = row.created_at;
      }
      if (type === "IN" || type === "RETURN" || type === "VOID_RETURN" || quantity > 0) {
        inboundByItem[itemId] = row.created_at;
      }
    });

    return {
      saleByItem,
      reorderByItem,
      inboundByItem,
      movementByItem,
      monthlyTurnoverRows: Object.values(monthlyTurnoverMap).sort((a, b) => a.month.localeCompare(b.month)),
    };
  }, [inventoryById, movementRows, movementRowsInRange]);

  const sparePartsUsageRows = useMemo(() => {
    const partMap = {};
    (repairRows || []).forEach((repair) => {
      if (!inDateRange(repair.created_at, movementRangeStart, movementRangeEnd)) return;
      (repair.parts_lines || []).forEach((line) => {
        const key = String(line.part_id || line.part_name || "Unknown Part");
        if (!partMap[key]) {
          partMap[key] = {
            partId: key,
            part: line.part_name || "Unknown Part",
            qty: 0,
            unitCost: Number(line.unit_cost || 0),
            totalCost: 0,
            supplier: line.supplier || "Unknown",
          };
        }
        partMap[key].qty += Number(line.quantity || 0);
        partMap[key].totalCost += Number(line.quantity || 0) * Number(line.unit_cost || 0);
      });
    });
    return Object.values(partMap).sort((a, b) => b.qty - a.qty);
  }, [movementRangeEnd, movementRangeStart, repairRows]);

  const stockAgeRowsRaw = useMemo(
    () =>
      (inventoryRows || []).map((item) => {
        const usage = usageStats.movementByItem[String(item.id)] || {};
        const lastInboundAt = usage.lastInboundAt || usageStats.inboundByItem[String(item.id)] || null;
        const ageDays = daysSince(lastInboundAt);
        const qty = Number(item.quantity || 0);
        const threshold = Number(item.low_stock_threshold || 5);
        const lastSaleAt = usage.lastSaleAt || null;
        const daysSinceSale = daysSince(lastSaleAt);
        const isDead = qty > 0 && ((daysSinceSale !== null && daysSinceSale >= DEAD_STOCK_DAYS) || (daysSinceSale === null && (ageDays || 0) >= DEAD_STOCK_DAYS));
        const status = qty <= 0 ? "Out of Stock" : qty <= threshold ? "Low Stock" : "In Stock";
        return {
          ...item,
          supplier_name: suppliersById[String(item.supplier_id)] || "Unspecified",
          qty,
          threshold,
          total_value: qty * Number(item.cost_price || 0),
          margin_pct:
            Number(item.sale_price || 0) > 0
              ? ((Number(item.sale_price || 0) - Number(item.cost_price || 0)) / Number(item.sale_price || 0)) * 100
              : 0,
          status,
          is_dead: isDead,
          stock_age_days: ageDays,
          last_sale_at: lastSaleAt,
          days_since_last_sale: daysSinceSale,
          last_reorder_at: usage.lastReorderAt || usageStats.reorderByItem[String(item.id)] || null,
          days_since_last_reorder: daysSince(usage.lastReorderAt || usageStats.reorderByItem[String(item.id)] || null),
        };
      }),
    [inventoryRows, suppliersById, usageStats.inboundByItem, usageStats.movementByItem, usageStats.reorderByItem],
  );

  const filteredInventoryRows = useMemo(() => {
    return stockAgeRowsRaw.filter((item) => {
      const category = item.category || "Uncategorized";
      const brand = item.brand || "Unbranded";
      const supplierKey = String(item.supplier_id || "unspecified");
      if (categoryFilter !== "all" && category !== categoryFilter) return false;
      if (brandFilter !== "all" && brand !== brandFilter) return false;
      if (supplierFilter !== "all" && supplierKey !== supplierFilter) return false;

      if (stockStatusFilter !== "all") {
        if (stockStatusFilter === "in" && item.status !== "In Stock") return false;
        if (stockStatusFilter === "low" && item.status !== "Low Stock") return false;
        if (stockStatusFilter === "out" && item.status !== "Out of Stock") return false;
        if (stockStatusFilter === "dead" && !item.is_dead) return false;
      }

      if (!normalizedQuery) return true;
      const hay = `${item.name || ""} ${item.category || ""} ${item.brand || ""} ${item.supplier_name || ""}`.toLowerCase();
      return hay.includes(normalizedQuery);
    });
  }, [brandFilter, categoryFilter, normalizedQuery, stockStatusFilter, stockAgeRowsRaw, supplierFilter]);

  const totalInventoryValue = useMemo(
    () => filteredInventoryRows.reduce((sum, item) => sum + Number(item.total_value || 0), 0),
    [filteredInventoryRows],
  );

  const totalUnitsInStock = useMemo(
    () => filteredInventoryRows.reduce((sum, item) => sum + Number(item.qty || 0), 0),
    [filteredInventoryRows],
  );

  const lowStockRows = useMemo(
    () =>
      filteredInventoryRows
        .filter((item) => item.status === "Low Stock")
        .sort((a, b) => a.qty - b.qty),
    [filteredInventoryRows],
  );

  const outOfStockRows = useMemo(
    () =>
      filteredInventoryRows
        .filter((item) => item.status === "Out of Stock")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [filteredInventoryRows],
  );

  const deadStockRows = useMemo(
    () =>
      filteredInventoryRows
        .filter((item) => item.is_dead)
        .map((item) => ({
          ...item,
          value_locked: Number(item.qty || 0) * Number(item.cost_price || 0),
          recommended_action:
            Number(item.days_since_last_sale || 0) >= 180
              ? "Clearance or supplier return"
              : "Bundle / promotional discount",
        }))
        .sort((a, b) => b.value_locked - a.value_locked),
    [filteredInventoryRows],
  );

  const fastMovingRows = useMemo(() => {
    const rows = Object.entries(usageStats.saleByItem)
      .map(([itemId, soldQty]) => {
        const item = inventoryById[itemId];
        return {
          item_id: itemId,
          product: item?.name || `Item #${itemId}`,
          category: item?.category || "Uncategorized",
          brand: item?.brand || "Unbranded",
          sold_qty: Number(soldQty || 0),
          stock_qty: Number(item?.quantity || 0),
          est_revenue: Number(soldQty || 0) * Number(item?.sale_price || 0),
        };
      })
      .filter((row) => {
        const category = row.category || "Uncategorized";
        const brand = row.brand || "Unbranded";
        const item = inventoryById[row.item_id];
        const supplierKey = String(item?.supplier_id || "unspecified");
        if (categoryFilter !== "all" && category !== categoryFilter) return false;
        if (brandFilter !== "all" && brand !== brandFilter) return false;
        if (supplierFilter !== "all" && supplierKey !== supplierFilter) return false;
        if (!normalizedQuery) return true;
        const hay = `${row.product} ${row.category} ${row.brand}`.toLowerCase();
        return hay.includes(normalizedQuery);
      })
      .sort((a, b) => b.sold_qty - a.sold_qty);
    return rows;
  }, [brandFilter, categoryFilter, inventoryById, normalizedQuery, supplierFilter, usageStats.saleByItem]);

  const avgStockAge = useMemo(() => {
    const rows = filteredInventoryRows.filter(
      (item) => item.qty > 0 && item.stock_age_days !== null && item.stock_age_days !== undefined,
    );
    if (rows.length === 0) return 0;
    return rows.reduce((sum, row) => sum + Number(row.stock_age_days || 0), 0) / rows.length;
  }, [filteredInventoryRows]);

  const stockStatusDistribution = useMemo(() => {
    const counts = { in: 0, low: 0, out: 0 };
    filteredInventoryRows.forEach((item) => {
      if (item.status === "In Stock") counts.in += 1;
      else if (item.status === "Low Stock") counts.low += 1;
      else counts.out += 1;
    });
    return [
      { name: "In Stock", value: counts.in },
      { name: "Low Stock", value: counts.low },
      { name: "Out of Stock", value: counts.out },
    ];
  }, [filteredInventoryRows]);

  const categoryValueChartRows = useMemo(() => {
    const grouped = {};
    filteredInventoryRows.forEach((item) => {
      const key = item.category || "Uncategorized";
      if (!grouped[key]) grouped[key] = { category: key, value: 0, qty: 0 };
      grouped[key].value += Number(item.total_value || 0);
      grouped[key].qty += Number(item.qty || 0);
    });
    return Object.values(grouped)
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
  }, [filteredInventoryRows]);

  const turnoverTrendRows = useMemo(() => {
    return usageStats.monthlyTurnoverRows.map((row) => ({
      ...row,
      label: MONTH_LABEL.format(new Date(`${row.month}-01T00:00:00`)),
      turnover_ratio: totalInventoryValue > 0 ? Number((row.outCost / totalInventoryValue).toFixed(3)) : 0,
    }));
  }, [totalInventoryValue, usageStats.monthlyTurnoverRows]);

  const supplierDistributionRows = useMemo(() => {
    const grouped = {};
    filteredInventoryRows.forEach((item) => {
      const key = item.supplier_name || "Unspecified";
      if (!grouped[key]) grouped[key] = { supplier: key, value: 0, qty: 0 };
      grouped[key].value += Number(item.total_value || 0);
      grouped[key].qty += Number(item.qty || 0);
    });
    return Object.values(grouped)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filteredInventoryRows]);

  const movementLogRows = useMemo(() => {
    const sorted = [...movementRowsInRange].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const balanceMap = {};
    return sorted.map((row) => {
      const itemId = String(row.item_id || "");
      const currentQty = Number(inventoryById[itemId]?.quantity || 0);
      if (balanceMap[itemId] === undefined) balanceMap[itemId] = currentQty;
      const quantityChange = Number(row.quantity || 0);
      const balanceAfter = balanceMap[itemId];
      balanceMap[itemId] = balanceAfter - quantityChange;
      return {
        id: row.id,
        date: row.created_at,
        product: row.item_name || inventoryById[itemId]?.name || `Item #${itemId}`,
        type: movementTypeLabel(row.movement_type),
        qty_change: quantityChange,
        balance: balanceAfter,
        reference: buildReference(row),
        reference_type: row.reference_type,
        reference_id: row.reference_id,
        note: row.note || "",
        user: "System",
      };
    });
  }, [inventoryById, movementRowsInRange]);

  const shrinkageRows = useMemo(() => {
    return movementLogRows
      .filter((row) => {
        const movement = movementRowsInRange.find((m) => m.id === row.id);
        const type = String(movement?.movement_type || "").toUpperCase();
        const qty = Number(movement?.quantity || 0);
        const stockTakeAdjust = String(movement?.reference_type || "").toLowerCase() === "stock_take";
        return qty < 0 && (type === "ADJUSTMENT" || stockTakeAdjust);
      })
      .map((row) => {
        const item = filteredInventoryRows.find((entry) => entry.name === row.product);
        const itemCost = Number(item?.cost_price || 0);
        const qtyLoss = Math.abs(Number(row.qty_change || 0));
        return {
          ...row,
          discrepancy_type: classifyShrinkage(row.note),
          qty_loss: qtyLoss,
          estimated_loss: qtyLoss * itemCost,
        };
      })
      .sort((a, b) => b.estimated_loss - a.estimated_loss);
  }, [filteredInventoryRows, movementLogRows, movementRowsInRange]);

  const reorderSuggestionRows = useMemo(() => {
    return filteredInventoryRows
      .map((item) => {
        const soldQty = Number(usageStats.saleByItem[String(item.id)] || 0);
        const dailyVelocity = soldQty / movementRangeDays;
        const targetStock = Math.ceil(dailyVelocity * REORDER_LEAD_DAYS + Number(item.threshold || 5));
        const reorderQty = Math.max(0, targetStock - Number(item.qty || 0));
        const stockoutDays = dailyVelocity > 0 ? Number(item.qty || 0) / dailyVelocity : null;
        const forecastDate =
          stockoutDays === null
            ? null
            : new Date(Date.now() + Math.max(0, Math.round(stockoutDays)) * DAY_MS).toISOString();
        const urgency =
          stockoutDays === null
            ? "Stable"
            : stockoutDays <= 7
              ? "Critical"
              : stockoutDays <= 14
                ? "High"
                : stockoutDays <= 30
                  ? "Medium"
                  : "Low";
        return {
          ...item,
          sold_qty: soldQty,
          daily_velocity: dailyVelocity,
          suggested_qty: reorderQty,
          target_stock: targetStock,
          stockout_days: stockoutDays,
          predicted_stockout_at: forecastDate,
          urgency,
        };
      })
      .filter((item) => item.suggested_qty > 0)
      .sort((a, b) => b.suggested_qty - a.suggested_qty);
  }, [filteredInventoryRows, movementRangeDays, usageStats.saleByItem]);

  const purchaseOrderHistoryRows = useMemo(() => {
    const movementByReference = {};
    movementRowsInRange.forEach((movement) => {
      const refType = String(movement.reference_type || "").toLowerCase();
      if (refType !== "purchase_order") return;
      const key = String(movement.reference_id || "");
      if (!key) return;
      if (!movementByReference[key]) {
        movementByReference[key] = { qty: 0, lines: 0 };
      }
      movementByReference[key].qty += Math.max(0, Number(movement.quantity || 0));
      movementByReference[key].lines += 1;
    });

    return (purchaseRows || [])
      .filter((po) => inDateRange(po.created_at, movementRangeStart, movementRangeEnd))
      .map((po) => {
        const linked = movementByReference[String(po.id)] || { qty: 0, lines: 0 };
        return {
          po_id: po.id,
          po_number: po.po_number || `PO-${po.id}`,
          supplier: suppliersById[String(po.supplier_id)] || `Supplier #${po.supplier_id}`,
          status: po.status || "Unknown",
          total_cost: Number(po.total_cost || 0),
          created_at: po.created_at,
          received_at: po.received_at,
          linked_qty: linked.qty,
          linked_lines: linked.lines,
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [movementRangeEnd, movementRangeStart, movementRowsInRange, purchaseRows, suppliersById]);

  const stockReturnRows = useMemo(() => {
    return movementRowsInRange
      .filter((movement) => {
        const type = String(movement.movement_type || "").toUpperCase();
        const note = String(movement.note || "").toLowerCase();
        return type === "RETURN" || type === "VOID_RETURN" || note.includes("return");
      })
      .map((movement) => ({
        id: movement.id,
        date: movement.created_at,
        product: movement.item_name || `Item #${movement.item_id}`,
        type: movementTypeLabel(movement.movement_type),
        qty: Number(movement.quantity || 0),
        reference: buildReference(movement),
        destination: String(movement.note || "").toLowerCase().includes("supplier")
          ? "Supplier"
          : "Customer / Invoice Return",
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [movementRowsInRange]);

  const abcRows = useMemo(() => {
    const ranked = [...filteredInventoryRows].sort((a, b) => b.total_value - a.total_value);
    const total = ranked.reduce((sum, item) => sum + Number(item.total_value || 0), 0) || 1;
    let cumulative = 0;
    return ranked.map((item) => {
      const share = Number(item.total_value || 0) / total;
      cumulative += share;
      const grade = cumulative <= 0.7 ? "A" : cumulative <= 0.9 ? "B" : "C";
      return {
        ...item,
        value_share_pct: share * 100,
        cumulative_share_pct: cumulative * 100,
        abc_grade: grade,
      };
    });
  }, [filteredInventoryRows]);

  const inventoryForecastRows = useMemo(() => {
    return filteredInventoryRows
      .map((item) => {
        const soldQty = Number(usageStats.saleByItem[String(item.id)] || 0);
        const dailyVelocity = soldQty / movementRangeDays;
        const daysToStockout = dailyVelocity > 0 ? Number(item.qty || 0) / dailyVelocity : null;
        const predictedDate =
          daysToStockout === null
            ? null
            : new Date(Date.now() + Math.max(0, Math.round(daysToStockout)) * DAY_MS).toISOString();
        const risk =
          daysToStockout === null
            ? "Low"
            : daysToStockout <= 7
              ? "Critical"
              : daysToStockout <= 14
                ? "High"
                : daysToStockout <= 30
                  ? "Medium"
                  : "Low";
        return {
          ...item,
          daily_velocity: dailyVelocity,
          days_to_stockout: daysToStockout,
          predicted_stockout_at: predictedDate,
          risk,
        };
      })
      .filter((item) => item.daily_velocity > 0)
      .sort((a, b) => (a.days_to_stockout ?? Infinity) - (b.days_to_stockout ?? Infinity));
  }, [filteredInventoryRows, movementRangeDays, usageStats.saleByItem]);

  const supplierPurchasesRows = useMemo(() => {
    const grouped = {};
    purchaseOrderHistoryRows.forEach((row) => {
      if (!grouped[row.supplier]) {
        grouped[row.supplier] = {
          supplier: row.supplier,
          po_count: 0,
          purchase_value: 0,
          received_qty: 0,
          open_count: 0,
        };
      }
      grouped[row.supplier].po_count += 1;
      grouped[row.supplier].purchase_value += Number(row.total_cost || 0);
      grouped[row.supplier].received_qty += Number(row.linked_qty || 0);
      if (String(row.status || "").toLowerCase() !== "received") grouped[row.supplier].open_count += 1;
    });
    return Object.values(grouped).sort((a, b) => b.purchase_value - a.purchase_value);
  }, [purchaseOrderHistoryRows]);

  const selectedSubReportPayload = useMemo(() => {
    const valuationColumns = [
      { label: "Product", value: "name" },
      { label: "Category", value: (row) => row.category || "Uncategorized" },
      { label: "Brand", value: (row) => row.brand || "Unbranded" },
      { label: "Qty", value: (row) => Number(row.qty || 0) },
      { label: "Buy Price", value: (row) => Number(row.cost_price || 0) },
      { label: "Sell Price", value: (row) => Number(row.sale_price || 0) },
      { label: "Total Value", value: (row) => Number(row.total_value || 0) },
      { label: "Margin %", value: (row) => Number((row.margin_pct || 0).toFixed(2)) },
      { label: "Status", value: (row) => (row.is_dead ? "Dead Stock" : row.status) },
    ];

    const lowStockColumns = [
      { label: "Product", value: "name" },
      { label: "Current Qty", value: (row) => Number(row.qty || 0) },
      { label: "Threshold", value: (row) => Number(row.threshold || 0) },
      {
        label: "Days Since Last Reorder",
        value: (row) => (row.days_since_last_reorder === null ? "-" : Number(row.days_since_last_reorder || 0)),
      },
      { label: "Supplier", value: (row) => row.supplier_name || "Unspecified" },
      { label: "Suggested Reorder Qty", value: (row) => Number(reorderSuggestionRows.find((r) => r.id === row.id)?.suggested_qty || 0) },
    ];

    const movementColumns = [
      { label: "Date", value: "date" },
      { label: "Product", value: "product" },
      { label: "Type", value: "type" },
      { label: "Qty Change", value: (row) => Number(row.qty_change || 0) },
      { label: "Balance", value: (row) => Number(row.balance || 0) },
      { label: "Reference", value: "reference" },
      { label: "User", value: "user" },
    ];

    const payloadMap = {
      valuation: {
        exportColumns: valuationColumns,
        exportRows: filteredInventoryRows,
      },
      "low-stock": {
        exportColumns: lowStockColumns,
        exportRows: lowStockRows,
      },
      "out-of-stock": {
        exportColumns: valuationColumns,
        exportRows: outOfStockRows,
      },
      "dead-stock": {
        exportColumns: [
          { label: "Product", value: "name" },
          { label: "Qty", value: (row) => Number(row.qty || 0) },
          { label: "Days Since Last Sale", value: (row) => Number(row.days_since_last_sale || 0) },
          { label: "Value Locked", value: (row) => Number(row.value_locked || 0) },
          { label: "Recommended Action", value: "recommended_action" },
        ],
        exportRows: deadStockRows,
      },
      "fast-moving": {
        exportColumns: [
          { label: "Product", value: "product" },
          { label: "Category", value: "category" },
          { label: "Brand", value: "brand" },
          { label: "Sold Qty", value: (row) => Number(row.sold_qty || 0) },
          { label: "Stock Qty", value: (row) => Number(row.stock_qty || 0) },
          { label: "Est Revenue", value: (row) => Number(row.est_revenue || 0) },
        ],
        exportRows: fastMovingRows,
      },
      "movement-history": {
        exportColumns: movementColumns,
        exportRows: movementLogRows,
      },
      "spare-parts": {
        exportColumns: [
          { label: "Part", value: "part" },
          { label: "Supplier", value: "supplier" },
          { label: "Qty Used", value: (row) => Number(row.qty || 0) },
          { label: "Unit Cost", value: (row) => Number(row.unitCost || 0) },
          { label: "Total Cost", value: (row) => Number(row.totalCost || 0) },
        ],
        exportRows: sparePartsUsageRows,
      },
      "supplier-purchases": {
        exportColumns: [
          { label: "Supplier", value: "supplier" },
          { label: "PO Count", value: (row) => Number(row.po_count || 0) },
          { label: "Purchase Value", value: (row) => Number(row.purchase_value || 0) },
          { label: "Received Qty", value: (row) => Number(row.received_qty || 0) },
          { label: "Open POs", value: (row) => Number(row.open_count || 0) },
        ],
        exportRows: supplierPurchasesRows,
      },
      "stock-aging": {
        exportColumns: [
          { label: "Product", value: "name" },
          { label: "Category", value: (row) => row.category || "Uncategorized" },
          { label: "Qty", value: (row) => Number(row.qty || 0) },
          { label: "Stock Age (Days)", value: (row) => (row.stock_age_days === null ? "-" : Number(row.stock_age_days || 0)) },
          { label: "Last Sale", value: (row) => row.last_sale_at || "-" },
          { label: "Status", value: (row) => (row.is_dead ? "Dead Stock" : row.status) },
        ],
        exportRows: filteredInventoryRows,
      },
      shrinkage: {
        exportColumns: [
          { label: "Date", value: "date" },
          { label: "Product", value: "product" },
          { label: "Discrepancy Type", value: "discrepancy_type" },
          { label: "Qty Loss", value: (row) => Number(row.qty_loss || 0) },
          { label: "Estimated Loss", value: (row) => Number(row.estimated_loss || 0) },
          { label: "Reference", value: "reference" },
        ],
        exportRows: shrinkageRows,
      },
      reorder: {
        exportColumns: [
          { label: "Product", value: "name" },
          { label: "Current Qty", value: (row) => Number(row.qty || 0) },
          { label: "Daily Velocity", value: (row) => Number((row.daily_velocity || 0).toFixed(3)) },
          { label: "Suggested Reorder Qty", value: (row) => Number(row.suggested_qty || 0) },
          { label: "Target Stock", value: (row) => Number(row.target_stock || 0) },
          { label: "Urgency", value: "urgency" },
        ],
        exportRows: reorderSuggestionRows,
      },
      "po-history": {
        exportColumns: [
          { label: "PO Number", value: "po_number" },
          { label: "Supplier", value: "supplier" },
          { label: "Status", value: "status" },
          { label: "Created At", value: "created_at" },
          { label: "Received At", value: (row) => row.received_at || "-" },
          { label: "Linked Qty", value: (row) => Number(row.linked_qty || 0) },
          { label: "Total Cost", value: (row) => Number(row.total_cost || 0) },
        ],
        exportRows: purchaseOrderHistoryRows,
      },
      "stock-returns": {
        exportColumns: [
          { label: "Date", value: "date" },
          { label: "Product", value: "product" },
          { label: "Type", value: "type" },
          { label: "Qty", value: (row) => Number(row.qty || 0) },
          { label: "Destination", value: "destination" },
          { label: "Reference", value: "reference" },
        ],
        exportRows: stockReturnRows,
      },
      abc: {
        exportColumns: [
          { label: "Product", value: "name" },
          { label: "Category", value: (row) => row.category || "Uncategorized" },
          { label: "Value", value: (row) => Number(row.total_value || 0) },
          { label: "Value Share %", value: (row) => Number((row.value_share_pct || 0).toFixed(2)) },
          { label: "Cumulative %", value: (row) => Number((row.cumulative_share_pct || 0).toFixed(2)) },
          { label: "Class", value: "abc_grade" },
        ],
        exportRows: abcRows,
      },
      forecast: {
        exportColumns: [
          { label: "Product", value: "name" },
          { label: "Current Qty", value: (row) => Number(row.qty || 0) },
          { label: "Daily Velocity", value: (row) => Number((row.daily_velocity || 0).toFixed(3)) },
          { label: "Days To Stockout", value: (row) => (row.days_to_stockout === null ? "-" : Number(row.days_to_stockout.toFixed(1))) },
          { label: "Predicted Stockout", value: (row) => row.predicted_stockout_at || "-" },
          { label: "Risk", value: "risk" },
        ],
        exportRows: inventoryForecastRows,
      },
    };

    return payloadMap[activeSubReport] || payloadMap.valuation;
  }, [
    abcRows,
    activeSubReport,
    deadStockRows,
    fastMovingRows,
    filteredInventoryRows,
    inventoryForecastRows,
    lowStockRows,
    movementLogRows,
    outOfStockRows,
    purchaseOrderHistoryRows,
    reorderSuggestionRows,
    shrinkageRows,
    sparePartsUsageRows,
    stockReturnRows,
    supplierPurchasesRows,
  ]);

  useEffect(() => {
    if (!onPrepared) return;
    onPrepared({
      exportColumns: selectedSubReportPayload.exportColumns,
      exportRows: selectedSubReportPayload.exportRows,
    });
  }, [onPrepared, selectedSubReportPayload.exportColumns, selectedSubReportPayload.exportRows]);

  const renderSubReportContent = () => {
    if (activeSubReport === "valuation") {
      return (
        <SectionCard title="Valuation Report" subtitle="Full inventory value breakdown">
          <MiniTable
            columns={[
              { label: "Product", value: "name" },
              { label: "Category", value: (row) => row.category || "Uncategorized" },
              { label: "Brand", value: (row) => row.brand || "Unbranded" },
              { label: "Qty", value: (row) => Number(row.qty || 0).toLocaleString() },
              { label: "Buy Price", value: (row) => money(row.cost_price) },
              { label: "Sell Price", value: (row) => money(row.sale_price) },
              { label: "Total Value", value: (row) => money(row.total_value) },
              { label: "Margin %", value: (row) => `${Number(row.margin_pct || 0).toFixed(1)}%` },
              {
                label: "Status",
                value: (row) => (
                  <Badge tone={statusTone(row.is_dead ? "Dead Stock" : row.status)}>
                    {row.is_dead ? "Dead Stock" : row.status}
                  </Badge>
                ),
              },
            ]}
            rows={filteredInventoryRows}
            emptyLabel="No inventory rows available for valuation."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "low-stock") {
      return (
        <SectionCard title="Low Stock Report" subtitle="Items that require immediate reorder decisions">
          <MiniTable
            columns={[
              { label: "Product", value: "name" },
              { label: "Current Qty", value: (row) => Number(row.qty || 0).toLocaleString() },
              { label: "Threshold", value: (row) => Number(row.threshold || 0).toLocaleString() },
              {
                label: "Days Since Last Reorder",
                value: (row) => (row.days_since_last_reorder === null ? "-" : row.days_since_last_reorder.toLocaleString()),
              },
              { label: "Supplier", value: (row) => row.supplier_name || "Unspecified" },
              {
                label: "Action",
                value: (row) => (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => navigate("/purchase")}
                    >
                      Reorder
                    </Button>
                    <span className="text-xs text-slate-400">
                      Suggest: {Number(reorderSuggestionRows.find((entry) => entry.id === row.id)?.suggested_qty || 0)}
                    </span>
                  </div>
                ),
              },
            ]}
            rows={lowStockRows}
            emptyLabel="No low stock items for the selected filters."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "out-of-stock") {
      return (
        <SectionCard title="Out of Stock Report" subtitle="Unavailable SKUs">
          <MiniTable
            columns={[
              { label: "Product", value: "name" },
              { label: "Category", value: (row) => row.category || "Uncategorized" },
              { label: "Brand", value: (row) => row.brand || "Unbranded" },
              { label: "Supplier", value: (row) => row.supplier_name || "Unspecified" },
              { label: "Threshold", value: (row) => Number(row.threshold || 0).toLocaleString() },
              { label: "Suggested Reorder Qty", value: (row) => Number(reorderSuggestionRows.find((entry) => entry.id === row.id)?.suggested_qty || 0).toLocaleString() },
            ]}
            rows={outOfStockRows}
            emptyLabel="No out-of-stock items in this view."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "dead-stock") {
      return (
        <SectionCard title="Dead Stock Report" subtitle={`No sales for ${DEAD_STOCK_DAYS}+ days`}>
          <MiniTable
            columns={[
              { label: "Product", value: "name" },
              { label: "Qty", value: (row) => Number(row.qty || 0).toLocaleString() },
              { label: "Days Since Last Sale", value: (row) => Number(row.days_since_last_sale || 0).toLocaleString() },
              { label: "Value Locked", value: (row) => money(row.value_locked) },
              { label: "Recommended Action", value: "recommended_action" },
            ]}
            rows={deadStockRows}
            emptyLabel="No dead stock detected."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "fast-moving") {
      return (
        <SectionCard title="Fast-Moving Items" subtitle="Top items by movement velocity in selected movement range">
          <MiniTable
            columns={[
              { label: "Product", value: "product" },
              { label: "Category", value: "category" },
              { label: "Brand", value: "brand" },
              { label: "Sold Qty", value: (row) => Number(row.sold_qty || 0).toLocaleString() },
              { label: "Current Stock", value: (row) => Number(row.stock_qty || 0).toLocaleString() },
              { label: "Estimated Revenue", value: (row) => money(row.est_revenue) },
            ]}
            rows={fastMovingRows}
            emptyLabel="No fast-moving records found for the selected range."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "movement-history") {
      return (
        <SectionCard title="Stock Movement History" subtitle="Date, quantity delta, running balance, and reference tracking">
          <MiniTable
            columns={[
              { label: "Date", value: (row) => new Date(row.date).toLocaleString() },
              { label: "Product", value: "product" },
              { label: "Type", value: "type" },
              {
                label: "Qty Change",
                value: (row) => (
                  <span className={Number(row.qty_change || 0) >= 0 ? "text-emerald-300" : "text-rose-300"}>
                    {Number(row.qty_change || 0) >= 0 ? "+" : ""}
                    {Number(row.qty_change || 0).toLocaleString()}
                  </span>
                ),
              },
              { label: "Balance", value: (row) => Number(row.balance || 0).toLocaleString() },
              { label: "Reference", value: "reference" },
              { label: "User", value: "user" },
            ]}
            rows={movementLogRows}
            emptyLabel="No movement records found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "spare-parts") {
      return (
        <SectionCard title="Spare Parts Usage" subtitle="Parts consumed in repair jobs">
          <MiniTable
            columns={[
              { label: "Part", value: "part" },
              { label: "Supplier", value: "supplier" },
              { label: "Qty Used", value: (row) => Number(row.qty || 0).toLocaleString() },
              { label: "Unit Cost", value: (row) => money(row.unitCost) },
              { label: "Total Cost", value: (row) => money(row.totalCost) },
            ]}
            rows={sparePartsUsageRows}
            emptyLabel="No spare parts usage found in selected range."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "supplier-purchases") {
      return (
        <SectionCard title="Supplier Purchases" subtitle="Stock received and PO footprint by supplier">
          <MiniTable
            columns={[
              { label: "Supplier", value: "supplier" },
              { label: "PO Count", value: (row) => Number(row.po_count || 0).toLocaleString() },
              { label: "Purchase Value", value: (row) => money(row.purchase_value) },
              { label: "Received Qty", value: (row) => Number(row.received_qty || 0).toLocaleString() },
              { label: "Open POs", value: (row) => Number(row.open_count || 0).toLocaleString() },
            ]}
            rows={supplierPurchasesRows}
            emptyLabel="No supplier purchases in selected range."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "stock-aging") {
      return (
        <SectionCard title="Stock Aging Report" subtitle="How long each item has been sitting">
          <MiniTable
            columns={[
              { label: "Product", value: "name" },
              { label: "Category", value: (row) => row.category || "Uncategorized" },
              { label: "Qty", value: (row) => Number(row.qty || 0).toLocaleString() },
              {
                label: "Stock Age (Days)",
                value: (row) => (row.stock_age_days === null ? "-" : Number(row.stock_age_days || 0).toLocaleString()),
              },
              {
                label: "Last Sale",
                value: (row) => (row.last_sale_at ? new Date(row.last_sale_at).toLocaleDateString() : "Never"),
              },
              {
                label: "Status",
                value: (row) => (
                  <Badge tone={statusTone(row.is_dead ? "Dead Stock" : row.status)}>
                    {row.is_dead ? "Dead Stock" : row.status}
                  </Badge>
                ),
              },
            ]}
            rows={[...filteredInventoryRows].sort(
              (a, b) => Number(b.stock_age_days || 0) - Number(a.stock_age_days || 0),
            )}
            emptyLabel="No stock aging data."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "shrinkage") {
      return (
        <SectionCard title="Shrinkage Report" subtitle="Stock discrepancies, likely loss/damage/theft adjustments">
          <MiniTable
            columns={[
              { label: "Date", value: (row) => new Date(row.date).toLocaleString() },
              { label: "Product", value: "product" },
              { label: "Discrepancy", value: "discrepancy_type" },
              { label: "Qty Loss", value: (row) => Number(row.qty_loss || 0).toLocaleString() },
              { label: "Estimated Loss", value: (row) => money(row.estimated_loss) },
              { label: "Reference", value: "reference" },
            ]}
            rows={shrinkageRows}
            emptyLabel="No shrinkage adjustments found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "reorder") {
      return (
        <SectionCard title="Reorder Suggestion Engine" subtitle={`Auto-suggested reorder quantities (lead time ${REORDER_LEAD_DAYS} days)`}>
          <MiniTable
            columns={[
              { label: "Product", value: "name" },
              { label: "Current Qty", value: (row) => Number(row.qty || 0).toLocaleString() },
              { label: "Daily Velocity", value: (row) => Number(row.daily_velocity || 0).toFixed(3) },
              { label: "Suggested Qty", value: (row) => Number(row.suggested_qty || 0).toLocaleString() },
              { label: "Target Stock", value: (row) => Number(row.target_stock || 0).toLocaleString() },
              { label: "Urgency", value: (row) => <Badge tone={row.urgency === "Critical" ? "red" : row.urgency === "High" ? "amber" : row.urgency === "Medium" ? "indigo" : "green"}>{row.urgency}</Badge> },
            ]}
            rows={reorderSuggestionRows}
            emptyLabel="No reorder suggestions generated for current filters."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "po-history") {
      return (
        <SectionCard title="Purchase Order History" subtitle="Linked to inventory change records">
          <MiniTable
            columns={[
              { label: "PO Number", value: "po_number" },
              { label: "Supplier", value: "supplier" },
              { label: "Status", value: (row) => <Badge tone={String(row.status || "").toLowerCase() === "received" ? "green" : "amber"}>{row.status}</Badge> },
              { label: "Created", value: (row) => new Date(row.created_at).toLocaleDateString() },
              { label: "Received", value: (row) => (row.received_at ? new Date(row.received_at).toLocaleDateString() : "-") },
              { label: "Linked Qty", value: (row) => Number(row.linked_qty || 0).toLocaleString() },
              { label: "Total Cost", value: (row) => money(row.total_cost) },
            ]}
            rows={purchaseOrderHistoryRows}
            emptyLabel="No purchase order records in selected range."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "stock-returns") {
      return (
        <SectionCard title="Stock Return Report" subtitle="Items returned via stock movement references">
          <MiniTable
            columns={[
              { label: "Date", value: (row) => new Date(row.date).toLocaleString() },
              { label: "Product", value: "product" },
              { label: "Type", value: "type" },
              { label: "Qty", value: (row) => Number(row.qty || 0).toLocaleString() },
              { label: "Destination", value: "destination" },
              { label: "Reference", value: "reference" },
            ]}
            rows={stockReturnRows}
            emptyLabel="No return movements logged."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "abc") {
      return (
        <SectionCard title="ABC Analysis" subtitle="A high value, B medium value, C low value classification">
          <MiniTable
            columns={[
              { label: "Product", value: "name" },
              { label: "Category", value: (row) => row.category || "Uncategorized" },
              { label: "Inventory Value", value: (row) => money(row.total_value) },
              { label: "Value Share", value: (row) => `${Number(row.value_share_pct || 0).toFixed(2)}%` },
              { label: "Cumulative", value: (row) => `${Number(row.cumulative_share_pct || 0).toFixed(2)}%` },
              { label: "Class", value: (row) => <Badge tone={row.abc_grade === "A" ? "green" : row.abc_grade === "B" ? "amber" : "slate"}>{row.abc_grade}</Badge> },
            ]}
            rows={abcRows}
            emptyLabel="No data available for ABC analysis."
          />
        </SectionCard>
      );
    }

    return (
      <SectionCard title="Inventory Forecast" subtitle="Predicted stock-out dates based on recent sales velocity">
        <MiniTable
          columns={[
            { label: "Product", value: "name" },
            { label: "Current Qty", value: (row) => Number(row.qty || 0).toLocaleString() },
            { label: "Daily Velocity", value: (row) => Number(row.daily_velocity || 0).toFixed(3) },
            {
              label: "Days To Stockout",
              value: (row) => (row.days_to_stockout === null ? "-" : Number(row.days_to_stockout || 0).toFixed(1)),
            },
            {
              label: "Predicted Date",
              value: (row) =>
                row.predicted_stockout_at
                  ? new Date(row.predicted_stockout_at).toLocaleDateString()
                  : "No risk",
            },
            { label: "Risk", value: (row) => <Badge tone={row.risk === "Critical" ? "red" : row.risk === "High" ? "amber" : row.risk === "Medium" ? "indigo" : "green"}>{row.risk}</Badge> },
          ]}
          rows={inventoryForecastRows}
          emptyLabel="No forecast rows found."
        />
      </SectionCard>
    );
  };

  return (
    <>
      <SectionCard title="Inventory Filters" subtitle="Category, brand, supplier, stock status, and movement date filters">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2">
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
            {filterOptions.suppliers.map((supplierKey) => (
              <option key={supplierKey} value={supplierKey}>
                {suppliersById[supplierKey] || (supplierKey === "unspecified" ? "Unspecified" : `Supplier #${supplierKey}`)}
              </option>
            ))}
          </Select>
          <Select value={stockStatusFilter} onChange={(event) => setStockStatusFilter(event.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">All Stock Statuses</option>
            <option value="in">In Stock</option>
            <option value="low">Low Stock</option>
            <option value="out">Out of Stock</option>
            <option value="dead">Dead Stock</option>
          </Select>
          <input
            type="date"
            value={movementFrom}
            onChange={(event) => setMovementFrom(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          />
          <input
            type="date"
            value={movementTo}
            onChange={(event) => setMovementTo(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          />
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard title="Total Inventory Value (LKR)" value={money(totalInventoryValue)} icon={<Boxes size={18} />} />
        <KpiCard title="Total SKUs" value={filteredInventoryRows.length.toLocaleString()} icon={<PackageSearch size={18} />} tone="indigo" />
        <KpiCard title="Low Stock Items Count" value={lowStockRows.length.toLocaleString()} icon={<AlertTriangle size={18} />} tone="amber" />
        <KpiCard title="Out-of-Stock Items Count" value={outOfStockRows.length.toLocaleString()} icon={<PackageMinus size={18} />} tone="red" />
        <KpiCard title="Dead Stock Items Count" value={deadStockRows.length.toLocaleString()} icon={<TimerReset size={18} />} tone="violet" />
        <KpiCard title="Fast-Moving Items Count" value={fastMovingRows.length.toLocaleString()} icon={<TrendingUp size={18} />} tone="green" />
        <KpiCard title="Total Units in Stock" value={totalUnitsInStock.toLocaleString()} icon={<Boxes size={18} />} tone="sky" />
        <KpiCard title="Avg Stock Age (days)" value={avgStockAge.toFixed(1)} icon={<CalendarClock size={18} />} tone="amber" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-8" title="Inventory Value by Category" subtitle="Bar chart">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryValueChartRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="category" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} width={84} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                <Tooltip formatter={(value) => money(value)} contentStyle={{ background: "#020617", border: "1px solid #334155" }} />
                <Bar dataKey="value" fill="#38bdf8" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
        <SectionCard className="xl:col-span-4" title="Stock Status Distribution" subtitle="Doughnut">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stockStatusDistribution} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} stroke="none">
                  {stockStatusDistribution.map((entry, index) => (
                    <Cell key={`${entry.name}-${index}`} fill={STATUS_PIE_COLORS[index % STATUS_PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 text-xs text-slate-300">
            {stockStatusDistribution.map((row, index) => (
              <div key={row.name} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
                <div className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_PIE_COLORS[index % STATUS_PIE_COLORS.length] }} />
                  {row.name}
                </div>
                <span className="font-bold">{Number(row.value || 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Top 10 Fast-Moving Items" subtitle="Horizontal bar">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={fastMovingRows.slice(0, 10)} margin={{ left: 24, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="product" width={135} tick={{ fill: "#cbd5e1", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value, name) => (name === "sold_qty" ? Number(value || 0).toLocaleString() : value)} contentStyle={{ background: "#020617", border: "1px solid #334155" }} />
                <Bar dataKey="sold_qty" fill="#14b8a6" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
        <SectionCard className="xl:col-span-6" title="Inventory Turnover Trend" subtitle="Line chart (monthly)">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={turnoverTrendRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value, name) =>
                    name === "turnover_ratio"
                      ? Number(value || 0).toFixed(3)
                      : Number(value || 0).toLocaleString()
                  }
                  contentStyle={{ background: "#020617", border: "1px solid #334155" }}
                />
                <Line type="monotone" dataKey="turnover_ratio" stroke="#6366f1" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Supplier Stock Distribution" subtitle="Pie">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={supplierDistributionRows} dataKey="value" nameKey="supplier" innerRadius={55} outerRadius={90} stroke="none">
                  {supplierDistributionRows.map((entry, index) => (
                    <Cell key={`${entry.supplier}-${index}`} fill={SERIES_COLORS[index % SERIES_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => money(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
        <SectionCard className="xl:col-span-6" title="Spare Parts Usage Rate" subtitle="Bar (repair parts)">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sparePartsUsageRows.slice(0, 10)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="part" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => Number(value || 0).toLocaleString()} />
                <Bar dataKey="qty" fill="#f59e0b" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-12" title="Inventory Valuation Table" subtitle="Product, pricing, value, and margin visibility">
          <MiniTable
            columns={[
              { label: "Product", value: "name" },
              { label: "Category", value: (row) => row.category || "Uncategorized" },
              { label: "Brand", value: (row) => row.brand || "Unbranded" },
              { label: "Qty", value: (row) => Number(row.qty || 0).toLocaleString() },
              { label: "Buy Price", value: (row) => money(row.cost_price) },
              { label: "Sell Price", value: (row) => money(row.sale_price) },
              { label: "Total Value", value: (row) => money(row.total_value) },
              { label: "Margin %", value: (row) => `${Number(row.margin_pct || 0).toFixed(1)}%` },
              {
                label: "Status",
                value: (row) => (
                  <Badge tone={statusTone(row.is_dead ? "Dead Stock" : row.status)}>
                    {row.is_dead ? "Dead Stock" : row.status}
                  </Badge>
                ),
              },
            ]}
            rows={filteredInventoryRows.slice(0, 80)}
            emptyLabel="No inventory valuation rows for selected filters."
          />
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Low Stock Report" subtitle="Current qty, thresholds, reorder timing">
          <MiniTable
            columns={[
              { label: "Product", value: "name" },
              { label: "Current Qty", value: (row) => Number(row.qty || 0).toLocaleString() },
              { label: "Threshold", value: (row) => Number(row.threshold || 0).toLocaleString() },
              {
                label: "Days Since Last Reorder",
                value: (row) => (row.days_since_last_reorder === null ? "-" : Number(row.days_since_last_reorder || 0).toLocaleString()),
              },
              { label: "Supplier", value: (row) => row.supplier_name || "Unspecified" },
              {
                label: "Action",
                value: (row) => (
                  <Button size="sm" variant="secondary" onClick={() => navigate("/purchase")}>
                    Reorder
                  </Button>
                ),
              },
            ]}
            rows={lowStockRows.slice(0, 50)}
            emptyLabel="No low stock records."
          />
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Dead Stock Report" subtitle={`No sale in ${DEAD_STOCK_DAYS}+ days`}>
          <MiniTable
            columns={[
              { label: "Product", value: "name" },
              { label: "Qty", value: (row) => Number(row.qty || 0).toLocaleString() },
              { label: "Days Since Last Sale", value: (row) => Number(row.days_since_last_sale || 0).toLocaleString() },
              { label: "Value Locked", value: (row) => money(row.value_locked) },
              { label: "Recommended Action", value: "recommended_action" },
            ]}
            rows={deadStockRows.slice(0, 50)}
            emptyLabel="No dead stock rows."
          />
        </SectionCard>

        <SectionCard className="xl:col-span-12" title="Stock Movement Log" subtitle="Date, type, qty change, running balance, references">
          <MiniTable
            columns={[
              { label: "Date", value: (row) => new Date(row.date).toLocaleString() },
              { label: "Product", value: "product" },
              { label: "Type", value: "type" },
              {
                label: "Qty Change",
                value: (row) => (
                  <span className={Number(row.qty_change || 0) >= 0 ? "text-emerald-300" : "text-rose-300"}>
                    {Number(row.qty_change || 0) >= 0 ? "+" : ""}
                    {Number(row.qty_change || 0).toLocaleString()}
                  </span>
                ),
              },
              { label: "Balance", value: (row) => Number(row.balance || 0).toLocaleString() },
              { label: "Reference", value: "reference" },
              { label: "User", value: "user" },
            ]}
            rows={movementLogRows.slice(0, 150)}
            emptyLabel="No movement rows for selected date range."
          />
        </SectionCard>
      </div>

      <SectionCard
        title="Sub-Reports"
        subtitle="Operational drilldowns and advanced analytics"
        right={
          <div className="inline-flex items-center gap-2 text-xs text-slate-300">
            <Gauge size={14} />
            Movement Range: {movementFrom || "-"} to {movementTo || "-"}
          </div>
        }
      >
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
        {renderSubReportContent()}
      </SectionCard>

      {salesRows?.length === 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          Sales history is limited; movement-based velocity and forecast values may be conservative.
        </div>
      )}
    </>
  );
}
