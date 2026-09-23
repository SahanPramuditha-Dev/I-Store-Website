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

const { app, BrowserWindow, shell, ipcMain, Menu, Tray, dialog, powerSaveBlocker } = require("electron");
const os = require("os");
app.disableHardwareAcceleration();
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const db   = require("./local-db");
const syncBridge = require("./sync-bridge");
const { initAutoUpdater } = require("./updater");
const { ESTORE_PUBLIC_KEY_B64, loadCachedLicense } = require("./license-manager");
const { getLicensedTenantCode, resolveTenantDataRoot } = require("./tenant-data-root");
const { createWhatsAppService } = require("./whatsapp-service");

const isDev = process.env.NODE_ENV === "development";
// Select a startup profile from the actual workstation capacity. A 4 GB POS
// PC is a low-end Chromium device once Windows, Electron and the local API
// are running, while a well-equipped terminal should keep the normal profile.
// Support can still explicitly force or disable the low-resource profile.
const totalMemoryBytes = os.totalmem();
const totalMemoryGiB = Math.round((totalMemoryBytes / (1024 ** 3)) * 10) / 10;
const logicalCpuCores = Math.max(1, os.cpus()?.length || 1);
const automaticLowResourceMode = totalMemoryBytes <= 6 * 1024 * 1024 * 1024
  // Older dual-core i3 terminals with 8 GB can also become unresponsive when
  // Windows and a barcode/print workload are active.
  || (totalMemoryBytes <= 8 * 1024 * 1024 * 1024 && logicalCpuCores <= 2);
const lowMemoryMode = process.env.ISTORE_LOW_MEMORY_MODE === "1"
  || (process.env.ISTORE_LOW_MEMORY_MODE !== "0" && automaticLowResourceMode);
const performanceProfile = lowMemoryMode ? "low-resource" : "standard";

if (lowMemoryMode) {
  // These are non-essential Chromium services. Disabling them reduces idle
  // cache/process pressure; the POS remains fully local and offline-capable.
  app.commandLine.appendSwitch("enable-low-end-device-mode");
  app.commandLine.appendSwitch("disable-component-update");
  app.commandLine.appendSwitch("disable-background-networking");
  app.commandLine.appendSwitch("disable-features", [
    "BackForwardCache",
    "MediaRouter",
    "Translate",
    "OptimizationHints",
    "AutofillServerCommunication",
    "CertificateTransparencyComponentUpdater",
  ].join(","));
  // Keep Chromium disk caches bounded. This prevents a long-running cashier
  // session from retaining an unnecessarily large image/HTTP cache.
  app.commandLine.appendSwitch("disk-cache-size", "33554432");
  app.commandLine.appendSwitch("media-cache-size", "8388608");
}
let backendProcess = null;
let backendLogHandle = null;
let mainWindow = null;
let tray = null;
let trayHintShown = false;
let exitGuard = { hasCart: false, pendingSync: false, activeShift: false };
let sleepBlockerId = null;
let shutdownPromise = null;

function updateSleepBlocker() {
  const shouldStayAwake = Boolean(exitGuard.activeShift);
  if (shouldStayAwake && sleepBlockerId === null) {
    sleepBlockerId = powerSaveBlocker.start("prevent-app-suspension");
  } else if (!shouldStayAwake && sleepBlockerId !== null) {
    powerSaveBlocker.stop(sleepBlockerId);
    sleepBlockerId = null;
  }
}

async function requestAppExit() {
  const reasons = [];
  if (exitGuard.hasCart) reasons.push("a sale is still in the cart");
  if (exitGuard.pendingSync) reasons.push("changes are waiting to sync");
  if (exitGuard.activeShift) reasons.push("a shift is still open");

  if (reasons.length) {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Exit E Store?",
      message: "Important POS work is still active.",
      detail: `Before exiting, ${reasons.join(", ")}. You can minimise E Store to keep working.`,
      buttons: ["Cancel", "Exit anyway"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) return false;
  }
  app.quit();
  return true;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return tray;

  // This file is packaged with the renderer, so it is available both from the
  // development checkout and inside app.asar in the installed desktop app.
  tray = new Tray(path.join(__dirname, "frontend-dist", "favicon.ico"));
  tray.setToolTip("E Store POS");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open POS", click: showMainWindow },
    { type: "separator" },
    {
      label: "Exit E Store",
      click: () => {
        // `before-quit` performs the database/backend cleanup.
        requestAppExit();
      },
    },
  ]));
  tray.on("click", showMainWindow);
  return tray;
}

function resolveBaseDataRoot() {
  // Electron has no `localAppData` getPath key. On Windows, asking for it
  // throws and previously sent every installation back to the legacy nested
  // roaming directory. Use Windows' real LOCALAPPDATA location explicitly.
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "iStore");
  }
  return path.join(app.getPath("userData"), "iStore");
}

function resolveDataRoot() {
  return resolveTenantDataRoot(resolveBaseDataRoot(), loadCachedLicense());
}

function logDesktopRecoveryEvent(event, detail = "") {
  try {
    const logDirectory = path.join(resolveDataRoot(), "logs");
    fs.mkdirSync(logDirectory, { recursive: true });
    fs.appendFileSync(
      path.join(logDirectory, "desktop-recovery.log"),
      `[${new Date().toISOString()}] ${event}${detail ? `: ${detail}` : ""}\n`,
      "utf8"
    );
  } catch (_err) {
    // Never let diagnostics interfere with checkout or application recovery.
  }
}

function getLicensedTenantMetadata() {
  const cached = loadCachedLicense();
  const payload = cached?.payload || {};
  return {
    tenantCode: getLicensedTenantCode(cached),
    shopCode: String(payload.shop_code || "").trim().toUpperCase(),
    industryCode: String(payload.industry_code || "").trim().toUpperCase(),
    packageCode: String(payload.package_code || "").trim().toUpperCase(),
  };
}

function ensureDataRootMigration(legacyUserData = app.getPath("userData")) {
  const targetUserData = resolveDataRoot();
  if (path.resolve(legacyUserData) === path.resolve(targetUserData)) return;

  try {
    fs.mkdirSync(targetUserData, { recursive: true });
  } catch (_err) {
    return;
  }

  // A licensed tenant always receives a fresh, isolated data root. Never copy
  // an unbound legacy database into it: that can expose a previous store's
  // users and transactions after a new license is activated on the device.
  const tenantCode = getLicensedTenantCode(loadCachedLicense());
  if (tenantCode) {
    const marker = path.join(targetUserData, "tenant.json");
    if (!fs.existsSync(marker)) {
      fs.writeFileSync(marker, JSON.stringify({ tenant_code: tenantCode, created_at: new Date().toISOString() }, null, 2), "utf-8");
    }
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
    "license_cache.json",
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
    ISTORE_APP_VERSION: app.getVersion(),
    // Schema migration and recovery are deliberately disabled during normal
    // desktop startup.  Running them while SQLite/WAL files are still being
    // opened can select a legacy database and leave the API unusable.
    AUTO_MIGRATE_ENABLED: "false",
    BACKUP_BEFORE_MIGRATE: "false",
    ALLOW_RUNTIME_SCHEMA_SYNC: "true",
    SQLITE_FILE: path.join(databaseDirectory, "istore.db"),
    BACKUP_FOLDER: backupsDirectory,
    // The device-bound license is shared by the application, while business
    // data below is isolated per licensed tenant.
    LICENSE_CACHE_FILE: path.join(resolveBaseDataRoot(), "license_cache.json"),
    ESTORE_PUBLIC_KEY_B64,
    ISTORE_TENANT_CODE: getLicensedTenantMetadata().tenantCode,
    ISTORE_SHOP_CODE: getLicensedTenantMetadata().shopCode,
    ISTORE_INDUSTRY_CODE: getLicensedTenantMetadata().industryCode,
    ISTORE_PACKAGE_CODE: getLicensedTenantMetadata().packageCode,
    ESTORE_LICENSE_SERVER_URL: process.env.ESTORE_LICENSE_SERVER_URL || "https://e-store-control-center-backend.vercel.app",
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
  if (backendProcess) {
    const pid = backendProcess.pid;
    try {
      if (process.platform === "win32" && pid) {
        const { execSync } = require("child_process");
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
      } else {
        backendProcess.kill("SIGKILL");
      }
    } catch (_err) {
    }
    backendProcess = null;
  }
  if (backendLogHandle) {
    try { fs.closeSync(backendLogHandle); } catch (_e) {}
    backendLogHandle = null;
  }
}

// ── Prevent multiple instances ─────────────────────────────────────────────
// Electron scopes its single-instance lock to userData. Select the licensed
// tenant profile first so stale or differently branded installations cannot
// cause a valid E Store launch to exit silently.
const legacyUserDataRoot = app.getPath("userData");
const startupDataRoot = resolveDataRoot();
fs.mkdirSync(startupDataRoot, { recursive: true });
app.setPath("userData", startupDataRoot);
const whatsappService = createWhatsAppService({ app, baseDataRoot: resolveBaseDataRoot() });

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

  // Intercept window.open / target="_blank" links.
  // Allow internal app popups for same-origin routes, but open external links in the default browser.
  contents.setWindowOpenHandler(({ url }) => {
    try {
      const openerUrl = contents.getURL();
      const target = new URL(url);
      const opener = new URL(openerUrl);

      const isSameOrigin = target.protocol === opener.protocol && target.host === opener.host;
      const isSameFilePath = target.protocol === "file:" && opener.protocol === "file:" && path.resolve(target.pathname) === path.resolve(opener.pathname);

      if (isSameOrigin || isSameFilePath) {
        return { action: "allow" };
      }

      if (target.protocol === "http:" || target.protocol === "https:" || target.protocol === "mailto:") {
        shell.openExternal(url);
      }
    } catch (_err) {
      // If URL parsing fails, deny to keep external navigation locked down.
    }
    return { action: "deny" };
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
    title: "E Store",
    webPreferences: {
      preload:            path.join(__dirname, "preload.js"),
      contextIsolation:   true,
      nodeIntegration:    false,
      sandbox:            false,   // required for preload IPC
      webSecurity:        true,
      // POS fields are codes, prices and names; Chromium's spell-check
      // dictionaries add memory but provide no useful cashier functionality.
      spellcheck:         false,
    },
    // Show window only when ready to avoid white flash
    show: false,
    backgroundColor: "#0f172a",
  });

  // Register IPC handlers
  syncBridge.register({
    onLicenseActivated: () => {
      setTimeout(() => {
        stopBackend();
        db.close();
        app.relaunch();
        app.exit(0);
      }, 750);
    },
  });

  // On entry-level terminals, prioritise checkout responsiveness over frequent
  // background work. Manual sync and reconnect-triggered sync remain instant.
  syncBridge.schedulePeriodicSync(win, lowMemoryMode ? 5 * 60 * 1000 : 2 * 60 * 1000);

  // Load the frontend
  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, "frontend-dist/index.html"));
  }

  win.once("ready-to-show", () => win.show());

  // Dedicated tills benefit from a warm renderer and local API: closing the
  // window hides it to the notification area, while the tray's explicit Exit
  // command remains the predictable way to fully close the application.
  win.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      win.hide();
      if (!trayHintShown && tray?.displayBalloon) {
        trayHintShown = true;
        tray.displayBalloon({
          title: "E Store is still running",
          content: "Use the notification-area icon to reopen POS or exit it safely.",
        });
      }
    }
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
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
  ensureDataRootMigration(legacyUserDataRoot);
  startBackend();
  await initDatabase();
  mainWindow = createWindow();
  createTray();
  initAutoUpdater(mainWindow, { stopBackend });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      initAutoUpdater(mainWindow);
    } else {
      showMainWindow();
    }
  });

  ipcMain.removeHandler("app:setExitGuard");
  ipcMain.handle("app:setExitGuard", (event, nextGuard = {}) => {
    if (event.sender !== mainWindow?.webContents) return false;
    exitGuard = {
      hasCart: Boolean(nextGuard.hasCart),
      pendingSync: Boolean(nextGuard.pendingSync),
      activeShift: Boolean(nextGuard.activeShift),
    };
    updateSleepBlocker();
    return true;
  });

  ipcMain.removeHandler("terminal:hardwareStatus");
  ipcMain.handle("terminal:hardwareStatus", async (event) => {
    if (event.sender !== mainWindow?.webContents) return { available: false, printers: [] };
    try {
      const printers = await event.sender.getPrintersAsync();
      return {
        available: true,
        performance: {
          profile: performanceProfile,
          automatic: process.env.ISTORE_LOW_MEMORY_MODE === undefined,
          totalMemoryGiB,
          logicalCpuCores,
        },
        printers: printers.map((printer) => ({
          name: printer.name,
          isDefault: Boolean(printer.isDefault),
          status: printer.status || 0,
        })),
      };
    } catch (error) {
      return { available: false, printers: [], error: error.message };
    }
  });

  ipcMain.removeHandler("whatsapp:start");
  ipcMain.handle("whatsapp:start", async (event) => {
    if (event.sender !== mainWindow?.webContents) return { started: false, error: "Unauthorized renderer" };
    const result = await whatsappService.start();
    if (result.error) logDesktopRecoveryEvent("whatsapp-service-start-failed", result.error);
    return result;
  });
  ipcMain.removeHandler("whatsapp:stop");
  ipcMain.handle("whatsapp:stop", async (event) => {
    if (event.sender !== mainWindow?.webContents) return false;
    await whatsappService.stop();
    return true;
  });
  ipcMain.removeHandler("whatsapp:status");
  ipcMain.handle("whatsapp:status", async (event) => {
    if (event.sender !== mainWindow?.webContents) return { online: false };
    return whatsappService.status();
  });
});

app.on("window-all-closed", () => {
  // A renderer termination can destroy the last BrowserWindow. Keep the POS
  // process and tray alive so the recovery handler can rebuild the window.
  if (process.platform === "darwin" && !app.isQuitting) return;
  if (app.isQuitting) app.quit();
});

app.on("before-quit", (event) => {
  if (shutdownPromise) return;
  event.preventDefault();
  app.isQuitting = true;
  if (sleepBlockerId !== null) {
    powerSaveBlocker.stop(sleepBlockerId);
    sleepBlockerId = null;
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
  stopBackend();
  db.close();
  shutdownPromise = whatsappService.stop()
    .catch((error) => logDesktopRecoveryEvent("whatsapp-service-stop-failed", error.message))
    .finally(() => app.quit());
});

app.on("render-process-gone", (_event, _webContents, details) => {
  logDesktopRecoveryEvent("renderer-process-gone", `${details?.reason || "unknown"} (${details?.exitCode ?? "n/a"})`);
  if (app.isQuitting || _webContents !== mainWindow?.webContents) return;
  const recoverable = new Set(["crashed", "killed", "oom", "abnormal-exit", "launch-failed"]);
  if (!recoverable.has(details?.reason)) return;
  setTimeout(() => {
    if (app.isQuitting) return;
    if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
    else mainWindow.reload();
    showMainWindow();
    logDesktopRecoveryEvent("renderer-recovery-started", details?.reason || "unknown");
  }, 900);
});

app.on("child-process-gone", (_event, details) => {
  logDesktopRecoveryEvent("child-process-gone", `${details?.type || "unknown"}: ${details?.reason || "unknown"}`);
});

app.on("second-instance", (_e, _argv, _cwd) => {
  // Focus existing window when user tries to open a second instance
  showMainWindow();
});
