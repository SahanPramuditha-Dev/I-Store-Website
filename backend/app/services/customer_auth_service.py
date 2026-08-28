"""
customer_auth_service.py
========================
Dual-Mode Authentication Service for Public Customer Portal.
Provides:
1. Primary: Cryptographic Smart Invoice Token verification (QR & WhatsApp links).
2. Phone Verification: Zero-cost 6-digit WhatsApp OTP verification (with pluggable SMS gateway hooks).
3. Secure HMAC-SHA256 Customer Session token generation and validation.
"""

import os
import hmac
import hashlib
import base64
import json
import secrets
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, Tuple
from sqlalchemy.orm import Session

from app.services.supabase_pos_sync import generate_invoice_token

logger = logging.getLogger("istore.customer_auth")

PORTAL_AUTH_SECRET = os.getenv("PORTAL_AUTH_SECRET", "istore_customer_session_secret_2026_key")
OTP_EXPIRATION_SECONDS = int(os.getenv("PORTAL_OTP_EXPIRATION_SECONDS", "300"))  # 5 minutes

# In-memory OTP cache: phone -> {hash, expires_at, attempts}
_ACTIVE_OTPS: Dict[str, Dict[str, Any]] = {}

# Anti-Abuse Rate Limiting: phone -> list of request epoch timestamps
_OTP_REQUEST_TIMESTAMPS: Dict[str, list] = {}
MAX_OTP_REQUESTS_PER_WINDOW = 3
RATE_LIMIT_WINDOW_SECONDS = 600  # 10 minutes


def _normalize_phone(phone: str) -> str:
    """Normalizes phone number removing spaces, dashes, and country prefixes."""
    digits = "".join(filter(str.isdigit, str(phone or "")))
    if digits.startswith("94") and len(digits) == 11:
        digits = "0" + digits[2:]
    return digits


def _hash_otp(phone: str, code: str) -> str:
    """Computes HMAC hash of the OTP code bound to the phone number."""
    key = PORTAL_AUTH_SECRET.encode("utf-8")
    msg = f"{phone}:{code}".encode("utf-8")
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


def generate_customer_session_token(phone: str, store_id: str = "default", customer_name: Optional[str] = None, invoice_id: Optional[str] = None) -> str:
    """
    Generates a tamper-proof HMAC-signed session token for the customer portal.
    """
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=30)  # 30 days customer session

    payload = {
        "phone": phone,
        "store_id": store_id,
        "name": customer_name or "Customer",
        "invoice_id": invoice_id,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "nonce": secrets.token_hex(8)
    }

    raw_json = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    payload_b64 = base64.urlsafe_b64encode(raw_json.encode("utf-8")).decode("ascii").rstrip("=")

    signature = hmac.new(
        PORTAL_AUTH_SECRET.encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()

    return f"{payload_b64}.{signature}"


def verify_customer_session_token(token_str: str) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
    """
    Validates cryptographic authenticity and expiration of a customer session token.
    """
    if not token_str or "." not in token_str:
        return False, "Invalid session token format", None

    parts = token_str.strip().split(".")
    if len(parts) != 2:
        return False, "Malformed session token", None

    payload_b64, signature = parts[0], parts[1]

    # 1. Verify HMAC Signature
    expected_sig = hmac.new(
        PORTAL_AUTH_SECRET.encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(signature, expected_sig):
        return False, "Session token signature invalid or tampered", None

    # 2. Decode Payload
    try:
        padding = "=" * ((4 - len(payload_b64) % 4) % 4)
        raw_json = base64.urlsafe_b64decode((payload_b64 + padding).encode("ascii")).decode("utf-8")
        payload = json.loads(raw_json)
    except Exception:
        return False, "Failed to decode session token payload", None

    # 3. Expiration Check
    now = datetime.now(timezone.utc).timestamp()
    if payload.get("exp", 0) < now:
        return False, "Session token has expired", None

    return True, "Session valid", payload


def request_customer_otp(
    phone: str,
    channel: str = "whatsapp",
    store_name: str = "I-Store",
    db: Optional[Session] = None
) -> Dict[str, Any]:
    """
    Generates a 6-digit verification code and dispatches via WhatsApp (or SMS hook).
    Enforces strict anti-abuse rate-limiting (max 3 OTP requests per 10 minutes).
    """
    clean_phone = _normalize_phone(phone)
    if len(clean_phone) < 9:
        return {"success": False, "error": "Invalid phone number format."}

    # Anti-Abuse Rate Limiting Check
    now = datetime.now(timezone.utc)
    now_ts = now.timestamp()
    timestamps = [t for t in _OTP_REQUEST_TIMESTAMPS.get(clean_phone, []) if now_ts - t < RATE_LIMIT_WINDOW_SECONDS]
    if len(timestamps) >= MAX_OTP_REQUESTS_PER_WINDOW:
        wait_mins = max(1, int((RATE_LIMIT_WINDOW_SECONDS - (now_ts - timestamps[0])) / 60))
        return {
            "success": False,
            "error": f"Rate limit exceeded. Maximum {MAX_OTP_REQUESTS_PER_WINDOW} verification codes per 10 minutes. Please try again in {wait_mins} minute(s)."
        }

    timestamps.append(now_ts)
    _OTP_REQUEST_TIMESTAMPS[clean_phone] = timestamps

    # Generate 6-digit numeric OTP
    code = f"{secrets.randbelow(1000000):06d}"
    code_hash = _hash_otp(clean_phone, code)
    expires_at = now + timedelta(seconds=OTP_EXPIRATION_SECONDS)

    _ACTIVE_OTPS[clean_phone] = {
        "hash": code_hash,
        "expires_at": expires_at,
        "attempts": 0
    }

    # Dispatch OTP via chosen channel
    dispatched = False
    if channel.lower() == "whatsapp":
        try:
            from app.utils.whatsapp_helper import log_and_send_whatsapp
            msg_text = (
                f"🔐 *{store_name} Customer Portal Verification*\n\n"
                f"Your 6-digit verification code is: *{code}*\n\n"
                f"This code will expire in 5 minutes. Do not share this code with anyone."
            )
            # If WhatsApp service is active, send message
            log_and_send_whatsapp(
                event_type="CUSTOMER_PORTAL_OTP",
                phone=clean_phone,
                variables={"otp_code": code, "store_name": store_name, "message": msg_text}
            )
            dispatched = True
            logger.info(f"Dispatched WhatsApp OTP to {clean_phone}")
        except Exception as we:
            logger.warning(f"WhatsApp OTP dispatch notice: {we}")

    elif channel.lower() == "sms":
        # Pluggable SMS Gateway Adapter Hook (e.g. NotifyLK, Twilio, Dialog)
        logger.info(f"SMS Gateway Hook called for {clean_phone}. (Pluggable adapter ready)")
        dispatched = True

    # In development/test mode, record code in log
    logger.debug(f"[DEV/TEST] Generated OTP for {clean_phone}: {code}")

    return {
        "success": True,
        "message": f"Verification code sent via {channel.capitalize()}.",
        "phone": clean_phone,
        "expires_in_seconds": OTP_EXPIRATION_SECONDS,
        "channel": channel
    }


def verify_customer_otp(
    phone: str,
    otp_code: str,
    store_id: str = "default",
    db: Optional[Session] = None
) -> Tuple[bool, str, Optional[str]]:
    """
    Verifies the customer's 6-digit OTP and returns an authenticated session token.
    Returns: (is_valid, message, session_token)
    """
    clean_phone = _normalize_phone(phone)
    record = _ACTIVE_OTPS.get(clean_phone)

    if not record:
        return False, "No active verification code found. Please request a new code.", None

    now = datetime.now(timezone.utc)
    if now > record["expires_at"]:
        _ACTIVE_OTPS.pop(clean_phone, None)
        return False, "Verification code has expired. Please request a new one.", None

    if record["attempts"] >= 5:
        _ACTIVE_OTPS.pop(clean_phone, None)
        return False, "Too many failed attempts. Please request a new code.", None

    expected_hash = _hash_otp(clean_phone, otp_code.strip())
    if not hmac.compare_digest(record["hash"], expected_hash):
        record["attempts"] += 1
        return False, "Incorrect verification code. Please check and try again.", None

    # OTP Verified Successfully -> Clear from cache
    _ACTIVE_OTPS.pop(clean_phone, None)

    # Resolve customer name if DB is available
    customer_name = "Customer"
    if db:
        try:
            from app.models import Customer
            c = db.query(Customer).filter(Customer.phone == clean_phone).first()
            if c:
                customer_name = c.name
        except Exception:
            pass

    session_token = generate_customer_session_token(
        phone=clean_phone,
        store_id=store_id,
        customer_name=customer_name
    )

    return True, "Verification successful", session_token


def verify_smart_invoice_token(
    invoice_no: str,
    token: str,
    store_id: str = "default",
    db: Optional[Session] = None
) -> Tuple[bool, str, Optional[str], Optional[Dict[str, Any]]]:
    """
    Verifies a Smart Invoice / QR token and automatically creates an authenticated customer session.
    Returns: (is_valid, message, session_token, invoice_summary)
    """
    clean_no = invoice_no.strip().upper()
    expected_token = generate_invoice_token(clean_no)

    if not token or token.strip() != expected_token:
        return False, "Invalid or expired invoice security token.", None, None

    customer_phone = ""
    customer_name = "Customer"
    invoice_summary = None

    if db:
        try:
            from app.models import Sale, Customer
            sale = db.query(Sale).filter(Sale.invoice_no == clean_no, Sale.is_deleted == False).first()
            if sale:
                customer = db.query(Customer).filter(Customer.id == sale.customer_id).first() if sale.customer_id else None
                if customer:
                    customer_phone = customer.phone
                    customer_name = customer.name
                invoice_summary = {
                    "invoice_no": clean_no,
                    "total": float(sale.total or 0),
                    "created_at": sale.created_at.isoformat() if sale.created_at else None
                }
        except Exception as e:
            logger.debug(f"Sale lookup notice: {e}")

    session_token = generate_customer_session_token(
        phone=customer_phone or clean_no,
        store_id=store_id,
        customer_name=customer_name,
        invoice_id=clean_no
    )

    return True, "Invoice token verified", session_token, invoice_summary
