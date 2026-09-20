# Backup and Restore

I Store uses a verified local backup first, with optional encrypted Firebase Storage or Cloudflare R2 upload for offsite disaster recovery.

## Local Backup Strategy

Backups are created from the SQLite database and stored under the configured backup folder. By default, `backend/app/config.py` resolves this to the OS user app data directory under `iStore/backups`.

Backup records and restore workflow metadata are stored in SQLite. Backup files should be treated as sensitive business data.

## Firebase Storage Role

Firebase Storage is optional and backup-only. It may store compressed/encrypted SQLite backup artifacts, but it must not store live POS, inventory, repair, customer, or authorization state.

Relevant settings:

```text
BACKUP_ENCRYPT=true
BACKUP_ENCRYPTION_PASSPHRASE=<strong-passphrase>
FIREBASE_BACKUP_ENABLED=false
FIREBASE_SERVICE_ACCOUNT=
FIREBASE_BUCKET=
FIREBASE_PRUNE_REMOTE_KEEP=30
```

## Firestore Metadata Role

If enabled, Firestore stores metadata only:

- Backup ID or filename.
- Created timestamp.
- File size.
- Checksum.
- App version.
- Device name.

It is not an operational database.

## Cloudflare R2 Role

R2 is the S3-compatible alternative to Firebase. Backups use a private bucket and are separated by tenant under `istore-backups/<tenant-code>/...`. The application verifies the uploaded object's size and SHA256 metadata before reporting the cloud copy as verified.

```text
BACKUP_ENCRYPT=true
BACKUP_ENCRYPTION_PASSPHRASE=<strong-passphrase-kept-outside-the-PC>
R2_BACKUP_ENABLED=true
R2_ACCESS_KEY=<R2-token-access-key>
R2_SECRET_KEY=<R2-token-secret>
R2_BUCKET=<private-backup-bucket>
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BACKUP_PREFIX=istore-backups
R2_BACKUP_KEEP=30
```

Cloud upload is rejected when backup encryption is disabled. Do not configure `R2_PUBLIC_BASE_URL` for the private backup bucket.

## Tenant and Shop Separation

An organization is the tenant and its branches are the shops. Operational rows carry organization and branch scope, while desktop data roots and remote backup keys include the tenant code. Never reuse one tenant code for unrelated businesses. A multi-shop organization may share one tenant but each terminal must be assigned to the correct branch and POS device.

Before converting an older single-shop database, take and test an offsite backup, then run the supported adoption migration. Do not point a legacy database directly at a new multi-shop deployment merely because the current application models support multiple tenants.

## Scheduled Backups

Scheduled backups are controlled by:

```text
BACKUP_SCHEDULE_ENABLED=true
BACKUP_SCHEDULE_HOUR=23
BACKUP_SCHEDULE_MINUTE=59
BACKUP_SCHEDULE_TIMEZONE=UTC
BACKUP_KEEP_AUTO=10
```

Scheduler endpoints:

```text
GET /backup/scheduler/status
POST /backup/scheduler/trigger-now
```

## Restore Workflow

Preferred restore flow:

```text
Create restore request
  -> approve request
  -> verify backup checksum
  -> create emergency pre-restore backup
  -> execute restore
  -> write restore audit event
```

API flow:

```text
POST /backup/restore/request
POST /backup/restore/requests/{request_id}/approve
POST /backup/restore/requests/{request_id}/execute
```

Direct restore is disabled by default. Restores must go through the request, approval, and execute workflow.

Cloud restore first downloads and verifies the artifact, then creates the same approval request. It does not bypass the restore workflow.

## Checksum Validation

Backups should include SHA256 checksums. A restore should verify the selected file before replacing the active database. If checksum validation fails, stop the restore.

## Emergency Backup Before Restore

Always create a new backup of the current database before restore execution. This protects against restoring the wrong file or discovering that the selected backup is incomplete after replacement.

## Retention

Suggested defaults:

- Keep at least 10 automatic local backups.
- Keep more backups for production shops with high transaction volume.
- Prune remote backups only after local backup history and checksum metadata are confirmed.

Do not store production backups inside source folders or commit them to Git.

## Clean Install and OS Reinstall

A clean installation creates a new empty database at the current Windows user's application-data path. It does not automatically discover a database that was erased with the old operating system.

For a reinstall on a previously used PC:

1. Install and start I Store once so the new data folders are created.
2. Configure the same tenant code and the Firebase or R2 credentials locally.
3. Download the latest verified encrypted backup through Backup Center, or copy both the local backup and its `.sha256` file from external media.
4. Test the restore, submit/approve the restore request, and execute it.
5. Restart the application and verify tenant, branch, invoice totals, stock totals, and the latest transaction date before trading.

The encryption passphrase is not recoverable from the backup. Keep it in a password manager or another location that survives loss of the PC. A cloud account alone is insufficient if the passphrase is lost.
