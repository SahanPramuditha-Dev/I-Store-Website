import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeftRight,
  BadgeCheck,
  ClipboardList,
  CreditCard,
  DollarSign,
  ReceiptText,
  RotateCcw,
  ShieldAlert,
  Store,
  XCircle,
} from "lucide-react";

import api from "../lib/api";
import { openPrintCenter } from "../lib/printCenter";
import { useFeedback } from "../components/FeedbackProvider";
import { AppTableEmptyRow, AppTableHead, AppTableShell, Badge, Button, Input, KpiCard, Loading, SectionCard, Select, SensitiveActionIndicators, StatusBadge, WorkstationNotice } from "../components/UI";
import AppModal from "../components/layout/AppModal";

const TABS = [
  { id: "dashboard", label: "Return Dashboard" },
  { id: "records", label: "Return Records" },
  { id: "create", label: "Create Return" },
  { id: "refunds", label: "Refund Processing" },
  { id: "exchanges", label: "Exchanges" },
  { id: "damaged", label: "Damaged Stock" },
  { id: "credits", label: "Store Credits" },
  { id: "reports", label: "Return Reports" },
];

function money(value) {
  return `LKR ${Math.round(Number(value || 0)).toLocaleString("en-LK")}`;
}
function toDateTime(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString();
}
function tabButtonClass(active) {
  return active
    ? "rounded-lg px-3 py-1.5 text-xs font-bold bg-indigo-500/25 border border-indigo-500/40 text-indigo-100"
    : "rounded-lg px-3 py-1.5 text-xs font-bold bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10";
}

function MiniTable({ columns, rows, emptyLabel = "No records found." }) {
  return (
    <AppTableShell minWidth={680} maxHeightClass="max-h-[min(520px,calc(100vh-280px))]" innerClassName="table table-compact table-sticky" aria-label={emptyLabel}>
        <AppTableHead>
          <tr>
            {columns.map((column) => (
              <th key={column.label}>{column.label}</th>
            ))}
          </tr>
        </AppTableHead>
        <tbody>
          {rows.length === 0 && (
            <AppTableEmptyRow colSpan={columns.length} title={emptyLabel} text="" />
          )}
          {rows.map((row, index) => (
            <tr key={row.id || row.return_number || row.refund_number || index}>
              {columns.map((column) => (
                <td key={`${column.label}-${row.id || row.return_number || index}`}>
                  {typeof column.value === "function" ? column.value(row, index) : row[column.value]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
    </AppTableShell>
  );
}
export default function ReturnsRefunds() {
  const { toast, prompt } = useFeedback();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const invoiceFromQuery = searchParams.get("invoice") || "";
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [records, setRecords] = useState([]);
  const [meta, setMeta] = useState({
    return_types: [],
    inspection_statuses: [],
    decision_statuses: [],
    refund_statuses: [],
    refund_methods: [],
    item_conditions: [],
    restock_actions: [],
    return_reasons: [],
    rules: {},
  });
  const [reportSummary, setReportSummary] = useState(null);
  const [refundReport, setRefundReport] = useState([]);
  const [exchangeReport, setExchangeReport] = useState([]);
  const [damagedRows, setDamagedRows] = useState([]);

  const [filters, setFilters] = useState({
    q: "",
    decision_status: "all",
    return_type: "all",
    date_from: "",
    date_to: "",
  });

  const [invoiceLookup, setInvoiceLookup] = useState(invoiceFromQuery);
  const [invoicePayload, setInvoicePayload] = useState(null);
  const [selectedInvoiceItem, setSelectedInvoiceItem] = useState(null);

  const [createForm, setCreateForm] = useState({
    return_type: "return",
    reason: "Defective item",
    notes: "",
    quantity: 1,
    item_condition: "sellable",
    restock_action: "restock",
    requested_resolution: "refund",
  });

  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [exchangeModalOpen, setExchangeModalOpen] = useState(false);
  const [creditModalOpen, setCreditModalOpen] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState(null);

  const [refundForm, setRefundForm] = useState({
    refund_amount: "",
    refund_method: "cash",
    reason: "",
    notes: "",
  });
  const [exchangeForm, setExchangeForm] = useState({
    new_product_id: "",
    new_quantity: 1,
    notes: "",
  });
  const [creditForm, setCreditForm] = useState({
    amount: "",
    expiry_date: "",
    notes: "",
  });
  const [creditLookupCustomer, setCreditLookupCustomer] = useState("");
  const [customerCredits, setCustomerCredits] = useState([]);

  const buildQuery = useCallback((payload) => {
    const params = new URLSearchParams();
    Object.entries(payload).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      if (String(value).toLowerCase() === "all") return;
      params.set(key, String(value));
    });
    return params.toString();
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const query = buildQuery(filters);
      const [recordsRes, metaRes, summaryRes, refundsRes, exchangesRes, damagedRes] = await Promise.all([
        api.get(`/returns${query ? `?${query}` : ""}`),
        api.get("/returns/meta"),
        api.get("/returns/reports/summary"),
        api.get("/returns/reports/refunds"),
        api.get("/returns/reports/exchanges"),
        api.get("/damaged-stock"),
      ]);
      setRecords(Array.isArray(recordsRes.data) ? recordsRes.data : []);
      setMeta(metaRes.data || meta);
      setReportSummary(summaryRes.data || null);
      setRefundReport(Array.isArray(refundsRes.data?.rows) ? refundsRes.data.rows : []);
      setExchangeReport(Array.isArray(exchangesRes.data?.rows) ? exchangesRes.data.rows : []);
      setDamagedRows(Array.isArray(damagedRes.data) ? damagedRes.data : []);
      if (!createForm.reason && Array.isArray(metaRes.data?.return_reasons) && metaRes.data.return_reasons.length) {
        setCreateForm((prev) => ({ ...prev, reason: metaRes.data.return_reasons[0] }));
      }
    } catch (error) {
      toast(error.userMessage || error.response?.data?.detail || "Failed to load returns module", "error");
    } finally {
      setLoading(false);
    }
  }, [buildQuery, createForm.reason, filters, meta, toast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const kpis = useMemo(() => {
    const totalReturns = records.length;
    const pending = records.filter((row) => row.decision_status === "pending").length;
    const approved = records.filter((row) => row.decision_status === "approved").length;
    const rejected = records.filter((row) => row.decision_status === "rejected").length;
    const exchanges = records.filter((row) => row.decision_status === "exchanged").length;
    const refundTotal = records.reduce((sum, row) => sum + Number(row.refund_amount || 0), 0);
    const creditIssued = records.reduce((sum, row) => sum + Number(row.store_credit_amount || 0), 0);
    return {
      totalReturns,
      pending,
      approved,
      rejected,
      exchanges,
      refundTotal,
      damagedCount: damagedRows.length,
      creditIssued,
    };
  }, [damagedRows.length, records]);

  const lookupInvoice = useCallback(async () => {
    const query = invoiceLookup.trim();
    if (!query) {
      toast("Enter invoice number, customer phone, or customer name", "warning");
      return;
    }
    setBusy(true);
    try {
      const res = await api.get(`/returns/lookup-invoice/${encodeURIComponent(query)}`);
      setInvoicePayload(res.data || null);
      setSelectedInvoiceItem(null);
    } catch (error) {
      toast(error.response?.data?.detail || "Invoice lookup failed", "error");
    } finally {
      setBusy(false);
    }
  }, [invoiceLookup, toast]);

  useEffect(() => {
    if (!invoiceFromQuery) return;
    setActiveTab("create");
    setInvoiceLookup(invoiceFromQuery);
    setInvoicePayload(null);
    setSelectedInvoiceItem(null);
  }, [invoiceFromQuery]);

  useEffect(() => {
    if (!invoiceFromQuery || activeTab !== "create" || invoiceLookup !== invoiceFromQuery || invoicePayload) return;
    lookupInvoice();
  }, [activeTab, invoiceFromQuery, invoiceLookup, invoicePayload, lookupInvoice]);

  const createReturnCase = useCallback(async () => {
    if (!invoicePayload?.selected_invoice || !selectedInvoiceItem) {
      toast("Lookup invoice and select an item first", "warning");
      return;
    }
    const qty = Number(createForm.quantity || 0);
    if (qty <= 0) {
      toast("Return quantity must be at least 1", "warning");
      return;
    }
    if (qty > Number(selectedInvoiceItem.returnable_qty || 0)) {
      toast("Return quantity exceeds eligible quantity", "warning");
      return;
    }
    setBusy(true);
    try {
      await api.post("/returns", {
        original_invoice_id: invoicePayload.selected_invoice.invoice_id,
        customer_id: invoicePayload.selected_invoice.customer_id,
        return_type: createForm.return_type,
        reason: createForm.reason,
        notes: createForm.notes,
        requested_resolution: createForm.requested_resolution,
        items: [
          {
            original_invoice_item_id: selectedInvoiceItem.sale_item_id,
            product_id: selectedInvoiceItem.product_id,
            serial_id: null,
            imei: selectedInvoiceItem.serial_number || null,
            quantity: qty,
            unit_price: Number(selectedInvoiceItem.unit_price || 0),
            item_condition: createForm.item_condition,
            restock_action: createForm.restock_action,
            notes: createForm.notes,
          },
        ],
      });
      toast("Return case created", "success");
      setCreateForm((prev) => ({ ...prev, notes: "", quantity: 1 }));
      await lookupInvoice();
      await loadAll();
      setActiveTab("records");
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to create return", "error");
    } finally {
      setBusy(false);
    }
  }, [createForm, invoicePayload?.selected_invoice, loadAll, lookupInvoice, selectedInvoiceItem, toast]);

  const patchReturnAction = useCallback(
    async (row, action, payload = {}) => {
      setBusy(true);
      try {
        await api.patch(`/returns/${row.id}/${action}`, payload);
        toast(`Return ${action} updated`, "success");
        await loadAll();
      } catch (error) {
        toast(error.response?.data?.detail || `Failed to ${action} return`, "error");
      } finally {
        setBusy(false);
      }
    },
    [loadAll, toast],
  );

  const openRefundModal = useCallback((row) => {
    setSelectedReturn(row);
    setRefundForm({
      refund_amount: String(Number(row.total_return_amount || 0) - Number(row.refund_amount || 0)),
      refund_method: "cash",
      reason: row.reason || "",
      notes: "",
    });
    setRefundModalOpen(true);
  }, []);

  const createRefund = useCallback(async () => {
    if (!selectedReturn) return;
    const amount = Number(refundForm.refund_amount || 0);
    if (amount <= 0) {
      toast("Refund amount must be positive", "warning");
      return;
    }
    setBusy(true);
    try {
      const res = await api.post(`/returns/${selectedReturn.id}/refund`, {
        refund_amount: amount,
        refund_method: refundForm.refund_method,
        reason: refundForm.reason || "Refund processing",
        notes: refundForm.notes,
      });
      toast(`Refund created (${res.data?.refund_number || ""})`, "success");
      setRefundModalOpen(false);
      await loadAll();
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to create refund", "error");
    } finally {
      setBusy(false);
    }
  }, [loadAll, refundForm, selectedReturn, toast]);

  const openExchangeModal = useCallback((row) => {
    setSelectedReturn(row);
    setExchangeForm({ new_product_id: "", new_quantity: 1, notes: "" });
    setExchangeModalOpen(true);
  }, []);

  const createExchange = useCallback(async () => {
    if (!selectedReturn) return;
    if (!exchangeForm.new_product_id) {
      toast("Select replacement product ID", "warning");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/returns/${selectedReturn.id}/exchange`, {
        new_product_id: Number(exchangeForm.new_product_id),
        new_quantity: Number(exchangeForm.new_quantity || 1),
        notes: exchangeForm.notes,
      });
      toast("Exchange completed", "success");
      setExchangeModalOpen(false);
      await loadAll();
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to complete exchange", "error");
    } finally {
      setBusy(false);
    }
  }, [exchangeForm, loadAll, selectedReturn, toast]);

  const openCreditModal = useCallback((row) => {
    setSelectedReturn(row);
    setCreditForm({ amount: String(row.total_return_amount || 0), expiry_date: "", notes: "" });
    setCreditModalOpen(true);
  }, []);

  const issueStoreCredit = useCallback(async () => {
    if (!selectedReturn) return;
    const amount = Number(creditForm.amount || 0);
    if (amount <= 0) {
      toast("Store credit amount must be positive", "warning");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/returns/${selectedReturn.id}/store-credit`, {
        amount,
        expiry_date: creditForm.expiry_date ? new Date(`${creditForm.expiry_date}T00:00:00`).toISOString() : null,
        notes: creditForm.notes,
      });
      toast("Store credit issued", "success");
      setCreditModalOpen(false);
      await loadAll();
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to issue store credit", "error");
    } finally {
      setBusy(false);
    }
  }, [creditForm, loadAll, selectedReturn, toast]);

  const lookupCustomerCredits = useCallback(async () => {
    const customerId = Number(creditLookupCustomer || 0);
    if (customerId <= 0) {
      toast("Enter a valid customer ID", "warning");
      return;
    }
    setBusy(true);
    try {
      const res = await api.get(`/store-credits/customer/${customerId}`);
      setCustomerCredits(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to load customer credits", "error");
    } finally {
      setBusy(false);
    }
  }, [creditLookupCustomer, toast]);

  const useCredit = useCallback(
    async (creditRow) => {
      const amountText = await prompt("Use Store Credit", `Enter amount to use from ${creditRow.credit_number}.`, {
        defaultValue: String(creditRow.remaining_amount || 0),
        placeholder: "0.00",
      });
      if (amountText === null) return;
      const amount = Number(amountText || 0);
      if (amount <= 0) {
        toast("Enter a valid amount", "warning");
        return;
      }
      const invoiceText = await prompt("Link Invoice", "Optional invoice ID for this store credit use.", {
        placeholder: "Invoice ID",
      });
      const invoiceId = invoiceText ? Number(invoiceText) : null;
      setBusy(true);
      try {
        await api.patch(`/store-credits/${creditRow.id}/use`, {
          amount,
          invoice_id: invoiceId && !Number.isNaN(invoiceId) ? invoiceId : null,
          notes: "Used from Returns & Refunds module",
        });
        toast("Store credit used", "success");
        await lookupCustomerCredits();
        await loadAll();
      } catch (error) {
        toast(error.response?.data?.detail || "Failed to use store credit", "error");
      } finally {
        setBusy(false);
      }
    },
    [loadAll, lookupCustomerCredits, prompt, toast],
  );

  const updateRefundStatus = useCallback(
    async (row, action) => {
      setBusy(true);
      try {
        if (action === "approve") {
          await api.patch(`/refunds/${row.id}/approve`, { notes: "Approved from dashboard" });
        } else if (action === "pay") {
          await api.patch(`/refunds/${row.id}/mark-paid`, { notes: "Paid from dashboard" });
        } else if (action === "cancel") {
          const reason = await prompt("Cancel Refund", "Enter the cancellation reason.", {
            defaultValue: "Cancelled by manager",
            placeholder: "Reason",
            multiline: true,
          });
          if (!reason) {
            setBusy(false);
            return;
          }
          await api.patch(`/refunds/${row.id}/cancel`, { reason, notes: "Cancelled from dashboard" });
        }
        toast(`Refund ${action} success`, "success");
        await loadAll();
      } catch (error) {
        toast(error.response?.data?.detail || `Failed to ${action} refund`, "error");
      } finally {
        setBusy(false);
      }
    },
    [loadAll, prompt, toast],
  );

  const updateDamagedAction = useCallback(
    async (row) => {
      const next = await prompt("Damaged Stock Action", "Enter hold, repair, scrap, or return_to_supplier.", {
        defaultValue: row.action || "hold",
        placeholder: "hold",
      });
      if (!next) return;
      setBusy(true);
      try {
        await api.patch(`/damaged-stock/${row.id}/action`, {
          action: next,
          note: "Updated from damaged stock tab",
        });
        toast("Damaged stock action updated", "success");
        await loadAll();
      } catch (error) {
        toast(error.response?.data?.detail || "Failed to update damaged stock action", "error");
      } finally {
        setBusy(false);
      }
    },
    [loadAll, prompt, toast],
  );

  const printReturn = useCallback(
    (row) => {
      if (!row?.id) {
        toast("Open a return record before printing.", "warning");
        return;
      }

      openPrintCenter(navigate, {
        type: "return",
        ref: row.id,
        paper: "thermal_80",
        template: "receipt",
      });
    },
    [navigate, toast],
  );

  if (loading && !records.length) {
    return <Loading text="Loading returns module..." />;
  }

  return (
    <div className="min-h-0 overflow-y-auto pb-5 xl:h-full xl:overflow-y-hidden">
      <div className="space-y-3">
        <section className="panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-white">Returns &amp; Refunds Management</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                I Store workflow for returns, refunds, exchanges, warranty replacements, damaged stock, and store credits.
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={loadAll} disabled={busy}>
              Refresh
            </Button>
          </div>
        </section>

        <section className="panel p-3">
          <div className="flex flex-wrap gap-2">
            {TABS.map((tab) => (
              <button key={tab.id} className={tabButtonClass(activeTab === tab.id)} onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>
        </section>

        <WorkstationNotice
          tone="amber"
          title="Return workflow controls"
          text="Refund, exchange, store credit, damaged-stock, and cancellation steps expose permission, approval, period, and audit context before action."
          right={<SensitiveActionIndicators items={["approval", { type: "period", label: "Period Aware" }, "audit"]} />}
        />

        {activeTab === "dashboard" && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <KpiCard title="Total Returns" value={kpis.totalReturns.toLocaleString()} icon={<RotateCcw size={18} />} />
              <KpiCard title="Pending Inspections" value={kpis.pending.toLocaleString()} icon={<ClipboardList size={18} />} tone="amber" />
              <KpiCard title="Approved Returns" value={kpis.approved.toLocaleString()} icon={<BadgeCheck size={18} />} tone="indigo" />
              <KpiCard title="Rejected Returns" value={kpis.rejected.toLocaleString()} icon={<XCircle size={18} />} tone="red" />
              <KpiCard title="Refund Total" value={money(kpis.refundTotal)} icon={<DollarSign size={18} />} tone="green" />
              <KpiCard title="Exchanges" value={kpis.exchanges.toLocaleString()} icon={<ArrowLeftRight size={18} />} tone="sky" />
              <KpiCard title="Damaged Records" value={kpis.damagedCount.toLocaleString()} icon={<ShieldAlert size={18} />} tone="amber" />
              <KpiCard title="Store Credit Issued" value={money(kpis.creditIssued)} icon={<Store size={18} />} tone="violet" />
            </div>
            <SectionCard title="Summary Snapshot">
              <div className="text-xs text-slate-300 space-y-1">
                <p>Return Period: {meta?.rules?.return_period_days ?? 0} days</p>
                <p>Refund Approval Threshold: {money(meta?.rules?.refund_approval_threshold || 0)}</p>
                <p>Returns Without Invoice: {meta?.rules?.allow_returns_without_invoice ? "Allowed" : "Blocked"}</p>
                <p>Require Inspection Before Refund: {meta?.rules?.require_inspection_before_refund ? "Yes" : "No"}</p>
              </div>
            </SectionCard>
          </>
        )}

        {activeTab === "records" && (
          <SectionCard title="Return Records" subtitle="Search and process return cases">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2 mb-3">
              <Input
                className="!py-2 !px-3 !text-xs xl:col-span-2"
                placeholder="Search return no / customer / reason"
                value={filters.q}
                onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
              />
              <Select
                className="!py-2 !px-3 !text-xs"
                value={filters.decision_status}
                onChange={(event) => setFilters((prev) => ({ ...prev, decision_status: event.target.value }))}
              >
                <option value="all">Decision: All</option>
                {(meta.decision_statuses || []).map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </Select>
              <Select
                className="!py-2 !px-3 !text-xs"
                value={filters.return_type}
                onChange={(event) => setFilters((prev) => ({ ...prev, return_type: event.target.value }))}
              >
                <option value="all">Type: All</option>
                {(meta.return_types || []).map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
              <Input
                type="date"
                className="!py-2 !px-3 !text-xs"
                value={filters.date_from}
                onChange={(event) => setFilters((prev) => ({ ...prev, date_from: event.target.value }))}
              />
              <Input
                type="date"
                className="!py-2 !px-3 !text-xs"
                value={filters.date_to}
                onChange={(event) => setFilters((prev) => ({ ...prev, date_to: event.target.value }))}
              />
            </div>
            <div className="mb-3">
              <Button size="sm" variant="secondary" onClick={loadAll} disabled={busy}>
                Apply Filters
              </Button>
            </div>
            <MiniTable
              columns={[
                { label: "Return No", value: "return_number" },
                { label: "Invoice No", value: (row) => row.original_invoice_number || "-" },
                { label: "Customer", value: (row) => row.customer_name || "-" },
                { label: "Type", value: "return_type" },
                { label: "Reason", value: "reason" },
                { label: "Amount", value: (row) => money(row.total_return_amount) },
                { label: "Inspection", value: "inspection_status" },
                {
                  label: "Decision",
                  value: (row) => <StatusBadge status={row.decision_status} domain="return" label={row.decision_status || "-"} />,
                },
                { label: "Refund", value: (row) => `${row.refund_status} / ${money(row.refund_amount)}` },
                { label: "Created", value: (row) => toDateTime(row.created_at) },
                {
                  label: "Actions",
                  value: (row) => (
                    <div className="flex flex-wrap items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => patchReturnAction(row, "inspect", { inspection_status: "inspected" })}>
                        Inspect
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => patchReturnAction(row, "approve", {})}>
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          const rejection = await prompt("Reject Return", "Enter the rejection reason.", {
                            defaultValue: "Not eligible",
                            placeholder: "Reason",
                            multiline: true,
                          });
                          if (!rejection) return;
                          patchReturnAction(row, "reject", { rejection_reason: rejection });
                        }}
                      >
                        Reject
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openRefundModal(row)}>
                        Refund
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openExchangeModal(row)}>
                        Exchange
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openCreditModal(row)}>
                        Credit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => patchReturnAction(row, "close", {})}>
                        Close
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          const reason = await prompt("Cancel Return", "Enter the cancellation reason.", {
                            defaultValue: "Case cancelled",
                            placeholder: "Reason",
                            multiline: true,
                          });
                          if (!reason) return;
                          patchReturnAction(row, "cancel", { reason });
                        }}
                      >
                        Cancel
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => printReturn(row)}>
                        Print
                      </Button>
                    </div>
                  ),
                },
              ]}
              rows={records}
              emptyLabel="No return cases found."
            />
          </SectionCard>
        )}

        {activeTab === "create" && (
          <SectionCard title="Create Return" subtitle="Search invoice, choose eligible item, and create return request">
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-2">
              <Input
                className="xl:col-span-10 !py-2 !px-3 !text-xs"
                placeholder="Invoice number, customer phone, or customer name"
                value={invoiceLookup}
                onChange={(e) => setInvoiceLookup(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    lookupInvoice();
                  }
                }}
              />
              <Button className="xl:col-span-2" size="sm" onClick={lookupInvoice} disabled={busy}>
                Lookup
              </Button>
            </div>

            {invoicePayload?.selected_invoice && (
              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
                  <p className="font-bold text-white">{invoicePayload.selected_invoice.invoice_no}</p>
                  <p>{invoicePayload.selected_invoice.customer_name} â€¢ {invoicePayload.selected_invoice.customer_phone || "-"}</p>
                  <p>Payment: {invoicePayload.selected_invoice.payment_method || "-"}</p>
                </div>
                <MiniTable
                  columns={[
                    { label: "Product", value: "product_name" },
                    { label: "Sold", value: (row) => row.sold_qty },
                    { label: "Returned", value: (row) => row.already_returned_qty },
                    { label: "Eligible", value: (row) => row.returnable_qty },
                    { label: "Unit Price", value: (row) => money(row.unit_price) },
                    {
                      label: "Select",
                      value: (row) => (
                        <Button
                          size="sm"
                          variant={selectedInvoiceItem?.sale_item_id === row.sale_item_id ? "secondary" : "ghost"}
                          onClick={() => setSelectedInvoiceItem(row)}
                          disabled={Number(row.returnable_qty || 0) <= 0}
                        >
                          {selectedInvoiceItem?.sale_item_id === row.sale_item_id ? "Selected" : "Select"}
                        </Button>
                      ),
                    },
                  ]}
                  rows={invoicePayload.selected_invoice.items || []}
                />
              </div>
            )}

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              <Select value={createForm.return_type} onChange={(e) => setCreateForm((prev) => ({ ...prev, return_type: e.target.value }))}>
                {(meta.return_types || []).map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </Select>
              <Select value={createForm.reason} onChange={(e) => setCreateForm((prev) => ({ ...prev, reason: e.target.value }))}>
                {(meta.return_reasons || []).map((reason) => (
                  <option key={reason} value={reason}>{reason}</option>
                ))}
              </Select>
              <Select value={createForm.item_condition} onChange={(e) => setCreateForm((prev) => ({ ...prev, item_condition: e.target.value }))}>
                {(meta.item_conditions || []).map((condition) => (
                  <option key={condition} value={condition}>{condition}</option>
                ))}
              </Select>
              <Select value={createForm.restock_action} onChange={(e) => setCreateForm((prev) => ({ ...prev, restock_action: e.target.value }))}>
                {(meta.restock_actions || []).map((action) => (
                  <option key={action} value={action}>{action}</option>
                ))}
              </Select>
              <Select value={createForm.requested_resolution} onChange={(e) => setCreateForm((prev) => ({ ...prev, requested_resolution: e.target.value }))}>
                <option value="refund">refund</option>
                <option value="exchange">exchange</option>
                <option value="store_credit">store_credit</option>
                <option value="warranty_replacement">warranty_replacement</option>
              </Select>
              <Input
                type="number"
                min="1"
                value={createForm.quantity}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, quantity: Number(e.target.value || 1) }))}
              />
              <Input
                className="md:col-span-2 xl:col-span-3"
                placeholder="Notes"
                value={createForm.notes}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </div>
            <div className="mt-3">
              <Button size="sm" onClick={createReturnCase} disabled={busy || !selectedInvoiceItem}>
                Create Return Case
              </Button>
            </div>
          </SectionCard>
        )}

        {activeTab === "refunds" && (
          <SectionCard title="Refund Processing" subtitle="Approve, pay, or cancel return refunds">
            <MiniTable
              columns={[
                { label: "Refund No", value: "refund_number" },
                { label: "Return ID", value: "return_id" },
                { label: "Customer ID", value: "customer_id" },
                { label: "Method", value: "refund_method" },
                { label: "Amount", value: (row) => money(row.refund_amount) },
                { label: "Status", value: (row) => <StatusBadge status={row.refund_status} domain="return" label={row.refund_status || "-"} /> },
                { label: "Created", value: (row) => toDateTime(row.created_at) },
                {
                  label: "Actions",
                  value: (row) => (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => updateRefundStatus(row, "approve")}>Approve</Button>
                      <Button size="sm" variant="ghost" onClick={() => updateRefundStatus(row, "pay")}>Mark Paid</Button>
                      <Button size="sm" variant="ghost" onClick={() => updateRefundStatus(row, "cancel")}>Cancel</Button>
                    </div>
                  ),
                },
              ]}
              rows={refundReport}
              emptyLabel="No refunds created."
            />
          </SectionCard>
        )}

        {activeTab === "exchanges" && (
          <SectionCard title="Exchanges" subtitle="Track completed exchanges and price differences">
            <MiniTable
              columns={[
                { label: "Exchange ID", value: "id" },
                { label: "Return ID", value: "return_id" },
                { label: "Old Product", value: "old_product_id" },
                { label: "New Product", value: "new_product_id" },
                { label: "Difference", value: (row) => money(row.price_difference) },
                { label: "Balance to Pay", value: (row) => money(row.balance_to_pay) },
                { label: "Balance to Refund", value: (row) => money(row.balance_to_refund) },
                { label: "Created", value: (row) => toDateTime(row.created_at) },
              ]}
              rows={exchangeReport}
              emptyLabel="No exchange records found."
            />
          </SectionCard>
        )}

        {activeTab === "damaged" && (
          <SectionCard title="Damaged Stock" subtitle="Returned damaged items and disposition actions">
            <MiniTable
              columns={[
                { label: "ID", value: "id" },
                { label: "Return Item", value: "return_item_id" },
                { label: "Product", value: "product_id" },
                { label: "Qty", value: (row) => Number(row.quantity || 0).toLocaleString() },
                { label: "Reason", value: "damage_reason" },
                { label: "Action", value: (row) => <Badge tone="amber">{row.action}</Badge> },
                { label: "Created", value: (row) => toDateTime(row.created_at) },
                {
                  label: "Update",
                  value: (row) => (
                    <Button size="sm" variant="ghost" onClick={() => updateDamagedAction(row)}>
                      Update Action
                    </Button>
                  ),
                },
              ]}
              rows={damagedRows}
              emptyLabel="No damaged stock records."
            />
          </SectionCard>
        )}

        {activeTab === "credits" && (
          <SectionCard title="Store Credits" subtitle="Lookup and consume customer store credits">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
              <Input
                placeholder="Customer ID"
                value={creditLookupCustomer}
                onChange={(e) => setCreditLookupCustomer(e.target.value)}
              />
              <Button size="sm" onClick={lookupCustomerCredits} disabled={busy}>
                Load Credits
              </Button>
            </div>
            <MiniTable
              columns={[
                { label: "Credit No", value: "credit_number" },
                { label: "Customer", value: "customer_id" },
                { label: "Amount", value: (row) => money(row.amount) },
                { label: "Remaining", value: (row) => money(row.remaining_amount) },
                { label: "Status", value: (row) => <StatusBadge status={row.status} label={row.status || "-"} /> },
                { label: "Expiry", value: (row) => toDateTime(row.expiry_date) },
                {
                  label: "Use",
                  value: (row) => (
                    <Button size="sm" variant="ghost" onClick={() => useCredit(row)} disabled={Number(row.remaining_amount || 0) <= 0}>
                      Use
                    </Button>
                  ),
                },
              ]}
              rows={customerCredits}
              emptyLabel="No store credits loaded."
            />
          </SectionCard>
        )}

        {activeTab === "reports" && (
          <SectionCard title="Return Reports" subtitle="Summary, refund, exchange, and damaged stock reports">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              <SectionCard title="Return Summary Report">
                <MiniTable
                  columns={[
                    { label: "Date", value: "date" },
                    { label: "Return Count", value: (row) => Number(row.return_count || 0).toLocaleString() },
                    { label: "Total Return Value", value: (row) => money(row.total_return_value || 0) },
                  ]}
                  rows={reportSummary?.returns_by_date || []}
                  emptyLabel="No summary rows."
                />
              </SectionCard>
              <SectionCard title="High Level">
                <div className="text-xs text-slate-300 space-y-2">
                  <p>Total Returns: {Number(reportSummary?.summary?.total_returns || 0).toLocaleString()}</p>
                  <p>Total Return Value: {money(reportSummary?.summary?.total_return_value || 0)}</p>
                  <p>Total Refunds: {money(reportSummary?.summary?.total_refunds || 0)}</p>
                  <p>Total Exchanges: {Number(reportSummary?.summary?.total_exchanges || 0).toLocaleString()}</p>
                  <p>Damaged Item Count: {Number(reportSummary?.summary?.damaged_item_count || 0).toLocaleString()}</p>
                </div>
              </SectionCard>
            </div>
          </SectionCard>
        )}
      </div>

      <AppModal
        open={refundModalOpen && !!selectedReturn}
        onClose={() => setRefundModalOpen(false)}
        title="Create Refund"
        panelClassName="max-w-lg"
      >
        <div className="space-y-2 p-4">
          <Input
            type="number"
            min="0"
            placeholder="Refund Amount"
            value={refundForm.refund_amount}
            onChange={(e) => setRefundForm((prev) => ({ ...prev, refund_amount: e.target.value }))}
          />
          <Select
            value={refundForm.refund_method}
            onChange={(e) => setRefundForm((prev) => ({ ...prev, refund_method: e.target.value }))}
          >
            {(meta.refund_methods || []).map((method) => (
              <option key={method} value={method}>{method}</option>
            ))}
          </Select>
          <Input
            placeholder="Reason"
            value={refundForm.reason}
            onChange={(e) => setRefundForm((prev) => ({ ...prev, reason: e.target.value }))}
          />
          <Input
            placeholder="Notes"
            value={refundForm.notes}
            onChange={(e) => setRefundForm((prev) => ({ ...prev, notes: e.target.value }))}
          />
          <div className="flex justify-end border-t border-white/10 pt-3">
            <Button size="sm" onClick={createRefund} disabled={busy}>Create Refund</Button>
          </div>
        </div>
      </AppModal>

      <AppModal
        open={exchangeModalOpen && !!selectedReturn}
        onClose={() => setExchangeModalOpen(false)}
        title="Create Exchange"
        panelClassName="max-w-lg"
      >
        <div className="space-y-2 p-4">
          <Input
            type="number"
            placeholder="Replacement Product ID"
            value={exchangeForm.new_product_id}
            onChange={(e) => setExchangeForm((prev) => ({ ...prev, new_product_id: e.target.value }))}
          />
          <Input
            type="number"
            min="1"
            placeholder="Replacement Quantity"
            value={exchangeForm.new_quantity}
            onChange={(e) => setExchangeForm((prev) => ({ ...prev, new_quantity: Number(e.target.value || 1) }))}
          />
          <Input
            placeholder="Notes"
            value={exchangeForm.notes}
            onChange={(e) => setExchangeForm((prev) => ({ ...prev, notes: e.target.value }))}
          />
          <div className="flex justify-end border-t border-white/10 pt-3">
            <Button size="sm" onClick={createExchange} disabled={busy}>Create Exchange</Button>
          </div>
        </div>
      </AppModal>

      <AppModal
        open={creditModalOpen && !!selectedReturn}
        onClose={() => setCreditModalOpen(false)}
        title="Issue Store Credit"
        panelClassName="max-w-lg"
      >
        <div className="space-y-2 p-4">
          <Input
            type="number"
            min="0"
            placeholder="Credit Amount"
            value={creditForm.amount}
            onChange={(e) => setCreditForm((prev) => ({ ...prev, amount: e.target.value }))}
          />
          <Input
            type="date"
            value={creditForm.expiry_date}
            onChange={(e) => setCreditForm((prev) => ({ ...prev, expiry_date: e.target.value }))}
          />
          <Input
            placeholder="Notes"
            value={creditForm.notes}
            onChange={(e) => setCreditForm((prev) => ({ ...prev, notes: e.target.value }))}
          />
          <div className="flex justify-end border-t border-white/10 pt-3">
            <Button size="sm" onClick={issueStoreCredit} disabled={busy}>Issue Credit</Button>
          </div>
        </div>
      </AppModal>
    </div>
  );
}
