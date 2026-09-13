import React, { useEffect, useRef, useState } from "react";
import {
  Download,
  CheckCircle2,
  AlertTriangle,
  X,
  Loader2,
  ChevronDown,
} from "lucide-react";

import "./UpdateNotification.css";
import { formatReleaseNotes } from "../utils/releaseNotes";

/**
 * UpdateNotification Component
 * =============================
 * Non-blocking update panel and status notification.
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
      if (!data?.status || data.status === "idle" || (data.source === "background" && ["checking", "not-available", "error"].includes(data.status))) return;
      handleStateUpdate(data);
    }).catch(() => {});

    // Listen to real-time updater events
    const unsubStatus = window.istore.updater.onStatus((data) => {
      console.log("[UpdateNotification] Status event:", data);
      if (data?.source === "background" && (data?.status === "checking" || data?.status === "not-available" || data?.status === "error")) return;
      if (data?.status !== "downloading") setDismissed(false);
      handleStateUpdate(data);
    });

    const unsubProgress = window.istore.updater.onProgress((data) => {
      setStatus("downloading");
      setProgress(Math.min(100, Math.max(0, Math.round(Number(data.percent) || 0))));
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
    } else if (data.status === "downloading") {
      setStatus("downloading");
      setProgress(Math.min(100, Math.max(0, Number(data.count) || 0)));
    } else if (data.status === "installing") {
      setStatus("installing");
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
      const result = await window.istore.updater.downloadUpdate();
      if (result?.blocked) {
        handleStateUpdate({ status: "blocked", ...result });
      } else if (result?.ok === false || result?.error) {
        throw new Error(result.error || "Failed to start download.");
      }
    } catch (err) {
      console.error("Failed to trigger update download:", err);
      setStatus("error");
      setErrorMessage(err?.message || "Failed to start download.");
    }
  };

  const handleInstallNow = async () => {
    setStatus("installing");
    try {
      const result = await window.istore.updater.installUpdate();
      if (result?.blocked) {
        handleStateUpdate({ status: "blocked", ...result });
      } else if (result?.error) {
        throw new Error(result.error);
      }
    } catch (err) {
      console.error("Failed to trigger update installation:", err);
      setStatus("error");
      setErrorMessage(err?.message || "Failed to install the downloaded update.");
    }
  };

  const handleManualCheck = async () => {
    try {
      setDismissed(false);
      setStatus("checking");
      const result = await window.istore.updater.checkForUpdates();
      if (result?.error) throw new Error(result.error);
      if (result?.skipped) {
        const state = await window.istore.updater.getState?.();
        if (state?.status && state.status !== "idle") handleStateUpdate(state);
        else setDismissed(true);
      }
    } catch (err) {
      console.error("Failed manual update check:", err);
      setStatus("error");
      setErrorMessage(err?.message || "Failed to check for updates.");
    }
  };

  const handleSnooze = async (duration) => {
    setShowSnoozeMenu(false);
    try {
      await window.istore.updater.snooze?.(duration);
    } catch (_err) {}
    setDismissed(true);
  };

  const notesText = React.useMemo(() => formatReleaseNotes(releaseNotes), [releaseNotes]);

  if (!status || dismissed) return null;

  const isToast = status === "checking" || status === "not-available";
  const titles = {
    checking: "Checking for updates",
    installing: "Preparing to restart",
    "not-available": "You're up to date",
    available: "An update is available",
    downloading: "Downloading update",
    "ready-to-install": "Ready to install",
    blocked: "Update paused",
    error: "Update couldn't complete",
  };
  const Icon = status === "checking" || status === "installing" ? Loader2
    : status === "not-available" || status === "ready-to-install" ? CheckCircle2
    : status === "blocked" || status === "error" ? AlertTriangle : Download;

  return (
    <aside className="estore-update" aria-label="Software update">
      <section className={`estore-update__panel ${isToast ? "estore-update__panel--compact" : ""}`}>
        <header className="estore-update__header">
          <span className={`estore-update__icon ${status === "error" || status === "blocked" ? "estore-update__icon--warning" : ""}`}>
            <Icon size={20} className={status === "checking" || status === "installing" ? "animate-spin" : ""} aria-hidden="true" />
          </span>
          <div className="estore-update__heading">
            <p className="estore-update__eyebrow">E Store · Software update</p>
            <h3>{titles[status]}</h3>
          </div>
          <button className="estore-update__close" onClick={() => setDismissed(true)} aria-label="Dismiss update notification" title="Dismiss">
            <X size={18} />
          </button>
        </header>

        <div className="estore-update__body">
          {versionInfo && !isToast && <span className="estore-update__version">Version {versionInfo.replace(/^v/, "")}</span>}
          {isToast && <p role="status" className="estore-update__description">{status === "checking" ? "Looking for a newer version of E Store…" : "You have the latest version of E Store."}</p>}

          {status === "available" && <>
            <p className="estore-update__description">Download the latest version when you're ready. You can keep working while it downloads.</p>
            {notesText && <details className="estore-update__notes">
              <summary>Release notes <ChevronDown size={14} aria-hidden="true" /></summary>
              <div className="estore-update__notes-text">{notesText}</div>
            </details>}
          </>}

          {status === "downloading" && <div className="estore-update__download">
            <div className="estore-update__progress-label"><span>{progress >= 100 ? "Verifying download…" : "Download in progress"}</span><strong>{progress}%</strong></div>
            <div className="estore-update__track" role="progressbar" aria-label="Update download" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${progress}%` }} />
            </div>
            <p className="estore-update__description">{progress >= 100 ? "Preparing your update. This may take a moment." : "You can keep working. We'll let you know when it's ready."}</p>
          </div>}

          {status === "installing" && <p role="status" className="estore-update__description">Backing up your data and opening the installer. Please keep E Store open.</p>}
          {status === "ready-to-install" && <p className="estore-update__description">Your update is ready. E Store will back up your data, then restart to finish installing.</p>}
          {status === "blocked" && <p role="status" className="estore-update__message">{blockedReason}</p>}
          {status === "error" && <p role="alert" className="estore-update__message">{errorMessage}</p>}
        </div>

        {!isToast && status !== "installing" && <footer className="estore-update__footer">
          {status === "available" && <>
            <div className="estore-update__later" ref={snoozeRef}>
              <button className="estore-update__button estore-update__button--secondary" onClick={() => setShowSnoozeMenu((value) => !value)} aria-expanded={showSnoozeMenu} aria-controls="update-reminders">Remind me later <ChevronDown size={14} /></button>
              {showSnoozeMenu && <div id="update-reminders" className="estore-update__menu" onKeyDown={(event) => { if (event.key === "Escape") setShowSnoozeMenu(false); }}>
                {[{ label: "In 1 hour", value: 1 }, { label: "In 4 hours", value: 4 }, { label: "Next startup", value: "next-startup" }].map((option) => <button key={option.value} onClick={() => handleSnooze(option.value)}>{option.label}</button>)}
              </div>}
            </div>
            <button className="estore-update__button estore-update__button--primary" onClick={handleDownloadNow}><Download size={16} /> Download update</button>
          </>}
          {status === "downloading" && <button className="estore-update__button estore-update__button--secondary" onClick={() => setDismissed(true)}>Continue working</button>}
          {status === "ready-to-install" && <>
            <button className="estore-update__button estore-update__button--secondary" onClick={() => setDismissed(true)}>Later</button>
            <button className="estore-update__button estore-update__button--primary" onClick={handleInstallNow}>Restart and install</button>
          </>}
          {(status === "blocked" || status === "error") && <>
            <button className="estore-update__button estore-update__button--secondary" onClick={() => setDismissed(true)}>Dismiss</button>
            <button className="estore-update__button estore-update__button--primary" onClick={handleManualCheck}>Check again</button>
          </>}
        </footer>}
      </section>
    </aside>
  );
}
