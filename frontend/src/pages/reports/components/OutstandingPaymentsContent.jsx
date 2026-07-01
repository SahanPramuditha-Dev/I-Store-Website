import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  HandCoins,
  ShieldAlert,
  Timer,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge, Button, KpiCard, SectionCard, Table, Select } from "../../../components/UI";

const DAY_MS = 1000 * 60 * 60 * 24;
const MONEY_LOCALE = "en-LK";
const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" });
const AGING_BUCKETS = ["0-30d", "31-60d", "61-90d", "90d+"];
const AGING_COLORS = ["#22c55e", "#f59e0b", "#f97316", "#ef4444"];
const SUB_REPORT_TABS = [
  { key: "sales", label: "Outstanding Sales" },
  { key: "repairs", label: "Outstanding Repairs" },
  { key: "customer-summary", label: "Customer Summary" },
  { key: "payment-history", label: "Payment History" },
  { key: "aging-analysis", label: "Aging Analysis" },
  { key: "collection-efficiency", label: "Collection Efficiency" },
  { key: "risk-classification", label: "Risk Classification" },
  { key: "reminder-log", label: "SMS/Reminder Log" },
  { key: "write-off", label: "Write-off Report" },
  { key: "promise-tracker", label: "Payment Promise Tracker" },
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

function agingBucket(days) {
  if (days <= 30) return "0-30d";
  if (days <= 60) return "31-60d";
  if (days <= 90) return "61-90d";
  return "90d+";
}

function paymentStatusFor(balance, paidAmount, daysOutstanding) {
  if (balance <= 0) return "Paid";
  if (daysOutstanding > 30) return "Overdue";
  if (paidAmount > 0) return "Partial";
  return "Pending";
}

function paymentMethodForSale(row) {
  const cash = Number(row.cash_amount || 0);
  const card = Number(row.card_amount || 0);
  const method = String(row.payment_method || "").toLowerCase();
  if (cash > 0 && card > 0) return "Mixed";
  if (cash > 0) return "Cash";
  if (card > 0 || method.includes("card") || method.includes("bank")) return "Card/Bank";
  if (method.includes("credit") || method.includes("due") || method.includes("partial")) return "Credit";
  return row.payment_method || "Unknown";
}

function customerRisk({ invoices, balance, maxDaysOverdue, overdueInvoices }) {
  if (maxDaysOverdue > 90 || (balance > 100000 && overdueInvoices > 1)) return "High";
  if (maxDaysOverdue > 30 || balance > 30000 || overdueInvoices > 0) return "Medium";
  if (invoices > 2 && balance > 10000) return "Medium";
  return "Low";
}

function riskTone(level) {
  if (level === "High") return "red";
  if (level === "Medium") return "amber";
  return "green";
}

function paymentTone(status) {
  if (status === "Overdue") return "red";
  if (status === "Partial") return "amber";
  if (status === "Pending") return "indigo";
  return "green";
}

function extractPromiseDate(text) {
  const source = String(text || "");
  const isoDate = source.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoDate?.[1]) return isoDate[1];
  return "";
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

export default function OutstandingPaymentsContent({
  salesRows,
  repairRows,
  customersRows,
  notificationsRows,
  dateFrom,
  dateTo,
  query,
  onPrepared,
}) {
  const navigate = useNavigate();
  const [activeSubReport, setActiveSubReport] = useState("sales");
  const [rangeFrom, setRangeFrom] = useState(dateFrom || "");
  const [rangeTo, setRangeTo] = useState(dateTo || "");
  const [customerFilter, setCustomerFilter] = useState("");
  const [invoiceTypeFilter, setInvoiceTypeFilter] = useState("all");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("all");
  const [agingFilter, setAgingFilter] = useState("all");

  useEffect(() => {
    setRangeFrom(dateFrom || "");
    setRangeTo(dateTo || "");
  }, [dateFrom, dateTo]);

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

  const rangeStart = useMemo(() => parseDateInput(rangeFrom), [rangeFrom]);
  const rangeEnd = useMemo(() => parseDateInput(rangeTo, true), [rangeTo]);
  const normalizedGlobalQuery = (query || "").trim().toLowerCase();
  const normalizedCustomerFilter = customerFilter.trim().toLowerCase();

  const salesOutstandingRaw = useMemo(() => {
    return (salesRows || [])
      .filter((sale) => !sale.is_voided && !sale.is_return && Number(sale.total || 0) > 0)
      .map((sale) => {
        const total = Math.max(0, Number(sale.total || 0));
        const creditAmount = Math.max(0, Number(sale.credit_amount || 0));
        const cashAmount = Math.max(0, Number(sale.cash_amount || 0));
        const cardAmount = Math.max(0, Number(sale.card_amount || 0));
        const paidAmount = Math.min(total, Math.max(0, total - creditAmount) || cashAmount + cardAmount);
        const balance = Math.max(0, total - paidAmount);
        const customerName = sale.customer_name || customersById[String(sale.customer_id)] || "Walk-in";
        const daysOutstanding = daysSince(sale.created_at);
        const status = paymentStatusFor(balance, paidAmount, daysOutstanding);
        return {
          id: sale.id,
          type: "Sale",
          reference: sale.invoice_no || `INV-${sale.id}`,
          date: sale.created_at,
          customerId: String(sale.customer_id ?? "walk-in"),
          customer: customerName,
          total,
          paid: paidAmount,
          balance,
          daysOutstanding,
          agingBucket: agingBucket(daysOutstanding),
          paymentStatus: status,
          cashier: sale.cashier || "N/A",
          method: paymentMethodForSale(sale),
          receivedBy: sale.cashier || "Front Desk",
          collectable: balance > 0,
        };
      })
      .filter((row) => row.balance > 0);
  }, [customersById, salesRows]);

  const repairOutstandingRaw = useMemo(() => {
    return (repairRows || [])
      .filter((repair) => Number(repair.invoice_amount ?? repair.estimated_cost ?? 0) > 0)
      .map((repair) => {
        const total = Math.max(0, Number(repair.invoice_amount ?? repair.estimated_cost ?? 0));
        const paidAmount = Math.max(0, Number(repair.advance_payment || 0));
        const balance = Math.max(0, total - paidAmount);
        const customerName = repair.customer_name || customersById[String(repair.customer_id)] || "Unknown";
        const daysOutstanding = daysSince(repair.created_at);
        const status = paymentStatusFor(balance, paidAmount, daysOutstanding);
        return {
          id: repair.id,
          type: "Repair",
          reference: repair.ticket_no || `JOB-${repair.id}`,
          date: repair.created_at,
          customerId: String(repair.customer_id ?? "unknown"),
          customer: customerName,
          device: repair.device || "-",
          technician: repair.technician || "Unassigned",
          total,
          paid: Math.min(total, paidAmount),
          balance,
          daysOutstanding,
          agingBucket: agingBucket(daysOutstanding),
          paymentStatus: status,
          method: "Advance Payment",
          receivedBy: repair.technician || "Front Desk",
          collectable: balance > 0,
        };
      })
      .filter((row) => row.balance > 0);
  }, [customersById, repairRows]);

  const customerOptions = useMemo(() => {
    const names = new Set();
    [...salesOutstandingRaw, ...repairOutstandingRaw].forEach((row) => {
      names.add(row.customer);
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [repairOutstandingRaw, salesOutstandingRaw]);

  const matchesBaseFilters = (row) => {
    if (!inDateRange(row.date, rangeStart, rangeEnd)) return false;
    if (invoiceTypeFilter !== "all" && row.type.toLowerCase() !== invoiceTypeFilter) return false;
    if (paymentStatusFilter !== "all" && row.paymentStatus.toLowerCase() !== paymentStatusFilter) return false;
    if (agingFilter !== "all" && row.agingBucket !== agingFilter) return false;

    const haystack = `${row.customer || ""} ${row.customerId || ""} ${row.reference || ""}`.toLowerCase();
    if (normalizedCustomerFilter && !haystack.includes(normalizedCustomerFilter)) return false;
    if (normalizedGlobalQuery && !haystack.includes(normalizedGlobalQuery)) return false;
    return true;
  };

  const outstandingSalesRows = useMemo(
    () => salesOutstandingRaw.filter(matchesBaseFilters).sort((a, b) => new Date(b.date) - new Date(a.date)),
    [salesOutstandingRaw, rangeStart, rangeEnd, invoiceTypeFilter, paymentStatusFilter, agingFilter, normalizedCustomerFilter, normalizedGlobalQuery],
  );

  const outstandingRepairRows = useMemo(
    () => repairOutstandingRaw.filter(matchesBaseFilters).sort((a, b) => new Date(b.date) - new Date(a.date)),
    [repairOutstandingRaw, rangeStart, rangeEnd, invoiceTypeFilter, paymentStatusFilter, agingFilter, normalizedCustomerFilter, normalizedGlobalQuery],
  );

  const combinedOutstandingRows = useMemo(
    () => [...outstandingSalesRows, ...outstandingRepairRows].sort((a, b) => new Date(b.date) - new Date(a.date)),
    [outstandingRepairRows, outstandingSalesRows],
  );

  const paymentHistoryRows = useMemo(() => {
    const salePayments = (salesRows || [])
      .filter((sale) => !sale.is_voided && !sale.is_return && Number(sale.total || 0) > 0)
      .map((sale) => {
        const total = Math.max(0, Number(sale.total || 0));
        const creditAmount = Math.max(0, Number(sale.credit_amount || 0));
        const paidAmount = Math.max(0, total - creditAmount);
        return {
          id: `sale-${sale.id}`,
          date: sale.created_at,
          customerId: String(sale.customer_id ?? "walk-in"),
          customer: sale.customer_name || customersById[String(sale.customer_id)] || "Walk-in",
          invoiceRef: sale.invoice_no || `INV-${sale.id}`,
          amountCollected: paidAmount,
          method: paymentMethodForSale(sale),
          receivedBy: sale.cashier || "Front Desk",
          type: "sale",
        };
      })
      .filter((row) => row.amountCollected > 0);

    const repairPayments = (repairRows || [])
      .map((repair) => {
        const collected = Math.max(0, Number(repair.advance_payment || 0));
        return {
          id: `repair-${repair.id}`,
          date: repair.created_at,
          customerId: String(repair.customer_id ?? "unknown"),
          customer: repair.customer_name || customersById[String(repair.customer_id)] || "Unknown",
          invoiceRef: repair.ticket_no || `JOB-${repair.id}`,
          amountCollected: collected,
          method: "Advance Payment",
          receivedBy: repair.technician || "Front Desk",
          type: "repair",
        };
      })
      .filter((row) => row.amountCollected > 0);

    return [...salePayments, ...repairPayments]
      .filter((row) => {
        if (!inDateRange(row.date, rangeStart, rangeEnd)) return false;
        if (invoiceTypeFilter !== "all" && row.type !== invoiceTypeFilter) return false;
        const hay = `${row.customer} ${row.customerId} ${row.invoiceRef}`.toLowerCase();
        if (normalizedCustomerFilter && !hay.includes(normalizedCustomerFilter)) return false;
        if (normalizedGlobalQuery && !hay.includes(normalizedGlobalQuery)) return false;
        return true;
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [
    customersById,
    invoiceTypeFilter,
    normalizedCustomerFilter,
    normalizedGlobalQuery,
    rangeEnd,
    rangeStart,
    repairRows,
    salesRows,
  ]);

  const customerSummaryRows = useMemo(() => {
    const grouped = {};
    combinedOutstandingRows.forEach((row) => {
      if (!grouped[row.customerId]) {
        grouped[row.customerId] = {
          customerId: row.customerId,
          customer: row.customer,
          invoices: 0,
          totalBilled: 0,
          totalPaid: 0,
          balance: 0,
          maxDaysOverdue: 0,
          overdueInvoices: 0,
          lastPaymentDate: "",
        };
      }
      grouped[row.customerId].invoices += 1;
      grouped[row.customerId].totalBilled += row.total;
      grouped[row.customerId].totalPaid += row.paid;
      grouped[row.customerId].balance += row.balance;
      grouped[row.customerId].maxDaysOverdue = Math.max(
        grouped[row.customerId].maxDaysOverdue,
        row.daysOutstanding,
      );
      if (row.paymentStatus === "Overdue") grouped[row.customerId].overdueInvoices += 1;
    });

    paymentHistoryRows.forEach((payment) => {
      const target = grouped[payment.customerId];
      if (!target) return;
      if (!target.lastPaymentDate || new Date(payment.date) > new Date(target.lastPaymentDate)) {
        target.lastPaymentDate = payment.date;
      }
    });

    return Object.values(grouped)
      .map((row) => ({
        ...row,
        riskLevel: customerRisk(row),
      }))
      .sort((a, b) => b.balance - a.balance);
  }, [combinedOutstandingRows, paymentHistoryRows]);

  const reminderLogRows = useMemo(() => {
    const customerNames = Object.values(customersById).map((name) => String(name || ""));
    return (notificationsRows || [])
      .filter((log) => {
        const text = `${log.type || ""} ${log.title || ""} ${log.message || ""}`.toLowerCase();
        return (
          text.includes("payment") ||
          text.includes("due") ||
          text.includes("outstanding") ||
          text.includes("reminder")
        );
      })
      .filter((log) => inDateRange(log.created_at, rangeStart, rangeEnd))
      .map((log) => {
        const message = `${log.title || ""} ${log.message || ""}`.trim();
        const matchedCustomer =
          customerNames.find((name) => message.toLowerCase().includes(name.toLowerCase())) || "Unknown";
        return {
          id: log.id,
          date: log.created_at,
          customer: matchedCustomer,
          message: message || "Payment reminder",
          channel: "SMS / System",
          status: log.is_read ? "Delivered" : "Queued",
          rawType: log.type || "Reminder",
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [customersById, notificationsRows, rangeEnd, rangeStart]);

  const writeOffRows = useMemo(() => {
    return combinedOutstandingRows
      .filter((row) => row.daysOutstanding >= 180)
      .map((row) => ({
        id: `${row.type}-${row.id}`,
        date: row.date,
        customer: row.customer,
        invoiceRef: row.reference,
        type: row.type,
        balance: row.balance,
        daysOverdue: row.daysOutstanding,
        status: "Candidate",
        reason: "Aged outstanding balance (180+ days)",
      }))
      .sort((a, b) => b.balance - a.balance);
  }, [combinedOutstandingRows]);

  const promiseTrackerRows = useMemo(() => {
    return reminderLogRows
      .filter((log) => {
        const text = `${log.rawType || ""} ${log.message || ""}`.toLowerCase();
        return text.includes("promise") || text.includes("promised") || text.includes("pay by");
      })
      .map((log) => ({
        id: log.id,
        customer: log.customer,
        invoiceRef: "Multiple / Message",
        promisedDate: extractPromiseDate(log.message),
        loggedAt: log.date,
        status: log.status === "Delivered" ? "Pending Confirmation" : "Queued",
        note: log.message,
      }))
      .sort((a, b) => new Date(b.loggedAt) - new Date(a.loggedAt));
  }, [reminderLogRows]);

  const agingBucketRows = useMemo(() => {
    const map = {
      "0-30d": { bucket: "0-30d", total: 0, sales: 0, repairs: 0 },
      "31-60d": { bucket: "31-60d", total: 0, sales: 0, repairs: 0 },
      "61-90d": { bucket: "61-90d", total: 0, sales: 0, repairs: 0 },
      "90d+": { bucket: "90d+", total: 0, sales: 0, repairs: 0 },
    };
    combinedOutstandingRows.forEach((row) => {
      const target = map[row.agingBucket];
      if (!target) return;
      target.total += row.balance;
      if (row.type === "Sale") target.sales += row.balance;
      else target.repairs += row.balance;
    });
    return AGING_BUCKETS.map((bucket) => map[bucket]);
  }, [combinedOutstandingRows]);

  const customerOutstandingChartRows = useMemo(() => {
    const map = {};
    combinedOutstandingRows.forEach((row) => {
      if (!map[row.customer]) map[row.customer] = { customer: row.customer, balance: 0, invoices: 0 };
      map[row.customer].balance += row.balance;
      map[row.customer].invoices += 1;
    });
    return Object.values(map)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 10);
  }, [combinedOutstandingRows]);

  const collectionRateTrendRows = useMemo(() => {
    const monthly = {};

    (salesRows || [])
      .filter((sale) => !sale.is_voided && !sale.is_return && Number(sale.total || 0) > 0)
      .forEach((sale) => {
        if (!inDateRange(sale.created_at, rangeStart, rangeEnd)) return;
        const customerName = sale.customer_name || customersById[String(sale.customer_id)] || "Walk-in";
        const hay = `${customerName} ${sale.customer_id || ""} ${sale.invoice_no || ""}`.toLowerCase();
        if (normalizedCustomerFilter && !hay.includes(normalizedCustomerFilter)) return;
        if (normalizedGlobalQuery && !hay.includes(normalizedGlobalQuery)) return;
        if (invoiceTypeFilter === "repair") return;

        const month = toMonthKey(sale.created_at);
        if (!month) return;
        if (!monthly[month]) monthly[month] = { month, billed: 0, collected: 0 };

        const total = Math.max(0, Number(sale.total || 0));
        const credit = Math.max(0, Number(sale.credit_amount || 0));
        const paid = Math.max(0, total - credit);

        monthly[month].billed += total;
        monthly[month].collected += Math.min(total, paid);
      });

    (repairRows || []).forEach((repair) => {
      if (!inDateRange(repair.created_at, rangeStart, rangeEnd)) return;
      if (invoiceTypeFilter === "sale") return;
      const customerName = repair.customer_name || customersById[String(repair.customer_id)] || "Unknown";
      const hay = `${customerName} ${repair.customer_id || ""} ${repair.ticket_no || ""}`.toLowerCase();
      if (normalizedCustomerFilter && !hay.includes(normalizedCustomerFilter)) return;
      if (normalizedGlobalQuery && !hay.includes(normalizedGlobalQuery)) return;

      const month = toMonthKey(repair.created_at);
      if (!month) return;
      if (!monthly[month]) monthly[month] = { month, billed: 0, collected: 0 };

      const total = Math.max(0, Number(repair.invoice_amount ?? repair.estimated_cost ?? 0));
      const paid = Math.max(0, Number(repair.advance_payment || 0));
      monthly[month].billed += total;
      monthly[month].collected += Math.min(total, paid);
    });

    return Object.values(monthly)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((row) => ({
        ...row,
        label: MONTH_LABEL.format(new Date(`${row.month}-01T00:00:00`)),
        rate: row.billed > 0 ? (row.collected / row.billed) * 100 : 0,
      }));
  }, [
    customersById,
    invoiceTypeFilter,
    normalizedCustomerFilter,
    normalizedGlobalQuery,
    rangeEnd,
    rangeStart,
    repairRows,
    salesRows,
  ]);

  const salesVsRepairOutstandingRows = useMemo(() => agingBucketRows, [agingBucketRows]);

  const totalOutstandingSales = useMemo(
    () => outstandingSalesRows.reduce((sum, row) => sum + Number(row.balance || 0), 0),
    [outstandingSalesRows],
  );
  const totalOutstandingRepairs = useMemo(
    () => outstandingRepairRows.reduce((sum, row) => sum + Number(row.balance || 0), 0),
    [outstandingRepairRows],
  );
  const totalOutstandingAll = totalOutstandingSales + totalOutstandingRepairs;

  const customersWithOverdueBalances = useMemo(
    () =>
      new Set(
        combinedOutstandingRows
          .filter((row) => row.paymentStatus === "Overdue")
          .map((row) => row.customerId),
      ).size,
    [combinedOutstandingRows],
  );

  const oldestUnpaidInvoiceDays = useMemo(
    () => combinedOutstandingRows.reduce((max, row) => Math.max(max, Number(row.daysOutstanding || 0)), 0),
    [combinedOutstandingRows],
  );

  const amountCollectedThisMonth = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return paymentHistoryRows
      .filter((row) => inDateRange(row.date, start, end))
      .reduce((sum, row) => sum + Number(row.amountCollected || 0), 0);
  }, [paymentHistoryRows]);

  const collectionEfficiencyRows = useMemo(
    () =>
      collectionRateTrendRows.map((row) => ({
        month: row.label,
        totalBilled: row.billed,
        totalCollected: row.collected,
        collectionRatePct: row.rate,
      })),
    [collectionRateTrendRows],
  );

  const agingAnalysisRows = useMemo(
    () =>
      agingBucketRows.map((row) => ({
        bucket: row.bucket,
        salesOutstanding: row.sales,
        repairOutstanding: row.repairs,
        totalOutstanding: row.total,
      })),
    [agingBucketRows],
  );

  const selectedSubReportPayload = useMemo(() => {
    const salesColumns = [
      { label: "Invoice No.", value: "reference" },
      { label: "Date", value: "date" },
      { label: "Customer", value: "customer" },
      { label: "Total", value: (row) => Number(row.total || 0) },
      { label: "Paid", value: (row) => Number(row.paid || 0) },
      { label: "Balance", value: (row) => Number(row.balance || 0) },
      { label: "Days Overdue", value: (row) => Number(row.daysOutstanding || 0) },
      { label: "Cashier", value: (row) => row.cashier || "N/A" },
      { label: "Status", value: "paymentStatus" },
    ];

    const repairColumns = [
      { label: "Job ID", value: "reference" },
      { label: "Date", value: "date" },
      { label: "Customer", value: "customer" },
      { label: "Device", value: (row) => row.device || "-" },
      { label: "Total", value: (row) => Number(row.total || 0) },
      { label: "Paid", value: (row) => Number(row.paid || 0) },
      { label: "Balance", value: (row) => Number(row.balance || 0) },
      { label: "Days Overdue", value: (row) => Number(row.daysOutstanding || 0) },
      { label: "Technician", value: (row) => row.technician || "Unassigned" },
      { label: "Status", value: "paymentStatus" },
    ];

    const payloads = {
      sales: { exportColumns: salesColumns, exportRows: outstandingSalesRows },
      repairs: { exportColumns: repairColumns, exportRows: outstandingRepairRows },
      "customer-summary": {
        exportColumns: [
          { label: "Customer", value: "customer" },
          { label: "# Invoices", value: (row) => Number(row.invoices || 0) },
          { label: "Total Billed", value: (row) => Number(row.totalBilled || 0) },
          { label: "Total Paid", value: (row) => Number(row.totalPaid || 0) },
          { label: "Balance", value: (row) => Number(row.balance || 0) },
          { label: "Last Payment Date", value: (row) => row.lastPaymentDate || "-" },
          { label: "Risk Level", value: "riskLevel" },
        ],
        exportRows: customerSummaryRows,
      },
      "payment-history": {
        exportColumns: [
          { label: "Date", value: "date" },
          { label: "Customer", value: "customer" },
          { label: "Invoice Ref", value: "invoiceRef" },
          { label: "Amount Collected", value: (row) => Number(row.amountCollected || 0) },
          { label: "Method", value: "method" },
          { label: "Received By", value: "receivedBy" },
        ],
        exportRows: paymentHistoryRows,
      },
      "aging-analysis": {
        exportColumns: [
          { label: "Aging Bucket", value: "bucket" },
          { label: "Sales Outstanding", value: (row) => Number(row.salesOutstanding || 0) },
          { label: "Repair Outstanding", value: (row) => Number(row.repairOutstanding || 0) },
          { label: "Total Outstanding", value: (row) => Number(row.totalOutstanding || 0) },
        ],
        exportRows: agingAnalysisRows,
      },
      "collection-efficiency": {
        exportColumns: [
          { label: "Month", value: "month" },
          { label: "Total Billed", value: (row) => Number(row.totalBilled || 0) },
          { label: "Total Collected", value: (row) => Number(row.totalCollected || 0) },
          { label: "Collection Rate %", value: (row) => Number((row.collectionRatePct || 0).toFixed(2)) },
        ],
        exportRows: collectionEfficiencyRows,
      },
      "risk-classification": {
        exportColumns: [
          { label: "Customer", value: "customer" },
          { label: "Invoices", value: (row) => Number(row.invoices || 0) },
          { label: "Balance", value: (row) => Number(row.balance || 0) },
          { label: "Max Days Overdue", value: (row) => Number(row.maxDaysOverdue || 0) },
          { label: "Overdue Invoices", value: (row) => Number(row.overdueInvoices || 0) },
          { label: "Risk Level", value: "riskLevel" },
        ],
        exportRows: customerSummaryRows,
      },
      "reminder-log": {
        exportColumns: [
          { label: "Date", value: "date" },
          { label: "Customer", value: "customer" },
          { label: "Channel", value: "channel" },
          { label: "Message", value: "message" },
          { label: "Status", value: "status" },
        ],
        exportRows: reminderLogRows,
      },
      "write-off": {
        exportColumns: [
          { label: "Date", value: "date" },
          { label: "Customer", value: "customer" },
          { label: "Invoice Ref", value: "invoiceRef" },
          { label: "Type", value: "type" },
          { label: "Balance", value: (row) => Number(row.balance || 0) },
          { label: "Days Overdue", value: (row) => Number(row.daysOverdue || 0) },
          { label: "Status", value: "status" },
          { label: "Reason", value: "reason" },
        ],
        exportRows: writeOffRows,
      },
      "promise-tracker": {
        exportColumns: [
          { label: "Logged At", value: "loggedAt" },
          { label: "Customer", value: "customer" },
          { label: "Invoice Ref", value: "invoiceRef" },
          { label: "Promised Date", value: "promisedDate" },
          { label: "Status", value: "status" },
          { label: "Note", value: "note" },
        ],
        exportRows: promiseTrackerRows,
      },
    };
    return payloads[activeSubReport] || payloads.sales;
  }, [
    activeSubReport,
    agingAnalysisRows,
    collectionEfficiencyRows,
    customerSummaryRows,
    outstandingRepairRows,
    outstandingSalesRows,
    paymentHistoryRows,
    promiseTrackerRows,
    reminderLogRows,
    writeOffRows,
  ]);

  useEffect(() => {
    if (!onPrepared) return;
    onPrepared({
      exportColumns: selectedSubReportPayload.exportColumns,
      exportRows: selectedSubReportPayload.exportRows,
    });
  }, [onPrepared, selectedSubReportPayload.exportColumns, selectedSubReportPayload.exportRows]);

  const renderSubReport = () => {
    if (activeSubReport === "sales") {
      return (
        <SectionCard title="Outstanding Sales Invoices">
          <MiniTable
            columns={[
              { label: "Invoice No.", value: "reference" },
              { label: "Date", value: (row) => new Date(row.date).toLocaleDateString() },
              { label: "Customer", value: "customer" },
              { label: "Total", value: (row) => money(row.total) },
              { label: "Paid", value: (row) => money(row.paid) },
              { label: "Balance", value: (row) => money(row.balance) },
              { label: "Days Overdue", value: (row) => Number(row.daysOutstanding || 0).toLocaleString() },
              { label: "Cashier", value: (row) => row.cashier || "N/A" },
              {
                label: "Action",
                value: (row) => (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => navigate("/pos")}>
                      Collect
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => navigate("/reports/sales")}>
                      View
                    </Button>
                  </div>
                ),
              },
            ]}
            rows={outstandingSalesRows}
            emptyLabel="No outstanding sales invoices."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "repairs") {
      return (
        <SectionCard title="Outstanding Repair Jobs">
          <MiniTable
            columns={[
              { label: "Job ID", value: "reference" },
              { label: "Date", value: (row) => new Date(row.date).toLocaleDateString() },
              { label: "Customer", value: "customer" },
              { label: "Device", value: (row) => row.device || "-" },
              { label: "Total", value: (row) => money(row.total) },
              { label: "Paid", value: (row) => money(row.paid) },
              { label: "Balance", value: (row) => money(row.balance) },
              { label: "Days Overdue", value: (row) => Number(row.daysOutstanding || 0).toLocaleString() },
              { label: "Technician", value: (row) => row.technician || "Unassigned" },
              {
                label: "Action",
                value: () => (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => navigate("/repairs")}>
                      Collect
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => navigate("/repairs")}>
                      View
                    </Button>
                  </div>
                ),
              },
            ]}
            rows={outstandingRepairRows}
            emptyLabel="No outstanding repair balances."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "customer-summary") {
      return (
        <SectionCard title="Customer Balance Summary">
          <MiniTable
            columns={[
              { label: "Customer", value: "customer" },
              { label: "# Invoices", value: (row) => Number(row.invoices || 0).toLocaleString() },
              { label: "Total Billed", value: (row) => money(row.totalBilled) },
              { label: "Total Paid", value: (row) => money(row.totalPaid) },
              { label: "Balance", value: (row) => money(row.balance) },
              {
                label: "Last Payment Date",
                value: (row) =>
                  row.lastPaymentDate ? new Date(row.lastPaymentDate).toLocaleDateString() : "-",
              },
              {
                label: "Risk Level",
                value: (row) => <Badge tone={riskTone(row.riskLevel)}>{row.riskLevel}</Badge>,
              },
            ]}
            rows={customerSummaryRows}
            emptyLabel="No customer balances found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "payment-history") {
      return (
        <SectionCard title="Payment History Log">
          <MiniTable
            columns={[
              { label: "Date", value: (row) => new Date(row.date).toLocaleString() },
              { label: "Customer", value: "customer" },
              { label: "Invoice Ref", value: "invoiceRef" },
              { label: "Amount Collected", value: (row) => money(row.amountCollected) },
              { label: "Method", value: "method" },
              { label: "Received By", value: "receivedBy" },
            ]}
            rows={paymentHistoryRows}
            emptyLabel="No payment collection logs available."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "aging-analysis") {
      return (
        <SectionCard title="Aging Analysis Report" subtitle="Standard 30/60/90/90+ bucket totals">
          <MiniTable
            columns={[
              { label: "Bucket", value: "bucket" },
              { label: "Sales Outstanding", value: (row) => money(row.salesOutstanding) },
              { label: "Repair Outstanding", value: (row) => money(row.repairOutstanding) },
              { label: "Total Outstanding", value: (row) => money(row.totalOutstanding) },
            ]}
            rows={agingAnalysisRows}
            emptyLabel="No aging analysis rows."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "collection-efficiency") {
      return (
        <SectionCard title="Collection Efficiency Rate" subtitle="% of billed amount collected per month">
          <MiniTable
            columns={[
              { label: "Month", value: "month" },
              { label: "Total Billed", value: (row) => money(row.totalBilled) },
              { label: "Total Collected", value: (row) => money(row.totalCollected) },
              { label: "Collection Rate", value: (row) => `${Number(row.collectionRatePct || 0).toFixed(1)}%` },
            ]}
            rows={collectionEfficiencyRows}
            emptyLabel="No collection efficiency rows."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "risk-classification") {
      return (
        <SectionCard title="Risk Classification">
          <MiniTable
            columns={[
              { label: "Customer", value: "customer" },
              { label: "Invoices", value: (row) => Number(row.invoices || 0).toLocaleString() },
              { label: "Outstanding Balance", value: (row) => money(row.balance) },
              { label: "Max Days Overdue", value: (row) => Number(row.maxDaysOverdue || 0).toLocaleString() },
              { label: "Overdue Invoices", value: (row) => Number(row.overdueInvoices || 0).toLocaleString() },
              { label: "Risk", value: (row) => <Badge tone={riskTone(row.riskLevel)}>{row.riskLevel}</Badge> },
            ]}
            rows={customerSummaryRows}
            emptyLabel="No risk rows found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "reminder-log") {
      return (
        <SectionCard title="SMS / Reminder Log">
          <MiniTable
            columns={[
              { label: "Date", value: (row) => new Date(row.date).toLocaleString() },
              { label: "Customer", value: "customer" },
              { label: "Channel", value: "channel" },
              { label: "Message", value: "message" },
              {
                label: "Status",
                value: (row) => (
                  <Badge tone={row.status === "Delivered" ? "green" : "amber"}>{row.status}</Badge>
                ),
              },
            ]}
            rows={reminderLogRows}
            emptyLabel="No reminder log entries found."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "write-off") {
      return (
        <SectionCard title="Write-off Report" subtitle="Bad-debt candidates based on aging threshold">
          <MiniTable
            columns={[
              { label: "Date", value: (row) => new Date(row.date).toLocaleDateString() },
              { label: "Customer", value: "customer" },
              { label: "Invoice Ref", value: "invoiceRef" },
              { label: "Type", value: "type" },
              { label: "Balance", value: (row) => money(row.balance) },
              { label: "Days Overdue", value: (row) => Number(row.daysOverdue || 0).toLocaleString() },
              { label: "Status", value: (row) => <Badge tone="amber">{row.status}</Badge> },
              { label: "Reason", value: "reason" },
            ]}
            rows={writeOffRows}
            emptyLabel="No write-off candidates for the selected range."
          />
        </SectionCard>
      );
    }

    return (
      <SectionCard title="Payment Promise Tracker">
        <MiniTable
          columns={[
            { label: "Logged At", value: (row) => new Date(row.loggedAt).toLocaleString() },
            { label: "Customer", value: "customer" },
            { label: "Invoice Ref", value: "invoiceRef" },
            { label: "Promised Date", value: (row) => row.promisedDate || "-" },
            { label: "Status", value: (row) => <Badge tone="indigo">{row.status}</Badge> },
            { label: "Note", value: "note" },
          ]}
          rows={promiseTrackerRows}
          emptyLabel="No payment promise records detected in reminders."
        />
      </SectionCard>
    );
  };

  return (
    <>
      <SectionCard title="Outstanding Filters" subtitle="Date, customer, type, payment status, and aging bucket">
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
          <input
            value={customerFilter}
            onChange={(event) => setCustomerFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
            placeholder="Customer name / ID"
            list="outstanding-customer-options"
          />
          <datalist id="outstanding-customer-options">
            {customerOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <Select
            value={invoiceTypeFilter}
            onChange={(event) => setInvoiceTypeFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          >
            <option value="all">Invoice Type: All</option>
            <option value="sale">Sale</option>
            <option value="repair">Repair</option>
          </Select>
          <Select
            value={paymentStatusFilter}
            onChange={(event) => setPaymentStatusFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          >
            <option value="all">Payment Status: All</option>
            <option value="partial">Partial</option>
            <option value="pending">Pending</option>
            <option value="overdue">Overdue</option>
          </Select>
          <Select
            value={agingFilter}
            onChange={(event) => setAgingFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          >
            <option value="all">Aging Bucket: All</option>
            <option value="0-30d">0-30d</option>
            <option value="31-60d">31-60d</option>
            <option value="61-90d">61-90d</option>
            <option value="90d+">90d+</option>
          </Select>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
        <KpiCard title="Total Outstanding (Sales)" value={money(totalOutstandingSales)} icon={<WalletCards size={18} />} />
        <KpiCard title="Total Outstanding (Repairs)" value={money(totalOutstandingRepairs)} icon={<HandCoins size={18} />} tone="indigo" />
        <KpiCard title="Total Outstanding (All)" value={money(totalOutstandingAll)} icon={<AlertTriangle size={18} />} tone="amber" />
        <KpiCard title="Customers with Overdue Balances" value={customersWithOverdueBalances.toLocaleString()} icon={<ShieldAlert size={18} />} tone="red" />
        <KpiCard title="Oldest Unpaid Invoice (days)" value={oldestUnpaidInvoiceDays.toLocaleString()} icon={<Timer size={18} />} tone="violet" />
        <KpiCard title="Amount Collected This Month" value={money(amountCollectedThisMonth)} icon={<TrendingUp size={18} />} tone="green" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-6" title="Aging Buckets Bar" subtitle="0-30 / 31-60 / 61-90 / 90+ days">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingBucketRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="bucket" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} width={86} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                <Tooltip formatter={(value) => money(value)} contentStyle={{ background: "#020617", border: "1px solid #334155" }} />
                <Bar dataKey="total" radius={[8, 8, 0, 0]}>
                  {agingBucketRows.map((row, index) => (
                    <Cell key={`${row.bucket}-${index}`} fill={AGING_COLORS[index % AGING_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Outstanding by Customer" subtitle="Top 10 balances">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={customerOutstandingChartRows} margin={{ left: 20, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="customer" width={140} tick={{ fill: "#cbd5e1", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => money(value)} contentStyle={{ background: "#020617", border: "1px solid #334155" }} />
                <Bar dataKey="balance" fill="#6366f1" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Collection Rate Trend" subtitle="% collected per month">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={collectionRateTrendRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} width={70} domain={[0, 100]} />
                <Tooltip formatter={(value) => `${Number(value || 0).toFixed(1)}%`} contentStyle={{ background: "#020617", border: "1px solid #334155" }} />
                <Line type="monotone" dataKey="rate" stroke="#22c55e" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Sales vs Repair Outstanding" subtitle="Stacked by aging bucket">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={salesVsRepairOutstandingRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="bucket" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} width={86} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                <Tooltip formatter={(value) => money(value)} contentStyle={{ background: "#020617", border: "1px solid #334155" }} />
                <Bar dataKey="sales" stackId="outstanding" fill="#38bdf8" radius={[6, 6, 0, 0]} />
                <Bar dataKey="repairs" stackId="outstanding" fill="#f59e0b" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Data Tables" subtitle="Outstanding invoices/jobs, customer balances, and payment logs">
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
            <CalendarClock size={13} />
            Aging & Overdue Logic
          </div>
          Days overdue is calculated from invoice/job date to today. Overdue status triggers after 30 days.
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
          <div className="inline-flex items-center gap-2 font-bold text-slate-200 mb-1">
            <BellRing size={13} />
            Reminder / Promise Data
          </div>
          SMS reminder, write-off, and promise tracker sections depend on available notification/event text in current data.
        </div>
      </div>
    </>
  );
}


