import { useMemo, useState } from "react";
import { CheckCircle2, Plus, ReceiptText, Search, Trash2, Wallet, XCircle } from "lucide-react";
import { useFetch } from "../hooks/useFetch";
import api from "../lib/api";
import { runWithApproval } from "../lib/approvalFlow";
import { Badge, Button, KpiCard, SectionCard, Select, SensitiveActionIndicators, Table, WorkstationNotice } from "../components/UI";
import AppModal from "../components/layout/AppModal";
import { useFeedback } from "../components/FeedbackProvider";

const EXPENSE_CATEGORIES = [
  "Rent",
  "Salary",
  "Utilities",
  "Tools & Equipment",
  "Miscellaneous",
];

function money(value) {
  return `LKR ${Math.round(Number(value || 0)).toLocaleString("en-LK")}`;
}

function statusTone(status) {
  const key = String(status || "").toLowerCase();
  if (key === "paid") return "green";
  if (key === "approved") return "sky";
  if (key === "rejected" || key === "cancelled") return "red";
  return "amber";
}

function emptyForm() {
  return {
    category: "Miscellaneous",
    amount: "",
    description: "",
    payment_method: "Cash",
    supplier_id: "",
    vendor_name: "",
    reference_no: "",
    is_recurring: false,
    recurring_cycle: "Monthly",
    notes: "",
  };
}

export default function Expenses() {
  const { toast, confirm, prompt } = useFeedback();
  const { data: expensesRaw, setData: setExpensesRaw, loading } = useFetch("/expenses");
  const { data: summaryRaw, setData: setSummaryRaw } = useFetch("/expenses/summary");
  const { data: suppliersRaw } = useFetch("/inventory/suppliers");

  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm());

  const expenses = Array.isArray(expensesRaw) ? expensesRaw : [];
  const summary = summaryRaw || {};
  const suppliers = Array.isArray(suppliersRaw) ? suppliersRaw : [];

  const refresh = async () => {
    try {
      const [rowsRes, summaryRes] = await Promise.all([api.get("/expenses"), api.get("/expenses/summary")]);
      setExpensesRaw(rowsRes.data || []);
      setSummaryRaw(summaryRes.data || {});
    } catch {
      toast("Failed to refresh expenses", "error");
    }
  };

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return expenses.filter((row) => {
      if (statusFilter !== "all" && String(row.status || "") !== statusFilter) return false;
      if (categoryFilter !== "all" && String(row.category || "") !== categoryFilter) return false;
      if (!q) return true;
      const hay = [
        row.expense_code,
        row.category,
        row.description,
        row.vendor_name,
        row.reference_no,
        row.created_by_name,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [categoryFilter, expenses, query, statusFilter]);

  const submit = async () => {
    if (!String(form.category || "").trim()) return toast("Category is required", "warning");
    if (Number(form.amount || 0) <= 0) return toast("Amount must be greater than zero", "warning");
    try {
      await api.post("/expenses", {
        ...form,
        amount: Number(form.amount || 0),
        supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
        recurring_cycle: form.is_recurring ? form.recurring_cycle : null,
      });
      setShowCreate(false);
      setForm(emptyForm());
      await refresh();
      toast("Expense created", "success");
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to create expense", "error");
    }
  };

  const decide = async (row, action) => {
    const actionLabel = action === "paid" ? "mark as paid" : action;
    const ok = await confirm("Expense Decision", `Do you want to ${actionLabel} for ${row.expense_code}?`);
    if (!ok) return;
    try {
      await api.put(`/expenses/${row.id}/approve`, { action, note: `${actionLabel} via Expenses module` });
      await refresh();
      toast(`Expense ${actionLabel}d`, "success");
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to update expense", "error");
    }
  };

  const deleteExpense = async (row) => {
    const ok = await confirm("Delete Expense", `Delete ${row.expense_code}? This cannot be undone.`);
    if (!ok) return;
    try {
      await runWithApproval({
        confirm,
        prompt,
        toast,
        approval: {
          module: "expenses",
          action: "archive",
          target_type: "Expense",
          target_id: row.id,
          reason: `Archive expense ${row.expense_code}`,
          payload: { expense_code: row.expense_code },
        },
        execute: (approvalCode) => api.delete(`/expenses/${row.id}`, { params: approvalCode ? { approval_request_code: approvalCode } : {} }),
      });
      await refresh();
      toast("Expense deleted", "success");
    } catch (error) {
      if (error.approvalCancelled) return;
      toast(error.response?.data?.detail || "Failed to delete expense", "error");
    }
  };

  if (loading) return <div className="h-64 grid place-items-center text-slate-400">Loading expenses...</div>;

  return (
    <div className="min-h-0 space-y-3 pb-3">
      <SectionCard
        title="Expenses Management"
        subtitle="Track rent, salaries, utilities, and operational spending."
        right={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={refresh}>Refresh</Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus size={14} /> Add Expense
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <div className="relative md:col-span-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="field !py-2 !pl-9 !pr-3 !text-xs"
              placeholder="Search code, description, vendor, or user..."
            />
          </div>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">All Statuses</option>
            <option value="Pending Approval">Pending Approval</option>
            <option value="Approved">Approved</option>
            <option value="Paid">Paid</option>
            <option value="Rejected">Rejected</option>
            <option value="Cancelled">Cancelled</option>
          </Select>
          <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">All Categories</option>
            {EXPENSE_CATEGORIES.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </Select>
        </div>
      </SectionCard>

      <WorkstationNotice
        tone="amber"
        title="Expense control state"
        text="Expense approval, payment marking, and archive/delete actions affect cash records and are tracked as sensitive actions."
        right={<SensitiveActionIndicators items={["approval", { type: "period", label: "Period Aware" }, "audit"]} />}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard title="Total Expenses" value={money(summary.total_expenses)} icon={<Wallet size={18} />} tone="amber" />
        <KpiCard title="Pending Approval" value={String(summary.pending_count || 0)} icon={<ReceiptText size={18} />} tone="red" />
        <KpiCard title="Approved" value={String(summary.approved_count || 0)} icon={<CheckCircle2 size={18} />} tone="sky" />
        <KpiCard title="Paid" value={String(summary.paid_count || 0)} icon={<CheckCircle2 size={18} />} tone="green" />
      </div>

      <SectionCard title="Expense Register" subtitle="Operational expense records and approval status">
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
          <Table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Code</th>
                <th>Category</th>
                <th>Description</th>
                <th>Vendor</th>
                <th>Amount</th>
                <th>Status</th>
                <th>By</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-slate-400">No expense records found.</td>
                </tr>
              )}
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.expense_date ? new Date(row.expense_date).toLocaleDateString("en-CA") : "-"}</td>
                  <td>{row.expense_code}</td>
                  <td>{row.category || "-"}</td>
                  <td>{row.description || "-"}</td>
                  <td>{row.vendor_name || row.supplier_name || "-"}</td>
                  <td className="font-bold text-white">{money(row.amount)}</td>
                  <td><Badge tone={statusTone(row.status)}>{row.status}</Badge></td>
                  <td>{row.created_by_name || "System"}</td>
                  <td>
                    <div className="inline-flex gap-1">
                      {row.status === "Pending Approval" && (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => decide(row, "approve")}>Approve</Button>
                          <Button size="sm" variant="ghost" onClick={() => decide(row, "reject")}>Reject</Button>
                        </>
                      )}
                      {row.status === "Approved" && (
                        <Button size="sm" variant="secondary" onClick={() => decide(row, "paid")}>Mark Paid</Button>
                      )}
                      {row.status !== "Paid" && (
                        <Button size="sm" variant="ghost" onClick={() => deleteExpense(row)}>
                          <Trash2 size={12} />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </SectionCard>

      <AppModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Expense"
        panelClassName="max-w-3xl"
        headerActions={
          <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-white">
            <XCircle size={20} />
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2">
          <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="field !py-2.5 !px-3 !text-sm">
            {EXPENSE_CATEGORIES.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </Select>
          <input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="field !py-2.5 !px-3 !text-sm" placeholder="Amount" />
          <input value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} className="field !py-2.5 !px-3 !text-sm" placeholder="Vendor Name (optional)" />
          <input value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} className="field !py-2.5 !px-3 !text-sm" placeholder="Reference No" />
          <Select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} className="field !py-2.5 !px-3 !text-sm">
            <option value="">No Linked Supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
            ))}
          </Select>
          <Select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })} className="field !py-2.5 !px-3 !text-sm">
            <option value="Cash">Cash</option>
            <option value="Card">Card</option>
            <option value="Bank Transfer">Bank Transfer</option>
            <option value="Credit">Credit</option>
          </Select>
          <label className="inline-flex items-center gap-2 text-xs text-slate-300 md:col-span-2">
            <input
              type="checkbox"
              checked={form.is_recurring}
              onChange={(e) => setForm({ ...form, is_recurring: e.target.checked })}
              className="h-4 w-4 rounded border-slate-500 bg-slate-900"
            />
            Recurring expense
          </label>
          {form.is_recurring && (
            <Select value={form.recurring_cycle} onChange={(e) => setForm({ ...form, recurring_cycle: e.target.value })} className="field !py-2.5 !px-3 !text-sm">
              <option value="Monthly">Monthly</option>
              <option value="Weekly">Weekly</option>
              <option value="Yearly">Yearly</option>
            </Select>
          )}
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="field md:col-span-2 !py-2.5 !px-3 !text-sm min-h-[80px]" placeholder="Description" />
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="field md:col-span-2 !py-2.5 !px-3 !text-sm min-h-[70px]" placeholder="Internal notes (optional)" />
        </div>
        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
          <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={submit}>Create Expense</Button>
        </div>
      </AppModal>
    </div>
  );
}

