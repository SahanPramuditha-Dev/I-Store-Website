/**
 * updater.js – Auto-Update Controller
 * =====================================
 * Manages GitHub Releases auto-update checks, downloads, pre-update DB backups,
 * and restart-and-install flow using electron-updater.
 */

"use strict";

const { autoUpdater } = require("electron-updater");
const { app, ipcMain } = require("electron");
const db = require("./local-db");
const { createBackup } = require("./db-backup");
const fs = require("fs");
const path = require("path");

// GitHub's provider discovery can return the repository RSS feed on some
// release configurations.  Electron-updater expects YAML metadata, so use
// GitHub's stable release-asset URL instead.
const UPDATE_METADATA_URL = "https://github.com/SahanPramuditha-Dev/I-Store-Website/releases/latest/download";
// Only enable release checks after the release pipeline has published a
// matching latest.yml and blockmap.  This keeps a missing/broken GitHub
// release from disrupting normal desktop use.
const UPDATE_CHECKS_ENABLED = process.env.ISTORE_ENABLE_AUTO_UPDATES !== "false";

let _mainWindow = null;
let initialized = false;
let checkInProgress = false;
let operationsState = { active: false, reason: null, route: null };
let stopBackendFn = null;
let lastUpdateInfo = null;
let currentUpdaterState = {
  status: "idle",
  version: null,
  releaseNotes: null,
  error: null,
  reason: null,
  count: null,
  route: null,
};

function _updateState(state) {
  currentUpdaterState = {
    ...currentUpdaterState,
    ...state,
  };
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send("updater:status", currentUpdaterState);
  }
}

function _logEvent(event, payload = {}) {
  try {
    const logsDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), event, ...payload });
    fs.appendFileSync(path.join(logsDir, "update.log"), `${line}\n`, "utf-8");
  } catch (_err) {
  }
}

function initAutoUpdater(win, options = {}) {
  _mainWindow = win;
  stopBackendFn = typeof options.stopBackend === "function" ? options.stopBackend : null;
  if (initialized) return;
  initialized = true;

  // Logging configuration
  autoUpdater.logger = console;

  // Use native GitHub provider so electron-updater handles releases and redirects natively
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "SahanPramuditha-Dev",
    repo: "I-Store-Website",
  });
  // Never trigger another installer without an explicit user action. This
  // avoids an update download being mistaken for a second setup prompt after
  // the initial installation.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  // ── Event Handlers ────────────────────────────────────────────────────────
  autoUpdater.on("checking-for-update", () => {
    console.log("[updater] Checking for update...");
    _logEvent("checking_for_update");
    _updateState({ status: "checking", error: null, reason: null, count: null });
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[updater] Update available: v${info.version}`);
    lastUpdateInfo = info;
    _logEvent("update_available", { version: info.version });
    _updateState({
      status: "available",
      version: info.version,
      releaseNotes: info.releaseNotes,
      error: null,
      reason: null,
      count: null,
    });
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[updater] App is up to date.");
    lastUpdateInfo = null;
    _logEvent("update_not_available");
    _updateState({ status: "not-available", error: null, reason: null, count: null });
  });

  autoUpdater.on("error", (err) => {
    const msg = String(err?.message || "");
    console.log("[updater] Updater note:", msg);
    _logEvent("update_note", { message: msg });

    if (
      msg.includes("404") ||
      msg.includes("latest.yml") ||
      msg.includes("app-update.yml") ||
      msg.includes("ENOENT") ||
      msg.includes("Cannot find") ||
      msg.includes("ERR_NON_2XX_3XX_RESPONSE") ||
      msg.includes("dev update config")
    ) {
      _updateState({ status: "not-available", error: null });
      return;
    }

    _updateState({ status: "error", error: msg });
  });

  autoUpdater.on("download-progress", (progress) => {
    _logEvent("download_progress", { percent: progress.percent });
    _updateState({ status: "downloading", count: Math.round(progress.percent || 0) });
    _sendToRenderer("updater:progress", {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", async (info) => {
    console.log(`[updater] Update v${info.version} downloaded.`);
    lastUpdateInfo = info;
    _logEvent("update_downloaded", { version: info.version });
    _updateState({ status: "ready-to-install", version: info.version });
  });

  // ── Register IPC Handlers for Updater ────────────────────────────────────
  ipcMain.handle("updater:check", async () => {
    if (!UPDATE_CHECKS_ENABLED) return { skipped: true, reason: "release-metadata-unavailable" };
    if (checkInProgress) return { checking: true };
    try {
      checkInProgress = true;
      _logEvent("manual_check_requested");
      const res = await autoUpdater.checkForUpdates();
      
      // When checkForUpdates returns null/undefined or res.updateInfo is missing,
      // it means electron-updater determined the app is up to date (or unpacked mode).
      if (!res || !res.updateInfo) {
        _updateState({ status: "not-available", error: null });
        return { ok: true, upToDate: true };
      }

      if (res.updateInfo) {
        _updateState({ status: "available", version: res.updateInfo.version, releaseNotes: res.updateInfo.releaseNotes, error: null });
      }

      return { ok: true, updateInfo: res.updateInfo };
    } catch (err) {
      const msg = String(err?.message || "");
      console.log("[updater] Check error:", msg);
      _logEvent("check_error", { message: msg });
      
      // If 404 / latest.yml missing on GitHub or dev config, treat gracefully as up-to-date
      if (
        msg.includes("404") ||
        msg.includes("latest.yml") ||
        msg.includes("app-update.yml") ||
        msg.includes("ENOENT") ||
        msg.includes("ERR_NON_2XX_3XX_RESPONSE") ||
        msg.includes("dev update config")
      ) {
        _updateState({ status: "not-available", error: null });
        return { ok: true, upToDate: true };
      }
      
      _updateState({ status: "error", error: msg });
      return { ok: false, error: msg };
    } finally {
      checkInProgress = false;
    }
  });

  ipcMain.handle("updater:download", async () => {
    if (operationsState.active) {
      _updateState({ status: "blocked", reason: operationsState.reason || "operations-active", route: operationsState.route });
      return { blocked: true, reason: operationsState.reason || "operations-active" };
    }
    try {
      _logEvent("download_requested");
      _updateState({ status: "downloading", error: null });
      return await autoUpdater.downloadUpdate();
    } catch (err) {
      _logEvent("download_failed", { error: err.message });
      _updateState({ status: "error", error: err.message });
      return { error: err.message };
    }
  });

  ipcMain.handle("updater:install", async () => {
    if (operationsState.active) {
      _logEvent("install_blocked", { reason: operationsState.reason || "operations-active", route: operationsState.route });
      _updateState({ status: "blocked", reason: operationsState.reason || "operations-active", route: operationsState.route });
      return { blocked: true, reason: operationsState.reason || "operations-active" };
    }

    try {
      const pending = typeof db.getPendingOutbox === "function" ? db.getPendingOutbox() : [];
      if (Array.isArray(pending) && pending.length > 0) {
        _logEvent("install_blocked", { reason: "pending-outbox", count: pending.length });
        _updateState({ status: "blocked", reason: "pending-outbox", count: pending.length });
        return { blocked: true, reason: "pending-outbox", count: pending.length };
      }

      _logEvent("pre_install_backup_started");
      const BACKUP_TIMEOUT_MS = 60000;
      const paths = [db.getPath(), path.join(app.getPath("userData"), "database", "istore.db")];
      for (const databasePath of new Set(paths)) {
        if (databasePath && fs.existsSync(databasePath)) {
          await Promise.race([
            createBackup(databasePath),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Pre-install backup timed out after 60s")), BACKUP_TIMEOUT_MS)
            ),
          ]);
        }
      }
      _logEvent("pre_install_backup_completed");

      db.close();
      if (stopBackendFn) {
        try {
          await Promise.resolve(stopBackendFn());
        } catch (_err) {
        }
      }
      _logEvent("quit_and_install");

      // Close/destroy all open Electron browser windows to prevent app.quit() from hanging
      const { BrowserWindow } = require("electron");
      BrowserWindow.getAllWindows().forEach((w) => {
        try {
          w.removeAllListeners("close");
          w.destroy();
        } catch (_e) {}
      });

      // Launch NSIS silent installer and restart
      setTimeout(() => {
        autoUpdater.quitAndInstall(false, true);
      }, 300);

      return { installing: true };
    } catch (error) {
      console.error("[updater] Backup failed before install:", error);
      _logEvent("pre_install_failed", { error: error.message });
      _sendToRenderer("updater:status", { status: "backup-failed", error: error.message });
      return { error: error.message };
    }
  });

  ipcMain.handle("updater:getVersion", () => {
    return { version: app.getVersion() };
  });

  ipcMain.handle("updater:getState", () => {
    return currentUpdaterState;
  });

  ipcMain.handle("updater:setOperationsActive", (_e, active, detail = {}) => {
    operationsState = {
      active: Boolean(active),
      reason: detail?.reason || null,
      route: detail?.route || null,
    };
    _logEvent("operations_state", operationsState);
    return operationsState;
  });

  if (UPDATE_CHECKS_ENABLED && process.env.NODE_ENV !== "development" && require("electron").app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        _logEvent("background_check_failed", { error: err.message });
      });
    }, 5_000);
  }
}

function _sendToRenderer(channel, data) {
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send(channel, data);
  }
}

module.exports = { initAutoUpdater };
