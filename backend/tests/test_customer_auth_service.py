import pytest
from datetime import datetime, timezone, timedelta
from app.services.customer_auth_service import (
    generate_customer_session_token,
    verify_customer_session_token,
    request_customer_otp,
    verify_customer_otp,
    verify_smart_invoice_token,
    _ACTIVE_OTPS
)
from app.services.supabase_pos_sync import generate_invoice_token

def test_generate_and_verify_session_token():
    token = generate_customer_session_token(
        phone="0771234567",
        store_id="nexus-store",
        customer_name="Kasun"
    )
    is_valid, msg, payload = verify_customer_session_token(token)
    assert is_valid is True
    assert msg == "Session valid"
    assert payload["phone"] == "0771234567"
    assert payload["store_id"] == "nexus-store"
    assert payload["name"] == "Kasun"

def test_tampered_session_token_rejected():
    token = generate_customer_session_token(phone="0771234567")
    parts = token.split(".")
    tampered = "eyJhbGciOiJIUzI1NiJ9" + "." + parts[1]
    is_valid, msg, payload = verify_customer_session_token(tampered)
    assert is_valid is False
    assert "invalid" in msg.lower() or "tampered" in msg.lower()

def test_otp_flow_request_and_verify():
    # 1. Request OTP
    res = request_customer_otp(phone="0779991122", channel="whatsapp")
    assert res["success"] is True
    assert res["phone"] == "0779991122"

    # 2. Extract generated OTP hash from memory for testing
    clean_phone = "0779991122"
    record = _ACTIVE_OTPS.get(clean_phone)
    assert record is not None

    # Test wrong code
    is_valid, msg, session = verify_customer_otp(phone=clean_phone, otp_code="000000")
    assert is_valid is False
    assert "incorrect" in msg.lower()

def test_smart_invoice_token_verification():
    invoice_no = "INV-8899"
    expected_token = generate_invoice_token(invoice_no)

    # Valid token
    is_valid, msg, session, _ = verify_smart_invoice_token(invoice_no, expected_token)
    assert is_valid is True
    assert session is not None

    # Invalid token
    is_valid, msg, session, _ = verify_smart_invoice_token(invoice_no, "sec_wrongtoken")
    assert is_valid is False
    assert session is None
