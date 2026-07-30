/**
 * useNetworkStatus.js  –  Phase 7: Frontend Offline Upgrade
 * ===========================================================
 * Provides a reactive, debounced network status hook.
 *
 * Features:
 *  • Listens to native online/offline events
 *  • Debounces transitions to suppress false positives on flaky connections
 *  • Optionally pings a known endpoint for a real connectivity check
 *  • Broadcasts status via a shared BroadcastChannel (multi-tab awareness)
 */

import { useState, useEffect, useCallback, useRef } from "react";

// Shared channel so all open tabs reflect the same connectivity state
const BC_CHANNEL_NAME = "istore_network_status";

// How long (ms) to wait before declaring offline after the event fires.
// Guards against momentary blips.
const DEBOUNCE_MS = 2_000;

// Lightweight ping endpoint – HEAD request, no body needed.
const PING_URL = "/api/health";
const PING_TIMEOUT_MS = 5_000;

/**
 * useNetworkStatus(options)
 *
 * @param {object}  [options]
 * @param {boolean} [options.ping=false]       Perform an HTTP ping to confirm connectivity
 * @param {number}  [options.pingInterval=30000] How often (ms) to re-ping when seemingly online
 * @returns {{ isOnline: boolean, lastOnlineAt: Date|null, lastOfflineAt: Date|null }}
 */
export function useNetworkStatus({ ping = false, pingInterval = 30_000 } = {}) {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [lastOnlineAt, setLastOnlineAt]   = useState(navigator.onLine ? new Date() : null);
  const [lastOfflineAt, setLastOfflineAt] = useState(navigator.onLine ? null : new Date());

  const debounceTimerRef = useRef(null);
  const pingTimerRef     = useRef(null);

  // ── Ping helper ──────────────────────────────────────────────────────────
  const checkConnectivity = useCallback(async () => {
    if (!ping) return navigator.onLine;
    try {
      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
      await fetch(PING_URL, { method: "HEAD", signal: controller.signal, cache: "no-store" });
      clearTimeout(timeout);
      return true;
    } catch {
      return false;
    }
  }, [ping]);

  // ── Status transition ────────────────────────────────────────────────────
  const applyStatus = useCallback((online) => {
    setIsOnline(online);
    if (online) {
      setLastOnlineAt(new Date());
    } else {
      setLastOfflineAt(new Date());
    }
    // Broadcast to other tabs
    try {
      const bc = new BroadcastChannel(BC_CHANNEL_NAME);
      bc.postMessage({ online, timestamp: Date.now() });
      bc.close();
    } catch {
      // BroadcastChannel not supported (old browsers) – silently skip
    }
  }, []);

  // ── Handle native online event ───────────────────────────────────────────
  const handleOnline = useCallback(async () => {
    clearTimeout(debounceTimerRef.current);
    // Confirm with a real ping before declaring online
    const confirmed = await checkConnectivity();
    if (confirmed) applyStatus(true);
  }, [checkConnectivity, applyStatus]);

  // ── Handle native offline event (debounced) ──────────────────────────────
  const handleOffline = useCallback(() => {
    clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => applyStatus(false), DEBOUNCE_MS);
  }, [applyStatus]);

  // ── Listen to cross-tab broadcasts ──────────────────────────────────────
  useEffect(() => {
    let bc;
    try {
      bc = new BroadcastChannel(BC_CHANNEL_NAME);
      bc.onmessage = (e) => {
        if (typeof e.data?.online === "boolean") applyStatus(e.data.online);
      };
    } catch {/* not supported */}
    return () => bc?.close();
  }, [applyStatus]);

  // ── Register window event listeners ─────────────────────────────────────
  useEffect(() => {
    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearTimeout(debounceTimerRef.current);
    };
  }, [handleOnline, handleOffline]);

  // ── Periodic ping when online ────────────────────────────────────────────
  useEffect(() => {
    if (!ping) return;
    pingTimerRef.current = setInterval(async () => {
      if (isOnline) {
        const confirmed = await checkConnectivity();
        if (!confirmed) applyStatus(false);
      }
    }, pingInterval);
    return () => clearInterval(pingTimerRef.current);
  }, [ping, pingInterval, isOnline, checkConnectivity, applyStatus]);

  return { isOnline, lastOnlineAt, lastOfflineAt };
}
