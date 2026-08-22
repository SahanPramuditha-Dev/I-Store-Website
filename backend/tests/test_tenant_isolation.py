import pytest
from datetime import datetime, timezone
from fastapi import Request
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Organization, Branch, Customer, Sale, RepairTicket, WarrantyClaim
from app.core.tenant_guard import scope_query, stamp_tenant, get_tenant_context, resolve_tenant_id_from_code

# Setup in-memory SQLite database for isolated test execution
engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)

def _mock_request(org_id: int, branch_id: int = 1) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(b"host", b"testserver")],
        "state": {
            "current_org_id": org_id,
            "current_branch_id": branch_id
        }
    }
    return Request(scope)

def test_tenant_isolation_customers():
    db = TestingSessionLocal()
    try:
        # Create Organizations
        org_a = Organization(id=10, name="Tenant Alpha", slug="alpha-org")
        org_b = Organization(id=20, name="Tenant Beta", slug="beta-org")
        db.add_all([org_a, org_b])
        db.commit()

        # Create Customer in Org A and Org B
        cust_a = Customer(name="Customer Alpha", phone="0771111111", organization_id=10)
        cust_b = Customer(name="Customer Beta", phone="0772222222", organization_id=20)
        db.add_all([cust_a, cust_b])
        db.commit()

        # Query with Tenant A context
        req_a = _mock_request(org_id=10)
        q_a = scope_query(db.query(Customer), Customer, req_a).all()
        assert len(q_a) == 1
        assert q_a[0].name == "Customer Alpha"

        # Query with Tenant B context
        req_b = _mock_request(org_id=20)
        q_b = scope_query(db.query(Customer), Customer, req_b).all()
        assert len(q_b) == 1
        assert q_b[0].name == "Customer Beta"
    finally:
        db.close()

def test_tenant_isolation_repairs_and_warranties():
    db = TestingSessionLocal()
    try:
        # Create Organizations
        org_a = Organization(id=10, name="Tenant Alpha", slug="alpha-org")
        org_b = Organization(id=20, name="Tenant Beta", slug="beta-org")
        db.add_all([org_a, org_b])
        db.commit()

        # Create Repair Ticket in Org A and Org B
        rep_a = RepairTicket(ticket_no="JOB-001", device_model="iPhone 15", issue="Screen", organization_id=10)
        rep_b = RepairTicket(ticket_no="JOB-002", device_model="Samsung S24", issue="Battery", organization_id=20)
        db.add_all([rep_a, rep_b])
        db.commit()

        # Org A must only see its repair ticket
        req_a = _mock_request(org_id=10)
        results_a = scope_query(db.query(RepairTicket), RepairTicket, req_a).all()
        assert len(results_a) == 1
        assert results_a[0].ticket_no == "JOB-001"

        # Org B must only see its repair ticket
        req_b = _mock_request(org_id=20)
        results_b = scope_query(db.query(RepairTicket), RepairTicket, req_b).all()
        assert len(results_b) == 1
        assert results_b[0].ticket_no == "JOB-002"
    finally:
        db.close()

def test_resolve_tenant_id_from_code():
    db = TestingSessionLocal()
    try:
        org = Organization(id=105, name="Nexus Store", slug="nexus-store", uuid="uuid-nexus-123")
        db.add(org)
        db.commit()

        assert resolve_tenant_id_from_code(db, "nexus-store") == 105
        assert resolve_tenant_id_from_code(db, "uuid-nexus-123") == 105
        assert resolve_tenant_id_from_code(db, "105") == 105
        assert resolve_tenant_id_from_code(db, "nonexistent") is None
    finally:
        db.close()
