"""
saas_service.py
================
Service to manage Organizations, SaaS Plans, Subscriptions, Devices, and Branches.
Includes automated default seeder and full lifecycle management routines.
"""

import uuid
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session
from app.models import SaaSPlan, Organization, Branch, POSDevice, Subscription, User

def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)

def generate_license_key() -> str:
    """Generates a structured format license key: ESTORE-XXXX-XXXX-XXXX"""
    part1 = secrets.token_hex(2).upper()
    part2 = secrets.token_hex(2).upper()
    part3 = secrets.token_hex(2).upper()
    return f"ESTORE-{part1}-{part2}-{part3}"

def ensure_default_saas_structure(db: Session):
    """
    Guarantees that a default SaaS Plan, Organization, and Branch exist,
    and backfills any legacy unassigned Users to the default organization.
    """
    try:
        # 1. Ensure Default Plan
        default_plan = db.query(SaaSPlan).filter(SaaSPlan.code == "enterprise").first()
        if not default_plan:
            default_plan = SaaSPlan(
                code="enterprise",
                name="Enterprise Full Suite",
                description="Unlimited branches, POS devices, and multi-tenant features.",
                price_monthly=0.0,
                price_yearly=0.0,
                currency="LKR",
                max_branches=100,
                max_devices_per_branch=50,
                max_users=100,
                max_products=100000,
                features_config={
                    "repairs": True,
                    "warranty": True,
                    "advanced_analytics": True,
                    "api_access": True,
                    "multi_currency": True,
                    "whatsapp_integration": True,
                },
                is_active=True
            )
            db.add(default_plan)
            db.flush()

        # 2. Ensure Default Organization
        default_org = db.query(Organization).filter(Organization.slug == "default-store").first()
        if not default_org:
            default_org = Organization(
                slug="default-store",
                name="E-Store Main Organization",
                legal_name="E-Store Enterprise",
                contact_email="admin@e-store.local",
                country="LK",
                currency="LKR",
                timezone="Asia/Colombo",
                status="active",
                current_plan_id=default_plan.id,
                trial_ends_at=utcnow() + timedelta(days=3650),
                is_active=True
            )
            db.add(default_org)
            db.flush()

        # 3. Ensure Default Branch
        default_branch = db.query(Branch).filter(
            Branch.organization_id == default_org.id,
            Branch.code == "MAIN-01"
        ).first()
        if not default_branch:
            default_branch = Branch(
                organization_id=default_org.id,
                code="MAIN-01",
                name="Main Headquarters",
                address="Colombo, Sri Lanka",
                is_warehouse=False,
                is_active=True
            )
            db.add(default_branch)
            db.flush()

        # 4. Ensure Active Subscription
        active_sub = db.query(Subscription).filter(Subscription.organization_id == default_org.id).first()
        if not active_sub:
            active_sub = Subscription(
                organization_id=default_org.id,
                plan_id=default_plan.id,
                billing_cycle="yearly",
                status="active",
                current_period_start=utcnow(),
                current_period_end=utcnow() + timedelta(days=365),
                amount=0.0,
                currency="LKR",
                auto_renew=True
            )
            db.add(active_sub)
            db.flush()

        # 5. Backfill any existing users lacking organization_id
        db.query(User).filter(User.organization_id.is_(None)).update(
            {User.organization_id: default_org.id, User.branch_id: default_branch.id},
            synchronize_session=False
        )

        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[saas_service] Error during SaaS bootstrapping: {e}")


# =========================================================================
# ORGANIZATIONS & BRANCHES SERVICE
# =========================================================================

def list_organizations(db: Session, status: Optional[str] = None) -> List[Organization]:
    query = db.query(Organization).filter(Organization.is_active == True)
    if status:
        query = query.filter(Organization.status == status)
    return query.order_by(Organization.created_at.desc()).all()


def get_organization_by_id(db: Session, org_id: int) -> Optional[Organization]:
    return db.query(Organization).filter(Organization.id == org_id).first()


def create_organization(db: Session, data: Dict[str, Any]) -> Organization:
    plan_id = data.get("current_plan_id")
    if not plan_id:
        default_plan = db.query(SaaSPlan).filter(SaaSPlan.is_active == True).first()
        plan_id = default_plan.id if default_plan else None

    org = Organization(
        slug=data["slug"].strip().lower(),
        name=data["name"].strip(),
        legal_name=data.get("legal_name"),
        tax_number=data.get("tax_number"),
        contact_email=data.get("contact_email"),
        contact_phone=data.get("contact_phone"),
        country=data.get("country", "LK"),
        currency=data.get("currency", "LKR"),
        timezone=data.get("timezone", "Asia/Colombo"),
        current_plan_id=plan_id,
        status="active",
        trial_ends_at=utcnow() + timedelta(days=14),
        settings=data.get("settings", {})
    )
    db.add(org)
    db.flush()

    # Create Initial Default Branch for this organization
    branch = Branch(
        organization_id=org.id,
        code="MAIN-01",
        name=f"{org.name} Main Branch",
        address=data.get("address"),
        phone=data.get("contact_phone"),
        email=data.get("contact_email"),
        is_warehouse=False,
        is_active=True
    )
    db.add(branch)

    # Create Initial Subscription
    if plan_id:
        sub = Subscription(
            organization_id=org.id,
            plan_id=plan_id,
            billing_cycle="monthly",
            status="active",
            current_period_start=utcnow(),
            current_period_end=utcnow() + timedelta(days=30),
            amount=0.0,
            currency=org.currency,
            auto_renew=True
        )
        db.add(sub)

    db.commit()
    db.refresh(org)
    return org


def list_branches(db: Session, organization_id: int) -> List[Branch]:
    return db.query(Branch).filter(
        Branch.organization_id == organization_id,
        Branch.is_active == True
    ).order_by(Branch.code.asc()).all()


def check_subscription_limits(db: Session, organization_id: int, resource_type: str) -> Dict[str, Any]:
    """
    Validates if an organization can add more resources according to their SaaS Plan limits.
    resource_type: 'branches', 'devices', 'users', 'products'
    """
    org = db.query(Organization).filter(Organization.id == organization_id).first()
    if not org:
        return {"allowed": False, "error": "Organization not found"}

    plan = org.plan
    if not plan:
        # Fallback to default active plan
        plan = db.query(SaaSPlan).filter(SaaSPlan.is_active == True).first()

    if not plan:
        return {"allowed": True}  # No plan restrictions configured

    if resource_type == "branches":
        count = db.query(Branch).filter(Branch.organization_id == organization_id, Branch.is_active == True).count()
        if count >= plan.max_branches:
            return {
                "allowed": False,
                "error": f"Branch limit reached for plan '{plan.name}' (Max allowed: {plan.max_branches}). Upgrade subscription to add more branches."
            }

    elif resource_type == "devices":
        count = db.query(POSDevice).filter(POSDevice.organization_id == organization_id, POSDevice.is_active == True).count()
        total_allowed = plan.max_branches * plan.max_devices_per_branch
        if count >= total_allowed:
            return {
                "allowed": False,
                "error": f"POS Device license limit reached for plan '{plan.name}' (Max allowed: {total_allowed}). Upgrade subscription to add more devices."
            }

    elif resource_type == "users":
        count = db.query(User).filter(User.organization_id == organization_id, User.is_deleted == False).count()
        if count >= plan.max_users:
            return {
                "allowed": False,
                "error": f"User seat limit reached for plan '{plan.name}' (Max allowed: {plan.max_users}). Upgrade subscription to invite more users."
            }

    return {"allowed": True}


def create_branch(db: Session, organization_id: int, data: Dict[str, Any]) -> Branch:
    limit_check = check_subscription_limits(db, organization_id, "branches")
    if not limit_check.get("allowed"):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail=limit_check.get("error"))

    branch = Branch(
        organization_id=organization_id,
        code=data["code"].strip().upper(),
        name=data["name"].strip(),
        address=data.get("address"),
        phone=data.get("phone"),
        email=data.get("email"),
        is_warehouse=bool(data.get("is_warehouse", False)),
        is_active=True
    )
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return branch


# =========================================================================
# POS DEVICE & LICENSE LIFECYCLE MANAGEMENT
# =========================================================================

def list_devices(db: Session, organization_id: Optional[int] = None) -> List[POSDevice]:
    query = db.query(POSDevice).filter(POSDevice.is_active == True)
    if organization_id:
        query = query.filter(POSDevice.organization_id == organization_id)
    return query.order_by(POSDevice.created_at.desc()).all()


def create_device_license(db: Session, organization_id: int, branch_id: Optional[int], device_code: str, device_name: Optional[str] = None) -> POSDevice:
    limit_check = check_subscription_limits(db, organization_id, "devices")
    if not limit_check.get("allowed"):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail=limit_check.get("error"))

    license_key = generate_license_key()
    device = POSDevice(
        organization_id=organization_id,
        branch_id=branch_id,
        device_code=device_code.strip().upper(),
        device_name=device_name or f"POS Terminal {device_code}",
        license_key=license_key,
        activation_status="pending",
        is_active=True
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


def activate_device_by_license(db: Session, license_key: str, hardware_uuid: str, app_version: str, os_info: Optional[str] = None, ip_address: Optional[str] = None) -> Dict[str, Any]:
    """Activates a POS machine using its license key and locks it to the hardware UUID."""
    device = db.query(POSDevice).filter(POSDevice.license_key == license_key.strip()).first()
    if not device:
        return {"success": False, "error": "Invalid license key"}

    if device.activation_status == "revoked":
        return {"success": False, "error": "This license key has been revoked by platform administrator"}

    if device.activation_status == "suspended":
        return {"success": False, "error": "This device is temporarily suspended"}

    # If already activated on another machine, verify hardware UUID matches
    if device.activation_status == "activated" and device.hardware_uuid and device.hardware_uuid != hardware_uuid:
        return {
            "success": False,
            "error": "License key is already activated on a different hardware terminal. Contact support to transfer license."
        }

    device.hardware_uuid = hardware_uuid
    device.activation_status = "activated"
    device.activated_at = utcnow()
    device.app_version = app_version
    device.os_info = os_info
    device.last_ip_address = ip_address
    device.last_heartbeat_at = utcnow()

    db.commit()
    db.refresh(device)

    org = db.query(Organization).filter(Organization.id == device.organization_id).first()
    branch = db.query(Branch).filter(Branch.id == device.branch_id).first() if device.branch_id else None

    return {
        "success": True,
        "message": "Device successfully activated",
        "device": {
            "id": device.id,
            "uuid": device.uuid,
            "device_code": device.device_code,
            "device_name": device.device_name,
            "organization_id": device.organization_id,
            "organization_name": org.name if org else "Unknown",
            "branch_id": device.branch_id,
            "branch_name": branch.name if branch else "Default Branch",
            "activation_status": device.activation_status,
        }
    }


def record_device_heartbeat(db: Session, device_uuid: str, hardware_uuid: str, app_version: str, offline_queue_count: int = 0, ip_address: Optional[str] = None) -> Dict[str, Any]:
    """Updates device heartbeat, version, and verifies active license state."""
    device = db.query(POSDevice).filter(POSDevice.uuid == device_uuid).first()
    if not device:
        return {"valid": False, "error": "Device not found"}

    if device.activation_status != "activated":
        return {
            "valid": False,
            "status": device.activation_status,
            "error": f"Device is currently in {device.activation_status} status."
        }

    if device.hardware_uuid and device.hardware_uuid != hardware_uuid:
        return {"valid": False, "error": "Hardware fingerprint mismatch"}

    device.last_heartbeat_at = utcnow()
    device.app_version = app_version
    device.offline_queue_count = offline_queue_count
    if ip_address:
        device.last_ip_address = ip_address

    db.commit()
    return {"valid": True, "status": "active", "timestamp": utcnow().isoformat()}


def update_device_status(db: Session, device_id: int, action: str) -> Optional[POSDevice]:
    """Admin action: activate, suspend, revoke, or transfer device."""
    device = db.query(POSDevice).filter(POSDevice.id == device_id).first()
    if not device:
        return None

    if action == "suspend":
        device.activation_status = "suspended"
    elif action == "activate":
        device.activation_status = "activated"
    elif action == "revoke":
        device.activation_status = "revoked"
    elif action == "transfer":
        # Reset hardware lock so key can be re-registered on a new machine
        device.hardware_uuid = None
        device.activation_status = "pending"

    db.commit()
    db.refresh(device)
    return device


# =========================================================================
# SAAS PLATFORM METRICS & DASHBOARD OVERVIEW
# =========================================================================

def get_platform_overview(db: Session) -> Dict[str, Any]:
    total_orgs = db.query(Organization).filter(Organization.is_active == True).count()
    active_orgs = db.query(Organization).filter(Organization.status == "active").count()
    total_branches = db.query(Branch).filter(Branch.is_active == True).count()
    total_devices = db.query(POSDevice).filter(POSDevice.is_active == True).count()
    active_devices = db.query(POSDevice).filter(POSDevice.activation_status == "activated").count()

    # Online devices in last 5 minutes
    five_min_ago = utcnow() - timedelta(minutes=5)
    online_devices = db.query(POSDevice).filter(
        POSDevice.activation_status == "activated",
        POSDevice.last_heartbeat_at >= five_min_ago
    ).count()

    return {
        "total_organizations": total_orgs,
        "active_organizations": active_orgs,
        "total_branches": total_branches,
        "total_devices": total_devices,
        "active_devices": active_devices,
        "online_devices_now": online_devices,
    }
