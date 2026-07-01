import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ban, BadgeCheck, Printer, RefreshCw, RotateCcw, Search, Wallet } from "lucide-react";
import api from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import { useFeedback } from "../components/FeedbackProvider";
import { AppTableEmptyRow, AppTableHead, AppTableShell, Badge, Button, EmptyState, ErrorState, Input, Loading, PageHeader, Select, SensitiveActionIndicators, StatusBadge, WorkstationNotice } from "../components/UI";
import AppModal from "../components/layout/AppModal";
import { openPrintCenter } from "../lib/printCenter";
import usePermissionUI from "../hooks/usePermissionUI";

function money(value) {
  return `LKR ${Number(value || 0).toLocaleString("en-LK", { maximumFractionDigits: 2 })}`;
}

function dateTime(value) {
  if (!value) return "-";
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? String(value) : dt.toLocaleString();
}

export default function AdvancePayments() {
  const { toast, confirm } = useFeedback();
  const navigate = useNavigate();
  const refundPermission = usePermissionUI("advance.refund", "Your role cannot refund advance payments.");
  const cancelPermission = usePermissionUI("advance.cancel", "Your role cannot cancel advance payments.");
  const { data, loading, error, refresh } = useFetch("/advance-payments");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [method, setMethod] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [action, setAction] = useState(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      const text = [row.advance_number, row.customer_name, row.repair_ticket_no, row.reservation_number, row.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return (!q || text.includes(q))
        && (status === "all" || String(row.status || "").toLowerCase() === status)
        && (type === "all" || String(row.advance_type || "").toLowerCase() === type)
        && (method === "all" || String(row.payment_method || "").toLowerCase() === method);
    });
  }, [rows, query, status, type, method]);
  const selected = filtered.find((row) => row.id === selectedId) || filtered[0] || null;

  const stats = useMemo(() => {
    const received = rows.filter((row) => String(row.status || "").toLowerCase() === "received");
    const available = rows.reduce((sum, row) => sum + Number(row.remaining_amount || 0), 0);
    return {
      count: rows.length,
      received: received.length,
      available,
      refunded: rows.filter((row) => String(row.status || "").toLowerCase().includes("refund")).length,
    };
  }, [rows]);

  const printReceipt = (row) => openPrintCenter(navigate, { type: "advance", ref: row?.id, paper: "thermal_80" });

  const submitAction = async () => {
    if (!action?.row) return;
    if (String(action.reason || "").trim().length < 5) {
      toast("A descriptive reason is required.", "warning");
      return;
    }
    setBusy(true);
    try {
      if (action.kind === "refund") {
        const amount = Number(action.amount || 0);
        if (amount <= 0) {
          toast("Refund amount must be greater than zero.", "warning");
          return;
        }
        await api.patch(`/advance-payments/${action.row.id}/refund`, {
          amount,
          reason: action.reason,
          refund_method: action.method || action.row.payment_method || "cash",
          notes: action.notes || "",
          manager_override_used: false,
          convert_to_customer_credit: false,
        });
        toast("Advance refund recorded", "success");
      } else {
        const ok = await confirm("Cancel Advance", `Cancel ${action.row.advance_number}?`);
        if (!ok) return;
        await api.patch(`/advance-payments/${action.row.id}/cancel`, {
          reason: action.reason,
          notes: action.notes || "",
          manager_override_used: false,
        });
        toast("Advance cancelled", "success");
      }
      setAction(null);
      refresh();
    } catch (err) {
      toast(err.response?.data?.detail || "Action failed", "error");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading text="Loading advance payments..." />;

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pb-2 text-slate-200 xl:h-full xl:overflow-hidden">
      <PageHeader
        eyebrow="Customers / Money Control"
        title="Advance Payments"
        subtitle="Track received advances, remaining balances, refunds, cancellations, and receipt reprints from one ledger."
        action={<Button size="sm" variant="secondary" onClick={refresh}><RefreshCw size={13} /> Refresh</Button>}
      />
      {error ? <ErrorState text={error} action={<Button size="sm" variant="secondary" onClick={refresh}>Retry</Button>} /> : null}
      <WorkstationNotice
        tone="sky"
        title="Operational rule"
        text="Refunds and cancellations are sensitive cash actions. Buttons are hidden or disabled unless your role has the matching permission."
        right={<SensitiveActionIndicators items={["approval", "permission", "audit"]} />}
      />

      <div className="grid shrink-0 grid-cols-2 gap-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Total Advances</p>
          <p className="mt-1 text-2xl font-black text-white">{stats.count}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Received</p>
          <p className="mt-1 text-2xl font-black text-emerald-300">{stats.received}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Available Balance</p>
          <p className="mt-1 text-xl font-black text-sky-300">{money(stats.available)}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Refunded</p>
          <p className="mt-1 text-2xl font-black text-rose-300">{stats.refunded}</p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60">
          <div className="grid shrink-0 grid-cols-1 gap-2 border-b border-white/10 p-3 md:grid-cols-[minmax(220px,1fr)_160px_170px_160px]">
            <label className="relative">
              <Search size={14} className="absolute left-3 top-3 text-slate-500" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search receipt, customer, repair, reservation..." className="pl-9" />
            </label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} size="sm">
              <option value="all">All statuses</option>
              <option value="received">Received</option>
              <option value="applied">Applied</option>
              <option value="partially_refunded">Partially refunded</option>
              <option value="refunded">Refunded</option>
              <option value="cancelled">Cancelled</option>
            </Select>
            <Select value={type} onChange={(e) => setType(e.target.value)} size="sm">
              <option value="all">All types</option>
              <option value="repair">Repair</option>
              <option value="product_reservation">Reservation</option>
              <option value="product_order">Product order</option>
              <option value="spare_part_order">Spare part order</option>
              <option value="other">Other</option>
            </Select>
            <Select value={method} onChange={(e) => setMethod(e.target.value)} size="sm">
              <option value="all">All methods</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank</option>
              <option value="mixed">Mixed</option>
            </Select>
          </div>
          <AppTableShell minWidth={680} aria-label="Advance payments ledger">
              <AppTableHead>
                <tr>
                  <th className="px-4 py-3">Receipt</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Remaining</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </AppTableHead>
              <tbody className="divide-y divide-white/5">
                {filtered.map((row) => (
                  <tr key={row.id} onClick={() => setSelectedId(row.id)} className={`cursor-pointer hover:bg-white/[0.03] ${selected?.id === row.id ? "bg-indigo-500/10" : ""}`}>
                    <td className="px-4 py-3">
                      <p className="font-mono font-black text-slate-100">{row.advance_number}</p>
                      <p className="text-[11px] text-slate-500">{dateTime(row.payment_date)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-200">{row.customer_name || "Walk-in"}</p>
                      <p className="text-[11px] text-slate-500">{row.advance_type || "-"}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{row.repair_ticket_no || row.reservation_number || "-"}</td>
                    <td className="px-4 py-3"><StatusBadge status={row.status} domain="payment" label={row.status || "-"} /></td>
                    <td className="px-4 py-3 text-right font-bold text-slate-100">{money(row.amount)}</td>
                    <td className="px-4 py-3 text-right font-bold text-sky-300">{money(row.remaining_amount)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="secondary" onClick={(event) => { event.stopPropagation(); printReceipt(row); }}><Printer size={12} /> Print</Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 ? (
                  <AppTableEmptyRow colSpan={7} title="No advance payments match" text="Change filters or search by receipt number, customer, repair ticket, or reservation." />
                ) : null}
              </tbody>
          </AppTableShell>
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70">
          {selected ? (
            <>
              <div className="border-b border-white/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm font-black text-white">{selected.advance_number}</p>
                    <p className="mt-1 text-xs text-slate-500">{selected.customer_name || "Walk-in customer"}</p>
                  </div>
                  <StatusBadge status={selected.status} domain="payment" label={selected.status || "-"} />
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 custom-scrollbar">
                {[
                  ["Amount", money(selected.amount)],
                  ["Applied", money(selected.applied_amount)],
                  ["Refunded", money(selected.refunded_amount)],
                  ["Remaining", money(selected.remaining_amount)],
                  ["Payment method", selected.payment_method || "-"],
                  ["Received by", selected.received_by_name || selected.received_by || "-"],
                  ["Repair", selected.repair_ticket_no || "-"],
                  ["Reservation", selected.reservation_number || "-"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">{label}</span>
                    <span className="text-right text-xs font-bold text-slate-200">{value}</span>
                  </div>
                ))}
                {selected.notes ? <p className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-slate-400">{selected.notes}</p> : null}
              </div>
              <div className="grid shrink-0 grid-cols-1 gap-2 border-t border-white/10 p-4">
                <Button size="sm" variant="secondary" onClick={() => printReceipt(selected)}><Printer size={13} /> Reprint Receipt</Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={refundPermission.disabled || Number(selected.remaining_amount || 0) <= 0}
                  title={refundPermission.reason || (Number(selected.remaining_amount || 0) <= 0 ? "No remaining amount is available to refund." : undefined)}
                  onClick={() => setAction({ kind: "refund", row: selected, amount: selected.remaining_amount, method: selected.payment_method || "cash", reason: "", notes: "" })}
                >
                  <RotateCcw size={13} /> Refund Remaining
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={cancelPermission.disabled || Number(selected.applied_amount || 0) > 0}
                  title={cancelPermission.reason || (Number(selected.applied_amount || 0) > 0 ? "Applied advances cannot be cancelled without backend override." : undefined)}
                  onClick={() => setAction({ kind: "cancel", row: selected, reason: "", notes: "" })}
                >
                  <Ban size={13} /> Cancel Advance
                </Button>
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-2 text-[11px] text-slate-400">
                  <BadgeCheck size={13} className="text-emerald-300" />
                  Receipt branding is loaded from Store Profile via the backend receipt payload.
                </div>
              </div>
            </>
          ) : (
            <EmptyState title="No advance selected" text="Select a receipt to view remaining balance and print/refund actions." className="m-4" />
          )}
        </aside>
      </div>

      <AppModal open={!!action} onClose={() => !busy && setAction(null)} title={action?.kind === "refund" ? "Refund Advance" : "Cancel Advance"}>
        <div className="space-y-3 p-4">
          {action?.kind === "refund" ? (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">Refund amount</span>
                <Input type="number" min="0" value={action.amount || ""} onChange={(e) => setAction((prev) => ({ ...prev, amount: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">Refund method</span>
                <Select value={action.method || "cash"} onChange={(e) => setAction((prev) => ({ ...prev, method: e.target.value }))}>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="mixed">Mixed</option>
                </Select>
              </label>
            </>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-slate-400">Reason</span>
            <Input value={action?.reason || ""} onChange={(e) => setAction((prev) => ({ ...prev, reason: e.target.value }))} placeholder="Required reason..." />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-slate-400">Notes</span>
            <textarea className="field min-h-[84px]" value={action?.notes || ""} onChange={(e) => setAction((prev) => ({ ...prev, notes: e.target.value }))} />
          </label>
          <div className="flex justify-end gap-2 border-t border-white/10 pt-3">
            <Button size="sm" variant="secondary" onClick={() => setAction(null)} disabled={busy}>Close</Button>
            <Button size="sm" variant="danger" onClick={submitAction} disabled={busy}>{busy ? "Working..." : "Submit"}</Button>
          </div>
        </div>
      </AppModal>
    </div>
  );
}
