import { useParams, NavLink, useNavigate } from "react-router-dom";
import { useFetch } from "../hooks/useFetch";
import { Badge, KpiCard } from "../components/UI";
import { 
  ShoppingBag, 
  Wrench, 
  Phone, 
  Mail, 
  MapPin, 
  Calendar, 
  AlertTriangle, 
  ArrowLeft, 
  Clock, 
  ShoppingCart, 
  Edit2, 
  Trash2, 
  X, 
  DollarSign, 
  MessageSquare, 
  Send, 
  ShieldCheck, 
  Printer, 
  Plus, 
  ExternalLink, 
  Copy, 
  Check, 
  Sparkles, 
  User, 
  FileText, 
  CreditCard, 
  Save, 
  Loader2 
} from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import api from "../lib/api";
import { useFeedback } from "../components/FeedbackProvider";
import { isRepairCancelled, isRepairDelivered, repairStatusLabel } from "../lib/repairStatus";
import { openPrintCenter } from "../lib/printCenter";
import AppModal from "../components/layout/AppModal";

function formatDateTime(isoStr) {
  if (!isoStr) return "—";
  const s = String(isoStr);
  const normalized = s.endsWith("Z") || s.includes("+") ? s : s + "Z";
  try {
    return new Date(normalized).toLocaleString();
  } catch {
    return s;
  }
}

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, confirm } = useFeedback();

  const { data: customer, setData: setCustomer, loading: cLoading } = useFetch(`/customers/${id}`);
  const { data: sales, loading: sLoading } = useFetch(`/customers/${id}/sales`);
  const { data: repairs, loading: rLoading } = useFetch(`/customers/${id}/repairs`);
  const { data: warranties, loading: wLoading } = useFetch(`/customers/${id}/warranties`);
  const { data: advances, loading: aLoading } = useFetch(`/customers/${id}/advances`);

  const [activeTab, setActiveTab] = useState("sales");
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", phone: "", email: "", address: "", notes: "" });
  const [staffNotes, setStaffNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // WhatsApp Tab State
  const [waLogs, setWaLogs] = useState([]);
  const [waLoading, setWaLoading] = useState(false);
  const [showWaModal, setShowWaModal] = useState(false);
  const [waMsgText, setWaMsgText] = useState("");
  const [sendingWa, setSendingWa] = useState(false);

  useEffect(() => {
    if (customer?.notes) {
      setStaffNotes(customer.notes);
    }
  }, [customer]);

  const fetchCustomerWaLogs = async () => {
    if (!customer?.phone && !customer?.whatsapp_number) return;
    const phone = customer.whatsapp_number || customer.phone;
    try {
      setWaLoading(true);
      const res = await api.get("/api/whatsapp/logs", { params: { search: phone, limit: 50 } });
      setWaLogs(res.data?.logs || []);
    } catch (e) {
      console.warn("Could not fetch customer WhatsApp logs", e);
    } finally {
      setWaLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "whatsapp" && customer) {
      fetchCustomerWaLogs();
    }
  }, [activeTab, customer]);

  const handleSendDirectWa = async (e) => {
    e.preventDefault();
    const phone = customer.whatsapp_number || customer.phone;
    if (!phone || !waMsgText.trim()) return;

    try {
      setSendingWa(true);
      const res = await api.post("/api/whatsapp/send-direct", {
        phone,
        message: waMsgText.trim(),
        customer_id: Number(id)
      });
      toast({
        title: "WhatsApp Message Dispatched",
        description: `Message sent to ${customer.name} (+${phone})`,
        details: `Message ID: ${res.data?.message_id || "sent"} • Status: SENT`,
        tone: "success",
        iconType: "whatsapp",
        timeoutMs: 4500
      });
      setWaMsgText("");
      setShowWaModal(false);
      fetchCustomerWaLogs();
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || "Failed to send message.";
      toast({
        title: "WhatsApp Dispatch Failed",
        description: detail,
        tone: "error",
        timeoutMs: 5000
      });
    } finally {
      setSendingWa(false);
    }
  };

  const customerSales = useMemo(() => Array.isArray(sales) ? sales : (sales?.items || []), [sales]);
  const customerRepairs = useMemo(() => Array.isArray(repairs) ? repairs : (repairs?.items || []), [repairs]);
  const customerWarranties = useMemo(() => Array.isArray(warranties) ? warranties : (warranties?.items || []), [warranties]);
  const customerAdvances = useMemo(() => Array.isArray(advances) ? advances : (advances?.items || []), [advances]);

  const stats = useMemo(() => {
    const totalSpent = customerSales
      .filter((s) => !s.is_voided && !s.is_return)
      .reduce((sum, s) => sum + (s.total || 0), 0);
    const pendingPayments = customerRepairs
      .filter((r) => !isRepairDelivered(r.status) && !isRepairCancelled(r.status))
      .reduce((sum, r) => sum + Math.max(0, (r.estimated_cost || 0) - (r.advance_payment || 0)), 0);
    const salesCount = customerSales.length;
    const aov = salesCount > 0 ? Math.round(totalSpent / salesCount) : 0;
    const activeWarrantiesCount = customerWarranties.filter(w => String(w.status || "").toLowerCase() === "active").length;

    let tierLabel = "New Customer";
    let tierTone = "slate";
    if (totalSpent >= 100000) {
      tierLabel = "VIP Gold";
      tierTone = "amber";
    } else if (totalSpent >= 25000) {
      tierLabel = "VIP Silver";
      tierTone = "indigo";
    } else if (salesCount >= 3 || customerRepairs.length >= 2) {
      tierLabel = "Frequent Buyer";
      tierTone = "emerald";
    }

    return {
      totalSpent,
      pendingPayments,
      unappliedAdvance: customerAdvances.reduce((sum, row) => sum + Number(row.remaining_amount || 0), 0),
      salesCount,
      repairsCount: customerRepairs.length,
      warrantiesCount: customerWarranties.length,
      activeWarrantiesCount,
      advancesCount: customerAdvances.length,
      aov,
      tierLabel,
      tierTone,
    };
  }, [customerSales, customerRepairs, customerWarranties, customerAdvances]);

  const handleCopyPhone = () => {
    if (!customer?.phone) return;
    navigator.clipboard.writeText(customer.phone);
    setCopiedPhone(true);
    toast("Phone number copied", "success");
    setTimeout(() => setCopiedPhone(false), 2000);
  };

  const handleSaveNotes = async () => {
    if (!customer) return;
    setSavingNotes(true);
    try {
      const { data } = await api.put(`/customers/${id}`, {
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        notes: staffNotes.trim(),
      });
      setCustomer(data);
      toast("Customer notes saved", "success");
    } catch (err) {
      toast(err?.response?.data?.detail || "Failed to save notes", "error");
    } finally {
      setSavingNotes(false);
    }
  };

  const startEdit = () => {
    if (!customer) return;
    setEditForm({
      name: customer.name || "",
      phone: customer.phone || "",
      email: customer.email || "",
      address: customer.address || "",
      notes: customer.notes || ""
    });
    setIsEditing(true);
  };

  const saveEdit = async () => {
    if (!editForm?.name || !editForm?.phone) return toast("Name and phone are required", "warning");
    try {
      const { data } = await api.put(`/customers/${id}`, editForm);
      setCustomer(data);
      setIsEditing(false);
      toast("Customer profile updated", "success");
    } catch(err) {
      toast(err?.response?.data?.detail || "Failed to update profile", "error");
    }
  };

  const deleteProfile = async () => {
    const ok = await confirm("Delete Customer", `Are you sure you want to archive ${customer?.name}?`);
    if (!ok) return;
    try {
      await api.delete(`/customers/${id}`);
      toast("Customer profile archived", "success");
      navigate("/customers");
    } catch(err) {
      toast(err?.response?.data?.detail || "Failed to delete customer", "error");
    }
  };

  if (cLoading || sLoading || rLoading || aLoading || wLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-80 text-slate-400 gap-3">
        <Loader2 size={24} className="animate-spin text-cyan-400" />
        <span className="text-xs font-bold uppercase tracking-wider">Loading Customer Profile...</span>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex flex-col items-center justify-center h-80 text-slate-400 gap-3">
        <User size={32} className="opacity-30" />
        <span className="text-sm font-bold text-slate-300">Customer profile not found</span>
        <NavLink to="/customers" className="btn btn-secondary text-xs">Back to Customer Directory</NavLink>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-5 pb-6">
      {/* HEADER SECTION */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between shrink-0">
        <div className="flex items-center gap-4">
          <NavLink
            to="/customers"
            className="w-10 h-10 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-cyan-500/40 transition-all shadow-sm"
          >
            <ArrowLeft size={18} />
          </NavLink>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">{customer.name}</h1>
              <Badge tone={stats.tierTone} className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 shadow-sm">
                {stats.tierLabel}
              </Badge>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-2">
              <span>Customer ID: <strong className="text-slate-700 dark:text-slate-300 font-mono">#{customer.id}</strong></span>
              <span>•</span>
              <span>Client since {new Date(customer.created_at).toLocaleDateString()}</span>
            </p>
          </div>
        </div>

        {/* 1-CLICK ACTION HUB */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => navigate(`/pos?customer_id=${customer.id}`)}
            className="px-3.5 py-2 rounded-xl text-xs font-black bg-cyan-600 hover:bg-cyan-500 text-white transition-all flex items-center gap-1.5 shadow-lg shadow-cyan-950/40 cursor-pointer"
          >
            <ShoppingCart size={14} /> + New POS Sale
          </button>
          <button
            onClick={() => navigate(`/repairs?customer_id=${customer.id}`)}
            className="px-3.5 py-2 rounded-xl text-xs font-black bg-amber-600 hover:bg-amber-500 text-white transition-all flex items-center gap-1.5 shadow-lg shadow-amber-950/40 cursor-pointer"
          >
            <Wrench size={14} /> + New Repair
          </button>
          <button
            onClick={() => setShowWaModal(true)}
            className="px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <MessageSquare size={14} /> WhatsApp
          </button>
          <button
            onClick={startEdit}
            className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-white/10 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Edit2 size={13} /> Edit
          </button>
          <button
            onClick={deleteProfile}
            className="px-3 py-2 rounded-xl text-xs font-bold bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 h-full min-h-0">
        {/* LEFT PROFILE & CRM PANEL */}
        <div className="col-span-12 lg:col-span-4 xl:col-span-3 flex flex-col gap-4">
          {/* Identity Card */}
          <div className="bg-white dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-white/10 rounded-3xl p-6 shadow-2xl flex flex-col items-center shrink-0 relative overflow-hidden">
            <div className="w-20 h-20 rounded-2xl bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 flex items-center justify-center font-black text-3xl uppercase border-2 border-cyan-500/30 mb-3 shadow-[0_0_25px_rgba(6,182,212,0.2)]">
              {customer.name ? customer.name.charAt(0) : "C"}
            </div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white text-center">{customer.name}</h2>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[10px] text-cyan-600 dark:text-cyan-300 font-extrabold uppercase tracking-widest">
                LTV: LKR {stats.totalSpent.toLocaleString()}
              </span>
            </div>

            {/* Quick Metrics Grid */}
            <div className="w-full grid grid-cols-2 gap-2 mt-5 p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-white/5 text-center">
              <div className="p-2 border-r border-slate-200 dark:border-white/5">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 block">Avg Order</span>
                <span className="text-xs font-black text-slate-900 dark:text-white font-mono mt-0.5 block">LKR {stats.aov.toLocaleString()}</span>
              </div>
              <div className="p-2">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 block">Total Orders</span>
                <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 font-mono mt-0.5 block">{stats.salesCount}</span>
              </div>
            </div>

            {/* Loyalty Points Balance */}
            <div className="w-full mt-3 p-3 rounded-2xl bg-purple-500/10 dark:bg-purple-950/40 border border-purple-500/25 flex items-center justify-between">
              <div>
                <span className="text-[9px] font-extrabold uppercase tracking-wider text-purple-700 dark:text-purple-300 block">Loyalty Points</span>
                <span className="text-[10px] text-purple-600 dark:text-purple-400">1 PT per LKR 1,000</span>
              </div>
              <span className="font-mono font-black text-base text-purple-700 dark:text-purple-300">
                {stats.loyaltyPoints.toLocaleString()} PTS
              </span>
            </div>

            {/* Contact Details List */}
            <div className="w-full mt-4 space-y-2 text-xs border-t border-slate-200 dark:border-white/5 pt-4">
              <div className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
                <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400"><Phone size={12} /> Phone</span>
                <a href={`tel:${customer.phone}`} className="font-mono font-bold hover:text-cyan-600 dark:hover:text-cyan-300 transition text-slate-800 dark:text-slate-200">
                  {customer.phone || "No phone"}
                </a>
              </div>
              <div className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
                <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400"><Mail size={12} /> Email</span>
                <span className="truncate max-w-[150px] font-medium text-slate-800 dark:text-slate-200" title={customer.email}>
                  {customer.email || "No email"}
                </span>
              </div>
              {customer.address && (
                <div className="flex items-start justify-between gap-2 text-slate-600 dark:text-slate-300 pt-1">
                  <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 shrink-0"><MapPin size={12} /> Address</span>
                  <span className="text-right text-[11px] text-slate-800 dark:text-slate-200 font-medium">
                    {customer.address}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Outstanding Balance Banner */}
          {stats.outstandingDebt > 0 ? (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between shadow-lg shadow-rose-950/20">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-rose-500/20 text-rose-600 dark:text-rose-400">
                  <AlertCircle size={20} />
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400 block">Outstanding Debt</span>
                  <span className="font-mono font-black text-lg text-rose-700 dark:text-rose-200">LKR {stats.outstandingDebt.toLocaleString()}</span>
                </div>
              </div>
              <button
                onClick={() => navigate(`/pos?mode=repair`)}
                className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-black shrink-0 transition shadow-sm cursor-pointer"
              >
                Settle in POS
              </button>
            </div>
          ) : (
            <KpiCard tone="emerald" title="Outstanding Balance" value="LKR 0" hint="All repairs settled" icon={<ShieldCheck size={18} />} />
          )}

          {stats.unappliedAdvance > 0 && (
            <KpiCard tone="amber" title="Unapplied Advances" value={`LKR ${stats.unappliedAdvance.toLocaleString()}`} hint="Customer credit available" icon={<DollarSign size={18} />} />
          )}

          {/* Internal Staff Notes Card */}
          <div className="bg-white dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-white/10 rounded-2xl p-4 shadow-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <FileText size={12} className="text-cyan-600 dark:text-cyan-400" /> Internal Staff Notes
              </span>
              <button
                onClick={handleSaveNotes}
                disabled={savingNotes}
                className="text-[10px] font-black text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300 flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                {savingNotes ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save
              </button>
            </div>
            <textarea
              rows={3}
              value={staffNotes}
              onChange={(e) => setStaffNotes(e.target.value)}
              placeholder="Add staff notes (e.g. VIP discount, preferred spare part brands, device passwords)..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-xl p-2.5 text-xs text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 resize-none font-sans"
            />
          </div>
        </div>

        {/* RIGHT ACTIVITY & TIMELINE CENTER */}
        <div className="col-span-12 lg:col-span-8 xl:col-span-9 bg-white dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-white/10 rounded-3xl flex flex-col overflow-hidden shadow-2xl">
          {/* TAB HEADERS */}
          <div className="p-3.5 border-b border-slate-200 dark:border-white/5 flex flex-wrap gap-2 shrink-0 bg-slate-50 dark:bg-black/40">
            <button
              onClick={() => setActiveTab("sales")}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 border ${
                activeTab === "sales"
                  ? "bg-cyan-600 border-cyan-500/50 text-white shadow-[0_0_20px_rgba(6,182,212,0.3)]"
                  : "bg-white/5 border-transparent text-slate-400 hover:text-white hover:bg-white/10"
              }`}
            >
              <ShoppingCart size={14} /> Purchase History ({stats.salesCount})
            </button>

            <button
              onClick={() => setActiveTab("repairs")}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 border ${
                activeTab === "repairs"
                  ? "bg-amber-600 border-amber-500/50 text-white shadow-[0_0_20px_rgba(245,158,11,0.3)]"
                  : "bg-white/5 border-transparent text-slate-400 hover:text-white hover:bg-white/10"
              }`}
            >
              <Wrench size={14} /> Repair History ({stats.repairsCount})
            </button>

            <button
              onClick={() => setActiveTab("warranties")}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 border ${
                activeTab === "warranties"
                  ? "bg-indigo-600 border-indigo-500/50 text-white shadow-[0_0_20px_rgba(99,102,241,0.3)]"
                  : "bg-white/5 border-transparent text-slate-400 hover:text-white hover:bg-white/10"
              }`}
            >
              <ShieldCheck size={14} /> Active Warranties ({stats.warrantiesCount})
            </button>

            <button
              onClick={() => setActiveTab("advances")}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 border ${
                activeTab === "advances"
                  ? "bg-purple-600 border-purple-500/50 text-white shadow-[0_0_20px_rgba(168,85,247,0.3)]"
                  : "bg-white/5 border-transparent text-slate-400 hover:text-white hover:bg-white/10"
              }`}
            >
              <DollarSign size={14} /> Advances ({stats.advancesCount})
            </button>

            <button
              onClick={() => setActiveTab("whatsapp")}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 border ${
                activeTab === "whatsapp"
                  ? "bg-emerald-600 border-emerald-500/50 text-white shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                  : "bg-white/5 border-transparent text-slate-400 hover:text-white hover:bg-white/10"
              }`}
            >
              <MessageSquare size={14} /> WhatsApp ({waLogs.length})
            </button>
          </div>

          {/* TAB PANELS */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-0">
            {/* 1. PURCHASE HISTORY TAB */}
            {activeTab === "sales" && (
              <div className="p-0">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Invoice Ref</th>
                      <th>Date & Cashier</th>
                      <th>Purchased Items</th>
                      <th>Payment</th>
                      <th className="text-right">Total</th>
                      <th className="text-center">Receipt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerSales.map((s) => (
                      <tr key={s.id} className="hover:bg-white/[0.02] transition-colors">
                        <td>
                          <span className="font-mono font-black text-cyan-400 text-xs">
                            {s.invoice_no || `INV-${String(s.id).padStart(6, "0")}`}
                          </span>
                          <span className="block text-[10px] text-slate-500">Order #{s.id}</span>
                        </td>
                        <td>
                          <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium">
                            <Clock size={12} className="text-slate-500" /> {new Date(s.created_at).toLocaleString()}
                          </div>
                          <span className="text-[10px] text-slate-500 block">Served by: {s.cashier_name || "Store Staff"}</span>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1 max-w-[280px]">
                            {Array.isArray(s.items) && s.items.length > 0 ? (
                              s.items.map((it, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-950 border border-white/10 text-[10px] font-bold text-slate-200"
                                >
                                  {it.name} <strong className="text-cyan-400">×{it.quantity}</strong>
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-slate-500 italic">Direct counter sale</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <Badge tone={s.is_return ? "red" : s.is_voided ? "amber" : "green"} className="text-[10px] uppercase font-black">
                            {s.is_voided ? "Voided" : s.is_return ? "Refunded" : s.payment_method || "Cash"}
                          </Badge>
                        </td>
                        <td className="text-right">
                          <span className="font-black text-slate-100 font-mono text-sm">
                            LKR {Number(s.total || 0).toLocaleString()}
                          </span>
                        </td>
                        <td className="text-center">
                          <button
                            onClick={() => openPrintCenter(navigate, { type: "sales_receipt", ref: s.id, paper: "thermal_80" })}
                            className="p-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 transition-all cursor-pointer inline-flex items-center gap-1 text-[11px] font-bold"
                            title="Reprint Thermal Receipt"
                          >
                            <Printer size={12} /> Print
                          </button>
                        </td>
                      </tr>
                    ))}
                    {customerSales.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-16 text-center text-slate-500 font-bold">
                          <ShoppingBag size={32} className="mx-auto mb-3 opacity-30 text-cyan-400" />
                          No purchase history recorded for this customer yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* 2. REPAIR HISTORY TAB */}
            {activeTab === "repairs" && (
              <div className="p-0">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ticket ID</th>
                      <th>Device & Issue</th>
                      <th>Technician</th>
                      <th>Timeline</th>
                      <th className="text-center">Status</th>
                      <th className="text-right">Estimated / Balance</th>
                      <th className="text-center">Job Card</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerRepairs.map((r) => {
                      const balance = Math.max(0, Number(r.estimated_cost || 0) - Number(r.advance_payment || 0));
                      return (
                        <tr key={r.id} className="hover:bg-white/[0.02] transition-colors">
                          <td>
                            <span className="font-mono font-black text-amber-400 text-xs">
                              #{r.ticket_no || `JOB-${r.id}`}
                            </span>
                          </td>
                          <td>
                            <div className="font-bold text-slate-200 text-sm">{r.device_model}</div>
                            <div className="text-[11px] text-slate-400 truncate max-w-[240px]">{r.issue || "General Repair"}</div>
                          </td>
                          <td>
                            <span className="text-xs text-slate-300 font-medium">{r.technician || "Unassigned"}</span>
                          </td>
                          <td>
                            <div className="flex items-center gap-1 text-xs text-slate-400">
                              <Calendar size={11} className="text-slate-500" /> {new Date(r.created_at).toLocaleDateString()}
                            </div>
                          </td>
                          <td className="text-center">
                            <Badge tone={isRepairDelivered(r.status) ? "green" : isRepairCancelled(r.status) ? "red" : "amber"} className="text-[10px] font-black uppercase">
                              {repairStatusLabel(r.status)}
                            </Badge>
                          </td>
                          <td className="text-right">
                            <div className="font-black text-slate-200 text-sm font-mono">
                              LKR {Number(r.estimated_cost || 0).toLocaleString()}
                            </div>
                            {balance > 0 ? (
                              <span className="text-[10px] font-extrabold text-rose-400 font-mono block">
                                Due: LKR {balance.toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-emerald-400 block">Fully Paid</span>
                            )}
                          </td>
                          <td className="text-center">
                            <button
                              onClick={() => openPrintCenter(navigate, { type: "job_card", ref: r.id, paper: "thermal_80" })}
                              className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 transition-all cursor-pointer inline-flex items-center gap-1 text-[11px] font-bold"
                              title="Print Thermal Job Card"
                            >
                              <Printer size={12} /> Job Card
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {customerRepairs.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-16 text-center text-slate-500 font-bold">
                          <Wrench size={32} className="mx-auto mb-3 opacity-30 text-amber-400" />
                          No repair tickets on record for this customer.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* 3. ACTIVE WARRANTIES TAB */}
            {activeTab === "warranties" && (
              <div className="p-0">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Warranty Certificate</th>
                      <th>Product / Service</th>
                      <th>IMEI / Serial</th>
                      <th>Duration</th>
                      <th>Remaining</th>
                      <th className="text-center">Status</th>
                      <th className="text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerWarranties.map((w) => {
                      const isActive = String(w.status || "").toLowerCase() === "active" && w.remaining_days > 0;
                      return (
                        <tr key={w.id} className="hover:bg-white/[0.02] transition-colors">
                          <td>
                            <span className="font-mono font-black text-indigo-400 text-xs">
                              {w.warranty_code || `WAR-${String(w.id).padStart(5, "0")}`}
                            </span>
                          </td>
                          <td>
                            <div className="font-bold text-slate-200 text-sm">{w.product_or_service_name}</div>
                            <span className="text-[10px] text-slate-500 uppercase">{w.warranty_type} warranty</span>
                          </td>
                          <td>
                            <span className="font-mono text-xs text-slate-300 font-bold">{w.imei_or_serial || "—"}</span>
                          </td>
                          <td>
                            <span className="text-xs text-slate-300 font-bold">{w.warranty_days} Days</span>
                            {w.end_date && (
                              <span className="block text-[10px] text-slate-500">Exp: {new Date(w.end_date).toLocaleDateString()}</span>
                            )}
                          </td>
                          <td>
                            {isActive ? (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[10px] font-extrabold">
                                🟢 {w.remaining_days} days left
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md bg-rose-500/20 border border-rose-500/30 text-rose-300 text-[10px] font-extrabold">
                                🔴 Expired
                              </span>
                            )}
                          </td>
                          <td className="text-center">
                            <Badge tone={isActive ? "green" : "red"} className="text-[10px] font-black uppercase">
                              {w.status || (isActive ? "Active" : "Expired")}
                            </Badge>
                          </td>
                          <td className="text-center">
                            <button
                              onClick={() => openPrintCenter(navigate, { type: "warranty", ref: w.id, paper: "thermal_80" })}
                              className="p-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 transition-all cursor-pointer inline-flex items-center gap-1 text-[11px] font-bold"
                              title="Print Warranty Certificate"
                            >
                              <Printer size={12} /> Certificate
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {customerWarranties.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-16 text-center text-slate-500 font-bold">
                          <ShieldCheck size={32} className="mx-auto mb-3 opacity-30 text-indigo-400" />
                          No warranty records found for this customer.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* 4. ADVANCES TAB */}
            {activeTab === "advances" && (
              <div className="p-0">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Advance Ref</th>
                      <th>Type</th>
                      <th>Paid Amount</th>
                      <th>Remaining</th>
                      <th className="text-center">Status</th>
                      <th className="text-center">Print</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerAdvances.map((a) => (
                      <tr key={a.id} className="hover:bg-white/[0.02] transition-colors">
                        <td>
                          <span className="font-mono font-black text-purple-400 text-xs">{a.advance_number}</span>
                        </td>
                        <td>
                          <span className="text-xs font-bold text-slate-300 capitalize">
                            {String(a.advance_type || "").replaceAll("_", " ")}
                          </span>
                        </td>
                        <td>
                          <span className="font-mono font-black text-slate-200 text-sm">
                            LKR {Number(a.amount || 0).toLocaleString()}
                          </span>
                        </td>
                        <td>
                          <span className="font-mono font-black text-amber-300 text-sm">
                            LKR {Number(a.remaining_amount || 0).toLocaleString()}
                          </span>
                        </td>
                        <td className="text-center">
                          <Badge
                            tone={["cancelled", "refunded"].includes(String(a.status || "").toLowerCase()) ? "red" : Number(a.remaining_amount || 0) <= 0 ? "green" : "amber"}
                            className="text-[10px] font-black uppercase"
                          >
                            {a.status}
                          </Badge>
                        </td>
                        <td className="text-center">
                          <button
                            onClick={() => openPrintCenter(navigate, { type: "advance", ref: a.id, paper: "thermal_80" })}
                            className="p-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 transition-all cursor-pointer inline-flex items-center gap-1 text-[11px] font-bold"
                            title="Print Advance Receipt"
                          >
                            <Printer size={12} /> Receipt
                          </button>
                        </td>
                      </tr>
                    ))}
                    {customerAdvances.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-16 text-center text-slate-500 font-bold">
                          <DollarSign size={32} className="mx-auto mb-3 opacity-30 text-purple-400" />
                          No advance payment records for this customer.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* 5. WHATSAPP HISTORY TAB */}
            {activeTab === "whatsapp" && (
              <div className="p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-emerald-950/20 border border-emerald-500/20">
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-emerald-300 flex items-center gap-2">
                      <MessageSquare size={14} /> Automated & Direct Communication Logs
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Receipt dispatches, repair milestone alerts, and custom customer chat records.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowWaModal(true)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black px-4 py-2 rounded-xl flex items-center gap-1.5 transition shadow-lg shadow-emerald-950/40 cursor-pointer"
                  >
                    <Send size={13} /> Send WhatsApp Message
                  </button>
                </div>

                {waLoading ? (
                  <div className="py-12 text-center text-slate-400 flex items-center justify-center gap-2 text-xs">
                    <Loader2 size={16} className="animate-spin text-emerald-400" /> Loading message audit history...
                  </div>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Event Type</th>
                        <th>Message Preview</th>
                        <th className="text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {waLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="font-mono text-xs text-slate-400 whitespace-nowrap">
                            {formatDateTime(log.created_at)}
                          </td>
                          <td className="whitespace-nowrap">
                            <span className="font-bold text-white text-xs block">{log.template_name || log.event_type}</span>
                            {log.invoice_no && <span className="text-[10px] font-mono text-cyan-400 block">{log.invoice_no}</span>}
                            {log.repair_no && <span className="text-[10px] font-mono text-amber-400 block">{log.repair_no}</span>}
                          </td>
                          <td className="text-xs text-slate-300 max-w-sm truncate font-sans">
                            {log.message_body}
                          </td>
                          <td className="text-center whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded-md font-extrabold text-[10px] uppercase border ${
                              log.status === "READ"
                                ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/30"
                                : log.status === "DELIVERED"
                                ? "bg-blue-500/20 text-blue-300 border-blue-500/30"
                                : log.status === "SENT"
                                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                                : log.status === "FAILED"
                                ? "bg-rose-500/20 text-rose-300 border-rose-500/30"
                                : "bg-amber-500/20 text-amber-300 border-amber-500/30"
                            }`}>
                              {log.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {waLogs.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-16 text-center text-slate-500 font-bold">
                            <MessageSquare size={32} className="mx-auto mb-3 opacity-30 text-emerald-400" />
                            No WhatsApp message logs found for this customer.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* EDIT PROFILE MODAL */}
      <AppModal
        open={isEditing}
        onClose={() => setIsEditing(false)}
        title="Edit Customer Profile"
        panelClassName="max-w-lg bg-[#0f172a]"
        headerActions={
          <button onClick={() => setIsEditing(false)} className="text-slate-400 hover:text-white transition-colors cursor-pointer"><X size={20}/></button>
        }
      >
        <div className="p-6 space-y-4">
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">Full Name</label>
            <input
              className="field"
              value={editForm?.name || ""}
              onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">Phone Number</label>
            <input
              className="field"
              value={editForm?.phone || ""}
              onChange={(e) => setEditForm((prev) => ({ ...prev, phone: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">Email Address</label>
            <input
              type="email"
              className="field"
              value={editForm?.email || ""}
              onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">Physical Address</label>
            <input
              className="field"
              value={editForm?.address || ""}
              onChange={(e) => setEditForm((prev) => ({ ...prev, address: e.target.value }))}
            />
          </div>
        </div>
        <div className="p-6 border-t border-white/5 bg-white/[0.02] flex gap-3">
          <button onClick={() => setIsEditing(false)} className="btn btn-ghost flex-1">Cancel</button>
          <button onClick={saveEdit} className="btn btn-primary flex-1 font-bold">Save Changes</button>
        </div>
      </AppModal>

      {/* DIRECT WHATSAPP COMPOSER MODAL */}
      <AppModal
        isOpen={showWaModal}
        onClose={() => setShowWaModal(false)}
        title={`Send WhatsApp to ${customer.name}`}
        panelClassName="max-w-lg bg-[#0f172a]"
        headerActions={
          <button onClick={() => setShowWaModal(false)} className="text-slate-400 hover:text-white transition-colors cursor-pointer"><X size={20}/></button>
        }
      >
        <form onSubmit={handleSendDirectWa}>
          <div className="p-6 space-y-4">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">Recipient Mobile</label>
              <div className="bg-slate-950 border border-white/10 rounded-xl p-3 text-xs font-mono text-emerald-400">
                +{customer.whatsapp_number || customer.phone}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">Message Body</label>
              <textarea
                rows={5}
                required
                value={waMsgText}
                onChange={(e) => setWaMsgText(e.target.value)}
                placeholder="Type personalized message to customer..."
                className="w-full bg-slate-950 border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-emerald-500 leading-relaxed font-sans"
              />
            </div>
          </div>
          <div className="p-6 border-t border-white/5 bg-white/[0.02] flex gap-3">
            <button type="button" onClick={() => setShowWaModal(false)} className="btn btn-ghost flex-1">Cancel</button>
            <button
              type="submit"
              disabled={sendingWa || !waMsgText.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 flex-1 transition shadow-lg shadow-emerald-950/40 cursor-pointer disabled:opacity-50"
            >
              {sendingWa ? <><Loader2 size={14} className="animate-spin" /> Dispatching...</> : <><Send size={14} /> Send WhatsApp</>}
            </button>
          </div>
        </form>
      </AppModal>
    </div>
  );
}
