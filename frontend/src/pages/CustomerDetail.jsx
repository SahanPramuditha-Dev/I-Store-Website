import { useParams, NavLink, useNavigate } from "react-router-dom";
import { useFetch } from "../hooks/useFetch";
import { Badge, KpiCard } from "../components/UI";
import { ShoppingBag, Wrench, Phone, Mail, MapPin, Calendar, AlertTriangle, ArrowLeft, Clock, ShoppingCart, Edit2, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import api from "../lib/api";
import { useFeedback } from "../components/FeedbackProvider";
import { isRepairCancelled, isRepairDelivered, repairStatusLabel } from "../lib/repairStatus";
import AppModal from "../components/layout/AppModal";

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, confirm } = useFeedback();

  const { data: customer, setData: setCustomer, loading: cLoading } = useFetch(`/customers/${id}`);
  const { data: sales, loading: sLoading } = useFetch(`/customers/${id}/sales`);
  const { data: repairs, loading: rLoading } = useFetch(`/customers/${id}/repairs`);
  const { data: advances, loading: aLoading } = useFetch(`/customers/${id}/advances`);

  const [activeTab, setActiveTab] = useState("repairs");
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);

  const customerSales = useMemo(() => sales || [], [sales]);

  const customerRepairs = useMemo(() => repairs || [], [repairs]);
  const customerAdvances = useMemo(() => advances || [], [advances]);

  const stats = useMemo(() => {
    const totalSpent = customerSales
      .filter((s) => !s.is_voided && !s.is_return)
      .reduce((sum, s) => sum + (s.total || 0), 0);
    const pendingPayments = customerRepairs
      .filter((r) => !isRepairDelivered(r.status) && !isRepairCancelled(r.status))
      .reduce((sum, r) => sum + Math.max(0, (r.estimated_cost || 0) - (r.advance_payment || 0)), 0);
    return {
      totalSpent,
      pendingPayments,
      unappliedAdvance: customerAdvances.reduce((sum, row) => sum + Number(row.remaining_amount || 0), 0),
      salesCount: customerSales.length,
      repairsCount: customerRepairs.length,
      advancesCount: customerAdvances.length,
    };
  }, [customerSales, customerRepairs, customerAdvances]);

  const startEdit = () => {
    setEditForm({
      name: customer.name,
      phone: customer.phone,
      email: customer.email || "",
      address: customer.address || ""
    });
    setIsEditing(true);
  };

  const saveEdit = async () => {
    if (!editForm.name || !editForm.phone) return toast("Name and phone are required", "warning");
    try {
      const { data } = await api.put(`/customers/${id}`, editForm);
      setCustomer(data);
      setIsEditing(false);
      toast("Customer profile updated", "success");
    } catch(err) {
      toast("Failed to update profile", "error");
    }
  };

  const deleteProfile = async () => {
    const ok = await confirm("Delete Customer", "Are you sure? This cannot be undone.");
    if (!ok) return;
    try {
      await api.delete(`/customers/${id}`);
      toast("Customer deleted", "success");
      navigate("/customers");
    } catch(err) {
      toast("Failed to delete customer", "error");
    }
  };

  if (cLoading || sLoading || rLoading || aLoading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading Customer Profile...</div>;
  if (!customer) return <div className="flex items-center justify-center h-64 text-slate-400">Customer not found</div>;

  return (
    <div className="flex flex-col h-full gap-4 pb-4">
      {/* HEADER SECTION */}
      <div className="flex justify-between items-center shrink-0">
        <div className="flex items-center gap-4">
          <NavLink to="/customers" className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
            <ArrowLeft size={18} />
          </NavLink>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-3">
              {customer.name}
              {stats.totalSpent > 100000 && <Badge tone="amber" className="text-[10px]">VIP Customer</Badge>}
            </h1>
            <p className="text-xs text-slate-400 mt-1">Customer since {new Date(customer.created_at).toLocaleDateString()}</p>
          </div>
        </div>
        <div className="flex gap-2">
           <button onClick={startEdit} className="px-4 py-2 rounded-xl text-xs font-bold bg-white/5 hover:bg-white/10 text-white transition-colors flex items-center gap-2 border border-white/10">
             <Edit2 size={14}/> Edit Profile
           </button>
           <button onClick={deleteProfile} className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors flex items-center gap-2 border border-rose-500/20">
             <Trash2 size={14}/> Delete
           </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 h-full min-h-0">
        {/* LEFT PROFILE PANEL */}
        <div className="col-span-12 lg:col-span-3 flex flex-col gap-6">
          <div className="bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-3xl p-6 shadow-2xl flex flex-col items-center shrink-0">
             <div className="w-24 h-24 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-black text-4xl uppercase border-4 border-indigo-500/20 mb-4 shadow-lg">
               {customer.name.charAt(0)}
             </div>
             <h2 className="text-lg font-black text-white text-center">{customer.name}</h2>
             <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest font-bold">Lifetime Value: LKR {stats.totalSpent.toLocaleString()}</p>
             
             <div className="w-full mt-6 space-y-4">
               <div className="flex items-center gap-3 p-4 rounded-2xl bg-black/20 border border-white/5 hover:bg-black/40 transition-colors">
                 <div className="text-sky-400 shrink-0"><Phone size={16} /></div>
                 <div className="min-w-0">
                   <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Phone Number</p>
                   <p className="text-sm text-slate-200 font-bold truncate">{customer.phone}</p>
                 </div>
               </div>
               <div className="flex items-center gap-3 p-4 rounded-2xl bg-black/20 border border-white/5 hover:bg-black/40 transition-colors">
                 <div className="text-violet-400 shrink-0"><Mail size={16} /></div>
                 <div className="min-w-0">
                   <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Email Address</p>
                   <p className="text-sm text-slate-200 font-bold truncate">{customer.email || "-"}</p>
                 </div>
               </div>
               <div className="flex items-center gap-3 p-4 rounded-2xl bg-black/20 border border-white/5 hover:bg-black/40 transition-colors">
                 <div className="text-emerald-400 shrink-0"><MapPin size={16} /></div>
                 <div className="min-w-0">
                   <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Physical Address</p>
                   <p className="text-sm text-slate-200 font-bold truncate">{customer.address || "-"}</p>
                 </div>
               </div>
             </div>
          </div>
          
          <KpiCard tone="rose" title="Unpaid Due" value={`LKR ${stats.pendingPayments.toLocaleString()}`} hint="From active repairs" icon={<AlertTriangle size={18} />} />
          <KpiCard tone="amber" title="Unapplied Advances" value={`LKR ${stats.unappliedAdvance.toLocaleString()}`} hint="Customer credit pending use" icon={<DollarSign size={18} />} />
        </div>

        {/* RIGHT ACTIVITY PANEL */}
        <div className="col-span-12 lg:col-span-9 bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-3xl flex flex-col overflow-hidden shadow-2xl">
          <div className="p-5 border-b border-white/5 flex gap-3 shrink-0 bg-black/20">
             <button 
               onClick={() => setActiveTab("repairs")}
               className={`px-6 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border border-transparent ${activeTab === "repairs" ? "bg-indigo-600 border-indigo-500/50 text-white shadow-[0_0_20px_rgba(79,70,229,0.3)]" : "bg-white/5 text-slate-400 hover:text-white"}`}
             >
               <Wrench size={14}/> Repair History ({stats.repairsCount})
             </button>
             <button 
               onClick={() => setActiveTab("sales")}
               className={`px-6 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border border-transparent ${activeTab === "sales" ? "bg-indigo-600 border-indigo-500/50 text-white shadow-[0_0_20px_rgba(79,70,229,0.3)]" : "bg-white/5 text-slate-400 hover:text-white"}`}
             >
               <ShoppingCart size={14}/> Purchase History ({stats.salesCount})
             </button>
             <button 
               onClick={() => setActiveTab("advances")}
               className={`px-6 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border border-transparent ${activeTab === "advances" ? "bg-indigo-600 border-indigo-500/50 text-white shadow-[0_0_20px_rgba(79,70,229,0.3)]" : "bg-white/5 text-slate-400 hover:text-white"}`}
             >
               <DollarSign size={14}/> Advances ({stats.advancesCount})
             </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-0">
             {activeTab === "repairs" && (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ticket ID</th>
                      <th>Device & Issue</th>
                      <th>Timeline</th>
                      <th className="text-center">Status</th>
                      <th className="text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerRepairs.map(r => (
                      <tr key={r.id}>
                        <td className="font-black text-amber-400">#{r.ticket_no}</td>
                        <td>
                           <div className="font-bold text-slate-200 text-sm">{r.device_model}</div>
                           <div className="text-[11px] text-slate-500 truncate max-w-[250px]">{r.issue}</div>
                        </td>
                        <td>
                           <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium"><Calendar size={12} className="text-slate-500"/> {new Date(r.created_at).toLocaleDateString()}</div>
                        </td>
                        <td className="text-center">
                          <Badge tone={isRepairDelivered(r.status) ? "green" : isRepairCancelled(r.status) ? "red" : "amber"}>
                            {repairStatusLabel(r.status)}
                          </Badge>
                        </td>
                        <td className="text-right">
                           <div className="font-black text-slate-200 text-sm">LKR {r.estimated_cost.toLocaleString()}</div>
                           {r.advance_payment > 0 && <div className="text-[10px] font-bold text-emerald-500">Paid: LKR {r.advance_payment.toLocaleString()}</div>}
                        </td>
                      </tr>
                    ))}
                    {customerRepairs.length === 0 && (
                      <tr><td colSpan={5} className="py-16 text-center text-slate-500 font-bold"><Wrench size={32} className="mx-auto mb-3 opacity-30"/>No repairs recorded.</td></tr>
                    )}
                  </tbody>
                </table>
             )}

             {activeTab === "sales" && (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Invoice Ref</th>
                      <th>Date / Time</th>
                      <th>Total Value</th>
                      <th className="text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerSales.map(s => (
                      <tr key={s.id}>
                        <td className="font-black text-sky-400">{s.invoice_no}</td>
                        <td>
                           <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium"><Clock size={12} className="text-slate-500"/> {new Date(s.created_at).toLocaleString()}</div>
                        </td>
                        <td>
                           <div className="font-black text-slate-200 text-sm">LKR {s.total.toLocaleString()}</div>
                        </td>
                        <td className="text-center">
                          <Badge tone={s.is_return ? "red" : s.is_voided ? "amber" : "green"}>
                            {s.is_voided ? "Voided" : s.is_return ? "Refunded" : "Completed"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                    {customerSales.length === 0 && (
                      <tr><td colSpan={4} className="py-16 text-center text-slate-500 font-bold"><ShoppingBag size={32} className="mx-auto mb-3 opacity-30"/>No purchases recorded.</td></tr>
                    )}
                  </tbody>
                </table>
             )}

             {activeTab === "advances" && (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Advance Ref</th>
                      <th>Type</th>
                      <th>Paid</th>
                      <th>Remaining</th>
                      <th className="text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerAdvances.map((a) => (
                      <tr key={a.id}>
                        <td className="font-black text-emerald-300">{a.advance_number}</td>
                        <td>{String(a.advance_type || "").replaceAll("_", " ")}</td>
                        <td>LKR {Number(a.amount || 0).toLocaleString()}</td>
                        <td className="font-bold text-amber-300">LKR {Number(a.remaining_amount || 0).toLocaleString()}</td>
                        <td className="text-center"><Badge tone={["cancelled", "refunded"].includes(String(a.status || "").toLowerCase()) ? "red" : Number(a.remaining_amount || 0) <= 0 ? "green" : "amber"}>{a.status}</Badge></td>
                      </tr>
                    ))}
                    {customerAdvances.length === 0 && (
                      <tr><td colSpan={5} className="py-16 text-center text-slate-500 font-bold"><DollarSign size={32} className="mx-auto mb-3 opacity-30"/>No advances recorded.</td></tr>
                    )}
                  </tbody>
                </table>
             )}
          </div>
        </div>
      </div>

      {/* EDIT MODAL */}
      <AppModal
        open={isEditing}
        onClose={() => setIsEditing(false)}
        title="Edit Profile"
        panelClassName="max-w-lg bg-[#0f172a]"
        headerActions={
          <button onClick={() => setIsEditing(false)} className="text-slate-400 hover:text-white transition-colors"><X size={20}/></button>
        }
      >
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Full Name</label>
                <input className="field" value={editForm.name} onChange={e=>setEditForm({...editForm,name:e.target.value})}/>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Phone Number</label>
                <input className="field" value={editForm.phone} onChange={e=>setEditForm({...editForm,phone:e.target.value})}/>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Email Address</label>
                <input type="email" className="field" value={editForm.email} onChange={e=>setEditForm({...editForm,email:e.target.value})}/>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Physical Address</label>
                <input className="field" value={editForm.address} onChange={e=>setEditForm({...editForm,address:e.target.value})}/>
              </div>
            </div>
            <div className="p-6 border-t border-white/5 bg-white/[0.02] flex gap-3">
              <button onClick={() => setIsEditing(false)} className="btn btn-ghost flex-1">Cancel</button>
              <button onClick={saveEdit} className="btn btn-primary flex-1">Save Changes</button>
            </div>
      </AppModal>

    </div>
  );
}
