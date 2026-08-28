import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request

from app.models import Base, Organization, Branch, Role, User, Sale, SyncOutbox
from app.services.saas_service import collect_system_telemetry, send_terminal_heartbeat
from app.routers.saas_router import get_terminal_telemetry_status, trigger_terminal_heartbeat


SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    org = db.query(Organization).first()
    if not org:
        org = Organization(slug="main-store", name="Main Store Enterprise")
        db.add(org)
        db.flush()

    branch = db.query(Branch).filter_by(organization_id=org.id).first()
    if not branch:
        branch = Branch(organization_id=org.id, code="BR-01", name="Colombo Flagship")
        db.add(branch)
        db.flush()

    role = db.query(Role).filter_by(name="admin").first()
    if not role:
        role = Role(name="admin", display_name="Administrator")
        db.add(role)
        db.flush()

    user = User(id=1, username="admin", organization_id=1, branch_id=10, role_id=role.id, role="admin")
    db.add(user)

    # Seed an outbox event
    outbox = SyncOutbox(
        organization_id=org.id,
        branch_id=branch.id,
        entity_type="sale",
        entity_id="1001",
        action="CREATE",
        payload='{"invoice_no": "INV-001"}',
        status="pending"
    )
    db.add(outbox)
    db.commit()
    db.close()

    yield

    Base.metadata.drop_all(bind=engine)


def test_collect_system_telemetry():
    db = TestingSessionLocal()
    metrics = collect_system_telemetry(db)

    assert "hostname" in metrics
    assert "disk_free_gb" in metrics
    assert metrics["disk_free_gb"] > 0
    assert "pending_outbox_events" in metrics
    assert metrics["pending_outbox_events"] == 1
    assert metrics["app_version"] == "v2.6.0-enterprise"
    assert "platform" in metrics
    db.close()


def test_send_terminal_heartbeat():
    db = TestingSessionLocal()
    result = send_terminal_heartbeat(db)

    assert result["success"] is True
    assert result["sent"] is True
    assert "telemetry" in result
    assert result["telemetry"]["pending_outbox_events"] == 1
    assert "fingerprint" in result
    db.close()


def test_telemetry_endpoints():
    db = TestingSessionLocal()
    status_resp = get_terminal_telemetry_status(db=db, current_user=None)
    assert status_resp["success"] is True
    assert status_resp["metrics"]["pending_outbox_events"] == 1

    hb_resp = trigger_terminal_heartbeat(db=db, current_user=None)
    assert hb_resp["success"] is True
    db.close()
