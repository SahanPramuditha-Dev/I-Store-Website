from typing import Optional, Dict, Any
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Request, Header, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db
from app.auth import get_current_user, require_permission
from app.models import SyncOutbox
from sqlalchemy import func
from datetime import datetime, timedelta

from app.services.supabase_pos_sync import process_offline_outbox_queue
from app.services.portal_inbound_gateway import pull_customer_portal_events, process_inbound_webhook

router = APIRouter(prefix="/sync", tags=["sync"])


class InboundWebhookPayload(BaseModel):
    event_type: str = Field(..., description="claim_submitted | repair_submitted | feedback_submitted")
    payload: Dict[str, Any]


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


@router.post("/outbox/flush")
def trigger_outbox_flush(background_tasks: BackgroundTasks, db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Triggers immediate flush of pending/failed transactional outbox events to cloud."""
    result = process_offline_outbox_queue(db_session=db)
    return {"status": "success", "result": result}


@router.post("/portal/pull")
def trigger_portal_pull(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Polls Supabase Cloud for new online customer claims and repair bookings."""
    result = pull_customer_portal_events(db_session=db)
    return {"status": "success", "result": result}


@router.post("/portal/webhook")
def receive_portal_webhook(
    body: InboundWebhookPayload,
    db: Session = Depends(get_db),
    x_webhook_secret: Optional[str] = Header(None, alias="X-Webhook-Secret")
):
    """Direct real-time webhook listener for Customer Portal events from Supabase."""
    result = process_inbound_webhook(
        db=db,
        event_type=body.event_type,
        payload=body.payload,
        secret_token=x_webhook_secret
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Webhook processing failed"))
    return result


@router.delete("/clear-completed", dependencies=[Depends(require_permission("backup.manage"))])
def clear_old_completed(db: Session = Depends(get_db), _=Depends(get_current_user)):
    # Delete completed records older than 7 days
    cutoff_date = datetime.utcnow() - timedelta(days=7)
    deleted_count = db.query(SyncOutbox).filter(
        SyncOutbox.status.in_(["completed", "synced"]),
        SyncOutbox.updated_at < cutoff_date
    ).delete()
    db.commit()
    return {"status": "success", "deleted_count": deleted_count}

