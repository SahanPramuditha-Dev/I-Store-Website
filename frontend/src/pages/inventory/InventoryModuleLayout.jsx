import { NavLink, Outlet } from "react-router-dom";

const tabs = [
  ["/inventory/overview", "Overview"],
  ["/inventory/products", "Products"],
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

export default function InventoryModuleLayout() {
  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="app-tab-strip rounded-2xl border border-white/10 bg-slate-900/60 p-2">
        {tabs.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                isActive ? "bg-indigo-500/25 border border-indigo-500/40 text-indigo-100" : "bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10"
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
