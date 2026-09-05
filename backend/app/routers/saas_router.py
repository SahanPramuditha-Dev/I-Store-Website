"""
saas_router.py
==============
FastAPI Router for E-Store SaaS Control Center, Multi-Tenant Management,
Subscriptions, and Remote POS Device Licensing & Telemetry.
"""

import os
import sys
import json
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import get_current_user, get_current_user_optional, require_admin
from app.models import User, SaaSPlan, Organization, Branch, POSDevice, Subscription
from app.services import saas_service

from app.core.license_guard import (
    verify_license_token,
    get_cached_license,
    save_cached_license,
    clear_cached_license,
    ALLOW_DEV_LICENSE_BYPASS
)

router = APIRouter(prefix="/saas", tags=["SaaS Control Center & Licensing"])


# --- Schemas ---

class SignedLicenseActivationRequest(BaseModel):
    token_data: Dict[str, Any] = Field(..., description="Signed Ed25519 license token JSON from Control Center")
    machine_fingerprint: Optional[str] = None


class CreateOrgRequest(BaseModel):
    slug: str
    name: str
    legal_name: Optional[str] = None
    tax_number: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    country: str = "LK"
    currency: str = "LKR"
    timezone: str = "Asia/Colombo"
    current_plan_id: Optional[int] = None
    address: Optional[str] = None


class CreateBranchRequest(BaseModel):
    code: str
    name: str
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    is_warehouse: bool = False


class CreateDeviceLicenseRequest(BaseModel):
    organization_id: int
    branch_id: Optional[int] = None
    device_code: str
    device_name: Optional[str] = None


class DeviceStatusUpdateRequest(BaseModel):
    action: str = Field(..., description="activate, suspend, revoke, transfer")


class DeviceActivationRequest(BaseModel):
    license_key: str
    hardware_uuid: str
    app_version: str
    os_info: Optional[str] = None


class DeviceHeartbeatRequest(BaseModel):
    device_uuid: str
    hardware_uuid: str
    app_version: str
    offline_queue_count: int = 0



# =========================================================================
# CONTROL CENTER OVERVIEW & METRICS
# =========================================================================

@router.get("/overview")
def get_control_center_overview(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """Returns platform-level MRR, active orgs, total devices and live telemetry."""
    return saas_service.get_platform_overview(db)


# =========================================================================
# PLANS & PRICING
# =========================================================================

@router.get("/plans")
def list_plans(db: Session = Depends(get_db)):
    """Lists available SaaS tiers and feature matrices."""
    plans = db.query(SaaSPlan).filter(SaaSPlan.is_active == True).all()
    return [
        {
            "id": p.id,
            "code": p.code,
            "name": p.name,
            "description": p.description,
            "price_monthly": p.price_monthly,
            "price_yearly": p.price_yearly,
            "currency": p.currency,
            "max_branches": p.max_branches,
            "max_devices_per_branch": p.max_devices_per_branch,
            "max_users": p.max_users,
            "max_products": p.max_products,
            "features_config": p.features_config
        }
        for p in plans
    ]


# =========================================================================
# ORGANIZATIONS (TENANTS)
# =========================================================================

@router.get("/organizations")
def list_all_organizations(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """List all registered SaaS organizations."""
    orgs = saas_service.list_organizations(db, status=status)
    return [
        {
            "id": o.id,
            "uuid": o.uuid,
            "slug": o.slug,
            "name": o.name,
            "legal_name": o.legal_name,
            "contact_email": o.contact_email,
            "contact_phone": o.contact_phone,
            "country": o.country,
            "currency": o.currency,
            "status": o.status,
            "plan": o.plan.name if o.plan else "None",
            "branches_count": len(o.branches),
            "devices_count": len(o.devices),
            "trial_ends_at": o.trial_ends_at.isoformat() if o.trial_ends_at else None,
            "created_at": o.created_at.isoformat() if o.created_at else None
        }
        for o in orgs
    ]


@router.post("/organizations")
def register_organization(
    payload: CreateOrgRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """Creates a new organization tenant with primary branch and subscription."""
    existing = db.query(Organization).filter(Organization.slug == payload.slug.strip().lower()).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Organization with slug '{payload.slug}' already exists.")

    org = saas_service.create_organization(db, payload.dict())
    return {
        "success": True,
        "message": f"Organization '{org.name}' created successfully.",
        "organization_id": org.id,
        "uuid": org.uuid,
        "slug": org.slug
    }


# =========================================================================
# BRANCHES
# =========================================================================

@router.get("/organizations/{org_id}/branches")
def get_organization_branches(
    org_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """List all branches/outlets under an organization."""
    branches = saas_service.list_branches(db, organization_id=org_id)
    return [
        {
            "id": b.id,
            "uuid": b.uuid,
            "code": b.code,
            "name": b.name,
            "address": b.address,
            "phone": b.phone,
            "email": b.email,
            "is_warehouse": b.is_warehouse,
            "is_active": b.is_active
        }
        for b in branches
    ]


@router.post("/organizations/{org_id}/branches")
def add_branch(
    org_id: int,
    payload: CreateBranchRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """Add a new branch or warehouse to an organization."""
    existing = db.query(Branch).filter(
        Branch.organization_id == org_id,
        Branch.code == payload.code.strip().upper()
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Branch code '{payload.code}' already exists in this organization.")

    branch = saas_service.create_branch(db, organization_id=org_id, data=payload.dict())
    return {
        "success": True,
        "branch_id": branch.id,
        "code": branch.code,
        "name": branch.name
    }


# =========================================================================
# POS DEVICES & REMOTE LICENSING
# =========================================================================

@router.get("/devices")
def list_pos_devices(
    organization_id: Optional[int] = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """List all registered POS terminals and their activation status."""
    devices = saas_service.list_devices(db, organization_id=organization_id)
    return [
        {
            "id": d.id,
            "uuid": d.uuid,
            "organization_id": d.organization_id,
            "organization_name": d.organization.name if d.organization else None,
            "branch_id": d.branch_id,
            "branch_name": d.branch.name if d.branch else None,
            "device_code": d.device_code,
            "device_name": d.device_name,
            "license_key": d.license_key,
            "activation_status": d.activation_status,
            "hardware_uuid": d.hardware_uuid,
            "app_version": d.app_version,
            "last_heartbeat_at": d.last_heartbeat_at.isoformat() if d.last_heartbeat_at else None,
            "offline_queue_count": d.offline_queue_count
        }
        for d in devices
    ]


@router.post("/devices/generate-license")
def generate_device_license(
    payload: CreateDeviceLicenseRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """Generates an activation token / license key for a new POS terminal."""
    device = saas_service.create_device_license(
        db=db,
        organization_id=payload.organization_id,
        branch_id=payload.branch_id,
        device_code=payload.device_code,
        device_name=payload.device_name
    )
    return {
        "success": True,
        "device_id": device.id,
        "device_code": device.device_code,
        "license_key": device.license_key,
        "activation_status": device.activation_status
    }


@router.put("/devices/{device_id}/status")
def manage_device_status(
    device_id: int,
    payload: DeviceStatusUpdateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """Admin controls: activate, suspend, revoke, or transfer a POS terminal license."""
    updated = saas_service.update_device_status(db, device_id=device_id, action=payload.action.lower())
    if not updated:
        raise HTTPException(status_code=404, detail="Device not found.")
    return {
        "success": True,
        "device_id": updated.id,
        "activation_status": updated.activation_status
    }


# =========================================================================
# PUBLIC / CLIENT POS MACHINE ENDPOINTS (NO USER AUTH REQUIRED)
# =========================================================================

@router.post("/devices/activate")
def activate_pos_terminal(
    payload: DeviceActivationRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """Called by POS desktop application to bind its hardware to a license key."""
    ip = request.client.host if request.client else None
    result = saas_service.activate_device_by_license(
        db=db,
        license_key=payload.license_key,
        hardware_uuid=payload.hardware_uuid,
        app_version=payload.app_version,
        os_info=payload.os_info,
        ip_address=ip
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@router.post("/devices/heartbeat")
def pos_terminal_heartbeat(
    payload: DeviceHeartbeatRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """Called periodically by POS desktop terminal to report health and verify license."""
    ip = request.client.host if request.client else None
    result = saas_service.record_device_heartbeat(
        db=db,
        device_uuid=payload.device_uuid,
        hardware_uuid=payload.hardware_uuid,
        app_version=payload.app_version,
        offline_queue_count=payload.offline_queue_count,
        ip_address=ip
    )
    if not result.get("valid"):
        raise HTTPException(status_code=403, detail=result.get("error"))
    return result


# =========================================================================
# CENTRAL ED25519 LICENSING CLIENT ENDPOINTS
# =========================================================================

@router.get("/license/status")
def get_license_status():
    """
    Returns current local Ed25519 license verification status, expiry,
    grace period information, and active capabilities.
    """
    cached = get_cached_license()
    if not cached:
        if ALLOW_DEV_LICENSE_BYPASS:
            return {
                "active": True,
                "mode": "development_bypass",
                "message": "Running in development mode without license constraint.",
                "capabilities": ["all"]
            }
        return {
            "active": False,
            "mode": "unlicensed",
            "message": "No active license installed.",
            "activation_required": True
        }

    is_valid, msg, payload = verify_license_token(cached)
    return {
        "active": is_valid,
        "message": msg,
        "payload": payload,
        "license_id": payload.get("license_id") if payload else None,
        "tenant_code": payload.get("tenant_code") if payload else None,
        "package_code": payload.get("package_code") if payload else None,
        "industry_code": payload.get("industry_code") if payload else None,
        "capabilities": payload.get("capabilities", []) if payload else [],
        "expires_at": payload.get("expires_at") if payload else None,
        "grace_period_days": payload.get("grace_period_days") if payload else 3,
    }


@router.post("/license/activate")
def activate_ed25519_license(payload: SignedLicenseActivationRequest):
    """
    Installs and cryptographically verifies an Ed25519 signed license token
    issued by the central E-Store Control Center.
    """
    is_valid, msg, validated_payload = verify_license_token(
        token_data=payload.token_data,
        current_machine_fingerprint=payload.machine_fingerprint
    )

    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"License activation rejected: {msg}"
        )

    # Persist verified license token to local cache
    save_cached_license(payload.token_data)

    return {
        "success": True,
        "message": "License successfully verified and activated.",
        "tenant_code": validated_payload.get("tenant_code"),
        "package_code": validated_payload.get("package_code"),
        "expires_at": validated_payload.get("expires_at"),
        "capabilities": validated_payload.get("capabilities", [])
    }


@router.post("/license/push-update")
def push_license_update(payload: SignedLicenseActivationRequest, db: Session = Depends(get_db)):
    """
    Receives an instant push notification from the Central SaaS Platform
    when capabilities or industry templates are updated remotely.
    """
    is_valid, msg, validated_payload = verify_license_token(
        token_data=payload.token_data,
        current_machine_fingerprint=payload.machine_fingerprint
    )

    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Push update rejected: {msg}"
        )

    # Persist updated verified license token
    save_cached_license(payload.token_data)

    # Sync organization capabilities immediately if organization matches
    tenant_code = validated_payload.get("tenant_code")
    if tenant_code:
        org = db.query(Organization).filter(Organization.slug == tenant_code).first()
        if org:
            industry_code = validated_payload.get("industry_code")
            if industry_code:
                org.industry_type = industry_code
            org.capability_overrides = json.dumps(validated_payload.get("capabilities", []))
            db.commit()

    return {
        "success": True,
        "message": "License and capabilities pushed and updated in real-time.",
        "tenant_code": validated_payload.get("tenant_code"),
        "industry_code": validated_payload.get("industry_code"),
        "capabilities": validated_payload.get("capabilities", [])
    }


class LicenseKeyActivationRequest(BaseModel):
    license_key: str = Field(..., description="E-Store license key string (e.g. ISTORE-IPOINT-KOTUGODA-2026)")
    machine_fingerprint: Optional[str] = Field(None, description="Hardware fingerprint identifier")


@router.post("/license/activate-key")
def activate_by_license_key(payload: LicenseKeyActivationRequest):
    """
    Activates the POS terminal by resolving a license key against the Central Licensing Platform,
    verifying the signed Ed25519 token, and persisting it to local cache.
    """
    clean_key = payload.license_key.strip().upper()
    if not clean_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="License key cannot be empty."
        )

    token_data = None
    activation_error = None

    # 1. Local Ecosystem direct generator (Fastest & direct in workspace)
    try:
        import subprocess
        from pathlib import Path
        candidate_paths = [
            Path(r"c:\D\Projects\Websites\E Store Bussiness and License Platform\backend"),
            Path(__file__).resolve().parents[4] / "E Store Bussiness and License Platform" / "backend" if len(Path(__file__).resolve().parents) > 4 else None,
            Path(__file__).resolve().parents[3] / "E Store Bussiness and License Platform" / "backend" if len(Path(__file__).resolve().parents) > 3 else None,
        ]
        control_backend_path = None
        for cp in candidate_paths:
            if cp and cp.exists():
                control_backend_path = str(cp.resolve())
                break

        if control_backend_path:
            fp = payload.machine_fingerprint or "*"
            db_file_posix = (Path(control_backend_path) / "license_platform.db").as_posix()
            cb_posix = Path(control_backend_path).as_posix()
            gen_code = (
                "import sys, os, json\n"
                f"sys.path.insert(0, '{cb_posix}')\n"
                "from sqlalchemy import create_engine\n"
                "from sqlalchemy.orm import sessionmaker\n"
                f"sqlite_engine = create_engine('sqlite:///{db_file_posix}')\n"
                "LocalSession = sessionmaker(bind=sqlite_engine)\n"
                "from app.models import License\n"
                "from app.licensing.service import LicenseService\n"
                "db = LocalSession()\n"
                f"lic = db.query(License).filter(License.license_key == '{clean_key}').first()\n"
                "if lic:\n"
                f"    token = LicenseService.generate_signed_token_for_license(db, lic, machine_fingerprint='{fp}')\n"
                "    print('___TOKEN_START___')\n"
                "    print(token.model_dump_json())\n"
                "    print('___TOKEN_END___')\n"
                "else:\n"
                f"    print('ERROR: License key {clean_key} not found in database', file=sys.stderr)\n"
                "db.close()\n"
            )
            res = subprocess.run([sys.executable, "-c", gen_code], cwd=control_backend_path, capture_output=True, text=True, timeout=5)
            if "___TOKEN_START___" in res.stdout:
                raw_json = res.stdout.split("___TOKEN_START___")[1].split("___TOKEN_END___")[0].strip()
                token_data = json.loads(raw_json)
            else:
                activation_error = f"Subprocess output: {res.stdout} | Stderr: {res.stderr}"
        else:
            activation_error = f"Path not found: {control_backend_path}"
    except Exception as local_err:
        activation_error = f"Local exception: {local_err}"

    # 2. Remote SaaS Control Center API (if local not present or failed)
    if not token_data:
        control_server_url = os.getenv("CONTROL_CENTER_URL") or os.getenv("ESTORE_LICENSE_SERVER_URL") or "https://e-store-control-center-backend.vercel.app"
        try:
            import httpx
            with httpx.Client(timeout=10.0) as client:
                for endpoint in ["/api/license/activate", "/license/activate"]:
                    try:
                        resp = client.post(
                            f"{control_server_url.rstrip('/')}{endpoint}",
                            json={
                                "license_key": clean_key,
                                "machine_fingerprint": payload.machine_fingerprint or "WEB-POS-TERMINAL",
                                "machine_name": "POS Station",
                                "app_version": "2.4.0"
                            }
                        )
                        if resp.status_code == 200:
                            res_json = resp.json()
                            if res_json.get("success") and res_json.get("token"):
                                token_data = res_json["token"]
                                break
                        else:
                            activation_error = resp.text
                    except Exception as req_err:
                        activation_error = str(req_err)
        except Exception as http_err:
            if not activation_error:
                activation_error = str(http_err)

    if not token_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"License activation failed for key '{clean_key}'. Reason: {activation_error or 'License key not found or invalid.'}"
        )

    # 3. Cryptographically verify the Ed25519 token locally before accepting
    is_valid, msg, validated_payload = verify_license_token(
        token_data=token_data,
        current_machine_fingerprint=payload.machine_fingerprint
    )

    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"License cryptographic verification rejected: {msg}"
        )

    # 4. Persist verified license token to local cache
    save_cached_license(token_data)

    tenant_code = (validated_payload.get("tenant_code") or "").upper()
    shop_code = (validated_payload.get("shop_code") or "").upper()
    industry_code = validated_payload.get("industry_code") or "MOBILE_RETAIL"

    # Known tenant metadata catalog
    TENANT_DIRECTORY = {
        "FRESHGR": {
            "tenant_name": "FreshLand Supermarket & Grocers",
            "shop_name": "FreshLand Supercenter Kandy",
            "industry_code": "GROCERY",
            "tagline": "Fresh Produce & Daily Essentials",
            "business_type": "Supermarket & Grocery"
        },
        "IPOINT": {
            "tenant_name": "I Point Electronics",
            "shop_name": "Kotugoda Branch",
            "industry_code": "MOBILE_RETAIL",
            "tagline": "Your Trusted Mobile & Tech Partner",
            "business_type": "Mobile Phone & Tech Store"
        },
        "APEXMOB": {
            "tenant_name": "Apex Mobile Retail & Repairs",
            "shop_name": "Apex Flagship Colombo 03",
            "industry_code": "MOBILE_RETAIL",
            "tagline": "Premium Electronics & Certified Repairs",
            "business_type": "Mobile Phone & Tech Store"
        },
        "VOGUEF": {
            "tenant_name": "Vogue Avenue Fashion & Apparel",
            "shop_name": "Vogue Colombo One",
            "industry_code": "FASHION",
            "tagline": "Contemporary Style & Apparel",
            "business_type": "Fashion & Apparel Boutique"
        },
    }

    t_info = TENANT_DIRECTORY.get(tenant_code, {
        "tenant_name": tenant_code or "E-Store Retail",
        "shop_name": shop_code or "Main Branch",
        "industry_code": industry_code,
        "tagline": "E-Store Business Suite",
        "business_type": "Retail Store"
    })

    # 5. Synchronize local store profile & organization settings in DB
    try:
        from app.database import SessionLocal
        from app.models import Setting
        with SessionLocal() as sdb:
            setting_row = sdb.query(Setting).filter(Setting.key == "store_profile").first()
            if setting_row:
                profile = json.loads(setting_row.value) if isinstance(setting_row.value, str) else dict(setting_row.value or {})
                if "business_identity" not in profile:
                    profile["business_identity"] = {}
                profile["business_identity"]["shop_name"] = t_info["tenant_name"]
                profile["business_identity"]["business_type"] = t_info["business_type"]
                profile["business_identity"]["shop_tagline"] = t_info["tagline"]
                setting_row.value = json.dumps(profile)
                sdb.commit()
    except Exception as sync_err:
        pass

    return {
        "success": True,
        "message": f"Terminal successfully activated for {t_info['tenant_name']} ({t_info['industry_code']})!",
        "token": token_data,
        "tenant_code": tenant_code,
        "tenant_name": t_info["tenant_name"],
        "shop_code": shop_code,
        "shop_name": t_info["shop_name"],
        "industry_code": t_info["industry_code"],
        "package_code": validated_payload.get("package_code") if validated_payload else None,
        "expires_at": validated_payload.get("expires_at") if validated_payload else None,
        "capabilities": validated_payload.get("capabilities", []) if validated_payload else []
    }


class MachineTransferClientRequest(BaseModel):
    license_key: str = Field(..., description="E-Store license key string")
    new_machine_fingerprint: str = Field(..., description="Target hardware fingerprint")
    old_machine_fingerprint: Optional[str] = None
    new_machine_name: Optional[str] = "Replacement POS"


@router.post("/license/transfer-machine")
def transfer_license_to_current_machine(payload: MachineTransferClientRequest):
    """
    Executes a self-service machine license transfer against Central SaaS platform,
    validates the new Ed25519 token, and installs it to local cache.
    """
    clean_key = payload.license_key.strip().upper()
    token_data = None
    transfer_error = None

    # Try local control center direct execution
    try:
        import subprocess
        from pathlib import Path
        candidate_paths = [
            Path(r"c:\D\Projects\Websites\E Store Bussiness and License Platform\backend"),
            Path(__file__).resolve().parents[4] / "E Store Bussiness and License Platform" / "backend" if len(Path(__file__).resolve().parents) > 4 else None,
            Path(__file__).resolve().parents[3] / "E Store Bussiness and License Platform" / "backend" if len(Path(__file__).resolve().parents) > 3 else None,
        ]
        control_backend_path = next((str(cp.resolve()) for cp in candidate_paths if cp and cp.exists()), None)
        if control_backend_path:
            db_file_posix = (Path(control_backend_path) / "license_platform.db").as_posix()
            cb_posix = Path(control_backend_path).as_posix()
            old_fp_val = payload.old_machine_fingerprint or ""
            gen_code = (
                "import sys, os, json\n"
                f"sys.path.insert(0, '{cb_posix}')\n"
                "from sqlalchemy import create_engine\n"
                "from sqlalchemy.orm import sessionmaker\n"
                f"sqlite_engine = create_engine('sqlite:///{db_file_posix}')\n"
                "LocalSession = sessionmaker(bind=sqlite_engine)\n"
                "from app.licensing.service import LicenseService\n"
                "db = LocalSession()\n"
                f"success, msg, token = LicenseService.transfer_machine(db, '{clean_key}', '{payload.new_machine_fingerprint}', '{old_fp_val}', '{payload.new_machine_name}')\n"
                "if success and token:\n"
                "    print('___TOKEN_START___')\n"
                "    print(token.model_dump_json())\n"
                "    print('___TOKEN_END___')\n"
                "else:\n"
                "    print(f'ERROR: {msg}', file=sys.stderr)\n"
                "db.close()\n"
            )
            res = subprocess.run([sys.executable, "-c", gen_code], cwd=control_backend_path, capture_output=True, text=True, timeout=5)
            if "___TOKEN_START___" in res.stdout:
                raw_json = res.stdout.split("___TOKEN_START___")[1].split("___TOKEN_END___")[0].strip()
                token_data = json.loads(raw_json)
            else:
                transfer_error = res.stderr or res.stdout
    except Exception as e:
        transfer_error = str(e)

    # Fallback to HTTP API
    if not token_data:
        control_server_url = os.getenv("CONTROL_CENTER_URL") or "https://e-store-control-center-backend.vercel.app"
        try:
            import httpx
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(
                    f"{control_server_url.rstrip('/')}/api/license/transfer-machine",
                    json={
                        "license_key": clean_key,
                        "new_machine_fingerprint": payload.new_machine_fingerprint,
                        "old_machine_fingerprint": payload.old_machine_fingerprint,
                        "new_machine_name": payload.new_machine_name
                    }
                )
                if resp.status_code == 200 and resp.json().get("success"):
                    token_data = resp.json()["token"]
                else:
                    transfer_error = resp.text
        except Exception as http_err:
            transfer_error = str(http_err)

    if not token_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"License transfer failed: {transfer_error or 'Unable to transfer license.'}"
        )

    is_valid, msg, validated_payload = verify_license_token(token_data, current_machine_fingerprint=payload.new_machine_fingerprint)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Transferred license verification rejected: {msg}"
        )

    save_cached_license(token_data)
    return {
        "success": True,
        "message": "License successfully transferred to this PC and activated.",
        "tenant_code": validated_payload.get("tenant_code"),
        "package_code": validated_payload.get("package_code"),
        "capabilities": validated_payload.get("capabilities", [])
    }


@router.post("/license/deactivate")
@router.post("/license/reset")
def deactivate_pos_license():
    """
    Deactivates and removes all cached license tokens, returning the terminal
    to an unactivated/locked state.
    """
    clear_cached_license()
    return {
        "success": True,
        "active": False,
        "message": "License deactivated successfully. Terminal is now locked and requires activation."
    }


@router.get("/capabilities")
@router.get("/tenant/capabilities")
def get_tenant_capabilities(
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """
    Returns effective industry capabilities, modules enabled, and active business
    model for the authenticated user's organization or active license.
    """
    from app.services.capability_service import get_effective_capabilities
    org_id = current_user.organization_id if current_user else None
    return get_effective_capabilities(db, org_id)


@router.get("/telemetry/status")
def get_terminal_telemetry_status(
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """
    Returns live hardware, database, and telemetry health metrics for this POS terminal.
    """
    from app.services.saas_service import collect_system_telemetry
    cached = get_cached_license()
    license_active = False
    license_message = "No activated license"
    if cached:
        license_active, license_message, _ = verify_license_token(cached)
    return {
        "success": True,
        "metrics": collect_system_telemetry(db),
        "license_active": license_active,
        "license_message": license_message,
    }


@router.post("/telemetry/heartbeat")
def trigger_terminal_heartbeat(
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """
    Gathers local health metrics, packages telemetry, and dispatches heartbeat pulse.
    """
    from app.services.saas_service import send_terminal_heartbeat
    res = send_terminal_heartbeat(db)
    return res

