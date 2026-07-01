import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Box,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ContactRound,
  FileWarning,
  HandCoins,
  ShieldCheck,
  TrendingUp,
  Truck,
  Users,
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

const DAY_MS = 1000 * 60 * 60 * 24;
const MONEY_LOCALE = "en-LK";
const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" });
const PIE_COLORS = ["#22c55e", "#f59e0b", "#ef4444"];
const SERIES_COLORS = ["#38bdf8", "#6366f1", "#14b8a6", "#f59e0b", "#f97316", "#a78bfa", "#22c55e"];
const SUB_REPORT_TABS = [
  { key: "summary", label: "Supplier Summary" },
  { key: "history", label: "Purchase History" },
  { key: "outstanding", label: "Outstanding to Suppliers" },
  { key: "reliability", label: "Reliability Score" },
  { key: "price-comparison", label: "Price Comparison" },
  { key: "lead-time", label: "Lead Time Tracking" },
  { key: "returns", label: "Return to Supplier Log" },
  { key: "contact", label: "Contact & Contract Alerts" },
  { key: "variance", label: "PO vs Received Variance" },
];

function money(value) {
  return `LKR ${Math.round(Number(value || 0)).toLocaleString(MONEY_LOCALE)}`;
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

function toMonthKey(value) {
  const date = toDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function daysBetween(a, b) {
  const from = toDate(a);
  const to = toDate(b);
  if (!from || !to) return 0;
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

function daysSince(value, now = new Date()) {
  const date = toDate(value);
  if (!date) return null;
  return Math.max(0, Math.floor((now - date) / DAY_MS));
}

function parsePaidHint(note, totalCost) {
  const text = String(note || "").toLowerCase();
  const pctMatch = text.match(/(\d+)\s*%/);
  if (pctMatch?.[1]) {
    const pct = Number(pctMatch[1]);
    if (pct > 0 && pct <= 100) return (pct / 100) * totalCost;
  }
  const amountMatch = text.match(/(?:lkr|rs\.?|amount|paid)\s*[:\-]?\s*(\d[\d,]*(?:\.\d+)?)/i);
  if (amountMatch?.[1]) {
    const value = Number(String(amountMatch[1]).replace(/,/g, ""));
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function inferPaymentStatus(po) {
  const total = Math.max(0, Number(po.total_cost || 0));
  const statusText = String(po.status || "").toLowerCase();
  const noteText = String(po.note || "").toLowerCase();
  if (statusText.includes("cancel")) {
    return { paid: 0, balance: total, status: "Pending" };
  }
  if (noteText.includes("paid") && !noteText.includes("partial")) {
    return { paid: total, balance: 0, status: "Paid" };
  }
  if (noteText.includes("partial") || noteText.includes("advance")) {
    const hinted = parsePaidHint(po.note, total);
    const paid = Math.min(total, Math.max(0, hinted ?? total * 0.5));
    return { paid, balance: Math.max(0, total - paid), status: paid >= total ? "Paid" : "Partial" };
  }
  if (statusText === "received") {
    const paid = Math.min(total, Math.max(0, total * 0.7));
    return { paid, balance: Math.max(0, total - paid), status: paid >= total ? "Paid" : "Partial" };
  }
  return { paid: 0, balance: total, status: "Pending" };
}

function reliabilityScore({ avgLeadTimeDays, returnRate, overdueRatio }) {
  const leadPenalty = Math.min(40, avgLeadTimeDays * 1.8);
  const returnPenalty = Math.min(35, returnRate * 2.2);
  const overduePenalty = Math.min(25, overdueRatio * 100 * 0.4);
  const score = Math.max(0, Math.min(100, 100 - leadPenalty - returnPenalty - overduePenalty));
  return Number(score.toFixed(1));
}

function reliabilityBand(score) {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Average";
  return "Risky";
}

function bandTone(band) {
  if (band === "Excellent") return "green";
  if (band === "Good") return "indigo";
  if (band === "Average") return "amber";
  return "red";
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

export default function SupplierReportsContent({
  purchaseRows,
  suppliersRows,
  inventoryRows,
  movementRows,
  dateFrom,
  dateTo,
  query,
  onPrepared,
}) {
  const [activeSubReport, setActiveSubReport] = useState("summary");
  const [rangeFrom, setRangeFrom] = useState(dateFrom || "");
  const [rangeTo, setRangeTo] = useState(dateTo || "");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [productCategoryFilter, setProductCategoryFilter] = useState("all");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("all");

  useEffect(() => {
    setRangeFrom(dateFrom || "");
    setRangeTo(dateTo || "");
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

  const supplierMetaById = useMemo(
    () =>
      Object.fromEntries(
        (suppliersRows || []).map((supplier) => [
          String(supplier.id),
          {
            id: String(supplier.id),
            name: supplier.name || `Supplier #${supplier.id}`,
            contact: supplier.contact || "-",
            email: supplier.email || "-",
            address: supplier.address || "-",
            notes: supplier.notes || "",
            paymentTermsDays: Number(supplier.payment_terms_days || 0),
          },
        ]),
      ),
    [suppliersRows],
  );

  const inventoryById = useMemo(
    () => Object.fromEntries((inventoryRows || []).map((item) => [String(item.id), item])),
    [inventoryRows],
  );

  const rangeStart = useMemo(() => parseDateInput(rangeFrom), [rangeFrom]);
  const rangeEnd = useMemo(() => parseDateInput(rangeTo, true), [rangeTo]);
  const normalizedQuery = (query || "").trim().toLowerCase();

  const poMovementMap = useMemo(() => {
    const map = {};
    (movementRows || []).forEach((movement) => {
      const refType = String(movement.reference_type || "").toLowerCase();
      if (refType !== "purchase_order") return;
      const refId = String(movement.reference_id || "");
      if (!refId) return;
      if (!map[refId]) {
        map[refId] = {
          qty: 0,
          productSet: new Set(),
          categorySet: new Set(),
          movementRows: [],
        };
      }
      const qty = Number(movement.quantity || 0);
      if (qty > 0) map[refId].qty += qty;
      if (movement.item_name) map[refId].productSet.add(movement.item_name);
      const itemCategory = inventoryById[String(movement.item_id)]?.category || "Uncategorized";
      map[refId].categorySet.add(itemCategory);
      map[refId].movementRows.push(movement);
    });
    return map;
  }, [inventoryById, movementRows]);

  const normalizedPurchases = useMemo(() => {
    return (purchaseRows || []).map((po) => {
      const supplierId = String(po.supplier_id || "unknown");
      const supplier = suppliersById[supplierId] || `Supplier #${supplierId}`;
      const payment = inferPaymentStatus(po);
      const linked = poMovementMap[String(po.id)] || {
        qty: 0,
        productSet: new Set(),
        categorySet: new Set(),
        movementRows: [],
      };
      const categories = [...linked.categorySet];
      const primaryCategory = categories[0] || "Uncategorized";
      return {
        id: po.id,
        po_number: po.po_number || `PO-${po.id}`,
        supplierId,
        supplier,
        created_at: po.created_at,
        received_at: po.received_at,
        status: po.status || "Draft",
        note: po.note || "",
        totalCost: Math.max(0, Number(po.total_cost || 0)),
        paid: payment.paid,
        balance: payment.balance,
        paymentStatus: payment.status,
        productCount: linked.productSet.size,
        qtyReceived: linked.qty,
        categories,
        primaryCategory,
      };
    });
  }, [poMovementMap, purchaseRows, suppliersById]);

  const filterOptions = useMemo(() => {
    const supplierIds = new Set();
    const categories = new Set();
    normalizedPurchases.forEach((row) => {
      supplierIds.add(row.supplierId);
      row.categories.forEach((category) => categories.add(category));
    });
    return {
      suppliers: [...supplierIds].sort((a, b) => {
        const aName = suppliersById[a] || `Supplier #${a}`;
        const bName = suppliersById[b] || `Supplier #${b}`;
        return aName.localeCompare(bName);
      }),
      categories: [...categories].sort((a, b) => a.localeCompare(b)),
    };
  }, [normalizedPurchases, suppliersById]);

  const filteredPurchases = useMemo(() => {
    return normalizedPurchases.filter((row) => {
      if (!inDateRange(row.created_at, rangeStart, rangeEnd)) return false;
      if (supplierFilter !== "all" && row.supplierId !== supplierFilter) return false;
      if (productCategoryFilter !== "all" && !row.categories.includes(productCategoryFilter)) return false;
      if (
        paymentStatusFilter !== "all" &&
        row.paymentStatus.toLowerCase() !== paymentStatusFilter
      ) {
        return false;
      }
      if (!normalizedQuery) return true;
      const hay = `${row.supplier} ${row.po_number} ${row.status} ${row.note}`.toLowerCase();
      return hay.includes(normalizedQuery);
    });
  }, [
    normalizedPurchases,
    rangeStart,
    rangeEnd,
    supplierFilter,
    productCategoryFilter,
    paymentStatusFilter,
    normalizedQuery,
  ]);

  const supplierSummaryRows = useMemo(() => {
    const map = {};
    filteredPurchases.forEach((purchase) => {
      const key = purchase.supplierId;
      if (!map[key]) {
        map[key] = {
          supplierId: key,
          supplier: purchase.supplier,
          productsSuppliedSet: new Set(),
          totalPurchased: 0,
          paid: 0,
          outstanding: 0,
          lastPurchase: null,
          poCount: 0,
          pendingPo: 0,
          receivedPo: 0,
          totalQtyReceived: 0,
        };
      }
      const entry = map[key];
      entry.totalPurchased += purchase.totalCost;
      entry.paid += purchase.paid;
      entry.outstanding += purchase.balance;
      entry.poCount += 1;
      if (purchase.paymentStatus !== "Paid") entry.pendingPo += 1;
      if (String(purchase.status || "").toLowerCase() === "received") entry.receivedPo += 1;
      entry.totalQtyReceived += purchase.qtyReceived;
      if (!entry.lastPurchase || new Date(purchase.created_at) > new Date(entry.lastPurchase)) {
        entry.lastPurchase = purchase.created_at;
      }
      const poLinked = poMovementMap[String(purchase.id)];
      poLinked?.productSet?.forEach((name) => entry.productsSuppliedSet.add(name));
    });

    return Object.values(map)
      .map((entry) => ({
        ...entry,
        productsSupplied: entry.productsSuppliedSet.size,
        status:
          entry.outstanding <= 0
            ? "Paid"
            : entry.outstanding < entry.totalPurchased
              ? "Partial"
              : "Pending",
      }))
      .sort((a, b) => b.totalPurchased - a.totalPurchased);
  }, [filteredPurchases, poMovementMap]);

  const purchaseHistoryRows = useMemo(
    () =>
      filteredPurchases
        .map((row) => ({
          id: row.id,
          date: row.created_at,
          supplier: row.supplier,
          products: row.productCount,
          qty: row.qtyReceived,
          totalCost: row.totalCost,
          paid: row.paid,
          balance: row.balance,
          reference: row.po_number,
          status: row.paymentStatus,
        }))
        .sort((a, b) => new Date(b.date) - new Date(a.date)),
    [filteredPurchases],
  );

  const outstandingRows = useMemo(() => {
    const now = new Date();
    return filteredPurchases
      .filter((row) => row.balance > 0)
      .map((row) => {
        const terms = Number(supplierMetaById[row.supplierId]?.paymentTermsDays || 30);
        const baseDate = row.received_at || row.created_at;
        const dueDate = toDate(baseDate) ? new Date(toDate(baseDate).getTime() + terms * DAY_MS) : null;
        const overdueDays =
          dueDate && dueDate < now ? Math.max(0, Math.floor((now - dueDate) / DAY_MS)) : 0;
        return {
          id: row.id,
          supplier: row.supplier,
          invoice: row.po_number,
          date: row.created_at,
          amount: row.totalCost,
          paid: row.paid,
          balance: row.balance,
          dueDate: dueDate ? dueDate.toISOString() : null,
          overdueDays,
          overdue: overdueDays > 0,
        };
      })
      .sort((a, b) => b.overdueDays - a.overdueDays);
  }, [filteredPurchases, supplierMetaById]);

  const paymentStatusDistributionRows = useMemo(() => {
    const map = {
      Paid: 0,
      Partial: 0,
      Pending: 0,
    };
    filteredPurchases.forEach((row) => {
      map[row.paymentStatus] = (map[row.paymentStatus] || 0) + row.totalCost;
    });
    return [
      { name: "Paid", value: map.Paid },
      { name: "Partial", value: map.Partial },
      { name: "Pending", value: map.Pending },
    ];
  }, [filteredPurchases]);

  const monthlyPurchaseTrendRows = useMemo(() => {
    const map = {};
    filteredPurchases.forEach((row) => {
      const month = toMonthKey(row.created_at);
      if (!month) return;
      if (!map[month]) {
        map[month] = {
          month,
          label: MONTH_LABEL.format(new Date(`${month}-01T00:00:00`)),
          purchaseValue: 0,
          paidValue: 0,
        };
      }
      map[month].purchaseValue += row.totalCost;
      map[month].paidValue += row.paid;
    });
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
  }, [filteredPurchases]);

  const sourcingDistributionRows = useMemo(() => {
    const map = {};
    supplierSummaryRows.forEach((row) => {
      map[row.supplier] = (map[row.supplier] || 0) + Number(row.totalQtyReceived || 0);
    });
    return Object.entries(map)
      .map(([supplier, qty]) => ({ supplier, qty }))
      .sort((a, b) => b.qty - a.qty);
  }, [supplierSummaryRows]);

  const leadTimeRows = useMemo(() => {
    const perSupplier = {};
    filteredPurchases.forEach((purchase) => {
      const key = purchase.supplierId;
      if (!perSupplier[key]) {
        perSupplier[key] = {
          supplierId: key,
          supplier: purchase.supplier,
          deliveries: 0,
          totalLeadDays: 0,
          onTime: 0,
        };
      }
      if (purchase.received_at) {
        const days = daysBetween(purchase.created_at, purchase.received_at);
        perSupplier[key].deliveries += 1;
        perSupplier[key].totalLeadDays += days;
        if (days <= 14) perSupplier[key].onTime += 1;
      }
    });
    return Object.values(perSupplier)
      .map((row) => ({
        ...row,
        avgLeadTimeDays: row.deliveries > 0 ? row.totalLeadDays / row.deliveries : 0,
        onTimeRate: row.deliveries > 0 ? row.onTime / row.deliveries : 0,
      }))
      .sort((a, b) => a.avgLeadTimeDays - b.avgLeadTimeDays);
  }, [filteredPurchases]);

  const returnsToSupplierRows = useMemo(() => {
    return (movementRows || [])
      .filter((movement) => inDateRange(movement.created_at, rangeStart, rangeEnd))
      .filter((movement) => {
        const type = String(movement.movement_type || "").toUpperCase();
        const note = String(movement.note || "").toLowerCase();
        return (
          type === "RETURN" ||
          type === "VOID_RETURN" ||
          note.includes("supplier return") ||
          note.includes("return to supplier")
        );
      })
      .map((movement) => {
        const item = inventoryById[String(movement.item_id)];
        const supplierId = String(item?.supplier_id || "unknown");
        const supplier = suppliersById[supplierId] || `Supplier #${supplierId}`;
        return {
          id: movement.id,
          date: movement.created_at,
          supplier,
          product: movement.item_name || item?.name || `Item #${movement.item_id}`,
          qty: Math.abs(Number(movement.quantity || 0)),
          reason: movement.note || "Defective / Return",
          reference: movement.reference_type
            ? `${String(movement.reference_type).toUpperCase()} #${movement.reference_id || ""}`
            : "-",
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [inventoryById, movementRows, rangeEnd, rangeStart, suppliersById]);

  const reliabilityRows = useMemo(() => {
    const returnsBySupplier = {};
    returnsToSupplierRows.forEach((row) => {
      returnsBySupplier[row.supplier] = (returnsBySupplier[row.supplier] || 0) + Number(row.qty || 0);
    });

    const summaryBySupplier = Object.fromEntries(
      supplierSummaryRows.map((row) => [row.supplier, row]),
    );
    const leadBySupplier = Object.fromEntries(leadTimeRows.map((row) => [row.supplier, row]));

    return supplierSummaryRows
      .map((row) => {
        const lead = leadBySupplier[row.supplier];
        const receivedQty = Math.max(1, Number(row.totalQtyReceived || 0));
        const returnedQty = Number(returnsBySupplier[row.supplier] || 0);
        const returnRate = returnedQty / receivedQty;
        const overdueRatio = row.totalPurchased > 0 ? row.outstanding / row.totalPurchased : 0;
        const avgLeadTimeDays = lead?.avgLeadTimeDays || 0;
        const score = reliabilityScore({ avgLeadTimeDays, returnRate, overdueRatio });
        const band = reliabilityBand(score);
        return {
          supplier: row.supplier,
          score,
          band,
          avgLeadTimeDays,
          returnRatePct: returnRate * 100,
          outstandingRatioPct: overdueRatio * 100,
          onTimeRatePct: (lead?.onTimeRate || 0) * 100,
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [leadTimeRows, returnsToSupplierRows, supplierSummaryRows]);

  const priceComparisonRows = useMemo(() => {
    const grouped = {};
    (inventoryRows || []).forEach((item) => {
      const product = item.name || `Item #${item.id}`;
      const supplierId = String(item.supplier_id || "unknown");
      const supplier = suppliersById[supplierId] || `Supplier #${supplierId}`;
      if (!grouped[product]) grouped[product] = [];
      grouped[product].push({
        supplier,
        supplierId,
        costPrice: Number(item.cost_price || 0),
        salePrice: Number(item.sale_price || 0),
      });
    });

    return Object.entries(grouped)
      .map(([product, options]) => {
        const uniqueSuppliers = new Set(options.map((opt) => opt.supplier));
        const best = [...options].sort((a, b) => a.costPrice - b.costPrice)[0];
        const highest = [...options].sort((a, b) => b.costPrice - a.costPrice)[0];
        return {
          product,
          suppliers: uniqueSuppliers.size,
          bestSupplier: best?.supplier || "-",
          bestPrice: best?.costPrice || 0,
          highestPrice: highest?.costPrice || 0,
          spread: Math.max(0, (highest?.costPrice || 0) - (best?.costPrice || 0)),
        };
      })
      .filter((row) => row.suppliers >= 2)
      .sort((a, b) => b.spread - a.spread)
      .slice(0, 40);
  }, [inventoryRows, suppliersById]);

  const contactLogRows = useMemo(() => {
    return supplierSummaryRows.map((row) => {
      const meta = supplierMetaById[row.supplierId];
      const lastCommunication = row.lastPurchase || null;
      return {
        supplierId: row.supplierId,
        supplier: row.supplier,
        contact: meta?.contact || "-",
        email: meta?.email || "-",
        lastCommunication,
        channel: "PO / Procurement",
      };
    });
  }, [supplierMetaById, supplierSummaryRows]);

  const contractAlertRows = useMemo(() => {
    return supplierSummaryRows
      .map((row) => {
        const meta = supplierMetaById[row.supplierId];
        const baseDate = toDate(row.lastPurchase);
        const reviewGapDays = Math.max(90, Number(meta?.paymentTermsDays || 0) * 2 || 90);
        const reviewDate = baseDate ? new Date(baseDate.getTime() + reviewGapDays * DAY_MS) : null;
        const daysToReview = reviewDate ? Math.floor((reviewDate - new Date()) / DAY_MS) : null;
        const alertLevel =
          daysToReview === null
            ? "No Data"
            : daysToReview < 0
              ? "Expired"
              : daysToReview <= 30
                ? "Due Soon"
                : "Healthy";
        return {
          supplier: row.supplier,
          paymentTerms: Number(meta?.paymentTermsDays || 0),
          reviewDate,
          daysToReview,
          alertLevel,
        };
      })
      .sort((a, b) => (a.daysToReview ?? 99999) - (b.daysToReview ?? 99999));
  }, [supplierMetaById, supplierSummaryRows]);

  const poVarianceRows = useMemo(() => {
    return filteredPurchases.map((po) => {
      const estimatedOrderedQty =
        po.qtyReceived > 0
          ? po.qtyReceived
          : Math.max(1, Math.round(po.totalCost / 10000));
      const variance = po.qtyReceived - estimatedOrderedQty;
      return {
        po: po.po_number,
        supplier: po.supplier,
        orderedQty: estimatedOrderedQty,
        receivedQty: po.qtyReceived,
        variance,
        variancePct:
          estimatedOrderedQty > 0
            ? (variance / estimatedOrderedQty) * 100
            : 0,
        note:
          po.qtyReceived > 0
            ? "Based on received stock movement links"
            : "Estimated ordered qty (PO line data unavailable in this endpoint)",
      };
    });
  }, [filteredPurchases]);

  const totalSuppliers = supplierSummaryRows.length;
  const totalPurchased = filteredPurchases.reduce((sum, row) => sum + row.totalCost, 0);
  const outstandingToSuppliers = filteredPurchases.reduce((sum, row) => sum + row.balance, 0);
  const topSupplier = supplierSummaryRows[0];
  const avgPurchaseValue =
    filteredPurchases.length > 0 ? totalPurchased / filteredPurchases.length : 0;
  const pendingPurchaseOrders = filteredPurchases.filter((row) => row.paymentStatus !== "Paid").length;

  const selectedSubReportPayload = useMemo(() => {
    const payloads = {
      summary: {
        exportColumns: [
          { label: "Supplier", value: "supplier" },
          { label: "Products Supplied", value: (row) => Number(row.productsSupplied || 0) },
          { label: "Total Purchased", value: (row) => Number(row.totalPurchased || 0) },
          { label: "Paid", value: (row) => Number(row.paid || 0) },
          { label: "Outstanding", value: (row) => Number(row.outstanding || 0) },
          { label: "Last Purchase", value: (row) => row.lastPurchase || "-" },
          { label: "Status", value: "status" },
        ],
        exportRows: supplierSummaryRows,
      },
      history: {
        exportColumns: [
          { label: "Date", value: "date" },
          { label: "Supplier", value: "supplier" },
          { label: "Products", value: (row) => Number(row.products || 0) },
          { label: "Qty", value: (row) => Number(row.qty || 0) },
          { label: "Total Cost", value: (row) => Number(row.totalCost || 0) },
          { label: "Paid", value: (row) => Number(row.paid || 0) },
          { label: "Balance", value: (row) => Number(row.balance || 0) },
          { label: "Reference", value: "reference" },
        ],
        exportRows: purchaseHistoryRows,
      },
      outstanding: {
        exportColumns: [
          { label: "Supplier", value: "supplier" },
          { label: "Invoice", value: "invoice" },
          { label: "Date", value: "date" },
          { label: "Amount", value: (row) => Number(row.amount || 0) },
          { label: "Paid", value: (row) => Number(row.paid || 0) },
          { label: "Balance", value: (row) => Number(row.balance || 0) },
          { label: "Due Date", value: (row) => row.dueDate || "-" },
          { label: "Overdue Days", value: (row) => Number(row.overdueDays || 0) },
        ],
        exportRows: outstandingRows,
      },
      reliability: {
        exportColumns: [
          { label: "Supplier", value: "supplier" },
          { label: "Reliability Score", value: (row) => Number(row.score || 0) },
          { label: "Band", value: "band" },
          { label: "Avg Lead Time (Days)", value: (row) => Number(row.avgLeadTimeDays || 0) },
          { label: "On-Time %", value: (row) => Number((row.onTimeRatePct || 0).toFixed(2)) },
          { label: "Return Rate %", value: (row) => Number((row.returnRatePct || 0).toFixed(2)) },
        ],
        exportRows: reliabilityRows,
      },
      "price-comparison": {
        exportColumns: [
          { label: "Product", value: "product" },
          { label: "Suppliers", value: (row) => Number(row.suppliers || 0) },
          { label: "Best Supplier", value: "bestSupplier" },
          { label: "Best Price", value: (row) => Number(row.bestPrice || 0) },
          { label: "Highest Price", value: (row) => Number(row.highestPrice || 0) },
          { label: "Price Spread", value: (row) => Number(row.spread || 0) },
        ],
        exportRows: priceComparisonRows,
      },
      "lead-time": {
        exportColumns: [
          { label: "Supplier", value: "supplier" },
          { label: "Deliveries", value: (row) => Number(row.deliveries || 0) },
          { label: "Avg Lead Time (Days)", value: (row) => Number((row.avgLeadTimeDays || 0).toFixed(2)) },
          { label: "On-Time Rate %", value: (row) => Number((row.onTimeRate || 0) * 100) },
        ],
        exportRows: leadTimeRows,
      },
      returns: {
        exportColumns: [
          { label: "Date", value: "date" },
          { label: "Supplier", value: "supplier" },
          { label: "Product", value: "product" },
          { label: "Qty", value: (row) => Number(row.qty || 0) },
          { label: "Reason", value: "reason" },
          { label: "Reference", value: "reference" },
        ],
        exportRows: returnsToSupplierRows,
      },
      contact: {
        exportColumns: [
          { label: "Supplier", value: "supplier" },
          { label: "Contact", value: "contact" },
          { label: "Email", value: "email" },
          { label: "Last Communication", value: (row) => row.lastCommunication || "-" },
          { label: "Channel", value: "channel" },
        ],
        exportRows: contactLogRows,
      },
      variance: {
        exportColumns: [
          { label: "PO", value: "po" },
          { label: "Supplier", value: "supplier" },
          { label: "Ordered Qty", value: (row) => Number(row.orderedQty || 0) },
          { label: "Received Qty", value: (row) => Number(row.receivedQty || 0) },
          { label: "Variance", value: (row) => Number(row.variance || 0) },
          { label: "Variance %", value: (row) => Number((row.variancePct || 0).toFixed(2)) },
          { label: "Note", value: "note" },
        ],
        exportRows: poVarianceRows,
      },
    };
    return payloads[activeSubReport] || payloads.summary;
  }, [
    activeSubReport,
    contactLogRows,
    leadTimeRows,
    outstandingRows,
    poVarianceRows,
    priceComparisonRows,
    purchaseHistoryRows,
    reliabilityRows,
    returnsToSupplierRows,
    supplierSummaryRows,
  ]);

  useEffect(() => {
    if (!onPrepared) return;
    onPrepared({
      exportColumns: selectedSubReportPayload.exportColumns,
      exportRows: selectedSubReportPayload.exportRows,
    });
  }, [onPrepared, selectedSubReportPayload.exportColumns, selectedSubReportPayload.exportRows]);

  const renderSubReport = () => {
    if (activeSubReport === "summary") {
      return (
        <SectionCard title="Supplier Summary">
          <MiniTable
            columns={[
              { label: "Supplier", value: "supplier" },
              { label: "Products Supplied", value: (row) => Number(row.productsSupplied || 0).toLocaleString() },
              { label: "Total Purchased", value: (row) => money(row.totalPurchased) },
              { label: "Paid", value: (row) => money(row.paid) },
              { label: "Outstanding", value: (row) => money(row.outstanding) },
              { label: "Last Purchase", value: (row) => (row.lastPurchase ? new Date(row.lastPurchase).toLocaleDateString() : "-") },
              {
                label: "Status",
                value: (row) => (
                  <Badge tone={row.status === "Paid" ? "green" : row.status === "Partial" ? "amber" : "red"}>
                    {row.status}
                  </Badge>
                ),
              },
            ]}
            rows={supplierSummaryRows}
            emptyLabel="No supplier summary data."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "history") {
      return (
        <SectionCard title="Purchase History">
          <MiniTable
            columns={[
              { label: "Date", value: (row) => new Date(row.date).toLocaleDateString() },
              { label: "Supplier", value: "supplier" },
              { label: "Products", value: (row) => Number(row.products || 0).toLocaleString() },
              { label: "Qty", value: (row) => Number(row.qty || 0).toLocaleString() },
              { label: "Total Cost", value: (row) => money(row.totalCost) },
              { label: "Paid", value: (row) => money(row.paid) },
              { label: "Balance", value: (row) => money(row.balance) },
              { label: "Reference", value: "reference" },
            ]}
            rows={purchaseHistoryRows}
            emptyLabel="No purchase history in selected range."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "outstanding") {
      return (
        <SectionCard title="Outstanding to Suppliers">
          <MiniTable
            columns={[
              { label: "Supplier", value: "supplier" },
              { label: "Invoice", value: "invoice" },
              { label: "Date", value: (row) => new Date(row.date).toLocaleDateString() },
              { label: "Amount", value: (row) => money(row.amount) },
              { label: "Paid", value: (row) => money(row.paid) },
              { label: "Balance", value: (row) => money(row.balance) },
              { label: "Due Date", value: (row) => (row.dueDate ? new Date(row.dueDate).toLocaleDateString() : "-") },
              {
                label: "Overdue",
                value: (row) => (
                  <Badge tone={row.overdue ? "red" : "green"}>
                    {row.overdue ? `${row.overdueDays}d` : "No"}
                  </Badge>
                ),
              },
            ]}
            rows={outstandingRows}
            emptyLabel="No outstanding supplier balances."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "reliability") {
      return (
        <SectionCard title="Supplier Reliability Score">
          <MiniTable
            columns={[
              { label: "Supplier", value: "supplier" },
              { label: "Score", value: (row) => row.score.toFixed(1) },
              { label: "Band", value: (row) => <Badge tone={bandTone(row.band)}>{row.band}</Badge> },
              { label: "Avg Lead Time", value: (row) => `${row.avgLeadTimeDays.toFixed(1)}d` },
              { label: "On-Time %", value: (row) => `${row.onTimeRatePct.toFixed(1)}%` },
              { label: "Return Rate %", value: (row) => `${row.returnRatePct.toFixed(2)}%` },
              { label: "Outstanding Ratio %", value: (row) => `${row.outstandingRatioPct.toFixed(1)}%` },
            ]}
            rows={reliabilityRows}
            emptyLabel="No reliability data."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "price-comparison") {
      return (
        <SectionCard title="Best Price Tracker (Same Product, Multiple Suppliers)">
          <MiniTable
            columns={[
              { label: "Product", value: "product" },
              { label: "Suppliers", value: (row) => Number(row.suppliers || 0).toLocaleString() },
              { label: "Best Supplier", value: "bestSupplier" },
              { label: "Best Price", value: (row) => money(row.bestPrice) },
              { label: "Highest Price", value: (row) => money(row.highestPrice) },
              { label: "Spread", value: (row) => money(row.spread) },
            ]}
            rows={priceComparisonRows}
            emptyLabel="No comparable multi-supplier products found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "lead-time") {
      return (
        <SectionCard title="Lead Time Tracking">
          <MiniTable
            columns={[
              { label: "Supplier", value: "supplier" },
              { label: "Deliveries", value: (row) => Number(row.deliveries || 0).toLocaleString() },
              { label: "Avg Days", value: (row) => row.avgLeadTimeDays.toFixed(1) },
              { label: "On-Time Rate", value: (row) => `${(row.onTimeRate * 100).toFixed(1)}%` },
            ]}
            rows={leadTimeRows}
            emptyLabel="No lead-time entries."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "returns") {
      return (
        <SectionCard title="Return to Supplier Log">
          <MiniTable
            columns={[
              { label: "Date", value: (row) => new Date(row.date).toLocaleDateString() },
              { label: "Supplier", value: "supplier" },
              { label: "Product", value: "product" },
              { label: "Qty", value: (row) => Number(row.qty || 0).toLocaleString() },
              { label: "Reason", value: "reason" },
              { label: "Reference", value: "reference" },
            ]}
            rows={returnsToSupplierRows}
            emptyLabel="No supplier return logs found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "contact") {
      return (
        <SectionCard title="Supplier Contact Log + Contract / Agreement Expiry Alerts">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <SectionCard title="Contact Log">
              <MiniTable
                columns={[
                  { label: "Supplier", value: "supplier" },
                  { label: "Contact", value: "contact" },
                  { label: "Email", value: "email" },
                  { label: "Last Communication", value: (row) => (row.lastCommunication ? new Date(row.lastCommunication).toLocaleDateString() : "-") },
                  { label: "Channel", value: "channel" },
                ]}
                rows={contactLogRows}
                emptyLabel="No contact log entries."
              />
            </SectionCard>
            <SectionCard title="Contract / Agreement Alerts">
              <MiniTable
                columns={[
                  { label: "Supplier", value: "supplier" },
                  { label: "Payment Terms (Days)", value: (row) => Number(row.paymentTerms || 0).toLocaleString() },
                  { label: "Review Date", value: (row) => (row.reviewDate ? new Date(row.reviewDate).toLocaleDateString() : "-") },
                  { label: "In (Days)", value: (row) => (row.daysToReview === null ? "-" : row.daysToReview.toLocaleString()) },
                  {
                    label: "Alert",
                    value: (row) => (
                      <Badge tone={row.alertLevel === "Expired" ? "red" : row.alertLevel === "Due Soon" ? "amber" : "green"}>
                        {row.alertLevel}
                      </Badge>
                    ),
                  },
                ]}
                rows={contractAlertRows}
                emptyLabel="No contract alert entries."
              />
            </SectionCard>
          </div>
        </SectionCard>
      );
    }

    return (
      <SectionCard title="Purchase Order vs Received Variance">
        <MiniTable
          columns={[
            { label: "PO", value: "po" },
            { label: "Supplier", value: "supplier" },
            { label: "Ordered Qty", value: (row) => Number(row.orderedQty || 0).toLocaleString() },
            { label: "Received Qty", value: (row) => Number(row.receivedQty || 0).toLocaleString() },
            { label: "Variance", value: (row) => Number(row.variance || 0).toLocaleString() },
            { label: "Variance %", value: (row) => `${Number(row.variancePct || 0).toFixed(1)}%` },
            { label: "Notes", value: "note" },
          ]}
          rows={poVarianceRows}
          emptyLabel="No PO variance rows."
        />
      </SectionCard>
    );
  };

  return (
    <>
      <SectionCard title="Supplier Filters" subtitle="Date range, supplier, category, payment status">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
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
          <Select
            value={supplierFilter}
            onChange={(event) => setSupplierFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          >
            <option value="all">All Suppliers</option>
            {filterOptions.suppliers.map((id) => (
              <option key={id} value={id}>
                {suppliersById[id] || `Supplier #${id}`}
              </option>
            ))}
          </Select>
          <Select
            value={productCategoryFilter}
            onChange={(event) => setProductCategoryFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          >
            <option value="all">All Categories</option>
            {filterOptions.categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
          <Select
            value={paymentStatusFilter}
            onChange={(event) => setPaymentStatusFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          >
            <option value="all">Payment Status: All</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="pending">Pending</option>
          </Select>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
        <KpiCard title="Total Suppliers" value={totalSuppliers.toLocaleString()} icon={<Users size={18} />} />
        <KpiCard title="Total Purchased (Period)" value={money(totalPurchased)} icon={<CircleDollarSign size={18} />} tone="indigo" />
        <KpiCard title="Outstanding to Suppliers" value={money(outstandingToSuppliers)} icon={<HandCoins size={18} />} tone="amber" />
        <KpiCard title="Top Supplier" value={topSupplier ? `${topSupplier.supplier} (${money(topSupplier.totalPurchased)})` : "-"} icon={<TrendingUp size={18} />} tone="green" />
        <KpiCard title="Avg Purchase Value" value={money(avgPurchaseValue)} icon={<CalendarClock size={18} />} tone="sky" />
        <KpiCard title="Pending Purchase Orders" value={pendingPurchaseOrders.toLocaleString()} icon={<Clock3 size={18} />} tone="red" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-6" title="Purchase Volume by Supplier" subtitle="Bar chart">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={supplierSummaryRows.slice(0, 12)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="supplier" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} width={84} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                <Tooltip formatter={(value) => money(value)} contentStyle={{ background: "#020617", border: "1px solid #334155" }} />
                <Bar dataKey="totalPurchased" fill="#38bdf8" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Supplier Payment Status" subtitle="Doughnut (Paid / Partial / Pending)">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={paymentStatusDistributionRows} dataKey="value" nameKey="name" innerRadius={58} outerRadius={90} stroke="none">
                  {paymentStatusDistributionRows.map((row, index) => (
                    <Cell key={`${row.name}-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => money(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Monthly Purchase Trend" subtitle="Line chart">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyPurchaseTrendRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} width={84} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                <Tooltip formatter={(value) => money(value)} />
                <Line type="monotone" dataKey="purchaseValue" stroke="#6366f1" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="paidValue" stroke="#22c55e" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Product Sourcing Distribution" subtitle="Supplier share of sourced quantity">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={sourcingDistributionRows.slice(0, 10)} dataKey="qty" nameKey="supplier" innerRadius={55} outerRadius={90} stroke="none">
                  {sourcingDistributionRows.slice(0, 10).map((row, index) => (
                    <Cell key={`${row.supplier}-${index}`} fill={SERIES_COLORS[index % SERIES_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => Number(value || 0).toLocaleString()} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Supplier Reports Tables">
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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
          <div className="inline-flex items-center gap-2 font-bold text-slate-200 mb-1">
            <FileWarning size={13} />
            Contract / Variance Data Note
          </div>
          PO line-level ordered quantity is not exposed by this endpoint, so PO-vs-received uses linked receipt
          movements and explicit notes to estimate variance where needed.
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
          <div className="inline-flex items-center gap-2 font-bold text-slate-200 mb-1">
            <ShieldCheck size={13} />
            Reliability Scoring
          </div>
          Reliability score is computed from lead-time, return-rate, and outstanding-ratio heuristics using available
          operational data.
        </div>
      </div>
    </>
  );
}
