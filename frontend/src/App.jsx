import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import { bootstrapPermissions, canAccessPath, clearAuthState, getAuthValue, hasPermission } from "./lib/rbac";
import InvoiceView from "./pages/InvoiceView";

import { lazy, Suspense, useEffect, useState } from "react";
import api from "./lib/api";

const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Repairs = lazy(() => import("./pages/Repairs"));
const ProductReservations = lazy(() => import("./pages/ProductReservations"));
const Inventory = lazy(() => import("./pages/Inventory"));
const InventoryModuleLayout = lazy(() => import("./pages/inventory/InventoryModuleLayout"));
const InventoryOverview = lazy(() => import("./pages/inventory/InventoryOverview"));
const InventoryVariants = lazy(() => import("./pages/inventory/InventoryVariants"));
const InventorySerials = lazy(() => import("./pages/inventory/InventorySerials"));
const InventoryMovements = lazy(() => import("./pages/inventory/InventoryMovements"));
const InventorySuppliers = lazy(() => import("./pages/inventory/InventorySuppliers"));
const InventorySupplierLedger = lazy(() => import("./pages/inventory/InventorySupplierLedger"));
const InventoryCategories = lazy(() => import("./pages/inventory/InventoryCategories"));
const InventoryBrands = lazy(() => import("./pages/inventory/InventoryBrands"));
const InventoryGrn = lazy(() => import("./pages/inventory/InventoryGrn"));
const InventoryDiscounts = lazy(() => import("./pages/inventory/InventoryDiscounts"));
const InventoryPriceAdjustments = lazy(() => import("./pages/inventory/InventoryPriceAdjustments"));
const InventoryStockTake = lazy(() => import("./pages/inventory/InventoryStockTake"));
const InventoryStockTakeSessionDetail = lazy(() => import("./pages/inventory/InventoryStockTakeSessionDetail"));
const InventorySerialDetail = lazy(() => import("./pages/inventory/InventorySerialDetail"));
const InventoryReports = lazy(() => import("./pages/inventory/InventoryReports"));
const POS = lazy(() => import("./pages/POS"));
const Customers = lazy(() => import("./pages/Customers"));
const Warranty = lazy(() => import("./pages/Warranty"));
const ReturnsRefunds = lazy(() => import("./pages/ReturnsRefunds"));
const AdvancePayments = lazy(() => import("./pages/AdvancePayments"));
const ReportsModuleLayout = lazy(() => import("./pages/reports/ReportsModuleLayout"));
const OverviewDashboardPage = lazy(() => import("./pages/reports/subpages/OverviewDashboardPage"));
const SalesReportsPage = lazy(() => import("./pages/reports/subpages/SalesReportsPage"));
const RepairReportsPage = lazy(() => import("./pages/reports/subpages/RepairReportsPage"));
const ProfitLossReportsPage = lazy(() => import("./pages/reports/subpages/ProfitLossReportsPage"));
const ExpenseReportsPage = lazy(() => import("./pages/reports/subpages/ExpenseReportsPage"));
const InventoryReportsPage = lazy(() => import("./pages/reports/subpages/InventoryReportsPage"));
const OutstandingPaymentsPage = lazy(() => import("./pages/reports/subpages/OutstandingPaymentsPage"));
const TechnicianPerformancePage = lazy(() => import("./pages/reports/subpages/TechnicianPerformancePage"));
const ProductPerformancePage = lazy(() => import("./pages/reports/subpages/ProductPerformancePage"));
const CustomerReportsPage = lazy(() => import("./pages/reports/subpages/CustomerReportsPage"));
const SupplierReportsPage = lazy(() => import("./pages/reports/subpages/SupplierReportsPage"));
const TaxFinancialReportsPage = lazy(() => import("./pages/reports/subpages/TaxFinancialReportsPage"));
const RefundsReturnsPage = lazy(() => import("./pages/reports/subpages/RefundsReturnsPage"));
const AuditReportsPage = lazy(() => import("./pages/reports/subpages/AuditReportsPage"));
const ExportCenterPage = lazy(() => import("./pages/reports/subpages/ExportCenterPage"));
const Backup = lazy(() => import("./pages/Backup"));
const CustomerDetail = lazy(() => import("./pages/CustomerDetail"));
const PurchaseOrders = lazy(() => import("./pages/PurchaseOrders"));
const Expenses = lazy(() => import("./pages/Expenses"));
const Barcodes = lazy(() => import("./pages/Barcodes"));
const PrintCenter = lazy(() => import("./pages/PrintCenter"));
const Settings = lazy(() => import("./pages/Settings"));
const Search = lazy(() => import("./pages/Search"));
const ActivityLog = lazy(() => import("./pages/ActivityLog"));
const FinancialControl = lazy(() => import("./pages/FinancialControl"));
const AccessDenied = lazy(() => import("./pages/AccessDenied"));
const PermissionManagement = lazy(() => import("./pages/PermissionManagement"));
const Notifications = lazy(() => import("./pages/Notifications"));

function RouteFallback() {
  return <div className="h-dvh grid place-items-center text-slate-400">Loading workspace...</div>;
}

function Guard({ children }) {
  const location = useLocation();
  const [authState, setAuthState] = useState({
    checking: true,
    authenticated: false,
    allowed: false,
  });

  useEffect(() => {
    let mounted = true;
    const runCheck = async () => {
      const token = getAuthValue("token");
      if (!token) {
        if (mounted) setAuthState({ checking: false, authenticated: false, allowed: false });
        return;
      }
      try {
        const permissions = await bootstrapPermissions(api);
        const allowed = location.pathname === "/access-denied" ? true : canAccessPath(location.pathname, permissions);
        if (mounted) setAuthState({ checking: false, authenticated: true, allowed });
      } catch {
        clearAuthState();
        if (mounted) setAuthState({ checking: false, authenticated: false, allowed: false });
      }
    };
    runCheck();
    return () => {
      mounted = false;
    };
  }, [location.pathname]);

  if (authState.checking) {
    return <div className="h-dvh grid place-items-center text-slate-400">Checking access permissions...</div>;
  }
  if (!authState.authenticated) return <Navigate to="/login" replace />;
  if (!authState.allowed && location.pathname !== "/access-denied") {
    return <Navigate to="/access-denied" replace />;
  }
  return children;
}

export default function App() {
  // NOTE: Auto-backups are handled by the backend scheduler (backup_scheduler.py).
  // Removed client-side backup trigger to prevent concurrent backup races under multi-user load.

  return <BrowserRouter future={{ v7_relativeSplatPath: true }}>
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<Login/>} />
        <Route element={<Guard><Layout/></Guard>}>
          <Route path="/access-denied" element={<AccessDenied/>} />
          <Route path="/dashboard" element={<Dashboard/>} />
          <Route path="/repairs" element={<Repairs/>} />
          <Route path="/reservations" element={<ProductReservations/>} />
          <Route path="/inventory" element={<Navigate to="/inventory/overview" replace />} />
          <Route path="/inventory/*" element={<InventoryModuleLayout/>}>
            <Route path="overview" element={<InventoryOverview/>} />
            <Route path="products" element={<Inventory/>} />
            <Route path="categories" element={<InventoryCategories/>} />
            <Route path="brands" element={<InventoryBrands/>} />
            <Route path="variants" element={<InventoryVariants/>} />
            <Route path="serials" element={<InventorySerials/>} />
            <Route path="serials/:serialId" element={<InventorySerialDetail/>} />
            <Route path="movements" element={<InventoryMovements/>} />
            <Route path="grn" element={<InventoryGrn/>} />
            <Route path="stock-take" element={<InventoryStockTake/>} />
            <Route path="stock-take/:sessionId" element={<InventoryStockTakeSessionDetail/>} />
            <Route path="price-adjustments" element={<InventoryPriceAdjustments/>} />
            <Route path="discounts" element={<InventoryDiscounts/>} />
            <Route path="reports" element={<InventoryReports/>} />
            <Route path="suppliers" element={<InventorySuppliers/>} />
            <Route path="supplier-ledger" element={<InventorySupplierLedger/>} />
          </Route>
          <Route path="/purchase" element={<PurchaseOrders/>} />
          <Route path="/expenses" element={<Expenses/>} />
          <Route path="/pos" element={<POS/>} />
            <Route path="/invoice/:id" element={<InvoiceView/>} />
          <Route path="/customers" element={<Customers/>} />
          <Route path="/warranty" element={<Warranty/>} />
          <Route path="/returns" element={<ReturnsRefunds/>} />
          <Route path="/advances" element={<AdvancePayments/>} />
          <Route path="/customers/:id" element={<CustomerDetail/>} />
          <Route path="/reports" element={<Navigate to="/reports/overview" replace />} />
          <Route path="/reports/*" element={<ReportsModuleLayout/>}>
            <Route path="overview" element={<OverviewDashboardPage />} />
            <Route path="sales" element={<SalesReportsPage />} />
            <Route path="repairs" element={<RepairReportsPage />} />
            <Route path="profit-loss" element={<ProfitLossReportsPage />} />
            <Route path="expenses" element={<ExpenseReportsPage />} />
            <Route path="inventory" element={<InventoryReportsPage />} />
            <Route path="outstanding-payments" element={<OutstandingPaymentsPage />} />
            <Route path="technician-performance" element={<TechnicianPerformancePage />} />
            <Route path="product-performance" element={<ProductPerformancePage />} />
            <Route path="customer-reports" element={<CustomerReportsPage />} />
            <Route path="supplier-reports" element={<SupplierReportsPage />} />
            <Route path="tax-financial" element={<TaxFinancialReportsPage />} />
            <Route path="refunds-returns" element={<RefundsReturnsPage />} />
            <Route path="audit" element={<AuditReportsPage />} />
            <Route path="export-center" element={<ExportCenterPage />} />
          </Route>
          <Route path="/barcodes" element={<Barcodes/>} />
          <Route path="/print-center" element={<PrintCenter/>} />
          <Route path="/backup" element={<Backup/>} />
          <Route path="/search" element={<Search/>} />
          <Route path="/audit" element={<ActivityLog/>} />
          <Route path="/financials" element={<FinancialControl/>} />
          <Route path="/permissions" element={<PermissionManagement/>} />
          <Route path="/notifications" element={<Notifications/>} />
          <Route path="/settings" element={<Settings/>} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard"/>} />
      </Routes>
    </Suspense>
  </BrowserRouter>;
}
