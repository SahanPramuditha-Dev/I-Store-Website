import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/UI";

export const inventoryTabs = [
  ["/inventory/overview", "Overview"],
  ["/inventory/master-products", "Master Catalog"],
  ["/inventory/products", "Products (SKUs)"],
  ["/inventory/product-types", "Product Types"],
  ["/inventory/categories", "Categories"],
  ["/inventory/brands", "Brands"],
  ["/inventory/variants", "Variants"],
  ["/inventory/serials", "Serials / IMEI"],
  ["/inventory/movements", "Movements"],
  ["/inventory/grn", "GRN"],
  ["/inventory/stock-take", "Stock Take"],
  ["/inventory/price-adjustments", "Price Adjust"],
  ["/inventory/discounts", "Discount Offers"],
  ["/inventory/reports", "Reports"],
  ["/inventory/suppliers", "Suppliers"],
  ["/inventory/supplier-ledger", "Supplier Ledger"],
];

export function InventoryModuleTabs() {
  return (
    <div className="app-tab-strip rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 p-2 shadow-sm dark:shadow-none">
      {inventoryTabs.map(([to, label]) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              isActive 
                ? "bg-indigo-50 border border-indigo-300 text-indigo-700 dark:bg-indigo-500/25 dark:border-indigo-500/40 dark:text-indigo-100 shadow-sm" 
                : "bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-950 dark:hover:text-white"
            }`
          }
        >
          {label}
        </NavLink>
      ))}
    </div>
  );
}

export default function InventoryModuleLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const showAddProductButton = location.pathname === "/inventory/products";

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <PageHeader
        eyebrow="Stock & Catalog Control"
        title="Inventory Management"
        subtitle="Manage product catalog, stock levels, valuations, serial tracking, and spare parts."
        action={showAddProductButton ? (
          <button
            type="button"
            onClick={() => navigate("/inventory/products", { state: { openAddProduct: true } })}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-500"
          >
            + Add Product
          </button>
        ) : null}
      />

      <InventoryModuleTabs />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
