import json
import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import SyncOutbox, Organization
from app.services.supabase_pos_sync import (
    enqueue_outbox_event,
    process_offline_outbox_queue,
    sync_checkout_invoice_to_cloud,
    sync_repair_ticket_to_cloud
)

# Setup in-memory SQLite database
engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)

def test_enqueue_outbox_event():
    db = TestingSessionLocal()
    try:
        payload = {"id": "INV-1001", "total": 5000.0, "customer_name": "Sahan"}
        entry = enqueue_outbox_event(
            db=db,
            entity_type="invoice",
            entity_id="INV-1001",
            action="UPSERT",
            payload=payload,
            organization_id=1,
            branch_id=1
        )
        db.commit()

        assert entry is not None
        assert entry.id is not None
        assert entry.status == "pending"
        assert entry.retry_count == 0
        assert json.loads(entry.payload)["id"] == "INV-1001"

        saved = db.query(SyncOutbox).filter(SyncOutbox.entity_id == "INV-1001").first()
        assert saved is not None
        assert saved.status == "pending"
    finally:
        db.close()

def test_process_outbox_successful_flush():
    db = TestingSessionLocal()
    try:
        payload = {"id": "INV-2001", "total": 12500.0}
        enqueue_outbox_event(
            db=db,
            entity_type="invoice",
            entity_id="INV-2001",
            action="UPSERT",
            payload=payload
        )
        db.commit()

        # Mock _push_payload_to_supabase to succeed
        with patch("app.services.supabase_pos_sync._push_payload_to_supabase", return_value=None):
            result = process_offline_outbox_queue(db_session=db)

        assert result["processed"] == 1
        assert result["synced"] == 1
        assert result["failed"] == 0

        saved = db.query(SyncOutbox).filter(SyncOutbox.entity_id == "INV-2001").first()
        assert saved.status == "synced"
        assert saved.synced_at is not None
        assert saved.last_error is None
    finally:
        db.close()

def test_process_outbox_retry_exponential_backoff():
    db = TestingSessionLocal()
    try:
        payload = {"id": "JOB-3001", "device": "iPhone 13"}
        enqueue_outbox_event(
            db=db,
            entity_type="repair_ticket",
            entity_id="JOB-3001",
            action="UPSERT",
            payload=payload
        )
        db.commit()

        # Mock network failure
        with patch("app.services.supabase_pos_sync._push_payload_to_supabase", side_effect=Exception("Connection timed out")):
            result = process_offline_outbox_queue(db_session=db)

        assert result["processed"] == 1
        assert result["synced"] == 0
        assert result["failed"] == 1

        saved = db.query(SyncOutbox).filter(SyncOutbox.entity_id == "JOB-3001").first()
        assert saved.status == "failed"
        assert saved.retry_count == 1
        assert "Connection timed out" in saved.last_error
        assert saved.next_retry_at is not None
    finally:
        db.close()

def test_process_outbox_dead_letter_on_max_retries():
    db = TestingSessionLocal()
    try:
        # Create an entry that has reached max retries - 1
        entry = SyncOutbox(
            entity_type="invoice",
            entity_id="INV-9999",
            action="UPSERT",
            payload=json.dumps({"id": "INV-9999"}),
            status="pending",
            retry_count=4,
            max_retries=5
        )
        db.add(entry)
        db.commit()

        # Force failure on 5th retry
        with patch("app.services.supabase_pos_sync._push_payload_to_supabase", side_effect=Exception("Fatal remote error")):
            result = process_offline_outbox_queue(db_session=db)

        assert result["failed"] == 1
        saved = db.query(SyncOutbox).filter(SyncOutbox.entity_id == "INV-9999").first()
        assert saved.status == "dead_letter"
        assert saved.retry_count == 5
    finally:
        db.close()
