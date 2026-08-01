/**
 * main.js  –  Electron Main Process Entry Point
 * ================================================
 * Phase 4: Offline Engine – Main process bootstrap
 *
 * Integrates:
 *   • local-db.js   → opens encrypted SQLite on startup
 *   • sync-bridge.js → registers IPC handlers + scheduled sync
 *   • preload.js    → exposes contextBridge surface to renderer
 *
 * Environment variables:
 *   VITE_API_URL        – Backend URL (default: http://localhost:8000)
 *   ISTORE_DB_ENCRYPT   – "1" to enable SQLCipher encryption
 *   ISTORE_DB_KEY       – Encryption passphrase (min 16 chars)
 *   NODE_ENV            – "development" enables DevTools & verbose SQL
 */

"use strict";

const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const db   = require("./local-db");
const syncBridge = require("./sync-bridge");
const { initAutoUpdater } = require("./updater");

const isDev = process.env.NODE_ENV === "development";

// ── Prevent multiple instances ─────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// ── Security: disable navigation to external URLs ─────────────────────────
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-navigate", (e, url) => {
    const parsed = new URL(url);
    const allow  = parsed.origin === "http://localhost:5173" ||
                   parsed.protocol === "file:";
    if (!allow) {
      e.preventDefault();
      shell.openExternal(url);   // open in system browser instead
    }
  });
});

// ── Database bootstrap ─────────────────────────────────────────────────────
async function initDatabase() {
  try {
    await db.open();
    console.log("[main] Local database ready.");
  } catch (err) {
    console.error("[main] Failed to open local database:", err.message);
    // Non-fatal: app can still run in online-only mode
  }
}

// ── Window factory ─────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width:  1400,
    height: 900,
    minWidth:  1024,
    minHeight: 720,
    title: "I-Store ERP",
    webPreferences: {
      preload:            path.join(__dirname, "preload.js"),
      contextIsolation:   true,
      nodeIntegration:    false,
      sandbox:            false,   // required for preload IPC
      webSecurity:        true,
    },
    // Show window only when ready to avoid white flash
    show: false,
    backgroundColor: "#0f172a",
  });

  // Register IPC handlers
  syncBridge.register();

  // Schedule periodic background sync (every 2 minutes)
  syncBridge.schedulePeriodicSync(win, 2 * 60 * 1000);

  // Load the frontend
  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, "frontend-dist/index.html"));
  }

  win.once("ready-to-show", () => win.show());

  win.on("closed", () => {
    // IPC handlers auto-removed on window close
  });

  return win;
}

// ── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  await initDatabase();
  const win = createWindow();
  initAutoUpdater(win);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createWindow();
      initAutoUpdater(newWin);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  db.close();
});

app.on("second-instance", (_e, _argv, _cwd) => {
  // Focus existing window when user tries to open a second instance
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
