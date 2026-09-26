import json
import pytest
from unittest.mock import patch, MagicMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Customer, RepairTicket, WarrantyClaim, Organization
from app.services.portal_inbound_gateway import (
    ingest_portal_claim,
    ingest_portal_repair_booking,
    process_inbound_webhook,
    pull_customer_portal_events
)

# Setup in-memory SQLite database
engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)

def test_ingest_portal_claim_creates_claim_and_customer():
    db = TestingSessionLocal()
    try:
        claim_payload = {
            "id": "CLM-SUPABASE-1001",
            "contact_phone": "0771234567",
            "customer_name": "Kasun Perera",
            "issue_description": "Display lines after 2 months of usage",
            "serial_number": "SN-IPHONE-15-9988"
        }

        claim = ingest_portal_claim(db, claim_payload, organization_id=1)
        assert claim is not None
        assert claim.claim_number == "CLM-SUPABASE-1001"
        assert claim.customer.phone == "0771234567"
        assert claim.customer.name == "Kasun Perera"
        assert claim.decision_status == "pending_inspection"

        # Customer was created
        customer = db.query(Customer).filter(Customer.phone == "0771234567").first()
        assert customer is not None
        assert customer.name == "Kasun Perera"
    finally:
        db.close()

def test_ingest_portal_claim_idempotent():
    db = TestingSessionLocal()
    try:
        claim_payload = {
            "id": "CLM-SUPABASE-2002",
            "contact_phone": "0779998888",
            "customer_name": "Nuwan Silva",
            "issue_description": "Battery drain issue"
        }

        claim_1 = ingest_portal_claim(db, claim_payload, organization_id=1)
        claim_2 = ingest_portal_claim(db, claim_payload, organization_id=1)

        assert claim_1.id == claim_2.id
        total_claims = db.query(WarrantyClaim).filter(WarrantyClaim.claim_number == "CLM-SUPABASE-2002").count()
        assert total_claims == 1
    finally:
        db.close()

def test_ingest_portal_repair_booking():
    db = TestingSessionLocal()
    try:
        repair_payload = {
            "id": "JOB-PORTAL-3003",
            "customer_phone": "0775554433",
            "customer_name": "Amila Fernando",
            "device_name": "Samsung Galaxy S23",
            "imei_or_serial": "358899001122334",
            "issue_description": "Broken back glass replacement",
            "estimated_cost": 8500.0
        }

        ticket = ingest_portal_repair_booking(db, repair_payload, organization_id=1)
        assert ticket is not None
        assert ticket.ticket_no == "JOB-PORTAL-3003"
        assert ticket.device_model == "Samsung Galaxy S23"
        assert ticket.estimated_cost == 8500.0
        assert ticket.status == "pending"

        # Duplicate submission check
        ticket_dup = ingest_portal_repair_booking(db, repair_payload, organization_id=1)
        assert ticket.id == ticket_dup.id
        total_jobs = db.query(RepairTicket).filter(RepairTicket.ticket_no == "JOB-PORTAL-3003").count()
        assert total_jobs == 1
    finally:
        db.close()

def test_inbound_webhook_dispatch(monkeypatch):
    monkeypatch.setenv("PORTAL_WEBHOOK_SECRET", "test-webhook-secret-at-least-32-chars")
    monkeypatch.setenv("PORTAL_WEBHOOK_ORGANIZATION_ID", "1")
    monkeypatch.setenv("PORTAL_WEBHOOK_BRANCH_ID", "2")
    monkeypatch.setenv("PORTAL_WEBHOOK_STORE_REF", "test-store")
    db = TestingSessionLocal()
    try:
        payload = {
            "id": "CLM-WH-4004",
            "store_id": "test-store",
            "contact_phone": "0712345678",
            "customer_name": "Webhook User",
            "issue_description": "Speaker not working"
        }
        assert process_inbound_webhook(db, "claim_submitted", payload)["success"] is False
        assert process_inbound_webhook(db, "claim_submitted", payload, "wrong")["success"] is False
        assert process_inbound_webhook(db, "claim_submitted", {**payload, "store_id": "other"}, "test-webhook-secret-at-least-32-chars")["success"] is False
        res = process_inbound_webhook(db, event_type="claim_submitted", payload=payload, secret_token="test-webhook-secret-at-least-32-chars")
        assert res["success"] is True
        assert res["claim_id"] is not None

        saved = db.query(WarrantyClaim).filter(WarrantyClaim.claim_number == "CLM-WH-4004").first()
        assert saved is not None
        assert saved.customer.name == "Webhook User"
        assert saved.branch_id == 2
    finally:
        db.close()


def test_inbound_webhook_rejects_unconfigured_secret(monkeypatch):
    monkeypatch.delenv("PORTAL_WEBHOOK_SECRET", raising=False)
    db = TestingSessionLocal()
    try:
        assert process_inbound_webhook(db, "claim_submitted", {"contact_phone": "0771234567"})["success"] is False
        assert db.query(WarrantyClaim).count() == 0
    finally:
        db.close()


def test_portal_pull_requires_explicit_tenant_even_with_service_key(monkeypatch):
    monkeypatch.setenv("PORTAL_WEBHOOK_STORE_REF", "")
    monkeypatch.setenv("PORTAL_WEBHOOK_ORGANIZATION_ID", "")
    monkeypatch.setenv("PORTAL_WEBHOOK_BRANCH_ID", "")
    assert pull_customer_portal_events()["status"] == "tenant_configuration_required"


def test_inbound_claim_idempotency_is_organization_scoped():
    db = TestingSessionLocal()
    try:
        payload = {"id": "CLM-SHARED", "contact_phone": "0771234567"}
        first = ingest_portal_claim(db, payload, organization_id=1)
        second = ingest_portal_claim(db, payload, organization_id=2)
        assert first.id != second.id
        assert first.organization_id == 1
        assert second.organization_id == 2
        assert first.customer_id != second.customer_id
    finally:
        db.close()


def test_portal_pull_ignores_other_stores_and_sets_branch(monkeypatch):
    monkeypatch.setenv("PORTAL_WEBHOOK_STORE_REF", "shop-a")
    monkeypatch.setenv("PORTAL_WEBHOOK_ORGANIZATION_ID", "1")
    monkeypatch.setenv("PORTAL_WEBHOOK_BRANCH_ID", "2")
    monkeypatch.setattr("app.services.portal_inbound_gateway.SUPABASE_SERVICE_ROLE_KEY", "test-key")

    class Response:
        def __init__(self, rows):
            self.rows = rows
        def __enter__(self):
            return self
        def __exit__(self, *_):
            return False
        def read(self):
            return json.dumps(self.rows).encode()

    urls = []
    def fake_urlopen(request, **_):
        urls.append(request.full_url)
        if "warranty_claims" in request.full_url:
            return Response([
                {"id": "CLAIM-A", "store_id": "shop-a", "contact_phone": "0771234567"},
                {"id": "CLAIM-B", "store_id": "shop-b", "contact_phone": "0779999999"},
            ])
        return Response([])

    monkeypatch.setattr("app.services.portal_inbound_gateway.urllib.request.urlopen", fake_urlopen)
    db = TestingSessionLocal()
    try:
        result = pull_customer_portal_events(db_session=db)
        assert result["claims_ingested"] == 1
        assert all("store_id=eq.shop-a" in url for url in urls)
        claim = db.query(WarrantyClaim).filter(WarrantyClaim.claim_number == "CLAIM-A").one()
        assert (claim.organization_id, claim.branch_id) == (1, 2)
        assert db.query(WarrantyClaim).filter(WarrantyClaim.claim_number == "CLAIM-B").count() == 0
    finally:
        db.close()
