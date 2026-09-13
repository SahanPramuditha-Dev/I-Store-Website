const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const path = require('node:path');

function harness({ missing = false, pending = [], backupFails = false, duringBackup } = {}) {
  const calls = [], handlers = {}, states = [];
  const updater = new EventEmitter();
  updater.installerPath = '/cache/setup.exe';
  updater.setFeedURL = () => {};
  updater.quitAndInstall = () => calls.push('install');
  const app = { isPackaged: false, getPath: () => '/data', getVersion: () => '1.1.111' };
  const modules = {
    electron: { app, ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, BrowserWindow: { getAllWindows: () => [{ removeAllListeners() {}, destroy: () => calls.push('destroy') }] } },
    'electron-updater': { autoUpdater: updater },
    './local-db': { getPendingOutbox: () => pending, getPath: () => '/data/local.db', close: () => calls.push('close') },
    './db-backup': { createBackup: async () => { calls.push('backup'); if (duringBackup) await duringBackup(handlers); if (backupFails) throw new Error('Backup failed'); } },
    './update-version': { isNewerVersion: () => true },
    fs: { existsSync: (name) => name === updater.installerPath ? !missing : name.endsWith('.db'), mkdirSync() {}, appendFileSync() {} },
    path,
  };
  const context = { require: (name) => { if (!(name in modules)) throw new Error(name); return modules[name]; }, module: { exports: {} }, process: { env: { NODE_ENV: 'development' } }, console: { log() {}, error() {} }, setTimeout: () => 0, clearTimeout() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'updater.js'), 'utf8'), context);
  context.module.exports.initAutoUpdater({ isDestroyed: () => false, webContents: { send: (_channel, state) => states.push(state) } });
  return { calls, states, handlers, updater, install: handlers['updater:install'] };
}
(async () => {
  const ok = harness();
  assert.equal((await ok.install()).installing, true);
  assert.deepEqual(ok.calls, ['backup', 'backup', 'install']);
  assert.equal(ok.states.at(-1).status, 'installing');
  await ok.install();
  assert.equal(ok.calls.filter(x => x === 'install').length, 1, 'Repeated clicks must not launch twice');
  const missing = harness({ missing: true });
  assert.match((await missing.install()).error, /installer is missing/);
  assert.deepEqual(missing.calls, []);
  const blocked = harness({ pending: [{}] });
  assert.equal((await blocked.install()).blocked, true);
  assert.deepEqual(blocked.calls, []);
  const failed = harness({ backupFails: true });
  assert.match((await failed.install()).error, /Backup failed/);
  assert.equal(failed.states.at(-1).status, 'error');
  assert.equal(failed.calls.includes('install'), false);
  const active = harness({ duringBackup: async handlers => { handlers['updater:setOperationsActive'](null, true); } });
  assert.equal((await active.install()).blocked, true);
  assert.equal(active.calls.includes('install'), false, 'New operations during backup must prevent installation');
  const newPending = [];
  const syncing = harness({ pending: newPending, duringBackup: async () => { newPending.push({}); } });
  assert.equal((await syncing.install()).reason, 'pending-outbox');
  assert.equal(syncing.calls.includes('install'), false);
  let finishDownload;
  const downloading = harness();
  downloading.updater.downloadUpdate = () => new Promise(resolve => { finishDownload = resolve; });
  const download = downloading.handlers['updater:download']();
  assert.equal((await downloading.handlers['updater:check']()).skipped, true);
  assert.match((await downloading.install()).error, /Wait/);
  assert.equal((await downloading.handlers['updater:download']()).ok, false);
  finishDownload([]);
  assert.equal((await download).ok, true);
  console.log('Install lifecycle regression checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
