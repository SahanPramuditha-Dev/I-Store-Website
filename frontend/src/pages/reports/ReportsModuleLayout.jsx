import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useMemo, useState } from "react";
import { CalendarRange, FileDown, Search } from "lucide-react";
import { useFetch } from "../../hooks/useFetch";
import { REPORT_SECTIONS } from "./reportsConfig";

function toIsoDate(date) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  return value.toISOString().slice(0, 10);
}

function getPresetRange(preset) {
  const now = new Date();
  const today = toIsoDate(now);
  if (preset === "today") return { from: today, to: today };
  if (preset === "week") {
    const day = now.getDay();
    const diff = (day + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diff);
    return { from: toIsoDate(monday), to: today };
  }
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: toIsoDate(startOfMonth), to: today };
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export default function ReportsModuleLayout() {
  const location = useLocation();
  const defaultRange = getPresetRange("month");
  const [datePreset, setDatePreset] = useState("month");
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);
  const [query, setQuery] = useState("");

  const hasRange = Boolean(dateFrom) && Boolean(dateTo);
  const queryRange = hasRange ? `?date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}` : "";
  const activeSlug = location.pathname.split("/").filter(Boolean).at(-1) || "overview";
  const shouldFetch = (...slugs) => activeSlug === "export-center" || slugs.includes(activeSlug);

  const { data: salesRaw, loading: salesLoading } = useFetch(shouldFetch("overview", "sales", "profit-loss", "outstanding-payments", "product-performance", "customer-reports", "tax-financial", "refunds-returns") ? `/reports/sales${queryRange}` : null);
  const { data: repairsRaw, loading: repairsLoading } = useFetch(shouldFetch("overview", "repairs", "customer-reports", "refunds-returns") ? `/reports/repairs${queryRange}` : null);
  const { data: summaryRaw, loading: summaryLoading } = useFetch(shouldFetch("overview", "sales", "profit-loss", "tax-financial") ? `/reports/summary${queryRange}` : null);
  const { data: inventoryRaw, loading: inventoryLoading } = useFetch(shouldFetch("overview", "inventory", "profit-loss", "product-performance", "supplier-reports") ? "/reports/inventory" : null);
  const { data: repairTicketsRaw, loading: repairTicketsLoading } = useFetch(shouldFetch("repairs", "outstanding-payments", "technician-performance", "customer-reports") ? "/repairs" : null);
  const { data: customersRaw, loading: customersLoading } = useFetch(shouldFetch("sales", "outstanding-payments", "customer-reports") ? "/customers" : null);
  const { data: suppliersRaw, loading: suppliersLoading } = useFetch(shouldFetch("supplier-reports") ? "/inventory/suppliers" : null);
  const { data: purchaseRaw, loading: purchaseLoading } = useFetch(shouldFetch("profit-loss", "supplier-reports") ? "/purchase" : null);
  const { data: expensesRaw, loading: expensesLoading } = useFetch(shouldFetch("expenses", "profit-loss", "tax-financial") ? `/reports/expenses${queryRange}` : null);
  const { data: movementsRaw, loading: movementsLoading } = useFetch(shouldFetch("inventory", "product-performance") ? "/inventory/movements" : null);
  const { data: dashboardRaw, loading: dashboardLoading } = useFetch(shouldFetch("overview") ? "/dashboard" : null);
  const { data: notificationsRaw, loading: notificationsLoading } = useFetch(shouldFetch("overview") ? "/notifications" : null);
  const { data: auditActivityRaw, loading: auditActivityLoading } = useFetch(shouldFetch("audit") ? `/reports/audit-activity${queryRange}` : null);
  const { data: auditRepairHistoryRaw, loading: auditRepairHistoryLoading } = useFetch(shouldFetch("audit") ? `/reports/audit-repair-history${queryRange}` : null);
  const { data: priceAdjustmentsRaw, loading: priceAdjustmentsLoading } = useFetch(shouldFetch("inventory") ? "/inventory/price-adjustments" : null);
  const { data: discountsRaw, loading: discountsLoading } = useFetch(shouldFetch("inventory") ? "/inventory/discounts" : null);
  const { data: backupsRaw, loading: backupsLoading } = useFetch(shouldFetch("audit") ? "/backup" : null);
  const { data: employeesRaw, loading: employeesLoading } = useFetch(shouldFetch("technician-performance", "audit") ? "/settings/employees" : null);

  const inRange = (iso) => {
    if (!iso) return false;
    const value = new Date(iso);
    if (Number.isNaN(value.getTime())) return false;
    if (dateFrom) {
      const start = new Date(dateFrom);
      if (value < start) return false;
    }
    if (dateTo) {
      const end = new Date(dateTo);
      end.setDate(end.getDate() + 1);
      if (value >= end) return false;
    }
    return true;
  };

  const salesRows = useMemo(() => safeArray(salesRaw), [salesRaw]);
  const repairRows = useMemo(() => safeArray(repairsRaw), [repairsRaw]);
  const inventoryRows = useMemo(() => safeArray(inventoryRaw), [inventoryRaw]);
  const repairTicketRows = useMemo(
    () => safeArray(repairTicketsRaw).filter((row) => inRange(row.created_at)),
    [repairTicketsRaw, dateFrom, dateTo],
  );
  const customersRows = useMemo(() => safeArray(customersRaw), [customersRaw]);
  const suppliersRows = useMemo(() => safeArray(suppliersRaw), [suppliersRaw]);
  const purchaseRows = useMemo(
    () => safeArray(purchaseRaw).filter((row) => inRange(row.created_at)),
    [purchaseRaw, dateFrom, dateTo],
  );
  const expenseRows = useMemo(
    () => safeArray(expensesRaw).filter((row) => inRange(row.expense_date || row.created_at)),
    [expensesRaw, dateFrom, dateTo],
  );
  const movementRows = useMemo(
    () => safeArray(movementsRaw).filter((row) => inRange(row.created_at)),
    [movementsRaw, dateFrom, dateTo],
  );
  const notificationsRows = useMemo(
    () => safeArray(notificationsRaw).filter((row) => inRange(row.created_at)),
    [notificationsRaw, dateFrom, dateTo],
  );
  const auditActivityRows = useMemo(
    () => safeArray(auditActivityRaw).filter((row) => inRange(row.timestamp || row.created_at)),
    [auditActivityRaw, dateFrom, dateTo],
  );
  const auditRepairHistoryRows = useMemo(
    () => safeArray(auditRepairHistoryRaw).filter((row) => inRange(row.timestamp || row.created_at)),
    [auditRepairHistoryRaw, dateFrom, dateTo],
  );
  const priceAdjustmentRows = useMemo(
    () => safeArray(priceAdjustmentsRaw).filter((row) => inRange(row.created_at)),
    [priceAdjustmentsRaw, dateFrom, dateTo],
  );
  const discountsRows = useMemo(
    () =>
      safeArray(discountsRaw).filter((row) => {
        const when = row.created_at || row.start_date || row.end_date;
        return !when || inRange(when);
      }),
    [discountsRaw, dateFrom, dateTo],
  );
  const backupRows = useMemo(() => safeArray(backupsRaw), [backupsRaw]);
  const employeesRows = useMemo(() => safeArray(employeesRaw), [employeesRaw]);

  const loading =
    salesLoading ||
    repairsLoading ||
    summaryLoading ||
    inventoryLoading ||
    repairTicketsLoading ||
    customersLoading ||
    suppliersLoading ||
    purchaseLoading ||
    expensesLoading ||
    movementsLoading ||
    dashboardLoading ||
    notificationsLoading ||
    auditActivityLoading ||
    auditRepairHistoryLoading ||
    priceAdjustmentsLoading ||
    discountsLoading ||
    backupsLoading ||
    employeesLoading;

  const applyPreset = (preset) => {
    setDatePreset(preset);
    if (preset === "custom") return;
    const range = getPresetRange(preset);
    setDateFrom(range.from);
    setDateTo(range.to);
  };

  const outletContext = useMemo(
    () => ({
      query,
      setQuery,
      dateFrom,
      dateTo,
      datePreset,
      setDatePreset,
      setDateFrom,
      setDateTo,
      applyPreset,
      loading,
      datasets: {
        salesRows,
        repairRows,
        inventoryRows,
        repairTicketRows,
        customersRows,
        suppliersRows,
        purchaseRows,
        expenseRows,
        movementRows,
        notificationsRows,
        auditActivityRows,
        auditRepairHistoryRows,
        priceAdjustmentRows,
        discountsRows,
        backupRows,
        employeesRows,
        summary: summaryRaw || {},
        dashboard: dashboardRaw || {},
      },
    }),
    [
      query,
      dateFrom,
      dateTo,
      datePreset,
      loading,
      salesRows,
      repairRows,
      inventoryRows,
      repairTicketRows,
      customersRows,
      suppliersRows,
      purchaseRows,
      expenseRows,
      movementRows,
      notificationsRows,
      auditActivityRows,
      auditRepairHistoryRows,
      priceAdjustmentRows,
      discountsRows,
      backupRows,
      employeesRows,
      summaryRaw,
      dashboardRaw,
    ],
  );

  return (
    <div className="app-page-shell gap-3">
      <div className="panel p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-black text-white">Reports &amp; Analytics</h2>
            <p className="text-xs text-slate-400 mt-0.5">Complete reporting workspace with dedicated subpages and exports.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 text-[11px] text-slate-300 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
              <CalendarRange size={14} />
              {dateFrom} to {dateTo}
            </div>
            <NavLink
              to="/reports/export-center"
              className="btn btn-secondary btn-sm"
            >
              <FileDown size={13} />
              Export Center
            </NavLink>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
          <div className="lg:col-span-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-2">
            {["today", "week", "month", "custom"].map((preset) => (
              <button
                key={preset}
                className={`btn btn-sm ${datePreset === preset ? "btn-primary" : "btn-secondary"}`}
                onClick={() => applyPreset(preset)}
              >
                {preset === "week" ? "This Week" : preset === "month" ? "This Month" : preset[0].toUpperCase() + preset.slice(1)}
              </button>
            ))}
          </div>
          <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDatePreset("custom");
                setDateFrom(event.target.value);
              }}
              className="field !py-2 !px-3 !text-xs"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(event) => {
                setDatePreset("custom");
                setDateTo(event.target.value);
              }}
              className="field !py-2 !px-3 !text-xs"
            />
          </div>
          <div className="lg:col-span-3 relative min-w-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="field !py-2 !pl-9 !pr-3 !text-xs"
              placeholder="Search..."
            />
          </div>
        </div>
      </div>

      <div className="app-tab-strip rounded-2xl border border-white/10 bg-slate-900/60 p-2">
        {REPORT_SECTIONS.map((section) => (
          <NavLink
            key={section.slug}
            to={`/reports/${section.slug}`}
            className={({ isActive }) =>
              `rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                isActive
                  ? "bg-indigo-500/25 border border-indigo-500/40 text-indigo-100"
                  : "bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10"
              }`
            }
          >
            {section.shortTitle}
          </NavLink>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <Outlet context={outletContext} />
      </div>
    </div>
  );
}
