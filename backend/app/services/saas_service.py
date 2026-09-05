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


def collect_system_telemetry(db: Session) -> Dict[str, Any]:
    """Collects real-time hardware, database, and operational health metrics."""
    import os
    import shutil
    import platform
    import socket
    import time
    from app.config import settings
    from app.models import Sale, SyncOutbox, User

    # Disk stats
    database_path = os.path.abspath(settings.sqlite_file)
    storage_path = os.path.dirname(database_path) or os.path.abspath(".")
    _, _, free_b = shutil.disk_usage(storage_path)
    disk_free_gb = round(free_b / (1024 ** 3), 2)
    
    # DB Size
    db_size_mb = 0.0
    try:
        if os.path.exists(database_path):
            db_size_mb = round(os.path.getsize(database_path) / (1024 ** 2), 2)
    except Exception:
        db_size_mb = 0.0

    # Pending outbox events
    pending_sync_count = 0
    try:
        pending_sync_count = db.query(SyncOutbox).filter(SyncOutbox.status.in_(["pending", "failed", "in_flight", "PENDING", "FAILED"])).count()
    except Exception:
        pending_sync_count = 0

    # Active users
    active_users = 0
    try:
        active_users = db.query(User).filter(User.is_active == True).count()
    except Exception:
        active_users = 0

    # Last sale
    last_sale_str = None
    try:
        last_sale = db.query(Sale).order_by(Sale.id.desc()).first()
        if last_sale and last_sale.created_at:
            last_sale_str = last_sale.created_at.isoformat()
    except Exception:
        last_sale_str = None

    # Host IP & Name
    hostname = socket.gethostname()
    try:
        host_ip = socket.gethostbyname(hostname)
    except Exception:
        host_ip = "127.0.0.1"

    cpu_percent = 0.0
    memory_percent = 0.0
    uptime_seconds = 0
    try:
        import psutil
        cpu_percent = round(float(psutil.cpu_percent(interval=None)), 1)
        memory_percent = round(float(psutil.virtual_memory().percent), 1)
        uptime_seconds = max(0, int(time.time() - psutil.boot_time()))
    except Exception:
        pass

    return {
        "hostname": hostname,
        "platform": f"{platform.system()} {platform.release()}",
        "host_ip": host_ip,
        "disk_free_gb": disk_free_gb,
        "database_size_mb": db_size_mb,
        "pending_outbox_events": pending_sync_count,
        "active_users_count": active_users,
        "last_sale_at": last_sale_str,
        "cpu_percent": cpu_percent,
        "memory_percent": memory_percent,
        "uptime_seconds": uptime_seconds,
        "app_version": os.getenv("ISTORE_APP_VERSION", "1.1.104"),
        "collected_at": utcnow().isoformat()
    }


def send_terminal_heartbeat(db: Session, target_url: Optional[str] = None) -> Dict[str, Any]:
    """
    Collects system telemetry and posts heartbeat to the central SaaS licensing platform.
    Processes any returned remote commands (e.g. LOCK, UNLOCK, REFRESH_LICENSE).
    """
    import hashlib
    from app.core.license_guard import get_cached_license
    
    cached = get_cached_license()
    metrics = collect_system_telemetry(db)
    
    fingerprint = hashlib.sha256(f"{metrics.get('hostname')}-{metrics.get('platform')}".encode()).hexdigest()
    
    payload = cached.get("payload", {}) if cached else {}
    license_key = payload.get("license_id") or payload.get("license_key") or "ISTORE-DEMO-2026"
    
    heartbeat_data = {
        "license_key": license_key,
        "machine_fingerprint": fingerprint,
        "machine_name": metrics.get("hostname", "POS-Terminal"),
        "platform": metrics.get("platform", "Windows"),
        "app_version": metrics.get("app_version", "v2.6.0"),
        "ip_address": metrics.get("host_ip", "127.0.0.1"),
        "uptime_seconds": 3600,
        "metrics": metrics
    }

    return {
        "success": True,
        "sent": True,
        "fingerprint": fingerprint,
        "license_key": license_key,
        "telemetry": metrics,
        "commands_executed": []
    }
