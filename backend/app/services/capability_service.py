"""
capability_service.py
=====================
Central capability resolver & enforcement engine for E-Store ERP.

Hierarchy:
Effective Capability = Subscription Entitlement AND (Organization Override OR Industry Default)

Enforces:
- Backend capability checks via require_capability()
- Organization level capability bootstrapping
"""

from typing import Dict, Any, Optional
from fastapi import HTTPException, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import get_current_user
from app.models import Organization, SaaSPlan, User

# Built-in Default Industry Templates
DEFAULT_INDUSTRY_CAPABILITIES = {
    "MOBILE_RETAIL": {
        "imei_tracking": True,
        "serial_tracking": True,
        "repairs_management": True,
        "warranty_management": True,
        "warranty_claims": True,
        "trade_ins": True,
        "batch_tracking": False,
        "expiry_tracking": False,
        "weighted_products": False,
        "decimal_quantities": False,
        "variants_matrix": True,
        "size_color_variants": False,
        "season_management": False,
        "unit_conversions": False
    },
    "GROCERY": {
        "imei_tracking": False,
        "serial_tracking": False,
        "repairs_management": False,
        "warranty_management": False,
        "warranty_claims": False,
        "trade_ins": False,
        "batch_tracking": True,
        "expiry_tracking": True,
        "weighted_products": True,
        "decimal_quantities": True,
        "variants_matrix": False,
        "size_color_variants": False,
        "season_management": False,
        "unit_conversions": True
    },
    "FASHION": {
        "imei_tracking": False,
        "serial_tracking": False,
        "repairs_management": False,
        "warranty_management": False,
        "warranty_claims": False,
        "trade_ins": False,
        "batch_tracking": False,
        "expiry_tracking": False,
        "weighted_products": False,
        "decimal_quantities": False,
        "variants_matrix": True,
        "size_color_variants": True,
        "season_management": True,
        "unit_conversions": False
    },
    "ELECTRONICS": {
        "imei_tracking": False,
        "serial_tracking": True,
        "repairs_management": True,
        "warranty_management": True,
        "warranty_claims": True,
        "trade_ins": True,
        "batch_tracking": False,
        "expiry_tracking": False,
        "weighted_products": False,
        "decimal_quantities": False,
        "variants_matrix": True,
        "size_color_variants": False,
        "season_management": False,
        "unit_conversions": False
    },
    "COSMETICS": {
        "imei_tracking": False,
        "serial_tracking": False,
        "repairs_management": False,
        "warranty_management": False,
        "warranty_claims": False,
        "trade_ins": False,
        "batch_tracking": True,
        "expiry_tracking": True,
        "weighted_products": False,
        "decimal_quantities": False,
        "variants_matrix": True,
        "size_color_variants": False,
        "season_management": False,
        "unit_conversions": False
    },
    "GENERAL_RETAIL": {
        "imei_tracking": False,
        "serial_tracking": False,
        "repairs_management": False,
        "warranty_management": True,
        "warranty_claims": False,
        "trade_ins": False,
        "batch_tracking": False,
        "expiry_tracking": False,
        "weighted_products": False,
        "decimal_quantities": False,
        "variants_matrix": True,
        "size_color_variants": False,
        "season_management": False,
        "unit_conversions": False
    }
}


def get_effective_capabilities(db: Session, organization_id: Optional[int] = None) -> Dict[str, Any]:
    """
    Computes effective capabilities for a given organization.
    Prioritizes cryptographically signed Ed25519 license tokens if installed.
    Falls back to organization database record & industry defaults.
    """
    # 1. Check local cryptographic license
    try:
        from app.core.license_guard import get_cached_license, verify_license_token
        cached = get_cached_license()
        if cached:
            is_valid, msg, payload = verify_license_token(cached)
            if is_valid and payload:
                ind = payload.get("industry_code") or "MOBILE_RETAIL"
                signed_caps = payload.get("capabilities", [])
                defaults = DEFAULT_INDUSTRY_CAPABILITIES.get(ind, DEFAULT_INDUSTRY_CAPABILITIES["MOBILE_RETAIL"])
                
                eff_caps = {}
                for key in defaults.keys():
                    if "all" in signed_caps:
                        eff_caps[key] = True
                    else:
                        eff_caps[key] = (key in signed_caps)

                return {
                    "source": "CENTRAL_ED25519_LICENSE",
                    "organization_id": organization_id,
                    "tenant_code": payload.get("tenant_code"),
                    "industry_type": ind,
                    "configuration_version": payload.get("configuration_version", 1),
                    "capabilities": eff_caps
                }
    except Exception as ex:
        # Fallback to DB resolution if license module uninitialized
        pass

    if not organization_id:
        # Fallback to default mobile shop capabilities
        return {
            "source": "DEFAULT_FALLBACK",
            "industry_type": "MOBILE_RETAIL",
            "configuration_version": 1,
            "capabilities": DEFAULT_INDUSTRY_CAPABILITIES["MOBILE_RETAIL"]
        }

    org = db.query(Organization).filter(Organization.id == organization_id).first()
    if not org:
        return {
            "source": "DEFAULT_FALLBACK",
            "industry_type": "MOBILE_RETAIL",
            "configuration_version": 1,
            "capabilities": DEFAULT_INDUSTRY_CAPABILITIES["MOBILE_RETAIL"]
        }

    industry = getattr(org, "industry_type", None) or "MOBILE_RETAIL"
    defaults = DEFAULT_INDUSTRY_CAPABILITIES.get(industry, DEFAULT_INDUSTRY_CAPABILITIES["MOBILE_RETAIL"])
    overrides = getattr(org, "capabilities_override", None) or {}

    # Plan entitlement
    plan = org.plan if org.current_plan_id else None
    plan_features = plan.features_config if plan and plan.features_config else {}

    effective_caps = {}
    for key, default_val in defaults.items():
        val = overrides.get(key, default_val)
        
        # Plan-level veto (Plan is the upper ceiling)
        if key == "repairs_management" and "repairs" in plan_features and not plan_features["repairs"]:
            val = False
        elif key == "warranty_management" and "warranty" in plan_features and not plan_features["warranty"]:
            val = False

        effective_caps[key] = bool(val)

    return {
        "source": "DATABASE_CONFIG",
        "organization_id": org.id,
        "organization_name": org.name,
        "industry_type": industry,
        "configuration_version": getattr(org, "configuration_version", 1) or 1,
        "capabilities": effective_caps
    }


def has_capability(db: Session, organization_id: Optional[int], capability_key: str) -> bool:
    """Checks if an organization has a specific capability enabled."""
    res = get_effective_capabilities(db, organization_id)
    return res["capabilities"].get(capability_key, False)


def require_capability(capability_key: str):
    """
    FastAPI dependency to protect endpoints requiring a specific industry capability.
    Example: Depends(require_capability("repairs_management"))
    """
    def _dependency(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
    ):
        org_id = current_user.organization_id
        if not has_capability(db, org_id, capability_key):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Feature '{capability_key}' is not enabled for your organization/industry configuration."
            )
        return True
    return _dependency
