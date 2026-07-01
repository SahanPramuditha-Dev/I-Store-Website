import os
from datetime import datetime
from firebase_admin import credentials, firestore, initialize_app, storage

_app = None

def init_firebase(service_account_path: str, bucket_name: str):
    global _app
    if _app is None:
        cred = credentials.Certificate(service_account_path)
        _app = initialize_app(cred, {"storageBucket": bucket_name})

def upload_backup(file_path: str, destination_blob: str | None = None, metadata: dict | None = None):
    if _app is None:
        return {"uploaded": False, "reason": "firebase-not-configured"}
    bucket = storage.bucket()
    blob_path = destination_blob or f"istore-backups/{datetime.now().strftime('%Y%m%d')}/{os.path.basename(file_path)}"
    blob = bucket.blob(blob_path)
    if metadata:
        blob.metadata = {str(k): str(v) for k, v in metadata.items() if v is not None}
    blob.upload_from_filename(file_path)
    return {"uploaded": True, "blob": blob.name, "size": blob.size}


def write_backup_metadata(record: dict, collection_name: str = "backup_metadata"):
    if _app is None:
        return {"stored": False, "reason": "firebase-not-configured"}
    db = firestore.client()
    backup_id = str(record.get("backup_id", "")).strip()
    doc = db.collection(collection_name).document(backup_id) if backup_id else db.collection(collection_name).document()
    payload = {k: v for k, v in record.items() if v is not None}
    doc.set(payload)
    return {"stored": True, "doc_id": doc.id}


def delete_remote_backup(blob_path: str):
    if _app is None or not blob_path:
        return False
    try:
        bucket = storage.bucket()
        blob = bucket.blob(blob_path)
        blob.delete()
        return True
    except Exception:
        return False

