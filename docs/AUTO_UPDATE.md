# Auto-Update & Database Safety System

This document explains the architecture, execution flow, backup mechanisms, schema migrations, and CI/CD publishing instructions for the I-Store Electron Desktop Host auto-updater.

---

## 1. Overview & Architecture

The auto-update system is built on **`electron-updater`** and **GitHub Releases**. It operates entirely without a custom backend server or domain.

```
                  +-----------------------+
                  |    GitHub Releases    |
                  |  (latest.yml & exe)   |
                  +-----------+-----------+
                              | (Check / Download in background)
                              v
   +-----------------------------------------------------+
   |           Electron Main Process (`updater.js`)       |
   +--------------------------+--------------------------+
                              |
     1. Event: `update-available` / `download-progress`
     2. Event: `update-downloaded`
                              |
                              v
   +-----------------------------------------------------+
   |        Pre-Update Safety Backup (`db-backup.js`)    |
   |  - Flushes WebAssembly SQLite memory buffer to disk |
   |  - Creates an online SQLite snapshot + SHA-256 file  |
   +--------------------------+--------------------------+
                              |
                              v
   +-----------------------------------------------------+
   |       UI Notification (`UpdateNotification.jsx`)     |
   |  - Displays "Restart & Install Now" banner to user  |
   +--------------------------+--------------------------+
                              |
                              v
   +-----------------------------------------------------+
   |            Quit & Install (`updater:install`)       |
   |  - Executes NSIS installer silently                 |
   |  - Upgrades application binary                        |
   +--------------------------+--------------------------+
                              |
                              v
   +-----------------------------------------------------+
   |           Post-Update Launch & Migration            |
   |  - Opens the tenant data-root database              |
   |  - Alembic applies or stamps the current schema     |
   +-----------------------------------------------------+
```

---

## 2. Database Protection & Storage Strategy

To guarantee zero data loss during application updates:

1. **Storage Location**: Business data is stored under the tenant-specific application data root, completely outside the versioned application binary directory. A normal update does not replace that data root. An OS reinstall can erase it, so an encrypted off-device backup is still required.
2. **Pre-Update Online Backup**: When an update payload is fully downloaded:
   - `updater.js` refuses installation while unsafe active operations or unsynchronized work remain.
   - `db-backup.js` creates a consistent SQLite online snapshot and a matching `.sha256` checksum file.
   - The installer preserves the tenant data root while replacing application files.
   - Backup retention removes an expired snapshot and its checksum together.

---

## 3. Database Schema Migrations

Backend database schema versioning is managed by Alembic:

- A genuinely empty clean installation is created from the complete current SQLAlchemy metadata and stamped at the Alembic head.
- Existing databases run pending Alembic revisions in order after a verified pre-migration backup.
- Legacy runtime `create_all`/column synchronization is disabled unless explicitly enabled for development.
- Failed migrations restore the verified pre-migration snapshot instead of continuing with a partially changed schema.

---

## 4. IPC Bridge & UI Integration

The main process communicates update state to the React frontend through contextBridge:

| Channel | Type | Purpose |
| :--- | :--- | :--- |
| `updater:check` | Invoke | Triggers manual check for updates |
| `updater:install` | Invoke | Triggers `quitAndInstall()` |
| `updater:status` | Event | Emits `'checking'`, `'available'`, `'downloaded'`, `'ready-to-install'`, or `'error'` |
| `updater:progress` | Event | Emits download percentage (`percent`, `bytesPerSecond`) |

**UI Component**: `frontend/src/components/UpdateNotification.jsx` renders a toast in the bottom-right corner showing download progress and a "Restart & Install Now" button.

---

## 5. Publishing a New Release

Releases are automated via GitHub Actions (`.github/workflows/release.yml`).

### Steps to Release:
1. Bump the same version in `electron/package.json` and `frontend/package.json`:
   ```json
   "version": "1.0.1"
   ```
2. Commit and tag:
   ```bash
   git add .
   git commit -m "Release v1.0.1"
   git tag v1.0.1
   git push origin main --tags
   ```
3. GitHub Actions builds the React frontend, packages the Electron installer with `electron-builder`, generates `latest.yml`, and publishes the release on GitHub.
4. Installed POS clients will automatically detect the new release on startup, download it in the background, backup their local database, and prompt the operator to restart.
