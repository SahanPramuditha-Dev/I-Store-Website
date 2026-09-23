import re
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models import CustomerPortalOtp
from app.services.customer_auth_service import request_customer_otp, verify_customer_otp
from app.utils.whatsapp_helper import LocalWebWhatsAppProvider


def test_rate_limit_and_replay(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    CustomerPortalOtp.__table__.create(engine)
    messages = []

    async def send_text(self, phone, message):
        messages.append(message)
        return {"success": True}

    monkeypatch.setattr(LocalWebWhatsAppProvider, "send_text", send_text)
    with Session(engine) as db:
        for _ in range(3):
            assert request_customer_otp("0771234567", db=db)["success"]
        assert not request_customer_otp("0771234567", db=db)["success"]
        code = re.search(r"\*(\d{6})\*", messages[-1]).group(1)
        assert verify_customer_otp("0771234567", code, db=db)[0]
        assert not verify_customer_otp("0771234567", code, db=db)[0]
    engine.dispose()
