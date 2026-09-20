/**
 * db-backup.js – Automated Database Backup Service
 * =================================================
 * System for creating timestamped backups of the local SQLite database
 * before application updates or on user demand.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { createHash, randomUUID } = require("crypto");
const runFile = promisify(execFile);

/**
 * Creates a timestamped backup of the local database file.
 * 
 * @param {string} dbPath - Full path to current database file.
 * @returns {Promise<string>} - Resolves with the path to created backup file.
 */
async function createBackup(dbPath, { snapshot } = {}) {
  if (!dbPath || !fs.existsSync(dbPath)) {
    throw new Error(`[db-backup] Cannot backup: database file not found at "${dbPath}"`);
  }

  const userDataDir = app.getPath("userData");
  const backupDir = path.join(userDataDir, "backups");

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const identity = path.basename(dbPath).replace(/[^a-zA-Z0-9_-]/g, "_");
  const backupPath = path.join(backupDir, `istore-db-backup_${identity}_${timestamp}_${randomUUID()}.db`);
  const temporaryPath = `${backupPath}.partial`;
  try {
    if (snapshot) {
      await snapshot(temporaryPath);
    } else {
      const executable = app.isPackaged
        ? path.join(process.resourcesPath, "backend", "IStoreBackend.exe")
        : path.join(__dirname, "..", ".venv", "Scripts", "python.exe");
      const args = app.isPackaged ? [] : [path.join(__dirname, "..", "backend", "desktop_server.py")];
      await runFile(executable, [...args, "--backup-sqlite", dbPath, temporaryPath], { timeout: 55000, windowsHide: true });
    }
    fs.renameSync(temporaryPath, backupPath);
    const checksum = createHash("sha256").update(fs.readFileSync(backupPath)).digest("hex");
    fs.writeFileSync(`${backupPath}.sha256`, checksum, { encoding: "utf-8", flag: "wx" });
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }

  console.log(`[db-backup] Successfully created database backup at: ${backupPath}`);
  
  // Clean up backups older than 30 days
  _cleanupOldBackups(backupDir, 30);

  return backupPath;
}

/**
 * Purge backups older than maxAgeDays.
 */
function _cleanupOldBackups(backupDir, maxAgeDays = 30) {
  try {
    const files = fs.readdirSync(backupDir);
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.startsWith("istore-db-backup_")) continue;
      const filePath = path.join(backupDir, file);
      const stats = fs.statSync(filePath);

      if (now - stats.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
        const checksumPath = `${filePath}.sha256`;
        if (fs.existsSync(checksumPath)) fs.unlinkSync(checksumPath);
        console.log(`[db-backup] Cleaned up old backup: ${file}`);
      }
    }
  } catch (err) {
    console.warn("[db-backup] Warning during old backup cleanup:", err.message);
  }
}

module.exports = { createBackup };
