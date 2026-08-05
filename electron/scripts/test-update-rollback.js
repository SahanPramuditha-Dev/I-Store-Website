#!/usr/bin/env node
/**
 * test-update-rollback.js
 * ========================
 * End-to-end smoke test for the iStore update-backup-rollback workflow.
 * 
 * Validates:
 * - Database backup creation before update
 * - Pre-install backup verification
 * - Simulated update failure and rollback
 * - Update log entries
 * 
 * Usage:
 *   node scripts/test-update-rollback.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const crypto = require("crypto");
const sqlite3 = require("sqlite3");

const TEST_DIR = path.join(__dirname, "..", "test-workspace");
const TEST_DB = path.join(TEST_DIR, "database", "test.db");
const TEST_BACKUP_DIR = path.join(TEST_DIR, "backups");
const TEST_LOG_DIR = path.join(TEST_DIR, "logs");
const UPDATE_LOG = path.join(TEST_LOG_DIR, "update.log");

let testsPassed = 0;
let testsFailed = 0;

function log(msg) {
  console.log(`[test] ${msg}`);
}

function logError(msg) {
  console.error(`[ERROR] ${msg}`);
}

function logSuccess(msg) {
  console.log(`[✓] ${msg}`);
  testsPassed++;
}

function logFail(msg) {
  console.error(`[✗] ${msg}`);
  testsFailed++;
}

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch (err) {
      log(`Warning: Could not fully clean up test directory: ${err.message}`);
    }
  }
}

function setup() {
  log("Setting up test environment...");
  cleanup();
  fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
  fs.mkdirSync(TEST_BACKUP_DIR, { recursive: true });
  fs.mkdirSync(TEST_LOG_DIR, { recursive: true });
  logSuccess("Test workspace created");
}

function createTestDatabase() {
  log("Creating test database...");
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(TEST_DB, (err) => {
      if (err) {
        reject(err);
        return;
      }
      db.serialize(() => {
        db.run("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)", (err) => {
          if (err) reject(err);
        });
        db.run("INSERT INTO items (name) VALUES ('test-item-1')", (err) => {
          if (err) reject(err);
        });
        db.run("INSERT INTO items (name) VALUES ('test-item-2')", (err) => {
          if (err) reject(err);
          db.close(() => resolve());
        });
      });
    });
  });
}

function verifyDatabaseIntegrity(dbPath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(dbPath)) {
      reject(new Error(`Database not found: ${dbPath}`));
      return;
    }
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        resolve(0);
        return;
      }
      db.all("SELECT COUNT(*) as count FROM items", (err, rows) => {
        if (err) {
          db.close(() => resolve(0));
          return;
        }
        const count = rows[0]?.count || 0;
        db.close(() => resolve(count));
      });
    });
  });
}

function simulateBackupCreation() {
  log("Simulating backup creation...");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(TEST_BACKUP_DIR, `manual_${timestamp}.sqlite`);
  
  try {
    fs.copyFileSync(TEST_DB, backupPath);
    
    const checksum = crypto
      .createHash("sha256")
      .update(fs.readFileSync(backupPath))
      .digest("hex");
    
    fs.writeFileSync(`${backupPath}.sha256`, checksum);
    logSuccess(`Backup created: ${path.basename(backupPath)}`);
    
    return backupPath;
  } catch (err) {
    throw new Error(`Backup creation failed: ${err.message}`);
  }
}

function logUpdateEvent(event, payload = {}) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    event,
    ...payload
  });
  fs.appendFileSync(UPDATE_LOG, `${line}\n`, "utf-8");
}

function simulatePreInstallBackup() {
  log("Simulating pre-install backup flow...");
  logUpdateEvent("checking_for_update");
  logUpdateEvent("update_available", { version: "1.1.16" });
  
  const backupPath = simulateBackupCreation();
  logUpdateEvent("pre_install_backup_started");
  logUpdateEvent("pre_install_backup_completed", { backup: path.basename(backupPath) });
  
  logSuccess("Pre-install backup flow completed");
  return backupPath;
}

function simulateUpdateFailure() {
  log("Simulating update failure (corrupting database)...");
  logUpdateEvent("quit_and_install");
  
  try {
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
    fs.writeFileSync(TEST_DB, Buffer.alloc(0));
    logSuccess("Database corrupted to simulate update failure");
  } catch (err) {
    throw new Error(`Failed to corrupt database: ${err.message}`);
  }
}

function restoreFromBackup(backupPath) {
  log("Restoring from backup...");
  logUpdateEvent("restore_started", { backup: path.basename(backupPath) });
  
  try {
    fs.copyFileSync(backupPath, TEST_DB);
    
    const walFile = `${TEST_DB}-wal`;
    const shmFile = `${TEST_DB}-shm`;
    if (fs.existsSync(walFile)) fs.unlinkSync(walFile);
    if (fs.existsSync(shmFile)) fs.unlinkSync(shmFile);
    
    logUpdateEvent("restore_completed", { backup: path.basename(backupPath) });
    logSuccess("Database restored from backup");
  } catch (err) {
    logUpdateEvent("restore_failed", { error: err.message });
    throw new Error(`Restore failed: ${err.message}`);
  }
}

function verifyUpdateLog() {
  log("Verifying update log...");
  
  if (!fs.existsSync(UPDATE_LOG)) {
    logFail("Update log not found");
    return;
  }
  
  const logLines = fs
    .readFileSync(UPDATE_LOG, "utf-8")
    .split("\n")
    .filter((line) => line.trim());
  
  const expectedEvents = [
    "checking_for_update",
    "update_available",
    "pre_install_backup_started",
    "pre_install_backup_completed",
    "quit_and_install",
    "restore_started",
    "restore_completed"
  ];
  
  let allFound = true;
  for (const event of expectedEvents) {
    const found = logLines.some((line) => {
      try {
        const obj = JSON.parse(line);
        return obj.event === event;
      } catch {
        return false;
      }
    });
    
    if (found) {
      logSuccess(`Update log contains: ${event}`);
    } else {
      logFail(`Update log missing: ${event}`);
      allFound = false;
    }
  }
  
  return allFound;
}

async function runTests() {
  log("\n========================================");
  log("iStore Update-Rollback Smoke Test");
  log("========================================\n");
  
  try {
    setup();
    
    log("\n--- Phase 1: Create and verify test database ---");
    await createTestDatabase();
    logSuccess("Test database created");
    
    const initialCount = await verifyDatabaseIntegrity(TEST_DB);
    if (initialCount === 2) {
      logSuccess(`Database contains ${initialCount} items (pre-backup state)`);
    } else {
      logFail(`Expected 2 items, got ${initialCount}`);
    }
    
    log("\n--- Phase 2: Create pre-install backup ---");
    const backupPath = simulatePreInstallBackup();
    
    if (fs.existsSync(backupPath)) {
      logSuccess("Backup file exists");
    } else {
      logFail("Backup file not found");
    }
    
    const checksumFile = `${backupPath}.sha256`;
    if (fs.existsSync(checksumFile)) {
      logSuccess("Backup checksum file created");
    } else {
      logFail("Backup checksum not found");
    }
    
    log("\n--- Phase 3: Simulate update failure ---");
    simulateUpdateFailure();
    
    const corruptedCount = await verifyDatabaseIntegrity(TEST_DB);
    if (corruptedCount === 0) {
      logSuccess("Database is corrupted (as expected)");
    } else {
      logFail(`Expected empty database, got ${corruptedCount} items`);
    }
    
    log("\n--- Phase 4: Restore from backup ---");
    restoreFromBackup(backupPath);
    
    const restoredCount = await verifyDatabaseIntegrity(TEST_DB);
    if (restoredCount === 2) {
      logSuccess(`Database restored with ${restoredCount} items (rollback successful)`);
    } else {
      logFail(`Expected 2 items after restore, got ${restoredCount}`);
    }
    
    log("\n--- Phase 5: Verify update log ---");
    verifyUpdateLog();
    
    log("\n========================================");
    log(`Tests passed: ${testsPassed}`);
    log(`Tests failed: ${testsFailed}`);
    log("========================================\n");
    
    cleanup();
    
    if (testsFailed > 0) {
      process.exit(1);
    }
  } catch (err) {
    logError(`Test suite failed: ${err.message}`);
    cleanup();
    process.exit(1);
  }
}

runTests().catch((err) => {
  logError(`Unhandled error: ${err.message}`);
  cleanup();
  process.exit(1);
});
