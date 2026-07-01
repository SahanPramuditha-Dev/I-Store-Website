import { useEffect, useMemo, useState } from "react";
import {
  Calculator,
  CreditCard,
  HandCoins,
  Percent,
  Receipt,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge, KpiCard, SectionCard, Table, Select } from "../../../components/UI";

const MONEY_LOCALE = "en-LK";
const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" });
const DAY_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const SUB_REPORT_TABS = [
  { key: "tax-summary", label: "Tax Summary" },
  { key: "payment-method", label: "Payment Method Summary" },
  { key: "daily-summary", label: "Daily Financial Summary" },
  { key: "monthly-summary", label: "Monthly Financial Summary" },
  { key: "vat-return", label: "VAT Return Report" },
  { key: "cash-recon", label: "Cash Reconciliation" },
  { key: "service-charge", label: "Service Charge Report" },
  { key: "invoice-tax-log", label: "Invoice-level Tax Log" },
  { key: "fy-summary", label: "Financial Year Summary" },
  { key: "bank-deposits", label: "Bank Deposit Summary" },
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

function toFiscalYearLabel(value, fiscalStartMonth = 4) {
  const date = toDate(value);
  if (!date) return "FY N/A";
  const month = date.getMonth() + 1;
  let startYear = date.getFullYear();
  if (month < fiscalStartMonth) startYear -= 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, "0");
  return `FY ${startYear}/${endYearShort}`;
}

function toWeekKey(value) {
  const date = toDate(value);
  if (!date) return "";
  const start = new Date(date);
  const day = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - day);
  return toDayKey(start);
}

function pct(part, total) {
  const denominator = Number(total || 0);
  if (!denominator) return 0;
  return (Number(part || 0) / denominator) * 100;
}

function enumerateDayKeys(fromValue, toValue, transactions, purchases) {
  const start = parseDateInput(fromValue);
  const endExclusive = parseDateInput(toValue, true);
  if (start && endExclusive && start < endExclusive) {
    const keys = [];
    const cursor = new Date(start);
    while (cursor < endExclusive) {
      keys.push(toDayKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return keys;
  }

  const keySet = new Set();
  (transactions || []).forEach((row) => {
    const key = toDayKey(row.date);
    if (key) keySet.add(key);
  });
  (purchases || []).forEach((row) => {
    const key = toDayKey(row.date);
    if (key) keySet.add(key);
  });
  return [...keySet].sort((a, b) => a.localeCompare(b));
}

function paymentBucketFromSale(sale, cashAbs, cardAbs, creditAbs) {
  const method = String(sale.payment_method || "").toLowerCase();
  const channels = [cashAbs > 0, cardAbs > 0, creditAbs > 0].filter(Boolean).length;
  if (channels >= 2 || method.includes("mixed") || method.includes("multiple")) return "Mixed";
  if (creditAbs > 0 || method.includes("credit") || method.includes("due") || method.includes("partial")) return "Credit";
  if (cardAbs > 0 || method.includes("card") || method.includes("bank")) return "Card";
  return "Cash";
}

function toneForVariance(value) {
  if (value > 0) return "red";
  if (value < 0) return "amber";
  return "green";
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

export default function TaxFinancialReportsContent({
  salesRows,
  repairRows,
  expenseRows,
  dateFrom,
  dateTo,
  query,
  onPrepared,
}) {
  const [activeSubReport, setActiveSubReport] = useState("tax-summary");
  const [rangeFrom, setRangeFrom] = useState(dateFrom || "");
  const [rangeTo, setRangeTo] = useState(dateTo || "");
  const [taxTypeFilter, setTaxTypeFilter] = useState("all");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("all");
  const [transactionTypeFilter, setTransactionTypeFilter] = useState("all");

  useEffect(() => {
    setRangeFrom(dateFrom || "");
    setRangeTo(dateTo || "");
  }, [dateFrom, dateTo]);

  const rangeStart = useMemo(() => parseDateInput(rangeFrom), [rangeFrom]);
  const rangeEnd = useMemo(() => parseDateInput(rangeTo, true), [rangeTo]);
  const normalizedQuery = (query || "").trim().toLowerCase();

  const normalizedSales = useMemo(() => {
    return (salesRows || [])
      .filter((row) => !row.is_voided)
      .map((row) => {
        const rawTotal = Number(row.total || 0);
        const sign = row.is_return || rawTotal < 0 ? -1 : 1;
        const totalAbs = Math.abs(rawTotal);
        const cashAbs = Math.abs(Number(row.cash_amount || 0));
        const cardAbs = Math.abs(Number(row.card_amount || 0));
        const creditAbs = Math.max(0, totalAbs - cashAbs - cardAbs);
        const paymentBucket = paymentBucketFromSale(row, cashAbs, cardAbs, creditAbs);

        const grossAmount = sign * totalAbs;
        const vatTax = sign * Math.max(0, Math.abs(Number(row.tax_amount || 0)));
        const otherTax = sign * Math.max(0, Math.abs(Number(row.other_tax_amount || 0)));
        const serviceCharge = sign * Math.max(
          0,
          Math.abs(Number(row.service_charge_amount ?? row.service_charge ?? 0)),
        );
        const taxAmount = vatTax + otherTax;
        const netAmount = grossAmount - taxAmount;

        return {
          id: `sale-${row.id}`,
          sourceId: row.id,
          date: row.created_at,
          transactionType: "Sale",
          invoiceRef: row.invoice_no || `INV-${row.id}`,
          grossAmount,
          taxAmount,
          vatTax,
          otherTax,
          serviceCharge,
          taxPct: grossAmount ? pct(taxAmount, grossAmount) : 0,
          netAmount,
          paymentBucket,
          paymentMethodRaw: row.payment_method || "Cash",
          cashAmount: sign * cashAbs,
          cardAmount: sign * cardAbs,
          creditAmount: sign * creditAbs,
          mixedAmount: paymentBucket === "Mixed" ? grossAmount : 0,
          customerName: row.customer_name || "Walk-in",
          status: row.status || (row.is_return ? "Refunded" : row.paid ? "Paid" : "Pending"),
          searchText: `${row.invoice_no || ""} ${row.customer_name || ""} ${row.payment_method || ""} ${row.status || ""}`.toLowerCase(),
        };
      });
  }, [salesRows]);

  const normalizedRepairs = useMemo(() => {
    return (repairRows || [])
      .filter((row) => !String(row.status || "").toLowerCase().includes("cancel"))
      .map((row) => {
        const grossAmount = Math.max(0, Number(row.invoice_amount ?? row.estimated_cost ?? 0));
        const vatTax = Number(row.tax_amount || 0);
        const otherTax = Number(row.other_tax_amount || 0);
        const serviceCharge = Math.max(
          0,
          Number(
            row.service_charge_amount ??
              row.service_charge ??
              row.labor_cost ??
              row.estimated_labor_cost ??
              grossAmount - Number(row.parts_cost_total || 0),
          ),
        );
        const taxAmount = vatTax + otherTax;
        const netAmount = grossAmount - taxAmount;
        const paid = Math.min(
          grossAmount,
          Math.max(0, Number(row.invoice_paid ?? row.advance_payment ?? 0)),
        );
        const method = String(row.payment_method || "").toLowerCase();

        let cashAmount = 0;
        let cardAmount = 0;
        if (method.includes("card") || method.includes("bank")) {
          cardAmount = paid;
        } else if (method.includes("mixed") || method.includes("multiple")) {
          cashAmount = paid * 0.5;
          cardAmount = paid * 0.5;
        } else {
          cashAmount = paid;
        }
        const creditAmount = Math.max(0, grossAmount - paid);
        let paymentBucket = "Cash";
        if (creditAmount > 0) paymentBucket = "Credit";
        else if (cashAmount > 0 && cardAmount > 0) paymentBucket = "Mixed";
        else if (cardAmount > 0) paymentBucket = "Card";

        return {
          id: `repair-${row.id}`,
          sourceId: row.id,
          date: row.delivered_at || row.created_at,
          transactionType: "Repair",
          invoiceRef: row.ticket_no || `JOB-${row.id}`,
          grossAmount,
          taxAmount,
          vatTax,
          otherTax,
          serviceCharge,
          taxPct: grossAmount ? pct(taxAmount, grossAmount) : 0,
          netAmount,
          paymentBucket,
          paymentMethodRaw: row.payment_method || (creditAmount > 0 ? "Credit" : "Cash"),
          cashAmount,
          cardAmount,
          creditAmount,
          mixedAmount: paymentBucket === "Mixed" ? grossAmount : 0,
          customerName: row.customer_name || "Unknown",
          status: row.status || "Completed",
          searchText: `${row.ticket_no || ""} ${row.customer_name || ""} ${row.device || ""} ${row.status || ""}`.toLowerCase(),
        };
      })
      .filter((row) => row.grossAmount > 0 || row.taxAmount > 0 || row.serviceCharge > 0);
  }, [repairRows]);

  const allTransactions = useMemo(
    () => [...normalizedSales, ...normalizedRepairs],
    [normalizedSales, normalizedRepairs],
  );

  const filteredTransactions = useMemo(() => {
    return allTransactions
      .filter((row) => {
        if (!inDateRange(row.date, rangeStart, rangeEnd)) return false;
        if (transactionTypeFilter !== "all" && row.transactionType.toLowerCase() !== transactionTypeFilter) {
          return false;
        }
        if (paymentMethodFilter !== "all" && row.paymentBucket.toLowerCase() !== paymentMethodFilter) {
          return false;
        }
        if (taxTypeFilter === "vat" && Math.abs(row.vatTax) <= 0) return false;
        if (taxTypeFilter === "service" && Math.abs(row.serviceCharge) <= 0) return false;
        if (taxTypeFilter === "other" && Math.abs(row.otherTax) <= 0) return false;
        if (!normalizedQuery) return true;
        return row.searchText.includes(normalizedQuery);
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [
    allTransactions,
    rangeStart,
    rangeEnd,
    transactionTypeFilter,
    paymentMethodFilter,
    taxTypeFilter,
    normalizedQuery,
  ]);

  const filteredPurchases = useMemo(() => {
    return (expenseRows || [])
      .filter((row) => inDateRange(row.expense_date || row.created_at, rangeStart, rangeEnd))
      .filter((row) => {
        if (!normalizedQuery) return true;
        const hay = `${row.expense_code || row.po_number || ""} ${row.description || row.note || ""} ${row.status || ""}`.toLowerCase();
        return hay.includes(normalizedQuery);
      })
      .map((row) => ({
        id: row.id,
        date: row.expense_date || row.created_at,
        totalCost: Number(row.amount || row.total_cost || 0),
        taxAmount: Number(row.tax_amount || 0),
        status: row.status || "Draft",
      }));
  }, [expenseRows, rangeStart, rangeEnd, normalizedQuery]);

  const kpis = useMemo(() => {
    const totalTaxCollected = filteredTransactions.reduce(
      (acc, row) => acc + Number(row.taxAmount || 0),
      0,
    );
    const totalGrossRevenue = filteredTransactions.reduce(
      (acc, row) => acc + Number(row.grossAmount || 0),
      0,
    );
    const totalNetRevenue = filteredTransactions.reduce(
      (acc, row) => acc + Number(row.netAmount || 0),
      0,
    );
    const totalServiceCharges = filteredTransactions.reduce(
      (acc, row) => acc + Number(row.serviceCharge || 0),
      0,
    );
    const cashTotal = filteredTransactions.reduce(
      (acc, row) => acc + Number(row.cashAmount || 0),
      0,
    );
    const cardTotal = filteredTransactions.reduce(
      (acc, row) => acc + Number(row.cardAmount || 0),
      0,
    );
    return {
      totalTaxCollected,
      totalGrossRevenue,
      totalNetRevenue,
      totalServiceCharges,
      cashTotal,
      cardTotal,
    };
  }, [filteredTransactions]);

  const taxTrendRows = useMemo(() => {
    const map = {};
    filteredTransactions.forEach((row) => {
      const month = toMonthKey(row.date);
      if (!month) return;
      if (!map[month]) {
        map[month] = {
          month,
          label: MONTH_LABEL.format(new Date(`${month}-01T00:00:00`)),
          vatTax: 0,
          otherTax: 0,
          totalTax: 0,
          serviceCharge: 0,
        };
      }
      map[month].vatTax += Number(row.vatTax || 0);
      map[month].otherTax += Number(row.otherTax || 0);
      map[month].totalTax += Number(row.taxAmount || 0);
      map[month].serviceCharge += Number(row.serviceCharge || 0);
    });
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
  }, [filteredTransactions]);

  const paymentMethodAnalysisRows = useMemo(() => {
    const totals = { Cash: 0, Card: 0, Credit: 0, Mixed: 0 };
    filteredTransactions.forEach((row) => {
      totals[row.paymentBucket] = (totals[row.paymentBucket] || 0) + Number(row.grossAmount || 0);
    });
    return [
      { method: "Cash", total: totals.Cash },
      { method: "Card", total: totals.Card },
      { method: "Credit", total: totals.Credit },
      { method: "Mixed", total: totals.Mixed },
    ];
  }, [filteredTransactions]);

  const revenueReconciliationRows = useMemo(() => {
    const sales = filteredTransactions.filter((row) => row.transactionType === "Sale");
    const repairs = filteredTransactions.filter((row) => row.transactionType === "Repair");
    const salesGross = sales.reduce((acc, row) => acc + Number(row.grossAmount || 0), 0);
    const salesNet = sales.reduce((acc, row) => acc + Number(row.netAmount || 0), 0);
    const repairGross = repairs.reduce((acc, row) => acc + Number(row.grossAmount || 0), 0);
    const repairNet = repairs.reduce((acc, row) => acc + Number(row.netAmount || 0), 0);
    return [
      { label: "Sales", gross: salesGross, net: salesNet },
      { label: "Repairs", gross: repairGross, net: repairNet },
      { label: "Total", gross: salesGross + repairGross, net: salesNet + repairNet },
    ];
  }, [filteredTransactions]);

  const dailyFinancialRows = useMemo(() => {
    const keys = enumerateDayKeys(rangeFrom, rangeTo, filteredTransactions, filteredPurchases);
    const txByDay = {};
    filteredTransactions.forEach((row) => {
      const day = toDayKey(row.date);
      if (!day) return;
      if (!txByDay[day]) {
        txByDay[day] = {
          salesRevenue: 0,
          repairRevenue: 0,
          taxCollected: 0,
          cash: 0,
          card: 0,
          credit: 0,
          mixed: 0,
          transactionCount: 0,
        };
      }
      if (row.transactionType === "Sale") txByDay[day].salesRevenue += Number(row.grossAmount || 0);
      else txByDay[day].repairRevenue += Number(row.grossAmount || 0);
      txByDay[day].taxCollected += Number(row.taxAmount || 0);
      txByDay[day].cash += Number(row.cashAmount || 0);
      txByDay[day].card += Number(row.cardAmount || 0);
      txByDay[day].credit += Number(row.creditAmount || 0);
      if (row.paymentBucket === "Mixed") txByDay[day].mixed += Number(row.grossAmount || 0);
      txByDay[day].transactionCount += 1;
    });

    const expenseByDay = {};
    filteredPurchases.forEach((row) => {
      const day = toDayKey(row.date);
      if (!day) return;
      expenseByDay[day] = (expenseByDay[day] || 0) + Number(row.totalCost || 0);
    });

    let runningBalance = 0;
    return keys.map((day) => {
      const tx = txByDay[day] || {
        salesRevenue: 0,
        repairRevenue: 0,
        taxCollected: 0,
        cash: 0,
        card: 0,
        credit: 0,
        mixed: 0,
        transactionCount: 0,
      };
      const expenses = Number(expenseByDay[day] || 0);
      const gross = tx.salesRevenue + tx.repairRevenue;
      const net = gross - expenses;
      const openingBalance = runningBalance;
      const closingBalance = openingBalance + net;
      runningBalance = closingBalance;
      return {
        key: day,
        date: day,
        openingBalance,
        salesRevenue: tx.salesRevenue,
        repairRevenue: tx.repairRevenue,
        expenses,
        taxCollected: tx.taxCollected,
        closingBalance,
        net,
        gross,
        cash: tx.cash,
        card: tx.card,
        credit: tx.credit,
        mixed: tx.mixed,
        transactionCount: tx.transactionCount,
      };
    });
  }, [rangeFrom, rangeTo, filteredTransactions, filteredPurchases]);

  const dailySummaryChartRows = useMemo(
    () =>
      dailyFinancialRows.map((row) => ({
        day: DAY_LABEL.format(new Date(`${row.date}T00:00:00`)),
        gross: row.gross,
        expenses: row.expenses,
        net: row.net,
      })),
    [dailyFinancialRows],
  );

  const taxSummaryRows = useMemo(
    () =>
      [...filteredTransactions]
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .map((row) => ({
          id: row.id,
          date: row.date,
          transactionType: row.transactionType,
          grossAmount: row.grossAmount,
          taxPct: row.taxPct,
          taxAmount: row.taxAmount,
          netAmount: row.netAmount,
          invoiceRef: row.invoiceRef,
        })),
    [filteredTransactions],
  );

  const paymentMethodSummaryRows = useMemo(
    () =>
      dailyFinancialRows.map((row) => ({
        id: `pay-${row.date}`,
        date: row.date,
        cash: row.cash,
        card: row.card,
        credit: row.credit,
        mixed: row.mixed,
        total: row.gross,
        transactionCount: row.transactionCount,
      })),
    [dailyFinancialRows],
  );

  const monthlyFinancialRows = useMemo(() => {
    const map = {};
    dailyFinancialRows.forEach((row) => {
      const month = toMonthKey(row.date);
      if (!month) return;
      if (!map[month]) {
        map[month] = {
          month,
          monthLabel: MONTH_LABEL.format(new Date(`${month}-01T00:00:00`)),
          revenue: 0,
          expenses: 0,
          tax: 0,
          netProfit: 0,
        };
      }
      map[month].revenue += Number(row.gross || 0);
      map[month].expenses += Number(row.expenses || 0);
      map[month].tax += Number(row.taxCollected || 0);
      map[month].netProfit += Number(row.net || 0);
    });
    return Object.values(map)
      .map((row) => ({
        ...row,
        marginPct: row.revenue ? pct(row.netProfit, row.revenue) : 0,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [dailyFinancialRows]);

  const vatReturnRows = useMemo(() => {
    const map = {};
    filteredTransactions.forEach((row) => {
      const month = toMonthKey(row.date);
      if (!month) return;
      if (!map[month]) {
        map[month] = {
          month,
          period: MONTH_LABEL.format(new Date(`${month}-01T00:00:00`)),
          taxableTurnover: 0,
          outputVat: 0,
          inputVatEstimate: 0,
          serviceCharge: 0,
          otherTax: 0,
        };
      }
      if (row.transactionType === "Sale") {
        map[month].taxableTurnover += Number(row.grossAmount || 0);
      }
      map[month].outputVat += Number(row.vatTax || 0);
      map[month].serviceCharge += Number(row.serviceCharge || 0);
      map[month].otherTax += Number(row.otherTax || 0);
    });
    filteredPurchases.forEach((row) => {
      const month = toMonthKey(row.date);
      if (!month) return;
      if (!map[month]) {
        map[month] = {
          month,
          period: MONTH_LABEL.format(new Date(`${month}-01T00:00:00`)),
          taxableTurnover: 0,
          outputVat: 0,
          inputVatEstimate: 0,
          serviceCharge: 0,
          otherTax: 0,
        };
      }
      map[month].inputVatEstimate += Number(row.taxAmount || 0);
    });
    return Object.values(map)
      .map((row) => ({
        ...row,
        netVatPayable: row.outputVat - row.inputVatEstimate,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [filteredTransactions, filteredPurchases]);

  const cashReconciliationRows = useMemo(
    () =>
      dailyFinancialRows.map((row) => {
        const expectedCash = Number(row.cash || 0);
        const actualCash = expectedCash;
        const variance = actualCash - expectedCash;
        return {
          id: `recon-${row.date}`,
          date: row.date,
          expectedCash,
          actualCash,
          variance,
          status: variance === 0 ? "Balanced" : "Mismatch",
          sourceNote: "Derived from posted transactions for the selected date.",
        };
      }),
    [dailyFinancialRows],
  );

  const serviceChargeRows = useMemo(
    () =>
      filteredTransactions
        .filter((row) => Number(row.serviceCharge || 0) > 0)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .map((row) => ({
          id: `svc-${row.id}`,
          date: row.date,
          transactionType: row.transactionType,
          invoiceRef: row.invoiceRef,
          grossAmount: row.grossAmount,
          serviceCharge: row.serviceCharge,
          serviceRatePct: row.grossAmount ? pct(row.serviceCharge, row.grossAmount) : 0,
        })),
    [filteredTransactions],
  );

  const invoiceTaxLogRows = useMemo(
    () =>
      [...filteredTransactions]
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .map((row) => ({
          id: `log-${row.id}`,
          date: row.date,
          transactionType: row.transactionType,
          invoiceRef: row.invoiceRef,
          grossAmount: row.grossAmount,
          vatTax: row.vatTax,
          otherTax: row.otherTax,
          serviceCharge: row.serviceCharge,
          totalTax: row.taxAmount,
          netAmount: row.netAmount,
          paymentMethod: row.paymentBucket,
        })),
    [filteredTransactions],
  );

  const financialYearSummaryRows = useMemo(() => {
    const map = {};
    filteredTransactions.forEach((row) => {
      const fy = toFiscalYearLabel(row.date);
      if (!map[fy]) {
        map[fy] = {
          fiscalYear: fy,
          revenue: 0,
          expenses: 0,
          tax: 0,
          serviceCharge: 0,
        };
      }
      map[fy].revenue += Number(row.grossAmount || 0);
      map[fy].tax += Number(row.taxAmount || 0);
      map[fy].serviceCharge += Number(row.serviceCharge || 0);
    });
    filteredPurchases.forEach((row) => {
      const fy = toFiscalYearLabel(row.date);
      if (!map[fy]) {
        map[fy] = {
          fiscalYear: fy,
          revenue: 0,
          expenses: 0,
          tax: 0,
          serviceCharge: 0,
        };
      }
      map[fy].expenses += Number(row.totalCost || 0);
    });
    return Object.values(map)
      .map((row) => {
        const netProfit = row.revenue - row.expenses;
        return {
          ...row,
          netProfit,
          marginPct: row.revenue ? pct(netProfit, row.revenue) : 0,
        };
      })
      .sort((a, b) => a.fiscalYear.localeCompare(b.fiscalYear));
  }, [filteredTransactions, filteredPurchases]);

  const bankDepositRows = useMemo(() => {
    const dailyRows = dailyFinancialRows.map((row) => {
      const cashCollected = Number(row.cash || 0);
      const retainedFloat = Math.min(5000, Math.max(0, cashCollected * 0.1));
      const bankDeposit = Math.max(0, cashCollected - retainedFloat);
      return {
        id: `dep-day-${row.date}`,
        periodType: "Daily",
        period: row.date,
        cashCollected,
        retainedFloat,
        bankDeposit,
      };
    });

    const weeklyMap = {};
    dailyRows.forEach((row) => {
      const week = toWeekKey(row.period);
      if (!week) return;
      if (!weeklyMap[week]) {
        weeklyMap[week] = {
          id: `dep-week-${week}`,
          periodType: "Weekly",
          period: week,
          cashCollected: 0,
          retainedFloat: 0,
          bankDeposit: 0,
        };
      }
      weeklyMap[week].cashCollected += row.cashCollected;
      weeklyMap[week].retainedFloat += row.retainedFloat;
      weeklyMap[week].bankDeposit += row.bankDeposit;
    });

    const weeklyRows = Object.values(weeklyMap).sort((a, b) => a.period.localeCompare(b.period));
    return [...dailyRows, ...weeklyRows];
  }, [dailyFinancialRows]);

  const selectedSubReportPayload = useMemo(() => {
    const payloads = {
      "tax-summary": {
        exportColumns: [
          { label: "Date", value: "date" },
          { label: "Transaction Type", value: "transactionType" },
          { label: "Gross Amount", value: (row) => Number(row.grossAmount || 0) },
          { label: "Tax %", value: (row) => Number((row.taxPct || 0).toFixed(2)) },
          { label: "Tax Amount", value: (row) => Number(row.taxAmount || 0) },
          { label: "Net Amount", value: (row) => Number(row.netAmount || 0) },
          { label: "Invoice Ref", value: "invoiceRef" },
        ],
        exportRows: taxSummaryRows,
      },
      "payment-method": {
        exportColumns: [
          { label: "Date", value: "date" },
          { label: "Cash", value: (row) => Number(row.cash || 0) },
          { label: "Card", value: (row) => Number(row.card || 0) },
          { label: "Credit", value: (row) => Number(row.credit || 0) },
          { label: "Mixed", value: (row) => Number(row.mixed || 0) },
          { label: "Total", value: (row) => Number(row.total || 0) },
          { label: "# Transactions", value: (row) => Number(row.transactionCount || 0) },
        ],
        exportRows: paymentMethodSummaryRows,
      },
      "daily-summary": {
        exportColumns: [
          { label: "Date", value: "date" },
          { label: "Opening Balance", value: (row) => Number(row.openingBalance || 0) },
          { label: "Sales Revenue", value: (row) => Number(row.salesRevenue || 0) },
          { label: "Repair Revenue", value: (row) => Number(row.repairRevenue || 0) },
          { label: "Expenses", value: (row) => Number(row.expenses || 0) },
          { label: "Closing Balance", value: (row) => Number(row.closingBalance || 0) },
          { label: "Net", value: (row) => Number(row.net || 0) },
        ],
        exportRows: dailyFinancialRows,
      },
      "monthly-summary": {
        exportColumns: [
          { label: "Month", value: "monthLabel" },
          { label: "Revenue", value: (row) => Number(row.revenue || 0) },
          { label: "Expenses", value: (row) => Number(row.expenses || 0) },
          { label: "Tax", value: (row) => Number(row.tax || 0) },
          { label: "Net Profit", value: (row) => Number(row.netProfit || 0) },
          { label: "Margin %", value: (row) => Number((row.marginPct || 0).toFixed(2)) },
        ],
        exportRows: monthlyFinancialRows,
      },
      "vat-return": {
        exportColumns: [
          { label: "Period", value: "period" },
          { label: "Taxable Turnover", value: (row) => Number(row.taxableTurnover || 0) },
          { label: "Output VAT", value: (row) => Number(row.outputVat || 0) },
          { label: "Input VAT", value: (row) => Number(row.inputVatEstimate || 0) },
          { label: "Service Charge", value: (row) => Number(row.serviceCharge || 0) },
          { label: "Other Tax", value: (row) => Number(row.otherTax || 0) },
          { label: "Net VAT Payable", value: (row) => Number(row.netVatPayable || 0) },
        ],
        exportRows: vatReturnRows,
      },
      "cash-recon": {
        exportColumns: [
          { label: "Date", value: "date" },
          { label: "Expected Cash", value: (row) => Number(row.expectedCash || 0) },
          { label: "Actual Counted", value: (row) => Number(row.actualCash || 0) },
          { label: "Variance", value: (row) => Number(row.variance || 0) },
          { label: "Status", value: "status" },
          { label: "Note", value: "sourceNote" },
        ],
        exportRows: cashReconciliationRows,
      },
      "service-charge": {
        exportColumns: [
          { label: "Date", value: "date" },
          { label: "Transaction Type", value: "transactionType" },
          { label: "Invoice Ref", value: "invoiceRef" },
          { label: "Gross Amount", value: (row) => Number(row.grossAmount || 0) },
          { label: "Service Charge", value: (row) => Number(row.serviceCharge || 0) },
          { label: "Service Rate %", value: (row) => Number((row.serviceRatePct || 0).toFixed(2)) },
        ],
        exportRows: serviceChargeRows,
      },
      "invoice-tax-log": {
        exportColumns: [
          { label: "Date", value: "date" },
          { label: "Transaction Type", value: "transactionType" },
          { label: "Invoice Ref", value: "invoiceRef" },
          { label: "Gross", value: (row) => Number(row.grossAmount || 0) },
          { label: "VAT", value: (row) => Number(row.vatTax || 0) },
          { label: "Other Tax", value: (row) => Number(row.otherTax || 0) },
          { label: "Service Charge", value: (row) => Number(row.serviceCharge || 0) },
          { label: "Total Tax", value: (row) => Number(row.totalTax || 0) },
          { label: "Net", value: (row) => Number(row.netAmount || 0) },
          { label: "Payment Method", value: "paymentMethod" },
        ],
        exportRows: invoiceTaxLogRows,
      },
      "fy-summary": {
        exportColumns: [
          { label: "Fiscal Year", value: "fiscalYear" },
          { label: "Revenue", value: (row) => Number(row.revenue || 0) },
          { label: "Expenses", value: (row) => Number(row.expenses || 0) },
          { label: "Tax", value: (row) => Number(row.tax || 0) },
          { label: "Net Profit", value: (row) => Number(row.netProfit || 0) },
          { label: "Margin %", value: (row) => Number((row.marginPct || 0).toFixed(2)) },
        ],
        exportRows: financialYearSummaryRows,
      },
      "bank-deposits": {
        exportColumns: [
          { label: "Period Type", value: "periodType" },
          { label: "Period", value: "period" },
          { label: "Cash Collected", value: (row) => Number(row.cashCollected || 0) },
          { label: "Retained Float", value: (row) => Number(row.retainedFloat || 0) },
          { label: "Bank Deposit", value: (row) => Number(row.bankDeposit || 0) },
        ],
        exportRows: bankDepositRows,
      },
    };
    return payloads[activeSubReport] || payloads["tax-summary"];
  }, [
    activeSubReport,
    bankDepositRows,
    cashReconciliationRows,
    dailyFinancialRows,
    financialYearSummaryRows,
    invoiceTaxLogRows,
    monthlyFinancialRows,
    paymentMethodSummaryRows,
    serviceChargeRows,
    taxSummaryRows,
    vatReturnRows,
  ]);

  useEffect(() => {
    if (!onPrepared) return;
    onPrepared({
      exportColumns: selectedSubReportPayload.exportColumns,
      exportRows: selectedSubReportPayload.exportRows,
    });
  }, [onPrepared, selectedSubReportPayload.exportColumns, selectedSubReportPayload.exportRows]);

  const renderSubReport = () => {
    if (activeSubReport === "tax-summary") {
      return (
        <SectionCard title="Tax Summary Table">
          <MiniTable
            columns={[
              { label: "Date", value: (row) => (row.date ? new Date(row.date).toLocaleDateString() : "-") },
              { label: "Transaction Type", value: "transactionType" },
              { label: "Gross Amount", value: (row) => money(row.grossAmount) },
              { label: "Tax %", value: (row) => `${row.taxPct.toFixed(2)}%` },
              { label: "Tax Amount", value: (row) => money(row.taxAmount) },
              { label: "Net Amount", value: (row) => money(row.netAmount) },
              { label: "Invoice Ref", value: "invoiceRef" },
            ]}
            rows={taxSummaryRows}
            emptyLabel="No tax rows for selected filters."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "payment-method") {
      return (
        <SectionCard title="Payment Method Summary">
          <MiniTable
            columns={[
              { label: "Date", value: "date" },
              { label: "Cash", value: (row) => money(row.cash) },
              { label: "Card", value: (row) => money(row.card) },
              { label: "Credit", value: (row) => money(row.credit) },
              { label: "Mixed", value: (row) => money(row.mixed) },
              { label: "Total", value: (row) => money(row.total) },
              { label: "# Transactions", value: (row) => Number(row.transactionCount || 0).toLocaleString() },
            ]}
            rows={paymentMethodSummaryRows}
            emptyLabel="No payment method summary rows."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "daily-summary") {
      return (
        <SectionCard title="Daily Financial Summary">
          <MiniTable
            columns={[
              { label: "Date", value: "date" },
              { label: "Opening Balance", value: (row) => money(row.openingBalance) },
              { label: "Sales Revenue", value: (row) => money(row.salesRevenue) },
              { label: "Repair Revenue", value: (row) => money(row.repairRevenue) },
              { label: "Expenses", value: (row) => money(row.expenses) },
              { label: "Closing Balance", value: (row) => money(row.closingBalance) },
              { label: "Net", value: (row) => money(row.net) },
            ]}
            rows={dailyFinancialRows}
            emptyLabel="No daily financial summary rows."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "monthly-summary") {
      return (
        <SectionCard title="Monthly Financial Summary">
          <MiniTable
            columns={[
              { label: "Month", value: "monthLabel" },
              { label: "Revenue", value: (row) => money(row.revenue) },
              { label: "Expenses", value: (row) => money(row.expenses) },
              { label: "Tax", value: (row) => money(row.tax) },
              { label: "Net Profit", value: (row) => money(row.netProfit) },
              { label: "Margin %", value: (row) => `${row.marginPct.toFixed(2)}%` },
            ]}
            rows={monthlyFinancialRows}
            emptyLabel="No monthly summary rows."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "vat-return") {
      return (
        <SectionCard
          title="VAT Return Report"
          subtitle="Ready-to-file summary based on recorded sales tax and expense tax entries."
        >
          <MiniTable
            columns={[
              { label: "Period", value: "period" },
              { label: "Taxable Turnover", value: (row) => money(row.taxableTurnover) },
              { label: "Output VAT", value: (row) => money(row.outputVat) },
              { label: "Input VAT", value: (row) => money(row.inputVatEstimate) },
              { label: "Other Tax", value: (row) => money(row.otherTax) },
              { label: "Net VAT Payable", value: (row) => money(row.netVatPayable) },
            ]}
            rows={vatReturnRows}
            emptyLabel="No VAT return rows."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "cash-recon") {
      return (
        <SectionCard
          title="Cash Reconciliation Report"
          subtitle="Expected vs recorded cash from posted transactions."
        >
          <MiniTable
            columns={[
              { label: "Date", value: "date" },
              { label: "Expected", value: (row) => money(row.expectedCash) },
              { label: "Actual", value: (row) => money(row.actualCash) },
              {
                label: "Variance",
                value: (row) => <Badge tone={toneForVariance(row.variance)}>{money(row.variance)}</Badge>,
              },
              { label: "Status", value: (row) => <Badge tone={row.status === "Balanced" ? "green" : "red"}>{row.status}</Badge> },
              { label: "Note", value: "sourceNote" },
            ]}
            rows={cashReconciliationRows}
            emptyLabel="No reconciliation rows."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "service-charge") {
      return (
        <SectionCard title="Service Charge Report">
          <MiniTable
            columns={[
              { label: "Date", value: (row) => (row.date ? new Date(row.date).toLocaleDateString() : "-") },
              { label: "Type", value: "transactionType" },
              { label: "Invoice Ref", value: "invoiceRef" },
              { label: "Gross", value: (row) => money(row.grossAmount) },
              { label: "Service Charge", value: (row) => money(row.serviceCharge) },
              { label: "Rate %", value: (row) => `${row.serviceRatePct.toFixed(2)}%` },
            ]}
            rows={serviceChargeRows}
            emptyLabel="No service charge rows."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "invoice-tax-log") {
      return (
        <SectionCard title="Invoice-level Tax Log">
          <MiniTable
            columns={[
              { label: "Date", value: (row) => (row.date ? new Date(row.date).toLocaleDateString() : "-") },
              { label: "Type", value: "transactionType" },
              { label: "Invoice Ref", value: "invoiceRef" },
              { label: "Gross", value: (row) => money(row.grossAmount) },
              { label: "VAT", value: (row) => money(row.vatTax) },
              { label: "Other", value: (row) => money(row.otherTax) },
              { label: "Service", value: (row) => money(row.serviceCharge) },
              { label: "Total Tax", value: (row) => money(row.totalTax) },
              { label: "Net", value: (row) => money(row.netAmount) },
              { label: "Payment", value: "paymentMethod" },
            ]}
            rows={invoiceTaxLogRows}
            emptyLabel="No invoice-level tax log rows."
          />
        </SectionCard>
      );
    }

    if (activeSubReport === "fy-summary") {
      return (
        <SectionCard title="Financial Year Summary (April-March)">
          <MiniTable
            columns={[
              { label: "Fiscal Year", value: "fiscalYear" },
              { label: "Revenue", value: (row) => money(row.revenue) },
              { label: "Expenses", value: (row) => money(row.expenses) },
              { label: "Tax", value: (row) => money(row.tax) },
              { label: "Net Profit", value: (row) => money(row.netProfit) },
              { label: "Margin %", value: (row) => `${row.marginPct.toFixed(2)}%` },
            ]}
            rows={financialYearSummaryRows}
            emptyLabel="No financial year summary rows."
          />
        </SectionCard>
      );
    }

    return (
      <SectionCard
        title="Bank Deposit Summary"
        subtitle="Daily and weekly cash deposit recommendations derived from collected cash."
      >
        <MiniTable
          columns={[
            { label: "Period Type", value: "periodType" },
            { label: "Period", value: "period" },
            { label: "Cash Collected", value: (row) => money(row.cashCollected) },
            { label: "Retained Float", value: (row) => money(row.retainedFloat) },
            { label: "Bank Deposit", value: (row) => money(row.bankDeposit) },
          ]}
          rows={bankDepositRows}
          emptyLabel="No bank deposit rows."
        />
      </SectionCard>
    );
  };

  return (
    <div className="space-y-3">
      <SectionCard title="Tax & Financial Filters">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
          <input
            type="date"
            value={rangeFrom}
            onChange={(event) => setRangeFrom(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
            aria-label="Tax financial from date"
          />
          <input
            type="date"
            value={rangeTo}
            onChange={(event) => setRangeTo(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
            aria-label="Tax financial to date"
          />
          <Select
            value={taxTypeFilter}
            onChange={(event) => setTaxTypeFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
            aria-label="Tax type filter"
          >
            <option value="all">Tax Type: All</option>
            <option value="vat">VAT</option>
            <option value="service">Service Charge</option>
            <option value="other">Other</option>
          </Select>
          <Select
            value={paymentMethodFilter}
            onChange={(event) => setPaymentMethodFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
            aria-label="Payment method filter"
          >
            <option value="all">Payment: All</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="credit">Credit</option>
            <option value="mixed">Mixed</option>
          </Select>
          <Select
            value={transactionTypeFilter}
            onChange={(event) => setTransactionTypeFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
            aria-label="Transaction type filter"
          >
            <option value="all">Transactions: All</option>
            <option value="sale">Sale</option>
            <option value="repair">Repair</option>
          </Select>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <KpiCard
          title="Total Tax Collected (Period)"
          value={money(kpis.totalTaxCollected)}
          icon={<Receipt size={18} />}
        />
        <KpiCard
          title="Total Revenue (Gross)"
          value={money(kpis.totalGrossRevenue)}
          icon={<TrendingUp size={18} />}
          tone="green"
        />
        <KpiCard
          title="Total Revenue (Net of Tax)"
          value={money(kpis.totalNetRevenue)}
          icon={<Calculator size={18} />}
          tone="indigo"
        />
        <KpiCard
          title="Total Service Charges"
          value={money(kpis.totalServiceCharges)}
          icon={<Percent size={18} />}
          tone="amber"
        />
        <KpiCard
          title="Cash Transactions Total"
          value={money(kpis.cashTotal)}
          icon={<HandCoins size={18} />}
          tone="green"
        />
        <KpiCard
          title="Card Transactions Total"
          value={money(kpis.cardTotal)}
          icon={<CreditCard size={18} />}
          tone="indigo"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <SectionCard title="Tax Collected Trend (Monthly)">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={taxTrendRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="label" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip formatter={(value) => money(value)} />
                <Legend />
                <Line type="monotone" dataKey="totalTax" name="Tax Collected" stroke="#38bdf8" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="serviceCharge" name="Service Charge" stroke="#f59e0b" strokeWidth={2.2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Payment Method Analysis">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={paymentMethodAnalysisRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="method" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip formatter={(value) => money(value)} />
                <Bar dataKey="total" fill="#6366f1" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Revenue Reconciliation (Gross vs Net)">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueReconciliationRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="label" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip formatter={(value) => money(value)} />
                <Legend />
                <Bar dataKey="gross" name="Gross" fill="#22c55e" radius={[8, 8, 0, 0]} />
                <Bar dataKey="net" name="Net" fill="#38bdf8" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Daily Financial Summary">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailySummaryChartRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="day" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip formatter={(value) => money(value)} />
                <Legend />
                <Bar dataKey="gross" name="Gross" fill="#14b8a6" radius={[8, 8, 0, 0]} />
                <Bar dataKey="expenses" name="Expenses" fill="#f97316" radius={[8, 8, 0, 0]} />
                <Bar dataKey="net" name="Net" fill="#6366f1" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Tax & Financial Tables">
        <div className="flex flex-wrap gap-2">
          {SUB_REPORT_TABS.map((tab) => (
            <button
              key={tab.key}
              className={`btn btn-xs ${activeSubReport === tab.key ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveSubReport(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Values in this section are derived from persisted invoice, payment, and expense records.
        </p>
      </SectionCard>

      {renderSubReport()}
    </div>
  );
}
