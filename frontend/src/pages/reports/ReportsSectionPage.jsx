import { useCallback, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  AlertTriangle,
  ClipboardList,
  FileDown,
  FileText,
  TrendingUp,
  UserCog,
} from "lucide-react";
import { Badge, Button, KpiCard, SectionCard, Table } from "../../components/UI";
import { downloadCsv, downloadPdf } from "../../lib/tableUtils";
import { REPORT_SECTION_MAP } from "./reportsConfig";
import OverviewDashboardContent from "./components/OverviewDashboardContent";
import SalesReportsContent from "./components/SalesReportsContent";
import RepairReportsContent from "./components/RepairReportsContent";
import ProfitLossReportsContent from "./components/ProfitLossReportsContent";
import ExpenseReportsContent from "./components/ExpenseReportsContent";
import InventoryReportsContent from "./components/InventoryReportsContent";
import OutstandingPaymentsContent from "./components/OutstandingPaymentsContent";
import ProductPerformanceContent from "./components/ProductPerformanceContent";
import CustomerReportsContent from "./components/CustomerReportsContent";
import SupplierReportsContent from "./components/SupplierReportsContent";
import TaxFinancialReportsContent from "./components/TaxFinancialReportsContent";
import RefundsReturnsContent from "./components/RefundsReturnsContent";
import AuditReportsContent from "./components/AuditReportsContent";
import ExportCenterContent from "./components/ExportCenterContent";

const money = (value) => `LKR ${Math.round(Number(value || 0)).toLocaleString("en-LK")}`;

function asDate(iso) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-CA");
}

function sumBy(rows, iteratee) {
  return (rows || []).reduce((acc, row) => acc + Number(iteratee(row) || 0), 0);
}

function daysBetween(fromIso, toIso) {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.max(0, Math.round((to - from) / (1000 * 60 * 60 * 24)));
}

function isCompletedRepair(status) {
  const value = String(status || "").toLowerCase();
  return value === "completed" || value === "delivered";
}

function isCreditLike(paymentMethod) {
  const value = String(paymentMethod || "").toLowerCase();
  return value.includes("credit") || value.includes("due") || value.includes("partial");
}

function SimpleTable({ columns, rows, emptyLabel = "No records found." }) {
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
              <td colSpan={columns.length} className="text-slate-400 py-6">
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

export default function ReportsSectionPage({ sectionKey }) {
  const { loading, query, dateFrom, dateTo, datasets } = useOutletContext();
  const [overviewSnapshot, setOverviewSnapshot] = useState(null);
  const [salesSnapshot, setSalesSnapshot] = useState(null);
  const [repairSnapshot, setRepairSnapshot] = useState(null);
  const [profitLossSnapshot, setProfitLossSnapshot] = useState(null);
  const [expenseSnapshot, setExpenseSnapshot] = useState(null);
  const [inventorySnapshot, setInventorySnapshot] = useState(null);
  const [outstandingSnapshot, setOutstandingSnapshot] = useState(null);
  const [productPerformanceSnapshot, setProductPerformanceSnapshot] = useState(null);
  const [customerSnapshot, setCustomerSnapshot] = useState(null);
  const [supplierSnapshot, setSupplierSnapshot] = useState(null);
  const [taxFinancialSnapshot, setTaxFinancialSnapshot] = useState(null);
  const [refundsReturnsSnapshot, setRefundsReturnsSnapshot] = useState(null);
  const [auditSnapshot, setAuditSnapshot] = useState(null);
  const [exportCenterSnapshot, setExportCenterSnapshot] = useState(null);
  const meta = REPORT_SECTION_MAP[sectionKey] || REPORT_SECTION_MAP.overview;
  const {
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
    summary,
    dashboard,
  } = datasets;

  const customersById = useMemo(
    () =>
      Object.fromEntries(
        customersRows.map((customer) => [
          String(customer.id),
          customer.name || `Customer #${customer.id}`,
        ]),
      ),
    [customersRows],
  );
  const cleanSales = useMemo(() => salesRows.filter((sale) => !sale.is_voided), [salesRows]);
  const postedSales = useMemo(() => cleanSales.filter((sale) => !sale.is_return), [cleanSales]);
  const completedRepairs = useMemo(
    () => repairRows.filter((repair) => isCompletedRepair(repair.status)),
    [repairRows],
  );

  const productRevenue = sumBy(postedSales, (sale) => sale.total);
  const repairRevenue = sumBy(completedRepairs, (repair) => repair.estimated_cost);
  const summaryRevenue = Number(summary?.summary?.total_revenue || productRevenue + repairRevenue);
  const grossProfit = Number(
    summary?.summary?.gross_profit || summaryRevenue - Number(summaryRevenue * 0.72),
  );
  const creditSales = useMemo(
    () =>
      salesRows.filter(
        (sale) => !sale.is_voided && (!sale.paid || isCreditLike(sale.payment_method)),
      ),
    [salesRows],
  );
  const repairDueRows = useMemo(
    () =>
      repairRows
        .map((repair) => ({
          ...repair,
          due: Math.max(
            0,
            Number(repair.invoice_amount ?? repair.estimated_cost ?? 0) - Number(repair.advance_payment || 0),
          ),
        }))
        .filter((repair) => repair.due > 0),
    [repairRows],
  );
  const outstandingValue =
    sumBy(creditSales, (sale) => sale.total) + sumBy(repairDueRows, (repair) => repair.due);
  const handleOverviewComputed = useCallback((payload) => {
    setOverviewSnapshot(payload);
  }, []);
  const handleSalesPrepared = useCallback((payload) => {
    setSalesSnapshot(payload);
  }, []);
  const handleRepairPrepared = useCallback((payload) => {
    setRepairSnapshot(payload);
  }, []);
  const handleProfitLossPrepared = useCallback((payload) => {
    setProfitLossSnapshot(payload);
  }, []);
  const handleExpensePrepared = useCallback((payload) => {
    setExpenseSnapshot(payload);
  }, []);
  const handleInventoryPrepared = useCallback((payload) => {
    setInventorySnapshot(payload);
  }, []);
  const handleOutstandingPrepared = useCallback((payload) => {
    setOutstandingSnapshot(payload);
  }, []);
  const handleProductPerformancePrepared = useCallback((payload) => {
    setProductPerformanceSnapshot(payload);
  }, []);
  const handleCustomerPrepared = useCallback((payload) => {
    setCustomerSnapshot(payload);
  }, []);
  const handleSupplierPrepared = useCallback((payload) => {
    setSupplierSnapshot(payload);
  }, []);
  const handleTaxFinancialPrepared = useCallback((payload) => {
    setTaxFinancialSnapshot(payload);
  }, []);
  const handleRefundsReturnsPrepared = useCallback((payload) => {
    setRefundsReturnsSnapshot(payload);
  }, []);
  const handleAuditPrepared = useCallback((payload) => {
    setAuditSnapshot(payload);
  }, []);
  const handleExportCenterPrepared = useCallback((payload) => {
    setExportCenterSnapshot(payload);
  }, []);

  let exportColumns = [];
  let exportRows = [];
  let content = null;
  let sectionNote = null;

  if (sectionKey === "overview") {
    const snapshot = overviewSnapshot || {
      totalRevenue: summaryRevenue,
      monthRevenue: summaryRevenue,
      monthNet: grossProfit,
      outstandingValue,
      healthScore: 0,
      lowStockCount: inventoryRows.filter((item) => Number(item.quantity || 0) <= 5).length,
      delayedRepairsCount: repairRows.filter((repair) => !isCompletedRepair(repair.status)).length,
      goalProgress: 0,
    };

    exportColumns = [
      { label: "Metric", value: "metric" },
      { label: "Value", value: "value" },
    ];
    exportRows = [
      { metric: "Total Revenue Today/Period", value: money(snapshot.totalRevenue) },
      { metric: "Revenue This Month", value: money(snapshot.monthRevenue) },
      { metric: "Net Profit (Month)", value: money(snapshot.monthNet) },
      { metric: "Outstanding Balances", value: money(snapshot.outstandingValue) },
      { metric: "Business Health Score", value: `${Math.round(snapshot.healthScore)}/100` },
      { metric: "Low Stock Alerts", value: Number(snapshot.lowStockCount || 0).toLocaleString() },
      { metric: "Delayed Repairs", value: Number(snapshot.delayedRepairsCount || 0).toLocaleString() },
      { metric: "Goal Progress", value: `${Number(snapshot.goalProgress || 0).toFixed(1)}%` },
    ];

    content = (
      <OverviewDashboardContent
        salesRows={salesRows}
        repairRows={repairRows}
        repairTicketRows={repairTicketRows}
        inventoryRows={inventoryRows}
        purchaseRows={purchaseRows}
        movementRows={movementRows}
        notificationsRows={notificationsRows}
        summary={summary}
        onOverviewComputed={handleOverviewComputed}
      />
    );
  } else if (sectionKey === "sales") {
    exportColumns = salesSnapshot?.exportColumns || [
      { label: "Date", value: (row) => asDate(row.created_at) },
      { label: "Invoice", value: "invoice_no" },
      { label: "Customer", value: (row) => row.customer_name || customersById[String(row.customer_id)] || "Walk-in" },
      { label: "Payment", value: "payment_method" },
      { label: "Subtotal", value: (row) => Number(row.subtotal || 0) },
      { label: "Tax", value: (row) => Number(row.tax_amount || 0) },
      { label: "Total", value: (row) => Number(row.total || 0) },
      { label: "Status", value: (row) => row.status || (row.is_voided ? "Cancelled" : row.is_return ? "Refunded" : row.paid ? "Paid" : "Pending") },
    ];
    exportRows = salesSnapshot?.exportRows || salesRows;

    content = (
      <SalesReportsContent
        salesRows={salesRows}
        inventoryRows={inventoryRows}
        dateFrom={dateFrom}
        dateTo={dateTo}
        query={query}
        onPrepared={handleSalesPrepared}
      />
    );
  } else if (sectionKey === "repairs") {
    exportColumns = repairSnapshot?.exportColumns || [
      { label: "Date In", value: "created_at" },
      { label: "Ticket", value: "ticket_no" },
      { label: "Device", value: "device" },
      { label: "Issue", value: "issue" },
      { label: "Technician", value: (row) => row.technician || "Unassigned" },
      { label: "Status", value: "status" },
      { label: "ETA", value: "estimated_completion" },
      { label: "Parts Cost", value: (row) => Number(row.parts_cost_total || 0) },
      { label: "Labor", value: (row) => Number(row.labor_cost || 0) },
      { label: "Total", value: (row) => Number(row.invoice_amount ?? row.estimated_cost ?? 0) },
    ];
    exportRows = repairSnapshot?.exportRows || repairRows;

    content = (
      <RepairReportsContent
        repairRows={repairRows}
        movementRows={movementRows}
        dateFrom={dateFrom}
        dateTo={dateTo}
        query={query}
        onPrepared={handleRepairPrepared}
      />
    );
  } else if (sectionKey === "profit-loss") {
    exportColumns = profitLossSnapshot?.exportColumns || [
      { label: "Month", value: "monthLabel" },
      { label: "Revenue", value: (row) => Number(row.totalRevenue || 0) },
      { label: "COGS", value: (row) => Number(row.totalCogs || 0) },
      { label: "Gross Profit", value: (row) => Number(row.grossProfit || 0) },
      { label: "Expenses", value: (row) => Number(row.expenses || 0) },
      { label: "Net Profit", value: (row) => Number(row.netProfit || 0) },
      { label: "Margin %", value: (row) => Number((row.marginPct || 0).toFixed(2)) },
    ];
    exportRows = profitLossSnapshot?.exportRows || [];
    content = (
      <ProfitLossReportsContent
        salesRows={salesRows}
        repairRows={repairRows}
        expenseRows={expenseRows}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onPrepared={handleProfitLossPrepared}
      />
    );
  } else if (sectionKey === "expenses") {
    exportColumns = expenseSnapshot?.exportColumns || [
      { label: "Date", value: "createdAt" },
      { label: "Category", value: "category" },
      { label: "Description", value: "description" },
      { label: "Amount", value: (row) => Number(row.amount || 0) },
      { label: "Added By", value: "addedBy" },
      { label: "Reference No", value: "referenceNo" },
      { label: "Recurring", value: "recurringLabel" },
      { label: "Vendor", value: "vendor" },
    ];
    exportRows = expenseSnapshot?.exportRows || [];

    content = (
      <ExpenseReportsContent
        expenseRows={expenseRows}
        salesRows={salesRows}
        repairRows={repairRows}
        suppliersRows={suppliersRows}
        dateFrom={dateFrom}
        dateTo={dateTo}
        query={query}
        onPrepared={handleExpensePrepared}
      />
    );
  } else if (sectionKey === "inventory") {
    exportColumns = inventorySnapshot?.exportColumns || [
      { label: "Product", value: "name" },
      { label: "Category", value: (row) => row.category || "-" },
      { label: "Brand", value: (row) => row.brand || "-" },
      { label: "Qty", value: (row) => Number(row.quantity || row.qty || 0) },
      { label: "Cost Price", value: (row) => Number(row.cost_price || 0) },
      { label: "Sale Price", value: (row) => Number(row.sale_price || 0) },
      { label: "Stock Value", value: (row) => Number(row.total_value || 0) },
      { label: "Potential Revenue", value: (row) => Number(row.potential_revenue || 0) },
    ];
    exportRows = inventorySnapshot?.exportRows || inventoryRows;

    content = (
      <InventoryReportsContent
        inventoryRows={inventoryRows}
        movementRows={movementRows}
        suppliersRows={suppliersRows}
        purchaseRows={purchaseRows}
        repairRows={repairRows}
        salesRows={salesRows}
        dateFrom={dateFrom}
        dateTo={dateTo}
        query={query}
        onPrepared={handleInventoryPrepared}
      />
    );
  } else if (sectionKey === "outstanding-payments") {
    exportColumns = outstandingSnapshot?.exportColumns || [
      { label: "Date", value: (row) => asDate(row.date) },
      { label: "Type", value: "type" },
      { label: "Reference", value: "reference" },
      { label: "Customer", value: "customer" },
      { label: "Status", value: (row) => row.paymentStatus || row.status || "-" },
      { label: "Outstanding", value: (row) => Number(row.balance || row.due || 0) },
    ];
    exportRows = outstandingSnapshot?.exportRows || [];

    content = (
      <OutstandingPaymentsContent
        salesRows={salesRows}
        repairRows={repairRows}
        customersRows={customersRows}
        notificationsRows={notificationsRows}
        dateFrom={dateFrom}
        dateTo={dateTo}
        query={query}
        onPrepared={handleOutstandingPrepared}
      />
    );
  } else if (sectionKey === "technician-performance") {
    const groupedRows = Object.values(
      repairTicketRows.reduce((acc, repair) => {
        const technician = repair.technician || "Unassigned";
        if (!acc[technician]) {
          acc[technician] = {
            technician,
            total: 0,
            completed: 0,
            open: 0,
            revenue: 0,
            turnaroundDays: [],
          };
        }
        acc[technician].total += 1;
        if (isCompletedRepair(repair.status)) {
          acc[technician].completed += 1;
          acc[technician].revenue += Number(repair.invoice_amount ?? repair.estimated_cost ?? 0);
          if (repair.delivered_at) {
            acc[technician].turnaroundDays.push(daysBetween(repair.created_at, repair.delivered_at));
          }
        } else {
          acc[technician].open += 1;
        }
        return acc;
      }, {}),
    )
      .map((row) => ({
        ...row,
        completionRate: row.total > 0 ? (row.completed / row.total) * 100 : 0,
        avgTurnaround:
          row.turnaroundDays.length > 0
            ? row.turnaroundDays.reduce((acc, value) => acc + value, 0) / row.turnaroundDays.length
            : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    exportColumns = [
      { label: "Technician", value: "technician" },
      { label: "Total Tickets", value: (row) => row.total },
      { label: "Completed", value: (row) => row.completed },
      { label: "Open", value: (row) => row.open },
      { label: "Completion Rate %", value: (row) => Number(row.completionRate.toFixed(2)) },
      { label: "Revenue", value: (row) => Number(row.revenue || 0) },
      { label: "Avg Turnaround Days", value: (row) => Number(row.avgTurnaround.toFixed(2)) },
    ];
    exportRows = groupedRows;

    content = (
      <>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <KpiCard title="Technicians" value={groupedRows.length.toLocaleString()} icon={<UserCog size={18} />} />
          <KpiCard
            title="Completed Repairs"
            value={groupedRows.reduce((acc, row) => acc + row.completed, 0).toLocaleString()}
            icon={<ClipboardList size={18} />}
            tone="green"
          />
          <KpiCard
            title="Open Repairs"
            value={groupedRows.reduce((acc, row) => acc + row.open, 0).toLocaleString()}
            icon={<AlertTriangle size={18} />}
            tone="amber"
          />
          <KpiCard
            title="Revenue Attributed"
            value={money(groupedRows.reduce((acc, row) => acc + row.revenue, 0))}
            icon={<TrendingUp size={18} />}
            tone="indigo"
          />
        </div>
        <SectionCard title="Technician Performance Table">
          <SimpleTable
            columns={[
              { label: "Technician", value: "technician" },
              { label: "Total", value: (row) => row.total.toLocaleString() },
              { label: "Completed", value: (row) => row.completed.toLocaleString() },
              { label: "Open", value: (row) => row.open.toLocaleString() },
              { label: "Completion", value: (row) => `${row.completionRate.toFixed(1)}%` },
              { label: "Avg Days", value: (row) => row.avgTurnaround.toFixed(1) },
              { label: "Revenue", value: (row) => money(row.revenue) },
            ]}
            rows={groupedRows}
            emptyLabel="No technician data found."
          />
        </SectionCard>
      </>
    );
  } else if (sectionKey === "product-performance") {
    exportColumns = productPerformanceSnapshot?.exportColumns || [
      { label: "Product", value: "product" },
      { label: "Category", value: "category" },
      { label: "Brand", value: "brand" },
      { label: "Qty Sold", value: (row) => Number(row.qtySold || 0) },
      { label: "Revenue", value: (row) => Number(row.netRevenue || 0) },
      { label: "Cost", value: (row) => Number(row.netCost || 0) },
      { label: "Profit", value: (row) => Number(row.netProfit || 0) },
      { label: "Margin %", value: (row) => Number((row.marginPct || 0).toFixed(2)) },
      { label: "Stock Left", value: (row) => Number(row.stockLeft || 0) },
      { label: "Performance Tag", value: "performanceTag" },
    ];
    exportRows = productPerformanceSnapshot?.exportRows || [];

    content = (
      <ProductPerformanceContent
        salesRows={salesRows}
        inventoryRows={inventoryRows}
        movementRows={movementRows}
        suppliersRows={suppliersRows}
        dateFrom={dateFrom}
        dateTo={dateTo}
        query={query}
        onPrepared={handleProductPerformancePrepared}
      />
    );
  } else if (sectionKey === "customer-reports") {
    exportColumns = customerSnapshot?.exportColumns || [
      { label: "Customer", value: "customer" },
      { label: "Phone", value: "phone" },
      { label: "Total Purchases", value: (row) => Number(row.totalPurchases || 0) },
      { label: "Repairs", value: (row) => Number(row.repairs || 0) },
      { label: "Total Spend", value: (row) => Number(row.totalSpend || 0) },
      { label: "Outstanding", value: (row) => Number(row.outstanding || 0) },
      { label: "Last Visit", value: (row) => row.lastVisit || "-" },
      { label: "Frequency Tag", value: (row) => row.frequencyTag || "-" },
      { label: "Lifetime Value", value: (row) => Number(row.lifetimeValue || 0) },
    ];
    exportRows = customerSnapshot?.exportRows || [];

    content = (
      <CustomerReportsContent
        salesRows={salesRows}
        repairRows={repairRows}
        customersRows={customersRows}
        dateFrom={dateFrom}
        dateTo={dateTo}
        query={query}
        onPrepared={handleCustomerPrepared}
      />
    );
  } else if (sectionKey === "supplier-reports") {
    exportColumns = supplierSnapshot?.exportColumns || [
      { label: "Supplier", value: "supplier" },
      { label: "Products Supplied", value: (row) => Number(row.productsSupplied || 0) },
      { label: "Total Purchased", value: (row) => Number(row.totalPurchased || 0) },
      { label: "Paid", value: (row) => Number(row.paid || 0) },
      { label: "Outstanding", value: (row) => Number(row.outstanding || 0) },
      { label: "Last Purchase", value: (row) => row.lastPurchase || "-" },
      { label: "Status", value: "status" },
    ];
    exportRows = supplierSnapshot?.exportRows || [];

    content = (
      <SupplierReportsContent
        purchaseRows={purchaseRows}
        suppliersRows={suppliersRows}
        inventoryRows={inventoryRows}
        movementRows={movementRows}
        dateFrom={dateFrom}
        dateTo={dateTo}
        query={query}
        onPrepared={handleSupplierPrepared}
      />
    );
  } else if (sectionKey === "tax-financial") {
    exportColumns = taxFinancialSnapshot?.exportColumns || [
      { label: "Date", value: "date" },
      { label: "Transaction Type", value: "transactionType" },
      { label: "Gross Amount", value: (row) => Number(row.grossAmount || 0) },
      { label: "Tax %", value: (row) => Number((row.taxPct || 0).toFixed(2)) },
      { label: "Tax Amount", value: (row) => Number(row.taxAmount || 0) },
      { label: "Net Amount", value: (row) => Number(row.netAmount || 0) },
      { label: "Invoice Ref", value: "invoiceRef" },
    ];
    exportRows = taxFinancialSnapshot?.exportRows || [];

    content = (
      <TaxFinancialReportsContent
        salesRows={salesRows}
        repairRows={repairRows}
        expenseRows={expenseRows}
        dateFrom={dateFrom}
        dateTo={dateTo}
        query={query}
        onPrepared={handleTaxFinancialPrepared}
      />
    );
  } else if (sectionKey === "refunds-returns") {
    exportColumns = refundsReturnsSnapshot?.exportColumns || [
      { label: "Refund ID", value: "refundId" },
      { label: "Date", value: "date" },
      { label: "Original Invoice/Job No.", value: "originalRef" },
      { label: "Customer", value: "customer" },
      { label: "Product/Device", value: "productOrDevice" },
      { label: "Refund Type", value: "refundType" },
      { label: "Original Amount", value: (row) => Number(row.originalAmount || 0) },
      { label: "Refund Amount", value: (row) => Number(row.refundAmount || 0) },
      { label: "Reason", value: "reason" },
      { label: "Processed By", value: "processedBy" },
      { label: "Status", value: "status" },
    ];
    exportRows = refundsReturnsSnapshot?.exportRows || [];

    content = (
      <RefundsReturnsContent
        salesRows={salesRows}
        repairRows={repairRows}
        inventoryRows={inventoryRows}
        movementRows={movementRows}
        customersRows={customersRows}
        auditActivityRows={auditActivityRows}
        dateFrom={dateFrom}
        dateTo={dateTo}
        query={query}
        onPrepared={handleRefundsReturnsPrepared}
      />
    );
  } else if (sectionKey === "audit") {
    exportColumns = auditSnapshot?.exportColumns || [
      { label: "Timestamp", value: "timestamp" },
      { label: "User", value: "user" },
      { label: "Action Type", value: "actionType" },
      { label: "Module", value: "module" },
      { label: "Record ID", value: (row) => row.recordId ?? "-" },
      { label: "Old Value", value: (row) => (row.oldValue == null ? "-" : JSON.stringify(row.oldValue)) },
      { label: "New Value", value: (row) => (row.newValue == null ? "-" : JSON.stringify(row.newValue)) },
      { label: "IP Address", value: "ipAddress" },
      { label: "Severity", value: "severity" },
    ];
    exportRows = auditSnapshot?.exportRows || [];

    content = (
      <AuditReportsContent
        salesRows={salesRows}
        repairRows={repairRows}
        inventoryRows={inventoryRows}
        movementRows={movementRows}
        notificationsRows={notificationsRows}
        dashboard={dashboard}
        auditActivityRows={auditActivityRows}
        auditRepairHistoryRows={auditRepairHistoryRows}
        priceAdjustmentRows={priceAdjustmentRows}
        discountsRows={discountsRows}
        backupRows={backupRows}
        employeesRows={employeesRows}
        dateFrom={dateFrom}
        dateTo={dateTo}
        query={query}
        onPrepared={handleAuditPrepared}
      />
    );
  } else if (sectionKey === "export-center") {
    exportColumns = exportCenterSnapshot?.exportColumns || [
      { label: "Date", value: "day" },
      { label: "Sales Revenue", value: (row) => Number(row.salesRevenue || 0) },
      { label: "Repair Revenue", value: (row) => Number(row.repairRevenue || 0) },
      { label: "Total Revenue", value: (row) => Number(row.totalRevenue || 0) },
      { label: "Sales Count", value: (row) => Number(row.salesCount || 0) },
      { label: "Repair Count", value: (row) => Number(row.repairCount || 0) },
    ];
    exportRows = exportCenterSnapshot?.exportRows || [];
    sectionNote =
      "Export Center supports templates, schedules, custom field builder, ZIP bundles, and branded PDF output.";
    content = (
      <ExportCenterContent
        salesRows={salesRows}
        repairRows={repairRows}
        inventoryRows={inventoryRows}
        purchaseRows={purchaseRows}
        movementRows={movementRows}
        auditActivityRows={auditActivityRows}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onPrepared={handleExportCenterPrepared}
      />
    );
  }

  if (loading) {
    return <div className="h-full min-h-0 grid place-items-center text-slate-400">Loading report data...</div>;
  }

  return (
    <div className="h-full min-h-0 overflow-x-hidden overflow-y-auto custom-scrollbar pr-1">
      <div className="space-y-3 pb-3">
        <section className="panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-black text-white">{meta.title}</h3>
              <p className="text-xs text-slate-400 mt-0.5">{meta.description}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone={exportRows.length ? "green" : "slate"}>
                  {exportRows.length.toLocaleString()} export rows
                </Badge>
                <Badge tone="indigo">
                  {dateFrom} to {dateTo}
                </Badge>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  downloadCsv(
                    `${meta.slug || sectionKey}_${dateFrom}_${dateTo}.csv`,
                    exportColumns,
                    exportRows,
                  )
                }
                disabled={exportRows.length === 0}
              >
                <FileDown size={13} />
                Export CSV
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  downloadPdf(
                    `${meta.slug || sectionKey}_${dateFrom}_${dateTo}`,
                    meta.title,
                    exportColumns,
                    exportRows,
                  )
                }
                disabled={exportRows.length === 0}
              >
                <FileText size={13} />
                Export PDF
              </Button>
            </div>
          </div>
          {sectionNote && <p className="mt-2 text-xs text-amber-300">{sectionNote}</p>}
        </section>

        {content}
      </div>
    </div>
  );
}


