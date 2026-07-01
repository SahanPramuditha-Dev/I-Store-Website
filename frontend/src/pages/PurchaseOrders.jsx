import { useState } from "react";
import { useFetch } from "../hooks/useFetch";
import api from "../lib/api";
import { AppTableEmptyRow, AppTableHead, AppTableShell, Badge, Select, SensitiveActionIndicators, WorkstationNotice } from "../components/UI";
import { Calendar, History, PackageCheck, Plus, Truck, X } from "lucide-react";
import { useFeedback } from "../components/FeedbackProvider";
import AppModal from "../components/layout/AppModal";

function emptyDraft() {
  return { supplier_id: "", note: "", items: [] };
}

function emptyDraftItem() {
  return { item_id: "", quantity: 1, unit_cost: "" };
}

export default function PurchaseOrders() {
  const { toast, confirm, prompt } = useFeedback();
  const { data: pos, setData: setPos, loading } = useFetch("/purchase");
  const { data: suppliers } = useFetch("/inventory/suppliers");
  const { data: inventory } = useFetch("/inventory");

  const [isCreating, setIsCreating] = useState(false);
  const [selectedPo, setSelectedPo] = useState(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [draftItem, setDraftItem] = useState(emptyDraftItem());
  const [reconcile, setReconcile] = useState({ invoice_no: "", note: "", lines: [] });

  const addPoItem = () => {
    if (!draftItem.item_id) return;
    const inventoryItem = (inventory || []).find((row) => row.id === Number(draftItem.item_id));
    setDraft((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          item_id: Number(draftItem.item_id),
          quantity: Number(draftItem.quantity || 0),
          unit_cost: Number(draftItem.unit_cost || 0),
          item_name: inventoryItem?.name || "",
        },
      ],
    }));
    setDraftItem(emptyDraftItem());
  };

  const removePoItem = (idx) => {
    setDraft((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  };

  const submitPo = async () => {
    if (!draft.supplier_id || draft.items.length === 0) {
      toast("Please select supplier and add at least one line", "warning");
      return;
    }
    try {
      const payload = {
        supplier_id: Number(draft.supplier_id),
        note: draft.note || null,
        items: draft.items.map((row) => ({
          item_id: Number(row.item_id),
          quantity: Number(row.quantity || 0),
          unit_cost: Number(row.unit_cost || 0),
        })),
      };
      const { data: created } = await api.post("/purchase", payload);
      setPos([created, ...(pos || [])]);
      setIsCreating(false);
      setDraft(emptyDraft());
      toast("Purchase order drafted successfully", "success");
    } catch {
      toast("Failed to create PO", "error");
    }
  };

  const refreshPoList = async () => {
    const { data } = await api.get("/purchase");
    setPos(data || []);
  };

  const viewPo = async (poId) => {
    try {
      const { data: details } = await api.get(`/purchase/${poId}`);
      setSelectedPo(details);
      setReconcile({
        invoice_no: "",
        note: "",
        lines: (details.items || []).map((line) => ({
          item_id: line.item_id,
          received_qty: Number(line.quantity || 0),
          damaged_qty: 0,
          unit_cost: Number(line.unit_cost || 0),
        })),
      });
    } catch {
      toast("Failed to load PO details", "error");
    }
  };

  const receivePoQuick = async (poId) => {
    const ok = await confirm("Auto Receive PO", "Receive full ordered quantities and create linked GRN?");
    if (!ok) return;
    try {
      await api.post(`/purchase/${poId}/receive`);
      await refreshPoList();
      await viewPo(poId);
      toast("PO received and linked GRN created", "success");
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to receive PO", "error");
    }
  };

  const reconcilePo = async () => {
    if (!selectedPo) return;
    try {
      const payload = {
        invoice_no: reconcile.invoice_no || null,
        note: reconcile.note || null,
        lines: reconcile.lines.map((line) => ({
          item_id: Number(line.item_id),
          received_qty: Number(line.received_qty || 0),
          damaged_qty: Number(line.damaged_qty || 0),
          unit_cost: Number(line.unit_cost || 0),
        })),
      };
      await api.post(`/purchase/${selectedPo.id}/reconcile`, payload);
      await refreshPoList();
      await viewPo(selectedPo.id);
      toast("PO reconciled with GRN successfully", "success");
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to reconcile PO", "error");
    }
  };

  const cancelGrn = async (grn) => {
    const reasonInput = await prompt("Cancel GRN", `Enter a reason for cancelling ${grn.grn_no}.`, {
      defaultValue: grn.cancel_reason || "",
      placeholder: "Reason, minimum 5 characters",
      multiline: true,
    });
    if (reasonInput === null) return;
    const reason = String(reasonInput || "").trim();
    if (reason.length < 5) {
      toast("Cancellation reason must be at least 5 characters", "warning");
      return;
    }
    const ok = await confirm(
      "Cancel GRN",
      `Cancel ${grn.grn_no}? This will reverse stock and post a supplier ledger credit.`
    );
    if (!ok) return;
    try {
      await api.post(`/inventory/grn/${grn.id}/cancel`, { reason });
      await refreshPoList();
      if (selectedPo?.id) await viewPo(selectedPo.id);
      toast("GRN cancelled successfully", "success");
    } catch (error) {
      toast(error.response?.data?.message || error.response?.data?.detail || "Failed to cancel GRN", "error");
    }
  };

  const cancelPo = async (po) => {
    const reasonInput = await prompt("Cancel Purchase Order", `Enter a reason for cancelling ${po.po_number}.`, {
      placeholder: "Reason, minimum 5 characters",
      multiline: true,
    });
    if (reasonInput === null) return;
    const reason = String(reasonInput || "").trim();
    if (reason.length < 5) {
      toast("Cancellation reason must be at least 5 characters", "warning");
      return;
    }
    const ok = await confirm(
      "Cancel Purchase Order",
      `Cancel ${po.po_number}? Active GRNs must be cancelled first.`
    );
    if (!ok) return;
    try {
      await api.post(`/purchase/${po.id}/cancel`, { reason });
      await refreshPoList();
      await viewPo(po.id);
      toast("Purchase order cancelled", "success");
    } catch (error) {
      toast(error.response?.data?.message || error.response?.data?.detail || "Failed to cancel purchase order", "error");
    }
  };

  const updateReconcileLine = (index, patch) => {
    setReconcile((prev) => {
      const lines = [...prev.lines];
      lines[index] = { ...lines[index], ...patch };
      return { ...prev, lines };
    });
  };

  if (loading) return <div className="flex h-64 items-center justify-center text-slate-400">Loading Purchase Orders...</div>;

  return (
    <div className="flex h-full flex-col gap-4 pb-4">
      <div className="flex shrink-0 items-end justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">Purchase Orders & GRN Reconciliation</h1>
          <p className="mt-1 text-xs text-slate-400">Create POs, reconcile against received quantities, and track linked GRNs.</p>
        </div>
        <button onClick={() => setIsCreating(true)} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-900/20 transition-all hover:bg-indigo-500">
          <Plus size={14} /> Draft Purchase Order
        </button>
      </div>

      <WorkstationNotice
        tone="amber"
        title="PO / GRN financial control"
        text="Receiving, reconciliation, and cancellation affect supplier ledger, inventory value, stock movement, period controls, and audit history."
        right={<SensitiveActionIndicators items={["approval", { type: "period", label: "Period Aware" }, "audit"]} />}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-900/60 shadow-2xl backdrop-blur-md">
        <div className="shrink-0 border-b border-white/5 bg-black/20 p-4">
          <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
            <History size={14} /> PO / GRN Pipeline
          </h3>
        </div>
        <AppTableShell minWidth={960} className="rounded-none border-0">
            <AppTableHead>
              <tr>
                <th className="px-6 py-4 font-bold">PO Number</th>
                <th className="px-6 py-4 font-bold">Supplier</th>
                <th className="px-6 py-4 font-bold">Created</th>
                <th className="px-6 py-4 font-bold text-center">Status</th>
                <th className="px-6 py-4 font-bold text-center">GRN</th>
                <th className="px-6 py-4 font-bold text-right">Value</th>
              </tr>
            </AppTableHead>
            <tbody className="divide-y divide-white/5">
              {(pos || []).map((po) => (
                <tr key={po.id} onClick={() => viewPo(po.id)} className="group cursor-pointer transition-colors hover:bg-white/[0.02]">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-500/20 bg-indigo-500/10 text-sm font-black uppercase text-indigo-400">
                        <PackageCheck size={14} />
                      </div>
                      <span className="text-sm font-black text-indigo-300 transition-colors group-hover:text-indigo-200">{po.po_number}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-300">
                      <Truck size={14} className="text-slate-500" />
                      {po.supplier_name || `Supplier #${po.supplier_id}`}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
                      <Calendar size={14} className="text-slate-500" />
                      {po.created_at ? new Date(po.created_at).toLocaleDateString() : "-"}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <Badge tone={po.status === "Received" ? "green" : po.status === "Draft" ? "slate" : po.status === "Cancelled" ? "red" : "amber"} className="px-2 py-0.5 text-[10px] uppercase tracking-widest">
                      {po.status}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-xs font-bold text-slate-400">{Number(po.grn_count || 0) > 0 ? (po.grn_numbers || []).join(", ") : "-"}</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="text-sm font-black text-slate-200">LKR {Number(po.total_cost || 0).toLocaleString()}</div>
                  </td>
                </tr>
              ))}
              {(pos || []).length === 0 && (
                <AppTableEmptyRow colSpan={6} title="No purchase orders found" text="Draft a new order to restock your inventory." />
              )}
            </tbody>
        </AppTableShell>
      </div>

      <AppModal
        open={isCreating}
        onClose={() => setIsCreating(false)}
        title="Draft Purchase Order"
        panelClassName="max-w-5xl bg-[#0f172a]"
        headerActions={
          <button onClick={() => setIsCreating(false)} className="text-slate-400 transition-colors hover:text-white">
            <X size={20} />
          </button>
        }
      >
            <div className="grid max-h-[75vh] grid-cols-12 gap-0 overflow-hidden">
              <div className="custom-scrollbar col-span-4 flex flex-col gap-6 overflow-y-auto border-r border-white/5 bg-black/20 p-6">
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Select Supplier</label>
                  <Select className="w-full rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-white focus:border-indigo-500 focus:outline-none" value={draft.supplier_id} onChange={(e) => setDraft({ ...draft, supplier_id: e.target.value })}>
                    <option value="">-- Choose Supplier --</option>
                    {(suppliers || []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Internal Note / Ref</label>
                  <textarea className="min-h-[80px] w-full resize-none rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-white focus:border-indigo-500 focus:outline-none" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="e.g. December stock order" />
                </div>
                <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Add Item</h3>
                  <Select className="w-full rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-white focus:border-indigo-500 focus:outline-none" value={draftItem.item_id} onChange={(e) => setDraftItem({ ...draftItem, item_id: e.target.value })}>
                    <option value="">Select inventory item</option>
                    {(inventory || []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.quantity} in stock)
                      </option>
                    ))}
                  </Select>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" min="1" value={draftItem.quantity} onChange={(e) => setDraftItem({ ...draftItem, quantity: Number(e.target.value) })} className="rounded-xl border border-white/10 bg-black/40 p-2 text-center font-bold text-white outline-none" placeholder="Qty" />
                    <input type="number" min="0" value={draftItem.unit_cost} onChange={(e) => setDraftItem({ ...draftItem, unit_cost: e.target.value })} className="rounded-xl border border-white/10 bg-black/40 p-2 text-center font-bold text-white outline-none" placeholder="Unit cost" />
                  </div>
                  <button onClick={addPoItem} className="mt-1 rounded-xl bg-white/10 py-2.5 text-xs font-bold text-white transition-colors hover:bg-white/20">
                    Add to Draft
                  </button>
                </div>
              </div>
              <div className="col-span-8 flex flex-col bg-[#0f172a] p-6">
                <p className="mb-4 text-[10px] font-black uppercase tracking-widest text-slate-500">PO Manifest</p>
                <div className="custom-scrollbar flex-1 overflow-y-auto rounded-2xl border border-white/5 bg-black/20">
                  <table className="w-full border-collapse text-left">
                    <thead className="sticky top-0 border-b border-white/5 bg-slate-900 text-[10px] uppercase tracking-widest text-slate-500 backdrop-blur">
                      <tr>
                        <th className="px-4 py-3 font-bold">Product</th>
                        <th className="px-4 py-3 text-center font-bold">Qty</th>
                        <th className="px-4 py-3 text-right font-bold">Unit Cost</th>
                        <th className="px-4 py-3 text-right font-bold">Line Total</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {draft.items.map((item, idx) => (
                        <tr key={`${item.item_id}-${idx}`} className="transition-colors hover:bg-white/5">
                          <td className="px-4 py-3 text-sm font-bold text-slate-200">{item.item_name}</td>
                          <td className="px-4 py-3 text-center text-sm font-black text-slate-400">{item.quantity}</td>
                          <td className="px-4 py-3 text-right text-sm text-slate-400">LKR {Number(item.unit_cost || 0).toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-sm font-black text-white">LKR {(Number(item.quantity || 0) * Number(item.unit_cost || 0)).toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">
                            <button onClick={() => removePoItem(idx)} className="rounded bg-rose-500/10 p-1 text-rose-400 transition-colors hover:bg-rose-500/20">
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {draft.items.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-16 text-center text-sm italic text-slate-500">
                            No items added yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="mt-6 flex items-center justify-between rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Total Estimate</p>
                    <p className="mt-1 text-3xl font-black text-white">LKR {draft.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_cost || 0), 0).toLocaleString()}</p>
                  </div>
                  <button onClick={submitPo} className="rounded-xl bg-indigo-600 px-8 py-4 text-sm font-black uppercase tracking-widest text-white shadow-xl shadow-indigo-900/50 transition-all hover:bg-indigo-500">
                    Confirm Draft Order
                  </button>
                </div>
              </div>
            </div>
      </AppModal>

      <AppModal open={!!selectedPo} onClose={() => setSelectedPo(null)} panelClassName="max-w-5xl bg-[#0f172a]">
        {selectedPo && (
          <>
            <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] p-6">
              <div>
                <h3 className="flex items-center gap-3 text-xl font-black tracking-tight text-white">
                  <span className="text-indigo-500">{selectedPo.po_number}</span> Purchase Order
                </h3>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {selectedPo.supplier_name} • {selectedPo.created_at ? new Date(selectedPo.created_at).toLocaleDateString() : "-"}
                </p>
              </div>
              <button onClick={() => setSelectedPo(null)} className="text-slate-400 transition-colors hover:text-white">
                <X size={24} />
              </button>
            </div>

            <div className="custom-scrollbar grid max-h-[70vh] grid-cols-1 gap-0 overflow-y-auto md:grid-cols-2">
              <div className="border-r border-white/5 p-6">
                <h4 className="mb-3 text-xs font-black uppercase tracking-widest text-slate-400">PO Lines</h4>
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="border-b border-white/10 text-[10px] uppercase tracking-widest text-slate-500">
                    <tr>
                      <th className="px-2 py-2">Item</th>
                      <th className="px-2 py-2 text-right">Qty</th>
                      <th className="px-2 py-2 text-right">Unit</th>
                      <th className="px-2 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {(selectedPo.items || []).map((line) => (
                      <tr key={line.id}>
                        <td className="px-2 py-2 text-slate-200">{line.item_name}</td>
                        <td className="px-2 py-2 text-right text-slate-400">{line.quantity}</td>
                        <td className="px-2 py-2 text-right text-slate-400">{Number(line.unit_cost || 0).toLocaleString()}</td>
                        <td className="px-2 py-2 text-right text-slate-200">{(Number(line.quantity || 0) * Number(line.unit_cost || 0)).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Note</p>
                  <p className="mt-1 text-xs text-slate-300">{selectedPo.note || "No note attached"}</p>
                </div>

                <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Linked GRNs</p>
                  {(selectedPo.grns || []).length === 0 ? (
                    <p className="mt-1 text-xs text-slate-400">Not reconciled yet.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {selectedPo.grns.map((grn) => (
                        <div
                          key={grn.id}
                          className={`rounded border p-2 text-xs text-slate-300 ${
                            grn.is_cancelled
                              ? "border-rose-500/20 bg-rose-500/10"
                              : "border-emerald-500/20 bg-emerald-500/5"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className={`font-bold ${grn.is_cancelled ? "text-rose-300" : "text-emerald-300"}`}>{grn.grn_no}</p>
                            {!grn.is_cancelled && (
                              <button
                                type="button"
                                onClick={() => cancelGrn(grn)}
                                className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-200"
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                          <p>Invoice: {grn.invoice_no || "-"}</p>
                          <p>Value: LKR {Number(grn.total_cost || 0).toLocaleString()}</p>
                          {grn.is_cancelled && (
                            <p className="mt-1 text-[10px] text-rose-200">
                              Cancelled: {grn.cancel_reason || "No reason"}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="p-6">
                <h4 className="mb-3 text-xs font-black uppercase tracking-widest text-slate-400">PO ↔ GRN Reconciliation</h4>
                {selectedPo.status === "Cancelled" ? (
                  <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-200">
                    This purchase order has been cancelled.
                  </div>
                ) : selectedPo.status === "Received" ? (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                    This PO is already received and reconciled.
                  </div>
                ) : (
                  <>
                    <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                      <input
                        value={reconcile.invoice_no}
                        onChange={(e) => setReconcile((prev) => ({ ...prev, invoice_no: e.target.value }))}
                        placeholder="Supplier invoice no"
                        className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                      />
                      <input
                        value={reconcile.note}
                        onChange={(e) => setReconcile((prev) => ({ ...prev, note: e.target.value }))}
                        placeholder="Reconciliation note"
                        className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                      />
                    </div>
                    <div className="overflow-hidden rounded-xl border border-white/10">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead className="bg-black/20 text-[10px] uppercase tracking-widest text-slate-500">
                          <tr>
                            <th className="px-2 py-2">Item</th>
                            <th className="px-2 py-2 text-right">Received</th>
                            <th className="px-2 py-2 text-right">Damaged</th>
                            <th className="px-2 py-2 text-right">Unit Cost</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {(selectedPo.items || []).map((line, idx) => (
                            <tr key={`reconcile-${line.id}`}>
                              <td className="px-2 py-2 text-slate-300">{line.item_name}</td>
                              <td className="px-2 py-2">
                                <input type="number" min="0" value={reconcile.lines[idx]?.received_qty ?? line.quantity} onChange={(e) => updateReconcileLine(idx, { received_qty: e.target.value })} className="w-full rounded border border-white/10 bg-black/20 px-2 py-1 text-right text-slate-100 outline-none" />
                              </td>
                              <td className="px-2 py-2">
                                <input type="number" min="0" value={reconcile.lines[idx]?.damaged_qty ?? 0} onChange={(e) => updateReconcileLine(idx, { damaged_qty: e.target.value })} className="w-full rounded border border-white/10 bg-black/20 px-2 py-1 text-right text-slate-100 outline-none" />
                              </td>
                              <td className="px-2 py-2">
                                <input type="number" min="0" value={reconcile.lines[idx]?.unit_cost ?? line.unit_cost} onChange={(e) => updateReconcileLine(idx, { unit_cost: e.target.value })} className="w-full rounded border border-white/10 bg-black/20 px-2 py-1 text-right text-slate-100 outline-none" />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <button onClick={() => receivePoQuick(selectedPo.id)} className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-bold text-emerald-200">
                        Quick Receive (Full)
                      </button>
                      <button onClick={reconcilePo} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500">
                        Reconcile & Create GRN
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-white/5 bg-black/20 p-6">
              {selectedPo.status !== "Cancelled" && (
                <button
                  type="button"
                  onClick={() => cancelPo(selectedPo)}
                  className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-6 py-3 font-bold text-rose-200 transition-colors hover:bg-rose-500/20"
                >
                  Cancel PO
                </button>
              )}
              <button onClick={() => setSelectedPo(null)} className="rounded-xl bg-white/5 px-6 py-3 font-bold text-slate-300 transition-colors hover:bg-white/10">
                Close
              </button>
            </div>
          </>
        )}
      </AppModal>
    </div>
  );
}
