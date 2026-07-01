from datetime import datetime, timedelta
from typing import Callable

from jose import jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.config import settings
from app.database import get_db
from app.models import AuthSession, Role, User
from app.services.security_service import (
    get_security_settings,
    has_permission,
    infer_action_from_request,
    permission_from_module_action,
    utcnow,
)

# Prefer PBKDF2 for broad local desktop compatibility; verify supports bcrypt legacy hashes too.
pwd_context = CryptContext(schemes=["pbkdf2_sha256", "bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

def hash_password(password: str):
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str):
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    expire = utcnow() + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)

def _get_role_for_user(db: Session, user: User) -> Role | None:
    if user.role_id:
        role = db.query(Role).filter(Role.id == user.role_id).first()
        if role:
            return role
    return None


def get_current_user(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    credentials_exception = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication")
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        username = payload.get("sub")
        token_jti = payload.get("jti")
        session_code = payload.get("sid")
        if username is None:
            raise credentials_exception
    except Exception:
        raise credentials_exception
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise credentials_exception
    if not bool(user.is_active) or bool(user.is_deleted):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")
    request.state.current_user_id = user.id

    if token_jti and session_code:
        session = (
            db.query(AuthSession)
            .filter(
                AuthSession.session_code == session_code,
                AuthSession.token_jti == token_jti,
            )
            .first()
        )
        if not session or not bool(session.is_active):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session is no longer active")

        now = utcnow()
        if session.expires_at and session.expires_at <= now:
            session.is_active = False
            session.is_current = False
            session.revoked_at = now
            session.revoke_reason = "Session expired"
            db.commit()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")

        security = get_security_settings(db)
        timeout_minutes = int(security.get("session_timeout_minutes", 30) or 30)
        if session.last_seen_at and (now - session.last_seen_at) > timedelta(minutes=timeout_minutes):
            session.is_active = False
            session.is_current = False
            session.revoked_at = now
            session.revoke_reason = "Inactivity timeout"
            db.commit()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session timed out")

        session.last_seen_at = now
        db.commit()
        request.state.auth_session = session

    request.state.current_user = user
    return user

def require_admin(user: User = Depends(get_current_user)):
    role = str(user.role or "").lower()
    if "owner" in role or "admin" in role:
        return user
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


def require_permission(permission: str | list[str] | tuple[str, ...] | set[str]) -> Callable:
    def _dep(
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        permissions = [permission] if isinstance(permission, str) else list(permission or [])
        if not any(has_permission(db, user, item) for item in permissions):
            label = " or ".join(permissions) if permissions else "permission"
            raise HTTPException(status_code=403, detail=f"Permission denied: {label}")
        return user

    return _dep


def require_module_access(module: str) -> Callable:
    def _dep(
        request: Request,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        action = infer_action_from_request(request)
        perm = permission_from_module_action(module, action)
        request.state.audit_module = module
        request.state.audit_action = action
        request.state.audit_permission = perm
        request.state.audit_user_id = user.id if user else None
        allowed = has_permission(db, user, perm)
        request.state.audit_allowed = bool(allowed)
        if not allowed:
            raise HTTPException(status_code=403, detail=f"Access denied ({module}:{action})")
        return user

    return _dep
