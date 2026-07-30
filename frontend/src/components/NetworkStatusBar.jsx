/**
 * NetworkStatusBar.jsx  –  Phase 7: Frontend Offline Upgrade
 * =============================================================
 * A sticky, animated status banner that reflects the app's sync state.
 *
 * Renders only when the user needs to know something:
 *   • Offline   → red banner, "Working offline – changes will sync when reconnected"
 *   • Syncing   → indigo banner with spinner
 *   • Pending   → amber banner with badge showing unsent count
 *   • Conflict  → orange banner with action button
 *   • Error     → red banner with retry button
 *   • Synced    → brief green flash then disappears
 */

import { useEffect, useRef, useState } from "react";
import { useSyncStatus, SYNC_STATES } from "../hooks/useSyncStatus";

// ── Style constants ─────────────────────────────────────────────────────────
const BANNER_STYLES = {
  [SYNC_STATES.SYNCED]:   { bg: "#14532d", text: "#bbf7d0", icon: "✓",  label: "All changes saved" },
  [SYNC_STATES.SYNCING]:  { bg: "#1e1b4b", text: "#c7d2fe", icon: null, label: "Syncing…" },
  [SYNC_STATES.PENDING]:  { bg: "#78350f", text: "#fde68a", icon: "⏱", label: null },
  [SYNC_STATES.CONFLICT]: { bg: "#7c2d12", text: "#fed7aa", icon: "⚠",  label: "Sync conflict detected" },
  [SYNC_STATES.ERROR]:    { bg: "#7f1d1d", text: "#fecaca", icon: "✕",  label: "Sync failed" },
};

// How long the "Synced" banner stays before disappearing
const SYNCED_DISMISS_MS = 2_500;

export function NetworkStatusBar() {
  const { syncState, pendingCount, conflictCount, lastSyncAt, triggerSync } = useSyncStatus();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const dismissTimer = useRef(null);
  const prevState    = useRef(null);

  useEffect(() => {
    clearTimeout(dismissTimer.current);

    if (syncState === SYNC_STATES.SYNCED) {
      // Show briefly then fade out
      setVisible(true);
      setDismissed(false);
      dismissTimer.current = setTimeout(() => setDismissed(true), SYNCED_DISMISS_MS);
    } else {
      setVisible(true);
      setDismissed(false);
    }

    prevState.current = syncState;
    return () => clearTimeout(dismissTimer.current);
  }, [syncState]);

  if (!visible || dismissed) return null;

  const style = BANNER_STYLES[syncState] || BANNER_STYLES[SYNC_STATES.PENDING];

  const label =
    syncState === SYNC_STATES.PENDING
      ? pendingCount > 0
        ? `${pendingCount} change${pendingCount > 1 ? "s" : ""} pending sync`
        : "Offline – changes saved locally"
      : style.label;

  const formatTime = (d) =>
    d ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: style.bg,
        color: style.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        padding: "6px 16px",
        fontSize: "12px",
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: 500,
        letterSpacing: "0.01em",
        transition: "opacity 0.4s ease",
        opacity: dismissed ? 0 : 1,
        userSelect: "none",
      }}
    >
      {/* Icon / Spinner */}
      {syncState === SYNC_STATES.SYNCING ? (
        <SpinnerIcon color={style.text} />
      ) : (
        style.icon && <span style={{ fontSize: "13px" }}>{style.icon}</span>
      )}

      {/* Message */}
      <span>{label}</span>

      {/* Pending badge */}
      {syncState === SYNC_STATES.PENDING && pendingCount > 0 && (
        <span
          style={{
            background: "rgba(255,255,255,0.15)",
            borderRadius: "999px",
            padding: "1px 8px",
            fontSize: "11px",
          }}
        >
          {pendingCount}
        </span>
      )}

      {/* Conflict badge */}
      {syncState === SYNC_STATES.CONFLICT && conflictCount > 0 && (
        <span
          style={{
            background: "rgba(255,255,255,0.15)",
            borderRadius: "999px",
            padding: "1px 8px",
            fontSize: "11px",
          }}
        >
          {conflictCount} conflict{conflictCount > 1 ? "s" : ""}
        </span>
      )}

      {/* Last sync time */}
      {lastSyncAt && syncState !== SYNC_STATES.SYNCING && (
        <span style={{ opacity: 0.6, marginLeft: 4 }}>
          Last sync {formatTime(lastSyncAt)}
        </span>
      )}

      {/* Actions */}
      {(syncState === SYNC_STATES.ERROR || syncState === SYNC_STATES.CONFLICT) && (
        <button
          onClick={triggerSync}
          style={{
            background: "rgba(255,255,255,0.15)",
            border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: "4px",
            color: style.text,
            cursor: "pointer",
            fontSize: "11px",
            fontWeight: 600,
            padding: "2px 10px",
            marginLeft: 8,
          }}
          onMouseEnter={(e) => (e.target.style.background = "rgba(255,255,255,0.25)")}
          onMouseLeave={(e) => (e.target.style.background = "rgba(255,255,255,0.15)")}
        >
          Retry now
        </button>
      )}

      {/* Dismiss button for non-critical states */}
      {(syncState === SYNC_STATES.SYNCED || syncState === SYNC_STATES.PENDING) && (
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          style={{
            background: "none",
            border: "none",
            color: style.text,
            cursor: "pointer",
            fontSize: "14px",
            lineHeight: 1,
            marginLeft: 8,
            opacity: 0.6,
            padding: "0 4px",
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// ── Spinner ──────────────────────────────────────────────────────────────────
function SpinnerIcon({ color = "#fff", size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      style={{ animation: "istore-spin 0.8s linear infinite", flexShrink: 0 }}
    >
      <style>{`
        @keyframes istore-spin { to { transform: rotate(360deg); } }
      `}</style>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

export default NetworkStatusBar;
