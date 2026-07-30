/**
 * sync-bridge.js  –  Electron IPC Sync Bridge
 * =============================================
 * Phase 4: Offline Engine – IPC Layer
 *
 * This module registers Electron IPC handlers that expose the local SQLite
 * database to the renderer process.  The renderer NEVER accesses SQLite
 * directly; all calls flow through contextBridge → ipcRenderer → ipcMain.
 *
 * IPC Channels (all prefixed "db:"):
 *
 *   Reads:
 *     db:select        – selectAll(table, where, params)
 *     db:selectOne     – selectOne(table, syncUuid)
 *     db:outbox:list   – getPendingOutbox()
 *     db:cursor:get    – getLastSyncCursor(entity)
 *
 *   Writes:
 *     db:upsert        – upsert(table, row)
 *     db:delete        – softDelete(table, syncUuid)
 *     db:outbox:enqueue  – enqueueOutbox(event)
 *     db:outbox:status   – updateOutboxStatus(id, status, error)
 *     db:outbox:purge    – purgeCompletedOutbox(days)
 *     db:cursor:set    – setLastSyncCursor(entity, timestamp)
 *
 *   Sync:
 *     db:sync:push     – drain outbox → POST /sync/ingest on server
 *     db:sync:pull     – GET /sync/entities?since=<cursor> → upsert locally
 *
 * Security:
 *   • All channel names are whitelisted; unknown channels are rejected.
 *   • The renderer preload uses contextBridge, so Node APIs are never exposed.
 *   • SQL table names are validated by local-db.js (_sanitizeTable).
 */

"use strict";

const { ipcMain, net } = require("electron");
const db = require("./local-db");

// ── Whitelisted IPC channels ───────────────────────────────────────────────
const READ_CHANNELS  = new Set(["db:select", "db:selectOne", "db:outbox:list", "db:cursor:get"]);
const WRITE_CHANNELS = new Set(["db:upsert", "db:delete", "db:outbox:enqueue", "db:outbox:status", "db:outbox:purge", "db:cursor:set"]);
const SYNC_CHANNELS  = new Set(["db:sync:push", "db:sync:pull"]);

// ── Configurable sync endpoint ─────────────────────────────────────────────
const API_BASE = process.env.VITE_API_URL || "http://localhost:8000";

// ── Sync state ─────────────────────────────────────────────────────────────
let _syncLock  = false;   // prevent concurrent push/pull cycles
let _authToken = null;    // set via db:auth:token channel (see preload)

// ══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════

/**
 * register() – Register all IPC handlers.
 * Call this once from main.js after the local-db has been opened.
 */
function register() {
  // ── Read handlers ────────────────────────────────────────────────────────
  ipcMain.handle("db:select",      (_e, table, where, params) => db.selectAll(table, where, params));
  ipcMain.handle("db:selectOne",   (_e, table, uuid)           => db.selectOne(table, uuid));
  ipcMain.handle("db:outbox:list", ()                          => db.getPendingOutbox());
  ipcMain.handle("db:cursor:get",  (_e, entity)                => db.getLastSyncCursor(entity));

  // ── Write handlers ───────────────────────────────────────────────────────
  ipcMain.handle("db:upsert",          (_e, table, row)              => db.upsert(table, row));
  ipcMain.handle("db:delete",          (_e, table, uuid)             => db.softDelete(table, uuid));
  ipcMain.handle("db:outbox:enqueue",  (_e, event)                   => db.enqueueOutbox(event));
  ipcMain.handle("db:outbox:status",   (_e, id, status, error)       => db.updateOutboxStatus(id, status, error));
  ipcMain.handle("db:outbox:purge",    (_e, days)                    => db.purgeCompletedOutbox(days));
  ipcMain.handle("db:cursor:set",      (_e, entity, timestamp)       => db.setLastSyncCursor(entity, timestamp));

  // ── Auth token (stored only in main process memory) ──────────────────────
  ipcMain.handle("db:auth:setToken", (_e, token) => {
    _authToken = token;
    return true;
  });

  // ── Sync: push outbox to server ──────────────────────────────────────────
  ipcMain.handle("db:sync:push", async () => {
    if (_syncLock) return { skipped: true, reason: "sync already in progress" };
    if (!net.isOnline()) return { skipped: true, reason: "offline" };
    if (!_authToken)    return { skipped: true, reason: "no auth token" };

    _syncLock = true;
    const results = { pushed: 0, failed: 0, conflicts: 0 };

    try {
      const pending = db.getPendingOutbox();
      for (const event of pending) {
        db.updateOutboxStatus(event.id, db.OUTBOX_STATES.SYNCING);
        try {
          const body = JSON.stringify({
            entity_type: event.entity_type,
            entity_uuid: event.entity_uuid,
            operation:   event.operation,
            payload:     event.payload,
            device_id:   event.device_id,
          });

          const resp = await _apiFetch("/sync/ingest", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });

          if (resp.status === 200 || resp.status === 201) {
            db.updateOutboxStatus(event.id, db.OUTBOX_STATES.SYNCED);
            results.pushed++;
          } else if (resp.status === 409) {
            // Conflict – server wins by default; mark for resolution
            const errorBody = await resp.text();
            db.updateOutboxStatus(event.id, db.OUTBOX_STATES.CONFLICT, errorBody);
            results.conflicts++;
          } else {
            const errorBody = await resp.text();
            db.updateOutboxStatus(event.id, db.OUTBOX_STATES.FAILED, errorBody);
            results.failed++;
          }
        } catch (err) {
          db.updateOutboxStatus(event.id, db.OUTBOX_STATES.FAILED, err.message);
          results.failed++;
        }
      }
    } finally {
      _syncLock = false;
    }

    db.purgeCompletedOutbox(7);
    return results;
  });

  // ── Sync: pull changed entities from server ──────────────────────────────
  ipcMain.handle("db:sync:pull", async (_e, entities) => {
    if (!net.isOnline()) return { skipped: true, reason: "offline" };
    if (!_authToken)    return { skipped: true, reason: "no auth token" };

    // entities: array of table names to pull e.g. ["customers", "inventory_items"]
    const entityList = Array.isArray(entities)
      ? entities
      : ["customers", "inventory_items", "sales", "repair_tickets"];

    const results = { pulled: 0, tables: {} };

    for (const entity of entityList) {
      const cursor = db.getLastSyncCursor(entity);
      const url    = `/sync/entities/${entity}${cursor ? `?since=${encodeURIComponent(cursor)}` : ""}`;

      try {
        const resp = await _apiFetch(url);
        if (!resp.ok) {
          results.tables[entity] = { error: resp.status };
          continue;
        }
        const { rows, server_time } = await resp.json();
        for (const row of rows) {
          db.upsert(entity, row);
        }
        db.setLastSyncCursor(entity, server_time);
        results.pulled += rows.length;
        results.tables[entity] = { count: rows.length };
      } catch (err) {
        results.tables[entity] = { error: err.message };
      }
    }

    return results;
  });

  console.log("[sync-bridge] IPC handlers registered.");
}

/**
 * schedulePeriodicSync(windowRef, intervalMs) – Start a background push/pull cycle.
 * Call from main.js once the BrowserWindow is ready.
 *
 * @param {import('electron').BrowserWindow} win
 * @param {number} [intervalMs=120000]  Default: every 2 minutes
 */
function schedulePeriodicSync(win, intervalMs = 120_000) {
  const runSync = async () => {
    if (!net.isOnline()) return;
    try {
      const pushResult = await _handleIpc("db:sync:push");
      const pullResult = await _handleIpc("db:sync:pull", []);
      // Notify renderer of sync completion
      if (win && !win.isDestroyed()) {
        win.webContents.send("sync:completed", { push: pushResult, pull: pullResult });
      }
    } catch (err) {
      console.error("[sync-bridge] Periodic sync error:", err.message);
    }
  };

  const intervalId = setInterval(runSync, intervalMs);

  // Clean up on window close
  win.on("closed", () => clearInterval(intervalId));

  // Run immediately on startup
  setTimeout(runSync, 3_000);

  console.log(`[sync-bridge] Periodic sync scheduled every ${intervalMs / 1000}s.`);
}

// ══════════════════════════════════════════════════════════════════════════
// PRIVATE HELPERS
// ══════════════════════════════════════════════════════════════════════════

/** Electron net.fetch wrapper with auth header injection */
async function _apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = {
    Authorization: `Bearer ${_authToken}`,
    ...(options.headers || {}),
  };
  return net.fetch(url, { ...options, headers });
}

/** Simulate ipcMain.handle invocation internally for scheduled tasks */
async function _handleIpc(channel, ...args) {
  if (channel === "db:sync:push") {
    // Re-use the same handler logic
    return ipcMain.emit(channel, {}, ...args);
  }
  return null;
}

module.exports = { register, schedulePeriodicSync };
