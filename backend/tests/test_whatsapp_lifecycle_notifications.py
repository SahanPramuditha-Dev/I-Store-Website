import pytest
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request
from fastapi import BackgroundTasks

from app.models import (
    Base, Organization, Branch, Role, User, Customer, Sale, SaleItem,
    RepairTicket, RepairHistory, WarrantyRecord, WarrantyClaim, WarrantyReplacement,
    AppSetting
)
from app.utils.whatsapp_helper import DEFAULT_TEMPLATES, TEMPLATE_METADATA, render_template
from app.routers.warranty_router import (
    approve_warranty_claim,
    reject_warranty_claim,
    create_replacement_for_warranty_claim,
    resolve_warranty_claim,
    create_warranty_record,
    WarrantyRecordIn
)
from app.routers.repair_router import (
    update_repair_status
)


SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _create_mock_request(org_id: int = 1, branch_id: int = 1):
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/test",
        "headers": [],
    }
    req = Request(scope)
    req.state.current_org_id = org_id
    req.state.current_branch_id = branch_id
    return req


class MockUser:
    def __init__(self, id: int = 1, org_id: int = 1, branch_id: int = 1, role: str = "admin"):
        self.id = id
        self.organization_id = org_id
        self.branch_id = branch_id
        self.username = "manager1"
        self.name = "Store Manager"
        self.role = role


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    org = Organization(id=1, slug="istore-main", name="I-Store Electronics", industry_type="ELECTRONICS")
    branch = Branch(id=1, organization_id=1, code="HQ", name="Main Branch")
    role_admin = Role(name="admin", display_name="Admin")
    role_mgr = Role(name="manager", display_name="Manager")
    user = User(id=1, organization_id=1, branch_id=1, username="manager1", password_hash="fake", role="admin")
    
    cust = Customer(
        id=1,
        organization_id=1,
        name="Kasun Perera",
        phone="0771234567",
        whatsapp_number="0771234567"
    )
    
    setting = AppSetting(
        key="system_settings",
        value='{"business_profile": {"store_name": "I-Store Prime", "phone": "0112345678", "address": "Colombo 03", "website": "https://istore.lk"}}'
    )
    
    db.add_all([org, branch, role_admin, role_mgr, user, cust, setting])
    db.commit()
    db.close()
    yield
    Base.metadata.drop_all(bind=engine)


# ─── 1. Template Registry Integrity Tests ────────────────────────────────────

def test_template_registry_coverage():
    """Verify all lifecycle events are present in both DEFAULT_TEMPLATES and TEMPLATE_METADATA."""
    required_events = [
        "pos_receipt",
        "repair_intake",
        "repair_estimate",
        "repair_status",
        "repair_completed",
        "repair_collected",
        "warranty_registered",
        "warranty_claim_approved",
        "warranty_claim_rejected",
        "warranty_claim_replaced",
        "warranty_claim_resolved"
    ]
    for event in required_events:
        assert event in DEFAULT_TEMPLATES, f"Missing template body for {event}"
        assert event in TEMPLATE_METADATA, f"Missing metadata for {event}"
        assert len(DEFAULT_TEMPLATES[event]) > 20, f"Template body for {event} is too short"


def test_template_placeholder_rendering():
    """Verify variable substitution in claim and repair templates."""
    sample_vars = {
        "customer_name": "Nimal",
        "store_name": "I-Store",
        "claim_number": "CLM-0042",
        "product_name": "iPhone 15 Pro",
        "serial_number": "SN987654",
        "resolution_type": "Unit Replacement",
        "decision_note": "Approved by supervisor",
        "claim_tracking_url": "https://istore.lk/track/CLM-0042",
        "store_phone": "0770000000",
        "replacement_product_name": "iPhone 15 Pro New Box",
        "replacement_serial_number": "SN999999",
        "new_warranty_code": "WRN-9999",
        "store_address": "123 Galle Rd, Colombo",
        "rejection_reason": "Liquid damage detected",
        "inspection_notes": "Internal corrosion found near port",
        "closing_note": "Case closed satisfactorily"
    }

    # Test claim approved render
    rendered_appr = render_template(DEFAULT_TEMPLATES["warranty_claim_approved"], sample_vars)
    assert "WARRANTY CLAIM APPROVED" in rendered_appr
    assert "Nimal" in rendered_appr
    assert "CLM-0042" in rendered_appr

    # Test claim replaced render
    rendered_repl = render_template(DEFAULT_TEMPLATES["warranty_claim_replaced"], sample_vars)
    assert "WARRANTY REPLACEMENT CONFIRMED" in rendered_repl
    assert "SN999999" in rendered_repl

    # Test claim rejected render
    rendered_rej = render_template(DEFAULT_TEMPLATES["warranty_claim_rejected"], sample_vars)
    assert "Liquid damage detected" in rendered_rej


# ─── 2. Warranty Lifecycle Notification Dispatches ───────────────────────────

@patch("app.routers.warranty_router.log_and_send_whatsapp")
def test_warranty_claim_approval_dispatches_whatsapp(mock_send):
    db = TestingSessionLocal()
    user = MockUser(role="admin")
    
    # Create warranty record
    w_rec = WarrantyRecord(
        id=10,
        organization_id=1,
        customer_id=1,
        customer_name="Kasun Perera",
        customer_phone="0771234567",
        product_or_service_name="MacBook Air M2",
        serial_number="C02G123456",
        warranty_type="sales",
        warranty_code="WRN-1001",
        warranty_number="WRN-1001",
        start_date=datetime.utcnow() - timedelta(days=30),
        end_date=datetime.utcnow() + timedelta(days=335),
        status="active"
    )
    claim = WarrantyClaim(
        id=20,
        warranty_id=10,
        claim_code="CLM-2001",
        claim_number="CLM-2001",
        customer_complaint="Trackpad unresponsive",
        claim_status="pending_inspection",
        decision_status="pending_inspection"
    )
    db.add_all([w_rec, claim])
    db.commit()

    with patch("threading.Thread") as mock_thread:
        # Mock Thread to execute target synchronously
        def run_sync(*args, **kwargs):
            target = kwargs.get("target")
            target_kwargs = kwargs.get("kwargs", {})
            if target:
                target(**target_kwargs)
            m = MagicMock()
            return m
        mock_thread.side_effect = run_sync

        approve_warranty_claim(claim_id=20, db=db, current_user=user)

    # Verify mock was called with warranty_claim_approved event
    mock_send.assert_called_once()
    call_kwargs = mock_send.call_args.kwargs
    assert call_kwargs["event_type"] == "warranty_claim_approved"
    assert call_kwargs["phone"] == "0771234567"
    assert "CLM-2001" in call_kwargs["variables"]["claim_number"]
    assert "MacBook Air M2" in call_kwargs["variables"]["product_name"]
    db.close()


@patch("app.routers.warranty_router.log_and_send_whatsapp")
def test_warranty_claim_rejection_dispatches_whatsapp(mock_send):
    db = TestingSessionLocal()
    user = MockUser(role="admin")
    
    w_rec = WarrantyRecord(
        id=11,
        organization_id=1,
        customer_id=1,
        customer_name="Kasun Perera",
        customer_phone="0771234567",
        product_or_service_name="iPad Air 5",
        serial_number="DMPH123456",
        warranty_type="sales",
        warranty_code="WRN-1002",
        status="active",
        start_date=datetime.utcnow(),
        end_date=datetime.utcnow() + timedelta(days=100)
    )
    claim = WarrantyClaim(
        id=21,
        warranty_id=11,
        claim_code="CLM-2002",
        claim_number="CLM-2002",
        customer_complaint="Screen cracked",
        claim_status="pending_inspection",
        decision_status="pending_inspection"
    )
    db.add_all([w_rec, claim])
    db.commit()

    with patch("threading.Thread") as mock_thread:
        def run_sync(*args, **kwargs):
            target = kwargs.get("target")
            target_kwargs = kwargs.get("kwargs", {})
            if target:
                target(**target_kwargs)
            return MagicMock()
        mock_thread.side_effect = run_sync

        reject_warranty_claim(claim_id=21, reason="Physical drop damage not covered", db=db, current_user=user)

    mock_send.assert_called_once()
    call_kwargs = mock_send.call_args.kwargs
    assert call_kwargs["event_type"] == "warranty_claim_rejected"
    assert call_kwargs["variables"]["rejection_reason"] == "Physical drop damage not covered"
    db.close()


@patch("app.routers.warranty_router.log_and_send_whatsapp")
def test_warranty_claim_replacement_dispatches_whatsapp(mock_send):
    db = TestingSessionLocal()
    user = MockUser(role="admin")
    
    w_rec = WarrantyRecord(
        id=12,
        organization_id=1,
        customer_id=1,
        customer_name="Kasun Perera",
        customer_phone="0771234567",
        product_or_service_name="Samsung S24 Ultra",
        serial_number="SM-S928B-01",
        warranty_type="sales",
        warranty_code="WRN-1003",
        status="active",
        start_date=datetime.utcnow(),
        end_date=datetime.utcnow() + timedelta(days=365)
    )
    claim = WarrantyClaim(
        id=22,
        warranty_id=12,
        claim_code="CLM-2003",
        claim_number="CLM-2003",
        customer_complaint="Motherboard dead",
        claim_status="approved",
        decision_status="approved"
    )
    db.add_all([w_rec, claim])
    db.commit()

    with patch("threading.Thread") as mock_thread:
        def run_sync(*args, **kwargs):
            target = kwargs.get("target")
            target_kwargs = kwargs.get("kwargs", {})
            if target:
                target(**target_kwargs)
            return MagicMock()
        mock_thread.side_effect = run_sync

        create_replacement_for_warranty_claim(
            claim_id=22,
            replacement_product_id=None,
            replacement_serial_id=None,
            reason="Full unit exchange authorized",
            db=db,
            current_user=user
        )

    mock_send.assert_called_once()
    call_kwargs = mock_send.call_args.kwargs
    assert call_kwargs["event_type"] == "warranty_claim_replaced"
    assert call_kwargs["variables"]["claim_number"] == "CLM-2003"
    db.close()


# ─── 3. Repair Milestone & Estimate Notification Dispatches ──────────────────

@patch("app.routers.repair_router.log_and_send_whatsapp")
def test_repair_estimate_quote_dispatches_whatsapp(mock_send):
    db = TestingSessionLocal()
    user = MockUser(role="admin")
    bg = MagicMock()
    req = _create_mock_request(1, 1)

    repair = RepairTicket(
        id=30,
        organization_id=1,
        branch_id=1,
        customer_id=1,
        ticket_no="JOB-00030",
        device_model="Sony WH-1000XM5",
        issue="Battery draining rapidly",
        status="diagnosing",
        estimated_cost=15000.0,
        advance_payment=3000.0,
        outstanding_balance=12000.0,
        is_deleted=False
    )
    db.add(repair)
    db.commit()

    # Move to waiting_for_approval with estimate
    res = update_repair_status(
        repair_id=30,
        status="waiting_for_approval",
        note="Battery replacement required. Cost: LKR 15,000.",
        background_tasks=bg,
        request=req,
        db=db,
        current_user=user
    )

    assert res["ok"] is True
    # Find the task that scheduled log_and_send_whatsapp
    whatsapp_tasks = [c for c in bg.add_task.call_args_list if c.kwargs.get("event_type") == "repair_estimate"]
    assert len(whatsapp_tasks) == 1
    call = whatsapp_tasks[0]
    assert call.kwargs["variables"]["estimate_amount"] == "15,000.00"
    assert call.kwargs["variables"]["job_number"] == "JOB-00030"
    db.close()


@patch("app.routers.repair_router.log_and_send_whatsapp")
def test_repair_completed_ready_for_pickup_dispatches_whatsapp(mock_send):
    db = TestingSessionLocal()
    user = MockUser(role="admin")
    bg = MagicMock()
    req = _create_mock_request(1, 1)

    repair = RepairTicket(
        id=31,
        organization_id=1,
        branch_id=1,
        customer_id=1,
        ticket_no="JOB-00031",
        device_model="iPhone 13 Pro",
        issue="Display replacement",
        status="repairing",
        estimated_cost=45000.0,
        advance_payment=10000.0,
        outstanding_balance=35000.0,
        is_deleted=False
    )
    db.add(repair)
    db.commit()

    update_repair_status(
        repair_id=31,
        status="completed",
        note="Display installed and QC passed. Ready for pickup.",
        background_tasks=bg,
        request=req,
        db=db,
        current_user=user
    )

    whatsapp_tasks = [c for c in bg.add_task.call_args_list if c.kwargs.get("event_type") == "repair_completed"]
    assert len(whatsapp_tasks) == 1
    call = whatsapp_tasks[0]
    assert call.kwargs["variables"]["balance_due"] == "35,000.00"
    db.close()
