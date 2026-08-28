import pytest
from app.services.customer_auth_service import (
    request_customer_otp,
    verify_customer_otp,
    verify_customer_session_token,
    _ACTIVE_OTPS,
    _OTP_REQUEST_TIMESTAMPS,
    _hash_otp
)


@pytest.fixture(autouse=True)
def clean_otp_cache():
    _ACTIVE_OTPS.clear()
    _OTP_REQUEST_TIMESTAMPS.clear()
    yield
    _ACTIVE_OTPS.clear()
    _OTP_REQUEST_TIMESTAMPS.clear()


def test_customer_otp_flow_and_anti_abuse_rate_limit():
    test_phone = "0771234567"

    # 1. Request 1st OTP - should succeed
    res1 = request_customer_otp(phone=test_phone, channel="whatsapp", store_name="FreshLand")
    assert res1["success"] is True
    assert res1["channel"] == "whatsapp"

    # 2. Request 2nd OTP - should succeed
    res2 = request_customer_otp(phone=test_phone, channel="whatsapp", store_name="FreshLand")
    assert res2["success"] is True

    # 3. Request 3rd OTP - should succeed
    res3 = request_customer_otp(phone=test_phone, channel="whatsapp", store_name="FreshLand")
    assert res3["success"] is True

    # 4. Request 4th OTP within 10 mins - MUST be rejected by Anti-Abuse Rate Limiter
    res4 = request_customer_otp(phone=test_phone, channel="whatsapp", store_name="FreshLand")
    assert res4["success"] is False
    assert "Rate limit exceeded" in res4["error"]
    assert "Maximum 3 verification codes" in res4["error"]


def test_otp_verification_and_session_token():
    test_phone = "0785571342"
    res = request_customer_otp(phone=test_phone, channel="whatsapp", store_name="Nexusis")
    assert res["success"] is True

    # Artificially inject known hash to test exact code
    clean_digits = "0785571342"
    _ACTIVE_OTPS[clean_digits]["hash"] = _hash_otp(clean_digits, "889922")

    # Wrong code should fail
    is_valid, msg, token = verify_customer_otp(test_phone, "000000", store_id="nexusis")
    assert is_valid is False

    # Correct code should succeed and issue session token
    is_valid, msg, token = verify_customer_otp(test_phone, "889922", store_id="nexusis")
    assert is_valid is True
    assert token is not None

    # Cryptographically verify the session token
    is_session_valid, session_msg, payload = verify_customer_session_token(token)
    assert is_session_valid is True
    assert payload["phone"] == clean_digits
    assert payload["store_id"] == "nexusis"
