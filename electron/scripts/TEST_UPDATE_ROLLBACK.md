# iStore Update-Rollback Smoke Test

A comprehensive end-to-end test that validates the production reliability workflow for database backup, update simulation, and automatic rollback on failure.

## What it validates

✓ **Database backup creation** – Confirms pre-install backups are created with SHA256 checksums
✓ **Backup file integrity** – Verifies backup files exist and are readable
✓ **Update failure simulation** – Corrupts the database to simulate an update failure scenario
✓ **Automatic rollback** – Confirms the database is restored from backup when operations fail
✓ **WAL cleanup** – Ensures SQLite WAL/SHM companion files are cleaned up after restore
✓ **Update event logging** – Validates all critical update lifecycle events are logged

## Running the test

```bash
cd electron
npm run test:rollback
```

## Test workflow

1. **Setup** – Creates an isolated test workspace with database, backups, and logs directories
2. **Database creation** – Initializes a test SQLite database with sample data
3. **Pre-install backup** – Creates a timestamped backup with SHA256 checksum and logs the event
4. **Simulate failure** – Corrupts the database to simulate an update failure
5. **Restore from backup** – Verifies recovery by restoring the database from the backup
6. **Update log verification** – Confirms all expected update lifecycle events were logged
7. **Cleanup** – Removes the test workspace

## Expected output

```
[✓] Test workspace created
[✓] Test database created
[✓] Database contains 2 items (pre-backup state)
[✓] Backup created: manual_2026-08-02T13-37-05-808Z.sqlite
[✓] Pre-install backup flow completed
[✓] Backup file exists
[✓] Backup checksum file created
[✓] Database corrupted to simulate update failure
[✓] Database is corrupted (as expected)
[✓] Database restored from backup
[✓] Database restored with 2 items (rollback successful)
[✓] Update log contains: checking_for_update
... (additional update log events)

========================================
Tests passed: 18
Tests failed: 0
========================================
```

## Integration

Run this test as part of your CI/CD pipeline before releasing updates:

```yaml
# .github/workflows/release.yml
- name: Run update-rollback smoke test
  run: |
    cd electron
    npm ci
    npm run test:rollback
```

## Dependencies

- Node.js >= 20
- sqlite3 (installed as devDependency)

The test creates temporary files in `electron/test-workspace` and cleans them up automatically on completion.
