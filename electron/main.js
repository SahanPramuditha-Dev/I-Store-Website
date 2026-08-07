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
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const db   = require("./local-db");
const syncBridge = require("./sync-bridge");
const { initAutoUpdater } = require("./updater");

const isDev = process.env.NODE_ENV === "development";
let backendProcess = null;
let backendLogHandle = null;

function resolveDataRoot() {
  try {
    return path.join(app.getPath("localAppData"), "iStore");
  } catch (_err) {
    return path.join(app.getPath("userData"), "iStore");
  }
}

function ensureDataRootMigration() {
  const legacyUserData = app.getPath("userData");
  const targetUserData = resolveDataRoot();
  if (path.resolve(legacyUserData) === path.resolve(targetUserData)) return;

  try {
    fs.mkdirSync(targetUserData, { recursive: true });
  } catch (_err) {
    return;
  }

  const migrationMarker = path.join(targetUserData, "migration.json");
  if (fs.existsSync(migrationMarker)) return;

  const candidates = [
    "database",
    "uploads",
    "logs",
    "backups",
    "istore-local.db",
  ];
  const legacyPaths = [
    legacyUserData,
    path.join(app.getPath("appData"), "istore-electron", "iStore", "iStore"),
    path.join(app.getPath("appData"), "istore-electron", "iStore"),
    path.join(app.getPath("appData"), "istore-electron"),
    path.join(app.getPath("appData"), "iStore"),
  ];

  for (const legacyDir of legacyPaths) {
    if (!fs.existsSync(legacyDir)) continue;

    for (const item of candidates) {
      const src = path.join(legacyDir, item);
      const dest = path.join(targetUserData, item);

      if (!fs.existsSync(src)) continue;

      try {
        if (fs.statSync(src).isDirectory()) {
          if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
          }
          const files = fs.readdirSync(src);
          for (const f of files) {
            const fSrc = path.join(src, f);
            const fDest = path.join(dest, f);
            if (!fs.existsSync(fDest) || f === "istore.db") {
              fs.copyFileSync(fSrc, fDest);
            }
          }
        } else if (!fs.existsSync(dest) || item === "istore.db") {
          fs.copyFileSync(src, dest);
        }
      } catch (_err) {
      }
    }
  }

  try {
    fs.writeFileSync(
      migrationMarker,
      JSON.stringify(
        {
          migrated_at: new Date().toISOString(),
          from: legacyUserData,
          to: targetUserData,
        },
        null,
        2
      ),
      "utf-8"
    );
  } catch (_err) {
  }
}

// ── Local API service ─────────────────────────────────────────────────────
// The renderer always talks to 127.0.0.1:8000 in Electron. During source
// development use the repository virtual environment; release builds use the
// backend executable staged by the release builder.
function startBackend() {
  const executable = app.isPackaged
    ? path.join(process.resourcesPath, "backend", "IStoreBackend.exe")
    : path.join(__dirname, "..", ".venv", "Scripts", "python.exe");
  const args = app.isPackaged
    ? []
    : ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"];
  const cwd = app.isPackaged ? path.dirname(executable) : path.join(__dirname, "..");
  const dataDirectory = resolveDataRoot();
  const databaseDirectory = path.join(dataDirectory, "database");
  const backupsDirectory = path.join(dataDirectory, "backups");
  const uploadsDirectory = path.join(dataDirectory, "uploads");
  const logsDirectory = path.join(dataDirectory, "logs");
  const backendLogPath = path.join(dataDirectory, "backend.log");

  // The installed application's resources live under Program Files and are
  // read-only for standard users. Persist backend data outside that folder.
  fs.mkdirSync(databaseDirectory, { recursive: true });
  fs.mkdirSync(backupsDirectory, { recursive: true });
  fs.mkdirSync(uploadsDirectory, { recursive: true });
  fs.mkdirSync(logsDirectory, { recursive: true });

  if (!fs.existsSync(executable)) {
    console.error(`[main] Local backend executable was not found: ${executable}`);
    fs.appendFileSync(backendLogPath, `[${new Date().toISOString()}] Backend executable not found: ${executable}\n`);
    return;
  }

  try {
    backendLogHandle = fs.openSync(backendLogPath, "a");
    fs.writeSync(backendLogHandle, `\n[${new Date().toISOString()}] Starting backend: ${executable}\n`);
  } catch (error) {
    console.error("[main] Failed to open backend log:", error.message);
  }

  const backendEnv = {
    ...process.env,
    PYTHONPATH: app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "backend"),
    ISTORE_API_HOST: "127.0.0.1",
    ISTORE_API_PORT: "8000",
    ISTORE_UPLOADS_DIR: uploadsDirectory,
    ISTORE_BACKEND_LOG_FILE: path.join(logsDirectory, "backend-api.log"),
    // Explicitly set the data root so the backend EXE always uses the correct
    // user data directory regardless of how LOCALAPPDATA or userData resolves.
    ISTORE_DATA_ROOT: dataDirectory,
    // Schema migration and recovery are deliberately disabled during normal
    // desktop startup.  Running them while SQLite/WAL files are still being
    // opened can select a legacy database and leave the API unusable.
    AUTO_MIGRATE_ENABLED: "false",
    BACKUP_BEFORE_MIGRATE: "false",
    ALLOW_RUNTIME_SCHEMA_SYNC: "true",
    SQLITE_FILE: path.join(databaseDirectory, "istore.db"),
    BACKUP_FOLDER: backupsDirectory,
    // Do not set DATABASE_URL here. config.py derives it from SQLITE_FILE,
    // preserving SQLite's Windows path handling in one place.
  };

  backendProcess = spawn(executable, args, {
    cwd,
    windowsHide: true,
    env: backendEnv,
    stdio: ["ignore", backendLogHandle || "ignore", backendLogHandle || "ignore"],
  });
  backendProcess.on("error", (error) => console.error("[main] Failed to start local backend:", error.message));
  backendProcess.on("exit", (code) => {
    if (!app.isQuitting && code !== 0) console.error(`[main] Local backend exited unexpectedly (${code}).`);
    backendProcess = null;
  });
}

function stopBackend() {
  if (backendProcess && !backendProcess.killed) backendProcess.kill();
  backendProcess = null;
  if (backendLogHandle) {
    fs.closeSync(backendLogHandle);
    backendLogHandle = null;
  }
}

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

  // Auto-launch on Windows startup IPC handlers
  ipcMain.handle("app:getAutoLaunch", () => {
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle("app:setAutoLaunch", (_e, openAtLogin) => {
    app.setLoginItemSettings({
      openAtLogin: Boolean(openAtLogin),
      path: app.getPath("exe"),
    });
    return app.getLoginItemSettings().openAtLogin;
  });

  return win;
}

// ── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  const targetUserData = resolveDataRoot();
  ensureDataRootMigration();
  app.setPath("userData", targetUserData);
  startBackend();
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
  app.isQuitting = true;
  stopBackend();
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
