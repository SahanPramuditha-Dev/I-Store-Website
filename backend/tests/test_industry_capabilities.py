import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi import HTTPException

from app.database import Base
from app.models import Organization, SaaSPlan, User
from app.services.capability_service import (
    DEFAULT_INDUSTRY_CAPABILITIES,
    get_effective_capabilities,
    has_capability,
    require_capability
)
from app.services.capability_service import resolve_license_limits

import os
TEST_DB_URL = "sqlite:///:memory:"


def test_legacy_license_tokens_use_package_aware_limits():
    assert resolve_license_limits({"package_code": "STARTER"})["max_users"] == 5
    assert resolve_license_limits({"package_code": "BUSINESS"})["max_users"] == 15
    assert resolve_license_limits({"package_code": "BUSINESS_AI"})["max_devices"] == 10
    assert resolve_license_limits({"package_code": "ENTERPRISE"})["max_stores"] == 25
    assert resolve_license_limits({"package_code": "ENTERPRISE", "max_users": 40})["max_users"] == 40

@pytest.fixture(autouse=True)
def clean_license_cache(monkeypatch):
    monkeypatch.setattr("app.core.license_guard.get_cached_license", lambda: None)
    yield

@pytest.fixture
def db():
    engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


def test_default_industry_capability_matrices():
    """Verify built-in default industry capability profiles."""
    mobile = DEFAULT_INDUSTRY_CAPABILITIES["MOBILE_RETAIL"]
    assert mobile["repairs_management"] is True
    assert mobile["imei_tracking"] is True
    assert mobile["warranty_management"] is True
    assert mobile["batch_tracking"] is False
    assert mobile["weighted_products"] is False

    grocery = DEFAULT_INDUSTRY_CAPABILITIES["GROCERY"]
    assert grocery["repairs_management"] is False
    assert grocery["imei_tracking"] is False
    assert grocery["warranty_management"] is False
    assert grocery["batch_tracking"] is True
    assert grocery["expiry_tracking"] is True
    assert grocery["weighted_products"] is True

    fashion = DEFAULT_INDUSTRY_CAPABILITIES["FASHION"]
    assert fashion["repairs_management"] is False
    assert fashion["size_color_variants"] is True
    assert fashion["season_management"] is True

    electronics = DEFAULT_INDUSTRY_CAPABILITIES["ELECTRONICS"]
    assert electronics["serial_tracking"] is True
    assert electronics["repairs_management"] is True
    assert electronics["warranty_management"] is True


def test_organization_industry_switching(db):
    """Verify effective capabilities dynamically change when an organization's industry changes."""
    org = Organization(
        name="Apex Enterprises",
        slug="apex-lk",
        industry_type="MOBILE_RETAIL"
    )
    db.add(org)
    db.commit()
    db.refresh(org)

    # 1. As Mobile Retail
    res = get_effective_capabilities(db, org.id)
    assert res["industry_type"] == "MOBILE_RETAIL"
    assert res["capabilities"]["repairs_management"] is True
    assert res["capabilities"]["imei_tracking"] is True
    assert res["capabilities"]["weighted_products"] is False

    # 2. Switch to Supermarket / Grocery
    org.industry_type = "GROCERY"
    db.commit()

    res_grocery = get_effective_capabilities(db, org.id)
    assert res_grocery["industry_type"] == "GROCERY"
    assert res_grocery["capabilities"]["repairs_management"] is False
    assert res_grocery["capabilities"]["imei_tracking"] is False
    assert res_grocery["capabilities"]["weighted_products"] is True
    assert res_grocery["capabilities"]["expiry_tracking"] is True


def test_organization_capability_overrides(db):
    """Verify custom capability overrides on top of industry templates."""
    org = Organization(
        name="Tech & Groceries Hybrid",
        slug="hybrid-lk",
        industry_type="GROCERY",
        capabilities_override={"repairs_management": True, "warranty_management": True}
    )
    db.add(org)
    db.commit()
    db.refresh(org)

    res = get_effective_capabilities(db, org.id)
    assert res["industry_type"] == "GROCERY"
    # Overrides turned repairs on despite grocery default
    assert res["capabilities"]["repairs_management"] is True
    assert res["capabilities"]["warranty_management"] is True
    # Standard grocery defaults remain
    assert res["capabilities"]["weighted_products"] is True


def test_require_capability_dependency_guard(db):
    """Verify require_capability raises HTTP 403 if capability is disabled."""
    org = Organization(
        name="Fresh Mart",
        slug="fresh-mart",
        industry_type="GROCERY"
    )
    db.add(org)
    db.commit()
    db.refresh(org)

    user = User(
        username="cashier1",
        email="cashier@fresh.lk",
        password_hash="hash",
        role="Cashier",
        organization_id=org.id
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Repairs dependency for grocery user
    repair_guard = require_capability("repairs_management")
    with pytest.raises(HTTPException) as exc_info:
        repair_guard(current_user=user, db=db)
    assert exc_info.value.status_code == 403
    assert "repairs_management" in exc_info.value.detail

    # Expiry tracking dependency for grocery user
    expiry_guard = require_capability("expiry_tracking")
    allowed = expiry_guard(current_user=user, db=db)
    assert allowed is True
