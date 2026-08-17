from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.auth import get_current_user, require_permission
from app.models import SyncOutbox
from sqlalchemy import func
from datetime import datetime, timedelta

router = APIRouter(prefix="/sync", tags=["sync"])

@router.get("/queue", dependencies=[Depends(require_permission("reports.view"))])
def get_sync_queue_status(db: Session = Depends(get_db), _=Depends(get_current_user)):
    # Count by status
    status_counts = db.query(SyncOutbox.status, func.count(SyncOutbox.id)).group_by(SyncOutbox.status).all()
    result = {status: count for status, count in status_counts}
    return result

@router.get("/failed", dependencies=[Depends(require_permission("reports.view"))])
def get_failed_sync_records(db: Session = Depends(get_db), _=Depends(get_current_user)):
    # List failed records
    failed_records = db.query(SyncOutbox).filter(SyncOutbox.status == "failed").all()
    return [{
        "id": r.id,
        "entity_type": r.entity_type,
        "entity_id": r.entity_id,
        "action": r.action,
        "payload": r.payload,
        "retry_count": r.retry_count,
        "status": r.status,
        "last_error": r.last_error,
        "created_at": r.created_at,
        "updated_at": r.updated_at
    } for r in failed_records]

@router.delete("/clear-completed", dependencies=[Depends(require_permission("backup.manage"))])
def clear_old_completed(db: Session = Depends(get_db), _=Depends(get_current_user)):
    # Delete completed records older than 7 days
    cutoff_date = datetime.utcnow() - timedelta(days=7)
    deleted_count = db.query(SyncOutbox).filter(
        SyncOutbox.status == "completed",
        SyncOutbox.updated_at < cutoff_date
    ).delete()
    db.commit()
    return {"status": "success", "deleted_count": deleted_count}
