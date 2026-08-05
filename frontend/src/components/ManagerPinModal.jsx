import React, { useState } from "react";
import { ShieldAlert, KeyRound, Check, X } from "lucide-react";
import api from "../lib/api";
import { Button } from "./UI";

export function ManagerPinModal({ isOpen, actionLabel, onApproved, onClose }) {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!pin || pin.length < 4) {
      setError("Please enter a valid 4-digit manager PIN.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await api.post("/access/verify-manager-pin", {
        pin: pin.trim(),
        action: actionLabel || "pos_override",
      });

      if (res.data?.verified) {
        onApproved(res.data);
        setPin("");
        onClose();
      } else {
        setError("Manager PIN verification failed.");
      }
    } catch (err) {
      setError(err.response?.data?.detail || "Invalid manager PIN.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-amber-500/30 rounded-xl w-full max-w-sm p-6 text-slate-100 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 text-lg font-bold"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4 pb-3 border-b border-slate-800">
          <div className="p-2 bg-amber-500/10 text-amber-400 rounded-lg">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-base text-slate-100">Manager Authorization</h3>
            <p className="text-xs text-slate-400">Action: {actionLabel || "Sensitive POS Operation"}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-2">
              Enter Manager Security PIN
            </label>
            <div className="relative">
              <KeyRound className="w-5 h-5 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="password"
                maxLength={8}
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value.replace(/[^0-9]/g, ""));
                  setError("");
                }}
                placeholder="••••"
                autoFocus
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-4 py-2 text-center text-xl font-mono tracking-widest text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>
            {error && <p className="text-xs text-rose-400 mt-2 font-medium">{error}</p>}
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1 border-slate-700 text-slate-300"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || pin.length < 4}
              className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-semibold flex items-center justify-center gap-2"
            >
              {loading ? "Verifying..." : "Authorize"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
