# Backup and Restore

I Store uses local backup first, with optional Firebase Storage upload for disaster recovery.

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
