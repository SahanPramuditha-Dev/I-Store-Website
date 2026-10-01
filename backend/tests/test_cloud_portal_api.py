import hashlib
import importlib.util
import json
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app.database import Base, get_db
from app.models import AppSetting, Branch, Customer, Organization, PortalServiceRequest, RepairTicket, Sale, SaleItem, WarrantyRecord
from app.routers.cloud_portal_router import router, _digest
from app.routers.portal_requests_router import router as staff_router, staff
from app.utils.time import utcnow


@pytest.fixture
def fixture(monkeypatch):
    values = {"CLOUDFLARE_PORTAL_ENABLED": "true", "POS_PORTAL_API_TOKEN": "t" * 43, "CLOUDFLARE_RECEIPT_IDENTITY_KEY": "r" * 43, "CLOUDFLARE_RECEIPT_LINK_KEY": "l" * 43, "CLOUDFLARE_PORTAL_ORGANIZATION_ID": "1", "CLOUDFLARE_PORTAL_BRANCH_ID": "1", "CLOUDFLARE_PORTAL_STORE_REF": "shop"}
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add_all([Organization(id=1, slug="shop", name="Synthetic shop"), Organization(id=2, slug="other", name="Other shop")])
        db.add_all([Branch(id=1, organization_id=1, code="A", name="A"), Branch(id=2, organization_id=1, code="B", name="B")])
        db.add_all([Customer(id=1, organization_id=1, name="Customer", phone="0771234567"), Customer(id=2, organization_id=1, name="Other customer", phone="0777654321")])
        db.add_all([Sale(id=1, organization_id=1, branch_id=1, customer_id=1, invoice_no="TEST-1", subtotal=100, total=100), Sale(id=2, organization_id=1, branch_id=1, customer_id=2, invoice_no="OTHER"), Sale(id=3, organization_id=1, branch_id=2, customer_id=1, invoice_no="OTHER-BRANCH")])
        db.add(SaleItem(sale_id=1, organization_id=1, branch_id=1, price=100, quantity=1, description="Item"))
        for identifier, branch_id, customer_id in [(1,1,1),(2,1,2),(3,2,1)]:
            db.add(RepairTicket(id=identifier, organization_id=1, branch_id=branch_id, customer_id=customer_id, ticket_no=f"JOB-{identifier}", device_model="Phone", issue="Test"))
            db.add(WarrantyRecord(id=identifier, organization_id=1, branch_id=branch_id, customer_id=customer_id, warranty_code=f"W-{identifier}", product_or_service_name="Phone", warranty_type="product", start_date=utcnow(), end_date=utcnow()+timedelta(days=30)))
        state = {"identity": hashlib.sha256(b"1:+94771234567").hexdigest(), "invoice_ref": "TEST-1", "revoked": False}
        db.add(AppSetting(key="portal_bill:shop:1:1", value=json.dumps(state)))
        db.commit()
        app = FastAPI()
        app.include_router(router)
        app.include_router(staff_router)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[staff] = lambda: SimpleNamespace(id=None, organization_id=1, branch_id=1)
        headers = {"Authorization": "Bearer " + values["POS_PORTAL_API_TOKEN"], "X-Portal-Store-Ref": "shop", "X-Portal-Invoice-Ref": "TEST-1", "X-Portal-Customer-Ref": _digest("shop:94771234567", values["CLOUDFLARE_RECEIPT_IDENTITY_KEY"]), "X-Portal-Receipt-Id": _digest("shop:TEST-1", values["CLOUDFLARE_RECEIPT_IDENTITY_KEY"])}
        with TestClient(app) as client:
            yield client, db, headers, app
    engine.dispose()


def test_auth_identity_revocation_and_branch_fail_closed(fixture, monkeypatch):
    client, db, headers, _ = fixture
    assert client.get("/portal/repairs").status_code == 401
    assert client.get("/portal/repairs", headers=headers).status_code == 200
    for field in ["X-Portal-Customer-Ref", "X-Portal-Receipt-Id", "X-Portal-Store-Ref", "X-Portal-Invoice-Ref"]:
        assert client.get("/portal/repairs", headers={**headers, field: "other"}).status_code == 404
    db.get(Customer, 1).phone = "0779999999"
    db.commit()
    assert client.get("/portal/repairs", headers=headers).status_code == 404
    monkeypatch.delenv("CLOUDFLARE_PORTAL_ORGANIZATION_ID")
    assert client.get("/portal/repairs", headers=headers).status_code == 503


def test_lists_and_details_never_return_other_customer_or_branch(fixture):
    client, db, headers, _ = fixture
    for resource in ["warranties", "repairs"]:
        assert [row["id"] for row in client.get(f"/portal/{resource}", headers=headers).json()[resource]] == [1]
        assert client.get(f"/portal/{resource}/1", headers=headers).status_code == 200
        for identifier in [2,3,999,10**30]:
            assert client.get(f"/portal/{resource}/{identifier}", headers=headers).status_code == 404
    assert client.get("/portal/bills/OTHER", headers=headers).status_code == 404
    assert client.get("/portal/bills/INV-" + "9" * 90, headers=headers).status_code == 404
    response = client.get("/portal/bills/TEST-1/download", headers=headers)
    assert response.status_code == 200
    assert response.json()["invoiceRef"] == "TEST-1"
    assert response.headers["content-disposition"] == 'attachment; filename="invoice-1.json"'
    db.query(AppSetting).first().value = json.dumps({"revoked": True})
    db.commit()
    assert client.get("/portal/bills", headers=headers).status_code == 404


def test_requests_are_persisted_and_staff_can_review(fixture):
    client, db, headers, _ = fixture
    for path, payload in [("repairs", {"message": "Please inspect my phone"}), ("feedback", {"message": "Thank you for your help"}), ("warranty-claims", {"warranty_id":1,"message":"My phone no longer charges"})]:
        response = client.post(f"/portal/{path}", json=payload, headers=headers)
        assert response.status_code == 202
        assert response.json()["status"] == "pending"
    assert db.query(PortalServiceRequest).count() == 3
    assert client.post("/portal/warranty-claims", json={"warranty_id":2,"message":"Foreign claim"}, headers=headers).status_code == 404
    assert client.post("/portal/repairs", json={"message":"Repair please","customer_id":2}, headers=headers).status_code == 422
    inbox = client.get("/portal-requests").json()["requests"]
    assert len(inbox) == 3
    assert client.patch(f'/portal-requests/{inbox[0]["id"]}',json={"status":"completed","response":"Handled in the shop"}).status_code == 200


def test_appointments_time_validation_updates_cancellation_and_ownership(fixture):
    client, db, headers, app = fixture
    date = (utcnow()+timedelta(days=2)).isoformat()+"Z"
    payload = {"message":"Phone service appointment", "requested_at":date}
    assert client.post("/portal/appointments", json={**payload,"requested_at":"2020-01-01T00:00:00Z"},headers=headers).status_code == 422
    assert client.post("/portal/appointments", json={**payload,"requested_at":date[:-1]},headers=headers).status_code == 422
    created = client.post("/portal/appointments",json=payload,headers=headers).json()
    identifier = created["id"]
    assert client.get("/portal/appointments",headers=headers).json()["appointments"][0]["id"] == identifier
    assert client.patch(f"/portal-requests/{identifier}",json={"status":"confirmed","response":"See you at the shop"}).status_code == 200
    assert client.patch(f"/portal/appointments/{identifier}",json=payload,headers=headers).json()["status"] == "pending"
    db.get(PortalServiceRequest,identifier).customer_id=2
    db.commit()
    assert client.delete(f"/portal/appointments/{identifier}",headers=headers).status_code == 404
    assert client.get("/portal/appointments",headers=headers).json()["appointments"] == []
    db.get(PortalServiceRequest,identifier).customer_id=1
    db.commit()
    assert client.delete(f"/portal/appointments/{identifier}",headers=headers).json()["status"] == "cancelled"
    assert client.patch(f"/portal/appointments/{identifier}",json=payload,headers=headers).status_code == 409
    app.dependency_overrides[staff]=lambda: SimpleNamespace(id=None,organization_id=2,branch_id=1)
    assert client.get("/portal-requests").json()["requests"] == []


def test_resend_is_a_review_request_not_a_false_sent_confirmation(fixture):
    client, db, headers, _ = fixture
    first=client.post("/portal/bills/TEST-1/resend",headers=headers)
    assert first.status_code == 202
    assert first.json()["status"] == "pending"
    assert client.post("/portal/bills/TEST-1/resend",headers=headers).json()["id"] == first.json()["id"]
    db.get(Customer,1).whatsapp_opt_in=False
    db.commit()
    assert client.post("/portal/bills/TEST-1/resend",headers=headers).status_code == 409


def test_request_migration_is_idempotent_and_missing_schema_returns_503(fixture):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    client, db, headers, _ = fixture
    PortalServiceRequest.__table__.drop(db.bind)
    assert client.get("/portal/appointments",headers=headers).status_code == 503
    spec=importlib.util.spec_from_file_location("portal_migration",Path("alembic/versions/20261001_0023_portal_requests.py"))
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with db.bind.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            module.upgrade()
            module.upgrade()
    assert client.get("/portal/appointments",headers=headers).status_code == 200
