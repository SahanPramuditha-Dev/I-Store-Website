import React, { useEffect, useState } from "react";

/**
 * UpdateNotification Component
 * =============================
 * Floating toast banner in the bottom-right corner of the POS renderer.
 * Listens to Electron auto-updater status & download progress events.
 */
export default function UpdateNotification() {
  const [status, setStatus] = useState(null); // 'checking' | 'available' | 'not-available' | 'downloading' | 'ready-to-install' | 'error' | 'backup-failed'
  const [progress, setProgress] = useState(0);
  const [versionInfo, setVersionInfo] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Only execute if running inside Electron host with updater bridge
    if (!window.istore?.updater) return;

    const unsubStatus = window.istore.updater.onStatus((data) => {
      console.log("[UpdateNotification] Status event:", data);
      setDismissed(false); // Re-open banner on new status event

      if (data.status === "checking") {
        setStatus("checking");
      } else if (data.status === "available") {
        setStatus("available");
        if (data.version) setVersionInfo(data.version);
      } else if (data.status === "not-available") {
        setStatus("not-available");
      } else if (data.status === "downloaded" || data.status === "ready-to-install") {
        setStatus("ready-to-install");
        if (data.version) setVersionInfo(data.version);
      } else if (data.status === "error" || data.status === "backup-failed") {
        setStatus("error");
        setErrorMessage(data.error || "Failed to complete update process.");
      }
    });

    const unsubProgress = window.istore.updater.onProgress((data) => {
      setStatus("downloading");
      setProgress(Math.round(data.percent || 0));
    });

    return () => {
      unsubStatus?.();
      unsubProgress?.();
    };
  }, []);

  const handleDownloadNow = async () => {
    try {
      await window.istore.updater.downloadUpdate();
    } catch (err) {
      console.error("Failed to trigger update download:", err);
    }
  };

  const handleInstallNow = async () => {
    try {
      await window.istore.updater.installUpdate();
    } catch (err) {
      console.error("Failed to trigger update installation:", err);
    }
  };

  if (!status || dismissed) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-indigo-500/30 bg-slate-900 shadow-2xl shadow-indigo-950/50">
        <div className="flex items-center justify-between border-b border-white/10 bg-slate-950/60 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
              🚀
            </span>
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                {status === "checking" && "Checking for Updates..."}
                {status === "available" && `iStore OS Update Available`}
                {status === "not-available" && "Software Up To Date"}
                {status === "downloading" && `Downloading Update (${progress}%)`}
                {status === "ready-to-install" && `Update Ready to Install`}
                {status === "error" && "Update Issue Detected"}
              </h3>
              {versionInfo && <p className="text-[10px] text-indigo-300 font-semibold">Version {versionInfo}</p>}
            </div>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white transition"
            title="Dismiss notification"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          {status === "checking" && (
            <p className="text-xs text-slate-300">Contacting GitHub Releases repository for latest version...</p>
          )}

          {status === "available" && (
            <div className="space-y-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                A new software update <b className="text-cyan-300">v{versionInfo}</b> is available! Click download to keep your store, POS, and repairs up to date.
              </p>
              <button
                onClick={handleDownloadNow}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-xs shadow-lg transition flex items-center justify-center gap-2"
              >
                <span>⚡ Download Update Now</span>
              </button>
            </div>
          )}

          {status === "not-available" && (
            <p className="text-xs text-slate-300">You are using the latest version of iStore OS software.</p>
          )}

          {status === "downloading" && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold text-slate-300">
                <span>Downloading Update Package...</span>
                <span className="text-cyan-400 font-bold">{progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {status === "ready-to-install" && (
            <div className="space-y-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                Update <b className="text-emerald-400">v{versionInfo}</b> has been downloaded and verified! A pre-update database backup is saved.
              </p>
              <button
                onClick={handleInstallNow}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-xs shadow-lg transition flex items-center justify-center gap-2"
              >
                <span>✨ Restart & Install Now</span>
              </button>
            </div>
          )}

          {status === "error" && (
            <p className="text-xs text-rose-300">{errorMessage}</p>
          )}
        </div>
      </div>
    </div>
  );
}
