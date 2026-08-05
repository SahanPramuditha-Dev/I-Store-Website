# v1.0 Release Checklist

**iStore ERP Production Release v1.0**  
**Date:** August 2, 2026  
**Status:** Ready with Conditional Fixes

---

## Pre-Release Actions (Must Complete Before v1.0)

### Security & Code Signing
- [ ] **CRITICAL:** Obtain Windows code signing certificate (EV or OV)
  - Cost: $200-500/year
  - Recommended providers: Sectigo, DigiCert, GlobalSign
  - **Timeline:** Order now (3-5 days to issue)

- [ ] **CRITICAL:** Install certificate in build environment
  - Set up signtool.exe in CI/CD
  - Test signing with demo build

- [ ] **CRITICAL:** Enable code signing in electron/package.json
  ```json
  "win": {
    "certificateFile": "path/to/cert.pfx",
    "certificatePassword": "process.env.CERT_PASSWORD",
    "signingHashAlgorithms": ["sha256"],
    "sign": "electron-builder"
  },
  "verifyUpdateCodeSignature": true
  ```

- [ ] Test signed build:
  ```bash
  npm run release
  npm run test:rollback
  ```

### Update Safety
- [ ] Add backup timeout (60 seconds) in electron/updater.js
  ```javascript
  const BACKUP_TIMEOUT = 60000; // ms
  const backupPromise = Promise.race([
    createBackup(...),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Backup timeout")), BACKUP_TIMEOUT)
    )
  ]);
  ```

- [ ] Test interrupted update:
  ```bash
  npm run test:rollback
  ```

### Documentation
- [ ] ✅ **DONE:** Generate RECOVERY_GUIDE.md (see /RECOVERY_GUIDE.md)
- [ ] ✅ **DONE:** Generate PRODUCTION_READINESS_AUDIT.md
- [ ] Create deployment guide (see Deployment Guide below)
- [ ] Add code signing section to README.md

### Configuration
- [ ] Document SECRET_KEY rotation procedure
- [ ] Test production build with:
  - SECRET_KEY = 32-char random string
  - backup_encrypt = true
  - BACKUP_ENCRYPTION_PASSPHRASE = strong passphrase

### Testing
- [ ] ✅ Regression test suite passing
  - backend/tests/test_backup_service_wal.py ✓
  - backend/tests/test_migration_rollback.py ✓
- [ ] ✅ Smoke test passing (18/18 assertions)
- [ ] Manual test on Windows 10 (fresh install)
- [ ] Manual test on Windows 11 (fresh install)
- [ ] Update test (v0.9 → v1.0)

---

## Release Day Actions

### Build & Sign
- [ ] Checkout main branch
  ```bash
  git checkout main
  git pull origin main
  ```

- [ ] Create release tag
  ```bash
  git tag -a v1.0.0 -m "iStore v1.0.0 - Production Release"
  git push origin v1.0.0
  ```

- [ ] Build and sign
  ```bash
  npm run release  # Builds, signs, publishes to GitHub Releases
  ```

### Verification
- [ ] Check GitHub Actions: workflow must pass
- [ ] Verify artifacts in GitHub Releases:
  - I-Store-ERP-Setup-1.0.0.exe (signed)
  - I-Store-ERP-Setup-1.0.0.exe.blockmap
  - latest.yml (contains update info)

- [ ] Verify installer signature:
  ```powershell
  Get-AuthenticodeSignature "I-Store-ERP-Setup-1.0.0.exe" | Format-List
  # Should show: Status: Valid, SignerCertificate.Thumbprint: (your cert thumbprint)
  ```

- [ ] Download and test installer on Windows 10/11 (minimum 2 machines)

### GitHub Release Notes
- [ ] Create release description:
  ```markdown
  # iStore v1.0.0 - Production Release

  ## Features
  - Offline-first SQLite database with WAL mode
  - Automatic daily backups with SHA256 verification
  - One-click backup restore with pre-restore snapshots
  - Auto-update system with rollback safety
  - Multi-user RBAC security model
  - Repair ticket & warranty management

  ## Fixes
  - [List any bug fixes from v0.9]

  ## System Requirements
  - Windows 10 21H2 or Windows 11
  - 2GB RAM, 500MB disk space
  - .NET Runtime 6.0+ (optional, for advanced features)

  ## Installation
  1. Download I-Store-ERP-Setup-1.0.0.exe
  2. Run installer (no admin required)
  3. Launch iStore ERP from Start Menu

  ## Important
  - Always keep backups: Backup → + Backup Now (weekly)
  - Read RECOVERY_GUIDE.md for disaster recovery

  ## Checksums
  - SHA256: [Run: certutil -hashfile installer.exe sha256]

  ## Support
  - GitHub Issues: https://github.com/SahanPramuditha-Dev/I-Store-Website/issues
  - Recovery Guide: https://github.com/SahanPramuditha-Dev/I-Store-Website/blob/main/RECOVERY_GUIDE.md
  ```

### Post-Release Announcement
- [ ] Update GitHub README.md: "v1.0.0 now available"
- [ ] Update website landing page
- [ ] Post announcement in relevant channels

---

## 30-Day Post-Release Monitoring

### Daily (First 3 days)
- [ ] Monitor GitHub Issues for crash reports
- [ ] Check user feedback and support messages
- [ ] Verify auto-update mechanism working (if v1.0.1 patch needed)

### Weekly (First 4 weeks)
- [ ] Collect telemetry: successful installs, updates, crashes
- [ ] Monitor backup failure rate
- [ ] Verify no data loss reports

### Monthly (Post-v1.0)
- [ ] Plan v1.0.1 patches if critical bugs found
- [ ] Begin v1.1 feature planning (multi-store, cloud sync)
- [ ] Publish monthly security advisories (if applicable)

---

## Known Limitations (Documented for Users)

### v1.0 Scope
- ✅ Single-store installation
- ✅ Offline database
- ✅ Manual backups only (no cloud auto-backup)
- ✅ Local restore only (no remote restore)

### v1.1+ Roadmap
- 🔄 Multi-store support
- 🔄 Cloud sync via Firebase
- 🔄 Mobile client (iOS/Android)
- 🔄 Inventory barcode scanning
- 🔄 Receipt printing

---

## Deployment Guide (Provide to System Admins)

### Environment Setup (Windows Server/Desktop)

**Prerequisites:**
- Windows 10 21H2, Windows 11, or Windows Server 2019+
- User account with standard privileges (not required admin)
- 2GB RAM, 500MB free disk space

**Installation Steps:**

1. **Download Installer**
   ```
   Download I-Store-ERP-Setup-1.0.0.exe from:
   https://github.com/SahanPramuditha-Dev/I-Store-Website/releases
   ```

2. **Verify Signature**
   ```powershell
   $sigStatus = Get-AuthenticodeSignature "I-Store-ERP-Setup-1.0.0.exe"
   Write-Host "Status: $($sigStatus.Status)"
   # Should show: Status: Valid
   ```

3. **Run Installer**
   ```
   Double-click I-Store-ERP-Setup-1.0.0.exe
   Follow on-screen prompts
   No admin password required
   ```

4. **Launch Application**
   - Start Menu → I-Store ERP
   - Or: Windows + S → type "I-Store ERP"

5. **Initial Setup**
   - Create admin user (required)
   - Set business profile (Shop Name, Tax ID, etc.)
   - Configure backup location (optional; defaults to %LOCALAPPDATA%\iStore)

### Configuration (Production)

**Environment Variables** (if running from command line):

```powershell
# Set security key
$env:SECRET_KEY = "your-32-character-random-secret-key-here"

# Enable backup encryption (recommended)
$env:BACKUP_ENCRYPT = "true"
$env:BACKUP_ENCRYPTION_PASSPHRASE = "strong-backup-passphrase-here"

# Verify migration will backup first
$env:BACKUP_BEFORE_MIGRATE = "true"

# Keep 10 auto-backups (default)
$env:BACKUP_KEEP_AUTO = "10"

# Run app
& "C:\Users\$env:USERNAME\AppData\Local\I-Store ERP\I-Store ERP.exe"
```

### Backup Strategy

**Daily Backups (Automatic):**
- Configured by default to 11:59 PM daily
- Location: `%LOCALAPPDATA%\iStore\backups\`
- Retention: 10 latest backups
- No admin action required

**Weekly Manual Backups (Recommended):**
1. Open iStore ERP
2. Go to Backup tab
3. Click "+ Backup Now"
4. Copy backup file to USB/Network drive

**Monthly Integrity Checks:**
1. Go to Backup tab
2. View all backups
3. Verify checksum shows ✅ (green) for each

### Update Procedure

**Automatic Updates (Recommended):**
1. App will notify when update available
2. Click "Download & Install"
3. Choose time (less busy hours recommended)
4. App restarts and updates
5. Previous data preserved

**Manual Update:**
1. Download new installer from GitHub
2. Close iStore ERP
3. Run new installer
4. Choose "Upgrade" when prompted

### Uninstall

**Safe Removal:**
1. Control Panel → Uninstall a program
2. Select "I-Store ERP"
3. Click Uninstall
4. Choose "Keep my business data" (recommended)
5. Complete uninstall

**Data Preservation:**
- Business data remains in `%LOCALAPPDATA%\iStore\`
- Can reinstall at any time without losing data

### Support & Recovery

**If App Won't Start:**
1. Check RECOVERY_GUIDE.md
2. Follow "Scenario 1: Database Corrupted" section
3. Report issue on GitHub with log files

**Backup Locations for Support:**
- Database: `%LOCALAPPDATA%\iStore\database\istore.db`
- Backups: `%LOCALAPPDATA%\iStore\backups\`
- Logs: `%LOCALAPPDATA%\iStore\logs\`

---

## Commit Template for v1.0

```
commit message:
chore: v1.0.0 production release

- Code signing enabled
- Backup timeout added (60s)
- RECOVERY_GUIDE.md published
- PRODUCTION_READINESS_AUDIT.md finalized
- Deployment guide added

See: PRODUCTION_READINESS_AUDIT.md
See: RECOVERY_GUIDE.md
```

---

## Sign-Off

- [ ] **Release Manager:** __________________ Date: __________
- [ ] **QA Tester:** __________________ Date: __________
- [ ] **Security Review:** __________________ Date: __________

**Status:** ⚠️ CONDITIONAL READY FOR v1.0

**Blockers to Resolve:**
1. Code signing certificate
2. Backup timeout implementation
3. RECOVERY_GUIDE.md publication (✅ DONE)
4. PRODUCTION_READINESS_AUDIT.md (✅ DONE)

**Once blockers resolved: READY FOR RELEASE**

---

**Document Version:** 1.0  
**Last Updated:** August 2, 2026  
**Next Review:** After v1.0 release (30-day assessment)
