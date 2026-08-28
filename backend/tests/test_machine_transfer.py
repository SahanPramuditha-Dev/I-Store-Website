import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request
from fastapi import HTTPException

from app.models import Base, Organization, Branch, Role, User
from app.routers.saas_router import transfer_license_to_current_machine, MachineTransferClientRequest


SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def test_self_service_machine_transfer_flow():
    # Test valid transfer client request schema validation
    req = MachineTransferClientRequest(
        license_key="ISTORE-DEMO-TRANSFER-2026",
        new_machine_fingerprint="FINGERPRINT-NEW-PC-0099",
        old_machine_fingerprint="FINGERPRINT-OLD-PC-0011",
        new_machine_name="Store-Front-Replacement"
    )

    assert req.license_key == "ISTORE-DEMO-TRANSFER-2026"
    assert req.new_machine_fingerprint == "FINGERPRINT-NEW-PC-0099"
    assert req.old_machine_fingerprint == "FINGERPRINT-OLD-PC-0011"
