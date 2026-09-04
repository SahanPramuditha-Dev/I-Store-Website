import json
import logging
import asyncio
import os
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
import httpx

from app.models import SyncOutbox
from app.config import settings
from app.core.license_guard import get_cached_license

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

        cached = get_cached_license() or {}
        license_key = cached.get("license_key") or (cached.get("payload") or {}).get("license_id")
        fingerprint = cached.get("hardware_uuid") or (cached.get("payload") or {}).get("machine_fingerprint")
        if not license_key or not fingerprint or fingerprint == "*":
            for event in events:
                event.status = "pending"
                event.last_error = "Cloud sync requires an activated device-bound license."
            db.commit()
            return {"processed": len(events), "succeeded": 0, "failed": 0, "reason": "license_not_bound"}

        batch = {
            "license_key": license_key,
            "machine_fingerprint": fingerprint,
            "events": [
                {
                    "uuid": str(event.id),
                    "entity_type": event.entity_type,
                    "entity_id": str(event.entity_id),
                    "operation": str(event.action).upper(),
                    "payload": json.loads(event.payload) if isinstance(event.payload, str) else event.payload,
                    "created_at": event.created_at.isoformat() if event.created_at else None,
                }
                for event in events
            ],
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(f"{self.cloud_api_url}/api/sync/ingest", json=batch)
            if resp.status_code == 200:
                for event in events:
                    event.status = "synced"
                    event.last_error = None
                succeeded = len(events)
            else:
                error = f"HTTP {resp.status_code}: {resp.text}"
                for event in events:
                    event.status = "failed"
                    event.retry_count += 1
                    event.last_error = error
                failed = len(events)
        except Exception as exc:
            for event in events:
                event.status = "failed"
                event.retry_count += 1
                event.last_error = str(exc)
            failed = len(events)
        db.commit()

        return {"processed": len(events), "succeeded": succeeded, "failed": failed}

sync_engine = SyncEngine()
