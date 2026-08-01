import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../lib/api";
import { runWithApproval } from "../../lib/approvalFlow";
import { useFetch } from "../../hooks/useFetch";
import { downloadCsv, downloadPdf, paginateRows } from "../../lib/tableUtils";
import { AppCard, StickyTable } from "../../components/MuiPrimitives";
import { useFeedback } from "../../components/FeedbackProvider";

export default function InventorySuppliers() {
  const navigate = useNavigate();
  const { toast, confirm, prompt } = useFeedback();
  const { data, setData } = useFetch("/inventory/suppliers");
  const { data: inventory } = useFetch("/inventory");
  const { data: grnRows } = useFetch("/inventory/grn");

  const suppliers = data || [];
  const invRows = inventory || [];
  const grn = grnRows || [];
  const [editingId, setEditingId] = useState(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ name: "", contact: "", email: "", address: "", notes: "", payment_terms_days: 0, opening_balance: 0 });

  const productCountBySupplier = useMemo(() => {
    const map = {};
    for (const item of invRows) {
      const id = Number(item.supplier_id || 0);
      if (!id) continue;
      map[id] = (map[id] || 0) + 1;
    }
    return map;
  }, [invRows]);

  const grnBySupplier = useMemo(() => {
    const map = {};
    for (const row of grn) {
      const id = Number(row.supplier_id || 0);
      if (!id) continue;
      if (!map[id]) map[id] = { count: 0, defective: 0, lastAt: null };
      map[id].count += 1;
      map[id].defective += Number(row.damaged_qty || 0);
      if (!map[id].lastAt || new Date(row.created_at) > new Date(map[id].lastAt)) map[id].lastAt = row.created_at;
    }
    return map;
  }, [grn]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) =>
      [s.name, s.contact, s.email, s.address].some((v) => String(v || "").toLowerCase().includes(q))
    );
  }, [suppliers, query]);
  const { pageRows, totalPages } = paginateRows(filtered, page, 12);

  const reset = () => {
    setEditingId(null);
    setForm({ name: "", contact: "", email: "", address: "", notes: "", payment_terms_days: 0, opening_balance: 0 });
  };

  const save = async () => {
    if (!form.name.trim()) return;
    const payload = {
      name: form.name.trim(),
      contact: form.contact.trim(),
      email: form.email?.trim() || null,
      address: form.address?.trim() || null,
      notes: form.notes?.trim() || null,
      payment_terms_days: Number(form.payment_terms_days || 0),
      opening_balance: Number(form.opening_balance || 0),
    };
    if (editingId) {
      const res = await api.put(`/inventory/suppliers/${editingId}`, payload);
      setData(suppliers.map((s) => (s.id === editingId ? res.data : s)));
    } else {
      const res = await api.post("/inventory/suppliers", payload);
      setData([...(suppliers || []), res.data]);
    }
    reset();
  };

  const edit = (row) => {
    setEditingId(row.id);
    setForm({
      name: row.name || "",
      contact: row.contact || "",
      email: row.email || "",
      address: row.address || "",
      notes: row.notes || "",
      payment_terms_days: Number(row.payment_terms_days || 0),
      opening_balance: Number(row.opening_balance || 0),
    });
  };

  const remove = async (id) => {
    const row = suppliers.find((s) => s.id === id);
    if (!row) return;
    const ok = await confirm("Archive Supplier", `Archive ${row.name}?`);
    if (!ok) return;
    try {
      await runWithApproval({
        confirm,
        prompt,
        toast,
        approval: {
          module: "suppliers",
          action: "archive",
          target_type: "Supplier",
          target_id: id,
          reason: `Archive supplier ${row.name}`,
          payload: { name: row.name },
        },
        execute: (approvalCode) => api.delete(`/inventory/suppliers/${id}`, { params: approvalCode ? { approval_request_code: approvalCode } : {} }),
      });
      setData(suppliers.filter((s) => s.id !== id));
      if (editingId === id) reset();
      toast("Supplier archived", "success");
    } catch (error) {
      if (error.approvalCancelled) return;
      toast(error.response?.data?.detail || "Failed to archive supplier", "error");
    }
  };

  return (
    <div className="space-y-3">
      <AppCard title={editingId ? "Edit Supplier" : "Add Supplier"}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Supplier Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Colombo Fort Traders" className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Contact Details</label>
            <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="Phone / Person" className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Email Address</label>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@domain.com" className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Address</label>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Supplier address" className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Payment Terms (Days)</label>
            <input value={form.payment_terms_days} onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })} type="number" min="0" placeholder="0" className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Opening Balance (Rs.)</label>
            <input value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} type="number" placeholder="0.00" className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Notes / Remarks</label>
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Additional supplier notes..." className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" />
          </div>
          <div className="flex items-end gap-2 md:col-span-4 justify-end pt-1">
            <button onClick={reset} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-white/10">Clear</button>
            <button onClick={save} className="rounded-lg bg-indigo-600 px-5 py-2 text-xs font-bold text-white hover:bg-indigo-500">{editingId ? "Update Supplier" : "Add Supplier"}</button>
          </div>
        </div>
      </AppCard>

      <AppCard
        title="Supplier List"
        actions={(
          <div className="flex items-center gap-2">
            <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search suppliers..." className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-slate-100" />
            <button
              onClick={() => downloadCsv("inventory-suppliers.csv", [
                { label: "Supplier", value: "name" },
                { label: "Contact", value: "contact" },
                { label: "Email", value: "email" },
                { label: "Address", value: "address" },
                { label: "Payment Terms Days", value: (s) => Number(s.payment_terms_days || 0) },
                { label: "Opening Balance", value: (s) => Number(s.opening_balance || 0) },
                { label: "Products", value: (s) => Number(productCountBySupplier[s.id] || 0) },
              ], filtered)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200"
            >
              Export CSV
            </button>
            <button
              onClick={async () => downloadPdf("inventory-suppliers", "Inventory Suppliers Report", [
                { label: "Supplier", value: "name" },
                { label: "Contact", value: "contact" },
                { label: "Email", value: "email" },
                { label: "Address", value: "address" },
                { label: "Terms", value: (s) => `${Number(s.payment_terms_days || 0)}d` },
                { label: "Opening Bal", value: (s) => `Rs. ${Number(s.opening_balance || 0).toLocaleString()}` },
                { label: "Products", value: (s) => Number(productCountBySupplier[s.id] || 0) },
              ], filtered)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200"
            >
              Export PDF
            </button>
            <button
              onClick={() => navigate("/inventory/supplier-ledger")}
              className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-bold text-indigo-200"
            >
              Supplier Ledger
            </button>
          </div>
        )}
      >
        <StickyTable
          maxHeight={560}
          rows={pageRows}
          columns={[
            { key: "name", label: "Supplier", render: (s) => <span className="text-slate-200">{s.name}</span> },
            { key: "contact", label: "Contact", render: (s) => <span className="text-slate-400">{s.contact || "-"}</span> },
            { key: "email", label: "Email", render: (s) => <span className="text-slate-400">{s.email || "-"}</span> },
            { key: "products", label: "Products", align: "right", render: (s) => <span className="text-slate-300">{Number(productCountBySupplier[s.id] || 0)}</span> },
            {
              key: "reliability",
              label: "Reliability Rating",
              render: (s) => {
                const info = grnBySupplier[s.id] || { count: 0, defective: 0 };
                const total = Math.max(1, info.count * 10);
                const score = Math.max(0, Math.min(100, Math.round(((total - info.defective) / total) * 100)));
                const tone = score >= 95 ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : score >= 85 ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/30" : "bg-amber-500/20 text-amber-300 border-amber-500/30";
                return (
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-black ${tone}`}>
                    <span>{score}%</span>
                    <span className="text-[10px] opacity-80 font-normal">{score >= 95 ? "Excellent" : score >= 85 ? "Good" : "Needs Audit"}</span>
                  </span>
                );
              },
            },
            { key: "grn", label: "GRNs", render: (s) => <span className="text-slate-500">{Number(grnBySupplier[s.id]?.count || 0)}</span> },
            {
              key: "actions",
              label: "Actions",
              align: "right",
              render: (s) => (
                <div className="inline-flex gap-1">
                  <button onClick={() => navigate(`/inventory/supplier-ledger?supplier=${s.id}`)} className="rounded border border-indigo-500/40 bg-indigo-500/10 px-2 py-1 text-xs text-indigo-200">Ledger</button>
                  <button onClick={() => edit(s)} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200">Edit</button>
                  <button onClick={() => remove(s.id)} className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-300">Delete</button>
                </div>
              ),
            },
          ]}
        />
        <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
          <span>{filtered.length} suppliers</span>
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
