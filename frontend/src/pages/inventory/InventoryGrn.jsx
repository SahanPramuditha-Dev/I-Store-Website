import { useMemo, useState } from "react";
import api from "../../lib/api";
import { printHtmlDocument } from "../../lib/printBridge";
import { useFetch } from "../../hooks/useFetch";
import { downloadCsv, downloadPdf, paginateRows } from "../../lib/tableUtils";
import { AppCard, StickyTable } from "../../components/MuiPrimitives";
import { Select, ProductSelect } from "../../components/UI";
import { useFeedback } from "../../components/FeedbackProvider";

const emptyLine = { item_id: "", quantity: 1, damaged_qty: 0, unit_cost: 0, sale_price: 0 };
const money = (value) => `LKR ${Number(value || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (value) => `${Number(value || 0).toFixed(1)}%`;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export default function InventoryGrn() {
  const { toast, confirm, prompt } = useFeedback();
  const { data: suppliers } = useFetch("/inventory/suppliers");
  const { data: items } = useFetch("/inventory");
  const { data: purchaseOrders } = useFetch("/purchase");
  const { data: rows, setData } = useFetch("/inventory/grn");

  const [form, setForm] = useState({ supplier_id: "", po_id: "", invoice_no: "", note: "", lines: [{ ...emptyLine }] });
  const [historyQuery, setHistoryQuery] = useState("");
  const [page, setPage] = useState(1);
  const [printingId, setPrintingId] = useState(null);
  const [activeTab, setActiveTab] = useState("create");

  const availablePos = useMemo(
    () =>
      (purchaseOrders || []).filter(
        (po) => String(po.status || "").toLowerCase() !== "received" && (!form.supplier_id || Number(po.supplier_id) === Number(form.supplier_id))
      ),
    [purchaseOrders, form.supplier_id]
  );

  const historyFiltered = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return rows || [];
    return (rows || []).filter((r) =>
      [r.grn_no, r.supplier_name, r.po_number, r.invoice_no, r.note].some((v) => String(v || "").toLowerCase().includes(q))
    );
  }, [rows, historyQuery]);

  const { pageRows, totalPages } = paginateRows(historyFiltered, page, 12);
  const canSubmit = useMemo(() => Number(form.supplier_id) > 0 && form.lines.some((l) => Number(l.item_id) > 0 && Number(l.quantity) > 0), [form]);

  const setLine = (index, patch) => {
    const lines = [...form.lines];
    const prev = lines[index];
    const updated = { ...prev, ...patch };
    if (patch.item_id && patch.item_id !== prev.item_id) {
      const selectedItem = (items || []).find((i) => String(i.id) === String(patch.item_id));
      if (selectedItem) {
        updated.unit_cost = selectedItem.cost_price || 0;
        updated.sale_price = selectedItem.sale_price || 0;
      }
    }
    lines[index] = updated;
    setForm({ ...form, lines });
  };

  const addLine = () => setForm({ ...form, lines: [...form.lines, { ...emptyLine }] });
  const removeLine = (index) => setForm({ ...form, lines: form.lines.filter((_, i) => i !== index) });

  const linkPo = async (poIdValue) => {
    if (!poIdValue) {
      setForm({ ...form, po_id: "", lines: form.lines.length ? form.lines : [{ ...emptyLine }] });
      return;
    }
    let poDetail = availablePos.find((po) => Number(po.id) === Number(poIdValue));
    if (!poDetail || !Array.isArray(poDetail.items)) {
      const res = await api.get(`/purchase/${poIdValue}`);
      poDetail = res.data;
    }
    const poLines = (poDetail.items || []).map((line) => {
      const matchedItem = (items || []).find((i) => Number(i.id) === Number(line.item_id));
      return {
        item_id: line.item_id,
        quantity: Number(line.quantity || 1),
        damaged_qty: 0,
        unit_cost: Number(line.unit_cost || matchedItem?.cost_price || 0),
        sale_price: Number(matchedItem?.sale_price || 0),
      };
    });
    setForm({
      ...form,
      supplier_id: poDetail?.supplier_id ? String(poDetail.supplier_id) : form.supplier_id,
      po_id: String(poIdValue),
      lines: poLines.length ? poLines : [{ ...emptyLine }],
    });
  };

  const submit = async () => {
    if (!form.supplier_id) {
      toast("Please select a supplier before posting GRN", "warning");
      return;
    }
    const validLines = form.lines.filter((l) => Number(l.item_id) > 0 && Number(l.quantity) > 0);
    if (!validLines.length) {
      toast("Please select at least one product with a valid quantity (> 0)", "warning");
      return;
    }

    const payload = {
      supplier_id: Number(form.supplier_id),
      po_id: form.po_id ? Number(form.po_id) : null,
      invoice_no: form.invoice_no || null,
      note: form.note || null,
      lines: validLines.map((l) => ({
        item_id: Number(l.item_id),
        quantity: Number(l.quantity),
        damaged_qty: Number(l.damaged_qty || 0),
        unit_cost: Number(l.unit_cost || 0),
      })),
    };
    try {
      const res = await api.post("/inventory/grn", payload);
      const now = new Date().toISOString();
      const linkedPo = (purchaseOrders || []).find((po) => Number(po.id) === Number(payload.po_id || 0));
      setData([{ id: res.data.grn_id, grn_no: res.data.grn_no, supplier_id: payload.supplier_id, supplier_name: (suppliers || []).find((s) => s.id === payload.supplier_id)?.name || "", po_id: payload.po_id, po_number: linkedPo?.po_number || null, invoice_no: payload.invoice_no, note: payload.note, created_at: now }, ...(rows || [])]);
      setForm({ supplier_id: "", po_id: "", invoice_no: "", note: "", lines: [{ ...emptyLine }] });
      toast("GRN posted successfully", "success");
    } catch (error) {
      toast(error.response?.data?.message || error.response?.data?.detail || "Failed to post GRN", "error");
    }
  };

  const refreshHistory = async () => {
    const res = await api.get("/inventory/grn");
    setData(res.data || []);
  };

  const cancelGrn = async (row) => {
    const reasonInput = await prompt("Cancel GRN", `Enter a reason for cancelling ${row.grn_no}.`, {
      defaultValue: row.cancel_reason || "",
      placeholder: "Reason, minimum 5 characters",
      multiline: true,
    });
    if (reasonInput === null) return;
    const reason = String(reasonInput || "").trim();
    if (reason.length < 5) {
      toast("Cancellation reason must be at least 5 characters", "warning");
      return;
    }
    const ok = await confirm("Cancel GRN", `Cancel ${row.grn_no}? This will reverse stock and supplier ledger.`);
    if (!ok) return;
    try {
      await api.post(`/inventory/grn/${row.id}/cancel`, { reason });
      await refreshHistory();
      toast("GRN cancelled successfully", "success");
    } catch (error) {
      toast(error.response?.data?.message || error.response?.data?.detail || "Failed to cancel GRN", "error");
    }
  };

  const printGrn = async (grnId) => {
    try {
      setPrintingId(grnId);
      const { data } = await api.get(`/inventory/grn/${grnId}`);
      const rowsHtml = (data.lines || [])
        .map(
          (line, index) => `
            <tr>
              <td>${index + 1}</td>
              <td>${escapeHtml(line.item_name || "-")}</td>
              <td>${escapeHtml(line.sku || "-")}</td>
              <td style="text-align:right">${Number(line.quantity || 0)}</td>
              <td style="text-align:right">${Number(line.damaged_qty || 0)}</td>
              <td style="text-align:right">${Number(line.received_qty || 0)}</td>
              <td style="text-align:right">${money(line.unit_cost)}</td>
              <td style="text-align:right">${money(line.line_total)}</td>
            </tr>
          `
        )
        .join("");

      const html = `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(data.grn_no || "GRN")}</title>
          <style>
            @page { size: A4; margin: 16mm; }
            body { font-family: "Segoe UI", Arial, sans-serif; color: #111827; font-size: 12px; }
            .sheet { width: 100%; }
            .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
            .title { font-size: 24px; font-weight: 800; letter-spacing: 0.02em; margin: 0; }
            .meta { font-size: 11px; color: #4b5563; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px; margin-bottom: 14px; }
            .label { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 2px; }
            .value { font-size: 12px; font-weight: 600; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            th, td { border: 1px solid #d1d5db; padding: 7px 8px; vertical-align: middle; }
            th { background: #f3f4f6; text-align: left; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
            tfoot td { font-weight: 700; background: #f9fafb; }
            .summary { margin-top: 14px; display: grid; grid-template-columns: 1fr auto; gap: 2px 18px; max-width: 360px; margin-left: auto; }
            .summary .k { color: #374151; }
            .summary .v { text-align: right; font-weight: 700; }
            .note { margin-top: 12px; border: 1px dashed #d1d5db; padding: 8px; min-height: 48px; }
          </style>
        </head>
        <body>
          <div class="sheet">
            <div class="head">
              <div>
                <h1 class="title">Goods Received Note</h1>
                <div class="meta">iStore Inventory Module</div>
              </div>
              <div style="text-align:right">
                <div class="label">GRN Number</div>
                <div class="value">${escapeHtml(data.grn_no || "-")}</div>
                <div class="meta" style="margin-top:4px;">${escapeHtml(data.created_at ? new Date(data.created_at).toLocaleString() : "-")}</div>
              </div>
            </div>

            <div class="grid">
              <div>
                <div class="label">Supplier</div>
                <div class="value">${escapeHtml(data.supplier_name || "-")}</div>
              </div>
              <div>
                <div class="label">Purchase Order</div>
                <div class="value">${escapeHtml(data.po_number || "-")}</div>
              </div>
              <div>
                <div class="label">Supplier Invoice</div>
                <div class="value">${escapeHtml(data.invoice_no || "-")}</div>
              </div>
              <div>
                <div class="label">Line Count</div>
                <div class="value">${Number(data.line_count || 0)}</div>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th style="width:34px;">#</th>
                  <th>Item</th>
                  <th style="width:120px;">SKU</th>
                  <th style="width:72px; text-align:right;">Qty</th>
                  <th style="width:78px; text-align:right;">Damaged</th>
                  <th style="width:80px; text-align:right;">Received</th>
                  <th style="width:110px; text-align:right;">Unit Cost</th>
                  <th style="width:120px; text-align:right;">Line Total</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>

            <div class="summary">
              <div class="k">Total received units</div><div class="v">${Number(data.total_received_qty || 0)}</div>
              <div class="k">Total damaged units</div><div class="v">${Number(data.total_damaged_qty || 0)}</div>
              <div class="k">GRN Total</div><div class="v">${money(data.grn_total)}</div>
            </div>

            <div class="note">
              <div class="label">Note</div>
              <div>${escapeHtml(data.note || "-")}</div>
            </div>
          </div>
        </body>
      </html>`;

      await printHtmlDocument(html, { silent: false });
    } catch {
      toast("Failed to prepare GRN print preview.", "error");
    } finally {
      setPrintingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Sub-tab switcher */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-2">
        <button
          onClick={() => setActiveTab("create")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
            activeTab === "create"
              ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25"
              : "border border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.08] hover:text-slate-200"
          }`}
        >
          New GRN Entry
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
            activeTab === "history"
              ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25"
              : "border border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.08] hover:text-slate-200"
          }`}
        >
          GRN History & Reports ({(rows || []).length})
        </button>
      </div>

      {activeTab === "create" && (
        <AppCard title="Create GRN">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Supplier *</label>
              <Select className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="">Select supplier</option>
                {(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Purchase Order</label>
              <Select
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                value={form.po_id}
                onChange={(e) => linkPo(e.target.value)}
              >
                <option value="">Link PO (optional)</option>
                {availablePos.map((po) => <option key={po.id} value={po.id}>{po.po_number} ({po.status})</option>)}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Supplier Invoice No.</label>
              <input className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" placeholder="e.g. INV-1092" value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Notes / Remarks</label>
              <input className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" placeholder="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
          </div>

          {/* Goods Received Table */}
          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-300">Goods Received Items Table</div>
              <button onClick={addLine} className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-bold text-indigo-300 hover:bg-indigo-500/20">
                + Add Row
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
              <table className="w-full text-left text-xs text-slate-200">
                <thead className="bg-white/[0.04] text-[11px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5 w-10 text-center">#</th>
                    <th className="px-3 py-2.5 min-w-[200px]">Product / SKU *</th>
                    <th className="px-3 py-2.5 w-24 text-right">Last CP</th>
                    <th className="px-3 py-2.5 w-28 text-right">Cost Price *</th>
                    <th className="px-3 py-2.5 w-28 text-right">Sale Price</th>
                    <th className="px-3 py-2.5 w-24 text-right">GRN Qty *</th>
                    <th className="px-3 py-2.5 w-24 text-right">Damaged</th>
                    <th className="px-3 py-2.5 w-28 text-right">Cost Amount</th>
                    <th className="px-3 py-2.5 w-28 text-right">Sales Amount</th>
                    <th className="px-3 py-2.5 w-24 text-right">Cost Margin</th>
                    <th className="px-3 py-2.5 w-24 text-right">Profit Margin</th>
                    <th className="px-3 py-2.5 w-12 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {form.lines.map((line, index) => {
                    const matchedItem = (items || []).find((i) => String(i.id) === String(line.item_id));
                    const lastCp = matchedItem?.cost_price || 0;
                    const qty = Number(line.quantity || 0);
                    const damaged = Number(line.damaged_qty || 0);
                    const acceptedQty = Math.max(0, qty - damaged);
                    const unitCost = Number(line.unit_cost || 0);
                    const salePrice = Number(line.sale_price || matchedItem?.sale_price || 0);

                    const costAmount = acceptedQty * unitCost;
                    const salesAmount = acceptedQty * salePrice;
                    const profitPerUnit = salePrice - unitCost;

                    const costMarginPct = salePrice > 0 ? (unitCost / salePrice) * 100 : 0;
                    const profitMarginPct = salePrice > 0 ? (profitPerUnit / salePrice) * 100 : 0;

                    return (
                      <tr key={index} className="hover:bg-white/[0.02]">
                        <td className="px-3 py-2 text-center text-slate-500 font-mono">{index + 1}</td>
                        <td className="px-3 py-2 min-w-[240px]">
                          <ProductSelect
                            value={line.item_id}
                            products={items || []}
                            placeholder="-- Select product --"
                            onChange={(e) => setLine(index, { item_id: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-400">
                          {matchedItem ? money(lastCp) : "-"}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            className="w-full text-right rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-slate-100 font-mono"
                            value={line.unit_cost}
                            onChange={(e) => setLine(index, { unit_cost: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            className="w-full text-right rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-slate-100 font-mono"
                            value={line.sale_price}
                            onChange={(e) => setLine(index, { sale_price: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="1"
                            className="w-full text-right rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-slate-100 font-mono"
                            value={line.quantity}
                            onChange={(e) => setLine(index, { quantity: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            className="w-full text-right rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-slate-100 font-mono"
                            value={line.damaged_qty}
                            onChange={(e) => setLine(index, { damaged_qty: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-300">
                          {money(costAmount)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-indigo-300">
                          {money(salesAmount)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-300">
                          {pct(costMarginPct)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-amber-300">
                          {pct(profitMarginPct)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => removeLine(index)}
                            className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs font-bold text-rose-300 hover:bg-rose-500/20"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Summary Footer */}
            {(() => {
              const totalCost = form.lines.reduce((sum, l) => {
                const accepted = Math.max(0, Number(l.quantity || 0) - Number(l.damaged_qty || 0));
                return sum + accepted * Number(l.unit_cost || 0);
              }, 0);
              const totalSales = form.lines.reduce((sum, l) => {
                const accepted = Math.max(0, Number(l.quantity || 0) - Number(l.damaged_qty || 0));
                const matchedItem = (items || []).find((i) => String(i.id) === String(l.item_id));
                const sp = Number(l.sale_price || matchedItem?.sale_price || 0);
                return sum + accepted * sp;
              }, 0);
              const overallProfitMargin = totalSales > 0 ? ((totalSales - totalCost) / totalSales) * 100 : 0;

              return (
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3">
                  <div className="flex flex-wrap items-center gap-6">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Cost Amount</div>
                      <div className="text-sm font-extrabold text-emerald-300">{money(totalCost)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Sales Amount</div>
                      <div className="text-sm font-extrabold text-indigo-300">{money(totalSales)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Est. Profit Margin</div>
                      <div className="text-sm font-extrabold text-amber-300">{pct(overallProfitMargin)}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button onClick={addLine} className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-white/10">
                      + Add Row
                    </button>
                    <button
                      onClick={submit}
                      type="button"
                      className="rounded-lg bg-indigo-600 px-6 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-500/25 hover:bg-indigo-500 active:scale-95 transition-all cursor-pointer"
                    >
                      Post / Create GRN
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </AppCard>
      )}

      {activeTab === "history" && (
        <AppCard
          title="GRN History & Reports"
          actions={(
            <div className="flex items-center gap-2">
              <input value={historyQuery} onChange={(e) => { setHistoryQuery(e.target.value); setPage(1); }} placeholder="Search GRN history..." className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-slate-100" />
              <button onClick={() => downloadCsv("inventory-grn-history.csv", [
                { label: "GRN", value: "grn_no" },
                { label: "Supplier", value: "supplier_name" },
                { label: "PO", value: "po_number" },
                { label: "Invoice", value: "invoice_no" },
                { label: "Note", value: "note" },
                { label: "Created At", value: "created_at" },
              ], historyFiltered)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200">
                Export CSV
              </button>
              <button onClick={async () => downloadPdf("inventory-grn-history", "Inventory GRN History Report", [
                { label: "GRN", value: "grn_no" },
                { label: "Supplier", value: "supplier_name" },
                { label: "PO", value: "po_number" },
                { label: "Invoice", value: "invoice_no" },
                { label: "Note", value: "note" },
                { label: "Created At", value: "created_at" },
              ], historyFiltered)} className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200">
                Export PDF
              </button>
            </div>
          )}
        >
          <StickyTable
            maxHeight={420}
            rows={pageRows}
            columns={[
              { key: "grn_no", label: "GRN", render: (r) => <span className="text-indigo-300">{r.grn_no}</span> },
              { key: "supplier_name", label: "Supplier", render: (r) => <span className="text-slate-200">{r.supplier_name}</span> },
              { key: "po_number", label: "PO", render: (r) => <span className="text-slate-400">{r.po_number || "-"}</span> },
              { key: "invoice_no", label: "Invoice", render: (r) => <span className="text-slate-400">{r.invoice_no || "-"}</span> },
              {
                key: "status",
                label: "Status",
                render: (r) => (
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${r.is_cancelled ? "bg-rose-500/15 text-rose-300" : "bg-emerald-500/15 text-emerald-300"}`}>
                    {r.is_cancelled ? "Cancelled" : "Active"}
                  </span>
                ),
              },
              { key: "grn_total", label: "Total", align: "right", render: (r) => <span className="text-slate-300">{money(r.grn_total || 0)}</span> },
              { key: "note", label: "Note", render: (r) => <span className="text-slate-400">{r.note || "-"}</span> },
              { key: "created_at", label: "Date", render: (r) => <span className="text-slate-500">{r.created_at ? new Date(r.created_at).toLocaleString() : "-"}</span> },
              {
                key: "actions",
                label: "Actions",
                align: "right",
                render: (r) => (
                  <div className="flex items-center justify-end gap-2">
                    {!r.is_cancelled && (
                      <button
                        onClick={() => cancelGrn(r)}
                        className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-200"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      onClick={() => printGrn(r.id)}
                      disabled={printingId === r.id}
                      className="rounded border border-indigo-500/40 bg-indigo-500/10 px-2 py-1 text-xs text-indigo-200 disabled:opacity-50"
                    >
                      {printingId === r.id ? "Preparing..." : "Print GRN"}
                    </button>
                  </div>
                ),
              },
            ]}
          />
          <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
            <span>{historyFiltered.length} entries</span>
            <div className="inline-flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-white/10 px-2 py-1 disabled:opacity-40">Prev</button>
              <span>{page} / {totalPages || 1}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border border-white/10 px-2 py-1 disabled:opacity-40">Next</button>
            </div>
          </div>
        </AppCard>
      )}
    </div>
  );
}
