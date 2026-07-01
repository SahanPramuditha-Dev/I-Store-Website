import { useMemo, useState } from "react";
import { useFetch } from "../../hooks/useFetch";
import { downloadCsv, downloadPdf, paginateRows } from "../../lib/tableUtils";
import { AppCard, StickyTable } from "../../components/MuiPrimitives";
import { Select } from "../../components/UI";

export default function InventoryMovements() {
  const { data } = useFetch("/inventory/movements");
  const rows = Array.isArray(data) ? data : [];
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [page, setPage] = useState(1);

  const types = useMemo(() => ["All", ...Array.from(new Set(rows.map((r) => String(r.movement_type || "")).filter(Boolean)))], [rows]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const matchType = typeFilter === "All" || String(r.movement_type || "") === typeFilter;
      const matchQuery = !q || [r.item_name, r.note, r.reference_type, r.reference_id].some((v) => String(v || "").toLowerCase().includes(q));
      return matchType && matchQuery;
    });
  }, [rows, query, typeFilter]);
  const { pageRows, totalPages } = paginateRows(filtered, page, 20);

  return (
    <AppCard
      title="Stock Movement Log"
      actions={(
        <div className="flex items-center gap-2">
          <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search item, note, reference..." className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-slate-100" />
          <Select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-slate-100">
            {types.map((t) => <option key={t}>{t}</option>)}
          </Select>
          <button
            onClick={() => downloadCsv("inventory-movements.csv", [
              { label: "Item", value: "item_name" },
              { label: "Type", value: "movement_type" },
              { label: "Quantity", value: "quantity" },
              { label: "Reference Type", value: "reference_type" },
              { label: "Reference ID", value: "reference_id" },
              { label: "Note", value: "note" },
              { label: "Created At", value: "created_at" },
            ], filtered)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200"
          >
            Export CSV
          </button>
          <button
            onClick={async () => downloadPdf("inventory-movements", "Inventory Movements Report", [
              { label: "Item", value: "item_name" },
              { label: "Type", value: "movement_type" },
              { label: "Quantity", value: "quantity" },
              { label: "Reference Type", value: "reference_type" },
              { label: "Reference ID", value: "reference_id" },
              { label: "Note", value: "note" },
              { label: "Created At", value: "created_at" },
            ], filtered)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200"
          >
            Export PDF
          </button>
        </div>
      )}
    >
      <StickyTable
        maxHeight={620}
        rows={pageRows}
        columns={[
          { key: "item_name", label: "Item", render: (r) => <span className="text-slate-200">{r.item_name}</span> },
          { key: "movement_type", label: "Type", render: (r) => <span className="text-slate-300">{r.movement_type}</span> },
          { key: "quantity", label: "Qty", render: (r) => <span className={Number(r.quantity) >= 0 ? "text-emerald-300" : "text-rose-300"}>{Number(r.quantity) >= 0 ? "+" : ""}{r.quantity}</span> },
          { key: "reference", label: "Reference", render: (r) => <span className="text-slate-400">{r.reference_type || "-"} {r.reference_id || ""}</span> },
          { key: "note", label: "Note", render: (r) => <span className="text-slate-500">{r.note || "-"}</span> },
          { key: "created_at", label: "Time", render: (r) => <span className="text-slate-500">{r.created_at ? new Date(r.created_at).toLocaleString() : "-"}</span> },
        ]}
      />
      <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
        <span>{filtered.length} movements</span>
        <div className="inline-flex items-center gap-1">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-white/10 px-2 py-1 disabled:opacity-40">Prev</button>
          <span>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border border-white/10 px-2 py-1 disabled:opacity-40">Next</button>
        </div>
      </div>
    </AppCard>
  );
}
