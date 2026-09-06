from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Branch, Organization, User
from app.services.saas_service import ensure_default_saas_structure


def test_signed_tenant_metadata_provisions_isolated_identity(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    monkeypatch.setenv("ISTORE_TENANT_CODE", "SUPERMAR")
    monkeypatch.setenv("ISTORE_SHOP_CODE", "SUPERMAR-HQ")
    monkeypatch.setenv("ISTORE_INDUSTRY_CODE", "SUPERMARKET")

    try:
        ensure_default_saas_structure(session)

        organization = session.query(Organization).one()
        branch = session.query(Branch).one()
        assert organization.slug == "supermar"
        assert organization.name == "supermarket test"
        assert organization.industry_type == "SUPERMARKET"
        assert branch.organization_id == organization.id
        assert branch.code == "SUPERMAR-HQ"
        assert branch.name == "SUPERMAR-HQ"
        assert session.query(User).count() == 0
    finally:
        session.close()
        engine.dispose()
