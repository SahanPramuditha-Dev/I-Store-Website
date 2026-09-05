"""
license_guard.py
================
Enterprise Ed25519 License Verification Engine & FastAPI Security Guard.
Validates digitally signed license tokens issued by the central E-Store Control Center.
Guarantees cryptographic authenticity, machine hardware binding, and offline grace-period compliance.
"""

import os
import json
import base64
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional, Tuple

try:
    from dotenv import load_dotenv
    backend_dir = Path(__file__).resolve().parents[2]
    root_dir = Path(__file__).resolve().parents[3]
    load_dotenv(backend_dir / ".env")
    load_dotenv(root_dir / ".env")
except ImportError:
    pass

from fastapi import Request, HTTPException, status, Depends
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.exceptions import InvalidSignature

logger = logging.getLogger("istore.license_guard")

# Rotatable Public Verification Key (Loaded from environment)
ESTORE_PUBLIC_KEY_B64 = os.getenv("ESTORE_PUBLIC_KEY_B64", "")
LICENSE_CACHE_FILE = os.getenv("LICENSE_CACHE_FILE", "database/license_cache.json")
ALLOW_DEV_LICENSE_BYPASS = os.getenv("ALLOW_DEV_LICENSE_BYPASS", "false").lower() in ("true", "1", "yes")

# Open endpoints exempted from license enforcement
EXEMPT_ROUTES = {
    "/",
    "/health",
    "/api/health",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
    "/auth/login",
    "/api/auth/login",
    "/auth/pin-login",
    "/api/auth/pin-login",
    "/auth/refresh",
    "/api/auth/refresh",
    "/saas/license/status",
    "/api/saas/license/status",
    "/saas/license/activate",
    "/api/saas/license/activate",
    "/saas/license/activate-key",
    "/api/saas/license/activate-key",
    "/saas/license/deactivate",
    "/api/saas/license/deactivate",
    "/saas/license/reset",
    "/api/saas/license/reset",
    "/saas/plans",
    "/api/saas/plans",
}

ENTITLEMENT_ROUTE_PREFIXES = {
    "core_pos": ("/pos", "/invoices", "/payments", "/shifts"),
    "inventory": ("/inventory", "/catalog", "/purchase", "/labels"),
    "repairs": ("/repairs", "/warranty"),
    "smart_sms": ("/api/whatsapp",),
    "ai_assistant": ("/api/ai",),
    "bi_analytics": ("/api/analytics",),
}


def _required_capabilities_for_path(path: str) -> set[str]:
    """Return acceptable signed capabilities for industry-specific API paths."""
    if path.startswith("/inventory/batches"):
        return {"batch_tracking", "expiry_tracking"}
    if path.startswith("/inventory/serials") or "/serials" in path:
        return {"serial_tracking", "imei_tracking"}
    if path.startswith("/catalog/variants") or (
        path.startswith("/catalog/products/") and ("generate-variants" in path or "save-variants" in path)
    ):
        return {"variants_matrix", "size_color_variants"}
    return set()


def canonicalize_json(data: Any) -> str:
    """Deterministically formats JSON dictionary for cryptographic verification."""
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def canonicalize_bytes(data: Any) -> bytes:
    """Returns canonical UTF-8 encoded bytes for Ed25519 signature validation."""
    return canonicalize_json(data).encode("utf-8")


def load_public_key_from_b64(b64_str: str) -> ed25519.Ed25519PublicKey:
    """Loads Ed25519 public key from 32-byte Base64 string."""
    raw_bytes = base64.b64decode(b64_str.strip())
    return ed25519.Ed25519PublicKey.from_public_bytes(raw_bytes)


def _resolve_license_cache_path() -> Path:
    env_path = os.getenv("LICENSE_CACHE_FILE")
    candidates = []
    if env_path:
        p = Path(env_path)
        if p.is_absolute():
            return p
        candidates.extend([
            Path(__file__).resolve().parents[3] / p,
            Path(__file__).resolve().parents[2] / p,
            Path(p).resolve()
        ])
    
    candidates.extend([
        Path(__file__).resolve().parents[3] / "database" / "license_cache.json",
        Path(__file__).resolve().parents[2] / "database" / "license_cache.json",
        Path("database/license_cache.json").resolve()
    ])
    for c in candidates:
        if c.exists():
            return c
    return candidates[0]


def get_cached_license() -> Optional[Dict[str, Any]]:
    """Retrieves cached signed license token from local disk or memory."""
    target_path = _resolve_license_cache_path()
    if target_path.exists():
        try:
            with open(target_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                # Compatibility with Electron <= 1.1.101, which persisted the
                # signed object under `token`. Keep only the signed structure
                # plus harmless local metadata so both runtimes share one file.
                if isinstance(data, dict) and isinstance(data.get("token"), dict):
                    wrapped = data["token"]
                    if wrapped.get("payload") and wrapped.get("signature"):
                        normalized = {
                            **wrapped,
                            "license_key": data.get("license_key") or wrapped["payload"].get("license_id"),
                            "cached_at": data.get("cached_at"),
                            "last_verified_at": data.get("last_verified_at"),
                            "hardware_uuid": data.get("hardware_uuid"),
                        }
                        save_cached_license(normalized)
                        return normalized
                return data
        except Exception as e:
            logger.warning(f"Failed to read license cache file ({target_path}): {e}")
    return None


def save_cached_license(token_data: Dict[str, Any]) -> bool:
    """Saves verified signed license token to local cache file for offline capability."""
    target_path = _resolve_license_cache_path()
    try:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        with open(target_path, "w", encoding="utf-8") as f:
            json.dump(token_data, f, indent=2)
        return True
    except Exception as e:
        logger.error(f"Failed to persist license cache ({target_path}): {e}")
        return False


def clear_cached_license() -> bool:
    """Clears and deletes all cached license tokens to reset terminal into unlicensed state."""
    deleted = False
    for p in [
        Path(__file__).resolve().parents[3] / "database" / "license_cache.json",
        Path(__file__).resolve().parents[2] / "database" / "license_cache.json",
        _resolve_license_cache_path()
    ]:
        try:
            if p.exists():
                p.unlink()
                deleted = True
        except Exception as e:
            logger.warning(f"Error removing license cache {p}: {e}")
    return deleted


def verify_license_token(
    token_data: Dict[str, Any],
    public_key: Optional[ed25519.Ed25519PublicKey] = None,
    public_key_b64: Optional[str] = None,
    current_machine_fingerprint: Optional[str] = None,
) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
    """
    Cryptographically verifies an Ed25519 signed license token and validates invariants.
    Returns: (is_valid, message, payload_dict)
    """
    if not token_data or not isinstance(token_data, dict):
        return False, "License token missing or malformed", None

    payload = token_data.get("payload")
    signature = token_data.get("signature")

    if not payload or not signature:
        return False, "Incomplete license token structure (missing payload or signature)", None

    # 1. Resolve Public Key
    if public_key is None:
        key_str = public_key_b64 or ESTORE_PUBLIC_KEY_B64
        if not key_str:
            if ALLOW_DEV_LICENSE_BYPASS:
                return True, "Development bypass active (no public key configured)", payload
            return False, "Server verification public key not configured", None
        try:
            public_key = load_public_key_from_b64(key_str)
        except Exception as e:
            return False, f"Invalid public key format: {e}", None

    # 2. Cryptographic Signature Verification
    try:
        sig_bytes = base64.b64decode(signature)
        canonical_bytes = canonicalize_bytes(payload)
        public_key.verify(sig_bytes, canonical_bytes)
    except InvalidSignature:
        return False, "Cryptographic signature invalid: License payload has been tampered with", None
    except Exception as e:
        return False, f"Signature verification error: {e}", None

    # 3. Hardware Fingerprint Validation
    if current_machine_fingerprint:
        licensed_fingerprint = payload.get("machine_fingerprint")
        if licensed_fingerprint and licensed_fingerprint != "*":
            if licensed_fingerprint.strip().lower() != current_machine_fingerprint.strip().lower():
                return False, f"Machine fingerprint mismatch. Licensed to: {licensed_fingerprint}", None

    # 4. Temporal Expiration & Offline Grace Period Validation
    expires_at_str = payload.get("expires_at")
    grace_days = int(payload.get("grace_period_days") or 3)  # Standard 72h offline grace

    if expires_at_str:
        try:
            expires_at = datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)

            if now > expires_at:
                grace_cutoff = expires_at + timedelta(days=grace_days)
                if now <= grace_cutoff:
                    hours_left = int((grace_cutoff - now).total_seconds() // 3600)
                    logger.warning(f"License expired on {expires_at.isoformat()}. Active in offline grace period ({hours_left}h remaining).")
                    return True, f"In Grace Period ({hours_left}h remaining)", payload
                else:
                    return False, f"License expired on {expires_at.isoformat()}", None
        except Exception as e:
            return False, f"Invalid expires_at format in license: {e}", None

    return True, "License valid and active", payload


def is_route_exempt(path: str) -> bool:
    if path in {"", "/"}:
        return True
    for exempt in EXEMPT_ROUTES:
        if exempt in {"", "/"}:
            continue
        if path == exempt or path.startswith(exempt + "/") or path.startswith(exempt + "?"):
            return True
    return False


async def require_active_license(request: Request) -> Dict[str, Any]:
    """
    FastAPI dependency that enforces valid, unexpired, authentic Ed25519 licensing
    on all protected operational routes.
    """
    path = request.url.path
    if is_route_exempt(path):
        return {"status": "exempt", "path": path}

    # 1. Check active request header license token
    header_token = request.headers.get("X-License-Token")
    token_data = None
    if header_token:
        try:
            token_data = json.loads(header_token)
        except Exception:
            pass

    # 2. Fallback to cached license
    if not token_data:
        token_data = get_cached_license()

    # 3. If no license present
    if not token_data:
        if ALLOW_DEV_LICENSE_BYPASS:
            return {"status": "dev_bypass", "tenant_code": "DEV-LOCAL"}
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "LICENSE_REQUIRED",
                "message": "No valid E-Store license found. Please activate your system via the SaaS Control Center.",
                "activation_url": "/saas/license/activate"
            }
        )

    # 4. Verify License
    is_valid, msg, payload = verify_license_token(token_data)
    if not is_valid:
        if ALLOW_DEV_LICENSE_BYPASS:
            logger.warning(f"License verification failed ({msg}), but DEV bypass is enabled.")
            return {"status": "dev_bypass", "warning": msg}
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "LICENSE_INVALID",
                "message": msg,
                "activation_url": "/saas/license/activate"
            }
        )

    entitlements = set(payload.get("entitlements") or [])
    if "all" not in entitlements:
        for entitlement, prefixes in ENTITLEMENT_ROUTE_PREFIXES.items():
            if any(path == prefix or path.startswith(prefix + "/") for prefix in prefixes):
                if entitlement not in entitlements:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail={
                            "error": "ENTITLEMENT_REQUIRED",
                            "message": f"The active E Store package does not include '{entitlement}'.",
                            "required_entitlement": entitlement,
                        },
                    )
                break

    signed_capabilities = set(payload.get("capabilities") or [])
    required_capabilities = _required_capabilities_for_path(path)
    if required_capabilities and "all" not in signed_capabilities and not (required_capabilities & signed_capabilities):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "CAPABILITY_REQUIRED",
                "message": "This workflow is not enabled for the licensed industry profile.",
                "accepted_capabilities": sorted(required_capabilities),
            },
        )

    # Attach license metadata to request state
    request.state.license_payload = payload
    return payload
