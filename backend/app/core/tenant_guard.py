"""
tenant_guard.py
===============
Core Multi-Tenant Query Scoper and Isolation Guard.
Provides helper utilities to automatically bind queries to the caller's organization_id
and branch_id, preventing any cross-tenant data leaks at the database layer.
"""

from typing import Any, Optional, Type
from fastapi import Request, HTTPException, status
from sqlalchemy.orm import Query, Session
from app.models import User, Organization, Branch

def get_tenant_context(request: Request) -> tuple[Optional[int], Optional[int]]:
    """
    Extracts (organization_id, branch_id) from the authenticated request state,
    headers, or active token. Defaults to (1, 1) fallback in single-tenant mode.
    """
    user: Optional[User] = getattr(request.state, "current_user", None)
    org_id = getattr(request.state, "current_org_id", None)
    branch_id = getattr(request.state, "current_branch_id", None)

    if user:
        if org_id is None:
            org_id = user.organization_id or 1
        if branch_id is None:
            branch_id = user.branch_id

    # Fallback to headers if present (e.g. service-to-service calls or API clients)
    if org_id is None and request.headers.get("X-Organization-Id"):
        try:
            org_id = int(request.headers.get("X-Organization-Id", "1"))
        except (ValueError, TypeError):
            pass

    return org_id or 1, branch_id


def resolve_tenant_id_from_code(db: Session, tenant_code: str) -> Optional[int]:
    """
    Resolves an external tenant_code (e.g. 'TEN-ALPHA-01' or 'i-point') to local Organization.id.
    """
    if not tenant_code:
        return 1
    clean_code = str(tenant_code).strip().lower()
    org = db.query(Organization).filter(
        (Organization.slug == clean_code) |
        (Organization.uuid == tenant_code)
    ).first()
    if org:
        return org.id
    try:
        org_by_id = db.query(Organization).filter(Organization.id == int(clean_code)).first()
        if org_by_id:
            return org_by_id.id
    except (ValueError, TypeError):
        pass
    return None


def resolve_store_id(db: Session, organization_id: Optional[int], branch_id: Optional[int] = None) -> str:
    """
    Resolves the canonical public store_id string (e.g. 'default', 'i-point') for Supabase sync.
    """
    if not organization_id or organization_id == 1:
        return "default"
    org = db.query(Organization).filter(Organization.id == organization_id).first()
    if org and org.slug:
        return str(org.slug).strip().lower().replace(" ", "-")
    return "default"


def scope_query(query: Query, model_cls: Type[Any], request: Request, branch_scoped: bool = False) -> Query:
    """
    Applies strict WHERE filters on organization_id (and optionally branch_id)
    to guarantee tenant isolation.
    """
    org_id, branch_id = get_tenant_context(request)

    if hasattr(model_cls, "organization_id") and org_id is not None:
        if org_id == 1:
            # Default / Root organization allows legacy unassigned rows
            query = query.filter((model_cls.organization_id == 1) | (model_cls.organization_id.is_(None)))
        else:
            # Multi-tenant organization: strictly isolated
            query = query.filter(model_cls.organization_id == org_id)

    if branch_scoped and hasattr(model_cls, "branch_id") and branch_id is not None:
        query = query.filter((model_cls.branch_id == branch_id) | (model_cls.branch_id.is_(None)))

    return query


def stamp_tenant(entity: Any, request: Request):
    """
    Stamps the organization_id and branch_id onto a newly created model entity before save.
    """
    org_id, branch_id = get_tenant_context(request)

    if hasattr(entity, "organization_id") and getattr(entity, "organization_id", None) is None:
        setattr(entity, "organization_id", org_id)

    if hasattr(entity, "branch_id") and getattr(entity, "branch_id", None) is None:
        if branch_id is not None:
            setattr(entity, "branch_id", branch_id)

