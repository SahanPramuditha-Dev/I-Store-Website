/**
 * local-db.js  –  I-Store Electron Local Database Engine
 * =========================================================
 * Phase 4: Offline-First SQLite Adapter
 *
 * Technology:
 *   sql.js  – Pure WebAssembly port of SQLite 3.
 *   Zero native compilation.  Works on every Node / Electron version
 *   without Windows SDK, Visual Studio, or node-gyp.
 *
 * Persistence:
 *   The WASM database is in-memory while running.  After every write we
 *   schedule a debounced flush that serializes the DB to a binary file on
 *   disk (identical format to a real SQLite .db file, fully compatible with
 *   DB Browser for SQLite and any other tooling).
 *
 * Encryption:
 *   WASM SQLite does not support SQLCipher natively.  For encryption at rest
 *   set ISTORE_DB_ENCRYPT=1 and ISTORE_DB_KEY — the exported buffer is
 *   AES-256-CBC encrypted before writing and decrypted on load using Node's
 *   built-in crypto module (no extra package required).
 *
 * Public API  (identical to the previous better-sqlite3 version):
 *   open, close, getPath,
 *   upsert, selectAll, selectOne, softDelete,
 *   enqueueOutbox, getPendingOutbox, updateOutboxStatus, purgeCompletedOutbox,
 *   getLastSyncCursor, setLastSyncCursor,
 *   OUTBOX_STATES
 */

"use strict";

const path    = require("path");
const fs      = require("fs");
const crypto  = require("crypto");
const { app } = require("electron");

// ── Constants ──────────────────────────────────────────────────────────────
const DB_FILE_NAME  = "istore-local.db";
const DB_VERSION    = 1;
const SAVE_DEBOUNCE_MS = 2_000;   // flush to disk at most once per 2 s

const DB_ENCRYPT = process.env.ISTORE_DB_ENCRYPT === "1";
const DB_KEY     = process.env.ISTORE_DB_KEY || "";
const AES_ALG    = "aes-256-cbc";

const OUTBOX_STATES = Object.freeze({
  PENDING:  "pending",
  SYNCING:  "syncing",
  SYNCED:   "synced",
  FAILED:   "failed",
  CONFLICT: "conflict",
});

// ── Module state ───────────────────────────────────────────────────────────
let _SQL       = null;   // sql.js constructor (set after initSqlJs resolves)
let _db        = null;   // sql.js Database instance
let _path      = null;   // resolved .db file path
let _saveTimer = null;   // debounce handle for disk flush
let _ready     = null;   // Promise<void> that resolves once open() completes

// ══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════

/**
 * open(overridePath?) → Promise<void>
 * Must be awaited once from main.js before IPC handlers are registered.
 */
async function open(overridePath) {
  if (_ready) return _ready;   // already opening or open

  _ready = (async () => {
    // ── Load sql.js WASM ────────────────────────────────────────────────
    const initSqlJs = require("sql.js");
    _SQL = await initSqlJs({
      // Point to the bundled wasm file inside node_modules
      locateFile: (file) =>
        path.join(__dirname, "node_modules", "sql.js", "dist", file),
    });

    // ── Resolve storage path ────────────────────────────────────────────
    const dir = overridePath
      ? path.dirname(overridePath)
      : app.getPath("userData");
    fs.mkdirSync(dir, { recursive: true });
    _path = overridePath || path.join(dir, DB_FILE_NAME);

    // ── Load existing database or create fresh ──────────────────────────
    if (fs.existsSync(_path)) {
      let raw = fs.readFileSync(_path);
      if (DB_ENCRYPT) raw = _decrypt(raw);
      _db = new _SQL.Database(raw);
    } else {
      _db = new _SQL.Database();
    }

    // ── Apply schema migrations ─────────────────────────────────────────
    _migrate();

    console.log(`[local-db] Opened ${_path} (v${DB_VERSION}, wasm/sql.js, encrypt=${DB_ENCRYPT})`);
  })();

  return _ready;
}

/**
 * close() – Flush to disk and release memory.
 */
function close() {
  if (!_db) return;
  clearTimeout(_saveTimer);
  _flushToDisk();        // synchronous final save
  _db.close();
  _db    = null;
  _path  = null;
  _ready = null;
  console.log("[local-db] Closed.");
}

/** Return the resolved database file path. */
function getPath() { return _path; }

// ── Generic CRUD helpers ───────────────────────────────────────────────────

/**
 * upsert(table, row) – Insert or replace a row keyed by sync_uuid.
 */
function upsert(table, row) {
  _assertOpen();
  const cols         = Object.keys(row);
  const placeholders = cols.map(() => "?").join(", ");
  const updateClauses = cols
    .filter((c) => c !== "sync_uuid")
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");

  _run(
    `INSERT INTO ${_sanitize(table)} (${cols.join(", ")})
     VALUES (${placeholders})
     ON CONFLICT(sync_uuid) DO UPDATE SET ${updateClauses}, updated_at = CURRENT_TIMESTAMP`,
    Object.values(row)
  );
}

/**
 * selectAll(table, where?, params?) – Return all matching rows as plain objects.
 */
function selectAll(table, where = "", params = []) {
  _assertOpen();
  const sql = `SELECT * FROM ${_sanitize(table)}${where ? ` WHERE ${where}` : ""}`;
  return _query(sql, params);
}

/**
 * selectOne(table, syncUuid) – Return a single row or null.
 */
function selectOne(table, syncUuid) {
  _assertOpen();
  const rows = _query(
    `SELECT * FROM ${_sanitize(table)} WHERE sync_uuid = ?`,
    [syncUuid]
  );
  return rows[0] ?? null;
}

/**
 * softDelete(table, syncUuid) – Mark a row deleted without removing it.
 */
function softDelete(table, syncUuid) {
  _assertOpen();
  _run(
    `UPDATE ${_sanitize(table)} SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE sync_uuid = ?`,
    [syncUuid]
  );
}

// ── Outbox API ─────────────────────────────────────────────────────────────

function enqueueOutbox({ entity_type, entity_uuid, operation, payload, device_id }) {
  _assertOpen();
  _run(
    `INSERT INTO local_outbox (entity_type, entity_uuid, operation, payload, device_id, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [entity_type, entity_uuid, operation, JSON.stringify(payload), device_id, OUTBOX_STATES.PENDING]
  );
}

function getPendingOutbox() {
  _assertOpen();
  return _query(
    `SELECT * FROM local_outbox WHERE status = ? ORDER BY created_at ASC`,
    [OUTBOX_STATES.PENDING]
  ).map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
}

function updateOutboxStatus(id, status, error = null) {
  _assertOpen();
  _run(
    `UPDATE local_outbox SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [status, error, id]
  );
}

function purgeCompletedOutbox(olderThanDays = 7) {
  _assertOpen();
  _run(
    `DELETE FROM local_outbox WHERE status = 'synced' AND created_at < datetime('now', ?)`,
    [`-${olderThanDays} days`]
  );
}

// ── Sync cursor API ────────────────────────────────────────────────────────

function getLastSyncCursor(entity) {
  _assertOpen();
  const rows = _query(`SELECT last_sync_at FROM sync_cursors WHERE entity = ?`, [entity]);
  return rows[0]?.last_sync_at ?? null;
}

function setLastSyncCursor(entity, timestamp) {
  _assertOpen();
  _run(
    `INSERT INTO sync_cursors (entity, last_sync_at) VALUES (?, ?)
     ON CONFLICT(entity) DO UPDATE SET last_sync_at = excluded.last_sync_at`,
    [entity, timestamp]
  );
}

// ══════════════════════════════════════════════════════════════════════════
// PRIVATE HELPERS
// ══════════════════════════════════════════════════════════════════════════

function _assertOpen() {
  if (!_db) throw new Error("[local-db] Not open. Call open() and await it before using the DB.");
}

function _sanitize(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))
    throw new Error(`[local-db] Invalid table name: "${name}"`);
  return name;
}

/**
 * _run(sql, params) – Execute a write statement and schedule a disk flush.
 */
function _run(sql, params = []) {
  _db.run(sql, params);
  _scheduleSave();
}

/**
 * _query(sql, params) – Execute a read statement and return rows as objects.
 */
function _query(sql, params = []) {
  const result = _db.exec(sql, params);
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((row) =>
    Object.fromEntries(columns.map((col, i) => [col, row[i]]))
  );
}

/** Debounced disk persistence */
function _scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_flushToDisk, SAVE_DEBOUNCE_MS);
}

function _flushToDisk() {
  if (!_db || !_path) return;
  try {
    let buf = Buffer.from(_db.export());
    if (DB_ENCRYPT) buf = _encrypt(buf);
    fs.writeFileSync(_path, buf);
  } catch (err) {
    console.error("[local-db] Disk flush error:", err.message);
  }
}

// ── AES-256-CBC helpers ───────────────────────────────────────────────────

function _encrypt(plainBuf) {
  if (!DB_KEY || DB_KEY.length < 16)
    throw new Error("[local-db] ISTORE_DB_KEY must be at least 16 chars for encryption.");
  const key = crypto.scryptSync(DB_KEY, "istore-salt", 32);
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(AES_ALG, key, iv);
  return Buffer.concat([iv, cipher.update(plainBuf), cipher.final()]);
}

function _decrypt(encBuf) {
  if (!DB_KEY || DB_KEY.length < 16)
    throw new Error("[local-db] ISTORE_DB_KEY is required to decrypt the database.");
  const key = crypto.scryptSync(DB_KEY, "istore-salt", 32);
  const iv  = encBuf.slice(0, 16);
  const data = encBuf.slice(16);
  const decipher = crypto.createDecipheriv(AES_ALG, key, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

// ── Schema migrations ──────────────────────────────────────────────────────

function _migrate() {
  _db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const rows    = _query("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1");
  const current = rows[0]?.version ?? 0;

  if (current < 1) {
    _applyV1Schema();
    _run("INSERT INTO schema_version (version) VALUES (?)", [1]);
  }
}

function _applyV1Schema() {
  _db.run(`
    CREATE TABLE IF NOT EXISTS local_outbox (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type   TEXT    NOT NULL,
      entity_uuid   TEXT    NOT NULL,
      operation     TEXT    NOT NULL,
      payload       TEXT    NOT NULL,
      device_id     TEXT    NOT NULL,
      status        TEXT    NOT NULL DEFAULT 'pending',
      attempts      INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at    TEXT    DEFAULT CURRENT_TIMESTAMP,
      updated_at    TEXT    DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_status ON local_outbox(status);

    CREATE TABLE IF NOT EXISTS sync_cursors (
      entity       TEXT PRIMARY KEY,
      last_sync_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      sync_uuid  TEXT PRIMARY KEY,
      legacy_id  INTEGER,
      name       TEXT NOT NULL,
      phone      TEXT,
      email      TEXT,
      address    TEXT,
      notes      TEXT,
      is_active  INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      sync_uuid     TEXT PRIMARY KEY,
      legacy_id     INTEGER,
      sku           TEXT,
      name          TEXT NOT NULL,
      category      TEXT,
      brand         TEXT,
      unit_price    REAL NOT NULL DEFAULT 0,
      cost_price    REAL,
      current_stock INTEGER NOT NULL DEFAULT 0,
      min_stock     INTEGER NOT NULL DEFAULT 0,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_sku ON inventory_items(sku);

    CREATE TABLE IF NOT EXISTS sales (
      sync_uuid       TEXT PRIMARY KEY,
      legacy_id       INTEGER,
      invoice_number  TEXT,
      customer_uuid   TEXT,
      total_amount    REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_amount      REAL NOT NULL DEFAULT 0,
      payment_method  TEXT,
      status          TEXT NOT NULL DEFAULT 'completed',
      notes           TEXT,
      created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at      TEXT
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_uuid  TEXT NOT NULL,
      item_uuid  TEXT NOT NULL,
      quantity   INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      discount   REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS repair_tickets (
      sync_uuid         TEXT PRIMARY KEY,
      legacy_id         INTEGER,
      ticket_number     TEXT,
      customer_uuid     TEXT,
      device_type       TEXT,
      device_model      TEXT,
      issue_description TEXT,
      status            TEXT NOT NULL DEFAULT 'received',
      estimated_cost    REAL,
      actual_cost       REAL,
      technician        TEXT,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at        TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_repairs_status ON repair_tickets(status);
  `);

  _flushToDisk();   // persist schema immediately
}

// ── Exports ────────────────────────────────────────────────────────────────
module.exports = {
  open,
  close,
  getPath,
  upsert,
  selectAll,
  selectOne,
  softDelete,
  enqueueOutbox,
  getPendingOutbox,
  updateOutboxStatus,
  purgeCompletedOutbox,
  getLastSyncCursor,
  setLastSyncCursor,
  OUTBOX_STATES,
};
