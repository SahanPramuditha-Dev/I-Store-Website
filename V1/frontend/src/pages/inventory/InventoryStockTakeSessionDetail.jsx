import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../../lib/api";
import { useFetch } from "../../hooks/useFetch";
import { AppCard, StickyTable } from "../../components/MuiPrimitives";
import { Select } from "../../components/UI";

export default function InventoryStockTakeSessionDetail() {
  const navigate = useNavigate();
  const { sessionId } = useParams();
  const { data: items } = useFetch("/inventory");
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [line, setLine] = useState({ item_id: "", physical_qty: 0 });

  const load = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await api.get(`/inventory/stock-takes/${sessionId}`);
      setDetail(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [sessionId]);

  const submitLine = async () => {
    if (!sessionId || !line.item_id) return;
    await api.post(`/inventory/stock-takes/${sessionId}/lines`, {
      item_id: Number(line.item_id),
      physical_qty: Number(line.physical_qty || 0),
    });
    setLine({ item_id: "", physical_qty: 0 });
    await load();
  };

  const closeSession = async () => {
    if (!sessionId) return;
    await api.post(`/inventory/stock-takes/${sessionId}/close`);
    await load();
  };

  const session = detail?.session;
  const summary = detail?.summary || {};
  const rows = detail?.lines || [];
  const isClosed = String(session?.status || "").toLowerCase() === "closed";

  return (
    <div className="space-y-3">
      <AppCard title="Stock Take Session Detail">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => navigate("/inventory/stock-take")} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200">
            Back
          </button>
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-300">
            Session: <span className="font-bold text-white">{session?.name || `#${sessionId}`}</span> ({session?.status || "..."})
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-400">
            Created: {session?.created_at ? new Date(session.created_at).toLocaleString() : "-"}
          </div>
          <button
            onClick={closeSession}
            disabled={isClosed}
            className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            {isClosed ? "Session Closed" : "Finalize / Close"}
          </button>
        </div>
      </AppCard>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <AppCard title="Counted Lines"><p className="text-2xl font-black text-slate-100">{Number(summary.line_count || 0)}</p></AppCard>
        <AppCard title="Increase Units"><p className="text-2xl font-black text-emerald-300">{Number(summary.variance_increase_units || 0)}</p></AppCard>
        <AppCard title="Decrease Units"><p className="text-2xl font-black text-rose-300">{Number(summary.variance_decrease_units || 0)}</p></AppCard>
        <AppCard title="Net Variance"><p className="text-2xl font-black text-indigo-300">{Number(summary.net_variance_units || 0)}</p></AppCard>
      </div>

      <AppCard title="Submit Line Count">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <Select
            value={line.item_id}
            onChange={(e) => setLine({ ...line, item_id: e.target.value })}
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
            disabled={isClosed}
          >
            <option value="">Select product</option>
            {(items || []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.sku}) - system {item.quantity}
              </option>
            ))}
          </Select>
          <input
            type="number"
            min="0"
            value={line.physical_qty}
            onChange={(e) => setLine({ ...line, physical_qty: e.target.value })}
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
            placeholder="Physical qty"
            disabled={isClosed}
          />
          <button onClick={submitLine} disabled={isClosed} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">
            Submit
          </button>
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-400">
            One count per item per session is enforced.
          </div>
        </div>
      </AppCard>

      <AppCard title="Session Lines">
        {loading && <p className="mb-2 text-sm text-slate-400">Loading...</p>}
        <StickyTable
          maxHeight={540}
          rows={rows}
          columns={[
            { key: "item_name", label: "Product", render: (r) => <span className="text-slate-200">{r.item_name}</span> },
            { key: "sku", label: "SKU", render: (r) => <span className="text-slate-500">{r.sku || "-"}</span> },
            { key: "system_qty", label: "System", align: "right", render: (r) => <span className="text-slate-300">{Number(r.system_qty || 0)}</span> },
            { key: "physical_qty", label: "Physical", align: "right", render: (r) => <span className="text-slate-100">{Number(r.physical_qty || 0)}</span> },
            {
              key: "difference",
              label: "Variance",
              align: "right",
              render: (r) => {
                const diff = Number(r.difference || 0);
                const tone = diff > 0 ? "text-emerald-300" : diff < 0 ? "text-rose-300" : "text-slate-400";
                return <span className={tone}>{diff}</span>;
              },
            },
          ]}
        />
      </AppCard>
    </div>
  );
}
