import { useState } from "react";
import { useFetch } from "../../hooks/useFetch";
import api from "../../lib/api";
import { AppCard, StickyTable } from "../../components/MuiPrimitives";
import AppModal from "../../components/layout/AppModal";
import { useFeedback } from "../../components/FeedbackProvider";
import { Plus, Tag, CheckCircle2, XCircle, Pencil, Trash2 } from "lucide-react";

export default function ProductTypes() {
  const { confirm, toast } = useFeedback();
  const { data: productTypes, refresh } = useFetch("/catalog/product-types");

  const [openModal, setOpenModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form, setForm] = useState({
    name: "",
    requires_serialization: false,
    requires_inventory: true,
    description: "",
  });

  const handleOpenCreate = () => {
    setEditingItem(null);
    setForm({ name: "", requires_serialization: false, requires_inventory: true, description: "" });
    setOpenModal(true);
  };

  const handleOpenEdit = (item) => {
    setEditingItem(item);
    setForm({
      name: item.name || "",
      requires_serialization: !!item.requires_serialization,
      requires_inventory: !!item.requires_inventory,
      description: item.description || "",
    });
    setOpenModal(true);
  };

  const handleDelete = async (item) => {
    const ok = await confirm({
      title: "Delete Product Type",
      message: `Are you sure you want to delete product type "${item.name}"? Products assigned to this type will retain their existing catalog links.`,
      confirmText: "Delete Type",
      cancelText: "Cancel",
      variant: "danger",
    });

    if (!ok) return;

    try {
      await api.delete(`/catalog/product-types/${item.id}`);
      toast(`Deleted product type "${item.name}"`, "success");
      refresh();
    } catch (err) {
      toast(err.response?.data?.detail || err.message || "Failed to delete product type", "error");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;

    try {
      if (editingItem) {
        await api.put(`/catalog/product-types/${editingItem.id}`, form);
        toast(`Updated product type "${form.name}"`, "success");
      } else {
        await api.post("/catalog/product-types", form);
        toast(`Created product type "${form.name}"`, "success");
      }
      setOpenModal(false);
      setEditingItem(null);
      setForm({ name: "", requires_serialization: false, requires_inventory: true, description: "" });
      refresh();
    } catch (err) {
      toast(err.response?.data?.detail || err.message || "Failed to save product type", "error");
    }
  };

  return (
    <>
      <AppCard
        title="Product Types Architecture"
        subtitle="Configure inventory behaviors: Serialized IMEI tracking, batch stock quantity, or labor services."
        actions={
          <button
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/20"
          >
            <Plus size={14} /> New Product Type
          </button>
        }
      >
        <StickyTable
          maxHeight={560}
          rows={productTypes || []}
          rowKey={(r) => r.id}
          columns={[
            {
              key: "name",
              label: "Product Type",
              render: (r) => (
                <div className="flex items-center gap-2">
                  <Tag size={15} className="text-indigo-400 shrink-0" />
                  <div>
                    <div className="font-bold text-slate-100">{r.name}</div>
                    <div className="text-[11px] text-slate-400">{r.description || "System Product Type"}</div>
                  </div>
                </div>
              ),
            },
            {
              key: "requires_serialization",
              label: "Serial / IMEI Tracking",
              align: "center",
              render: (r) => (
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${r.requires_serialization ? "bg-amber-500/10 text-amber-300 border border-amber-500/20" : "bg-slate-800 text-slate-400"}`}>
                  {r.requires_serialization ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                  {r.requires_serialization ? "IMEI Serialized" : "Batch Quantity"}
                </span>
              ),
            },
            {
              key: "requires_inventory",
              label: "Inventory Stocking",
              align: "center",
              render: (r) => (
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${r.requires_inventory ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20" : "bg-purple-500/10 text-purple-300 border border-purple-500/20"}`}>
                  {r.requires_inventory ? "Stock Tracked" : "Service / Labor"}
                </span>
              ),
            },
            {
              key: "actions",
              label: "Actions",
              align: "right",
              render: (r) => (
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    onClick={() => handleOpenEdit(r)}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white"
                  >
                    <Pencil size={13} /> Edit
                  </button>
                  <button
                    onClick={() => handleDelete(r)}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              ),
            },
          ]}
        />
      </AppCard>

      <AppModal
        open={openModal}
        onClose={() => setOpenModal(false)}
        title={editingItem ? `Edit Product Type: ${editingItem.name}` : "Add Product Type"}
        maxWidth="sm"
      >
        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5 sm:px-6 sm:py-6">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300">
              Type Name <span className="text-rose-400">*</span>
            </label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Smart Watch, Drone, Service"
              className="w-full rounded-xl border border-white/15 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300">
              Description
            </label>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Brief description of tracking behavior..."
              className="w-full rounded-xl border border-white/15 bg-slate-950/80 px-4 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="space-y-3 pt-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.requires_serialization}
                onChange={(e) => setForm({ ...form, requires_serialization: e.target.checked })}
                className="h-4 w-4 rounded border-white/20 bg-slate-900 text-indigo-600 focus:ring-indigo-500/30"
              />
              <span className="text-xs font-semibold text-slate-200">Requires Serial / IMEI Tracking (Mobile Phones, Laptops)</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.requires_inventory}
                onChange={(e) => setForm({ ...form, requires_inventory: e.target.checked })}
                className="h-4 w-4 rounded border-white/20 bg-slate-900 text-indigo-600 focus:ring-indigo-500/30"
              />
              <span className="text-xs font-semibold text-slate-200">Requires Physical Stock Tracking (Uncheck for Labor Services)</span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={() => setOpenModal(false)}
              className="rounded-xl border border-white/10 bg-slate-900 px-5 py-2 text-xs font-bold text-slate-400 hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-indigo-600 px-6 py-2 text-xs font-bold text-white hover:bg-indigo-500"
            >
              {editingItem ? "Save Changes" : "Create Product Type"}
            </button>
          </div>
        </form>
      </AppModal>
    </>
  );
}
