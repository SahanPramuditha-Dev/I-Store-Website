import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Plus, ReceiptText, RefreshCw, X } from "lucide-react";
import api from "../lib/api";
import { openPrintCenter } from "../lib/printCenter";
import { useFetch } from "../hooks/useFetch";
import { AppTableEmptyRow, AppTableHead, AppTableShell, Badge, Button, Input, KpiCard, Select } from "../components/UI";
import AppModal from "../components/layout/AppModal";
import { useFeedback } from "../components/FeedbackProvider";

const STATUS_OPTIONS = ["all", "draft", "reserved", "ordered", "received", "invoiced", "completed", "cancelled", "refunded"];

function asMoney(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00";
}

export default function ProductReservations() {
  const { toast, confirm, prompt } = useFeedback();
  const navigate = useNavigate();
  const reservationsFetch = useFetch("/product-reservations");
  const customersFetch = useFetch("/customers");
  const inventoryFetch = useFetch("/inventory");

  const reservations = reservationsFetch.data || [];
  const customers = customersFetch.data || [];
  const inventory = inventoryFetch.data || [];

  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [creatingInvoiceId, setCreatingInvoiceId] = useState(null);
  const [reservationAdvances, setReservationAdvances] = useState([]);
  const [loadingAdvances, setLoadingAdvances] = useState(false);
  const [form, setForm] = useState({
    customer_id: "",
    product_id: "",
    requested_product_name: "",
    reservation_type: "in_stock_reservation",
    quantity: 1,
    estimated_total: 0,
    advance_required: false,
    advance_required_amount: 0,
    expected_arrival_date: "",
    expiry_date: "",
    notes: "",
  });
  const [advanceForm, setAdvanceForm] = useState({
    amount: 0,
    payment_method: "cash",
    notes: "",
  });

  const selectedReservation = useMemo(
    () => reservations.find((row) => row.id === selectedId) || null,
    [reservations, selectedId]
  );

  useEffect(() => {
    if (!selectedId) {
      setReservationAdvances([]);
      return;
    }
    setLoadingAdvances(true);
    api
      .get(`/advance-payments/product-reservation/${selectedId}`)
      .then(({ data }) => setReservationAdvances(Array.isArray(data) ? data : []))
      .catch(() => setReservationAdvances([]))
      .finally(() => setLoadingAdvances(false));
  }, [selectedId]);

  const filteredRows = useMemo(() => {
    if (statusFilter === "all") return reservations;
    return reservations.filter((row) => String(row.status || "").toLowerCase() === statusFilter);
  }, [reservations, statusFilter]);

  const summary = useMemo(() => {
    const rows = filteredRows;
    const active = rows.filter((row) => ["draft", "reserved", "ordered", "received", "invoiced"].includes(String(row.status || "").toLowerCase()));
    return {
      count: rows.length,
      activeCount: active.length,
      advanceTotal: rows.reduce((sum, row) => sum + Number(row.advance_paid_total || 0), 0),
      balanceDue: rows.reduce((sum, row) => sum + Number(row.balance_due || 0), 0),
    };
  }, [filteredRows]);

  const resetForm = () => {
    setForm({
      customer_id: "",
      product_id: "",
      requested_product_name: "",
      reservation_type: "in_stock_reservation",
      quantity: 1,
      estimated_total: 0,
      advance_required: false,
      advance_required_amount: 0,
      expected_arrival_date: "",
      expiry_date: "",
      notes: "",
    });
  };

  const createReservation = async () => {
    if (!form.customer_id) {
      toast("Select customer", "warning");
      return;
    }
    if (Number(form.quantity || 0) <= 0) {
      toast("Quantity must be greater than zero", "warning");
      return;
    }
    if (form.reservation_type === "in_stock_reservation" && !form.product_id) {
      toast("Select product for in-stock reservation", "warning");
      return;
    }
    try {
      const payload = {
        customer_id: Number(form.customer_id),
        product_id: form.product_id ? Number(form.product_id) : null,
        requested_product_name: form.requested_product_name || null,
        reservation_type: form.reservation_type,
        quantity: Number(form.quantity || 1),
        estimated_total: Number(form.estimated_total || 0),
        advance_required: Boolean(form.advance_required),
        advance_required_amount: Number(form.advance_required_amount || 0),
        expected_arrival_date: form.expected_arrival_date || null,
        expiry_date: form.expiry_date || null,
        notes: form.notes || null,
      };
      const { data } = await api.post("/product-reservations", payload);
      reservationsFetch.setData([data, ...(reservationsFetch.data || [])]);
      setSelectedId(data.id);
      setShowCreateModal(false);
      resetForm();
      toast("Reservation created", "success");
    } catch (error) {
      toast(error?.userMessage || "Failed to create reservation", "error");
    }
  };

  const openAdvanceModal = () => {
    if (!selectedReservation) return;
    setAdvanceForm({
      amount: Number(selectedReservation.advance_required_amount || 0),
      payment_method: "cash",
      notes: "",
    });
    setShowAdvanceModal(true);
  };

  const collectAdvance = async () => {
    if (!selectedReservation) return;
    if (Number(advanceForm.amount || 0) <= 0) {
      toast("Advance amount must be greater than zero", "warning");
      return;
    }
    try {
      await api.post("/advance-payments", {
        advance_type: selectedReservation.reservation_type === "in_stock_reservation" ? "product_reservation" : "product_order",
        customer_id: selectedReservation.customer_id,
        reservation_id: selectedReservation.id,
        amount: Number(advanceForm.amount || 0),
        payment_method: advanceForm.payment_method,
        notes: advanceForm.notes || null,
      });
      await Promise.all([reservationsFetch.refresh()]);
      setShowAdvanceModal(false);
      toast("Advance collected", "success");
    } catch (error) {
      toast(error?.userMessage || "Failed to collect advance", "error");
    }
  };

  const markStatus = async (action) => {
    if (!selectedReservation) return;
    try {
      if (action === "reserve") {
        await api.patch(`/product-reservations/${selectedReservation.id}/reserve`, { notes: "Marked reserved" });
      } else if (action === "ordered") {
        await api.patch(`/product-reservations/${selectedReservation.id}/mark-ordered`, { notes: "Marked ordered" });
      } else if (action === "received") {
        await api.patch(`/product-reservations/${selectedReservation.id}/mark-received`, { notes: "Marked received" });
      }
      await reservationsFetch.refresh();
      toast("Status updated", "success");
    } catch (error) {
      toast(error?.userMessage || "Failed to update status", "error");
    }
  };

  const cancelReservation = async () => {
    if (!selectedReservation) return;
    const reason = await prompt("Cancel Reservation", `Enter a reason for cancelling ${selectedReservation.reservation_number}.`, {
      placeholder: "Reason, minimum 5 characters",
      multiline: true,
    });
    if (reason === null) return;
    if (String(reason).trim().length < 5) {
      toast("Please provide a descriptive reason", "warning");
      return;
    }
    const ok = await confirm("Cancel reservation?", `Cancel ${selectedReservation.reservation_number}?`);
    if (!ok) return;
    try {
      await api.patch(`/product-reservations/${selectedReservation.id}/cancel`, {
        reason: String(reason).trim(),
        notes: "Cancelled from UI",
      });
      await reservationsFetch.refresh();
      toast("Reservation cancelled", "success");
    } catch (error) {
      toast(error?.userMessage || "Failed to cancel reservation", "error");
    }
  };

  const createInvoice = async () => {
    if (!selectedReservation) return;
    setCreatingInvoiceId(selectedReservation.id);
    try {
      const { data } = await api.post(`/product-reservations/${selectedReservation.id}/create-invoice`, {
        payment_method: "Cash",
        paid: true,
        auto_apply_advances: true,
      });
      await reservationsFetch.refresh();
      toast(`Invoice created: ${data.invoice_no || data.invoice_id}`, "success");
    } catch (error) {
      toast(error?.userMessage || "Failed to create invoice", "error");
    } finally {
      setCreatingInvoiceId(null);
    }
  };

  const printAdvanceReceipt = (advanceId) => openPrintCenter(navigate, { type: "advance", ref: advanceId, paper: "thermal_80" });

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white">Product Reservations & Orders</h1>
          <p className="text-xs text-slate-400 mt-1">Manage reservations, advances, and invoice conversion.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => reservationsFetch.refresh()} className="inline-flex items-center gap-2">
            <RefreshCw size={14} /> Refresh
          </Button>
          <Button onClick={() => setShowCreateModal(true)} className="inline-flex items-center gap-2">
            <Plus size={14} /> New Reservation
          </Button>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Reservations" value={summary.count} icon={<ClipboardList size={18} />} />
        <KpiCard title="Active" value={summary.activeCount} tone="amber" />
        <KpiCard title="Advance Collected" value={`LKR ${asMoney(summary.advanceTotal)}`} tone="green" />
        <KpiCard title="Balance Due" value={`LKR ${asMoney(summary.balanceDue)}`} tone="red" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 min-h-0 flex-1">
        <section className="panel p-4 xl:col-span-2 flex flex-col min-h-0">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="text-xs text-slate-400">Total: {filteredRows.length}</div>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-48">
              {STATUS_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value === "all" ? "All Statuses" : value.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          </div>
          <AppTableShell minWidth={920} innerClassName="table">
              <AppTableHead>
                <tr>
                  <th>Reservation</th>
                  <th>Customer</th>
                  <th>Product / Request</th>
                  <th>Status</th>
                  <th>Estimate</th>
                  <th>Advance</th>
                  <th>Balance</th>
                </tr>
              </AppTableHead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setSelectedId(row.id)}
                    className={selectedId === row.id ? "bg-indigo-500/10" : ""}
                  >
                    <td className="font-semibold text-sky-300">{row.reservation_number}</td>
                    <td>{row.customer_name || "-"}</td>
                    <td>{row.product_name || row.requested_product_name || "-"}</td>
                    <td>
                      <Badge tone={["completed"].includes(String(row.status || "").toLowerCase()) ? "green" : ["cancelled", "refunded"].includes(String(row.status || "").toLowerCase()) ? "red" : "amber"}>
                        {String(row.status || "").replaceAll("_", " ")}
                      </Badge>
                    </td>
                    <td>LKR {asMoney(row.estimated_total)}</td>
                    <td>LKR {asMoney(row.advance_paid_total)}</td>
                    <td>LKR {asMoney(row.balance_due)}</td>
                  </tr>
                ))}
                {filteredRows.length === 0 && (
                  <AppTableEmptyRow colSpan={7} title="No reservations found" text="Change the status filter or create a new product reservation." />
                )}
              </tbody>
          </AppTableShell>
        </section>

        <section className="panel p-4 flex flex-col gap-3 min-h-0">
          {!selectedReservation && <p className="text-slate-400 text-sm">Select a reservation to view details.</p>}
          {selectedReservation && (
            <>
              <div>
                <h3 className="font-black text-white text-lg">{selectedReservation.reservation_number}</h3>
                <p className="text-xs text-slate-400 mt-1">{selectedReservation.customer_name}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-white/10 p-2">
                  <p className="text-slate-400">Estimated</p>
                  <p className="font-bold text-white">LKR {asMoney(selectedReservation.estimated_total)}</p>
                </div>
                <div className="rounded-lg border border-white/10 p-2">
                  <p className="text-slate-400">Advance Paid</p>
                  <p className="font-bold text-emerald-300">LKR {asMoney(selectedReservation.advance_paid_total)}</p>
                </div>
                <div className="rounded-lg border border-white/10 p-2 col-span-2">
                  <p className="text-slate-400">Balance Due</p>
                  <p className="font-bold text-amber-300">LKR {asMoney(selectedReservation.balance_due)}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={openAdvanceModal}>Collect Advance</Button>
                <Button size="sm" variant="secondary" onClick={() => markStatus("reserve")}>Mark Reserved</Button>
                <Button size="sm" variant="secondary" onClick={() => markStatus("ordered")}>Mark Ordered</Button>
                <Button size="sm" variant="secondary" onClick={() => markStatus("received")}>Mark Received</Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={createInvoice}
                  disabled={creatingInvoiceId === selectedReservation.id}
                  className="inline-flex items-center gap-1"
                >
                  <ReceiptText size={13} />
                  {creatingInvoiceId === selectedReservation.id ? "Creating..." : "Create Invoice"}
                </Button>
                <Button size="sm" variant="danger" onClick={cancelReservation}>Cancel</Button>
              </div>
              <div className="mt-2 min-h-0 flex-1 overflow-auto rounded-lg border border-white/10 p-2">
                <p className="text-[11px] uppercase tracking-widest text-slate-400 mb-2">Advance History</p>
                {loadingAdvances && <p className="text-xs text-slate-500">Loading...</p>}
                {!loadingAdvances && reservationAdvances.length === 0 && (
                  <p className="text-xs text-slate-500">No advances recorded.</p>
                )}
                {!loadingAdvances && reservationAdvances.length > 0 && (
                  <ul className="space-y-2">
                    {reservationAdvances.map((row) => (
                      <li key={row.id} className="rounded-md border border-white/10 p-2 text-xs">
                        <p className="font-semibold text-sky-300">{row.advance_number}</p>
                        <p className="text-slate-300">Paid: LKR {asMoney(row.amount)} | Remaining: LKR {asMoney(row.remaining_amount)}</p>
                        <p className="text-slate-400">{row.status} | {row.payment_method}</p>
                        <div className="mt-1">
                          <Button size="sm" variant="secondary" onClick={() => printAdvanceReceipt(row.id)}>
                            Print Receipt
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <AppModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Reservation"
        panelClassName="max-w-3xl"
        headerActions={
          <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
          <div>
            <label className="text-xs text-slate-400">Customer</label>
            <Select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} className="mt-1">
              <option value="">Select customer</option>
              {customers.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} ({row.phone})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-xs text-slate-400">Reservation Type</label>
            <Select value={form.reservation_type} onChange={(e) => setForm({ ...form, reservation_type: e.target.value })} className="mt-1">
              <option value="in_stock_reservation">In-stock reservation</option>
              <option value="special_order">Special order</option>
              <option value="pre_order">Pre-order</option>
            </Select>
          </div>
          <div>
            <label className="text-xs text-slate-400">Product</label>
            <Select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} className="mt-1">
              <option value="">Select product (optional for special order)</option>
              {inventory.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} | Stock: {row.quantity}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-xs text-slate-400">Requested Product Name</label>
            <Input value={form.requested_product_name} onChange={(e) => setForm({ ...form, requested_product_name: e.target.value })} className="mt-1" />
          </div>
          <div>
            <label className="text-xs text-slate-400">Quantity</label>
            <Input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="mt-1" />
          </div>
          <div>
            <label className="text-xs text-slate-400">Estimated Total</label>
            <Input type="number" min={0} value={form.estimated_total} onChange={(e) => setForm({ ...form, estimated_total: e.target.value })} className="mt-1" />
          </div>
          <div className="flex items-center gap-2 md:col-span-2">
            <input
              id="advance-required"
              type="checkbox"
              checked={!!form.advance_required}
              onChange={(e) => setForm({ ...form, advance_required: e.target.checked })}
            />
            <label htmlFor="advance-required" className="text-xs text-slate-300">
              Advance required
            </label>
          </div>
          {form.advance_required && (
            <div>
              <label className="text-xs text-slate-400">Advance Required Amount</label>
              <Input type="number" min={0} value={form.advance_required_amount} onChange={(e) => setForm({ ...form, advance_required_amount: e.target.value })} className="mt-1" />
            </div>
          )}
          <div>
            <label className="text-xs text-slate-400">Expected Arrival</label>
            <Input type="datetime-local" value={form.expected_arrival_date} onChange={(e) => setForm({ ...form, expected_arrival_date: e.target.value })} className="mt-1" />
          </div>
          <div>
            <label className="text-xs text-slate-400">Expiry Date</label>
            <Input type="datetime-local" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} className="mt-1" />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-slate-400">Notes</label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1" />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-white/10 p-4">
          <Button variant="ghost" onClick={() => setShowCreateModal(false)}>Cancel</Button>
          <Button onClick={createReservation}>Create</Button>
        </div>
      </AppModal>

      <AppModal
        open={showAdvanceModal && !!selectedReservation}
        onClose={() => setShowAdvanceModal(false)}
        title="Collect Advance"
        panelClassName="max-w-xl"
        headerActions={
          <button onClick={() => setShowAdvanceModal(false)} className="text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
          <div className="md:col-span-2 text-xs text-slate-400">
            {selectedReservation?.reservation_number} | {selectedReservation?.customer_name}
          </div>
          <div>
            <label className="text-xs text-slate-400">Amount</label>
            <Input type="number" min={0} value={advanceForm.amount} onChange={(e) => setAdvanceForm({ ...advanceForm, amount: e.target.value })} className="mt-1" />
          </div>
          <div>
            <label className="text-xs text-slate-400">Payment Method</label>
            <Select value={advanceForm.payment_method} onChange={(e) => setAdvanceForm({ ...advanceForm, payment_method: e.target.value })} className="mt-1">
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank Transfer</option>
            </Select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-slate-400">Notes</label>
            <Input value={advanceForm.notes} onChange={(e) => setAdvanceForm({ ...advanceForm, notes: e.target.value })} className="mt-1" />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-white/10 p-4">
          <Button variant="ghost" onClick={() => setShowAdvanceModal(false)}>Cancel</Button>
          <Button onClick={collectAdvance}>Collect</Button>
        </div>
      </AppModal>
    </div>
  );
}
