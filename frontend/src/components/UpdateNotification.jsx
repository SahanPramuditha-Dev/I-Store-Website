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
    <div
      style={{
        position: "fixed",
        bottom: "24px",
        right: "24px",
        width: "360px",
        backgroundColor: "#0f172a",
        color: "#f8fafc",
        borderRadius: "12px",
        boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)",
        border: "1px solid #334155",
        padding: "16px",
        zIndex: 9999,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "20px" }}>⚡</span>
          <h4 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "#38bdf8" }}>
            {status === "checking" && "Checking for updates"}
            {status === "available" && `Update available ${versionInfo ? `v${versionInfo}` : ""}`}
            {status === "not-available" && "You are up to date"}
            {status === "downloading" && `Downloading Update ${versionInfo ? `v${versionInfo}` : ""}`}
            {status === "ready-to-install" && `Update Ready ${versionInfo ? `v${versionInfo}` : ""}`}
            {status === "error" && "Update Issue Detected"}
          </h4>
        </div>
        <button
          onClick={() => setDismissed(true)}
          style={{
            background: "none",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: "16px",
            padding: "0 4px",
          }}
          title="Dismiss notification"
        >
          ✕
        </button>
      </div>

      {status === "checking" && <p style={{ margin: "12px 0 0", fontSize: "13px", color: "#cbd5e1" }}>Contacting GitHub Releases…</p>}

      {status === "available" && (
        <div style={{ marginTop: "12px" }}>
          <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "#cbd5e1" }}>A verified update is available. Download it now to keep the POS system protected.</p>
          <button
            onClick={handleDownloadNow}
            style={{ width: "100%", padding: "8px 14px", backgroundColor: "#0f766e", color: "#ffffff", border: "none", borderRadius: "6px", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}
          >
            Download Update
          </button>
        </div>
      )}

      {status === "not-available" && <p style={{ margin: "12px 0 0", fontSize: "13px", color: "#cbd5e1" }}>You already have the latest iStore OS release.</p>}

      {status === "downloading" && (
        <div style={{ marginTop: "12px" }}>
          <p style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#cbd5e1" }}>
            Downloading the latest version in the background ({progress}%)...
          </p>
          <div
            style={{
              width: "100%",
              height: "6px",
              backgroundColor: "#1e293b",
              borderRadius: "3px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: "100%",
                backgroundColor: "#0284c7",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
      )}

      {status === "ready-to-install" && (
        <div style={{ marginTop: "12px" }}>
          <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "#cbd5e1" }}>
            A new version has been downloaded. Database backup is saved. Restart to apply the update.
          </p>
          <button
            onClick={handleInstallNow}
            style={{
              width: "100%",
              padding: "8px 14px",
              backgroundColor: "#0284c7",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "13px",
              cursor: "pointer",
              transition: "background-color 0.2s ease",
            }}
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#0369a1")}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#0284c7")}
          >
            Restart & Install Now
          </button>
        </div>
      )}

      {status === "error" && (
        <div style={{ marginTop: "12px" }}>
          <p style={{ margin: 0, fontSize: "12px", color: "#f87171" }}>{errorMessage}</p>
        </div>
      )}
    </div>
  );
}
