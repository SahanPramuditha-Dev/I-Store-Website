"""
saas_router.py
==============
FastAPI Router for E-Store SaaS Control Center, Multi-Tenant Management,
Subscriptions, and Remote POS Device Licensing & Telemetry.
"""

from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import get_current_user, require_admin
from app.models import User, SaaSPlan, Organization, Branch, POSDevice, Subscription
from app.services import saas_service

router = APIRouter(prefix="/saas", tags=["SaaS Control Center & Licensing"])


# --- Schemas ---

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
