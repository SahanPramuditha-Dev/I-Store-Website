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
   |  - Creates timestamped backup in `%APPDATA%/backups` |
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
   |  - New app version opens `%APPDATA%/istore-local.db`|
   |  - `_migrate()` runs any new schema version SQL     |
   +-----------------------------------------------------+
```

---

## 2. Database Protection & Storage Strategy

To guarantee zero data loss during application updates:

1. **Storage Location**: The SQLite database (`istore-local.db`) is stored in Electron's persistent `app.getPath("userData")` directory (`%APPDATA%/istore-electron/`), completely outside the application binary installation directory. Reinstalling or updating the app binary never touches or wipes user data.
2. **Pre-Update Online Backup**: When an update payload is fully downloaded:
   - `updater.js` flushes all in-memory WebAssembly SQLite pages to disk via `db.close()`.
   - `db-backup.js` creates a timestamped copy: `%APPDATA%/istore-electron/backups/istore-db-backup_<TIMESTAMP>.db`.
   - Backup retention automatically purges files older than 30 days.

---

## 3. Database Schema Migrations

Database schema versioning is managed inside `electron/local-db.js`:

- On startup, `_migrate()` executes before displaying the window.
- Tracks applied version numbers in the `schema_version` table.
- When an updated binary includes new SQL tables or altered columns (e.g. Version 2, Version 3), `_migrate()` executes only the pending migration blocks sequentially.

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
1. Bump version in `electron/package.json`:
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
