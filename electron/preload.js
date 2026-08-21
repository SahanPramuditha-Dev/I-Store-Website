/**
 * preload.js  –  Electron Context Bridge
 * ========================================
 * Phase 4: Offline Engine – Renderer Preload
 *
 * Exposes a minimal, typed API from the main process to the renderer
 * via contextBridge. No Node APIs are ever directly accessible in the
 * renderer — all SQLite and sync operations go through this surface.
 *
 * Usage in renderer:
 *   const result = await window.istore.db.select("customers", "is_active = 1");
 *   await window.istore.sync.push();
 */

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// ── Whitelist of valid invoke channels ────────────────────────────────────
const ALLOWED_INVOKE = new Set([
  "db:select", "db:selectOne",
  "db:upsert", "db:delete",
  "db:outbox:enqueue", "db:outbox:list", "db:outbox:status", "db:outbox:purge",
  "db:cursor:get", "db:cursor:set",
  "db:auth:setToken",
  "db:sync:push", "db:sync:pull",
  "license:status", "license:activate", "license:getFingerprint",
  "updater:check", "updater:download", "updater:install", "updater:setOperationsActive", "updater:getVersion", "updater:getState",
  "updater:snooze", "updater:getUpdateLog",
  "app:getAutoLaunch", "app:setAutoLaunch",
]);

// ── Whitelist of valid "on" event channels ────────────────────────────────
const ALLOWED_EVENTS = new Set(["sync:completed", "sync:error", "updater:status", "updater:progress"]);

function safeInvoke(channel, ...args) {
  if (!ALLOWED_INVOKE.has(channel)) {
    return Promise.reject(new Error(`[preload] Blocked disallowed channel: ${channel}`));
  }
  return ipcRenderer.invoke(channel, ...args);
}

contextBridge.exposeInMainWorld("istore", {
  // ── Local DB ─────────────────────────────────────────────────────────
  db: {
    select:    (table, where, params)    => safeInvoke("db:select",    table, where, params),
    selectOne: (table, uuid)             => safeInvoke("db:selectOne", table, uuid),
    upsert:    (table, row)              => safeInvoke("db:upsert",    table, row),
    delete:    (table, uuid)             => safeInvoke("db:delete",    table, uuid),
  },

  // ── Outbox ───────────────────────────────────────────────────────────
  outbox: {
    enqueue:  (event)              => safeInvoke("db:outbox:enqueue",  event),
    list:     ()                   => safeInvoke("db:outbox:list"),
    setStatus:(id, status, error)  => safeInvoke("db:outbox:status",  id, status, error),
    purge:    (days)               => safeInvoke("db:outbox:purge",   days),
  },

  // ── Sync ─────────────────────────────────────────────────────────────
  sync: {
    push:    ()         => safeInvoke("db:sync:push"),
    pull:    (entities) => safeInvoke("db:sync:pull", entities),
    setToken:(token)    => safeInvoke("db:auth:setToken", token),
    onCompleted: (callback) => {
      if (!ALLOWED_EVENTS.has("sync:completed")) return;
      const handler = (_e, data) => callback(data);
      ipcRenderer.on("sync:completed", handler);
      return () => ipcRenderer.removeListener("sync:completed", handler);
    },
  },

  // ── Auto Updater ─────────────────────────────────────────────────────
  updater: {
    getVersion:      () => safeInvoke("updater:getVersion"),
    getState:        () => safeInvoke("updater:getState"),
    checkForUpdates: () => safeInvoke("updater:check"),
    downloadUpdate:  () => safeInvoke("updater:download"),
    installUpdate:   () => safeInvoke("updater:install"),
    setOperationsActive: (active, detail) => safeInvoke("updater:setOperationsActive", active, detail),
    snooze:          (duration) => safeInvoke("updater:snooze", duration),
    getUpdateLog:    (maxLines) => safeInvoke("updater:getUpdateLog", maxLines),
    onStatus: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on("updater:status", handler);
      return () => ipcRenderer.removeListener("updater:status", handler);
    },
    onProgress: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on("updater:progress", handler);
      return () => ipcRenderer.removeListener("updater:progress", handler);
    },
  },

  // ── Auto Launch ──────────────────────────────────────────────────────
  autoLaunch: {
    get: () => safeInvoke("app:getAutoLaunch"),
    set: (openAtLogin) => safeInvoke("app:setAutoLaunch", openAtLogin),
  },

  // ── Cursors ──────────────────────────────────────────────────────────
  cursor: {
    get: (entity)              => safeInvoke("db:cursor:get", entity),
    set: (entity, timestamp)   => safeInvoke("db:cursor:set", entity, timestamp),
  },

  // ── Licensing & Remote Lock ───────────────────────────────────────────
  license: {
    getStatus:       ()           => safeInvoke("license:status"),
    getFingerprint:  ()           => safeInvoke("license:getFingerprint"),
    activate:        (licenseKey) => safeInvoke("license:activate", licenseKey),
  },

  // ── App metadata ─────────────────────────────────────────────────────
  platform: process.platform,
  isElectron: true,
});
