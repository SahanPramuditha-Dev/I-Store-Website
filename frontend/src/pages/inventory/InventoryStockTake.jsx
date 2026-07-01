import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../lib/api";
import { useFetch } from "../../hooks/useFetch";
import { downloadCsv, downloadPdf, paginateRows } from "../../lib/tableUtils";
import { AppCard, StickyTable } from "../../components/MuiPrimitives";
import { Select } from "../../components/UI";

export default function InventoryStockTake() {
  const navigate = useNavigate();
  const { data: items } = useFetch("/inventory");
  const { data, setData } = useFetch("/inventory/stock-takes");
  const sessions = data || [];

  const [sessionName, setSessionName] = useState("");
  const [activeSessionId, setActiveSessionId] = useState("");
  const [line, setLine] = useState({ item_id: "", physical_qty: 0 });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      const normalizedStatus = String(s.status || "").toLowerCase();
      const matchStatus = statusFilter === "all" || normalizedStatus === statusFilter;
      const matchQ = !q || String(s.name || "").toLowerCase().includes(q);
      return matchStatus && matchQ;
    });
  }, [sessions, query, statusFilter]);
  const { pageRows, totalPages } = paginateRows(filtered, page, 10);

  const createSession = async () => {
    if (!sessionName.trim()) return;
    const res = await api.post("/inventory/stock-takes", { name: sessionName.trim(), note: null });
    setData([res.data, ...sessions]);
    setActiveSessionId(String(res.data.id));
    setSessionName("");
  };

  const submitLine = async () => {
    if (!activeSessionId || !line.item_id) return;
    await api.post(`/inventory/stock-takes/${activeSessionId}/lines`, { item_id: Number(line.item_id), physical_qty: Number(line.physical_qty || 0) });
    setLine({ item_id: "", physical_qty: 0 });
  };

  return (
    <div className="space-y-3">
      <AppCard title="Stock Take Session">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <input className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" placeholder="Session name (May Week 2 Count)" value={sessionName} onChange={(e) => setSessionName(e.target.value)} />
          <button onClick={createSession} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white">Create Session</button>
          <Select className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" value={activeSessionId} onChange={(e) => setActiveSessionId(e.target.value)}>
            <option value="">Select active session</option>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.status})</option>)}
          </Select>
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-400">Post physical counts to adjust system stock</div>
        </div>
      </AppCard>

      <AppCard title="Submit Physical Count">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <Select className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" value={line.item_id} onChange={(e) => setLine({ ...line, item_id: e.target.value })}>
            <option value="">Select product</option>
            {(items || []).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.sku})</option>)}
          </Select>
          <input type="number" min="0" className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100" placeholder="Physical qty" value={line.physical_qty} onChange={(e) => setLine({ ...line, physical_qty: e.target.value })} />
          <button onClick={submitLine} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Submit Count</button>
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-400">Difference logs are posted to stock movements</div>
        </div>
      </AppCard>

      <AppCard
        title="Recent Sessions"
        actions={(
          <div className="flex items-center gap-2">
            <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search session..." className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-slate-100" />
            <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-slate-100">
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </Select>
            <button onClick={() => downloadCsv("inventory-stock-take-sessions.csv", [
              { label: "Name", value: "name" },
              { label: "Status", value: "status" },
              { label: "Created At", value: "created_at" },
            ], filtered)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200">
              Export CSV
            </button>
            <button onClick={async () => downloadPdf("inventory-stock-take-sessions", "Inventory Stock Take Sessions Report", [
              { label: "Name", value: "name" },
              { label: "Status", value: "status" },
              { label: "Created At", value: "created_at" },
            ], filtered)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200">
              Export PDF
            </button>
          </div>
        )}
      >
        <StickyTable
          maxHeight={520}
          rows={pageRows}
          columns={[
            { key: "name", label: "Name", render: (s) => <span className="text-slate-200">{s.name}</span> },
            { key: "status", label: "Status", render: (s) => <span className="text-slate-400">{s.status}</span> },
            { key: "line_count", label: "Lines", align: "right", render: (s) => <span className="text-slate-400">{Number(s.line_count || 0)}</span> },
            { key: "net_variance_units", label: "Net Var", align: "right", render: (s) => <span className="text-slate-400">{Number(s.net_variance_units || 0)}</span> },
            { key: "created_at", label: "Created", render: (s) => <span className="text-slate-500">{s.created_at ? new Date(s.created_at).toLocaleString() : "-"}</span> },
            {
              key: "actions",
              label: "Actions",
              align: "right",
              render: (s) => (
                <button onClick={() => navigate(`/inventory/stock-take/${s.id}`)} className="rounded border border-indigo-500/40 bg-indigo-500/10 px-2 py-1 text-xs text-indigo-200">
                  Open
                </button>
              ),
            },
          ]}
        />
        <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
          <span>{filtered.length} sessions</span>
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
