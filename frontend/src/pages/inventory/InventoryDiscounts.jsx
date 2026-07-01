import { useMemo, useState } from "react";
import api from "../../lib/api";
import { useFetch } from "../../hooks/useFetch";
import { downloadCsv, downloadPdf, paginateRows } from "../../lib/tableUtils";
import { AppCard, StickyTable } from "../../components/MuiPrimitives";
import { Select } from "../../components/UI";

export default function InventoryDiscounts() {
  const { data: items } = useFetch("/inventory");
  const { data, setData } = useFetch("/inventory/discounts");
  const rows = data || [];
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ item_id: "", discount_type: "percentage", value: 0, start_date: "", end_date: "", note: "" });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const matchQ = !q || String(r.item_name || "").toLowerCase().includes(q);
      const active = Boolean(r.is_active);
      const matchStatus = statusFilter === "All" || (statusFilter === "Active" ? active : !active);
      return matchQ && matchStatus;
    });
  }, [rows, query, statusFilter]);
  const { pageRows, totalPages } = paginateRows(filtered, page, 20);

  const add = async () => {
    if (!form.item_id || Number(form.value) <= 0) return;
    const payload = {
      item_id: Number(form.item_id),
      discount_type: form.discount_type,
      value: Number(form.value),
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      note: form.note || null,
      is_active: true,
    };
    const res = await api.post("/inventory/discounts", payload);
    const item = (items || []).find((i) => i.id === payload.item_id);
    setData([{ ...res.data, item_name: item?.name || "" }, ...rows]);
    setForm({ item_id: "", discount_type: "percentage", value: 0, start_date: "", end_date: "", note: "" });
  };

  return (
    <div className="space-y-3">
      <AppCard title="Create Discount Offer">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
          <Select className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })}>
            <option value="">Select product</option>
            {(items || []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
          <Select className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value })}>
            <option value="percentage">Percentage</option>
            <option value="fixed">Fixed</option>
          </Select>
          <input type="number" min="0" className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" placeholder="Value" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
          <input type="date" className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          <input type="date" className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          <button onClick={add} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white">Save Discount</button>
        </div>
      </AppCard>

      <AppCard
        title="Discount List"
        actions={(
          <div className="flex items-center gap-2">
            <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search product..." className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-slate-100" />
            <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-slate-100">
              <option value="All">All</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </Select>
            <button onClick={() => downloadCsv("inventory-discounts.csv", [
              { label: "Product", value: "item_name" },
              { label: "Type", value: "discount_type" },
              { label: "Value", value: "value" },
              { label: "Start Date", value: "start_date" },
              { label: "End Date", value: "end_date" },
              { label: "Active", value: (r) => r.is_active ? "Yes" : "No" },
            ], filtered)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200">
              Export CSV
            </button>
            <button onClick={async () => downloadPdf("inventory-discounts", "Inventory Discounts Report", [
              { label: "Product", value: "item_name" },
              { label: "Type", value: "discount_type" },
              { label: "Value", value: "value" },
              { label: "Start Date", value: "start_date" },
              { label: "End Date", value: "end_date" },
              { label: "Active", value: (r) => r.is_active ? "Yes" : "No" },
            ], filtered)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200">
              Export PDF
            </button>
          </div>
        )}
      >
        <StickyTable
          maxHeight={560}
          rows={pageRows}
          columns={[
            { key: "item_name", label: "Product", render: (r) => <span className="text-slate-200">{r.item_name}</span> },
            { key: "discount_type", label: "Type", render: (r) => <span className="text-slate-400">{r.discount_type}</span> },
            { key: "value", label: "Value", render: (r) => <span className="text-slate-300">{r.discount_type === "percentage" ? `${r.value}%` : `Rs. ${Number(r.value || 0).toLocaleString()}`}</span> },
            { key: "period", label: "Period", render: (r) => <span className="text-slate-500">{r.start_date ? new Date(r.start_date).toLocaleDateString() : "-"} to {r.end_date ? new Date(r.end_date).toLocaleDateString() : "-"}</span> },
            { key: "is_active", label: "Status", render: (r) => <span className={`text-xs ${r.is_active ? "text-emerald-300" : "text-slate-400"}`}>{r.is_active ? "Active" : "Inactive"}</span> },
          ]}
        />
        <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
          <span>{filtered.length} discount records</span>
          <div className="inline-flex items-center gap-1">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-white/10 px-2 py-1 disabled:opacity-40">Prev</button>
            <span>{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border border-white/10 px-2 py-1 disabled:opacity-40">Next</button>
          </div>
        </div>
      </AppCard>
    </div>
  );
}
