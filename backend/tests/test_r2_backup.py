from datetime import datetime, timezone
from pathlib import Path

import app.services.r2_backup as r2_backup


class FakeS3Client:
    def __init__(self):
        self.objects = {}

    def upload_file(self, filename, bucket, key, ExtraArgs=None):
        self.objects[key] = {
            "body": Path(filename).read_bytes(),
            "metadata": (ExtraArgs or {}).get("Metadata") or {},
            "modified": datetime.now(timezone.utc),
        }

    def head_object(self, Bucket, Key):
        row = self.objects[Key]
        return {"ContentLength": len(row["body"]), "Metadata": row["metadata"]}

    def list_objects_v2(self, Bucket, Prefix, **_kwargs):
        return {
            "IsTruncated": False,
            "Contents": [
                {"Key": key, "Size": len(row["body"]), "LastModified": row["modified"]}
                for key, row in self.objects.items()
                if key.startswith(Prefix)
            ],
        }

    def download_file(self, bucket, key, filename):
        Path(filename).write_bytes(self.objects[key]["body"])

    def delete_object(self, Bucket, Key):
        self.objects.pop(Key, None)


def _configure(monkeypatch):
    monkeypatch.setattr(r2_backup.settings, "r2_backup_enabled", True)
    monkeypatch.setattr(r2_backup.settings, "r2_access_key", "access")
    monkeypatch.setattr(r2_backup.settings, "r2_secret_key", "secret")
    monkeypatch.setattr(r2_backup.settings, "r2_bucket", "backups")
    monkeypatch.setattr(r2_backup.settings, "r2_endpoint", "https://example.r2.cloudflarestorage.com")


def test_r2_upload_verify_list_download_and_prune(tmp_path, monkeypatch):
    _configure(monkeypatch)
    fake = FakeS3Client()
    monkeypatch.setattr(r2_backup, "_client", lambda: fake)

    source = tmp_path / "backup.sqlite.gz.enc"
    source.write_bytes(b"encrypted-backup")
    checksum = "abc123"
    key = "istore-backups/tenant-a/20260920/backup.sqlite.gz.enc"

    assert r2_backup.upload_backup(str(source), key, {"checksum": checksum})["uploaded"] is True
    assert r2_backup.verify_backup(key, source.stat().st_size, checksum)["verified"] is True
    assert r2_backup.list_remote_backups("istore-backups/tenant-a")[0]["blob_name"] == key

    destination = tmp_path / "downloaded.enc"
    assert r2_backup.download_backup(key, str(destination))["success"] is True
    assert destination.read_bytes() == source.read_bytes()

    second_key = "istore-backups/tenant-a/20260921/backup.sqlite.gz.enc"
    r2_backup.upload_backup(str(source), second_key, {"checksum": checksum})
    result = r2_backup.prune_remote_backups("istore-backups/tenant-a", keep=1)
    assert result == {"kept": 1, "removed": 1}
    assert len(fake.objects) == 1
