import { useMemo, useState } from "react";
import api from "../../lib/api";
import { printHtmlDocument } from "../../lib/printBridge";
import { useFetch } from "../../hooks/useFetch";
import { downloadCsv, downloadPdf, paginateRows } from "../../lib/tableUtils";
import { AppCard, StickyTable } from "../../components/MuiPrimitives";
import { Select } from "../../components/UI";
import { useFeedback } from "../../components/FeedbackProvider";

const emptyLine = { item_id: "", quantity: 1, damaged_qty: 0, unit_cost: 0 };
const money = (value) => `LKR ${Number(value || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
    lines[index] = { ...lines[index], ...patch };
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
    const poLines = (poDetail.items || []).map((line) => ({
      item_id: line.item_id,
      quantity: Number(line.quantity || 1),
      damaged_qty: 0,
      unit_cost: Number(line.unit_cost || 0),
    }));
    setForm({
      ...form,
      supplier_id: poDetail?.supplier_id ? String(poDetail.supplier_id) : form.supplier_id,
      po_id: String(poIdValue),
      lines: poLines.length ? poLines : [{ ...emptyLine }],
    });
  };

  const submit = async () => {
    if (!canSubmit) return;
    const payload = {
      supplier_id: Number(form.supplier_id),
      po_id: form.po_id ? Number(form.po_id) : null,
      invoice_no: form.invoice_no || null,
      note: form.note || null,
      lines: form.lines
        .filter((l) => Number(l.item_id) > 0 && Number(l.quantity) > 0)
        .map((l) => ({
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
      toast(error.response?.data?.detail || "Failed to post GRN", "error");
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
    <div className="space-y-3">
      <AppCard title="Create GRN">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <Select className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
            <option value="">Select supplier</option>
            {(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
            value={form.po_id}
            onChange={(e) => linkPo(e.target.value)}
          >
            <option value="">Link PO (optional)</option>
            {availablePos.map((po) => <option key={po.id} value={po.id}>{po.po_number} ({po.status})</option>)}
          </Select>
          <input className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" placeholder="Supplier invoice number" value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} />
          <input className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" placeholder="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>

        <div className="mt-3 space-y-2">
          {form.lines.map((line, index) => (
            <div key={index} className="grid grid-cols-1 gap-2 rounded-xl border border-white/10 bg-black/20 p-2 md:grid-cols-12">
              <Select className="md:col-span-5 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" value={line.item_id} onChange={(e) => setLine(index, { item_id: e.target.value })}>
                <option value="">Select product</option>
                {(items || []).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.sku})</option>)}
              </Select>
              <input type="number" min="1" className="md:col-span-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" placeholder="Qty" value={line.quantity} onChange={(e) => setLine(index, { quantity: e.target.value })} />
              <input type="number" min="0" className="md:col-span-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" placeholder="Damaged" value={line.damaged_qty} onChange={(e) => setLine(index, { damaged_qty: e.target.value })} />
              <input type="number" min="0" className="md:col-span-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" placeholder="Unit cost" value={line.unit_cost} onChange={(e) => setLine(index, { unit_cost: e.target.value })} />
              <button onClick={() => removeLine(index)} className="md:col-span-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-2 text-xs font-bold text-rose-300">X</button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={addLine} className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200">+ Add Line</button>
          <button disabled={!canSubmit} onClick={submit} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Post GRN</button>
        </div>
      </AppCard>

      <AppCard
        title="Recent GRN Entries"
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
            ], historyFiltered)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200">
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
            <span>{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border border-white/10 px-2 py-1 disabled:opacity-40">Next</button>
          </div>
        </div>
      </AppCard>
    </div>
  );
}
