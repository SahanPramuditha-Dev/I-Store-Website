import { useMemo } from "react";
import { useFetch } from "../../hooks/useFetch";
import { downloadCsv, downloadPdf } from "../../lib/tableUtils";
import { AppCard, StickyTable } from "../../components/MuiPrimitives";

const money = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;

export default function InventoryReports() {
  const { data: items } = useFetch("/inventory");
  const { data: moves } = useFetch("/inventory/movements");
  const { data: analyticsRaw } = useFetch("/inventory/reports/analytics");

  const rows = Array.isArray(items) ? items : [];
  const movements = Array.isArray(moves) ? moves : [];
  const analytics = analyticsRaw || {};

  const deadStockRows = Array.isArray(analytics?.dead_stock?.rows) ? analytics.dead_stock.rows : [];
  const supplierPurchaseRows = Array.isArray(analytics?.supplier_purchases?.rows) ? analytics.supplier_purchases.rows : [];
  const repairUsageRows = Array.isArray(analytics?.repair_parts_usage?.rows) ? analytics.repair_parts_usage.rows : [];

  const report = useMemo(() => {
    const low = rows.filter((r) => Number(r.quantity || 0) > 0 && Number(r.quantity || 0) <= Number(r.low_stock_threshold || 3));
    const out = rows.filter((r) => Number(r.quantity || 0) <= 0);
    const value = rows.reduce((sum, r) => sum + Number(r.quantity || 0) * Number(r.cost_price || 0), 0);
    const usageMap = {};
    movements.forEach((m) => {
      if (["SALE", "REPAIR_CONSUME"].includes(String(m.movement_type || ""))) {
        usageMap[m.item_name] = (usageMap[m.item_name] || 0) + Math.abs(Number(m.quantity || 0));
      }
    });
    const fastMoving = Object.entries(usageMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return { low, out, value, fastMoving };
  }, [rows, movements]);

  const lowOutRows = [...report.out, ...report.low];

  return (
    <div className="space-y-3">
      <div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-3">
        <AppCard
          title="Low / Out of Stock"
          sx={{ gridColumn: "span 2 / span 2" }}
          actions={(
            <div className="flex items-center gap-2">
              <button
                onClick={() => downloadCsv("inventory-low-out-report.csv", [
                  { label: "Product", value: "name" },
                  { label: "SKU", value: "sku" },
                  { label: "Quantity", value: "quantity" },
                  { label: "Threshold", value: "low_stock_threshold" },
                  { label: "Status", value: (r) => Number(r.quantity || 0) <= 0 ? "Out of Stock" : "Low Stock" },
                ], lowOutRows)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200"
              >
                Export CSV
              </button>
              <button
                onClick={async () => downloadPdf("inventory-low-out-report", "Inventory Low / Out of Stock Report", [
                  { label: "Product", value: "name" },
                  { label: "SKU", value: "sku" },
                  { label: "Quantity", value: "quantity" },
                  { label: "Threshold", value: "low_stock_threshold" },
                  { label: "Status", value: (r) => Number(r.quantity || 0) <= 0 ? "Out of Stock" : "Low Stock" },
                ], lowOutRows)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200"
              >
                Export PDF
              </button>
            </div>
          )}
        >
          <StickyTable
            maxHeight={420}
            rows={lowOutRows}
            columns={[
              { key: "name", label: "Product", render: (r) => <span className="text-slate-200">{r.name}</span> },
              { key: "sku", label: "SKU", render: (r) => <span className="text-slate-400">{r.sku}</span> },
              { key: "quantity", label: "Qty", render: (r) => <span className="text-slate-200">{r.quantity}</span> },
              { key: "low_stock_threshold", label: "Threshold", render: (r) => <span className="text-slate-400">{r.low_stock_threshold || 3}</span> },
              {
                key: "status",
                label: "Status",
                render: (r) => {
                  const isOut = Number(r.quantity || 0) <= 0;
                  return <span className={isOut ? "text-rose-300" : "text-amber-300"}>{isOut ? "Out of Stock" : "Low Stock"}</span>;
                },
              },
            ]}
          />
        </AppCard>

        <div className="space-y-3">
          <AppCard>
            <p className="text-xs uppercase tracking-wider text-slate-500">Inventory Value</p>
            <p className="mt-2 text-2xl font-bold text-white">{money(report.value)}</p>
          </AppCard>
          <AppCard>
            <p className="text-xs uppercase tracking-wider text-slate-500">Dead Stock Value</p>
            <p className="mt-2 text-2xl font-bold text-rose-200">{money(analytics?.dead_stock?.summary?.total_value || 0)}</p>
            <p className="mt-1 text-xs text-slate-400">{analytics?.dead_stock?.summary?.item_count || 0} items with no outbound movement in last {analytics?.dead_stock?.days_threshold || 90} days</p>
          </AppCard>
          <AppCard>
            <p className="text-xs uppercase tracking-wider text-slate-500">Supplier Purchases ({analytics?.supplier_purchases?.period_days || 90}d)</p>
            <p className="mt-2 text-2xl font-bold text-emerald-200">{money(analytics?.supplier_purchases?.summary?.period_received_total || 0)}</p>
          </AppCard>
          <AppCard title="Fast Moving Products">
            <div className="space-y-1">
              {report.fastMoving.map(([name, qty]) => (
                <div key={name} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-2 py-1.5 text-sm">
                  <span className="truncate pr-2 text-slate-200">{name}</span>
                  <span className="text-emerald-300">{qty}</span>
                </div>
              ))}
              {report.fastMoving.length === 0 && <p className="text-xs text-slate-500">No usage data found.</p>}
            </div>
          </AppCard>
        </div>
      </div>

      <div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-3">
        <AppCard
          title="Dead Stock Analytics"
          subtitle={`Threshold: ${analytics?.dead_stock?.days_threshold || 90} days`}
          actions={(
            <button
              onClick={() => downloadCsv("inventory-dead-stock.csv", [
                { label: "Product", value: "name" },
                { label: "SKU", value: "sku" },
                { label: "Category", value: "category" },
                { label: "Brand", value: "brand" },
                { label: "Qty", value: "quantity" },
                { label: "Stock Value", value: "stock_value" },
                { label: "Last Outbound", value: "last_outbound_at" },
                { label: "Days Since Outbound", value: "days_since_outbound" },
              ], deadStockRows)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200"
            >
              Export CSV
            </button>
          )}
        >
          <StickyTable
            maxHeight={360}
            rows={deadStockRows}
            columns={[
              { key: "name", label: "Product", render: (row) => <span className="text-slate-200">{row.name}</span> },
              { key: "sku", label: "SKU", render: (row) => <span className="text-slate-400">{row.sku || "-"}</span> },
              { key: "quantity", label: "Qty", render: (row) => <span className="text-slate-200">{Number(row.quantity || 0).toLocaleString()}</span> },
              { key: "stock_value", label: "Value", render: (row) => <span className="text-rose-300">{money(row.stock_value)}</span> },
              { key: "days_since_outbound", label: "Days", render: (row) => <span className="text-slate-400">{row.days_since_outbound ?? "Never"}</span> },
            ]}
          />
        </AppCard>

        <AppCard
          title="Supplier Purchase Analytics"
          subtitle={`${analytics?.supplier_purchases?.period_days || 90}-day purchasing view`}
          actions={(
            <button
              onClick={() => downloadCsv("inventory-supplier-purchases.csv", [
                { label: "Supplier", value: "supplier_name" },
                { label: "PO Count", value: "period_po_count" },
                { label: "PO Value", value: "period_po_value" },
                { label: "GRN Count", value: "period_grn_count" },
                { label: "Received Value", value: "period_received_value" },
                { label: "Outstanding", value: "outstanding_balance" },
                { label: "Last Purchase", value: "last_purchase_at" },
              ], supplierPurchaseRows)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200"
            >
              Export CSV
            </button>
          )}
        >
          <StickyTable
            maxHeight={360}
            rows={supplierPurchaseRows}
            columns={[
              { key: "supplier_name", label: "Supplier", render: (row) => <span className="text-slate-200">{row.supplier_name}</span> },
              { key: "period_po_count", label: "PO", render: (row) => <span className="text-slate-400">{Number(row.period_po_count || 0)}</span> },
              { key: "period_grn_count", label: "GRN", render: (row) => <span className="text-slate-400">{Number(row.period_grn_count || 0)}</span> },
              { key: "period_received_value", label: "Received", render: (row) => <span className="text-emerald-300">{money(row.period_received_value)}</span> },
              { key: "outstanding_balance", label: "Outstanding", render: (row) => <span className="text-amber-300">{money(row.outstanding_balance)}</span> },
            ]}
          />
        </AppCard>

        <AppCard
          title="Repair Part Usage"
          subtitle={`${analytics?.repair_parts_usage?.period_days || 90}-day usage`}
          actions={(
            <button
              onClick={() => downloadCsv("inventory-repair-part-usage.csv", [
                { label: "Part", value: "item_name" },
                { label: "SKU", value: "sku" },
                { label: "Quantity Used", value: "quantity_used" },
                { label: "Usage Value", value: "usage_value" },
                { label: "Usage Events", value: "usage_events" },
                { label: "Last Used", value: "last_used_at" },
              ], repairUsageRows)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200"
            >
              Export CSV
            </button>
          )}
        >
          <StickyTable
            maxHeight={360}
            rows={repairUsageRows}
            columns={[
              { key: "item_name", label: "Part", render: (row) => <span className="text-slate-200">{row.item_name}</span> },
              { key: "sku", label: "SKU", render: (row) => <span className="text-slate-400">{row.sku || "-"}</span> },
              { key: "quantity_used", label: "Qty Used", render: (row) => <span className="text-slate-200">{Number(row.quantity_used || 0).toLocaleString()}</span> },
              { key: "usage_value", label: "Usage Value", render: (row) => <span className="text-cyan-300">{money(row.usage_value)}</span> },
              { key: "usage_events", label: "Events", render: (row) => <span className="text-slate-400">{Number(row.usage_events || 0)}</span> },
            ]}
          />
        </AppCard>
      </div>
    </div>
  );
}
