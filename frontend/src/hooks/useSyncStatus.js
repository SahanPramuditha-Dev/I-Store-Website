/**
 * useSyncStatus.js  –  Phase 7: Frontend Offline Upgrade
 * ========================================================
 * Tracks the composite sync status of the application.
 *
 * States:
 *   'synced'    – Online, outbox empty, last sync recent
 *   'syncing'   – Push/pull actively in progress
 *   'pending'   – Offline or outbox has unsent events
 *   'conflict'  – One or more outbox rows in conflict state
 *   'error'     – Last sync attempt failed
 *
 * Works in both:
 *   a) Electron: subscribes to "sync:completed" IPC events via window.istore
 *   b) Web/browser: polls the syncQueue from syncQueue.js
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useNetworkStatus } from "./useNetworkStatus";
import { syncQueue } from "../lib/syncQueue";

// Time after which a successful sync is considered "stale"
const STALE_SYNC_MS = 5 * 60 * 1000; // 5 min

export const SYNC_STATES = Object.freeze({
  SYNCED:   "synced",
  SYNCING:  "syncing",
  PENDING:  "pending",
  CONFLICT: "conflict",
  ERROR:    "error",
});

/**
 * useSyncStatus()
 *
 * @returns {{
 *   syncState: string,
 *   pendingCount: number,
 *   conflictCount: number,
 *   lastSyncAt: Date|null,
 *   triggerSync: () => Promise<void>,
 *   isElectron: boolean,
 * }}
 */
export function useSyncStatus() {
  const { isOnline } = useNetworkStatus();
  const isElectron   = typeof window !== "undefined" && !!window.istore?.sync;

  const [syncState,    setSyncState]    = useState(SYNC_STATES.PENDING);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount,setConflictCount]= useState(0);
  const [lastSyncAt,   setLastSyncAt]   = useState(null);
  const syncingRef = useRef(false);

  // ── Compute status from outbox state ────────────────────────────────────
  const refreshStatus = useCallback(async () => {
    let pending  = 0;
    let conflict = 0;

    if (isElectron) {
      try {
        const outbox = await window.istore.outbox.list();
        pending  = outbox.filter((r) => r.status === "pending").length;
        conflict = outbox.filter((r) => r.status === "conflict").length;
      } catch {/* electron not ready */}
    } else {
      // Web mode: count localStorage queue
      const queue = syncQueue.getQueue();
      pending = queue.length;
    }

    setPendingCount(pending);
    setConflictCount(conflict);

    if (!isOnline) {
      setSyncState(SYNC_STATES.PENDING);
      return;
    }
    if (syncingRef.current) {
      setSyncState(SYNC_STATES.SYNCING);
      return;
    }
    if (conflict > 0) {
      setSyncState(SYNC_STATES.CONFLICT);
      return;
    }
    if (pending > 0) {
      setSyncState(SYNC_STATES.PENDING);
      return;
    }
    if (lastSyncAt && Date.now() - lastSyncAt.getTime() < STALE_SYNC_MS) {
      setSyncState(SYNC_STATES.SYNCED);
    } else {
      // Has been a while – show pending until next sync confirms
      setSyncState(SYNC_STATES.PENDING);
    }
  }, [isOnline, isElectron, lastSyncAt]);

  // ── Trigger a manual sync ────────────────────────────────────────────────
  const triggerSync = useCallback(async () => {
    if (syncingRef.current || !isOnline) return;
    syncingRef.current = true;
    setSyncState(SYNC_STATES.SYNCING);

    try {
      if (isElectron) {
        await window.istore.sync.push();
        await window.istore.sync.pull();
      } else {
        await syncQueue.processQueue();
      }
      setLastSyncAt(new Date());
      setSyncState(SYNC_STATES.SYNCED);
    } catch {
      setSyncState(SYNC_STATES.ERROR);
    } finally {
      syncingRef.current = false;
      await refreshStatus();
    }
  }, [isOnline, isElectron, refreshStatus]);

  // ── Subscribe to Electron sync events ───────────────────────────────────
  useEffect(() => {
    if (!isElectron) return;
    const unsub = window.istore.sync.onCompleted((data) => {
      const hasFailed = data?.push?.failed > 0 || data?.push?.conflicts > 0;
      if (!hasFailed) setLastSyncAt(new Date());
      refreshStatus();
    });
    return () => unsub?.();
  }, [isElectron, refreshStatus]);

  // ── Go online → trigger sync ─────────────────────────────────────────────
  useEffect(() => {
    if (isOnline) {
      triggerSync();
    } else {
      setSyncState(SYNC_STATES.PENDING);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  // ── Poll outbox status every 15 s ────────────────────────────────────────
  useEffect(() => {
    refreshStatus();
    const id = setInterval(refreshStatus, 15_000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  return {
    syncState,
    pendingCount,
    conflictCount,
    lastSyncAt,
    triggerSync,
    isElectron,
  };
}
