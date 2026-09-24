from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import AppSetting, Role, User
from app.routers import auth_router


def test_bootstrap_never_reopens_for_existing_store(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(auth_router, "ensure_security_defaults", lambda _db: None)
    monkeypatch.setenv("ISTORE_TENANT_CODE", "TESTSTORE")
    monkeypatch.setenv("ISTORE_DESKTOP_INSTANCE_ID", "test-instance")

    with Session(engine) as db:
        fresh = auth_router.bootstrap_status(db)
        assert fresh["setup_required"] is True
        assert fresh["tenant_code"] == "TESTSTORE"
        assert fresh["desktop_instance_id"] == "test-instance"

        db.add(AppSetting(key="bootstrap_owner_completed_at", value="2026-09-24"))
        db.commit()
        recovery = auth_router.bootstrap_status(db)
        assert recovery["setup_required"] is False
        assert recovery["recovery_required"] is True

        owner_role = Role(name="owner", display_name="Owner")
        db.add(owner_role)
        db.flush()
        db.add(User(username="owner", full_name="Owner", role="Owner", role_id=owner_role.id))
        db.commit()
        ready = auth_router.bootstrap_status(db)
        assert ready["owner_exists"] is True
        assert ready["setup_required"] is False
        assert ready["recovery_required"] is False

    engine.dispose()
