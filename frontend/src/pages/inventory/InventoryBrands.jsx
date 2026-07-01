import { useMemo, useState } from "react";
import api from "../../lib/api";
import { runWithApproval } from "../../lib/approvalFlow";
import { useFetch } from "../../hooks/useFetch";
import { downloadCsv, downloadPdf, paginateRows } from "../../lib/tableUtils";
import { AppCard, StickyTable } from "../../components/MuiPrimitives";
import { useFeedback } from "../../components/FeedbackProvider";

export default function InventoryBrands() {
  const { toast, confirm, prompt } = useFeedback();
  const { data, setData } = useFetch("/inventory/brands");
  const rows = data || [];
  const [editingId, setEditingId] = useState(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ name: "", logo_url: "", is_active: true });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.name || "").toLowerCase().includes(q));
  }, [rows, query]);
  const { pageRows, totalPages } = paginateRows(filtered, page, 12);

  const reset = () => {
    setEditingId(null);
    setForm({ name: "", logo_url: "", is_active: true });
  };

  const save = async () => {
    if (!form.name.trim()) return;
    const payload = { name: form.name.trim(), logo_url: form.logo_url.trim() || null, is_active: form.is_active };
    if (editingId) {
      const res = await api.put(`/inventory/brands/${editingId}`, payload);
      setData(rows.map((r) => (r.id === editingId ? res.data : r)));
    } else {
      const res = await api.post("/inventory/brands", payload);
      setData([...(rows || []), res.data]);
    }
    reset();
  };

  const edit = (row) => {
    setEditingId(row.id);
    setForm({ name: row.name || "", logo_url: row.logo_url || "", is_active: Boolean(row.is_active) });
  };

  const remove = async (id) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const ok = await confirm("Archive Brand", `Archive ${row.name}?`);
    if (!ok) return;
    try {
      await runWithApproval({
        confirm,
        prompt,
        toast,
        approval: {
          module: "inventory",
          action: "archive_brand",
          target_type: "Brand",
          target_id: id,
          reason: `Archive brand ${row.name}`,
          payload: { name: row.name },
        },
        execute: (approvalCode) => api.delete(`/inventory/brands/${id}`, { params: approvalCode ? { approval_request_code: approvalCode } : {} }),
      });
      setData(rows.filter((r) => r.id !== id));
      if (editingId === id) reset();
      toast("Brand archived", "success");
    } catch (error) {
      if (error.approvalCancelled) return;
      toast(error.response?.data?.detail || "Failed to archive brand", "error");
    }
  };

  return (
    <div className="space-y-3">
      <AppCard title={editingId ? "Edit Brand" : "Create Brand"}>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
          <input className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" placeholder="Brand name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" placeholder="Logo URL (optional)" value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} />
          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active
          </label>
          <button onClick={save} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white">{editingId ? "Update" : "Add"}</button>
          <button onClick={reset} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200">Clear</button>
        </div>
      </AppCard>

      <AppCard
        title="Brand List"
        actions={
          <div className="flex items-center gap-2">
            <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search brands..." className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-slate-100" />
            <button
              onClick={() => downloadCsv("inventory-brands.csv", [
                { label: "Brand", value: "name" },
                { label: "Logo URL", value: "logo_url" },
                { label: "Status", value: (r) => r.is_active ? "Active" : "Disabled" },
                { label: "Products", value: (r) => Number(r.product_count || 0) },
              ], filtered)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200"
            >
              Export CSV
            </button>
            <button
              onClick={async () => downloadPdf("inventory-brands", "Inventory Brands Report", [
                { label: "Brand", value: "name" },
                { label: "Logo URL", value: "logo_url" },
                { label: "Status", value: (r) => r.is_active ? "Active" : "Disabled" },
                { label: "Products", value: (r) => Number(r.product_count || 0) },
              ], filtered)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200"
            >
              Export PDF
            </button>
          </div>
        }
      >
        <StickyTable
          maxHeight={520}
          rows={pageRows}
          columns={[
            { key: "name", label: "Brand", render: (r) => <span className="text-slate-100">{r.name}</span> },
            { key: "logo", label: "Logo URL", render: (r) => <span className="text-slate-400">{r.logo_url || "-"}</span> },
            { key: "products", label: "Products", align: "right", render: (r) => <span className="text-slate-300">{Number(r.product_count || 0)}</span> },
            { key: "status", label: "Status", render: (r) => <span className={`rounded-full px-2 py-0.5 text-xs ${r.is_active ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-500/20 text-slate-300"}`}>{r.is_active ? "Active" : "Disabled"}</span> },
            {
              key: "actions",
              label: "Actions",
              align: "right",
              render: (r) => (
                <div className="inline-flex gap-1">
                  <button onClick={() => edit(r)} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200">Edit</button>
                  <button onClick={() => remove(r.id)} className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-300">Delete</button>
                </div>
              ),
            },
          ]}
        />
        <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
          <span>{filtered.length} brands</span>
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
