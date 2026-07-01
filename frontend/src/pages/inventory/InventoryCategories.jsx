import { useMemo, useState } from "react";
import api from "../../lib/api";
import { runWithApproval } from "../../lib/approvalFlow";
import { useFetch } from "../../hooks/useFetch";
import { downloadCsv, downloadPdf, paginateRows } from "../../lib/tableUtils";
import { AppCard, StickyTable } from "../../components/MuiPrimitives";
import { Select } from "../../components/UI";
import { useFeedback } from "../../components/FeedbackProvider";

export default function InventoryCategories() {
  const { toast, confirm, prompt } = useFeedback();
  const { data, setData } = useFetch("/inventory/categories");
  const rows = data || [];
  const [editingId, setEditingId] = useState(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ name: "", icon_url: "", parent_id: "", is_active: true });

  const parentOptions = useMemo(() => rows.filter((r) => r.id !== editingId), [rows, editingId]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.name || "").toLowerCase().includes(q));
  }, [rows, query]);
  const { pageRows, totalPages } = paginateRows(filtered, page, 12);

  const reset = () => {
    setEditingId(null);
    setForm({ name: "", icon_url: "", parent_id: "", is_active: true });
  };

  const save = async () => {
    if (!form.name.trim()) return;
    const payload = {
      name: form.name.trim(),
      icon_url: form.icon_url.trim() || null,
      parent_id: form.parent_id ? Number(form.parent_id) : null,
      is_active: form.is_active,
    };

    if (editingId) {
      const res = await api.put(`/inventory/categories/${editingId}`, payload);
      setData(rows.map((r) => (r.id === editingId ? res.data : r)));
    } else {
      const res = await api.post("/inventory/categories", payload);
      setData([...(rows || []), res.data]);
    }
    reset();
  };

  const edit = (row) => {
    setEditingId(row.id);
    setForm({
      name: row.name || "",
      icon_url: row.icon_url || "",
      parent_id: row.parent_id ? String(row.parent_id) : "",
      is_active: Boolean(row.is_active),
    });
  };

  const remove = async (id) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const ok = await confirm("Archive Category", `Archive ${row.name}?`);
    if (!ok) return;
    try {
      await runWithApproval({
        confirm,
        prompt,
        toast,
        approval: {
          module: "inventory",
          action: "archive_category",
          target_type: "ProductCategory",
          target_id: id,
          reason: `Archive category ${row.name}`,
          payload: { name: row.name },
        },
        execute: (approvalCode) => api.delete(`/inventory/categories/${id}`, { params: approvalCode ? { approval_request_code: approvalCode } : {} }),
      });
      setData(rows.filter((r) => r.id !== id));
      if (editingId === id) reset();
      toast("Category archived", "success");
    } catch (error) {
      if (error.approvalCancelled) return;
      toast(error.response?.data?.detail || "Failed to archive category", "error");
    }
  };

  return (
    <div className="space-y-3">
      <AppCard title={editingId ? "Edit Category" : "Create Category"}>
        <h3 className="mb-2 text-sm font-bold text-white">{editingId ? "Edit Category" : "Create Category"}</h3>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
          <input className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" placeholder="Category name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" placeholder="Icon URL (optional)" value={form.icon_url} onChange={(e) => setForm({ ...form, icon_url: e.target.value })} />
          <Select className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
            <option value="">No parent</option>
            {parentOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active
          </label>
          <button onClick={save} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white">{editingId ? "Update" : "Add"}</button>
          <button onClick={reset} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200">Clear</button>
        </div>
      </AppCard>

      <AppCard
        title="Category List"
        actions={
          <div className="flex items-center gap-2">
            <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search categories..." className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-slate-100" />
            <button
              onClick={() => downloadCsv("inventory-categories.csv", [
                { label: "Category", value: "name" },
                { label: "Parent", value: (r) => rows.find((x) => x.id === r.parent_id)?.name || "" },
                { label: "Icon", value: "icon_url" },
                { label: "Status", value: (r) => r.is_active ? "Active" : "Disabled" },
                { label: "Products", value: (r) => Number(r.product_count || 0) },
              ], filtered)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200"
            >
              Export CSV
            </button>
            <button
              onClick={async () => downloadPdf("inventory-categories", "Inventory Categories Report", [
                { label: "Category", value: "name" },
                { label: "Parent", value: (r) => rows.find((x) => x.id === r.parent_id)?.name || "" },
                { label: "Icon", value: "icon_url" },
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
            { key: "name", label: "Name", render: (r) => <span className="text-slate-100">{r.name}</span> },
            { key: "parent", label: "Parent", render: (r) => <span className="text-slate-400">{rows.find((x) => x.id === r.parent_id)?.name || "-"}</span> },
            { key: "icon_url", label: "Icon", render: (r) => <span className="text-slate-400">{r.icon_url || "-"}</span> },
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
          <span>{filtered.length} categories</span>
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
