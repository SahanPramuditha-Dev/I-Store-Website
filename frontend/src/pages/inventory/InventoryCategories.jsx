import { useMemo, useState, useEffect } from "react";
import { Upload, FolderTree, Edit3, Trash2, Box, ExternalLink, GitBranch } from "lucide-react";
import api from "../../lib/api";
import { runWithApproval } from "../../lib/approvalFlow";
import { useFetch } from "../../hooks/useFetch";
import { downloadCsv, downloadPdf, paginateRows } from "../../lib/tableUtils";
import { AppCard, StickyTable } from "../../components/MuiPrimitives";
import { Select } from "../../components/UI";
import AppModal from "../../components/layout/AppModal";
import { useFeedback } from "../../components/FeedbackProvider";

function ImageAvatar({ src, name, fallbackIcon: Icon, className = "h-8 w-8" }) {
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
  }, [src]);

  const initials = String(name || "?").trim().slice(0, 2).toUpperCase();

  return (
    <div className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/15 bg-slate-900/90 shadow-md ${className}`}>
      {src && !error ? (
        <img
          src={src}
          alt={name}
          className="h-full w-full object-contain p-1"
          onError={() => setError(true)}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-emerald-600 via-teal-700 to-cyan-800 text-white font-extrabold shadow-inner">
          <span className="bg-gradient-to-tr from-white via-emerald-100 to-teal-200 bg-clip-text text-transparent drop-shadow-sm">
            {initials}
          </span>
        </div>
      )}
    </div>
  );
}

export default function InventoryCategories() {
  const { toast, confirm, prompt } = useFeedback();
  const { data, setData } = useFetch("/inventory/categories");
  const rows = data || [];
  const [editingId, setEditingId] = useState(null);
  const [viewingCategory, setViewingCategory] = useState(null);
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

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      toast("Image file size must be under 3MB", "warning");
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      const base64 = evt.target?.result || "";
      setForm((prev) => ({ ...prev, icon_url: base64 }));
      toast("Category icon image loaded", "info");
    };
    reader.readAsDataURL(file);
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
    setViewingCategory(null);
    setEditingId(row.id);
    setForm({
      name: row.name || "",
      icon_url: row.icon_url || "",
      parent_id: row.parent_id ? String(row.parent_id) : "",
      is_active: Boolean(row.is_active),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
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
      if (viewingCategory?.id === id) setViewingCategory(null);
      toast("Category archived", "success");
    } catch (error) {
      if (error.approvalCancelled) return;
      toast(error.response?.data?.detail || "Failed to archive category", "error");
    }
  };

  return (
    <div className="space-y-3">
      <AppCard title={editingId ? "Edit Category" : "Create Category"}>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-7 items-center">
          <div className="flex items-center gap-2 md:col-span-2">
            <ImageAvatar src={form.icon_url} name={form.name} fallbackIcon={FolderTree} className="h-10 w-10" />
            <input className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" placeholder="Category name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>

          <div className="relative md:col-span-2 flex items-center gap-1">
            <input className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 pr-24" placeholder="Icon URL or upload image" value={form.icon_url} onChange={(e) => setForm({ ...form, icon_url: e.target.value })} />
            <label className="absolute right-1 flex cursor-pointer items-center gap-1 rounded bg-indigo-600/80 px-2 py-1 text-[11px] font-bold text-white hover:bg-indigo-600">
              <Upload size={12} />
              <span>Browse</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
            </label>
          </div>

          <Select className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
            <option value="">No parent</option>
            {parentOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>

          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active
          </label>

          <div className="flex items-center gap-1">
            <button onClick={save} className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-500">{editingId ? "Update" : "Add"}</button>
            <button onClick={reset} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200">Clear</button>
          </div>
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
          onRowClick={(row) => setViewingCategory(row)}
          columns={[
            {
              key: "name",
              label: "Name",
              render: (r) => (
                <div className="flex items-center gap-2.5">
                  <ImageAvatar src={r.icon_url} name={r.name} fallbackIcon={FolderTree} className="h-8 w-8" />
                  <span className="font-semibold text-slate-100">{r.name}</span>
                </div>
              ),
            },
            { key: "parent", label: "Parent", render: (r) => <span className="text-slate-400">{rows.find((x) => x.id === r.parent_id)?.name || "-"}</span> },
            { key: "icon_url", label: "Icon URL", render: (r) => <span className="max-w-[180px] truncate text-xs text-slate-400 block">{r.icon_url || "-"}</span> },
            { key: "products", label: "Products", align: "right", render: (r) => <span className="text-slate-300">{Number(r.product_count || 0)}</span> },
            { key: "status", label: "Status", render: (r) => <span className={`rounded-full px-2 py-0.5 text-xs ${r.is_active ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-500/20 text-slate-300"}`}>{r.is_active ? "Active" : "Disabled"}</span> },
            {
              key: "actions",
              label: "Actions",
              align: "right",
              render: (r) => (
                <div className="inline-flex gap-1">
                  <button onClick={() => edit(r)} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10">Edit</button>
                  <button onClick={() => remove(r.id)} className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/20">Delete</button>
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

      {/* READ-ONLY DETAIL CENTERED POPUP MODAL */}
      <AppModal
        open={Boolean(viewingCategory)}
        onClose={() => setViewingCategory(null)}
        title="Category Details"
        panelClassName="max-w-md w-full overflow-hidden border border-white/15 bg-slate-950/90 shadow-2xl backdrop-blur-xl"
        footer={
          <div className="flex items-center justify-end gap-2 w-full pt-1">
            <button
              onClick={() => edit(viewingCategory)}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-600/30 hover:from-emerald-500 hover:to-teal-400"
            >
              <Edit3 size={14} />
              <span>Edit Category</span>
            </button>
            <button
              onClick={() => remove(viewingCategory?.id)}
              className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/20"
            >
              <Trash2 size={14} />
              <span>Archive</span>
            </button>
          </div>
        }
      >
        {viewingCategory && (
          <div className="space-y-4 py-1">
            <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-emerald-900/30 via-slate-900/60 to-black/60 p-6 text-center shadow-xl">
              {/* Glowing ambient background blur */}
              <div className="absolute -top-10 h-32 w-32 rounded-full bg-emerald-500/20 blur-2xl pointer-events-none" />

              <ImageAvatar src={viewingCategory.icon_url} name={viewingCategory.name} fallbackIcon={FolderTree} className="h-24 w-24 mb-3 border-2 border-emerald-400/30 shadow-[0_0_25px_rgba(16,185,129,0.3)] text-xl" />
              
              <h3 className="text-2xl font-black text-white tracking-tight">{viewingCategory.name}</h3>
              
              <div className="mt-2.5 flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold shadow-sm ${
                  viewingCategory.is_active
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                    : "border-slate-500/30 bg-slate-500/10 text-slate-400"
                }`}>
                  {viewingCategory.is_active && <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />}
                  {viewingCategory.is_active ? "Active Category" : "Disabled Category"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 backdrop-blur-md">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Parent Category</span>
                <div className="mt-1 flex items-center gap-1.5 text-sm font-bold text-slate-200">
                  <GitBranch size={16} className="text-indigo-400" />
                  <span>{rows.find((x) => x.id === viewingCategory.parent_id)?.name || "Top-Level (None)"}</span>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 backdrop-blur-md">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Products</span>
                <div className="mt-1 flex items-center gap-2 text-lg font-black text-white">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                    <Box size={16} />
                  </div>
                  <span>{Number(viewingCategory.product_count || 0)} items</span>
                </div>
              </div>
            </div>

            {viewingCategory.icon_url && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 space-y-1.5 backdrop-blur-md">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <ExternalLink size={13} className="text-emerald-400" /> Icon Source / URL
                </span>
                <p className="break-all text-xs text-slate-300 font-mono bg-black/50 p-2.5 rounded-lg border border-white/5 shadow-inner">
                  {viewingCategory.icon_url}
                </p>
              </div>
            )}
          </div>
        )}
      </AppModal>
    </div>
  );
}
