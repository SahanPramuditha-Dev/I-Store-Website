import json
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_permission
from app.database import get_db
from app.models import Permission, PermissionChangeLog, Role, RolePermission, User, UserPermissionOverride
from app.services.security_service import (
    SENSITIVE_PERMISSION_KEYS,
    clear_user_permission_override_by_id,
    copy_role_permissions,
    count_active_owner_users,
    enforce_owner_user_change_guard,
    enforce_role_locked_guard,
    get_active_sessions,
    get_effective_permission_codes,
    get_request_device_info,
    get_request_ip,
    get_role_permissions_payload,
    get_user_permission_override_payload,
    has_permission,
    list_permissions,
    list_roles,
    log_access_control_audit,
    log_permission_change,
    normalize_role_for_legacy,
    reset_role_permissions_to_default,
    revoke_all_user_sessions,
    revoke_session,
    role_permission_state,
    set_role_permissions,
    set_role_permissions_bulk,
    set_user_permission_override,
    simulate_access_from_codes,
    utcnow,
)

router = APIRouter(prefix="/access", tags=["access-control"])


def _session_id(request: Request) -> str | None:
    session = getattr(request.state, "auth_session", None)
    return getattr(session, "session_code", None) if session else None


def _require_change_reason(reason: str | None) -> str:
    text = str(reason or "").strip()
    if len(text) < 3:
        raise HTTPException(status_code=400, detail="Change reason is required (min 3 chars)")
    return text


def _serialize_role(db: Session, role: Role) -> dict[str, Any]:
    user_count = (
        db.query(User)
        .filter(User.role_id == role.id, User.is_deleted == False)  # noqa: E712
        .count()
    )
    enabled_permissions = (
        db.query(RolePermission)
        .filter(RolePermission.role_id == role.id, RolePermission.allowed == True)  # noqa: E712
        .count()
    )
    return {
        "id": role.id,
        "name": role.name,
        "display_name": role.display_name,
        "description": role.description,
        "is_system_role": bool(role.is_system_role if role.is_system_role is not None else role.is_system),
        "is_locked": bool(role.is_locked if role.is_locked is not None else role.is_protected),
        "is_active": bool(role.is_active),
        "created_at": role.created_at.isoformat() if role.created_at else None,
        "updated_at": role.updated_at.isoformat() if role.updated_at else None,
        "created_by": role.created_by,
        "user_count": user_count,
        "permission_count": enabled_permissions,
    }


@router.get("/roles", dependencies=[Depends(require_permission("access.view"))])
def access_list_roles(db: Session = Depends(get_db), _=Depends(get_current_user)):
    rows = list_roles(db)
    if any(str(row.name) == "viewer" for row in rows):
        rows = [row for row in rows if str(row.name) != "view_only"]
    return [_serialize_role(db, row) for row in rows]


@router.post("/roles", dependencies=[Depends(require_permission("access.manage_roles"))])
def access_create_role(payload: dict, request: Request, db: Session = Depends(get_db), current=Depends(get_current_user)):
    display_name = str(payload.get("display_name") or payload.get("name") or "").strip()
    role_name = str(payload.get("name") or "").strip().lower().replace(" ", "_")
    description = str(payload.get("description") or "").strip() or None
    if not role_name or not display_name:
        raise HTTPException(status_code=400, detail="name and display_name are required")
    if db.query(Role).filter(Role.name == role_name).first():
        raise HTTPException(status_code=400, detail="Role name already exists")

    role = Role(
        name=role_name,
        display_name=display_name,
        description=description,
        level=int(payload.get("level") or 1),
        is_system=False,
        is_system_role=False,
        is_protected=False,
        is_locked=False,
        is_active=True,
        created_by=getattr(current, "id", None),
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    log_access_control_audit(
        db,
        user_id=getattr(current, "id", None),
        action="role_created",
        target_type="role",
        target_id=role.id,
        old_value=None,
        new_value={"name": role.name, "display_name": role.display_name},
        session_id=_session_id(request),
        ip_address=get_request_ip(request),
        device_name=get_request_device_info(request),
    )
    db.commit()
    return _serialize_role(db, role)


@router.get("/roles/{id}", dependencies=[Depends(require_permission("access.view"))])
def access_get_role(id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    role = db.query(Role).filter(Role.id == int(id)).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    return _serialize_role(db, role)


@router.patch("/roles/{id}", dependencies=[Depends(require_permission("access.manage_roles"))])
def access_update_role(id: int, payload: dict, request: Request, db: Session = Depends(get_db), current=Depends(get_current_user)):
    role = db.query(Role).filter(Role.id == int(id)).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.name == "owner" or bool(role.is_locked) or bool(role.is_protected):
        raise HTTPException(status_code=400, detail="Locked role cannot be modified")

    old_value = _serialize_role(db, role)
    if "display_name" in payload:
        role.display_name = str(payload.get("display_name") or role.display_name).strip() or role.display_name
    if "description" in payload:
        role.description = str(payload.get("description") or "").strip() or None
    if "is_active" in payload:
        role.is_active = bool(payload.get("is_active"))
    if "level" in payload:
        role.level = int(payload.get("level") or role.level)
    role.updated_at = utcnow()
    db.commit()
    db.refresh(role)

    log_access_control_audit(
        db,
        user_id=getattr(current, "id", None),
        action="role_edited",
        target_type="role",
        target_id=role.id,
        old_value=old_value,
        new_value=_serialize_role(db, role),
        session_id=_session_id(request),
        ip_address=get_request_ip(request),
        device_name=get_request_device_info(request),
    )
    db.commit()
    return _serialize_role(db, role)


@router.delete("/roles/{id}", dependencies=[Depends(require_permission("access.manage_roles"))])
def access_delete_role(id: int, request: Request, db: Session = Depends(get_db), current=Depends(get_current_user)):
    role = db.query(Role).filter(Role.id == int(id)).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.name == "owner" or bool(role.is_locked) or bool(role.is_protected):
        raise HTTPException(status_code=400, detail="Locked role cannot be deleted")
    if bool(role.is_system_role if role.is_system_role is not None else role.is_system):
        raise HTTPException(status_code=400, detail="System role cannot be deleted")
    assigned = db.query(User).filter(User.role_id == role.id, User.is_deleted == False).count()  # noqa: E712
    if assigned > 0:
        raise HTTPException(status_code=400, detail="Role is assigned to users and cannot be deleted")
    old_value = _serialize_role(db, role)
    db.query(RolePermission).filter(RolePermission.role_id == role.id).delete()
    db.delete(role)
    db.commit()
    log_access_control_audit(
        db,
        user_id=getattr(current, "id", None),
        action="role_deleted",
        target_type="role",
        target_id=id,
        old_value=old_value,
        new_value=None,
        session_id=_session_id(request),
        ip_address=get_request_ip(request),
        device_name=get_request_device_info(request),
    )
    db.commit()
    return {"ok": True}


@router.get("/permissions", dependencies=[Depends(require_permission("access.view"))])
def access_list_permissions(module: str | None = Query(default=None), db: Session = Depends(get_db), _=Depends(get_current_user)):
    rows = list_permissions(db)
    if module and str(module).strip().lower() != "all":
        rows = [row for row in rows if str(row.module) == str(module).strip().lower()]
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    payload = []
    for row in rows:
        item = {
            "id": row.id,
            "permission_key": row.permission_key or row.code,
            "module": row.module,
            "action": row.action,
            "description": row.description,
            "is_sensitive": bool(row.is_sensitive),
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        payload.append(item)
        grouped[row.module].append(item)
    return {"permissions": payload, "grouped_modules": grouped}


@router.get("/roles/{id}/permissions", dependencies=[Depends(require_permission("access.view"))])
def access_get_role_permissions(id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    return get_role_permissions_payload(db, int(id))


def _apply_role_permission_changes(
    db: Session,
    *,
    role: Role,
    changes: list[dict[str, Any]],
    reason: str,
    actor_id: int | None,
    session_id: str | None,
    ip_address: str | None,
    device_name: str | None,
) -> tuple[int, int]:
    perm_map = {int(p.id): p for p in list_permissions(db)}
    old_state = role_permission_state(db, role.id)
    changed = 0
    revoked = 0
    for row in changes:
        permission_id = int(row["permission_id"])
        allowed = bool(row["allowed"])
        perm = perm_map.get(permission_id)
        if not perm:
            raise HTTPException(status_code=404, detail=f"Permission not found: {permission_id}")
        before = bool(old_state.get(permission_id, False))
        if before == allowed:
            continue
        set_role_permissions(db, role.id, [permission_id], allowed=allowed)
        if before and not allowed:
            revoked += 1
        changed += 1
        log_permission_change(
            db,
            changed_by=actor_id,
            target_type="role",
            target_id=role.id,
            permission_id=permission_id,
            old_value={"allowed": before},
            new_value={"allowed": allowed},
            reason=reason,
            session_id=session_id,
            ip_address=ip_address,
            device_name=device_name,
        )
    return changed, revoked


@router.put("/roles/{id}/permissions", dependencies=[Depends(require_permission("access.manage_permissions"))])
def access_set_role_permissions(
    id: int,
    payload: dict,
    request: Request,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    role = db.query(Role).filter(Role.id == int(id)).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    enforce_role_locked_guard(role, "modified")

    changes = payload.get("changes") or []
    if not changes:
        permission_ids = payload.get("permission_ids") or []
        allowed = bool(payload.get("allowed", True))
        if isinstance(permission_ids, list):
            changes = [{"permission_id": int(pid), "allowed": allowed} for pid in permission_ids]
    if not isinstance(changes, list) or not changes:
        raise HTTPException(status_code=400, detail="changes are required")

    reason = _require_change_reason(payload.get("reason"))
    perm_map = {int(p.id): p for p in list_permissions(db)}
    old_state = role_permission_state(db, role.id)
    sensitive_changed = []
    self_access_removed = False
    for row in changes:
        permission_id = int(row.get("permission_id") or 0)
        if permission_id <= 0:
            continue
        allowed = bool(row.get("allowed"))
        before = bool(old_state.get(permission_id, False))
        if before == allowed:
            continue
        perm = perm_map.get(permission_id)
        if perm and (perm.permission_key or perm.code) in SENSITIVE_PERMISSION_KEYS:
            sensitive_changed.append(perm.permission_key or perm.code)
        if (
            perm
            and (perm.permission_key or perm.code) == "access.manage_permissions"
            and before
            and (not allowed)
            and int(getattr(current, "role_id", 0) or 0) == int(role.id)
        ):
            self_access_removed = True
    if sensitive_changed and not bool(payload.get("confirm_sensitive", False)):
        raise HTTPException(
            status_code=400,
            detail=f"Sensitive permission changes require confirm_sensitive=true ({', '.join(sorted(set(sensitive_changed)))})",
        )
    if self_access_removed:
        owner_confirm_id = int(payload.get("owner_confirmation_user_id") or 0)
        if owner_confirm_id <= 0:
            raise HTTPException(
                status_code=400,
                detail="Self lockout protection: owner_confirmation_user_id is required to remove your own access.manage_permissions",
            )
        owner_user = db.query(User).filter(User.id == owner_confirm_id, User.is_deleted == False, User.is_active == True).first()  # noqa: E712
        if not owner_user:
            raise HTTPException(status_code=400, detail="Owner confirmation user not found")
        owner_role = db.query(Role).filter(Role.id == owner_user.role_id).first() if owner_user.role_id else None
        if not owner_role or owner_role.name != "owner" or int(owner_user.id) == int(getattr(current, "id", 0)):
            raise HTTPException(status_code=400, detail="Owner confirmation must come from another active Owner")

    changed, revoked = _apply_role_permission_changes(
        db,
        role=role,
        changes=changes,
        reason=reason,
        actor_id=getattr(current, "id", None),
        session_id=_session_id(request),
        ip_address=get_request_ip(request),
        device_name=get_request_device_info(request),
    )
    if changed == 0:
        return {"ok": True, "changed": 0, "revoked_sessions": 0}

    affected_users = (
        db.query(User)
        .filter(User.role_id == role.id, User.is_deleted == False, User.is_active == True)  # noqa: E712
        .all()
    )
    revoked_sessions = 0
    if revoked > 0:
        for user in affected_users:
            revoked_sessions += revoke_all_user_sessions(
                db,
                user_id=int(user.id),
                revoked_by_user_id=getattr(current, "id", None),
                reason=f"Permissions downgraded for role {role.display_name or role.name}",
            )
    log_access_control_audit(
        db,
        user_id=getattr(current, "id", None),
        action="permission_changed",
        target_type="role",
        target_id=role.id,
        old_value=None,
        new_value={"changed": changed, "sensitive_changed": sensitive_changed},
        session_id=_session_id(request),
        ip_address=get_request_ip(request),
        device_name=get_request_device_info(request),
    )
    db.commit()
    return {"ok": True, "changed": changed, "revoked_sessions": revoked_sessions, "sensitive_changed": sorted(set(sensitive_changed))}


@router.post("/roles/{id}/grant-all", dependencies=[Depends(require_permission("access.manage_permissions"))])
def access_role_grant_all(
    id: int,
    payload: dict | None,
    request: Request,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    role = db.query(Role).filter(Role.id == int(id)).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    enforce_role_locked_guard(role, "modified")
    reason = _require_change_reason((payload or {}).get("reason"))
    set_role_permissions_bulk(db, role.id, True)
    log_access_control_audit(
        db,
        user_id=getattr(current, "id", None),
        action="permission_granted_all",
        target_type="role",
        target_id=role.id,
        new_value={"grant_all": True},
        old_value=None,
        session_id=_session_id(request),
        ip_address=get_request_ip(request),
        device_name=get_request_device_info(request),
    )
    log_permission_change(
        db,
        changed_by=getattr(current, "id", None),
        target_type="role",
        target_id=role.id,
        permission_id=None,
        old_value=None,
        new_value={"grant_all": True},
        reason=reason,
        session_id=_session_id(request),
    )
    db.commit()
    return {"ok": True}


@router.post("/roles/{id}/revoke-all", dependencies=[Depends(require_permission("access.manage_permissions"))])
def access_role_revoke_all(
    id: int,
    payload: dict | None,
    request: Request,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    role = db.query(Role).filter(Role.id == int(id)).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    enforce_role_locked_guard(role, "modified")
    reason = _require_change_reason((payload or {}).get("reason"))
    set_role_permissions_bulk(db, role.id, False)

    affected_users = (
        db.query(User)
        .filter(User.role_id == role.id, User.is_deleted == False, User.is_active == True)  # noqa: E712
        .all()
    )
    terminated = 0
    for user in affected_users:
        terminated += revoke_all_user_sessions(
            db,
            user_id=int(user.id),
            revoked_by_user_id=getattr(current, "id", None),
            reason=f"Permissions revoked for role {role.display_name or role.name}",
        )
    log_access_control_audit(
        db,
        user_id=getattr(current, "id", None),
        action="permission_revoked_all",
        target_type="role",
        target_id=role.id,
        old_value=None,
        new_value={"revoke_all": True, "revoked_sessions": terminated},
        session_id=_session_id(request),
        ip_address=get_request_ip(request),
        device_name=get_request_device_info(request),
    )
    log_permission_change(
        db,
        changed_by=getattr(current, "id", None),
        target_type="role",
        target_id=role.id,
        permission_id=None,
        old_value=None,
        new_value={"revoke_all": True},
        reason=reason,
        session_id=_session_id(request),
    )
    db.commit()
    return {"ok": True, "revoked_sessions": terminated}


@router.post("/roles/{id}/reset-defaults", dependencies=[Depends(require_permission("access.manage_permissions"))])
def access_role_reset_defaults(
    id: int,
    payload: dict | None,
    request: Request,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    role = db.query(Role).filter(Role.id == int(id)).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    enforce_role_locked_guard(role, "reset")
    reason = _require_change_reason((payload or {}).get("reason"))
    reset_role_permissions_to_default(db, role.id)
    log_access_control_audit(
        db,
        user_id=getattr(current, "id", None),
        action="permission_reset_defaults",
        target_type="role",
        target_id=role.id,
        old_value=None,
        new_value={"reset_defaults": True},
        session_id=_session_id(request),
        ip_address=get_request_ip(request),
        device_name=get_request_device_info(request),
    )
    log_permission_change(
        db,
        changed_by=getattr(current, "id", None),
        target_type="role",
        target_id=role.id,
        permission_id=None,
        old_value=None,
        new_value={"reset_defaults": True},
        reason=reason,
        session_id=_session_id(request),
    )
    db.commit()
    return {"ok": True}


@router.post("/roles/{id}/copy-from/{source_role_id}", dependencies=[Depends(require_permission("access.manage_permissions"))])
def access_role_copy_from(
    id: int,
    source_role_id: int,
    payload: dict | None,
    request: Request,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    role = db.query(Role).filter(Role.id == int(id)).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    enforce_role_locked_guard(role, "modified")
    reason = _require_change_reason((payload or {}).get("reason"))
    changed = copy_role_permissions(db, role_id=id, source_role_id=source_role_id)
    log_access_control_audit(
        db,
        user_id=getattr(current, "id", None),
        action="permission_copied",
        target_type="role",
        target_id=role.id,
        old_value=None,
        new_value={"source_role_id": source_role_id, "changed": changed},
        session_id=_session_id(request),
        ip_address=get_request_ip(request),
        device_name=get_request_device_info(request),
    )
    log_permission_change(
        db,
        changed_by=getattr(current, "id", None),
        target_type="role",
        target_id=role.id,
        permission_id=None,
        old_value=None,
        new_value={"copied_from": source_role_id, "changed": changed},
        reason=reason,
        session_id=_session_id(request),
    )
    db.commit()
    return {"ok": True, "changed": changed}


@router.get("/users/{user_id}/effective-permissions", dependencies=[Depends(require_permission("access.view"))])
def access_user_effective_permissions(user_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"user_id": user.id, "permissions": sorted(list(get_effective_permission_codes(db, user)))}


@router.get("/users/{user_id}/overrides", dependencies=[Depends(require_permission("access.view"))])
def access_user_overrides(user_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    return get_user_permission_override_payload(db, int(user_id))


@router.put("/users/{user_id}/overrides", dependencies=[Depends(require_permission("access.manage_permissions"))])
def access_set_user_overrides(
    user_id: int,
    payload: dict,
    request: Request,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    rows = payload.get("overrides") or []
    if not rows:
        rows = [payload]
    if not isinstance(rows, list):
        raise HTTPException(status_code=400, detail="overrides must be an array")

    changed = 0
    for row in rows:
        permission_id = int((row or {}).get("permission_id") or 0)
        if permission_id <= 0:
            continue
        effect = str((row or {}).get("override_type") or (row or {}).get("effect") or "").strip().lower()
        reason = _require_change_reason((row or {}).get("reason"))
        perm = db.query(Permission).filter(Permission.id == permission_id).first()
        if not perm:
            raise HTTPException(status_code=404, detail=f"Permission not found: {permission_id}")
        if (
            int(user.id) == int(getattr(current, "id", 0))
            and (perm.permission_key or perm.code) == "access.manage_permissions"
            and effect == "deny"
        ):
            raise HTTPException(
                status_code=400,
                detail="Self lockout protection: cannot deny your own access.manage_permissions override",
            )
        if (perm.permission_key or perm.code) in SENSITIVE_PERMISSION_KEYS and len(reason) < 3:
            raise HTTPException(status_code=400, detail=f"Reason is required for sensitive permission {(perm.permission_key or perm.code)}")
        before_rows = get_user_permission_override_payload(db, user.id).get("overrides") or []
        before = next((x for x in before_rows if int(x.get("permission_id") or 0) == permission_id), None)
        saved = set_user_permission_override(
            db,
            user_id=user.id,
            permission_id=permission_id,
            effect=effect,
            actor_user_id=getattr(current, "id", None),
            reason=reason,
        )
        log_permission_change(
            db,
            changed_by=getattr(current, "id", None),
            target_type="user",
            target_id=user.id,
            permission_id=permission_id,
            old_value=before,
            new_value={"override_id": saved.id, "override_type": saved.override_type or saved.effect},
            reason=reason,
            session_id=_session_id(request),
            ip_address=get_request_ip(request),
            device_name=get_request_device_info(request),
        )
        changed += 1
    if changed > 0:
        revoke_all_user_sessions(
            db,
            user_id=user.id,
            revoked_by_user_id=getattr(current, "id", None),
            reason="Permission overrides changed",
        )
    log_access_control_audit(
        db,
        user_id=getattr(current, "id", None),
        action="user_override_added",
        target_type="user",
        target_id=user.id,
        old_value=None,
        new_value={"changed": changed},
        session_id=_session_id(request),
        ip_address=get_request_ip(request),
        device_name=get_request_device_info(request),
    )
    db.commit()
    return {"ok": True, "changed": changed}


@router.delete("/users/{user_id}/overrides/{override_id}", dependencies=[Depends(require_permission("access.manage_permissions"))])
def access_delete_user_override(
    user_id: int,
    override_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    row = clear_user_permission_override_by_id(db, int(user_id), int(override_id))
    if not row:
        raise HTTPException(status_code=404, detail="Override not found")
    revoke_all_user_sessions(
        db,
        user_id=int(user_id),
        revoked_by_user_id=getattr(current, "id", None),
        reason="Permission override removed",
    )
    log_permission_change(
        db,
        changed_by=getattr(current, "id", None),
        target_type="user",
        target_id=int(user_id),
        permission_id=int(row.permission_id),
        old_value={"override_id": row.id, "override_type": row.override_type or row.effect},
        new_value=None,
        reason="Override removed",
        session_id=_session_id(request),
        ip_address=get_request_ip(request),
        device_name=get_request_device_info(request),
    )
    log_access_control_audit(
        db,
        user_id=getattr(current, "id", None),
        action="user_override_removed",
        target_type="user",
        target_id=int(user_id),
        old_value={"override_id": row.id, "permission_id": row.permission_id},
        new_value=None,
        session_id=_session_id(request),
        ip_address=get_request_ip(request),
        device_name=get_request_device_info(request),
    )
    db.commit()
    return {"ok": True}


@router.get("/simulate/role/{role_id}", dependencies=[Depends(require_permission("access.view"))])
def access_simulate_role(role_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    role = db.query(Role).filter(Role.id == int(role_id)).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.name == "owner":
        codes = {str((p.permission_key or p.code)) for p in list_permissions(db)}
    else:
        rows = (
            db.query(RolePermission, Permission)
            .join(Permission, Permission.id == RolePermission.permission_id)
            .filter(RolePermission.role_id == role.id, RolePermission.allowed == True)  # noqa: E712
            .all()
        )
        codes = {str((perm.permission_key or perm.code)) for _, perm in rows}
    return {"role_id": role.id, "role_name": role.name, **simulate_access_from_codes(codes)}


@router.get("/simulate/user/{user_id}", dependencies=[Depends(require_permission("access.view"))])
def access_simulate_user(user_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    codes = {str(code) for code in get_effective_permission_codes(db, user)}
    return {"user_id": user.id, "username": user.username, **simulate_access_from_codes(codes)}


@router.get("/sessions", dependencies=[Depends(require_permission("access.view_sessions"))])
def access_sessions(db: Session = Depends(get_db), _=Depends(get_current_user)):
    rows = get_active_sessions(db)
    return [
        {
            "id": row.id,
            "session_id": row.session_code,
            "user_id": row.user_id,
            "user_name": row.user.full_name if row.user else None,
            "role": row.user.role if row.user else None,
            "device_name": row.device_name,
            "ip_address": row.ip_address,
            "login_at": (row.login_at or row.login_time).isoformat() if (row.login_at or row.login_time) else None,
            "last_seen_at": row.last_seen_at.isoformat() if row.last_seen_at else None,
            "revoked_at": row.revoked_at.isoformat() if row.revoked_at else None,
            "revoke_reason": row.revoke_reason,
            "is_active": bool(row.is_active),
        }
        for row in rows
    ]


@router.patch("/sessions/{session_id}/force-logout", dependencies=[Depends(require_permission("access.force_logout"))])
def access_force_logout_session(
    session_id: str,
    payload: dict | None,
    request: Request,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    reason = str((payload or {}).get("reason") or "Force logout").strip()
    ok = revoke_session(db, session_id, revoked_by_user_id=getattr(current, "id", None), reason=reason)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    log_access_control_audit(
        db,
        user_id=getattr(current, "id", None),
        action="force_logout",
        target_type="session",
        target_id=None,
        old_value=None,
        new_value={"session_id": session_id, "reason": reason},
        session_id=_session_id(request),
        ip_address=get_request_ip(request),
        device_name=get_request_device_info(request),
    )
    db.commit()
    return {"ok": True}


@router.patch("/sessions/force-logout-user/{user_id}", dependencies=[Depends(require_permission("access.force_logout"))])
def access_force_logout_user(
    user_id: int,
    payload: dict | None,
    request: Request,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    reason = str((payload or {}).get("reason") or "Force logout user").strip()
    terminated = revoke_all_user_sessions(
        db,
        user_id=int(user_id),
        revoked_by_user_id=getattr(current, "id", None),
        reason=reason,
    )
    log_access_control_audit(
        db,
        user_id=getattr(current, "id", None),
        action="force_logout",
        target_type="user",
        target_id=int(user_id),
        old_value=None,
        new_value={"terminated": terminated, "reason": reason},
        session_id=_session_id(request),
        ip_address=get_request_ip(request),
        device_name=get_request_device_info(request),
    )
    db.commit()
    return {"ok": True, "terminated": terminated}


@router.patch("/sessions/force-logout-all", dependencies=[Depends(require_permission("access.force_logout"))])
def access_force_logout_all(
    payload: dict | None,
    request: Request,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    reason = str((payload or {}).get("reason") or "Force logout all").strip()
    keep_current = bool((payload or {}).get("keep_current", True))
    current_session = getattr(request.state, "auth_session", None)
    current_code = current_session.session_code if (keep_current and current_session) else None
    terminated = 0
    users = db.query(User).filter(User.is_deleted == False).all()  # noqa: E712
    for user in users:
        except_code = current_code if current_code and current_session and current_session.user_id == user.id else None
        terminated += revoke_all_user_sessions(
            db,
            user_id=int(user.id),
            except_session_code=except_code,
            revoked_by_user_id=getattr(current, "id", None),
            reason=reason,
        )
    log_access_control_audit(
        db,
        user_id=getattr(current, "id", None),
        action="force_logout",
        target_type="session",
        target_id=None,
        old_value=None,
        new_value={"terminated": terminated, "reason": reason, "keep_current": keep_current},
        session_id=_session_id(request),
        ip_address=get_request_ip(request),
        device_name=get_request_device_info(request),
    )
    db.commit()
    return {"ok": True, "terminated": terminated}


@router.get("/permission-history", dependencies=[Depends(require_permission("access.view"))])
def access_permission_history(
    limit: int = Query(default=200, ge=1, le=2000),
    offset: int = Query(default=0, ge=0),
    target_type: str | None = Query(default=None),
    target_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(PermissionChangeLog).order_by(PermissionChangeLog.created_at.desc(), PermissionChangeLog.id.desc())
    if target_type:
        query = query.filter(PermissionChangeLog.target_type == str(target_type).strip().lower())
    if target_id:
        query = query.filter(PermissionChangeLog.target_id == int(target_id))
    total = query.count()
    rows = query.offset(int(offset)).limit(int(limit)).all()
    user_map = {
        int(row.id): row
        for row in db.query(User).filter(User.id.in_([int(r.changed_by) for r in rows if r.changed_by is not None])).all()
    }
    perm_ids = [int(r.permission_id) for r in rows if r.permission_id is not None]
    perm_map = {int(row.id): row for row in db.query(Permission).filter(Permission.id.in_(perm_ids)).all()} if perm_ids else {}
    payload = []
    for row in rows:
        user = user_map.get(int(row.changed_by or 0))
        perm = perm_map.get(int(row.permission_id or 0))
        payload.append(
            {
                "id": row.id,
                "changed_by": row.changed_by,
                "changed_by_name": user.full_name if user else None,
                "target_type": row.target_type,
                "target_id": row.target_id,
                "permission_id": row.permission_id,
                "permission_key": (perm.permission_key or perm.code) if perm else None,
                "old_value": json.loads(row.old_value) if row.old_value else None,
                "new_value": json.loads(row.new_value) if row.new_value else None,
                "reason": row.reason,
                "session_id": row.session_id,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
        )
    return {"total": total, "rows": payload}
