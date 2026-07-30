/**
 * scripts/extract-electron.js
 * ============================
 * One-time setup helper for developers on Node 24+ who encounter the
 * "Electron failed to install correctly" error.
 *
 * Problem:
 *   Electron's postinstall downloads its binary via @electron/get (uses got/HTTPS).
 *   On Node 24, the TLS CA store changed and corporate/proxy certificates may not
 *   be trusted, causing silent download failures even though the zip ends up cached.
 *
 * Solution:
 *   1. Find the cached Electron zip in %LOCALAPPDATA%\electron\Cache
 *   2. Extract it to node_modules/electron/dist
 *
 * Usage:
 *   node scripts/extract-electron.js
 *   # or: npm run setup:electron
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { execSync } = require("child_process");

// ── Resolve expected Electron version from package.json ──────────────────
const pkg             = require("../node_modules/electron/package.json");
const electronVersion = pkg.version;  // e.g. "31.7.7"
const platform        = process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
const arch            = process.arch;  // "x64" or "arm64"
const zipName         = `electron-v${electronVersion}-${platform}-${arch}.zip`;

// ── Resolve cache directory ───────────────────────────────────────────────
const cacheBase = process.platform === "win32"
  ? path.join(os.homedir(), "AppData", "Local", "electron", "Cache")
  : path.join(os.homedir(), ".cache", "electron");

// ── Find the zip (may be in a hash-named subfolder on Windows) ───────────
let zipPath = null;

if (fs.existsSync(cacheBase)) {
  const entries = fs.readdirSync(cacheBase, { withFileTypes: true });

  // Direct match (Linux/Mac style)
  const direct = path.join(cacheBase, zipName);
  if (fs.existsSync(direct)) {
    zipPath = direct;
  } else {
    // Windows: zip lives inside a hash-named subdirectory
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const candidate = path.join(cacheBase, entry.name, zipName);
        if (fs.existsSync(candidate)) {
          zipPath = candidate;
          break;
        }
      }
    }
  }
}

if (!zipPath) {
  console.error(`\n[setup] ✗ Could not find cached Electron zip: ${zipName}`);
  console.error(`  Looked in: ${cacheBase}`);
  console.error(`\n  Try running:\n    NODE_TLS_REJECT_UNAUTHORIZED=0 node node_modules/electron/install.js\n`);
  process.exit(1);
}

console.log(`[setup] Found cached zip:\n  ${zipPath}`);

// ── Extract to dist/ ─────────────────────────────────────────────────────
const distDir = path.join(__dirname, "..", "node_modules", "electron", "dist");
fs.mkdirSync(distDir, { recursive: true });

console.log(`[setup] Extracting to:\n  ${distDir}`);

try {
  if (process.platform === "win32") {
    // PowerShell Expand-Archive is available on all Windows 10+ systems
    execSync(
      `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${distDir}' -Force"`,
      { stdio: "inherit" }
    );
  } else {
    execSync(`unzip -o "${zipPath}" -d "${distDir}"`, { stdio: "inherit" });
  }
} catch (err) {
  console.error("[setup] ✗ Extraction failed:", err.message);
  process.exit(1);
}

// ── Verify ───────────────────────────────────────────────────────────────
const binary = process.platform === "win32"
  ? path.join(distDir, "electron.exe")
  : path.join(distDir, "electron");

if (fs.existsSync(binary)) {
  console.log(`\n[setup] ✓ Electron ${electronVersion} is ready.\n`);
  console.log(`  To start dev mode:\n    npm run dev\n`);
} else {
  console.error(`\n[setup] ✗ Binary not found after extraction: ${binary}`);
  process.exit(1);
}
