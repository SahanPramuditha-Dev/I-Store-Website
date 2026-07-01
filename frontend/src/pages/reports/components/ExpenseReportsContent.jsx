import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  DollarSign,
  HandCoins,
  ReceiptText,
  Repeat2,
  UserCheck,
  Wallet,
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
const DAY_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" });
const CALENDAR_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const CATEGORY_KEYS = ["Rent", "Salary", "Utilities", "Misc"];
const CATEGORY_COLORS = {
  Rent: "#38bdf8",
  Salary: "#6366f1",
  Utilities: "#14b8a6",
  Misc: "#f59e0b",
};
const SUB_REPORT_TABS = [
  { key: "category", label: "By Category" },
  { key: "recurring", label: "Recurring Expenses" },
  { key: "one-time", label: "One-Time Expenses" },
  { key: "daily", label: "Daily Summary" },
  { key: "monthly", label: "Monthly Summary" },
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

function withinRange(value, start, endExclusive) {
  const date = toDate(value);
  if (!date) return false;
  if (start && date < start) return false;
  if (endExclusive && date >= endExclusive) return false;
  return true;
}

function enumerateDays(fromValue, toValue) {
  const start = parseDateInput(fromValue);
  const end = parseDateInput(toValue, true);
  if (!start || !end || start >= end) return [];
  const rows = [];
  const cursor = new Date(start);
  while (cursor < end) {
    rows.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return rows;
}

function enumerateMonths(fromValue, toValue, fallbackRows = []) {
  const start = parseDateInput(fromValue);
  const end = parseDateInput(toValue);
  if (start && end && start <= end) {
    const rows = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const stop = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cursor <= stop) {
      rows.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return rows;
  }

  const unique = [...new Set(fallbackRows.map((row) => toMonthKey(row.created_at)).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
  return unique.map((monthKey) => toDate(`${monthKey}-01T00:00:00`)).filter(Boolean);
}

function classifyExpenseCategory(row) {
  const text = `${row.category || ""} ${row.note || ""} ${row.po_number || ""}`.toLowerCase();
  if (text.includes("rent") || text.includes("lease")) return "Rent";
  if (
    text.includes("salary") ||
    text.includes("wage") ||
    text.includes("payroll") ||
    text.includes("allowance") ||
    text.includes("staff")
  ) {
    return "Salary";
  }
  if (
    text.includes("utility") ||
    text.includes("electric") ||
    text.includes("water") ||
    text.includes("internet") ||
    text.includes("phone") ||
    text.includes("wifi")
  ) {
    return "Utilities";
  }
  return "Misc";
}

function extractByPattern(text, patterns) {
  const source = String(text || "");
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function inferRecurring(row, category) {
  const text = `${row.note || ""} ${row.status || ""}`.toLowerCase();
  if (text.includes("one-time") || text.includes("one time") || text.includes("adhoc") || text.includes("ad hoc")) {
    return false;
  }
  if (
    text.includes("recurring") ||
    text.includes("monthly") ||
    text.includes("subscription") ||
    text.includes("fixed cost") ||
    text.includes("every month")
  ) {
    return true;
  }
  return category === "Rent" || category === "Salary" || category === "Utilities";
}

function isCompletedRepair(status) {
  const value = String(status || "").toLowerCase();
  return value === "completed" || value === "delivered";
}

function toneForApproval(status) {
  if (status === "Approved") return "green";
  if (status === "Auto") return "sky";
  return "amber";
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

export default function ExpenseReportsContent({
  expenseRows,
  salesRows,
  repairRows,
  suppliersRows,
  dateFrom,
  dateTo,
  query,
  onPrepared,
}) {
  const [activeTab, setActiveTab] = useState("category");
  const [page, setPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [addedByFilter, setAddedByFilter] = useState("all");
  const [recurringFilter, setRecurringFilter] = useState("all");
  const [approvalThreshold, setApprovalThreshold] = useState(50000);
  const [pettyCashLimit, setPettyCashLimit] = useState(5000);
  const [budgetByCategory, setBudgetByCategory] = useState({
    Rent: 150000,
    Salary: 400000,
    Utilities: 90000,
    Misc: 120000,
  });
  const pageSize = 12;

  const suppliersById = useMemo(
    () =>
      Object.fromEntries(
        (suppliersRows || []).map((supplier) => [String(supplier.id), supplier.name || `Supplier #${supplier.id}`]),
      ),
    [suppliersRows],
  );

  const baseRows = useMemo(() => {
    return (expenseRows || []).map((row) => {
      const createdAt = row.expense_date || row.created_at || row.createdAt;
      const createdDate = toDate(createdAt);
      const category = classifyExpenseCategory(row);
      const amount = Number(row.amount || row.total_cost || 0);
      const addedBy =
        row.added_by ||
        row.created_by ||
        row.created_by_name ||
        extractByPattern(row.note, [
          /added by[:\s-]+([a-zA-Z0-9 ._@-]+)/i,
          /entered by[:\s-]+([a-zA-Z0-9 ._@-]+)/i,
          /created by[:\s-]+([a-zA-Z0-9 ._@-]+)/i,
        ]) ||
        "System";
      const approvedBy =
        row.approved_by ||
        row.approved_by_name ||
        extractByPattern(row.note, [
          /approved by[:\s-]+([a-zA-Z0-9 ._@-]+)/i,
          /authorized by[:\s-]+([a-zA-Z0-9 ._@-]+)/i,
        ]) ||
        "";
      const recurring = inferRecurring(row, category);
      const vendor =
        row.supplier_name ||
        row.vendor_name ||
        row.supplier?.name ||
        suppliersById[String(row.supplier_id)] ||
        "Unassigned";
      const description = row.note || "No description";
      const referenceNo = row.reference_no || row.po_number || `PO-${row.id}`;
      const approvalStatus =
        amount < Number(approvalThreshold || 0)
          ? "Auto"
          : approvedBy
            ? "Approved"
            : "Pending";
      return {
        ...row,
        amount,
        category,
        description,
        addedBy,
        approvedBy,
        approvalStatus,
        recurring,
        recurringLabel: recurring ? "Recurring" : "One-Time",
        vendor,
        referenceNo,
        createdAt,
        createdDate,
        dayKey: toDayKey(createdAt),
        monthKey: toMonthKey(createdAt),
        dayLabel: createdDate ? DAY_LABEL.format(createdDate) : "-",
        monthLabel: createdDate ? MONTH_LABEL.format(createdDate) : "-",
      };
    });
  }, [approvalThreshold, expenseRows, suppliersById]);

  const filterOptions = useMemo(() => {
    const addedBySet = new Set();
    baseRows.forEach((row) => addedBySet.add(row.addedBy || "System"));
    return {
      categories: CATEGORY_KEYS,
      addedBy: [...addedBySet].sort((a, b) => a.localeCompare(b)),
    };
  }, [baseRows]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const start = parseDateInput(dateFrom);
    const end = parseDateInput(dateTo, true);
    return baseRows.filter((row) => {
      if (!withinRange(row.createdAt, start, end)) return false;
      if (categoryFilter !== "all" && row.category !== categoryFilter) return false;
      if (addedByFilter !== "all" && row.addedBy !== addedByFilter) return false;
      if (recurringFilter === "recurring" && !row.recurring) return false;
      if (recurringFilter === "one-time" && row.recurring) return false;
      if (!normalizedQuery) return true;

      const searchable = [
        row.referenceNo,
        row.description,
        row.category,
        row.addedBy,
        row.vendor,
        row.status,
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [addedByFilter, baseRows, categoryFilter, dateFrom, dateTo, query, recurringFilter]);

  useEffect(() => {
    setPage(1);
  }, [categoryFilter, addedByFilter, recurringFilter, query, dateFrom, dateTo]);

  const analytics = useMemo(() => {
    const categoryTotals = filteredRows.reduce(
      (acc, row) => {
        const bucket = CATEGORY_KEYS.includes(row.category) ? row.category : "Misc";
        acc[bucket] += Number(row.amount || 0);
        return acc;
      },
      { Rent: 0, Salary: 0, Utilities: 0, Misc: 0 },
    );

    const totalExpenses = CATEGORY_KEYS.reduce((acc, key) => acc + Number(categoryTotals[key] || 0), 0);
    const largestCategory = CATEGORY_KEYS.reduce((best, current) =>
      categoryTotals[current] > categoryTotals[best] ? current : best,
    "Rent");
    const largestCategoryValue = Number(categoryTotals[largestCategory] || 0);

    const totalRevenue =
      (salesRows || [])
        .filter((sale) => !sale.is_voided && !sale.is_return)
        .reduce((acc, sale) => acc + Number(sale.total || 0), 0) +
      (repairRows || [])
        .filter((repair) => isCompletedRepair(repair.status))
        .reduce((acc, repair) => acc + Number(repair.invoice_amount ?? repair.estimated_cost ?? 0), 0);

    const expenseVsRevenuePct = totalRevenue > 0 ? (totalExpenses / totalRevenue) * 100 : 0;

    const monthDates = enumerateMonths(dateFrom, dateTo, filteredRows);
    const monthMap = Object.fromEntries(
      monthDates.map((date) => {
        const monthKey = toMonthKey(date);
        return [
          monthKey,
          {
            monthKey,
            month: MONTH_LABEL.format(date),
            expenses: 0,
            revenue: 0,
            Rent: 0,
            Salary: 0,
            Utilities: 0,
            Misc: 0,
          },
        ];
      }),
    );

    filteredRows.forEach((row) => {
      if (!monthMap[row.monthKey]) {
        const parsed = toDate(`${row.monthKey}-01T00:00:00`);
        monthMap[row.monthKey] = {
          monthKey: row.monthKey,
          month: parsed ? MONTH_LABEL.format(parsed) : row.monthKey,
          expenses: 0,
          revenue: 0,
          Rent: 0,
          Salary: 0,
          Utilities: 0,
          Misc: 0,
        };
      }
      const bucket = CATEGORY_KEYS.includes(row.category) ? row.category : "Misc";
      monthMap[row.monthKey].expenses += Number(row.amount || 0);
      monthMap[row.monthKey][bucket] += Number(row.amount || 0);
    });

    (salesRows || [])
      .filter((sale) => !sale.is_voided && !sale.is_return && withinRange(sale.created_at, parseDateInput(dateFrom), parseDateInput(dateTo, true)))
      .forEach((sale) => {
        const key = toMonthKey(sale.created_at);
        if (!monthMap[key]) {
          const parsed = toDate(`${key}-01T00:00:00`);
          monthMap[key] = {
            monthKey: key,
            month: parsed ? MONTH_LABEL.format(parsed) : key,
            expenses: 0,
            revenue: 0,
            Rent: 0,
            Salary: 0,
            Utilities: 0,
            Misc: 0,
          };
        }
        monthMap[key].revenue += Number(sale.total || 0);
      });

    (repairRows || [])
      .filter(
        (repair) =>
          isCompletedRepair(repair.status) &&
          withinRange(repair.delivered_at || repair.created_at, parseDateInput(dateFrom), parseDateInput(dateTo, true)),
      )
      .forEach((repair) => {
        const key = toMonthKey(repair.delivered_at || repair.created_at);
        if (!monthMap[key]) {
          const parsed = toDate(`${key}-01T00:00:00`);
          monthMap[key] = {
            monthKey: key,
            month: parsed ? MONTH_LABEL.format(parsed) : key,
            expenses: 0,
            revenue: 0,
            Rent: 0,
            Salary: 0,
            Utilities: 0,
            Misc: 0,
          };
        }
        monthMap[key].revenue += Number(repair.invoice_amount ?? repair.estimated_cost ?? 0);
      });

    const monthlyRows = Object.values(monthMap).sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    const dailyMap = {};
    enumerateDays(dateFrom, dateTo).forEach((date) => {
      const key = toDayKey(date);
      dailyMap[key] = { dayKey: key, day: DAY_LABEL.format(date), count: 0, total: 0 };
    });
    filteredRows.forEach((row) => {
      if (!dailyMap[row.dayKey]) {
        dailyMap[row.dayKey] = { dayKey: row.dayKey, day: row.dayLabel, count: 0, total: 0 };
      }
      dailyMap[row.dayKey].count += 1;
      dailyMap[row.dayKey].total += Number(row.amount || 0);
    });

    const dailyRows = Object.values(dailyMap).sort((a, b) => a.dayKey.localeCompare(b.dayKey));
    const byCategoryRows = CATEGORY_KEYS.map((category) => {
      const rows = filteredRows.filter((row) => (CATEGORY_KEYS.includes(row.category) ? row.category : "Misc") === category);
      const total = rows.reduce((acc, row) => acc + Number(row.amount || 0), 0);
      return {
        category,
        records: rows.length,
        total,
        avg: rows.length > 0 ? total / rows.length : 0,
        sharePct: pct(total, totalExpenses),
      };
    }).sort((a, b) => b.total - a.total);

    const recurringRows = filteredRows.filter((row) => row.recurring).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const oneTimeRows = filteredRows.filter((row) => !row.recurring).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const monthlySummaryRows = monthlyRows.map((row, index, arr) => {
      const prev = arr[index - 1];
      const changePct = prev && prev.expenses > 0 ? ((row.expenses - prev.expenses) / prev.expenses) * 100 : 0;
      return {
        ...row,
        changePct,
      };
    });

    const budgetRows = CATEGORY_KEYS.map((category) => {
      const budget = Number(budgetByCategory[category] || 0);
      const actual = Number(categoryTotals[category] || 0);
      const usedPct = budget > 0 ? (actual / budget) * 100 : 0;
      return {
        category,
        budget,
        actual,
        variance: actual - budget,
        usedPct,
      };
    });

    const approvalRows = filteredRows
      .filter((row) => Number(row.amount || 0) >= Number(approvalThreshold || 0))
      .map((row) => ({
        id: row.id,
        date: row.createdAt,
        reference: row.referenceNo,
        category: row.category,
        amount: row.amount,
        addedBy: row.addedBy,
        approvedBy: row.approvedBy || "-",
        status: row.approvalStatus,
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    const recurringCalendarRows = recurringRows
      .slice(0, 24)
      .flatMap((row) => {
        const baseDate = toDate(row.createdAt);
        if (!baseDate) return [];
        const schedules = [];
        const now = toDate(dateTo) || new Date();
        for (let i = 0; i < 2; i += 1) {
          const dueDate = new Date(now.getFullYear(), now.getMonth() + i, baseDate.getDate());
          schedules.push({
            key: `${row.id}-${i}`,
            date: dueDate.toISOString(),
            label: CALENDAR_LABEL.format(dueDate),
            category: row.category,
            description: row.description,
            amount: row.amount,
          });
        }
        return schedules;
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 16);

    const categoryStats = filteredRows.reduce((acc, row) => {
      const bucket = CATEGORY_KEYS.includes(row.category) ? row.category : "Misc";
      if (!acc[bucket]) {
        acc[bucket] = { count: 0, total: 0, values: [] };
      }
      acc[bucket].count += 1;
      acc[bucket].total += Number(row.amount || 0);
      acc[bucket].values.push(Number(row.amount || 0));
      return acc;
    }, {});

    const anomalies = filteredRows
      .filter((row) => {
        const bucket = CATEGORY_KEYS.includes(row.category) ? row.category : "Misc";
        const stats = categoryStats[bucket];
        if (!stats || stats.count < 3) return false;
        const avg = stats.total / stats.count;
        return Number(row.amount || 0) > avg * 1.8 && Number(row.amount || 0) > 10000;
      })
      .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
      .slice(0, 12);

    const pettyCashRows = filteredRows
      .filter((row) => Number(row.amount || 0) <= Number(pettyCashLimit || 0) || String(row.description || "").toLowerCase().includes("petty"))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const vendorLinkedRows = Object.values(
      filteredRows.reduce((acc, row) => {
        const key = row.vendor || "Unassigned";
        if (!acc[key]) {
          acc[key] = {
            vendor: key,
            records: 0,
            total: 0,
            lastDate: row.createdAt,
            categories: new Set(),
          };
        }
        acc[key].records += 1;
        acc[key].total += Number(row.amount || 0);
        acc[key].categories.add(row.category);
        if (toDate(row.createdAt) > toDate(acc[key].lastDate)) {
          acc[key].lastDate = row.createdAt;
        }
        return acc;
      }, {}),
    )
      .map((row) => ({
        ...row,
        categoriesText: [...row.categories].sort((a, b) => a.localeCompare(b)).join(", "),
      }))
      .sort((a, b) => b.total - a.total);

    return {
      totalExpenses,
      categoryTotals,
      largestCategory,
      largestCategoryValue,
      expenseVsRevenuePct,
      totalRevenue,
      monthlyRows,
      dailyRows,
      byCategoryRows,
      recurringRows,
      oneTimeRows,
      monthlySummaryRows,
      budgetRows,
      approvalRows,
      recurringCalendarRows,
      anomalies,
      pettyCashRows,
      vendorLinkedRows,
    };
  }, [
    approvalThreshold,
    budgetByCategory,
    dateFrom,
    dateTo,
    filteredRows,
    pettyCashLimit,
    repairRows,
    salesRows,
  ]);

  const sortedTableRows = useMemo(
    () => [...filteredRows].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [filteredRows],
  );
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedTableRows.slice(start, start + pageSize);
  }, [page, sortedTableRows]);
  const totalPages = Math.max(1, Math.ceil(sortedTableRows.length / pageSize));

  useEffect(() => {
    if (!onPrepared) return;
    onPrepared({
      exportColumns: [
        { label: "Date", value: "createdAt" },
        { label: "Category", value: "category" },
        { label: "Description", value: "description" },
        { label: "Amount", value: (row) => Number(row.amount || 0) },
        { label: "Added By", value: "addedBy" },
        { label: "Reference No", value: "referenceNo" },
        { label: "Recurring", value: "recurringLabel" },
        { label: "Vendor", value: "vendor" },
      ],
      exportRows: sortedTableRows,
    });
  }, [onPrepared, sortedTableRows]);

  return (
    <>
      <SectionCard title="Expense Filters" subtitle={`Date range: ${dateFrom || "-"} to ${dateTo || "-"}`}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <Select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
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
            value={addedByFilter}
            onChange={(event) => setAddedByFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          >
            <option value="all">All Employees</option>
            {filterOptions.addedBy.map((addedBy) => (
              <option key={addedBy} value={addedBy}>
                {addedBy}
              </option>
            ))}
          </Select>

          <Select
            value={recurringFilter}
            onChange={(event) => setRecurringFilter(event.target.value)}
            className="field !py-2 !px-3 !text-xs"
          >
            <option value="all">Recurring + One-Time</option>
            <option value="recurring">Recurring Only</option>
            <option value="one-time">One-Time Only</option>
          </Select>

          <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-300">
            <CalendarClock size={14} />
            {sortedTableRows.length.toLocaleString()} records
          </div>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard title="Total Expenses (Period)" value={money(analytics.totalExpenses)} icon={<Wallet size={18} />} tone="amber" />
        <KpiCard title="Rent Total" value={money(analytics.categoryTotals.Rent)} icon={<ReceiptText size={18} />} tone="sky" />
        <KpiCard title="Salary Total" value={money(analytics.categoryTotals.Salary)} icon={<UserCheck size={18} />} tone="indigo" />
        <KpiCard title="Utilities Total" value={money(analytics.categoryTotals.Utilities)} icon={<HandCoins size={18} />} tone="green" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard title="Misc Expenses" value={money(analytics.categoryTotals.Misc)} icon={<AlertTriangle size={18} />} tone="red" />
        <KpiCard
          title="Largest Expense Category"
          value={`${analytics.largestCategory} (${money(analytics.largestCategoryValue)})`}
          icon={<DollarSign size={18} />}
          tone="violet"
        />
        <KpiCard
          title="Expenses vs Revenue %"
          value={`${analytics.expenseVsRevenuePct.toFixed(2)}%`}
          hint={`Revenue: ${money(analytics.totalRevenue)}`}
          icon={<Wallet size={18} />}
          tone="sky"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-4" title="Expense Breakdown Pie">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={CATEGORY_KEYS.map((key) => ({ name: key, value: Number(analytics.categoryTotals[key] || 0) }))}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={54}
                  outerRadius={88}
                  stroke="none"
                >
                  {CATEGORY_KEYS.map((key) => (
                    <Cell key={key} fill={CATEGORY_COLORS[key]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => money(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5">
            {CATEGORY_KEYS.map((key) => (
              <div key={key} className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[key] }} />
                  <span>{key}</span>
                </div>
                <span className="font-bold text-white">{money(analytics.categoryTotals[key])}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-8" title="Monthly Expense Trend">
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics.monthlyRows}>
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
                <Line type="monotone" dataKey="expenses" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-7" title="Category Comparison Bar">
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.monthlyRows}>
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
                <Bar dataKey="Rent" fill={CATEGORY_COLORS.Rent} radius={[6, 6, 0, 0]} />
                <Bar dataKey="Salary" fill={CATEGORY_COLORS.Salary} radius={[6, 6, 0, 0]} />
                <Bar dataKey="Utilities" fill={CATEGORY_COLORS.Utilities} radius={[6, 6, 0, 0]} />
                <Bar dataKey="Misc" fill={CATEGORY_COLORS.Misc} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-5" title="Expense vs Revenue Overlay">
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics.monthlyRows}>
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
                <Line type="monotone" dataKey="expenses" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="revenue" stroke="#38bdf8" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Expense Data Table" subtitle="Paginated expense log">
        <MiniTable
          columns={[
            { label: "Date", value: (row) => row.createdDate ? row.createdDate.toLocaleDateString("en-CA") : "-" },
            { label: "Category", value: "category" },
            { label: "Description", value: (row) => row.description || "-" },
            { label: "Amount", value: (row) => money(row.amount) },
            { label: "Added By", value: "addedBy" },
            { label: "Reference No.", value: "referenceNo" },
            {
              label: "Recurring",
              value: (row) => (
                <Badge tone={row.recurring ? "indigo" : "slate"}>
                  {row.recurringLabel}
                </Badge>
              ),
            },
            {
              label: "Actions",
              value: () => (
                <div className="inline-flex gap-1">
                  <Button size="sm" variant="secondary" type="button">View</Button>
                  <Button size="sm" variant="ghost" type="button">Flag</Button>
                </div>
              ),
            },
          ]}
          rows={paginatedRows}
          emptyLabel="No expense records for this filter set."
        />
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            Showing {(sortedTableRows.length === 0 ? 0 : (page - 1) * pageSize + 1).toLocaleString()}-
            {Math.min(page * pageSize, sortedTableRows.length).toLocaleString()} of {sortedTableRows.length.toLocaleString()}
          </p>
          <div className="inline-flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Prev
            </Button>
            <Badge tone="indigo">Page {page} / {totalPages}</Badge>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Sub-Report Views">
        <div className="flex flex-wrap gap-1.5 mb-3">
          {SUB_REPORT_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`btn btn-sm ${activeTab === tab.key ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "category" && (
          <MiniTable
            columns={[
              { label: "Category", value: "category" },
              { label: "Records", value: (row) => row.records.toLocaleString() },
              { label: "Total", value: (row) => money(row.total) },
              { label: "Average", value: (row) => money(row.avg) },
              { label: "% of Total", value: (row) => `${row.sharePct.toFixed(2)}%` },
            ]}
            rows={analytics.byCategoryRows}
            emptyLabel="No category summary rows."
          />
        )}

        {activeTab === "recurring" && (
          <MiniTable
            columns={[
              { label: "Date", value: (row) => row.createdDate ? row.createdDate.toLocaleDateString("en-CA") : "-" },
              { label: "Category", value: "category" },
              { label: "Description", value: "description" },
              { label: "Amount", value: (row) => money(row.amount) },
              { label: "Vendor", value: "vendor" },
            ]}
            rows={analytics.recurringRows}
            emptyLabel="No recurring expenses."
          />
        )}

        {activeTab === "one-time" && (
          <MiniTable
            columns={[
              { label: "Date", value: (row) => row.createdDate ? row.createdDate.toLocaleDateString("en-CA") : "-" },
              { label: "Category", value: "category" },
              { label: "Description", value: "description" },
              { label: "Amount", value: (row) => money(row.amount) },
              { label: "Added By", value: "addedBy" },
            ]}
            rows={analytics.oneTimeRows}
            emptyLabel="No one-time expenses."
          />
        )}

        {activeTab === "daily" && (
          <MiniTable
            columns={[
              { label: "Day", value: "day" },
              { label: "Records", value: (row) => row.count.toLocaleString() },
              { label: "Total", value: (row) => money(row.total) },
            ]}
            rows={analytics.dailyRows}
            emptyLabel="No daily totals."
          />
        )}

        {activeTab === "monthly" && (
          <MiniTable
            columns={[
              { label: "Month", value: "month" },
              { label: "Rent", value: (row) => money(row.Rent) },
              { label: "Salary", value: (row) => money(row.Salary) },
              { label: "Utilities", value: (row) => money(row.Utilities) },
              { label: "Misc", value: (row) => money(row.Misc) },
              { label: "Total", value: (row) => money(row.expenses) },
              { label: "Trend", value: (row) => `${Number(row.changePct || 0).toFixed(1)}%` },
            ]}
            rows={analytics.monthlySummaryRows}
            emptyLabel="No monthly summary."
          />
        )}
      </SectionCard>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-7" title="Expense Budget vs Actual">
          <div className="space-y-3">
            {analytics.budgetRows.map((row) => {
              const tone = row.variance > 0 ? "text-rose-300" : "text-emerald-300";
              return (
                <div key={row.category} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-slate-400">{row.category}</p>
                      <p className={`text-sm font-bold ${tone}`}>Variance {money(row.variance)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Budget</span>
                      <input
                        type="number"
                        min="0"
                        className="field !py-1.5 !px-2 !text-xs w-28"
                        value={Number(budgetByCategory[row.category] || 0)}
                        onChange={(event) =>
                          setBudgetByCategory((prev) => ({
                            ...prev,
                            [row.category]: Math.max(0, Number(event.target.value || 0)),
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full ${row.usedPct > 100 ? "bg-rose-400" : "bg-emerald-400"}`}
                      style={{ width: `${Math.min(100, Math.max(0, row.usedPct))}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    Actual {money(row.actual)} / Budget {money(row.budget)} ({row.usedPct.toFixed(1)}%)
                  </p>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-5" title="Expense Approval Workflow Tracker">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-400">Large expense threshold</p>
            <input
              type="number"
              min="0"
              className="field !py-1.5 !px-2 !text-xs w-32"
              value={approvalThreshold}
              onChange={(event) => setApprovalThreshold(Math.max(0, Number(event.target.value || 0)))}
            />
          </div>
          <MiniTable
            columns={[
              { label: "Ref", value: "reference" },
              { label: "Amount", value: (row) => money(row.amount) },
              { label: "Added By", value: "addedBy" },
              { label: "Approved By", value: "approvedBy" },
              {
                label: "Status",
                value: (row) => (
                  <Badge tone={toneForApproval(row.status)}>
                    {row.status}
                  </Badge>
                ),
              },
            ]}
            rows={analytics.approvalRows.slice(0, 12)}
            emptyLabel="No large expenses in this range."
          />
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-4" title="Recurring Expense Calendar">
          <MiniTable
            columns={[
              { label: "Due", value: "label" },
              { label: "Category", value: "category" },
              { label: "Description", value: "description" },
              { label: "Amount", value: (row) => money(row.amount) },
            ]}
            rows={analytics.recurringCalendarRows}
            emptyLabel="No recurring schedule inferred."
          />
        </SectionCard>

        <SectionCard className="xl:col-span-4" title="Expense Anomaly Alerts">
          <MiniTable
            columns={[
              { label: "Date", value: (row) => row.createdDate ? row.createdDate.toLocaleDateString("en-CA") : "-" },
              { label: "Category", value: "category" },
              { label: "Description", value: "description" },
              { label: "Amount", value: (row) => money(row.amount) },
            ]}
            rows={analytics.anomalies}
            emptyLabel="No anomaly spikes detected."
          />
        </SectionCard>

        <SectionCard className="xl:col-span-4" title="Petty Cash Log">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-400">Petty-cash limit</p>
            <input
              type="number"
              min="0"
              className="field !py-1.5 !px-2 !text-xs w-28"
              value={pettyCashLimit}
              onChange={(event) => setPettyCashLimit(Math.max(0, Number(event.target.value || 0)))}
            />
          </div>
          <MiniTable
            columns={[
              { label: "Date", value: (row) => row.createdDate ? row.createdDate.toLocaleDateString("en-CA") : "-" },
              { label: "Ref", value: "referenceNo" },
              { label: "Description", value: "description" },
              { label: "Amount", value: (row) => money(row.amount) },
            ]}
            rows={analytics.pettyCashRows.slice(0, 20)}
            emptyLabel="No petty-cash records found."
          />
        </SectionCard>
      </div>

      <SectionCard title="Vendor-linked Expenses">
        <MiniTable
          columns={[
            { label: "Vendor", value: "vendor" },
            { label: "Records", value: (row) => row.records.toLocaleString() },
            { label: "Total", value: (row) => money(row.total) },
            { label: "Categories", value: "categoriesText" },
            { label: "Last Expense", value: (row) => (toDate(row.lastDate) ? toDate(row.lastDate).toLocaleDateString("en-CA") : "-") },
          ]}
          rows={analytics.vendorLinkedRows}
          emptyLabel="No vendor-linked expenses."
        />
      </SectionCard>

      <div className="rounded-xl border border-dashed border-white/10 bg-black/10 p-3 text-xs text-slate-400">
        <div className="flex items-start gap-2">
          <Repeat2 size={14} className="mt-0.5 text-slate-500" />
          <p>
            Recurring flags, added-by, and approval ownership are derived from available PO fields and note text when explicit expense-workflow fields are not yet stored by the backend.
          </p>
        </div>
      </div>
    </>
  );
}


