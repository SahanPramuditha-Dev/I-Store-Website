import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@mui/material";
import { useFetch } from "../../hooks/useFetch";
import { KpiCard } from "../../components/UI";
import { AlertTriangle, Boxes, Layers, PackagePlus, FileBarChart2, ClipboardCheck, SlidersHorizontal, Sparkles } from "lucide-react";

const currency = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;
const RECENT_DAYS = 30;

const parseDate = (value) => {
  const dt = new Date(value || "");
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const daysSince = (value) => {
  const dt = parseDate(value);
  if (!dt) return Number.POSITIVE_INFINITY;
  return (Date.now() - dt.getTime()) / (1000 * 60 * 60 * 24);
};

export default function InventoryOverview() {
  const navigate = useNavigate();
  const { data: inventory } = useFetch("/inventory");
  const { data: movements } = useFetch("/inventory/movements");
  const { data: stockTakes } = useFetch("/inventory/stock-takes");

  const rows = inventory || [];
  const moves = movements || [];
  const takeRows = stockTakes || [];
  const recentMoves = useMemo(
    () =>
      [...moves]
        .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
        .slice(0, 12),
    [moves]
  );

  const stats = useMemo(() => {
    const lowRows = rows.filter((r) => Number(r.quantity || 0) > 0 && Number(r.quantity || 0) <= Number(r.low_stock_threshold || 3));
    const outRows = rows.filter((r) => Number(r.quantity || 0) <= 0);
    const value = rows.reduce((s, r) => s + Number(r.cost_price || 0) * Number(r.quantity || 0), 0);
    const spareParts = rows.filter((r) => ["Displays", "Batteries", "Charging Ports", "IC Components", "Repair Tools"].includes(String(r.category || ""))).length;
    const recent = rows.filter((r) => daysSince(r.created_at) <= RECENT_DAYS).length;
    return {
      total: rows.length,
      low: lowRows.length,
      out: outRows.length,
      value,
      spareParts,
      recent,
      lowRows,
      outRows,
    };
  }, [rows]);

  const fastMoving = useMemo(() => {
    const used = {};
    for (const m of moves) {
      if (["SALE", "REPAIR_CONSUME"].includes(String(m.movement_type || ""))) {
        used[m.item_name || `Item #${m.item_id}`] = (used[m.item_name || `Item #${m.item_id}`] || 0) + Math.abs(Number(m.quantity || 0));
      }
    }
    return Object.entries(used).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [moves]);

  const movementTrend = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const todayQty = moves
      .filter((m) => String(m.created_at || "").slice(0, 10) === today)
      .reduce((sum, m) => sum + Math.abs(Number(m.quantity || 0)), 0);
    const yesterdayQty = moves
      .filter((m) => String(m.created_at || "").slice(0, 10) === yesterday)
      .reduce((sum, m) => sum + Math.abs(Number(m.quantity || 0)), 0);
    return { todayQty, yesterdayQty };
  }, [moves]);

  const openStockTake = useMemo(() => takeRows.find((r) => String(r.status || "").toLowerCase() === "open"), [takeRows]);

  return (
    <div className="min-h-0 pr-1">
      <div className="grid min-h-0 grid-cols-1 gap-4 pb-5 xl:grid-cols-12">
      <section className="xl:col-span-8 space-y-4">
        <div className="rounded-2xl border border-white/10 bg-gradient-to-r from-slate-900/90 via-slate-900/70 to-indigo-950/30 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-indigo-400/25 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-indigo-200">
                <Sparkles size={12} /> Inventory Control Tower
              </p>
              <h2 className="mt-3 text-[30px] font-extrabold leading-tight tracking-tight text-white">Overview & Operational Snapshot</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">Quickly identify stock risk, movement trends, and jump to the right workflow.</p>
            </div>
            <div className="hidden rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-right md:block">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Live Status</p>
              <p className="mt-1 text-sm font-semibold text-emerald-300">Inventory Monitoring Active</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard title="Total Products" value={String(stats.total)} tone="sky" icon={<Boxes size={18} />} />
          <KpiCard title="Low Stock" value={String(stats.low)} hint="Per item threshold" tone="amber" icon={<AlertTriangle size={18} />} />
          <KpiCard title="Out of Stock" value={String(stats.out)} hint="Needs replenishment" tone="red" icon={<AlertTriangle size={18} />} />
          <KpiCard title="Inventory Value" value={currency(stats.value)} hint="Cost basis" tone="indigo" icon={<Layers size={18} />} />
          <KpiCard title="Spare Parts" value={String(stats.spareParts)} tone="green" icon={<Boxes size={18} />} />
          <KpiCard title={`Recently Added (${RECENT_DAYS}d)`} value={String(stats.recent)} tone="violet" icon={<PackagePlus size={18} />} />
          <KpiCard title="Fast Moving SKUs" value={String(fastMoving.length)} tone="sky" icon={<Sparkles size={18} />} />
          <KpiCard title="Today Movement" value={String(movementTrend.todayQty)} hint={`Yesterday: ${movementTrend.yesterdayQty}`} tone="amber" icon={<AlertTriangle size={18} />} />
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
          <h3 className="mb-2 text-sm font-extrabold tracking-wide text-white">Inventory Snapshot</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MiniBar label="In Stock" value={Math.max(0, stats.total - stats.low - stats.out)} total={Math.max(1, stats.total)} tone="emerald" />
            <MiniBar label="Low Stock" value={stats.low} total={Math.max(1, stats.total)} tone="amber" />
            <MiniBar label="Out Stock" value={stats.out} total={Math.max(1, stats.total)} tone="rose" />
            <MiniBar label="Spare Parts" value={stats.spareParts} total={Math.max(1, stats.total)} tone="sky" />
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
          <h3 className="mb-2 text-sm font-extrabold tracking-wide text-white">Quick Actions</h3>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
            <QuickAction label="New Product" icon={<PackagePlus size={14} />} onClick={() => navigate("/inventory/products")} />
            <QuickAction label="Create GRN" icon={<ClipboardCheck size={14} />} onClick={() => navigate("/inventory/grn")} />
            <QuickAction label="Stock Adjustment" icon={<SlidersHorizontal size={14} />} onClick={() => navigate("/inventory/movements")} />
            <QuickAction label="Inventory Reports" icon={<FileBarChart2 size={14} />} onClick={() => navigate("/inventory/reports")} />
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
          <h3 className="mb-2 text-sm font-extrabold tracking-wide text-white">Recent Stock Movement</h3>
          <div className="space-y-2 max-h-[310px] overflow-y-auto pr-1 custom-scrollbar">
            {recentMoves.map((m) => (
              <div key={m.id} className="grid grid-cols-12 items-center rounded-xl border border-white/10 bg-gradient-to-r from-white/[0.04] to-white/[0.02] px-3 py-2.5 text-xs">
                <span className="col-span-7 truncate text-sm font-medium text-slate-100">{m.item_name}</span>
                <span className="col-span-3 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">{m.movement_type}</span>
                <span className={`col-span-2 text-right text-sm font-bold ${Number(m.quantity) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{Number(m.quantity) >= 0 ? "+" : ""}{m.quantity}</span>
              </div>
            ))}
            {recentMoves.length === 0 && (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-5 text-center text-sm text-slate-500">
                No stock movements yet.
              </div>
            )}
          </div>
        </div>
      </section>

      <aside className="xl:col-span-4 space-y-4">
        <Panel title="Priority Alerts">
          <AlertItem label="Low stock items" value={String(stats.low)} tone={stats.low > 0 ? "warn" : "ok"} onClick={() => navigate("/inventory/products", { state: { presetFilter: "Low Stock" } })} />
          <AlertItem label="Out of stock items" value={String(stats.out)} tone={stats.out > 0 ? "danger" : "ok"} onClick={() => navigate("/inventory/products", { state: { presetFilter: "Out of Stock" } })} />
          <AlertItem label="Open stock take" value={openStockTake ? openStockTake.name : "None"} tone={openStockTake ? "warn" : "ok"} />
        </Panel>

        <Panel title="Low Stock Preview">
          <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
            {stats.lowRows.slice(0, 8).map((r) => (
              <MiniRow key={r.id} left={r.name} right={`${r.quantity}`} rightTone="amber" />
            ))}
            {stats.lowRows.length === 0 && <p className="text-xs text-slate-500">No low stock items.</p>}
          </div>
        </Panel>

        <Panel title="Fast Moving Products">
          <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
            {fastMoving.map(([name, qty]) => (
              <MiniRow key={name} left={name} right={`${qty}`} rightTone="green" />
            ))}
            {fastMoving.length === 0 && <p className="text-xs text-slate-500">No movement data yet.</p>}
          </div>
        </Panel>
      </aside>
      </div>
    </div>
  );
}

function QuickAction({ label, icon, onClick }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-gradient-to-r from-white/[0.06] to-white/[0.03] px-3 py-2.5 text-xs font-bold text-slate-100 hover:from-indigo-500/20 hover:to-cyan-500/10 hover:border-indigo-400/30">
      <span className="text-indigo-300">{icon}</span>
      <span className="text-sm">{label}</span>
    </button>
  );
}

function Panel({ title, children }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3.5">
      <h3 className="mb-2 text-sm font-extrabold tracking-wide text-white">{title}</h3>
      {children}
    </div>
  );
}

function AlertItem({ label, value, tone, onClick }) {
  const toneClass = tone === "danger" ? "text-rose-300" : tone === "warn" ? "text-amber-300" : "text-emerald-300";
  return (
    <Button
      onClick={onClick}
      disabled={!onClick}
      className="mb-1.5 flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs normal-case"
      sx={{ color: "#e2e8f0", opacity: onClick ? 1 : 0.9, justifyContent: "space-between" }}
    >
      <span className="text-sm text-slate-200">{label}</span>
      <span className={`text-sm font-bold ${toneClass}`}>{value}</span>
    </Button>
  );
}

function MiniRow({ left, right, rightTone }) {
  const toneClass = rightTone === "amber" ? "text-amber-300" : rightTone === "green" ? "text-emerald-300" : "text-slate-200";
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
      <span className="truncate pr-2 text-sm text-slate-200">{left}</span>
      <span className={`text-sm font-bold ${toneClass}`}>{right}</span>
    </div>
  );
}

function MiniBar({ label, value, total, tone }) {
  const pct = Math.max(0, Math.min(100, Math.round((Number(value || 0) / Number(total || 1)) * 100)));
  const toneClass = tone === "amber" ? "from-amber-400 to-amber-600" : tone === "rose" ? "from-rose-400 to-rose-600" : tone === "sky" ? "from-sky-400 to-sky-600" : "from-emerald-400 to-emerald-600";
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-300">{label}</span>
        <span className="font-bold text-white">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full bg-gradient-to-r ${toneClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
