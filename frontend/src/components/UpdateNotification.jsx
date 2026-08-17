import React, { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  X,
  ShieldCheck,
  ArrowUpCircle,
  Loader2,
  Lock,
  ChevronDown,
  Clock,
} from "lucide-react";

/**
 * UpdateNotification Component
 * =============================
 * Premium glassmorphic update modal and floating notification toast.
 * Active both before login (on Login page) and after login (inside Application).
 * Listens to Electron auto-updater status & download progress events.
 */
export default function UpdateNotification() {
  const [status, setStatus] = useState(null); // 'checking' | 'available' | 'not-available' | 'downloading' | 'ready-to-install' | 'error' | 'backup-failed' | 'blocked'
  const [progress, setProgress] = useState(0);
  const [versionInfo, setVersionInfo] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [blockedReason, setBlockedReason] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const snoozeRef = useRef(null);

  useEffect(() => {
    // Only execute if running inside Electron host with updater bridge
    if (!window.istore?.updater) return;

    // Fetch initial updater state on mount
    window.istore.updater.getState?.().then((data) => {
      if (!data?.status || data.status === "idle") return;
      handleStateUpdate(data);
    }).catch(() => {});

    // Listen to real-time updater events
    const unsubStatus = window.istore.updater.onStatus((data) => {
      console.log("[UpdateNotification] Status event:", data);
      setDismissed(false); // Re-open banner on new status event
      handleStateUpdate(data);
    });

    const unsubProgress = window.istore.updater.onProgress((data) => {
      setStatus("downloading");
      setDismissed(false);
      setProgress(Math.round(data.percent || 0));
    });

    return () => {
      unsubStatus?.();
      unsubProgress?.();
    };
  }, []);

  // Close snooze dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (snoozeRef.current && !snoozeRef.current.contains(e.target)) {
        setShowSnoozeMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto-dismiss "not-available" (software is up to date) notification after 4 seconds
  useEffect(() => {
    if (status === "not-available" && !dismissed) {
      const timer = setTimeout(() => {
        setDismissed(true);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [status, dismissed]);

  const handleStateUpdate = (data) => {
    if (data.status === "checking") {
      setStatus("checking");
    } else if (data.status === "available") {
      setStatus("available");
      if (data.version) setVersionInfo(data.version);
      if (data.releaseNotes) setReleaseNotes(data.releaseNotes);
    } else if (data.status === "not-available") {
      setStatus("not-available");
    } else if (data.status === "downloaded" || data.status === "ready-to-install") {
      setStatus("ready-to-install");
      if (data.version) setVersionInfo(data.version);
    } else if (data.status === "blocked") {
      setStatus("blocked");
      const reasonMap = {
        "pending-outbox":    `${data.count ?? "Some"} offline changes are still syncing. Please wait for sync to complete before updating.`,
        "operations-active": "A critical operation is in progress. Please finish it before applying the update.",
      };
      setBlockedReason(reasonMap[data.reason] || "The update is temporarily blocked. Please try again shortly.");
    } else if (data.status === "error" || data.status === "backup-failed") {
      setStatus("error");
      setErrorMessage(data.error || "Failed to complete update process.");
    }
  };

  const handleDownloadNow = async () => {
    try {
      setStatus("downloading");
      setProgress(0);
      await window.istore.updater.downloadUpdate();
    } catch (err) {
      console.error("Failed to trigger update download:", err);
      setStatus("error");
      setErrorMessage(err?.message || "Failed to start download.");
    }
  };

  const handleInstallNow = async () => {
    try {
      await window.istore.updater.installUpdate();
    } catch (err) {
      console.error("Failed to trigger update installation:", err);
    }
  };

  const handleManualCheck = async () => {
    try {
      setDismissed(false);
      setStatus("checking");
      await window.istore.updater.checkForUpdates();
    } catch (err) {
      console.error("Failed manual update check:", err);
    }
  };

  const handleSnooze = async (duration) => {
    setShowSnoozeMenu(false);
    try {
      await window.istore.updater.snooze?.(duration);
    } catch (_err) {}
    setDismissed(true);
  };

  if (!status || dismissed) return null;

  // Render a compact top-right floating toast for non-modal states ("checking" and "not-available")
  if (status === "checking" || status === "not-available") {
    return (
      <div className="fixed top-5 right-5 z-[99999] max-w-sm animate-in fade-in slide-in-from-top-4 duration-300">
        <div className={`flex items-center gap-3.5 rounded-2xl border p-4 text-slate-100 shadow-2xl backdrop-blur-xl transition-all ${
          status === "checking"
            ? "border-indigo-500/30 bg-slate-900/95 shadow-indigo-950/40"
            : "border-emerald-500/30 bg-slate-900/95 shadow-emerald-950/40"
        }`}>
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
            status === "checking"
              ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/30"
              : "bg-gradient-to-br from-emerald-500/20 to-teal-500/10 text-emerald-400 border-emerald-500/30"
          }`}>
            {status === "checking" ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <CheckCircle2 size={20} className="animate-pulse" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-bold text-slate-100">
                {status === "checking" ? "Checking for Updates" : "Software Up To Date"}
              </h4>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                status === "checking"
                  ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
                  : "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
              }`}>
                {status === "checking" ? "Syncing..." : "Latest"}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400 truncate">
              {status === "checking"
                ? "Checking GitHub repository for desktop updates..."
                : "You are running the latest version of iStore OS."}
            </p>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
            title="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      </div>
    );
  }

  // Render a rich glassmorphic center modal dialog for active update states
  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-b from-slate-900/95 via-slate-900/90 to-slate-950/95 p-6 text-slate-100 shadow-2xl shadow-indigo-950/80 backdrop-blur-2xl transition-all">
        
        {/* Glow ambient decoration */}
        <div className="pointer-events-none absolute -top-24 -left-24 h-48 w-48 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-24 h-48 w-48 rounded-full bg-purple-500/20 blur-3xl" />

        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {status === "checking" && (
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shadow-inner">
                <Loader2 size={22} className="animate-spin text-indigo-400" />
              </div>
            )}
            {status === "available" && (
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/30 to-purple-500/30 text-cyan-300 border border-indigo-400/40 shadow-lg shadow-indigo-500/20 animate-pulse">
                <Sparkles size={22} />
              </div>
            )}
            {status === "downloading" && (
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 shadow-inner">
                <Download size={22} className="animate-bounce" />
              </div>
            )}
            {status === "ready-to-install" && (
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/30 to-teal-500/30 text-emerald-300 border border-emerald-400/40 shadow-lg shadow-emerald-500/20">
                <ShieldCheck size={22} />
              </div>
            )}
            {status === "blocked" && (
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
                <Lock size={22} />
              </div>
            )}
            {status === "error" && (
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30">
                <AlertTriangle size={22} />
              </div>
            )}

            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black tracking-tight text-white">
                  {status === "checking" && "Checking for Updates"}
                  {status === "available" && "New Update Available"}
                  {status === "downloading" && "Downloading Update"}
                  {status === "ready-to-install" && "Update Ready to Install"}
                  {status === "blocked" && "Update Temporarily Blocked"}
                  {status === "error" && "Update Notification"}
                </h3>
                {versionInfo && (
                  <span className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-[11px] font-bold text-cyan-300 border border-indigo-400/30">
                    v{versionInfo}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-medium">iStore OS Desktop Application</p>
            </div>
          </div>

          <button
            onClick={() => setDismissed(true)}
            className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
            title="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div className="mt-5 space-y-4">
          {status === "checking" && (
            <div className="rounded-2xl border border-white/5 bg-slate-950/50 p-4 text-center">
              <p className="text-xs text-slate-300 leading-relaxed font-medium">
                Connecting to GitHub Releases repository to verify the latest desktop build...
              </p>
            </div>
          )}

          {status === "available" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-indigo-500/20 bg-indigo-950/30 p-4">
                <p className="text-xs text-slate-200 leading-relaxed">
                  A brand new software release <strong className="text-cyan-300 font-bold">v{versionInfo}</strong> is ready for your store! Upgrading includes overall performance enhancements, system stability fixes, and feature updates.
                </p>
              </div>

              {/* Release Notes */}
              {releaseNotes && (
                <div className="rounded-2xl border border-white/5 bg-slate-950/60 p-4 max-h-32 overflow-y-auto">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">What's New</p>
                  <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{releaseNotes}</p>
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  onClick={handleDownloadNow}
                  className="flex-1 py-3 px-5 rounded-2xl bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-400 hover:to-pink-400 text-white font-black text-xs shadow-xl shadow-purple-950/60 transition-all transform active:scale-95 flex items-center justify-center gap-2"
                >
                  <Download size={15} />
                  <span>Download &amp; Upgrade Now</span>
                </button>

                {/* Snooze / Remind Me Later */}
                <div className="relative" ref={snoozeRef}>
                  <button
                    onClick={() => setShowSnoozeMenu((v) => !v)}
                    className="py-3 px-3 rounded-2xl border border-white/10 bg-slate-800/60 hover:bg-slate-800 text-slate-300 font-semibold text-xs transition flex items-center gap-1.5"
                    title="Remind Me Later"
                  >
                    <Clock size={13} />
                    <ChevronDown size={11} className={`transition-transform ${showSnoozeMenu ? "rotate-180" : ""}`} />
                  </button>
                  {showSnoozeMenu && (
                    <div className="absolute bottom-full mb-2 right-0 w-44 rounded-2xl border border-white/10 bg-slate-900 shadow-2xl overflow-hidden z-10">
                      <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Remind Me Later</p>
                      {[
                        { label: "In 1 hour", value: 1 },
                        { label: "In 4 hours", value: 4 },
                        { label: "Next startup", value: "next-startup" },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => handleSnooze(opt.value)}
                          className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {status === "downloading" && (
            <div className="space-y-3 rounded-2xl border border-cyan-500/20 bg-cyan-950/20 p-4">
              <div className="flex justify-between text-xs font-bold text-slate-200">
                <span className="flex items-center gap-1.5">
                  <RefreshCw size={12} className="animate-spin text-cyan-400" />
                  Downloading Update Package...
                </span>
                <span className="text-cyan-400 font-black text-sm">{progress}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-950 p-0.5 border border-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-indigo-500 to-purple-500 transition-all duration-300 shadow-md shadow-cyan-500/50"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-400 text-center font-medium">You can continue working while the update downloads in the background.</p>
            </div>
          )}

          {status === "ready-to-install" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/30 p-4">
                <p className="text-xs text-slate-200 leading-relaxed">
                  Update <strong className="text-emerald-300 font-bold">v{versionInfo}</strong> has been downloaded and verified! An automatic database backup will run before restart.
                </p>
              </div>

              <button
                onClick={handleInstallNow}
                className="w-full py-3.5 px-5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-black text-xs shadow-xl shadow-emerald-950/60 transition-all transform active:scale-95 flex items-center justify-center gap-2.5"
              >
                <ArrowUpCircle size={17} />
                <span>Restart &amp; Install Update Now</span>
              </button>
            </div>
          )}

          {status === "blocked" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-4">
                <p className="text-xs text-amber-200 leading-relaxed">{blockedReason}</p>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={handleManualCheck}
                  className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition"
                >
                  Retry
                </button>
                <button
                  onClick={() => setDismissed(true)}
                  className="py-2.5 px-4 rounded-xl border border-white/10 text-slate-400 hover:text-white text-xs transition"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="space-y-3">
              <div className="rounded-2xl border border-rose-500/30 bg-rose-950/30 p-4 text-xs text-rose-300">
                {errorMessage}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={handleManualCheck}
                  className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition"
                >
                  Retry Check
                </button>
                <button
                  onClick={() => setDismissed(true)}
                  className="py-2.5 px-4 rounded-xl border border-white/10 text-slate-400 hover:text-white text-xs transition"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
