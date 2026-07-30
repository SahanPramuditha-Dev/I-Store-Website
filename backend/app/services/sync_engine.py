import json
import logging
import asyncio
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
import httpx

from app.models import SyncOutbox
from app.config import settings

logger = logging.getLogger("istore.sync_engine")


class ConflictResolver:
    """Conflict Resolution Matrix Strategy Implementer"""

    @staticmethod
    def resolve_master_data(local_data: Dict[str, Any], cloud_data: Dict[str, Any]) -> Dict[str, Any]:
        """Master Data Strategy: Latest Update Wins (LWW) based on updated_at timestamp."""
        local_ts = local_data.get("updated_at") or local_data.get("created_at") or ""
        cloud_ts = cloud_data.get("updated_at") or cloud_data.get("created_at") or ""
        return local_data if str(local_ts) >= str(cloud_ts) else cloud_data

    @staticmethod
    def resolve_transaction(local_event: Dict[str, Any], cloud_event: Dict[str, Any]) -> Dict[str, Any]:
        """Transactions Strategy: Immutable Append-Only. Never overwrite events."""
        return local_event


class SyncEngine:
    """Outbox Synchronization Worker Engine for edge-to-cloud replication."""

    def __init__(self, cloud_api_url: Optional[str] = None, max_retries: int = 5) -> None:
        self.cloud_api_url = (cloud_api_url or os.getenv("CLOUD_API_URL", "")).rstrip("/")
        self.max_retries = max_retries

    def fetch_pending_events(self, db: Session, limit: int = 50) -> List[SyncOutbox]:
        return (
            db.query(SyncOutbox)
            .filter(SyncOutbox.status.in_(["pending", "failed"]))
            .filter(SyncOutbox.retry_count < self.max_retries)
            .order_by(SyncOutbox.created_at.asc())
            .limit(limit)
            .all()
        )

    async def process_outbox_batch(self, db: Session, limit: int = 50) -> Dict[str, int]:
        events = self.fetch_pending_events(db, limit=limit)
        if not events:
            return {"processed": 0, "succeeded": 0, "failed": 0}

        succeeded = 0
        failed = 0

        # Mark events as syncing
        for event in events:
            event.status = "syncing"
        db.commit()

        # Offline / disconnected simulation if cloud_api_url is not set
        if not self.cloud_api_url:
            logger.info("Cloud API URL not configured. Edge mode: Outbox events preserved locally in 'pending' status.")
            for event in events:
                event.status = "pending"
            db.commit()
            return {"processed": len(events), "succeeded": 0, "failed": 0, "reason": "offline_mode"}

        async with httpx.AsyncClient(timeout=10.0) as client:
            for event in events:
                try:
                    payload_dict = json.loads(event.payload) if isinstance(event.payload, str) else event.payload
                    resp = await client.post(
                        f"{self.cloud_api_url}/api/v1/sync/ingest",
                        json={
                            "event_id": event.id,
                            "entity_type": event.entity_type,
                            "entity_id": event.entity_id,
                            "action": event.action,
                            "payload": payload_dict,
                            "device_id": settings.device_name,
                        },
                    )
                    if resp.status_code == 200:
                        event.status = "completed"
                        succeeded += 1
                    elif resp.status_code == 409:  # Conflict
                        event.status = "conflict"
                        event.last_error = f"Conflict: {resp.text}"
                        failed += 1
                    else:
                        event.status = "failed"
                        event.retry_count += 1
                        event.last_error = f"HTTP {resp.status_code}: {resp.text}"
                        failed += 1
                except Exception as exc:
                    event.status = "failed"
                    event.retry_count += 1
                    event.last_error = str(exc)
                    failed += 1
                db.commit()

        return {"processed": len(events), "succeeded": succeeded, "failed": failed}

sync_engine = SyncEngine()
