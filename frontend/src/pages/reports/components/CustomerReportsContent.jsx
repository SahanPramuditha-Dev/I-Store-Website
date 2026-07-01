import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  Crown,
  LineChart as LineChartIcon,
  Repeat,
  ShieldAlert,
  Star,
  TrendingUp,
  UserPlus,
  Users,
  WalletCards,
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
import { Badge, KpiCard, SectionCard, Table, Select } from "../../../components/UI";

const DAY_MS = 1000 * 60 * 60 * 24;
const MONEY_LOCALE = "en-LK";
const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" });
const BAR_COLORS = ["#38bdf8", "#6366f1", "#14b8a6", "#f59e0b", "#f97316", "#22c55e"];
const SUB_REPORT_TABS = [
  { key: "summary", label: "Customer Summary" },
  { key: "segmentation", label: "Segmentation & Churn" },
  { key: "retention", label: "Retention" },
  { key: "referral-flags", label: "Referral & Flags" },
  { key: "blacklist", label: "Blacklist Log" },
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
  if (!date) return 9999;
  return Math.max(0, Math.floor((now - date) / DAY_MS));
}

function nextAnnualOccurrence(sourceDate, today = new Date()) {
  const base = toDate(sourceDate);
  if (!base) return null;
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let next = new Date(dayStart.getFullYear(), base.getMonth(), base.getDate());
  if (next < dayStart) {
    next = new Date(dayStart.getFullYear() + 1, base.getMonth(), base.getDate());
  }
  return next;
}

function nextAnniversary(createdAt) {
  return nextAnnualOccurrence(createdAt);
}

function nextBirthday(birthday) {
  return nextAnnualOccurrence(birthday);
}

function daysUntil(date, now = new Date()) {
  const next = toDate(date);
  if (!next) return null;
  const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.ceil((next - nowStart) / DAY_MS));
}

function frequencyTag(txCount) {
  if (txCount >= 5) return "Loyal";
  if (txCount >= 2) return "Repeat";
  if (txCount >= 1) return "One-time";
  return "Inactive";
}

function frequencyTone(tag) {
  if (tag === "Loyal") return "green";
  if (tag === "Repeat") return "indigo";
  if (tag === "One-time") return "amber";
  return "slate";
}

function customerSegment({ totalSpend, txCount, daysNoVisit, outstanding, overdueDays }) {
  if (daysNoVisit >= 180) return "Lost";
  if (totalSpend >= 150000 || txCount >= 8) return "VIP";
  if (daysNoVisit >= 60 || (outstanding > 0 && overdueDays > 30)) return "At-Risk";
  return "Regular";
}

function churnRisk(daysNoVisit, outstanding, overdueDays) {
  if (daysNoVisit >= 120 || overdueDays >= 90 || outstanding >= 100000) return "High";
  if (daysNoVisit >= 60 || overdueDays >= 30 || outstanding >= 30000) return "Medium";
  return "Low";
}

function riskTone(level) {
  if (level === "High") return "red";
  if (level === "Medium") return "amber";
  return "green";
}

function segmentTone(level) {
  if (level === "VIP") return "green";
  if (level === "Regular") return "indigo";
  if (level === "At-Risk") return "amber";
  return "red";
}

function customerTypeTag(customerId) {
  return customerId === "walk-in" ? "Walk-in" : "Registered";
}

function parseSalePayment(sale) {
  const total = Math.max(0, Number(sale.total || 0));
  const credit = Math.max(0, Number(sale.credit_amount || 0));
  const cash = Math.max(0, Number(sale.cash_amount || 0));
  const card = Math.max(0, Number(sale.card_amount || 0));
  const paidFromBreakdown = cash + card;
  let paid = Math.max(0, total - credit);
  if (paid <= 0 && paidFromBreakdown > 0) paid = paidFromBreakdown;
  if (paid <= 0 && sale.paid) paid = total;
  paid = Math.min(total, paid);
  const balance = Math.max(0, total - paid);
  return { total, paid, balance };
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

export default function CustomerReportsContent({
  salesRows,
  repairRows,
  customersRows,
  dateFrom,
  dateTo,
  query,
  onPrepared,
}) {
  const [activeSubReport, setActiveSubReport] = useState("summary");
  const [rangeFrom, setRangeFrom] = useState(dateFrom || "");
  const [rangeTo, setRangeTo] = useState(dateTo || "");
  const [customerTypeFilter, setCustomerTypeFilter] = useState("all");
  const [purchaseFrequencyFilter, setPurchaseFrequencyFilter] = useState("all");
  const [outstandingFilter, setOutstandingFilter] = useState("all");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");

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

  const customerProfileById = useMemo(
    () =>
      Object.fromEntries(
        (customersRows || []).map((customer) => [
          String(customer.id),
          {
            id: String(customer.id),
            name: customer.name || `Customer #${customer.id}`,
            phone: customer.phone || "-",
            email: customer.email || "-",
            address: customer.address || "-",
            birthday: customer.birthday || null,
            createdAt: customer.created_at || null,
          },
        ]),
      ),
    [customersRows],
  );

  const rangeStart = useMemo(() => parseDateInput(rangeFrom), [rangeFrom]);
  const rangeEnd = useMemo(() => parseDateInput(rangeTo, true), [rangeTo]);
  const normalizedQuery = (query || "").trim().toLowerCase();

  const salesInvoices = useMemo(() => {
    return (salesRows || [])
      .filter((sale) => !sale.is_voided && !sale.is_return && Number(sale.total || 0) > 0)
      .map((sale) => {
        const customerId = String(sale.customer_id ?? "walk-in");
        const customer =
          sale.customer_name ||
          customersById[customerId] ||
          (customerId === "walk-in" ? "Walk-in Customer" : `Customer #${customerId}`);
        const payment = parseSalePayment(sale);
        return {
          id: `sale-${sale.id}`,
          sourceId: sale.id,
          type: "Sale",
          reference: sale.invoice_no || `INV-${sale.id}`,
          customerId,
          customer,
          date: sale.created_at,
          total: payment.total,
          paid: payment.paid,
          balance: payment.balance,
          method: sale.payment_method || "Unknown",
          receiver: sale.cashier || "Front Desk",
          lines: Array.isArray(sale.lines) ? sale.lines : [],
        };
      });
  }, [customersById, salesRows]);

  const repairInvoices = useMemo(() => {
    return (repairRows || [])
      .filter((repair) => Number(repair.invoice_amount ?? repair.estimated_cost ?? 0) > 0)
      .map((repair) => {
        const customerId = String(repair.customer_id ?? "unknown");
        const customer =
          repair.customer_name || customersById[customerId] || `Customer #${customerId}`;
        const total = Math.max(0, Number(repair.invoice_amount ?? repair.estimated_cost ?? 0));
        const paid = Math.min(total, Math.max(0, Number(repair.advance_payment || 0)));
        const balance = Math.max(0, total - paid);
        return {
          id: `repair-${repair.id}`,
          sourceId: repair.id,
          type: "Repair",
          reference: repair.ticket_no || `JOB-${repair.id}`,
          customerId,
          customer,
          date: repair.created_at,
          total,
          paid,
          balance,
          method: "Advance Payment",
          receiver: repair.technician || "Front Desk",
          device: repair.device || "-",
          technician: repair.technician || "Unassigned",
        };
      });
  }, [customersById, repairRows]);

  const allInvoices = useMemo(
    () => [...salesInvoices, ...repairInvoices].sort((a, b) => new Date(b.date) - new Date(a.date)),
    [repairInvoices, salesInvoices],
  );

  const invoicesInRange = useMemo(
    () => allInvoices.filter((invoice) => inDateRange(invoice.date, rangeStart, rangeEnd)),
    [allInvoices, rangeEnd, rangeStart],
  );

  const firstVisitByCustomer = useMemo(() => {
    const map = {};
    allInvoices.forEach((invoice) => {
      if (!map[invoice.customerId] || new Date(invoice.date) < new Date(map[invoice.customerId])) {
        map[invoice.customerId] = invoice.date;
      }
    });
    return map;
  }, [allInvoices]);

  const monthlyCustomerSets = useMemo(() => {
    const monthMap = {};
    invoicesInRange.forEach((invoice) => {
      const key = toMonthKey(invoice.date);
      if (!key) return;
      if (!monthMap[key]) monthMap[key] = new Set();
      monthMap[key].add(invoice.customerId);
    });
    return monthMap;
  }, [invoicesInRange]);

  const summaryRowsRaw = useMemo(() => {
    const rowsMap = {};

    Object.values(customerProfileById).forEach((profile) => {
      rowsMap[profile.id] = {
        customerId: profile.id,
        customer: profile.name,
        phone: profile.phone || "-",
        customerType: "Registered",
        totalPurchases: 0,
        repairs: 0,
        totalSpend: 0,
        outstanding: 0,
        firstVisit: null,
        lastVisit: null,
        frequencyTag: "Inactive",
        lifetimeValue: 0,
        periodTxCount: 0,
        allTxCount: 0,
      };
    });

    const ensureRow = (customerId, customerName) => {
      if (!rowsMap[customerId]) {
        rowsMap[customerId] = {
          customerId,
          customer: customerName || (customerId === "walk-in" ? "Walk-in Customer" : `Customer #${customerId}`),
          phone: customerId === "walk-in" ? "-" : "-",
          customerType: customerTypeTag(customerId),
          totalPurchases: 0,
          repairs: 0,
          totalSpend: 0,
          outstanding: 0,
          firstVisit: null,
          lastVisit: null,
          frequencyTag: "Inactive",
          lifetimeValue: 0,
          periodTxCount: 0,
          allTxCount: 0,
        };
      }
      return rowsMap[customerId];
    };

    allInvoices.forEach((invoice) => {
      const row = ensureRow(invoice.customerId, invoice.customer);
      row.customerType = customerTypeTag(invoice.customerId);
      row.allTxCount += 1;
      row.lifetimeValue += invoice.total;
      row.outstanding += invoice.balance;
      if (!row.firstVisit || new Date(invoice.date) < new Date(row.firstVisit)) row.firstVisit = invoice.date;
      if (!row.lastVisit || new Date(invoice.date) > new Date(row.lastVisit)) row.lastVisit = invoice.date;
    });

    invoicesInRange.forEach((invoice) => {
      const row = ensureRow(invoice.customerId, invoice.customer);
      row.periodTxCount += 1;
      row.totalSpend += invoice.total;
      if (invoice.type === "Sale") row.totalPurchases += 1;
      else row.repairs += 1;
    });

    return Object.values(rowsMap).map((row) => {
      const daysNoVisit = daysSince(row.lastVisit);
      const overdueDays = row.outstanding > 0 ? daysNoVisit : 0;
      const segment = customerSegment({
        totalSpend: row.totalSpend || row.lifetimeValue,
        txCount: row.periodTxCount || row.allTxCount,
        daysNoVisit,
        outstanding: row.outstanding,
        overdueDays,
      });
      const churn = churnRisk(daysNoVisit, row.outstanding, overdueDays);
      return {
        ...row,
        frequencyTag: frequencyTag(row.periodTxCount),
        segment,
        churnRisk: churn,
        overdueDays,
      };
    });
  }, [allInvoices, customerProfileById, invoicesInRange]);

  const filteredSummaryRows = useMemo(() => {
    return summaryRowsRaw.filter((row) => {
      if (customerTypeFilter !== "all" && row.customerType.toLowerCase() !== customerTypeFilter) return false;
      if (purchaseFrequencyFilter !== "all" && row.frequencyTag.toLowerCase() !== purchaseFrequencyFilter) return false;
      if (outstandingFilter === "yes" && row.outstanding <= 0) return false;
      if (outstandingFilter === "no" && row.outstanding > 0) return false;
      if (!normalizedQuery) return true;
      const hay = `${row.customer} ${row.customerId} ${row.phone}`.toLowerCase();
      return hay.includes(normalizedQuery);
    });
  }, [customerTypeFilter, normalizedQuery, outstandingFilter, purchaseFrequencyFilter, summaryRowsRaw]);

  const sortedSummaryRows = useMemo(
    () => [...filteredSummaryRows].sort((a, b) => b.totalSpend - a.totalSpend),
    [filteredSummaryRows],
  );

  useEffect(() => {
    if (!selectedCustomerId && sortedSummaryRows.length > 0) {
      setSelectedCustomerId(sortedSummaryRows[0].customerId);
    } else if (
      selectedCustomerId &&
      !sortedSummaryRows.some((row) => row.customerId === selectedCustomerId)
    ) {
      setSelectedCustomerId(sortedSummaryRows[0]?.customerId || "");
    }
  }, [selectedCustomerId, sortedSummaryRows]);

  const selectedCustomerRow = useMemo(
    () => sortedSummaryRows.find((row) => row.customerId === selectedCustomerId),
    [selectedCustomerId, sortedSummaryRows],
  );

  const selectedCustomerInvoices = useMemo(
    () =>
      allInvoices
        .filter((invoice) => invoice.customerId === selectedCustomerId)
        .sort((a, b) => new Date(b.date) - new Date(a.date)),
    [allInvoices, selectedCustomerId],
  );

  const selectedCustomerPayments = useMemo(
    () =>
      selectedCustomerInvoices
        .filter((invoice) => Number(invoice.paid || 0) > 0)
        .map((invoice) => ({
          id: `${invoice.id}-payment`,
          date: invoice.date,
          customer: invoice.customer,
          invoiceRef: invoice.reference,
          amountCollected: invoice.paid,
          method: invoice.method,
          receivedBy: invoice.receiver,
        })),
    [selectedCustomerInvoices],
  );

  const selectedCustomerProducts = useMemo(() => {
    if (!selectedCustomerId) return [];
    const map = {};
    salesInvoices
      .filter((invoice) => invoice.customerId === selectedCustomerId)
      .forEach((invoice) => {
        invoice.lines.forEach((line) => {
          const key = String(line.item_id ?? line.item_name ?? "");
          if (!key) return;
          if (!map[key]) {
            map[key] = {
              product: line.item_name || `Item #${line.item_id}`,
              qty: 0,
              revenue: 0,
            };
          }
          const qty = Math.max(0, Number(line.quantity || 0));
          const revenue = Math.max(0, Number(line.line_revenue ?? qty * Number(line.unit_price || line.price || 0)));
          map[key].qty += qty;
          map[key].revenue += revenue;
        });
      });
    return Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 12);
  }, [salesInvoices, selectedCustomerId]);

  const totalCustomers = filteredSummaryRows.length;
  const newCustomersPeriod = useMemo(
    () =>
      filteredSummaryRows.filter(
        (row) =>
          row.customerType === "Registered" &&
          row.firstVisit &&
          inDateRange(row.firstVisit, rangeStart, rangeEnd),
      ).length,
    [filteredSummaryRows, rangeEnd, rangeStart],
  );

  const returningCustomers = useMemo(
    () =>
      filteredSummaryRows.filter((row) => {
        if (row.periodTxCount <= 0) return false;
        const firstVisit = firstVisitByCustomer[row.customerId];
        return (firstVisit && rangeStart && new Date(firstVisit) < rangeStart) || row.periodTxCount > 1;
      }).length,
    [filteredSummaryRows, firstVisitByCustomer, rangeStart],
  );

  const topCustomer = sortedSummaryRows[0];
  const avgCustomerSpend =
    filteredSummaryRows.length > 0
      ? filteredSummaryRows.reduce((sum, row) => sum + Number(row.totalSpend || 0), 0) /
        filteredSummaryRows.length
      : 0;
  const customersWithOutstanding = filteredSummaryRows.filter((row) => row.outstanding > 0).length;

  const monthlyNewReturningRows = useMemo(() => {
    const monthMap = {};
    invoicesInRange.forEach((invoice) => {
      const month = toMonthKey(invoice.date);
      if (!month) return;
      if (!monthMap[month]) monthMap[month] = { month, label: MONTH_LABEL.format(new Date(`${month}-01T00:00:00`)), newCustomers: new Set(), returning: new Set() };
      const firstVisit = firstVisitByCustomer[invoice.customerId];
      if (firstVisit && toMonthKey(firstVisit) === month) monthMap[month].newCustomers.add(invoice.customerId);
      else monthMap[month].returning.add(invoice.customerId);
    });

    return Object.values(monthMap)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((row) => ({
        month: row.month,
        label: row.label,
        newCount: row.newCustomers.size,
        returningCount: row.returning.size,
      }));
  }, [firstVisitByCustomer, invoicesInRange]);

  const revenueSegmentRows = useMemo(() => {
    if (sortedSummaryRows.length === 0) return [];
    const topN = Math.max(1, Math.ceil(sortedSummaryRows.length * 0.1));
    const topRows = sortedSummaryRows.slice(0, topN);
    const restRows = sortedSummaryRows.slice(topN);
    return [
      {
        segment: "Top 10%",
        value: topRows.reduce((sum, row) => sum + Number(row.totalSpend || 0), 0),
      },
      {
        segment: "Rest",
        value: restRows.reduce((sum, row) => sum + Number(row.totalSpend || 0), 0),
      },
    ];
  }, [sortedSummaryRows]);

  const acquisitionTrendRows = useMemo(
    () => monthlyNewReturningRows.map((row) => ({ label: row.label, newCount: row.newCount })),
    [monthlyNewReturningRows],
  );

  const topCustomerRevenueRows = useMemo(
    () =>
      sortedSummaryRows
        .slice(0, 10)
        .map((row) => ({ customer: row.customer, revenue: row.totalSpend })),
    [sortedSummaryRows],
  );

  const purchaseFrequencyRows = useMemo(() => {
    const map = {
      "One-time": 0,
      Repeat: 0,
      Loyal: 0,
    };
    filteredSummaryRows.forEach((row) => {
      if (row.frequencyTag === "One-time") map["One-time"] += 1;
      if (row.frequencyTag === "Repeat") map.Repeat += 1;
      if (row.frequencyTag === "Loyal") map.Loyal += 1;
    });
    return [
      { bucket: "One-time", count: map["One-time"] },
      { bucket: "Repeat", count: map.Repeat },
      { bucket: "Loyal", count: map.Loyal },
    ];
  }, [filteredSummaryRows]);

  const retentionRows = useMemo(() => {
    const months = Object.keys(monthlyCustomerSets).sort((a, b) => a.localeCompare(b));
    const rows = [];
    for (let i = 1; i < months.length; i += 1) {
      const previous = monthlyCustomerSets[months[i - 1]];
      const current = monthlyCustomerSets[months[i]];
      const previousCount = previous?.size || 0;
      let retained = 0;
      if (previousCount > 0) {
        previous.forEach((customerId) => {
          if (current?.has(customerId)) retained += 1;
        });
      }
      rows.push({
        month: months[i],
        label: MONTH_LABEL.format(new Date(`${months[i]}-01T00:00:00`)),
        previousCount,
        retainedCount: retained,
        retentionRate: previousCount > 0 ? (retained / previousCount) * 100 : 0,
      });
    }
    return rows;
  }, [monthlyCustomerSets]);

  const anniversaryFlagRows = useMemo(() => {
    const now = new Date();
    return filteredSummaryRows
      .filter((row) => row.customerType === "Registered")
      .map((row) => {
        const profile = customerProfileById[row.customerId];
        const nextAnniv = nextAnniversary(profile?.createdAt);
        const nextBday = nextBirthday(profile?.birthday);
        const daysToAnniversary = daysUntil(nextAnniv, now);
        const daysToBirthday = daysUntil(nextBday, now);
        const flagDays = [daysToAnniversary, daysToBirthday]
          .filter((value) => value !== null)
          .sort((a, b) => a - b);
        let note = "Birthday not recorded";
        if (daysToBirthday !== null && daysToBirthday <= 30 && daysToAnniversary !== null && daysToAnniversary <= 30) {
          note = `Birthday in ${daysToBirthday} day(s), anniversary in ${daysToAnniversary} day(s)`;
        } else if (daysToBirthday !== null && daysToBirthday <= 30) {
          note = `Birthday in ${daysToBirthday} day(s)`;
        } else if (daysToAnniversary !== null && daysToAnniversary <= 30) {
          note = `Anniversary in ${daysToAnniversary} day(s)`;
        }
        return {
          customerId: row.customerId,
          customer: row.customer,
          createdAt: profile?.createdAt || null,
          nextAnniversary: nextAnniv,
          daysToAnniversary,
          birthday: profile?.birthday || null,
          nextBirthday: nextBday,
          daysToBirthday,
          nextFlagInDays: flagDays[0] ?? null,
          note,
        };
      })
      .filter(
        (row) =>
          (row.daysToAnniversary !== null && row.daysToAnniversary <= 30) ||
          (row.daysToBirthday !== null && row.daysToBirthday <= 30),
      )
      .sort((a, b) => (a.nextFlagInDays ?? 9999) - (b.nextFlagInDays ?? 9999));
  }, [customerProfileById, filteredSummaryRows]);

  const referralRows = useMemo(
    () =>
      filteredSummaryRows
        .filter((row) => row.customerType === "Registered")
        .map((row) => ({
          customerId: row.customerId,
          customer: row.customer,
          referralSource: "Not Captured",
          referredBy: "-",
          firstVisit: row.firstVisit,
        })),
    [filteredSummaryRows],
  );

  const blacklistRows = useMemo(() => {
    return filteredSummaryRows
      .filter((row) => row.churnRisk === "High" || (row.outstanding > 75000 && row.overdueDays > 60))
      .map((row) => ({
        customer: row.customer,
        phone: row.phone,
        outstanding: row.outstanding,
        overdueDays: row.overdueDays,
        risk: row.churnRisk,
        note:
          row.overdueDays > 90
            ? "Long-overdue balance. Verify payment commitment."
            : "High churn risk and outstanding balance.",
      }))
      .sort((a, b) => b.outstanding - a.outstanding);
  }, [filteredSummaryRows]);

  const selectedSubReportPayload = useMemo(() => {
    const summaryColumns = [
      { label: "Customer", value: "customer" },
      { label: "Phone", value: "phone" },
      { label: "Total Purchases", value: (row) => Number(row.totalPurchases || 0) },
      { label: "Repairs", value: (row) => Number(row.repairs || 0) },
      { label: "Total Spend", value: (row) => Number(row.totalSpend || 0) },
      { label: "Outstanding", value: (row) => Number(row.outstanding || 0) },
      { label: "Last Visit", value: (row) => row.lastVisit || "-" },
      { label: "Frequency Tag", value: "frequencyTag" },
      { label: "Lifetime Value", value: (row) => Number(row.lifetimeValue || 0) },
    ];

    const payloads = {
      summary: {
        exportColumns: summaryColumns,
        exportRows: sortedSummaryRows,
      },
      segmentation: {
        exportColumns: [
          { label: "Customer", value: "customer" },
          { label: "Segment", value: "segment" },
          { label: "Churn Risk", value: "churnRisk" },
          { label: "Days Since Last Visit", value: (row) => Number(daysSince(row.lastVisit) || 0) },
          { label: "Outstanding", value: (row) => Number(row.outstanding || 0) },
          { label: "LTV", value: (row) => Number(row.lifetimeValue || 0) },
        ],
        exportRows: sortedSummaryRows,
      },
      retention: {
        exportColumns: [
          { label: "Month", value: "label" },
          { label: "Previous Month Customers", value: (row) => Number(row.previousCount || 0) },
          { label: "Retained Customers", value: (row) => Number(row.retainedCount || 0) },
          { label: "Retention Rate %", value: (row) => Number((row.retentionRate || 0).toFixed(2)) },
        ],
        exportRows: retentionRows,
      },
      "referral-flags": {
        exportColumns: [
          { label: "Customer", value: "customer" },
          { label: "Referral Source", value: "referralSource" },
          { label: "Referred By", value: "referredBy" },
          { label: "First Visit", value: (row) => row.firstVisit || "-" },
          { label: "Birthday", value: (row) => row.birthday || "-" },
          { label: "Next Anniversary", value: (row) => row.nextAnniversary || "-" },
          { label: "Next Birthday", value: (row) => row.nextBirthday || "-" },
          { label: "Flag Note", value: (row) => row.note || "-" },
        ],
        exportRows: referralRows.map((row) => {
          const flags = anniversaryFlagRows.find((flag) => flag.customerId === row.customerId);
          return {
            ...row,
            birthday: flags?.birthday || null,
            nextAnniversary: flags?.nextAnniversary ? new Date(flags.nextAnniversary).toISOString().slice(0, 10) : null,
            nextBirthday: flags?.nextBirthday ? new Date(flags.nextBirthday).toISOString().slice(0, 10) : null,
            note: flags?.note || "",
          };
        }),
      },
      blacklist: {
        exportColumns: [
          { label: "Customer", value: "customer" },
          { label: "Phone", value: "phone" },
          { label: "Outstanding", value: (row) => Number(row.outstanding || 0) },
          { label: "Overdue Days", value: (row) => Number(row.overdueDays || 0) },
          { label: "Risk", value: "risk" },
          { label: "Note", value: "note" },
        ],
        exportRows: blacklistRows,
      },
    };
    return payloads[activeSubReport] || payloads.summary;
  }, [activeSubReport, anniversaryFlagRows, blacklistRows, referralRows, retentionRows, sortedSummaryRows]);

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
        <SectionCard title="Customer Summary">
          <MiniTable
            columns={[
              {
                label: "Customer",
                value: (row) => (
                  <button
                    onClick={() => setSelectedCustomerId(row.customerId)}
                    className={`text-left font-semibold ${row.customerId === selectedCustomerId ? "text-indigo-300" : "text-slate-200 hover:text-indigo-200"}`}
                  >
                    {row.customer}
                  </button>
                ),
              },
              { label: "Phone", value: "phone" },
              { label: "Total Purchases", value: (row) => Number(row.totalPurchases || 0).toLocaleString() },
              { label: "Repairs", value: (row) => Number(row.repairs || 0).toLocaleString() },
              { label: "Total Spend", value: (row) => money(row.totalSpend) },
              { label: "Outstanding", value: (row) => money(row.outstanding) },
              { label: "Last Visit", value: (row) => (row.lastVisit ? new Date(row.lastVisit).toLocaleDateString() : "-") },
              { label: "Frequency Tag", value: (row) => <Badge tone={frequencyTone(row.frequencyTag)}>{row.frequencyTag}</Badge> },
              { label: "Lifetime Value", value: (row) => money(row.lifetimeValue) },
            ]}
            rows={sortedSummaryRows}
            emptyLabel="No customer summary data."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "segmentation") {
      return (
        <SectionCard title="Customer Segmentation & Churn">
          <MiniTable
            columns={[
              { label: "Customer", value: "customer" },
              { label: "Segment", value: (row) => <Badge tone={segmentTone(row.segment)}>{row.segment}</Badge> },
              { label: "Churn Risk", value: (row) => <Badge tone={riskTone(row.churnRisk)}>{row.churnRisk}</Badge> },
              { label: "Days Since Last Visit", value: (row) => Number(daysSince(row.lastVisit)).toLocaleString() },
              { label: "Outstanding", value: (row) => money(row.outstanding) },
              { label: "LTV", value: (row) => money(row.lifetimeValue) },
            ]}
            rows={sortedSummaryRows}
            emptyLabel="No segmentation rows."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "retention") {
      return (
        <SectionCard title="Customer Retention Rate" subtitle="% retained month-over-month">
          <MiniTable
            columns={[
              { label: "Month", value: "label" },
              { label: "Previous Month Customers", value: (row) => Number(row.previousCount || 0).toLocaleString() },
              { label: "Retained Customers", value: (row) => Number(row.retainedCount || 0).toLocaleString() },
              { label: "Retention Rate", value: (row) => `${Number(row.retentionRate || 0).toFixed(1)}%` },
            ]}
            rows={retentionRows}
            emptyLabel="Insufficient months to calculate retention."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "referral-flags") {
      return (
        <SectionCard title="Referral Tracking + Birthday / Anniversary Flags">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <SectionCard title="Referral Tracking">
              <MiniTable
                columns={[
                  { label: "Customer", value: "customer" },
                  { label: "Referral Source", value: "referralSource" },
                  { label: "Referred By", value: "referredBy" },
                  { label: "First Visit", value: (row) => (row.firstVisit ? new Date(row.firstVisit).toLocaleDateString() : "-") },
                ]}
                rows={referralRows.slice(0, 30)}
                emptyLabel="No referral metadata captured."
              />
            </SectionCard>
            <SectionCard title="Birthday / Anniversary Flags">
              <MiniTable
                columns={[
                  { label: "Customer", value: "customer" },
                  { label: "Anniversary", value: (row) => (row.nextAnniversary ? new Date(row.nextAnniversary).toLocaleDateString() : "-") },
                  { label: "In (Days)", value: (row) => (row.daysToAnniversary === null ? "-" : row.daysToAnniversary) },
                  { label: "Birthday", value: (row) => (row.nextBirthday ? new Date(row.nextBirthday).toLocaleDateString() : row.birthday || "-") },
                  { label: "Birthday In (Days)", value: (row) => (row.daysToBirthday === null ? "-" : row.daysToBirthday) },
                  { label: "Note", value: "note" },
                ]}
                rows={anniversaryFlagRows}
                emptyLabel="No upcoming anniversary flags in the next 30 days."
              />
            </SectionCard>
          </div>
        </SectionCard>
      );
    }

    return (
      <SectionCard title="Blacklist Log">
        <MiniTable
          columns={[
            { label: "Customer", value: "customer" },
            { label: "Phone", value: "phone" },
            { label: "Outstanding", value: (row) => money(row.outstanding) },
            { label: "Overdue Days", value: (row) => Number(row.overdueDays || 0).toLocaleString() },
            { label: "Risk", value: (row) => <Badge tone={riskTone(row.risk)}>{row.risk}</Badge> },
            { label: "Notes", value: "note" },
          ]}
          rows={blacklistRows}
          emptyLabel="No flagged customers in blacklist log."
        />
      </SectionCard>
    );
  };

  return (
    <>
      <SectionCard title="Customer Filters" subtitle="Date range, customer type, frequency, and outstanding filter">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
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
          <Select value={customerTypeFilter} onChange={(event) => setCustomerTypeFilter(event.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">Customer Type: All</option>
            <option value="walk-in">Walk-in</option>
            <option value="registered">Registered</option>
          </Select>
          <Select value={purchaseFrequencyFilter} onChange={(event) => setPurchaseFrequencyFilter(event.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">Purchase Frequency: All</option>
            <option value="one-time">One-time</option>
            <option value="repeat">Repeat</option>
            <option value="loyal">Loyal</option>
          </Select>
          <Select value={outstandingFilter} onChange={(event) => setOutstandingFilter(event.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">Outstanding Balance: All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
        <KpiCard title="Total Customers" value={totalCustomers.toLocaleString()} icon={<Users size={18} />} />
        <KpiCard title="New Customers (Period)" value={newCustomersPeriod.toLocaleString()} icon={<UserPlus size={18} />} tone="green" />
        <KpiCard title="Returning Customers" value={returningCustomers.toLocaleString()} icon={<Repeat size={18} />} tone="indigo" />
        <KpiCard title="Top Customer" value={topCustomer ? `${topCustomer.customer} (${money(topCustomer.totalSpend)})` : "-"} icon={<Crown size={18} />} tone="amber" />
        <KpiCard title="Avg Customer Spend" value={money(avgCustomerSpend)} icon={<WalletCards size={18} />} tone="sky" />
        <KpiCard title="Customers with Outstanding Balance" value={customersWithOutstanding.toLocaleString()} icon={<AlertTriangle size={18} />} tone="red" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-6" title="New vs Returning Customers" subtitle="Bar chart (monthly)">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyNewReturningRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="newCount" fill="#22c55e" radius={[6, 6, 0, 0]} />
                <Bar dataKey="returningCount" fill="#6366f1" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Revenue by Customer Segment" subtitle="Top 10% vs Rest">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={revenueSegmentRows} dataKey="value" nameKey="segment" innerRadius={55} outerRadius={90} stroke="none">
                  {revenueSegmentRows.map((row, index) => (
                    <Cell key={`${row.segment}-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => money(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Customer Acquisition Trend" subtitle="Line chart (new per month)">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={acquisitionTrendRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip />
                <Line type="monotone" dataKey="newCount" stroke="#38bdf8" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-6" title="Top 10 Customers by Revenue" subtitle="Horizontal bar">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={topCustomerRevenueRows} margin={{ left: 20, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="customer" width={140} tick={{ fill: "#cbd5e1", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => money(value)} />
                <Bar dataKey="revenue" fill="#f59e0b" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-12" title="Purchase Frequency Distribution" subtitle="Histogram">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={purchaseFrequencyRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="bucket" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#14b8a6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Customer Reports">
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

      <SectionCard
        title="Customer Detail Drill-Down"
        subtitle="Invoices, payment history, outstanding, product affinity, and profile notes"
      >
        {!selectedCustomerRow && (
          <div className="text-sm text-slate-400">Select a customer from the summary to view details.</div>
        )}
        {selectedCustomerRow && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
              <KpiCard title="Customer" value={selectedCustomerRow.customer} icon={<Users size={18} />} />
              <KpiCard title="Total Spend" value={money(selectedCustomerRow.totalSpend)} icon={<TrendingUp size={18} />} tone="green" />
              <KpiCard title="Outstanding" value={money(selectedCustomerRow.outstanding)} icon={<WalletCards size={18} />} tone="amber" />
              <KpiCard title="Segment" value={selectedCustomerRow.segment} icon={<Star size={18} />} tone={segmentTone(selectedCustomerRow.segment)} />
              <KpiCard title="Churn Risk" value={selectedCustomerRow.churnRisk} icon={<ShieldAlert size={18} />} tone={riskTone(selectedCustomerRow.churnRisk)} />
              <KpiCard title="LTV" value={money(selectedCustomerRow.lifetimeValue)} icon={<LineChartIcon size={18} />} tone="indigo" />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              <SectionCard title="All Invoices (Sales + Repairs)">
                <MiniTable
                  columns={[
                    { label: "Type", value: "type" },
                    { label: "Reference", value: "reference" },
                    { label: "Date", value: (row) => new Date(row.date).toLocaleDateString() },
                    { label: "Total", value: (row) => money(row.total) },
                    { label: "Paid", value: (row) => money(row.paid) },
                    { label: "Balance", value: (row) => money(row.balance) },
                  ]}
                  rows={selectedCustomerInvoices}
                  emptyLabel="No invoices for this customer."
                />
              </SectionCard>
              <SectionCard title="Payment History">
                <MiniTable
                  columns={[
                    { label: "Date", value: (row) => new Date(row.date).toLocaleString() },
                    { label: "Invoice Ref", value: "invoiceRef" },
                    { label: "Amount Collected", value: (row) => money(row.amountCollected) },
                    { label: "Method", value: "method" },
                    { label: "Received By", value: "receivedBy" },
                  ]}
                  rows={selectedCustomerPayments}
                  emptyLabel="No payment entries for this customer."
                />
              </SectionCard>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              <SectionCard title="Most Purchased Products">
                <MiniTable
                  columns={[
                    { label: "Product", value: "product" },
                    { label: "Qty", value: (row) => Number(row.qty || 0).toLocaleString() },
                    { label: "Revenue", value: (row) => money(row.revenue) },
                  ]}
                  rows={selectedCustomerProducts}
                  emptyLabel="No product purchases for this customer."
                />
              </SectionCard>
              <SectionCard title="First / Last Visit + Notes">
                <div className="space-y-2 text-sm text-slate-300">
                  <div>
                    <span className="text-slate-400">First Visit:</span>{" "}
                    <span className="font-semibold">
                      {selectedCustomerRow.firstVisit
                        ? new Date(selectedCustomerRow.firstVisit).toLocaleDateString()
                        : "-"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Last Visit:</span>{" "}
                    <span className="font-semibold">
                      {selectedCustomerRow.lastVisit
                        ? new Date(selectedCustomerRow.lastVisit).toLocaleDateString()
                        : "-"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Phone:</span>{" "}
                    <span className="font-semibold">{selectedCustomerRow.phone || "-"}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Email:</span>{" "}
                    <span className="font-semibold">
                      {customerProfileById[selectedCustomerRow.customerId]?.email || "-"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Address:</span>{" "}
                    <span className="font-semibold">
                      {customerProfileById[selectedCustomerRow.customerId]?.address || "-"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Birthday:</span>{" "}
                    <span className="font-semibold">
                      {customerProfileById[selectedCustomerRow.customerId]?.birthday
                        ? new Date(customerProfileById[selectedCustomerRow.customerId].birthday).toLocaleDateString()
                        : "-"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Notes / Remarks:</span>{" "}
                    <span className="font-semibold">No explicit remarks captured.</span>
                  </div>
                </div>
              </SectionCard>
            </div>
          </div>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
          <div className="inline-flex items-center gap-2 font-bold text-slate-200 mb-1">
            <BellRing size={13} />
            Birthday / Anniversary
          </div>
          Birthday flags now use customer birthday when recorded, with anniversary fallback from account creation date.
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
          <div className="inline-flex items-center gap-2 font-bold text-slate-200 mb-1">
            <CalendarClock size={13} />
            Retention & Churn
          </div>
          Retention is calculated month-over-month from active customers in each month within the filtered range.
        </div>
      </div>
    </>
  );
}


