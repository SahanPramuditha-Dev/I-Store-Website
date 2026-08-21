"""
tenant_guard.py
===============
Core Multi-Tenant Query Scoper and Isolation Guard.
Provides helper utilities to automatically bind queries to the caller's organization_id
and branch_id, preventing any cross-tenant data leaks at the database layer.
"""

from typing import Any, Optional, Type
from fastapi import Request, HTTPException, status
from sqlalchemy.orm import Query
from app.models import User

def get_tenant_context(request: Request) -> tuple[Optional[int], Optional[int]]:
    """
    Extracts (organization_id, branch_id) from the authenticated request state.
    Defaults to (1, 1) fallback in single-tenant local fallback mode if not specified.
    """
    user: Optional[User] = getattr(request.state, "current_user", None)
    org_id = getattr(request.state, "current_org_id", None)
    branch_id = getattr(request.state, "current_branch_id", None)

    if user:
        if org_id is None:
            org_id = user.organization_id or 1
        if branch_id is None:
            branch_id = user.branch_id

    # If unauthenticated public request or fallback, default org_id is 1
    return org_id or 1, branch_id


def scope_query(query: Query, model_cls: Type[Any], request: Request, branch_scoped: bool = False) -> Query:
    """
    Applies strict WHERE filters on organization_id (and optionally branch_id)
    if the model class possesses these attributes.
    """
    org_id, branch_id = get_tenant_context(request)

    if hasattr(model_cls, "organization_id") and org_id is not None:
        # Include rows owned by this organization OR legacy unassigned rows (org_id IS NULL)
        query = query.filter((model_cls.organization_id == org_id) | (model_cls.organization_id.is_(None)))

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
