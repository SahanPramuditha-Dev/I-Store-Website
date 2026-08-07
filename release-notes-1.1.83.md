# iStore ERP v1.1.83 Release Notes

**Built on:** 2026-08-07 14:17:49

## Changes
- release: v1.1.82 - add window destruction safety before quitAndInstall
- release: v1.1.81 - terminate IStoreBackend process tree on Windows before NSIS install
- release: v1.1.80 - fix null check for up-to-date checkForUpdates result
- release: v1.1.79 - native github provider for electron-updater
- release: v1.1.78 - login resilience, PIN pad styling, sqlite timeout & updater UX overhaul
- Auto-sync admin/manager/owner staff PIN hash to Supabase on POS PIN login
- Update POS Sync payload to automatically transmit store logo & branch preferences
- Add SSL context handling to urllib in Supabase POS sync module
- Add offline outbox worker queue to Supabase sync service
- Integrate Supabase POS Sync module bridging desktop sales checkout to Cloud Customer Portal
