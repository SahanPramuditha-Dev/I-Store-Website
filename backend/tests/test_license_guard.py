import os
import json
import base64
import pytest
from datetime import datetime, timezone, timedelta
from fastapi import Request, HTTPException
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives import serialization

from app.core.license_guard import (
    canonicalize_bytes,
    verify_license_token,
    require_active_license,
    load_public_key_from_b64
)

def _generate_ed25519_keypair():
    priv = ed25519.Ed25519PrivateKey.generate()
    pub = priv.public_key()
    pub_bytes = pub.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw
    )
    pub_b64 = base64.b64encode(pub_bytes).decode('ascii')
    return priv, pub, pub_b64

def _sign_token(payload: dict, private_key: ed25519.Ed25519PrivateKey) -> dict:
    canonical = canonicalize_bytes(payload)
    sig = private_key.sign(canonical)
    sig_b64 = base64.b64encode(sig).decode('ascii')
    return {
        "payload": payload,
        "signature": sig_b64,
        "signature_algorithm": "Ed25519",
        "key_id": payload.get("key_id", "test-key-1")
    }

def test_valid_ed25519_signature():
    priv, pub, pub_b64 = _generate_ed25519_keypair()
    payload = {
        "license_id": "LIC-2026-TEST",
        "tenant_code": "TEN-ALPHA",
        "shop_code": "SHOP-01",
        "package_code": "BUSINESS_AI",
        "industry_code": "MOBILE_RETAIL",
        "capabilities": ["imei_tracking", "repairs_management"],
        "machine_fingerprint": "MACH-TEST-1234",
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "starts_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=365)).isoformat(),
        "grace_period_days": 14,
        "key_id": "test-key-1"
    }

    token = _sign_token(payload, priv)
    is_valid, msg, validated_payload = verify_license_token(
        token_data=token,
        public_key=pub,
        current_machine_fingerprint="MACH-TEST-1234"
    )

    assert is_valid is True
    assert msg == "License valid and active"
    assert validated_payload["tenant_code"] == "TEN-ALPHA"
    assert "imei_tracking" in validated_payload["capabilities"]

def test_tampered_payload_rejection():
    priv, pub, pub_b64 = _generate_ed25519_keypair()
    payload = {
        "license_id": "LIC-2026-TEST",
        "tenant_code": "TEN-ALPHA",
        "package_code": "STARTER",
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
    }
    token = _sign_token(payload, priv)

    # Tamper with package code
    token["payload"]["package_code"] = "ENTERPRISE_UNLIMITED"

    is_valid, msg, _ = verify_license_token(
        token_data=token,
        public_key=pub
    )
    assert is_valid is False
    assert "tampered" in msg.lower() or "invalid" in msg.lower()

def test_machine_fingerprint_mismatch():
    priv, pub, pub_b64 = _generate_ed25519_keypair()
    payload = {
        "license_id": "LIC-2026-TEST",
        "tenant_code": "TEN-ALPHA",
        "machine_fingerprint": "LICENSED-DEVICE-AAA",
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
    }
    token = _sign_token(payload, priv)

    is_valid, msg, _ = verify_license_token(
        token_data=token,
        public_key=pub,
        current_machine_fingerprint="ROGUE-DEVICE-BBB"
    )
    assert is_valid is False
    assert "mismatch" in msg.lower()

def test_expired_token_grace_period():
    priv, pub, pub_b64 = _generate_ed25519_keypair()
    now = datetime.now(timezone.utc)
    
    # Expired 1 day ago, with 3-day grace period
    payload = {
        "license_id": "LIC-2026-EXPIRED",
        "tenant_code": "TEN-ALPHA",
        "expires_at": (now - timedelta(days=1)).isoformat(),
        "grace_period_days": 3,
    }
    token = _sign_token(payload, priv)

    is_valid, msg, payload_out = verify_license_token(
        token_data=token,
        public_key=pub
    )
    assert is_valid is True
    assert "Grace Period" in msg

def test_expired_token_past_grace_period():
    priv, pub, pub_b64 = _generate_ed25519_keypair()
    now = datetime.now(timezone.utc)
    
    # Expired 10 days ago, with 3-day grace period
    payload = {
        "license_id": "LIC-2026-EXPIRED",
        "tenant_code": "TEN-ALPHA",
        "expires_at": (now - timedelta(days=10)).isoformat(),
        "grace_period_days": 3,
    }
    token = _sign_token(payload, priv)

    is_valid, msg, payload_out = verify_license_token(
        token_data=token,
        public_key=pub
    )
    assert is_valid is False
    assert "expired" in msg.lower()
