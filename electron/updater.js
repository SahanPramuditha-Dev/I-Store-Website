/**
 * updater.js – Auto-Update Controller
 * =====================================
 * Manages GitHub Releases auto-update checks, downloads, pre-update DB backups,
 * and restart-and-install flow using electron-updater.
 */

"use strict";

const { autoUpdater } = require("electron-updater");
const { ipcMain } = require("electron");
const db = require("./local-db");
const { createBackup } = require("./db-backup");

let _mainWindow = null;

function initAutoUpdater(win) {
  _mainWindow = win;

  // Logging configuration
  autoUpdater.logger = console;
  autoUpdater.autoDownload = true; // Auto-download updates when found
  autoUpdater.autoInstallOnAppQuit = true;

  // ── Event Handlers ────────────────────────────────────────────────────────
  autoUpdater.on("checking-for-update", () => {
    console.log("[updater] Checking for update...");
    _sendToRenderer("updater:status", { status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[updater] Update available: v${info.version}`);
    _sendToRenderer("updater:status", {
      status: "available",
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[updater] App is up to date.");
    _sendToRenderer("updater:status", { status: "not-available" });
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater] Error during update:", err.message);
    _sendToRenderer("updater:status", { status: "error", error: err.message });
  });

  autoUpdater.on("download-progress", (progress) => {
    _sendToRenderer("updater:progress", {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", async (info) => {
    console.log(`[updater] Update v${info.version} downloaded. Creating DB backup before restart...`);
    _sendToRenderer("updater:status", { status: "downloaded", version: info.version });

    try {
      // 1. Flush in-memory DB to disk
      db.close();

      // 2. Perform DB Backup
      const dbPath = db.getPath();
      const backupPath = await createBackup(dbPath);

      // 3. Re-open DB for continued usage until restart
      await db.open();

      console.log(`[updater] DB backed up successfully to ${backupPath}. Ready to install.`);
      _sendToRenderer("updater:status", { status: "ready-to-install", version: info.version });
    } catch (err) {
      console.error("[updater] Backup failed prior to update installation:", err);
      _sendToRenderer("updater:status", {
        status: "backup-failed",
        error: `Database backup failed prior to update: ${err.message}`,
      });
    }
  });

  // ── Register IPC Handlers for Updater ────────────────────────────────────
  ipcMain.handle("updater:check", async () => {
    try {
      return await autoUpdater.checkForUpdates();
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle("updater:install", () => {
    console.log("[updater] Quitting and installing update...");
    // Flush DB before quitting
    db.close();
    autoUpdater.quitAndInstall(false, true);
  });

  // Check for updates shortly after launch (skip in dev mode if not configured)
  if (process.env.NODE_ENV !== "development") {
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        console.warn("[updater] Background update check failed:", err.message);
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
