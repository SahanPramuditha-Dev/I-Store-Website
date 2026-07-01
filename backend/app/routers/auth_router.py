import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import create_access_token, get_current_user, hash_password, verify_password
from app.database import get_db
from app.models import AppSetting, Role, User
from app.schemas import TokenResponse, UserOut
from app.services.security_service import (
    build_session_payload,
    canonical_role_name,
    create_auth_session,
    ensure_security_defaults,
    get_active_sessions,
    get_effective_permission_codes,
    get_request_device_info,
    get_request_ip,
    get_security_settings,
    has_permission,
    is_user_locked,
    record_login_failed,
    record_login_success,
    record_security_audit,
    remaining_lockout_seconds,
    revoke_all_user_sessions,
    revoke_session,
    utcnow,
    validate_password_against_policy,
    validate_pin,
)

router = APIRouter(prefix="/auth", tags=["auth"])

class PinLoginIn(BaseModel):
    username: str
    pin: str
    remember_me: bool = False


class LogoutIn(BaseModel):
    session_id: str | None = None
    logout_all: bool = False


class SessionTerminateIn(BaseModel):
    session_id: str


class BootstrapOwnerIn(BaseModel):
    username: str
    full_name: str
    password: str
    phone_number: str | None = None
    email: str | None = None


def _owner_exists(db: Session) -> bool:
    owner_role = db.query(Role).filter(Role.name == "owner").first()
    if owner_role:
        owner_count = (
            db.query(User)
            .filter(
                User.role_id == owner_role.id,
                User.is_deleted == False,  # noqa: E712
                User.is_active == True,  # noqa: E712
            )
            .count()
        )
        if owner_count > 0:
            return True
    legacy_owner_count = (
        db.query(User)
        .filter(
            User.is_deleted == False,  # noqa: E712
            User.is_active == True,  # noqa: E712
        )
        .all()
    )
    return any(canonical_role_name(user.role) == "owner" for user in legacy_owner_count)


@router.get("/bootstrap/status")
def bootstrap_status(db: Session = Depends(get_db)):
    ensure_security_defaults(db)
    return {"setup_required": not _owner_exists(db), "owner_exists": _owner_exists(db)}


@router.post("/bootstrap/owner")
def bootstrap_owner(payload: BootstrapOwnerIn, request: Request, db: Session = Depends(get_db)):
    ensure_security_defaults(db)
    if _owner_exists(db):
        raise HTTPException(status_code=409, detail="Owner account already exists")

    username = str(payload.username or "").strip()
    full_name = str(payload.full_name or "").strip()
    password = str(payload.password or "")
    if not username or not full_name or not password:
        raise HTTPException(status_code=400, detail="username, full_name and password are required")

    existing = db.query(User).filter(User.username.ilike(username)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")

    security = get_security_settings(db)
    issues = validate_password_against_policy(password, security)
    if issues:
        raise HTTPException(status_code=400, detail=" ".join(issues))

    owner_role = db.query(Role).filter(Role.name == "owner").first()
    if not owner_role:
        raise HTTPException(status_code=500, detail="Owner role is not initialized")

    user = User(
        username=username,
        full_name=full_name,
        password_hash=hash_password(password),
        role="Owner",
        role_id=owner_role.id,
        phone_number=(payload.phone_number or "").strip() or None,
        email=(payload.email or "").strip() or None,
        is_active=True,
        is_deleted=False,
        last_password_change_at=utcnow(),
    )
    db.add(user)
    db.flush()

    completed_setting = db.query(AppSetting).filter(AppSetting.key == "bootstrap_owner_completed_at").first()
    completed_at = utcnow().isoformat()
    if completed_setting:
        completed_setting.value = completed_at
    else:
        db.add(AppSetting(key="bootstrap_owner_completed_at", value=completed_at))
    db.commit()

    record_security_audit(
        db,
        action="bootstrap_owner_created",
        user_id=user.id,
        target_type="user",
        target_id=user.id,
        target_ref=user.username,
        detail="First-run owner bootstrap completed",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
    )
    return {"ok": True, "user_id": user.id, "username": user.username}


@router.post("/login", response_model=TokenResponse)
async def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    ensure_security_defaults(db)
    if not _owner_exists(db):
        raise HTTPException(
            status_code=428,
            detail="System setup required. Create the first Owner account before logging in.",
        )
    security = get_security_settings(db)
    username = str(form_data.username or "").strip()
    user = db.query(User).filter(User.username.ilike(username)).first()

    if not user:
        record_login_failed(db, None, username, request, "Unknown username", login_method="password")
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not bool(user.is_active) or bool(user.is_deleted):
        record_login_failed(db, user, username, request, "Inactive account", login_method="password")
        raise HTTPException(status_code=403, detail="Account is inactive")

    if is_user_locked(user):
        remaining = remaining_lockout_seconds(user)
        record_security_audit(
            db,
            action="blocked_login",
            user_id=user.id,
            target_type="user",
            target_id=user.id,
            target_ref=user.username,
            detail="Account currently locked",
            ip_address=get_request_ip(request),
            device_info=get_request_device_info(request),
            result="blocked",
            metadata={"remaining_seconds": remaining},
        )
        raise HTTPException(status_code=423, detail=f"Account locked. Try again in {remaining} seconds")

    if not verify_password(form_data.password, user.password_hash):
        record_login_failed(db, user, username, request, "Invalid password", login_method="password")
        raise HTTPException(status_code=401, detail="Invalid credentials")

    form = await request.form()
    remember_me = str(form.get("remember_me", "")).lower() in {"1", "true", "yes", "on"}

    expiry_minutes = int(security.get("session_timeout_minutes", 30) or 30)
    if remember_me:
        expiry_minutes = 60 * 24 * 30
    expires_at = utcnow() + timedelta(minutes=expiry_minutes)

    force_single = not bool(security.get("allow_concurrent_logins", False))
    token_jti = uuid.uuid4().hex
    session_code = f"sess_{uuid.uuid4().hex[:16]}"
    create_auth_session(
        db=db,
        user=user,
        token_jti=token_jti,
        expires_at=expires_at,
        request=request,
        login_method="password",
        force_single_session=force_single,
        session_code=session_code,
    )
    token = create_access_token(
        {
            "sub": user.username,
            "uid": user.id,
            "role": canonical_role_name(user.role),
            "jti": token_jti,
            "sid": session_code,
        },
        expires_delta=timedelta(minutes=expiry_minutes),
    )
    record_login_success(db, user, request, login_method="password")
    return {"access_token": token, "token_type": "bearer", "expires_at": expires_at, "session_id": session_code}


@router.post("/login-pin", response_model=TokenResponse)
def login_pin(payload: PinLoginIn, request: Request, db: Session = Depends(get_db)):
    ensure_security_defaults(db)
    if not _owner_exists(db):
        raise HTTPException(
            status_code=428,
            detail="System setup required. Create the first Owner account before logging in.",
        )
    security = get_security_settings(db)
    if not bool(security.get("pos_pin_login_enabled", True)):
        raise HTTPException(status_code=400, detail="PIN login is disabled")

    user = db.query(User).filter(User.username.ilike(payload.username.strip())).first()
    if not user:
        record_login_failed(db, None, payload.username, request, "Unknown username (PIN)", login_method="pin")
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not bool(user.is_active) or bool(user.is_deleted):
        raise HTTPException(status_code=403, detail="Account is inactive")
    if is_user_locked(user):
        remaining = remaining_lockout_seconds(user)
        raise HTTPException(status_code=423, detail=f"Account locked. Try again in {remaining} seconds")
    if not validate_pin(payload.pin, int(security.get("pin_length", 4) or 4)):
        raise HTTPException(status_code=400, detail="Invalid PIN format")
    if not user.pin_hash or not verify_password(payload.pin, user.pin_hash):
        record_login_failed(db, user, payload.username, request, "Invalid PIN", login_method="pin")
        raise HTTPException(status_code=401, detail="Invalid credentials")

    expiry_minutes = int(security.get("session_timeout_minutes", 30) or 30)
    if payload.remember_me:
        expiry_minutes = 60 * 24 * 14
    expires_at = utcnow() + timedelta(minutes=expiry_minutes)
    force_single = not bool(security.get("allow_concurrent_logins", False))
    token_jti = uuid.uuid4().hex
    session_code = f"sess_{uuid.uuid4().hex[:16]}"
    create_auth_session(
        db=db,
        user=user,
        token_jti=token_jti,
        expires_at=expires_at,
        request=request,
        login_method="pin",
        force_single_session=force_single,
        session_code=session_code,
    )
    token = create_access_token(
        {
            "sub": user.username,
            "uid": user.id,
            "role": canonical_role_name(user.role),
            "jti": token_jti,
            "sid": session_code,
        },
        expires_delta=timedelta(minutes=expiry_minutes),
    )
    record_login_success(db, user, request, login_method="pin")
    return {"access_token": token, "token_type": "bearer", "expires_at": expires_at, "session_id": session_code}


@router.post("/logout")
def logout(
    payload: LogoutIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = getattr(request.state, "auth_session", None)
    terminated = 0
    if payload.logout_all:
        keep = session.session_code if session else None
        terminated = revoke_all_user_sessions(
            db,
            user_id=user.id,
            except_session_code=keep,
            revoked_by_user_id=user.id,
            reason="Logout all",
        )
    else:
        target = payload.session_id or (session.session_code if session else None)
        if target and revoke_session(db, target, revoked_by_user_id=user.id, reason="Logout"):
            terminated = 1
    record_security_audit(
        db,
        action="logout",
        user_id=user.id,
        target_type="session",
        target_ref=payload.session_id or (session.session_code if session else None),
        detail="User logout",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
        metadata={"logout_all": bool(payload.logout_all), "terminated": terminated},
    )
    return {"ok": True, "terminated": terminated}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.get("/me/permissions")
def me_permissions(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    codes = sorted(list(get_effective_permission_codes(db, user)))
    return {"permissions": codes}


@router.get("/sessions")
def list_sessions(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not has_permission(db, user, "access.view_sessions"):
        raise HTTPException(status_code=403, detail="Access denied")
    rows = get_active_sessions(db)
    return [build_session_payload(row) for row in rows]


@router.post("/sessions/terminate")
def terminate_session(
    payload: SessionTerminateIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not has_permission(db, user, "access.force_logout"):
        raise HTTPException(status_code=403, detail="Access denied")
    ok = revoke_session(db, payload.session_id, revoked_by_user_id=user.id, reason="Force logout")
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    record_security_audit(
        db,
        action="force_logout",
        user_id=user.id,
        target_type="session",
        target_ref=payload.session_id,
        detail="Session force terminated",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
    )
    return {"ok": True}


@router.post("/sessions/terminate-all")
def terminate_all_sessions(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not has_permission(db, user, "settings.manage_settings"):
        raise HTTPException(status_code=403, detail="Access denied")
    current = getattr(request.state, "auth_session", None)
    terminated = revoke_all_user_sessions(
        db,
        user_id=user.id,
        except_session_code=current.session_code if current else None,
        revoked_by_user_id=user.id,
        reason="Force logout all",
    )
    record_security_audit(
        db,
        action="force_logout_all",
        user_id=user.id,
        target_type="session",
        target_ref=current.session_code if current else None,
        detail="All sessions terminated",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
        metadata={"terminated": terminated},
    )
    return {"ok": True, "terminated": terminated}


@router.get("/staff")
def list_staff(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(User).filter(User.is_active == True, User.is_deleted == False).all()


@router.post("/users/{user_id}/reset-password")
def reset_password(
    user_id: int,
    payload: dict,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not has_permission(db, current_user, "settings.manage_settings"):
        raise HTTPException(status_code=403, detail="Access denied")
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    new_password = str(payload.get("new_password") or "").strip()
    if not new_password:
        raise HTTPException(status_code=400, detail="new_password is required")
    target.password_hash = hash_password(new_password)
    target.last_password_change_at = utcnow()
    db.commit()
    record_security_audit(
        db,
        action="password_reset",
        user_id=current_user.id,
        target_type="user",
        target_id=target.id,
        target_ref=target.username,
        detail="Password reset by admin",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
    )
    return {"ok": True}
