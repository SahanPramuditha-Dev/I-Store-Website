# Desktop updater audit and execution plan

Scope: Electron update checks/download/install IPC, both update screens, local and backend backups, NSIS lifecycle, and GitHub release packaging. This is not an audit of every business module.

## Priority and plan
1. Protect business data: preserve data on uninstall; block known legacy uninstallers until a tested migration exists; remove process-name-wide taskkill hooks.
2. Make install transitions reliable: launch before quit, reject missing installer, serialize install/download/check, recheck operations and pending sync after backups, report failures and preparation states.
3. Make backups consistent: SQLite online backup for WAL database; live sql.js snapshot; unique output and atomic publication; explicit connection closure and subprocess timeout.
4. Make UI state reliable: shared inert release-note formatting, download restoration and dismissal, install feedback, truthful backup copy.
5. Validate: install lifecycle regressions, WAL snapshot tests, frontend build, installer compile. Do not publish until the legacy migration and real upgrade path have passed in a disposable Windows installation.

## Known release constraints
- Installed versions through 1.1.111 contain unsafe custom uninstall behavior. The new installer moves the complete data directory to a sibling safety path before invoking the old uninstaller and restores it afterward. This migration still requires a disposable Windows upgrade test before release.
- Existing versions may require manual recovery because their updater quits before launching setup.
- Code-signing is not configured (verifyUpdateCodeSignature=false). Checksums detect corruption but do not replace publisher verification. Obtaining a signing certificate requires the owner.
- A real install/restart and legacy migration have not been exercised in an isolated Windows environment. Do not infer success from mocked tests or compilation.
- Backend background jobs are not globally paused by the updater. Online SQLite snapshots are consistent, but post-snapshot writes are not part of that snapshot. Final UI/outbox rechecks are a guard, not full transaction quiescence.

## Validation record
See final task report for commands completed. The previous live WAL test confirmed committed WAL transactions and integrity_check=ok. A persisted regression test is included with this audit work.

## Execution results
- Implemented an atomic installer migration that moves the complete data directory outside the legacy uninstaller's deletion path and restores it after application files are installed. Conflicting live and safety directories fail closed and preserve both copies.
- Removed global process-name taskkill installer hooks. Normal Electron shutdown still terminates its owned backend process; graceful backend draining remains an integration follow-up.
- Added post-backup active-operation/outbox checks and serialization of check/download/install.
- Fixed next-startup snooze, restored download UI state, shared HTML-to-text release notes, and skipped-check recovery.
- CI now runs install regression checks, has explicit release permissions, and uploads to a draft before publishing verified assets.
- CI rejects installer scripts that restore process-name-wide forced termination or recursively delete the business-data directory.
- Passed: install lifecycle regressions (including new work during backup, duplicate clicks, concurrent download/check/install, failed backup, missing installer); version tests; tenant-root tests; live WAL pytest; frontend production build; NSIS macro compile fixture.
- NSIS fixture was compiled only, never executed. Full installer execution, backend freeze/recovery, code signing, and legacy migration remain unverified/release constraints.
