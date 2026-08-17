# iStore Recovery Guide

**For:** iStore ERP v1.0+  
**Last Updated:** August 2, 2026  
**Status:** Production

---

## Table of Contents

1. [Data Storage Locations](#data-storage-locations)
2. [How Backups Work](#how-backups-work)
3. [Manual Recovery Steps](#manual-recovery-steps)
4. [Database Restore Procedure](#database-restore-procedure)
5. [Update Failure Recovery](#update-failure-recovery)
6. [Emergency Procedures](#emergency-procedures)

---

## Data Storage Locations

All business data is stored in your user profile, **NOT** in Program Files.

### Windows Storage Structure

```
%LOCALAPPDATA%\iStore\
├── database/
│   └── istore.db              (Active SQLite database)
├── backups/
│   ├── manual_2026_08_02_143022.sqlite.gz
│   ├── manual_2026_08_02_143022.sqlite.gz.sha256
│   └── ... (up to 10 backups retained)
├── uploads/
│   └── (Product images, receipts, repair docs)
├── logs/
│   ├── update.log             (Update lifecycle events)
│   └── backend-api.log        (Application errors)
└── migration.json             (Data migration marker)
```

### Why %LOCALAPPDATA%?

- ✅ **Survives reinstalls** – Uninstalling the app does NOT delete your data
- ✅ **Persists across updates** – App updates only replace binaries, not data
- ✅ **User-accessible** – Can manually backup via File Explorer
- ✅ **Protected** – Each Windows user has separate iStore database

### Verify Your Data Location

In iStore app, go to **Settings → System & APIs**:
- Database Path: `%LOCALAPPDATA%\iStore\database\istore.db`
- Backup Location: `%LOCALAPPDATA%\iStore\backups\`

Or in PowerShell:
```powershell
$env:LOCALAPPDATA + "\iStore"  # Shows your data folder
```

---

## How Backups Work

### Automatic Backups

**Scheduled:** Daily at 11:59 PM (configurable)  
**Retention:** Last 10 automatic backups kept  
**Storage:** `%LOCALAPPDATA%\iStore\backups\auto_YYYY_MM_DD_HHMMSS.sqlite.gz`

**Automatic Backup Triggers:**
- Daily scheduled backup (11:59 PM)
- Before every database migration
- Before every app update

### Manual Backups

**How to Create:**
1. Open iStore app
2. Go to **Backup** tab
3. Click **+ Backup Now**
4. Enter description (optional)
5. Click **Create**

**Backup File:** `manual_YYYY_MM_DD_HHMMSS.sqlite.gz`

### Backup Integrity

Every backup includes a checksum file:
- **Backup:** `manual_2026_08_02_143022.sqlite.gz`
- **Checksum:** `manual_2026_08_02_143022.sqlite.gz.sha256`

The checksum verifies the backup was not corrupted.

---

## Manual Recovery Steps

### Scenario 1: Database Corrupted (App Won't Start)

**Step 1:** Open File Explorer and navigate to:
```
%LOCALAPPDATA%\iStore\database\
```

**Step 2:** Check if backup files exist:
```
%LOCALAPPDATA%\iStore\backups\
```

**Step 3:** If backups exist, use the in-app **Restore** feature:
1. Start iStore app
2. Go to **Backup** tab
3. Locate the backup file you want to restore
4. Click **Restore**
5. Confirm the warning message
6. Wait for restore to complete

**Step 4:** If app won't start, delete corrupted database:
```powershell
# Open PowerShell as the current user (not admin)
$iStoreData = "$env:LOCALAPPDATA\iStore"
Remove-Item "$iStoreData\database\istore.db" -ErrorAction SilentlyContinue
```

**Step 5:** Restart iStore app (will auto-restore from latest backup)

---

### Scenario 2: Cannot Access the App

**Cause:** Database locked or corrupted

**Recovery:**

**Option A: Restart the App**
1. Close all iStore windows
2. Press `Ctrl+Alt+Delete` → Task Manager
3. Search for "I-Store ERP" or "python"
4. Kill all matching processes
5. Restart iStore

**Option B: Manual Database Unlock**
```powershell
# If database has orphan WAL files, remove them
$iStoreData = "$env:LOCALAPPDATA\iStore\database"
Remove-Item "$iStoreData\istore.db-wal" -ErrorAction SilentlyContinue
Remove-Item "$iStoreData\istore.db-shm" -ErrorAction SilentlyContinue
```

**Option C: Restore from Backup**
- Follow "Scenario 1" steps 3-5 above

---

### Scenario 3: Lost Recent Transactions

**Cause:** Interrupted sale or backup not created

**Action:**
1. Go to **Backup** tab
2. Restore the backup from right before the lost transaction
3. Re-enter the transaction
4. App will detect duplicate entries and prompt for merge

---

## Database Restore Procedure

### Via App (Recommended)

**Step 1:** Open Backup Tab
```
iStore → Backup
```

**Step 2:** Select Backup
- Click **Available Backups**
- Choose restore point (date + time shown)
- Verify checksum shows ✅ (green = valid)

**Step 3:** Request Restore
- Click **Restore from Backup**
- Enter reason (e.g., "Database corruption")
- Confirm warning: "This will overwrite current data"

**Step 4:** Approval (Admin Only)
- Admin user receives restore request
- Admin clicks **Approve** or **Reject**
- If approved, restore executes immediately

**Step 5:** Verification
- App displays restore completion message
- Pre-restore snapshot saved as: `pre_restore_YYYY_MM_DD_HHMMSS.sqlite`
- Check restore log in Settings → System & APIs → Logs

---

### Manual Restore (Advanced)

**Only if app is completely broken**

**Step 1:** Identify backup file:
```powershell
Get-ChildItem "$env:LOCALAPPDATA\iStore\backups\" | Sort-Object LastWriteTime -Descending | head -5
```

**Step 2:** Decompress backup:
```powershell
$BackupFile = "$env:LOCALAPPDATA\iStore\backups\manual_2026_08_02_143022.sqlite.gz"
$OutputDb = "$env:LOCALAPPDATA\iStore\backups\restored.sqlite"

# Requires 7-Zip or similar tool
7z x $BackupFile -o"$env:LOCALAPPDATA\iStore\backups\"
```

**Step 3:** Copy restored database:
```powershell
Copy-Item "$env:LOCALAPPDATA\iStore\backups\restored.sqlite" `
         "$env:LOCALAPPDATA\iStore\database\istore.db" -Force
```

**Step 4:** Clean up WAL files:
```powershell
Remove-Item "$env:LOCALAPPDATA\iStore\database\istore.db-wal" -ErrorAction SilentlyContinue
Remove-Item "$env:LOCALAPPDATA\iStore\database\istore.db-shm" -ErrorAction SilentlyContinue
```

**Step 5:** Restart app

---

## Update Failure Recovery

### Scenario: Update Installation Failed

**Symptoms:**
- Installer crashed
- App won't start after update
- Error message about database migration

### Recovery Steps

**Step 1:** Check for previous version:
```powershell
# Should still be accessible
cd "C:\Users\YourUsername\AppData\Roaming\I-Store ERP"
Start-Process "I-Store ERP.exe"
```

**Step 2:** If previous version fails:
```powershell
# Remove corrupted version entirely
Remove-Item "$env:APPDATA\I-Store ERP" -Recurse -Force
```

**Step 3:** Reinstall from backup:
1. Download previous version (v1.0.0) from GitHub Releases
2. Run installer: `I-Store-ERP-Setup-1.0.0.exe`
3. Choose "Repair installation" (if prompted)

**Step 4:** Restore from backup:
1. App launches with previous version
2. Go to **Backup** tab
3. Restore latest successful backup

**Step 5:** Try update again:
1. Check for updates: Settings → System & APIs → Check for Updates
2. Download latest version
3. Install when app is not busy (no active sales)

---

## Emergency Procedures

### Complete Data Recovery (Worst Case)

**Use if:**
- Windows won't boot
- Hard drive failure
- All local backups lost

**Requirements:**
- iStore backup file (manual or auto)
- Another Windows 10+ computer
- USB drive (for backup transfer)

**Steps:**

**Step 1:** Transfer backup to new computer:
- Connect USB drive to recovery computer
- Copy backup file: `manual_YYYY_MM_DD_HHMMSS.sqlite.gz`

**Step 2:** Install iStore:
- Download installer from GitHub Releases
- Run: `I-Store-ERP-Setup-1.0.0.exe`
- Proceed with normal installation

**Step 3:** Restore backup:
1. Start iStore app
2. Navigate to **Backup** tab
3. Upload or copy backup file to `%LOCALAPPDATA%\iStore\backups\`
4. Click **Restore from Backup**
5. Choose the file
6. Approve restore
7. Wait for completion

**Step 4:** Verify data:
- Check recent transactions in POS
- Verify customer list
- Check inventory levels

---

### Database Integrity Check

**If you suspect database corruption:**

**Step 1:** Close iStore app

**Step 2:** Open PowerShell and run:
```powershell
$db = "$env:LOCALAPPDATA\iStore\database\istore.db"
$sqlite = "C:\sqlite3.exe"  # or path to sqlite3.exe if installed

# Download sqlite3.exe if needed
if (-not (Test-Path $sqlite)) {
    Write-Host "Download sqlite3.exe from https://www.sqlite.org/download.html"
    exit
}

# Run integrity check
& $sqlite $db "PRAGMA integrity_check;"
```

**Step 3:** Interpret results:
- **Output: "ok"** → Database is healthy
- **Output: error message** → Database is corrupted; proceed to restore

**Step 4:** If corrupted, restore from backup (see Database Restore Procedure)

---

### Backup to External Storage

**Recommended:** Weekly backup to USB/Cloud

**Step 1:** Via App
1. Go to **Backup** tab
2. Click **+ Backup Now**
3. Download the backup file to USB drive

**Step 2:** Via File Explorer
1. Open: `%LOCALAPPDATA%\iStore\backups\`
2. Copy latest `.sqlite.gz` file to USB/Cloud

**Step 3:** Verify backup integrity:
- Check that `.sha256` file exists alongside backup
- Backup file size should be 10-50 MB (depending on data volume)

---

## Troubleshooting

### Q: Where is my data after reinstalling Windows?

**A:** Data remains in your user profile. After reinstalling Windows:
1. Log in with the same Windows user account
2. Download and install iStore again
3. Your data will be available at `%LOCALAPPDATA%\iStore\`

---

### Q: Can I restore an old backup?

**A:** Yes, but carefully:
- App keeps 10 auto backups + unlimited manual backups
- Select restore point from **Backup** tab
- Verify date/time matches your target
- Pre-restore snapshot is saved automatically

---

### Q: What if backup file is corrupted?

**A:**
1. Checksum validation prevents restore of corrupted files
2. Error message: "Backup checksum mismatch"
3. Try the next oldest backup
4. If all backups fail, contact support with backup files

---

### Q: How do I verify my backup is working?

**A:**
1. Go to **Backup** tab
2. Look for **Latest Backup** timestamp
3. Should show a recent date/time
4. Checksum should show ✅ (green)
5. Verify size is > 100 KB (shouldn't be empty)

---

### Q: Can I move my iStore data to a different computer?

**A:** Yes:
1. Create manual backup: **Backup** → **+ Backup Now**
2. Download backup file to USB
3. On new computer, install iStore
4. Go to **Backup** tab
5. Copy backup file to `%LOCALAPPDATA%\iStore\backups\`
6. Click **Restore from Backup**
7. Approve and wait

---

### Q: What if I accidentally delete a transaction?

**A:**
1. Restore from backup taken before deletion
2. Re-enter subsequent transactions
3. Duplicates are auto-detected and merged

---

## Support Contacts

- **User Documentation:** See Settings → Help → Documentation
- **GitHub Issues:** https://github.com/SahanPramuditha-Dev/I-Store-Website/issues
- **Backup/Restore Issues:** See Activity Log (Settings → Activity Log)

---

## Key Takeaways

✅ **Your data is safe:**
- Automatic daily backups
- Backsum verification
- Pre-restore snapshots
- Version history retained

✅ **Recovery is easy:**
- In-app restore in 3 clicks
- Backup files stored locally
- No external dependencies

✅ **Prepare for worst case:**
- Weekly manual backup to USB
- Test restore once per month
- Keep this guide handy

---

**Last Updated:** August 2, 2026  
**Document Version:** 1.0  
**iStore Version:** 1.0+

For latest updates, visit: https://github.com/SahanPramuditha-Dev/I-Store-Website/wiki/Recovery
