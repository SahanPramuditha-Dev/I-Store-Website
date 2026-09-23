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
from app.models import CustomerPortalOtp

from app.services.supabase_pos_sync import generate_invoice_token

logger = logging.getLogger("istore.customer_auth")

from app.config import settings
PORTAL_AUTH_SECRET = os.getenv("PORTAL_AUTH_SECRET") or settings.secret_key
OTP_EXPIRATION_SECONDS = int(os.getenv("PORTAL_OTP_EXPIRATION_SECONDS", "300"))  # 5 minutes

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
    expires_at = now + timedelta(minutes=30)

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
    db: Optional[Session] = None,
    store_id: str = "default",
) -> Dict[str, Any]:
    """
    Generates a 6-digit verification code and dispatches via WhatsApp.
    Enforces strict anti-abuse rate-limiting (max 3 OTP requests per 10 minutes).
    """
    clean_phone = _normalize_phone(phone)
    if channel.lower() != "whatsapp":
        return {"success": False, "error": "Only WhatsApp verification is available."}
    if db is None:
        return {"success": False, "error": "Verification storage is unavailable."}
    if len(clean_phone) < 9:
        return {"success": False, "error": "Invalid phone number format."}

    # Anti-Abuse Rate Limiting Check
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(seconds=RATE_LIMIT_WINDOW_SECONDS)).replace(tzinfo=None)
    count = db.query(CustomerPortalOtp).filter(CustomerPortalOtp.phone == clean_phone, CustomerPortalOtp.created_at >= cutoff).count()
    if count >= MAX_OTP_REQUESTS_PER_WINDOW:
        return {
            "success": False,
            "error": f"Rate limit exceeded. Maximum {MAX_OTP_REQUESTS_PER_WINDOW} verification codes per 10 minutes."
        }

    # Generate 6-digit numeric OTP
    code = f"{secrets.randbelow(1000000):06d}"
    code_hash = _hash_otp(clean_phone, code)
    expires_at = now + timedelta(seconds=OTP_EXPIRATION_SECONDS)

    otp_record = CustomerPortalOtp(phone=clean_phone, store_id=store_id, code_hash=code_hash,
                                   created_at=now.replace(tzinfo=None), expires_at=expires_at.replace(tzinfo=None), attempts=0)
    db.add(otp_record)
    db.commit()

    from app.utils.whatsapp_helper import LocalWebWhatsAppProvider
    import asyncio
    msg_text = (
        f"*{store_name} verification*\nYour code is *{code}*. "
        "It expires in 5 minutes. Do not share it."
    )
    try:
        delivery = asyncio.run(LocalWebWhatsAppProvider().send_text(clean_phone, msg_text))
    except Exception as exc:
        logger.warning("WhatsApp OTP delivery failed: %s", exc)
        delivery = {"success": False}
    if not delivery.get("success"):
        db.delete(otp_record)
        db.commit()
        return {"success": False, "error": "WhatsApp verification is unavailable. Please try again later."}

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
    if db is None:
        return False, "Verification storage is unavailable.", None
    record = (db.query(CustomerPortalOtp).filter(CustomerPortalOtp.phone == clean_phone,
              CustomerPortalOtp.store_id == store_id, CustomerPortalOtp.consumed_at.is_(None))
              .order_by(CustomerPortalOtp.created_at.desc()).first())

    if not record:
        return False, "No active verification code found. Please request a new code.", None

    now = datetime.now(timezone.utc)
    if now.replace(tzinfo=None) > record.expires_at:
        return False, "Verification code has expired. Please request a new one.", None

    if record.attempts >= 5:
        return False, "Too many failed attempts. Please request a new code.", None

    expected_hash = _hash_otp(clean_phone, otp_code.strip())
    if not hmac.compare_digest(record.code_hash, expected_hash):
        record.attempts += 1
        db.commit()
        return False, "Incorrect verification code. Please check and try again.", None

    # Consume once even when two workers verify the same code concurrently.
    updated = db.query(CustomerPortalOtp).filter(
        CustomerPortalOtp.id == record.id,
        CustomerPortalOtp.consumed_at.is_(None),
    ).update({CustomerPortalOtp.consumed_at: now.replace(tzinfo=None)})
    db.commit()
    if updated != 1:
        return False, "Verification code has already been used.", None

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
    Verifies a Smart Invoice / QR token. WhatsApp verification is still required.
    Returns: (is_valid, message, session_token, invoice_summary)
    """
    clean_no = invoice_no.strip().upper()
    expected_token = generate_invoice_token(clean_no)

    if not token or not hmac.compare_digest(token.strip(), expected_token):
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

    if invoice_summary is None:
        return False, "Invoice not found.", None, None

    return True, "Invoice link verified; WhatsApp verification required", None, invoice_summary
