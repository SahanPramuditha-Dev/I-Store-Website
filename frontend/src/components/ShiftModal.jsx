import React, { useState, useMemo } from "react";
import { 
  DollarSign, CheckCircle2, AlertTriangle, Calculator, Clock, 
  Lock, Sparkles, X, ArrowDownRight, ArrowUpRight, Printer, 
  FileText, MessageSquare, ShieldCheck, RefreshCw 
} from "lucide-react";
import AppModal from "./layout/AppModal";
import { Button, Input } from "./UI";
import api from "../lib/api";
import { useFeedback } from "./FeedbackProvider";
import { openPrintCenter } from "../lib/printCenter";

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
  const [activeTab, setActiveTab] = useState("close"); // 'close' | 'movement' | 'x_report'

  // Open shift state
  const [openingFloat, setOpeningFloat] = useState("10000");
  const [shiftName, setShiftName] = useState("Main Register");
  const [openNotes, setOpenNotes] = useState("");
  const [loading, setLoading] = useState(false);

  // Cash movement state
  const [movementType, setMovementType] = useState("drop");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");

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
  const [sendWhatsApp, setSendWhatsApp] = useState(true);

  // X-Report preview state
  const [xReportData, setXReportData] = useState(null);
  const [xReportLoading, setXReportLoading] = useState(false);

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

  const handleCashMovement = async (e) => {
    e.preventDefault();
    if (!movementAmount || parseFloat(movementAmount) <= 0) {
      toast("Please enter a valid cash amount.", "warning");
      return;
    }
    setLoading(true);
    try {
      const res = await api.post("/shifts/cash-movement", {
        movement_type: movementType,
        amount: parseFloat(movementAmount),
        reason: movementReason || (movementType === "drop" ? "Midday cash drop to safe" : "Additional float added")
      });
      toast(res.data?.message || "Cash movement recorded.", "success");
      setMovementAmount("");
      setMovementReason("");
      onShiftUpdated?.();
      setActiveTab("close");
    } catch (err) {
      toast(err?.response?.data?.detail || "Failed to record movement", "error");
    } finally {
      setLoading(false);
    }
  };

  const fetchXReport = async () => {
    setXReportLoading(true);
    try {
      const res = await api.get("/shifts/x-report");
      setXReportData(res.data);
    } catch (err) {
      toast("Could not fetch X-Report", "error");
    } finally {
      setXReportLoading(false);
    }
  };

  const handlePrintXReport = () => {
    if (!xReportData) return;
    openPrintCenter("x_report", {
      ...xReportData,
      title: "Interim Shift X-Report"
    });
  };

  const handleCloseShift = async () => {
    setLoading(true);
    try {
      const res = await api.post("/shifts/close", {
        counted_cash_total: effectiveCounted,
        denominations: useDenominations ? counts : undefined,
        notes: closeNotes,
        send_whatsapp_report: sendWhatsApp
      });
      
      const isBalanced = Math.abs(variance) < 1;
      toast({
        title: "Register Shift Closed (Z-Report Generated)",
        description: `Shift #${res.data?.recon_code} closed. Status: ${res.data?.status}.${sendWhatsApp ? " Executive Z-Report sent via WhatsApp." : ""}`,
        tone: isBalanced ? "success" : "warning",
        timeoutMs: 6000
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
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold">
            <DollarSign size={18} />
            <span>Open Cash Register Shift</span>
          </div>
        }
        panelClassName="max-w-md"
      >
        <form onSubmit={handleOpenShift} className="space-y-4 py-2">
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-300">
            Enter the starting cash amount (float) present in the cash drawer at the beginning of this shift.
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">Opening Cash Float (LKR)</label>
            <Input
              type="number"
              min="0"
              step="100"
              value={openingFloat}
              onChange={(e) => setOpeningFloat(e.target.value)}
              placeholder="e.g. 5000"
              required
              autoFocus
              className="text-lg font-bold font-mono"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">Shift Session Name</label>
            <Input
              type="text"
              value={shiftName}
              onChange={(e) => setShiftName(e.target.value)}
              placeholder="e.g. Morning Shift / POS Terminal 1"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">Opening Notes (Optional)</label>
            <Input
              type="text"
              value={openNotes}
              onChange={(e) => setOpenNotes(e.target.value)}
              placeholder="e.g. Starting with 5x 1000 notes"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-white/10">
            <Button variant="secondary" type="button" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={loading || !openingFloat} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
              {loading ? "Opening..." : "Start Shift"}
            </Button>
          </div>
        </form>
      </AppModal>
    );
  }

  // Render Active Shift Management & Reconciliation Modal
  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold">
          <Lock size={18} />
          <span>Register Shift #{currentShift.recon_code}</span>
        </div>
      }
      panelClassName="max-w-2xl"
    >
      <div className="space-y-4 py-1 text-xs">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-200 dark:border-white/10 pb-2">
          <button
            type="button"
            onClick={() => setActiveTab("close")}
            className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-colors ${
              activeTab === "close"
                ? "bg-indigo-600 text-white"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
            }`}
          >
            End-of-Day Z-Close
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("movement")}
            className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-colors ${
              activeTab === "movement"
                ? "bg-indigo-600 text-white"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
            }`}
          >
            Midday Cash Movement
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("x_report");
              fetchXReport();
            }}
            className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-colors ${
              activeTab === "x_report"
                ? "bg-indigo-600 text-white"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
            }`}
          >
            Interim X-Report
          </button>
        </div>

        {/* Shift High-Level Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Opening Float</span>
            <span className="text-sm font-bold text-slate-900 dark:text-slate-200 font-mono">
              LKR {Number(currentShift.opening_float || 0).toLocaleString()}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Cash Sales</span>
            <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 font-mono">
              + LKR {Number(salesSummary.cash_sales || 0).toLocaleString()}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Expected in Drawer</span>
            <span className="text-sm font-bold text-sky-600 dark:text-cyan-400 font-mono">
              LKR {expectedTotal.toLocaleString()}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Card / Bank</span>
            <span className="text-sm font-bold text-slate-700 dark:text-slate-400 font-mono">
              LKR {(Number(salesSummary.card_sales || 0) + Number(salesSummary.bank_sales || 0)).toLocaleString()}
            </span>
          </div>
        </div>

        {/* TAB 1: CLOSE SHIFT / Z-REPORT */}
        {activeTab === "close" && (
          <div className="space-y-3">
            <div className="p-4 rounded-2xl bg-slate-50/80 dark:bg-black/30 border border-slate-200 dark:border-white/10 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/5 pb-2">
                <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200">
                  <Calculator size={15} className="text-indigo-600 dark:text-indigo-400" />
                  <span>Physical Cash Drawer Count</span>
                </div>
                <button
                  type="button"
                  onClick={() => setUseDenominations(!useDenominations)}
                  className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline font-semibold"
                >
                  {useDenominations ? "Switch to Direct Total" : "Use Denomination Breakdown"}
                </button>
              </div>

              {useDenominations ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {DENOMINATIONS.map((d) => (
                    <div key={d.value} className="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/5">
                      <span className="font-semibold text-slate-700 dark:text-slate-300 text-xs">{d.label}</span>
                      <input
                        type="number"
                        min="0"
                        value={counts[d.value] || ""}
                        onChange={(e) => {
                          const val = Math.max(0, parseInt(e.target.value) || 0);
                          setCounts((prev) => ({ ...prev, [d.value]: val }));
                        }}
                        placeholder="0"
                        className="w-16 bg-slate-50 dark:bg-black/40 border border-slate-300 dark:border-white/10 rounded-lg px-2 py-1 text-right text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-400 block mb-1">Total Counted Cash (LKR)</label>
                  <Input
                    type="number"
                    min="0"
                    value={directCounted}
                    onChange={(e) => setDirectCounted(e.target.value)}
                    placeholder="Enter total counted cash in drawer..."
                    className="text-base font-bold font-mono"
                  />
                </div>
              )}

              {/* Live Variance Calculation Banner */}
              <div className={`p-3 rounded-xl border flex items-center justify-between font-mono text-xs ${
                Math.abs(variance) < 1
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                  : variance > 0
                  ? "bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300"
                  : "bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-300"
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

            {/* Closing Remarks & WhatsApp Dispatch Toggle */}
            <div className="space-y-2">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-400 block mb-1">Closing Remarks / Handover Notes</label>
                <Input
                  type="text"
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  placeholder="e.g. Evening shift handoff complete"
                />
              </div>

              <label className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendWhatsApp}
                  onChange={(e) => setSendWhatsApp(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <div className="flex-1">
                  <span className="font-bold text-slate-800 dark:text-slate-200 text-xs block">
                    Auto-Send Executive Z-Report to Owner via WhatsApp
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Dispatches day-end gross turnover, drawer variance, and tax breakdown.
                  </span>
                </div>
              </label>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-white/10">
              <Button variant="secondary" onClick={onClose} disabled={loading}>Keep Shift Open</Button>
              <Button
                variant="primary"
                onClick={handleCloseShift}
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
              >
                {loading ? "Closing Shift..." : "Finalize & Close Shift (Z-Report)"}
              </Button>
            </div>
          </div>
        )}

        {/* TAB 2: MIDDAY CASH MOVEMENT */}
        {activeTab === "movement" && (
          <form onSubmit={handleCashMovement} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 space-y-3">
            <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-white/5 pb-2">
              <ArrowDownRight size={16} className="text-amber-500" />
              <span>Record Midday Cash Drop or Cash In</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMovementType("drop")}
                className={`p-2.5 rounded-xl border text-center font-bold text-xs transition-all ${
                  movementType === "drop"
                    ? "bg-amber-500/15 border-amber-500 text-amber-700 dark:text-amber-300"
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400"
                }`}
              >
                Cash Drop (Skim to Safe)
              </button>
              <button
                type="button"
                onClick={() => setMovementType("in")}
                className={`p-2.5 rounded-xl border text-center font-bold text-xs transition-all ${
                  movementType === "in"
                    ? "bg-emerald-500/15 border-emerald-500 text-emerald-700 dark:text-emerald-300"
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400"
                }`}
              >
                Cash In (Add Float/Change)
              </button>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">Amount (LKR)</label>
              <Input
                type="number"
                min="1"
                value={movementAmount}
                onChange={(e) => setMovementAmount(e.target.value)}
                placeholder="e.g. 50000"
                required
                className="font-mono text-base font-bold"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">Reason / Note</label>
              <Input
                type="text"
                value={movementReason}
                onChange={(e) => setMovementReason(e.target.value)}
                placeholder={movementType === "drop" ? "e.g. Safe deposit bag #042" : "e.g. Added Rs. 100/500 coins and change"}
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" type="button" onClick={() => setActiveTab("close")}>Back</Button>
              <Button variant="primary" type="submit" disabled={loading} className="bg-amber-600 hover:bg-amber-700 text-white font-bold">
                {loading ? "Recording..." : "Record Cash Movement"}
              </Button>
            </div>
          </form>
        )}

        {/* TAB 3: INTERIM X-REPORT */}
        {activeTab === "x_report" && (
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/5 pb-2">
              <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200">
                <FileText size={16} className="text-sky-500" />
                <span>Interim X-Reading Snapshot</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fetchXReport}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white"
                  title="Refresh X-Reading"
                >
                  <RefreshCw size={14} className={xReportLoading ? "animate-spin" : ""} />
                </button>
                <Button variant="secondary" onClick={handlePrintXReport} className="flex items-center gap-1 text-xs py-1 px-2.5">
                  <Printer size={13} />
                  <span>Print X-Report</span>
                </Button>
              </div>
            </div>

            {xReportLoading ? (
              <div className="py-8 text-center text-slate-500">Calculating interim metrics...</div>
            ) : xReportData ? (
              <div className="space-y-2.5 font-mono text-xs">
                <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/5 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Gross Sales Turnover:</span>
                    <span className="font-bold">LKR {Number(xReportData.sales_summary?.gross_sales || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Net Sales Turnover:</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">LKR {Number(xReportData.sales_summary?.net_sales || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Discounts &amp; Tax:</span>
                    <span>-LKR {Number(xReportData.sales_summary?.discounts_total || 0).toLocaleString()} / +LKR {Number(xReportData.sales_summary?.tax_total || 0).toLocaleString()}</span>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/5 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Opening Float:</span>
                    <span>LKR {Number(xReportData.opening_float || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Cash Sales:</span>
                    <span>+LKR {Number(xReportData.sales_summary?.cash_sales || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Midday Drops / Ins:</span>
                    <span>-LKR {Number(xReportData.cash_drops_total || 0).toLocaleString()} / +LKR {Number(xReportData.cash_ins_total || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 dark:border-white/10 pt-1 font-bold">
                    <span className="text-sky-600 dark:text-sky-400">Expected Drawer Cash:</span>
                    <span className="text-sky-600 dark:text-sky-400">LKR {Number(xReportData.expected_drawer_cash || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </AppModal>
  );
}
