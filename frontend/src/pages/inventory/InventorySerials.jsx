import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../lib/api";
import { downloadCsv, downloadPdf, paginateRows } from "../../lib/tableUtils";
import { AppCard, StickyTable } from "../../components/MuiPrimitives";
import { Select } from "../../components/UI";

export default function InventorySerials() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/inventory/serials/search?query=${encodeURIComponent(query)}`);
      setRows(res.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    run();
  }, []);

  const statuses = useMemo(() => ["All", ...Array.from(new Set(rows.map((r) => String(r.status || "")).filter(Boolean)))], [rows]);
  const filtered = useMemo(() => rows.filter((r) => statusFilter === "All" || String(r.status || "") === statusFilter), [rows, statusFilter]);
  const { pageRows, totalPages } = paginateRows(filtered, page, 20);

  return (
    <AppCard
      title="Serial / IMEI Records"
      actions={(
        <div className="flex items-center gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by IMEI/Serial, SKU, Product..." className="w-[420px] rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" />
          <button onClick={run} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white">Search</button>
          <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-100">
            {statuses.map((s) => <option key={s}>{s}</option>)}
          </Select>
          <button onClick={() => downloadCsv("inventory-serials.csv", [
            { label: "Serial", value: "serial_number" },
            { label: "Product", value: "item_name" },
            { label: "SKU", value: "sku" },
            { label: "Status", value: "status" },
            { label: "Created At", value: "created_at" },
          ], filtered)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200">
            Export CSV
          </button>
          <button onClick={async () => downloadPdf("inventory-serials", "Inventory Serials Report", [
            { label: "Serial", value: "serial_number" },
            { label: "Product", value: "item_name" },
            { label: "SKU", value: "sku" },
            { label: "Status", value: "status" },
            { label: "Created At", value: "created_at" },
          ], filtered)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200">
            Export PDF
          </button>
        </div>
      )}
    >
      {loading && <p className="mb-2 text-sm text-slate-400">Loading...</p>}
        <StickyTable
          maxHeight={560}
          rows={pageRows}
          columns={[
            { key: "serial_number", label: "Serial / IMEI", render: (r) => <span className="font-mono text-slate-200">{r.serial_number}</span> },
            { key: "item_name", label: "Product", render: (r) => <span className="text-slate-300">{r.item_name}</span> },
            { key: "sku", label: "SKU", render: (r) => <span className="text-slate-400">{r.sku}</span> },
            { key: "status", label: "Status", render: (r) => <span className="text-xs uppercase text-slate-300">{r.status}</span> },
            { key: "sale_id", label: "Last Sale", render: (r) => <span className="text-slate-500">{r.sale_id ? `INV-${String(r.sale_id).padStart(5, "0")}` : "-"}</span> },
            { key: "created_at", label: "Added", render: (r) => <span className="text-slate-500">{r.created_at ? new Date(r.created_at).toLocaleString() : "-"}</span> },
            {
              key: "actions",
              label: "Actions",
              align: "right",
              render: (r) => (
                <button onClick={() => navigate(`/inventory/serials/${r.id}`)} className="rounded border border-indigo-500/40 bg-indigo-500/10 px-2 py-1 text-xs text-indigo-200">
                  View
                </button>
              ),
            },
          ]}
        />
      <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
        <span>{filtered.length} serial records</span>
        <div className="inline-flex items-center gap-1">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-white/10 px-2 py-1 disabled:opacity-40">Prev</button>
          <span>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border border-white/10 px-2 py-1 disabled:opacity-40">Next</button>
        </div>
      </div>
    </AppCard>
  );
}
