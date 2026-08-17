import React, { useState, useMemo } from "react";
import { DollarSign, CheckCircle2, AlertTriangle, Calculator, Clock, Lock, Sparkles, X } from "lucide-react";
import AppModal from "./layout/AppModal";
import { Button, Input } from "./UI";
import api from "../lib/api";
import { useFeedback } from "./FeedbackProvider";

const DENOMINATIONS = [
  { label: "Rs. 5,000", value: 5000 },
  { label: "Rs. 1,000", value: 1000 },
  { label: "Rs. 500", value: 500 },
  { label: "Rs. 100", value: 100 },
  { label: "Rs. 50", value: 50 },
  { label: "Rs. 20", value: 20 },
];

export function ShiftModal({ open, onClose, currentShift, onShiftUpdated }) {
  const { toast } = useFeedback();
  const [openingFloat, setOpeningFloat] = useState("10000");
  const [shiftName, setShiftName] = useState("Main Register");
  const [openNotes, setOpenNotes] = useState("");
  const [loading, setLoading] = useState(false);

  // Close shift state
  const [counts, setCounts] = useState({
    5000: 0,
    1000: 0,
    500: 0,
    100: 0,
    50: 0,
    20: 0,
  });
  const [directCounted, setDirectCounted] = useState("");
  const [useDenominations, setUseDenominations] = useState(true);
  const [closeNotes, setCloseNotes] = useState("");

  const denomTotal = useMemo(() => {
    return Object.entries(counts).reduce((sum, [val, qty]) => {
      return sum + Number(val) * Number(qty || 0);
    }, 0);
  }, [counts]);

  const effectiveCounted = useMemo(() => {
    if (useDenominations) return denomTotal;
    return parseFloat(directCounted) || 0;
  }, [useDenominations, denomTotal, directCounted]);

  const salesSummary = currentShift?.sales_summary || {};
  const expectedTotal = Number(salesSummary.expected_drawer_cash || currentShift?.opening_float || 0);
  const variance = effectiveCounted - expectedTotal;

  const handleOpenShift = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post("/shifts/open", {
        opening_float: parseFloat(openingFloat) || 0,
        shift_name: shiftName,
        notes: openNotes
      });
      toast(res.data?.message || "Shift opened successfully!", "success");
      onShiftUpdated?.();
      onClose();
    } catch (err) {
      toast(err?.response?.data?.detail || "Failed to open shift", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleCloseShift = async () => {
    setLoading(true);
    try {
      const res = await api.post("/shifts/close", {
        counted_cash_total: effectiveCounted,
        denominations: useDenominations ? counts : undefined,
        notes: closeNotes
      });
      toast({
        title: "Register Shift Closed",
        description: `Shift #${res.data?.recon_code} closed. Status: ${res.data?.status}`,
        tone: Math.abs(variance) < 1 ? "success" : "warning",
        timeoutMs: 5000
      });
      onShiftUpdated?.();
      onClose();
    } catch (err) {
      toast(err?.response?.data?.detail || "Failed to close shift", "error");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  // Render Open Shift Modal if no active shift
  if (!currentShift) {
    return (
      <AppModal
        open={open}
        onClose={onClose}
        title={
          <div className="flex items-center gap-2 text-emerald-400">
            <DollarSign size={18} />
            <span>Open Cash Register Shift</span>
          </div>
        }
        panelClassName="max-w-md bg-[#0d1322] border-white/10"
      >
        <form onSubmit={handleOpenShift} className="space-y-4 py-2">
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
            Enter the starting cash amount (float) present in the cash drawer at the beginning of this shift.
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">Opening Cash Float (LKR)</label>
            <Input
              type="number"
              min="0"
              step="100"
              value={openingFloat}
              onChange={(e) => setOpeningFloat(e.target.value)}
              placeholder="e.g. 10000"
              required
              className="text-lg font-bold font-mono text-emerald-400"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">Shift Label / Terminal</label>
            <Input
              type="text"
              value={shiftName}
              onChange={(e) => setShiftName(e.target.value)}
              placeholder="e.g. Morning Shift / Main Terminal"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">Opening Notes (Optional)</label>
            <Input
              type="text"
              value={openNotes}
              onChange={(e) => setOpenNotes(e.target.value)}
              placeholder="e.g. Clean float verified by cashier"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
            <Button variant="secondary" onClick={onClose} type="button">Cancel</Button>
            <Button variant="primary" type="submit" disabled={loading}>
              {loading ? "Opening..." : "Confirm & Open Shift"}
            </Button>
          </div>
        </form>
      </AppModal>
    );
  }

  // Render Close Shift & Reconciliation Modal
  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2 text-indigo-400">
          <Lock size={18} />
          <span>Close Shift &amp; Cash Reconciliation (#{currentShift.recon_code})</span>
        </div>
      }
      panelClassName="max-w-2xl bg-[#0d1322] border-white/10"
    >
      <div className="space-y-4 py-1 text-xs">
        {/* Shift Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="p-3 rounded-xl bg-slate-900 border border-white/5">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Opening Float</span>
            <span className="text-sm font-bold text-slate-200 font-mono">
              LKR {Number(currentShift.opening_float || 0).toLocaleString()}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-900 border border-white/5">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Cash Sales</span>
            <span className="text-sm font-bold text-emerald-400 font-mono">
              + LKR {Number(salesSummary.cash_sales || 0).toLocaleString()}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-900 border border-white/5">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Expected in Drawer</span>
            <span className="text-sm font-bold text-cyan-400 font-mono">
              LKR {expectedTotal.toLocaleString()}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-900 border border-white/5">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Card / Bank</span>
            <span className="text-sm font-bold text-slate-400 font-mono">
              LKR {(Number(salesSummary.card_sales || 0) + Number(salesSummary.bank_sales || 0)).toLocaleString()}
            </span>
          </div>
        </div>

        {/* Cash Counting Section */}
        <div className="p-4 rounded-2xl bg-black/30 border border-white/10 space-y-3">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <div className="flex items-center gap-2 font-bold text-slate-200">
              <Calculator size={15} className="text-indigo-400" />
              <span>Physical Cash Drawer Count</span>
            </div>
            <button
              type="button"
              onClick={() => setUseDenominations(!useDenominations)}
              className="text-[11px] text-indigo-400 hover:underline font-semibold"
            >
              {useDenominations ? "Switch to Direct Total" : "Use Denomination Breakdown"}
            </button>
          </div>

          {useDenominations ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {DENOMINATIONS.map((d) => (
                <div key={d.value} className="flex items-center justify-between p-2 rounded-xl bg-slate-900/60 border border-white/5">
                  <span className="font-semibold text-slate-300 text-xs">{d.label}</span>
                  <input
                    type="number"
                    min="0"
                    value={counts[d.value] || ""}
                    onChange={(e) => {
                      const val = Math.max(0, parseInt(e.target.value) || 0);
                      setCounts((prev) => ({ ...prev, [d.value]: val }));
                    }}
                    placeholder="0"
                    className="w-16 bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-right text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div>
              <label className="text-xs font-semibold text-slate-400 block mb-1">Total Counted Cash (LKR)</label>
              <Input
                type="number"
                min="0"
                value={directCounted}
                onChange={(e) => setDirectCounted(e.target.value)}
                placeholder="Enter total counted cash in drawer..."
                className="text-base font-bold font-mono text-cyan-400"
              />
            </div>
          )}

          {/* Live Variance Calculation Banner */}
          <div className={`p-3 rounded-xl border flex items-center justify-between font-mono text-xs ${
            Math.abs(variance) < 1
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              : variance > 0
              ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
              : "bg-rose-500/10 border-rose-500/30 text-rose-300"
          }`}>
            <div>
              <span className="font-sans font-bold block">Actual Counted Cash:</span>
              <span className="text-sm font-black">LKR {effectiveCounted.toLocaleString()}</span>
            </div>
            <div className="text-right">
              <span className="font-sans font-bold block">
                {Math.abs(variance) < 1 ? "Drawer Status:" : variance > 0 ? "Cash Overage (+):" : "Cash Shortage (-):"}
              </span>
              <span className="text-sm font-black">
                {Math.abs(variance) < 1 ? "✓ Perfectly Balanced" : `LKR ${Math.abs(variance).toLocaleString()}`}
              </span>
            </div>
          </div>
        </div>

        {/* Closing Notes */}
        <div>
          <label className="text-xs font-semibold text-slate-400 block mb-1">Closing Remarks / Handover Notes</label>
          <Input
            type="text"
            value={closeNotes}
            onChange={(e) => setCloseNotes(e.target.value)}
            placeholder="e.g. Drawer verified by evening cashier"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Keep Shift Open</Button>
          <Button
            variant="primary"
            onClick={handleCloseShift}
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
          >
            {loading ? "Closing Shift..." : "Finalize & Close Shift"}
          </Button>
        </div>
      </div>
    </AppModal>
  );
}
