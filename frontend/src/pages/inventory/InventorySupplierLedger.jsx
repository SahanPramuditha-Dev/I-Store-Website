import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../../lib/api";
import { useFetch } from "../../hooks/useFetch";
import { AppCard, StickyTable } from "../../components/MuiPrimitives";
import { Select } from "../../components/UI";

export default function InventorySupplierLedger() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: suppliers } = useFetch("/inventory/suppliers");
  const [supplierId, setSupplierId] = useState("");
  const [loading, setLoading] = useState(false);
  const [account, setAccount] = useState(null);
  const [payment, setPayment] = useState({ amount: "", note: "" });
  const [note, setNote] = useState("");

  const supplierOptions = suppliers || [];

  const loadAccount = async (id) => {
    if (!id) {
      setAccount(null);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get(`/inventory/suppliers/${id}/account`);
      setAccount(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialSupplier = searchParams.get("supplier");
    if (initialSupplier && !supplierId) {
      setSupplierId(initialSupplier);
    }
  }, [searchParams, supplierId]);

  useEffect(() => {
    if (supplierId) loadAccount(supplierId);
  }, [supplierId]);

  const submitPayment = async () => {
    const amount = Number(payment.amount || 0);
    if (!supplierId || amount <= 0) return;
    await api.post(`/inventory/suppliers/${supplierId}/payments`, {
      amount,
      note: payment.note || null,
    });
    setPayment({ amount: "", note: "" });
    await loadAccount(supplierId);
  };

  const submitNote = async () => {
    const text = String(note || "").trim();
    if (!supplierId || text.length < 2) return;
    await api.post(`/inventory/suppliers/${supplierId}/notes`, { note: text });
    setNote("");
    await loadAccount(supplierId);
  };

  const summary = account?.summary || {};
  const ledgerEntries = account?.ledger_entries || [];
  const poRows = account?.purchase_orders || [];
  const grnRows = account?.grns || [];
  const outstanding = Number(summary.outstanding_balance || 0);
  const outstandingTone = outstanding > 0 ? "text-amber-300" : "text-emerald-300";

  const latestMemo = useMemo(
    () => ledgerEntries.find((row) => String(row.direction || "").toLowerCase() === "memo"),
    [ledgerEntries]
  );

  return (
    <div className="space-y-3">
      <AppCard title="Supplier Ledger">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
          <Select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
          >
            <option value="">Select supplier</option>
            {supplierOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <button
            onClick={() => supplierId && loadAccount(supplierId)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200"
          >
            Refresh
          </button>
          <button
            onClick={() => supplierId && navigate(`/inventory/suppliers?supplier=${supplierId}`)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200"
          >
            Open Supplier Master
          </button>
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-400 md:col-span-2">
            Track purchase debits, payment credits, and operational notes in one account timeline.
          </div>
        </div>
      </AppCard>

      {loading && (
        <AppCard title="Loading">
          <p className="text-sm text-slate-400">Loading supplier account...</p>
        </AppCard>
      )}

      {account && (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <AppCard title="Opening Balance">
              <p className="text-2xl font-black text-slate-100">LKR {Number(summary.opening_balance || 0).toLocaleString()}</p>
            </AppCard>
            <AppCard title="Purchase Debits">
              <p className="text-2xl font-black text-rose-300">LKR {Number(summary.total_debits || 0).toLocaleString()}</p>
            </AppCard>
            <AppCard title="Payments">
              <p className="text-2xl font-black text-emerald-300">LKR {Number(summary.total_credits || 0).toLocaleString()}</p>
            </AppCard>
            <AppCard title="Outstanding">
              <p className={`text-2xl font-black ${outstandingTone}`}>LKR {outstanding.toLocaleString()}</p>
            </AppCard>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <AppCard title="Record Payment">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <input
                  type="number"
                  min="0"
                  value={payment.amount}
                  onChange={(e) => setPayment({ ...payment, amount: e.target.value })}
                  placeholder="Amount"
                  className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                />
                <input
                  value={payment.note}
                  onChange={(e) => setPayment({ ...payment, note: e.target.value })}
                  placeholder="Payment note"
                  className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
                />
                <button onClick={submitPayment} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">
                  Post Payment
                </button>
              </div>
            </AppCard>
            <AppCard title="Add Account Note">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Write note..."
                  className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 md:col-span-2"
                />
                <button onClick={submitNote} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white">
                  Save Note
                </button>
              </div>
              {latestMemo && (
                <p className="mt-2 text-xs text-slate-400">
                  Latest note: <span className="text-slate-200">{latestMemo.note}</span>
                </p>
              )}
            </AppCard>
          </div>

          <AppCard title="Supplier Ledger Timeline">
            <StickyTable
              maxHeight={420}
              rows={ledgerEntries}
              columns={[
                { key: "created_at", label: "Date", render: (r) => <span className="text-slate-400">{r.created_at ? new Date(r.created_at).toLocaleString() : "-"}</span> },
                { key: "entry_type", label: "Type", render: (r) => <span className="text-slate-200 uppercase text-xs">{r.entry_type}</span> },
                { key: "direction", label: "Direction", render: (r) => <span className="text-slate-400 uppercase text-xs">{r.direction}</span> },
                {
                  key: "amount",
                  label: "Amount",
                  align: "right",
                  render: (r) => (
                    <span className={Number(r.signed_amount || 0) >= 0 ? "text-rose-300" : "text-emerald-300"}>
                      {Number(r.amount || 0).toLocaleString()}
                    </span>
                  ),
                },
                { key: "reference", label: "Reference", render: (r) => <span className="text-slate-500">{r.reference_type || "-"} {r.reference_id ? `#${r.reference_id}` : ""}</span> },
                { key: "note", label: "Note", render: (r) => <span className="text-slate-400">{r.note || "-"}</span> },
              ]}
            />
          </AppCard>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <AppCard title="Purchase Order History">
              <StickyTable
                maxHeight={320}
                rows={poRows}
                columns={[
                  { key: "po_number", label: "PO", render: (r) => <span className="text-indigo-300">{r.po_number}</span> },
                  { key: "status", label: "Status", render: (r) => <span className="text-slate-300">{r.status}</span> },
                  { key: "total_cost", label: "Value", align: "right", render: (r) => <span className="text-slate-200">{Number(r.total_cost || 0).toLocaleString()}</span> },
                  { key: "created_at", label: "Date", render: (r) => <span className="text-slate-500">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "-"}</span> },
                ]}
              />
            </AppCard>
            <AppCard title="GRN History">
              <StickyTable
                maxHeight={320}
                rows={grnRows}
                columns={[
                  { key: "grn_no", label: "GRN", render: (r) => <span className="text-indigo-300">{r.grn_no}</span> },
                  { key: "po_id", label: "Linked PO", render: (r) => <span className="text-slate-300">{r.po_id ? `PO #${r.po_id}` : "-"}</span> },
                  { key: "grn_total", label: "Value", align: "right", render: (r) => <span className="text-slate-200">{Number(r.grn_total || 0).toLocaleString()}</span> },
                  { key: "created_at", label: "Date", render: (r) => <span className="text-slate-500">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "-"}</span> },
                ]}
              />
            </AppCard>
          </div>
        </>
      )}
    </div>
  );
}
