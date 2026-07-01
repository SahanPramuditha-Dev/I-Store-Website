import { useEffect, useMemo, useState } from "react";
import {
  BadgeAlert,
  BarChart3,
  HandCoins,
  Repeat,
  RotateCcw,
  ShieldCheck,
  Timer,
  TrendingDown,
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
const PIE_COLORS = ["#22c55e", "#f59e0b", "#f97316", "#ef4444", "#38bdf8", "#a78bfa"];
const SUB_TABS = [
  { key: "product-returns", label: "Product Returns Log" },
  { key: "repair-refunds", label: "Repair Refunds Log" },
  { key: "refund-by-product", label: "Refund by Product" },
  { key: "refund-by-reason", label: "Refund by Reason" },
  { key: "staff-refund-log", label: "Staff Refund Log" },
  { key: "customer-refund-history", label: "Customer Refund History" },
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

function daysBetween(fromValue, toValue) {
  const from = toDate(fromValue);
  const to = toDate(toValue);
  if (!from || !to) return 0;
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

function reasonCategory(text) {
  const value = String(text || "").toLowerCase();
  if (value.includes("defect")) return "Defective";
  if (value.includes("wrong")) return "Wrong Item";
  if (value.includes("not satisf") || value.includes("unsatisf")) return "Not Satisfied";
  if (value.includes("warranty")) return "Warranty";
  return "Other";
}

function toneForStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("pending")) return "amber";
  if (value.includes("approved")) return "green";
  return "indigo";
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

export default function RefundsReturnsContent({
  salesRows,
  repairRows,
  inventoryRows,
  movementRows,
  customersRows,
  auditActivityRows,
  dateFrom,
  dateTo,
  query,
  onPrepared,
}) {
  const [activeTab, setActiveTab] = useState("product-returns");
  const [rangeFrom, setRangeFrom] = useState(dateFrom || "");
  const [rangeTo, setRangeTo] = useState(dateTo || "");
  const [productFilter, setProductFilter] = useState("all");
  const [refundTypeFilter, setRefundTypeFilter] = useState("all");
  const [reasonFilter, setReasonFilter] = useState("all");
  const [processedByFilter, setProcessedByFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    setRangeFrom(dateFrom || "");
    setRangeTo(dateTo || "");
  }, [dateFrom, dateTo]);

  const rangeStart = useMemo(() => parseDateInput(rangeFrom), [rangeFrom]);
  const rangeEnd = useMemo(() => parseDateInput(rangeTo, true), [rangeTo]);
  const normalizedQuery = (query || "").trim().toLowerCase();

  const customersById = useMemo(
    () =>
      Object.fromEntries(
        (customersRows || []).map((customer) => [
          String(customer.id),
          customer.name || `Customer #${customer.id}`,
        ]),
      ),
    [customersRows],
  );

  const inventoryById = useMemo(
    () => Object.fromEntries((inventoryRows || []).map((item) => [String(item.id), item])),
    [inventoryRows],
  );

  const salesById = useMemo(
    () => Object.fromEntries((salesRows || []).map((sale) => [Number(sale.id), sale])),
    [salesRows],
  );

  const saleReturnMovementMap = useMemo(() => {
    const map = {};
    (movementRows || [])
      .filter((movement) => String(movement.reference_type || "").toLowerCase() === "sale_return")
      .forEach((movement) => {
        const key = Number(movement.reference_id);
        if (!map[key]) map[key] = [];
        map[key].push(movement);
      });
    return map;
  }, [movementRows]);

  const auditBySaleRecordId = useMemo(() => {
    const map = {};
    (auditActivityRows || []).forEach((row) => {
      const moduleText = String(row.module || row.entity_type || "").toLowerCase();
      const recordId = Number(row.record_id ?? row.entity_id);
      if (!Number.isFinite(recordId)) return;
      if (!moduleText.includes("sale")) return;
      if (!map[recordId]) {
        map[recordId] = row.user || "Front Desk";
      }
    });
    return map;
  }, [auditActivityRows]);

  const postedSalesRows = useMemo(
    () => (salesRows || []).filter((sale) => !sale.is_voided && !sale.is_return),
    [salesRows],
  );

  const productReturnRows = useMemo(() => {
    const rows = (salesRows || [])
      .filter((sale) => !sale.is_voided && sale.is_return)
      .map((sale) => {
        const original = salesById[Number(sale.original_sale_id)];
        const saleLines = Array.isArray(sale.lines) ? sale.lines : [];
        const productNames = [...new Set(saleLines.map((line) => line.item_name).filter(Boolean))];
        const categories = [
          ...new Set(
            saleLines
              .map((line) => line.category || inventoryById[String(line.item_id)]?.category || "-")
              .filter(Boolean),
          ),
        ];
        const qtyReturned = saleLines.reduce(
          (acc, line) => acc + Math.abs(Number(line.quantity || 0)),
          0,
        );
        const movementRowsForSale = saleReturnMovementMap[Number(sale.id)] || [];
        const reasonText = movementRowsForSale[0]?.note || "No reason provided";
        const status = reasonText && reasonText !== "No reason provided" ? "Approved" : "Pending";
        return {
          id: `sale-return-${sale.id}`,
          refundId: `RF-S-${sale.id}`,
          date: sale.created_at,
          originalRef: original?.invoice_no || (sale.original_sale_id ? `INV-${sale.original_sale_id}` : "-"),
          customerId: String(sale.customer_id ?? "walk-in"),
          customer:
            sale.customer_name ||
            customersById[String(sale.customer_id)] ||
            "Walk-in Customer",
          productOrDevice: productNames.length > 0 ? productNames.join(", ") : "Multiple / Unknown",
          productCategory: categories.length > 0 ? categories.join(", ") : "-",
          refundType: "Sale",
          originalAmount: Math.abs(Number(original?.total || 0)),
          refundAmount: Math.abs(Number(sale.total || 0)),
          reasonText,
          reason: reasonCategory(reasonText),
          processedBy: auditBySaleRecordId[Number(sale.id)] || sale.cashier || "Front Desk",
          approvedBy: status === "Approved" ? "Supervisor" : "-",
          status,
          qtyReturned,
          daysToRefund: original?.created_at ? daysBetween(original.created_at, sale.created_at) : 0,
          lines: saleLines.map((line) => ({
            itemId: line.item_id,
            product: line.item_name || inventoryById[String(line.item_id)]?.name || `Item #${line.item_id}`,
            category: line.category || inventoryById[String(line.item_id)]?.category || "-",
            qty: Math.abs(Number(line.quantity || 0)),
            refundValue: Math.abs(Number(line.line_revenue || Number(line.quantity || 0) * Number(line.unit_price || 0))),
          })),
        };
      });
    return rows.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [auditBySaleRecordId, customersById, inventoryById, saleReturnMovementMap, salesById, salesRows]);

  const repairRefundRows = useMemo(() => {
    const rows = (repairRows || [])
      .filter((repair) => {
        const statusText = String(repair.status || "").toLowerCase();
        const hasRefundStatus = statusText.includes("refund");
        const cancelledWithAdvance =
          statusText.includes("cancel") && Number(repair.advance_payment || 0) > 0;
        return hasRefundStatus || cancelledWithAdvance;
      })
      .map((repair) => {
        const statusText = String(repair.status || "").toLowerCase();
        const isPending = statusText.includes("pending");
        const reasonText =
          repair.cancellation_reason ||
          repair.notes ||
          (statusText.includes("refund")
            ? "Repair refund processed"
            : "Repair cancelled with customer advance");
        const refundAmount = Math.max(
          0,
          Number(repair.refund_amount || 0) ||
            Number(repair.advance_payment || 0) ||
            (statusText.includes("refund") ? Number(repair.invoice_amount ?? repair.estimated_cost ?? 0) : 0),
        );
        const eventDate = repair.cancelled_at || repair.delivered_at || repair.created_at;
        return {
          id: `repair-refund-${repair.id}`,
          refundId: `RF-R-${repair.id}`,
          date: eventDate,
          originalRef: repair.ticket_no || `JOB-${repair.id}`,
          customerId: String(repair.customer_id ?? "unknown"),
          customer:
            repair.customer_name ||
            customersById[String(repair.customer_id)] ||
            "Unknown Customer",
          productOrDevice: repair.device || repair.device_model_name || "Repair Device",
          productCategory: "Repair",
          refundType: "Repair",
          originalAmount: Math.max(0, Number(repair.invoice_amount ?? repair.estimated_cost ?? 0)),
          refundAmount,
          reasonText,
          reason: reasonCategory(reasonText),
          processedBy: repair.technician || "Service Desk",
          approvedBy: isPending ? "-" : "Service Manager",
          status: isPending ? "Pending" : "Approved",
          qtyReturned: 0,
          daysToRefund: daysBetween(repair.created_at, eventDate),
        };
      });
    return rows.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [customersById, repairRows]);

  const allRefundRows = useMemo(
    () => [...productReturnRows, ...repairRefundRows].sort((a, b) => new Date(b.date) - new Date(a.date)),
    [productReturnRows, repairRefundRows],
  );

  const filterOptions = useMemo(() => {
    const products = new Set();
    const processed = new Set();
    const reasons = new Set();
    allRefundRows.forEach((row) => {
      products.add(row.productOrDevice);
      if (row.productCategory) products.add(row.productCategory);
      processed.add(row.processedBy || "Unknown");
      reasons.add(row.reason || "Other");
    });
    return {
      products: [...products].sort((a, b) => a.localeCompare(b)),
      processedBy: [...processed].sort((a, b) => a.localeCompare(b)),
      reasons: [...reasons].sort((a, b) => a.localeCompare(b)),
    };
  }, [allRefundRows]);

  const filteredRefundRows = useMemo(() => {
    return allRefundRows.filter((row) => {
      if (!inDateRange(row.date, rangeStart, rangeEnd)) return false;
      if (productFilter !== "all") {
        const productHit = String(row.productOrDevice || "") === productFilter;
        const categoryHit = String(row.productCategory || "") === productFilter;
        if (!productHit && !categoryHit) return false;
      }
      if (refundTypeFilter !== "all" && String(row.refundType || "").toLowerCase() !== refundTypeFilter) {
        return false;
      }
      if (reasonFilter !== "all" && row.reason !== reasonFilter) return false;
      if (processedByFilter !== "all" && row.processedBy !== processedByFilter) return false;
      if (statusFilter !== "all" && String(row.status || "").toLowerCase() !== statusFilter) return false;
      if (!normalizedQuery) return true;
      const hay = `${row.refundId} ${row.originalRef} ${row.customer} ${row.productOrDevice} ${row.reasonText} ${row.processedBy}`.toLowerCase();
      return hay.includes(normalizedQuery);
    });
  }, [
    allRefundRows,
    rangeStart,
    rangeEnd,
    productFilter,
    refundTypeFilter,
    reasonFilter,
    processedByFilter,
    statusFilter,
    normalizedQuery,
  ]);

  const filteredProductReturnRows = useMemo(
    () => filteredRefundRows.filter((row) => row.refundType === "Sale"),
    [filteredRefundRows],
  );
  const filteredRepairRefundRows = useMemo(
    () => filteredRefundRows.filter((row) => row.refundType === "Repair"),
    [filteredRefundRows],
  );

  const productRefundLineRows = useMemo(() => {
    const lineRows = [];
    productReturnRows.forEach((refundRow) => {
      if (!filteredProductReturnRows.find((row) => row.id === refundRow.id)) return;
      (refundRow.lines || []).forEach((line, index) => {
        lineRows.push({
          id: `${refundRow.id}-line-${index}`,
          refundId: refundRow.refundId,
          date: refundRow.date,
          customer: refundRow.customer,
          product: line.product,
          category: line.category,
          qtyReturned: Number(line.qty || 0),
          refundValue: Number(line.refundValue || 0),
          reason: refundRow.reason,
        });
      });
    });
    return lineRows;
  }, [filteredProductReturnRows, productReturnRows]);

  const soldQtyByProduct = useMemo(() => {
    const map = {};
    postedSalesRows.forEach((sale) => {
      if (!inDateRange(sale.created_at, rangeStart, rangeEnd)) return;
      (sale.lines || []).forEach((line) => {
        const name =
          line.item_name ||
          inventoryById[String(line.item_id)]?.name ||
          `Item #${line.item_id}`;
        map[name] = (map[name] || 0) + Math.max(0, Number(line.quantity || 0));
      });
    });
    return map;
  }, [inventoryById, postedSalesRows, rangeStart, rangeEnd]);

  const refundByProductRows = useMemo(() => {
    const grouped = {};
    productRefundLineRows.forEach((line) => {
      if (!grouped[line.product]) {
        grouped[line.product] = {
          product: line.product,
          category: line.category || "-",
          refundCount: 0,
          qtyReturned: 0,
          refundValue: 0,
        };
      }
      grouped[line.product].refundCount += 1;
      grouped[line.product].qtyReturned += Number(line.qtyReturned || 0);
      grouped[line.product].refundValue += Number(line.refundValue || 0);
    });

    return Object.values(grouped)
      .map((row) => {
        const soldQty = Number(soldQtyByProduct[row.product] || 0);
        return {
          ...row,
          soldQty,
          refundRatePct: soldQty > 0 ? (row.qtyReturned / soldQty) * 100 : 0,
        };
      })
      .sort((a, b) => b.qtyReturned - a.qtyReturned);
  }, [productRefundLineRows, soldQtyByProduct]);

  const refundByReasonRows = useMemo(() => {
    const map = {};
    filteredRefundRows.forEach((row) => {
      const reason = row.reason || "Other";
      if (!map[reason]) map[reason] = { reason, count: 0, value: 0 };
      map[reason].count += 1;
      map[reason].value += Number(row.refundAmount || 0);
    });
    return Object.values(map).sort((a, b) => b.value - a.value);
  }, [filteredRefundRows]);

  const staffRefundRows = useMemo(() => {
    const map = {};
    filteredRefundRows.forEach((row) => {
      const staff = row.processedBy || "Unknown";
      if (!map[staff]) {
        map[staff] = {
          staff,
          totalRefunds: 0,
          totalValue: 0,
          saleRefunds: 0,
          repairRefunds: 0,
          approved: 0,
          pending: 0,
        };
      }
      map[staff].totalRefunds += 1;
      map[staff].totalValue += Number(row.refundAmount || 0);
      if (row.refundType === "Sale") map[staff].saleRefunds += 1;
      else map[staff].repairRefunds += 1;
      if (String(row.status || "").toLowerCase().includes("pending")) map[staff].pending += 1;
      else map[staff].approved += 1;
    });
    return Object.values(map).sort((a, b) => b.totalValue - a.totalValue);
  }, [filteredRefundRows]);

  const customerRefundHistoryRows = useMemo(() => {
    const map = {};
    filteredRefundRows.forEach((row) => {
      const key = row.customerId || row.customer || "unknown";
      if (!map[key]) {
        map[key] = {
          customerId: key,
          customer: row.customer,
          refunds: 0,
          totalRefundValue: 0,
          saleRefunds: 0,
          repairRefunds: 0,
          lastRefundDate: row.date,
        };
      }
      map[key].refunds += 1;
      map[key].totalRefundValue += Number(row.refundAmount || 0);
      if (row.refundType === "Sale") map[key].saleRefunds += 1;
      else map[key].repairRefunds += 1;
      if (new Date(row.date) > new Date(map[key].lastRefundDate)) {
        map[key].lastRefundDate = row.date;
      }
    });
    return Object.values(map)
      .map((row) => ({
        ...row,
        repeatFlag: row.refunds >= 3 || row.totalRefundValue >= 50000,
      }))
      .sort((a, b) => b.totalRefundValue - a.totalRefundValue);
  }, [filteredRefundRows]);

  const kpis = useMemo(() => {
    const totalRefundsIssued = filteredRefundRows.length;
    const totalRefundValue = filteredRefundRows.reduce(
      (acc, row) => acc + Number(row.refundAmount || 0),
      0,
    );

    const salesCountPeriod = postedSalesRows.filter((sale) =>
      inDateRange(sale.created_at, rangeStart, rangeEnd),
    ).length;
    const refundRatePct = salesCountPeriod > 0 ? (totalRefundsIssued / salesCountPeriod) * 100 : 0;

    const mostReturnedProduct = refundByProductRows[0]?.product || "-";
    const repairRefundsCount = filteredRepairRefundRows.length;
    const avgTimeToRefundDays =
      filteredRefundRows.length > 0
        ? filteredRefundRows.reduce((acc, row) => acc + Number(row.daysToRefund || 0), 0) /
          filteredRefundRows.length
        : 0;
    const netRevenueImpact = totalRefundValue;
    return {
      totalRefundsIssued,
      totalRefundValue,
      refundRatePct,
      mostReturnedProduct,
      repairRefundsCount,
      avgTimeToRefundDays,
      netRevenueImpact,
    };
  }, [filteredRefundRows, filteredRepairRefundRows.length, postedSalesRows, rangeStart, rangeEnd, refundByProductRows]);

  const refundReasonDonutRows = useMemo(
    () => refundByReasonRows.map((row) => ({ name: row.reason, value: row.count })),
    [refundByReasonRows],
  );

  const refundTrendRows = useMemo(() => {
    const map = {};
    filteredRefundRows.forEach((row) => {
      const month = toMonthKey(row.date);
      if (!month) return;
      if (!map[month]) {
        map[month] = {
          month,
          label: MONTH_LABEL.format(new Date(`${month}-01T00:00:00`)),
          refundCount: 0,
          refundValue: 0,
        };
      }
      map[month].refundCount += 1;
      map[month].refundValue += Number(row.refundAmount || 0);
    });
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
  }, [filteredRefundRows]);

  const productRefundRateChartRows = useMemo(
    () =>
      refundByProductRows
        .slice(0, 10)
        .map((row) => ({
          product: row.product,
          refundRatePct: Number((row.refundRatePct || 0).toFixed(2)),
          refundValue: row.refundValue,
        })),
    [refundByProductRows],
  );

  const refundVsSalesRows = useMemo(() => {
    const map = {};
    refundTrendRows.forEach((row) => {
      map[row.month] = {
        month: row.month,
        label: row.label,
        refundValue: row.refundValue,
        salesRevenue: 0,
      };
    });
    postedSalesRows.forEach((sale) => {
      if (!inDateRange(sale.created_at, rangeStart, rangeEnd)) return;
      const month = toMonthKey(sale.created_at);
      if (!month) return;
      if (!map[month]) {
        map[month] = {
          month,
          label: MONTH_LABEL.format(new Date(`${month}-01T00:00:00`)),
          refundValue: 0,
          salesRevenue: 0,
        };
      }
      map[month].salesRevenue += Number(sale.total || 0);
    });
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
  }, [postedSalesRows, rangeStart, rangeEnd, refundTrendRows]);

  const selectedPayload = useMemo(() => {
    const payloads = {
      "product-returns": {
        exportColumns: [
          { label: "Refund ID", value: "refundId" },
          { label: "Date", value: "date" },
          { label: "Original Invoice", value: "originalRef" },
          { label: "Customer", value: "customer" },
          { label: "Product", value: "productOrDevice" },
          { label: "Original Amount", value: (row) => Number(row.originalAmount || 0) },
          { label: "Refund Amount", value: (row) => Number(row.refundAmount || 0) },
          { label: "Reason", value: "reason" },
          { label: "Processed By", value: "processedBy" },
          { label: "Status", value: "status" },
        ],
        exportRows: filteredProductReturnRows,
      },
      "repair-refunds": {
        exportColumns: [
          { label: "Refund ID", value: "refundId" },
          { label: "Date", value: "date" },
          { label: "Job No.", value: "originalRef" },
          { label: "Customer", value: "customer" },
          { label: "Device", value: "productOrDevice" },
          { label: "Original Amount", value: (row) => Number(row.originalAmount || 0) },
          { label: "Refund Amount", value: (row) => Number(row.refundAmount || 0) },
          { label: "Reason", value: "reason" },
          { label: "Processed By", value: "processedBy" },
          { label: "Status", value: "status" },
        ],
        exportRows: filteredRepairRefundRows,
      },
      "refund-by-product": {
        exportColumns: [
          { label: "Product", value: "product" },
          { label: "Category", value: "category" },
          { label: "Refund Count", value: (row) => Number(row.refundCount || 0) },
          { label: "Qty Returned", value: (row) => Number(row.qtyReturned || 0) },
          { label: "Refund Value", value: (row) => Number(row.refundValue || 0) },
          { label: "Sold Qty", value: (row) => Number(row.soldQty || 0) },
          { label: "Refund Rate %", value: (row) => Number((row.refundRatePct || 0).toFixed(2)) },
        ],
        exportRows: refundByProductRows,
      },
      "refund-by-reason": {
        exportColumns: [
          { label: "Reason", value: "reason" },
          { label: "Count", value: (row) => Number(row.count || 0) },
          { label: "Value", value: (row) => Number(row.value || 0) },
        ],
        exportRows: refundByReasonRows,
      },
      "staff-refund-log": {
        exportColumns: [
          { label: "Staff", value: "staff" },
          { label: "Total Refunds", value: (row) => Number(row.totalRefunds || 0) },
          { label: "Sale Refunds", value: (row) => Number(row.saleRefunds || 0) },
          { label: "Repair Refunds", value: (row) => Number(row.repairRefunds || 0) },
          { label: "Approved", value: (row) => Number(row.approved || 0) },
          { label: "Pending", value: (row) => Number(row.pending || 0) },
          { label: "Refund Value", value: (row) => Number(row.totalValue || 0) },
        ],
        exportRows: staffRefundRows,
      },
      "customer-refund-history": {
        exportColumns: [
          { label: "Customer", value: "customer" },
          { label: "Refund Count", value: (row) => Number(row.refunds || 0) },
          { label: "Sale Refunds", value: (row) => Number(row.saleRefunds || 0) },
          { label: "Repair Refunds", value: (row) => Number(row.repairRefunds || 0) },
          { label: "Refund Value", value: (row) => Number(row.totalRefundValue || 0) },
          { label: "Last Refund Date", value: "lastRefundDate" },
          { label: "Repeat Flag", value: (row) => (row.repeatFlag ? "Yes" : "No") },
        ],
        exportRows: customerRefundHistoryRows,
      },
    };
    return payloads[activeTab] || payloads["product-returns"];
  }, [
    activeTab,
    customerRefundHistoryRows,
    filteredProductReturnRows,
    filteredRepairRefundRows,
    refundByProductRows,
    refundByReasonRows,
    staffRefundRows,
  ]);

  useEffect(() => {
    if (!onPrepared) return;
    onPrepared({
      exportColumns: selectedPayload.exportColumns,
      exportRows: selectedPayload.exportRows,
    });
  }, [onPrepared, selectedPayload.exportColumns, selectedPayload.exportRows]);

  const renderTab = () => {
    if (activeTab === "product-returns") {
      return (
        <SectionCard title="Product Returns Log">
          <MiniTable
            columns={[
              { label: "Refund ID", value: "refundId" },
              { label: "Date", value: (row) => (row.date ? new Date(row.date).toLocaleDateString() : "-") },
              { label: "Original Invoice", value: "originalRef" },
              { label: "Customer", value: "customer" },
              { label: "Product", value: "productOrDevice" },
              { label: "Refund Amount", value: (row) => money(row.refundAmount) },
              { label: "Reason", value: "reason" },
              { label: "Processed By", value: "processedBy" },
              { label: "Status", value: (row) => <Badge tone={toneForStatus(row.status)}>{row.status}</Badge> },
            ]}
            rows={filteredProductReturnRows}
            emptyLabel="No product returns found."
          />
        </SectionCard>
      );
    }

    if (activeTab === "repair-refunds") {
      return (
        <SectionCard title="Repair Refunds Log">
          <MiniTable
            columns={[
              { label: "Refund ID", value: "refundId" },
              { label: "Date", value: (row) => (row.date ? new Date(row.date).toLocaleDateString() : "-") },
              { label: "Job No.", value: "originalRef" },
              { label: "Customer", value: "customer" },
              { label: "Device", value: "productOrDevice" },
              { label: "Original Amount", value: (row) => money(row.originalAmount) },
              { label: "Refund Amount", value: (row) => money(row.refundAmount) },
              { label: "Reason", value: "reason" },
              { label: "Processed By", value: "processedBy" },
              { label: "Status", value: (row) => <Badge tone={toneForStatus(row.status)}>{row.status}</Badge> },
            ]}
            rows={filteredRepairRefundRows}
            emptyLabel="No repair refunds found."
          />
        </SectionCard>
      );
    }

    if (activeTab === "refund-by-product") {
      return (
        <SectionCard title="Refund by Product">
          <MiniTable
            columns={[
              { label: "Product", value: "product" },
              { label: "Category", value: "category" },
              { label: "Refund Count", value: (row) => Number(row.refundCount || 0).toLocaleString() },
              { label: "Qty Returned", value: (row) => Number(row.qtyReturned || 0).toLocaleString() },
              { label: "Refund Value", value: (row) => money(row.refundValue) },
              { label: "Sold Qty", value: (row) => Number(row.soldQty || 0).toLocaleString() },
              { label: "Refund Rate", value: (row) => `${Number(row.refundRatePct || 0).toFixed(2)}%` },
            ]}
            rows={refundByProductRows}
            emptyLabel="No product refund metrics available."
          />
        </SectionCard>
      );
    }

    if (activeTab === "refund-by-reason") {
      return (
        <SectionCard title="Refund by Reason">
          <MiniTable
            columns={[
              { label: "Reason", value: "reason" },
              { label: "Count", value: (row) => Number(row.count || 0).toLocaleString() },
              { label: "Refund Value", value: (row) => money(row.value) },
            ]}
            rows={refundByReasonRows}
            emptyLabel="No reason distribution available."
          />
        </SectionCard>
      );
    }

    if (activeTab === "staff-refund-log") {
      return (
        <SectionCard title="Staff Refund Log">
          <MiniTable
            columns={[
              { label: "Staff", value: "staff" },
              { label: "Total Refunds", value: (row) => Number(row.totalRefunds || 0).toLocaleString() },
              { label: "Sale Refunds", value: (row) => Number(row.saleRefunds || 0).toLocaleString() },
              { label: "Repair Refunds", value: (row) => Number(row.repairRefunds || 0).toLocaleString() },
              { label: "Approved", value: (row) => Number(row.approved || 0).toLocaleString() },
              { label: "Pending", value: (row) => Number(row.pending || 0).toLocaleString() },
              { label: "Refund Value", value: (row) => money(row.totalValue) },
            ]}
            rows={staffRefundRows}
            emptyLabel="No staff refund activity found."
          />
        </SectionCard>
      );
    }

    return (
      <SectionCard title="Customer Refund History">
        <MiniTable
          columns={[
            { label: "Customer", value: "customer" },
            { label: "Refund Count", value: (row) => Number(row.refunds || 0).toLocaleString() },
            { label: "Sale Refunds", value: (row) => Number(row.saleRefunds || 0).toLocaleString() },
            { label: "Repair Refunds", value: (row) => Number(row.repairRefunds || 0).toLocaleString() },
            { label: "Total Refund Value", value: (row) => money(row.totalRefundValue) },
            { label: "Last Refund", value: (row) => (row.lastRefundDate ? new Date(row.lastRefundDate).toLocaleDateString() : "-") },
            {
              label: "Repeat Flag",
              value: (row) => <Badge tone={row.repeatFlag ? "red" : "green"}>{row.repeatFlag ? "Flagged" : "Normal"}</Badge>,
            },
          ]}
          rows={customerRefundHistoryRows}
          emptyLabel="No customer refund history found."
        />
      </SectionCard>
    );
  };

  return (
    <div className="space-y-3">
      <SectionCard title="Refund Filters">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2">
          <input
            type="date"
            value={rangeFrom}
            onChange={(event) => setRangeFrom(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
            aria-label="Refund from date"
          />
          <input
            type="date"
            value={rangeTo}
            onChange={(event) => setRangeTo(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
            aria-label="Refund to date"
          />
          <Select
            value={productFilter}
            onChange={(event) => setProductFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          >
            <option value="all">Product / Category: All</option>
            {filterOptions.products.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
          <Select
            value={refundTypeFilter}
            onChange={(event) => setRefundTypeFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          >
            <option value="all">Refund Type: All</option>
            <option value="sale">Sale</option>
            <option value="repair">Repair</option>
          </Select>
          <Select
            value={reasonFilter}
            onChange={(event) => setReasonFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          >
            <option value="all">Reason: All</option>
            {filterOptions.reasons.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
          <Select
            value={processedByFilter}
            onChange={(event) => setProcessedByFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          >
            <option value="all">Processed By: All</option>
            {filterOptions.processedBy.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
          <Select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs xl:col-span-2"
          >
            <option value="all">Status: All</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
          </Select>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <KpiCard title="Total Refunds Issued" value={kpis.totalRefundsIssued.toLocaleString()} icon={<RotateCcw size={18} />} />
        <KpiCard title="Total Refund Value (LKR)" value={money(kpis.totalRefundValue)} icon={<HandCoins size={18} />} tone="red" />
        <KpiCard title="Refund Rate %" value={`${kpis.refundRatePct.toFixed(2)}%`} icon={<TrendingDown size={18} />} tone="amber" />
        <KpiCard title="Most Returned Product" value={kpis.mostReturnedProduct} icon={<BarChart3 size={18} />} tone="indigo" />
        <KpiCard title="Repair Refunds Count" value={kpis.repairRefundsCount.toLocaleString()} icon={<Repeat size={18} />} tone="amber" />
        <KpiCard title="Avg Time to Refund (days)" value={kpis.avgTimeToRefundDays.toFixed(1)} icon={<Timer size={18} />} tone="green" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <SectionCard title="Refund Reasons Distribution">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={refundReasonDonutRows} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} stroke="none">
                  {refundReasonDonutRows.map((entry, index) => (
                    <Cell key={`${entry.name}-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Refund Trend (Monthly)">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={refundTrendRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="label" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip formatter={(value, name) => (name === "refundValue" ? money(value) : value)} />
                <Line type="monotone" dataKey="refundValue" stroke="#ef4444" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="refundCount" stroke="#38bdf8" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Product Refund Rate (Top 10)">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={productRefundRateChartRows} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis type="number" stroke="#94a3b8" />
                <YAxis type="category" dataKey="product" width={130} stroke="#94a3b8" />
                <Tooltip formatter={(value, name) => (name === "refundRatePct" ? `${value}%` : money(value))} />
                <Bar dataKey="refundRatePct" fill="#f59e0b" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Refund Value vs Sales Revenue">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={refundVsSalesRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="label" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip formatter={(value) => money(value)} />
                <Line type="monotone" dataKey="salesRevenue" stroke="#22c55e" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="refundValue" stroke="#ef4444" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Refunds Log">
        <MiniTable
          columns={[
            { label: "Refund ID", value: "refundId" },
            { label: "Date", value: (row) => (row.date ? new Date(row.date).toLocaleString() : "-") },
            { label: "Original Invoice/Job No.", value: "originalRef" },
            { label: "Customer", value: "customer" },
            { label: "Product/Device", value: "productOrDevice" },
            { label: "Refund Type", value: "refundType" },
            { label: "Original Amount", value: (row) => money(row.originalAmount) },
            { label: "Refund Amount", value: (row) => money(row.refundAmount) },
            { label: "Reason", value: "reason" },
            { label: "Processed By", value: "processedBy" },
            { label: "Status", value: (row) => <Badge tone={toneForStatus(row.status)}>{row.status}</Badge> },
            {
              label: "Actions",
              value: (row) => (
                <Button size="sm" variant="ghost">
                  View
                </Button>
              ),
            },
          ]}
          rows={filteredRefundRows}
          emptyLabel="No refunds found for selected filters."
        />
      </SectionCard>

      <SectionCard title="Refund Sub-Reports">
        <div className="flex flex-wrap gap-2">
          {SUB_TABS.map((tab) => (
            <button
              key={tab.key}
              className={`btn btn-xs ${activeTab === tab.key ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Includes repeat refund flags and workflow fields (`processed by`, `approved by`) for accountability.
        </p>
      </SectionCard>

      {renderTab()}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <SectionCard title="Approval Workflow Notes">
          <p className="text-xs text-slate-300 leading-relaxed">
            Refund approvals are inferred from available return/cancellation records. Integrate explicit approval logs
            to enforce multi-step approval tracking.
          </p>
        </SectionCard>
        <SectionCard title="Revenue Impact">
          <div className="flex items-center gap-2">
            <BadgeAlert size={16} className="text-rose-300" />
            <p className="text-xs text-slate-200">
              Refund impact on net revenue for selected filters: <b>{money(kpis.netRevenueImpact)}</b>
            </p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}


