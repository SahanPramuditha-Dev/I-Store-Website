/**
 * updater.js – Auto-Update Controller
 * =====================================
 * Manages GitHub Releases auto-update checks, downloads, pre-update DB backups,
 * and restart-and-install flow using electron-updater.
 */

"use strict";

const { autoUpdater } = require("electron-updater");
const { app, dialog, ipcMain } = require("electron");
const db = require("./local-db");
const { createBackup } = require("./db-backup");
const fs = require("fs");
const path = require("path");

let _mainWindow = null;
let initialized = false;
let checkInProgress = false;

function initAutoUpdater(win) {
  _mainWindow = win;
  if (initialized) return;
  initialized = true;

  // Logging configuration
  autoUpdater.logger = console;
  // Never trigger another installer without an explicit user action. This
  // avoids an update download being mistaken for a second setup prompt after
  // the initial installation.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

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
    dialog.showMessageBox(_mainWindow, {
      type: "info",
      title: "Update available",
      message: `Version ${info.version} is available.`,
      detail: "Would you like to download it now? You can continue using I-Store while it downloads.",
      buttons: ["Download now", "Not now"],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.downloadUpdate();
      else _sendToRenderer("updater:status", { status: "deferred", version: info.version });
    }).catch((error) => console.error("[updater] Update prompt failed:", error.message));
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[updater] App is up to date.");
    _sendToRenderer("updater:status", { status: "not-available" });
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater] Error during update:", err.message);
    // Don't toast error to UI if it's just missing publish metadata (e.g. app-update.yml)
    if (!err.message.includes("app-update.yml") && !err.message.includes("ENOENT")) {
      _sendToRenderer("updater:status", { status: "error", error: err.message });
    }
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
    console.log(`[updater] Update v${info.version} downloaded.`);
    _sendToRenderer("updater:status", { status: "downloaded", version: info.version });
    _sendToRenderer("updater:status", { status: "ready-to-install", version: info.version });
    dialog.showMessageBox(_mainWindow, {
      type: "info",
      title: "Update ready",
      message: `Version ${info.version} has been downloaded.`,
      detail: "Restart when convenient to install it. Your POS data will be backed up immediately before the restart.",
      buttons: ["Later"],
    }).catch(() => {});
  });

  // ── Register IPC Handlers for Updater ────────────────────────────────────
  ipcMain.handle("updater:check", async () => {
    if (!app.isPackaged) return { skipped: true, reason: "Updates are available only in installed releases." };
    if (checkInProgress) return { checking: true };
    try {
      checkInProgress = true;
      return await autoUpdater.checkForUpdates();
    } catch (err) {
      return { error: err.message };
    } finally {
      checkInProgress = false;
    }
  });

  ipcMain.handle("updater:install", async () => {
    const { response } = await dialog.showMessageBox(_mainWindow, {
      type: "question",
      title: "Install update",
      message: "Restart and install the downloaded update?",
      detail: "The current POS databases will be backed up before the application restarts.",
      buttons: ["Restart and install", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return { cancelled: true };

    try {
      const paths = [db.getPath(), path.join(app.getPath("userData"), "database", "istore.db")];
      for (const databasePath of new Set(paths)) {
        if (databasePath && fs.existsSync(databasePath)) await createBackup(databasePath);
      }
      db.close();
      autoUpdater.quitAndInstall(false, true);
      return { installing: true };
    } catch (error) {
      console.error("[updater] Backup failed before install:", error);
      _sendToRenderer("updater:status", { status: "backup-failed", error: error.message });
      return { error: error.message };
    }
  });

  // Check for updates silently shortly after launch in production mode
  if (process.env.NODE_ENV !== "development" && require("electron").app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
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
