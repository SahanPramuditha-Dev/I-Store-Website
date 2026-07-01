import { Badge } from "../components/UI";
import { Phone, Wrench, CheckCircle2, PackagePlus, ClipboardPlus } from "lucide-react";

const COLUMNS = [
  { key: "pending", label: "Pending" },
  { key: "diagnosing", label: "Diagnosing" },
  { key: "waiting_for_approval", label: "Waiting for Approval" },
  { key: "waiting_for_parts", label: "Waiting for Parts" },
  { key: "repairing", label: "Repairing" },
  { key: "quality_checking", label: "Quality Checking" },
  { key: "completed", label: "Completed" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
];

function normalizeStatus(value) {
  const text = String(value || "").trim().toLowerCase();
  const aliases = {
    "waiting for approval": "waiting_for_approval",
    "waiting for parts": "waiting_for_parts",
    "quality checking": "quality_checking",
  };
  return aliases[text] || text;
}

function priorityTone(priority) {
  if (priority === "Urgent") return "red";
  if (priority === "High") return "amber";
  if (priority === "Low") return "sky";
  return "slate";
}

function statusAccent(status) {
  const normalized = normalizeStatus(status);
  if (normalized === "completed") return "text-emerald-400";
  if (normalized === "repairing") return "text-sky-400";
  if (normalized === "waiting_for_parts") return "text-amber-400";
  if (normalized === "pending") return "text-indigo-300";
  if (normalized === "delivered") return "text-emerald-300";
  return "text-slate-400";
}

export default function RepairKanban({ repairs, onStatusChange, onViewDetails, onQuickAction }) {
  const getTasksByStatus = (status) => (repairs || []).filter((r) => normalizeStatus(r.status) === status);

  return (
    <div className="flex min-h-0 gap-3 overflow-x-auto pb-2 custom-scrollbar">
      {COLUMNS.map((column) => (
        <div key={column.key} className="w-[280px] xl:w-[300px] 2xl:w-[320px] shrink-0 flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 mb-3 bg-black/5 dark:bg-white/5 rounded-lg border border-black/5 dark:border-white/5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{column.label}</span>
            <Badge tone="sky" className="px-1.5 py-0.5">{getTasksByStatus(column.key).length}</Badge>
          </div>
          <div
            className="flex-1 space-y-3"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const id = Number(e.dataTransfer.getData("ticket_id"));
              if (!id) return;
              onStatusChange?.(id, column.key);
            }}
          >
            {getTasksByStatus(column.key).map((r) => (
              <div 
                key={r.id} 
                className="p-3 bg-white dark:bg-[#12182a] border border-black/5 dark:border-white/5 rounded-xl hover:border-indigo-500/50 transition cursor-pointer shadow-sm dark:shadow-lg group"
                onClick={() => onViewDetails(r)}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("ticket_id", String(r.id))}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="text-[10px] font-mono text-indigo-400 font-bold">{r.ticket_no}</span>
                  <Badge tone={priorityTone(r.priority)} className="text-[9px] px-2 py-0.5">
                    {(r.priority || "Normal").toUpperCase()}
                  </Badge>
                </div>
                <h4 className="font-bold text-sm text-white mb-1 group-hover:text-indigo-300 transition">{r.customer_name || "Walk-in Customer"}</h4>
                <p className="text-[11px] text-slate-400 mb-1">{r.customer_phone || "No phone"}</p>
                <p className="text-xs font-semibold text-slate-200 mb-1">{r.device_model}</p>
                <p className="text-[11px] text-slate-500 mb-2 line-clamp-2">{r.issue}</p>
                <div className="flex items-center justify-between mb-2">
                  <p className={`text-[10px] font-black uppercase tracking-wider ${statusAccent(r.status)}`}>{column.label}</p>
                  <p className="text-[10px] text-slate-500">IMEI: {(r.imei || "N/A").slice(0, 8)}</p>
                </div>
                
                <div className="flex items-center justify-between pt-2 border-t border-white/5">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center text-[10px] text-white font-bold">
                      {r.technician?.slice(0, 2).toUpperCase() || "??"}
                    </div>
                    <span className="text-[10px] text-slate-500 font-medium">{r.technician || "Unassigned"}</span>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-400">LKR {(r.estimated_cost || 0).toLocaleString()}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); onQuickAction?.("start", r); }}
                    className="h-7 rounded-md bg-white/5 hover:bg-sky-500/20 text-[10px] font-bold text-sky-200 inline-flex items-center justify-center gap-1"
                    title="Start Repair"
                  >
                    <Wrench size={11} /> Start
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onQuickAction?.("parts", r); }}
                    className="h-7 rounded-md bg-white/5 hover:bg-amber-500/20 text-[10px] font-bold text-amber-200 inline-flex items-center justify-center gap-1"
                    title="Add Parts"
                  >
                    <PackagePlus size={11} /> Parts
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onQuickAction?.("ready", r); }}
                    className="h-7 rounded-md bg-white/5 hover:bg-emerald-500/20 text-[10px] font-bold text-emerald-200 inline-flex items-center justify-center gap-1"
                    title="Mark Ready"
                  >
                    <CheckCircle2 size={11} /> Ready
                  </button>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); onQuickAction?.("note", r); }}
                    className="h-7 rounded-md bg-white/5 hover:bg-indigo-500/20 text-[10px] font-bold text-indigo-200 inline-flex items-center justify-center gap-1"
                    title="Add Notes"
                  >
                    <ClipboardPlus size={11} /> Note
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onQuickAction?.("call", r); }}
                    className="h-7 rounded-md bg-white/5 hover:bg-cyan-500/20 text-[10px] font-bold text-cyan-200 inline-flex items-center justify-center gap-1"
                    title="Call Customer"
                  >
                    <Phone size={11} /> Call
                  </button>
                </div>
              </div>
            ))}
            {getTasksByStatus(column.key).length === 0 && (
              <div className="h-32 border-2 border-dashed border-white/5 rounded-xl flex items-center justify-center text-slate-600 text-xs italic">
                Empty
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
