import { useMemo, useState } from "react";
import { useFetch } from "../../hooks/useFetch";
import { downloadCsv, downloadPdf, paginateRows } from "../../lib/tableUtils";
import { AppCard, StickyTable } from "../../components/MuiPrimitives";

const currency = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;

export default function InventoryVariants() {
  const { data } = useFetch("/inventory/variants");
  const rows = data || [];
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.brand, r.model, r.storage, r.color, r.condition, r.category].some((v) => String(v || "").toLowerCase().includes(s)));
  }, [rows, q]);

  const { pageRows, totalPages } = paginateRows(filtered, page, 20);

  return (
    <AppCard
      title="Variant List"
      actions={(
        <div className="flex items-center gap-2">
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search variant..." className="w-72 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" />
          <button onClick={() => downloadCsv("inventory-variants.csv", [
            { label: "Brand", value: "brand" },
            { label: "Model", value: "model" },
            { label: "Storage", value: "storage" },
            { label: "Color", value: "color" },
            { label: "Condition", value: "condition" },
            { label: "Category", value: "category" },
            { label: "Quantity", value: "quantity" },
            { label: "Avg Sale Price", value: "avg_sale_price" },
          ], filtered)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200">
            Export CSV
          </button>
          <button onClick={async () => downloadPdf("inventory-variants", "Inventory Variants Report", [
            { label: "Brand", value: "brand" },
            { label: "Model", value: "model" },
            { label: "Storage", value: "storage" },
            { label: "Color", value: "color" },
            { label: "Condition", value: "condition" },
            { label: "Category", value: "category" },
            { label: "Quantity", value: "quantity" },
            { label: "Avg Sale Price", value: "avg_sale_price" },
          ], filtered)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200">
            Export PDF
          </button>
        </div>
      )}
    >
      <StickyTable
        maxHeight={560}
        rows={pageRows}
        rowKey={(_, i) => i}
        columns={[
          { key: "brand", label: "Brand", render: (r) => <span className="text-slate-100">{r.brand || "-"}</span> },
          { key: "model", label: "Model", render: (r) => <span className="text-slate-100">{r.model || "-"}</span> },
          { key: "storage", label: "Storage", render: (r) => <span className="text-slate-300">{r.storage || "-"}</span> },
          { key: "color", label: "Color", render: (r) => <span className="text-slate-300">{r.color || "-"}</span> },
          { key: "condition", label: "Condition", render: (r) => <span className="text-slate-300">{r.condition || "-"}</span> },
          { key: "category", label: "Category", render: (r) => <span className="text-slate-300">{r.category || "-"}</span> },
          { key: "quantity", label: "Qty", align: "right", render: (r) => <span className="text-slate-100">{r.quantity}</span> },
          { key: "avg_sale_price", label: "Avg Sale", align: "right", render: (r) => <span className="text-indigo-300">{currency(r.avg_sale_price)}</span> },
        ]}
      />
      <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
        <span>{filtered.length} variants</span>
        <div className="inline-flex items-center gap-1">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-white/10 px-2 py-1 disabled:opacity-40">Prev</button>
          <span>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border border-white/10 px-2 py-1 disabled:opacity-40">Next</button>
        </div>
      </div>
    </AppCard>
  );
}
