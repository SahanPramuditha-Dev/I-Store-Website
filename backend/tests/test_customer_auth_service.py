import re
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models import CustomerPortalOtp
from app.services.customer_auth_service import (
    generate_customer_session_token, verify_customer_session_token,
    request_customer_otp, verify_customer_otp, verify_smart_invoice_token,
)
from app.services.supabase_pos_sync import generate_invoice_token
from app.utils.whatsapp_helper import LocalWebWhatsAppProvider


@pytest.fixture
def otp_db(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    CustomerPortalOtp.__table__.create(engine)
    sent = []

    async def send_text(self, phone, message):
        sent.append((phone, message))
        return {"success": True}

    monkeypatch.setattr(LocalWebWhatsAppProvider, "send_text", send_text)
    with Session(engine) as db:
        yield db, sent
    engine.dispose()


def test_session_signature():
    token = generate_customer_session_token("0771234567", store_id="nexus-store")
    valid, _, payload = verify_customer_session_token(token)
    assert valid and payload["phone"] == "0771234567"
    assert verify_customer_session_token(token + "x")[0] is False


def test_whatsapp_otp_is_persisted_and_one_time(otp_db):
    db, sent = otp_db
    result = request_customer_otp("0779991122", db=db, store_id="store-a")
    assert result["success"] is True
    code = re.search(r"\*(\d{6})\*", sent[-1][1]).group(1)
    assert db.query(CustomerPortalOtp).count() == 1
    assert verify_customer_otp("0779991122", "000000", store_id="store-a", db=db)[0] is False
    assert verify_customer_otp("0779991122", code, store_id="store-b", db=db)[0] is False
    assert verify_customer_otp("0779991122", code, store_id="store-a", db=db)[0] is True
    assert verify_customer_otp("0779991122", code, store_id="store-a", db=db)[0] is False


def test_delivery_failure_does_not_create_otp(otp_db, monkeypatch):
    db, _ = otp_db
    async def fail(self, phone, message):
        return {"success": False}
    monkeypatch.setattr(LocalWebWhatsAppProvider, "send_text", fail)
    assert request_customer_otp("0779991122", db=db)["success"] is False
    assert db.query(CustomerPortalOtp).count() == 0


def test_code_is_stored_before_whatsapp_send(otp_db, monkeypatch):
    db, _ = otp_db
    async def check_stored(self, phone, message):
        assert db.query(CustomerPortalOtp).filter_by(phone=phone).count() == 1
        return {"success": True}
    monkeypatch.setattr(LocalWebWhatsAppProvider, "send_text", check_stored)
    assert request_customer_otp("0779991122", db=db)["success"] is True


def test_sms_is_rejected(otp_db):
    db, _ = otp_db
    assert request_customer_otp("0779991122", channel="sms", db=db)["success"] is False


def test_invoice_token_does_not_authenticate_missing_invoice():
    invoice_no = "INV-8899"
    token = generate_invoice_token(invoice_no)
    assert verify_smart_invoice_token(invoice_no, token)[0] is False
    assert verify_smart_invoice_token(invoice_no, "sec_wrongtoken")[0] is False
