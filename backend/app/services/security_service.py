import json
import importlib
import re
import uuid
from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import Base, engine
from app.models import (
    AuditLog,
    AuthSession,
    LoginAttempt,
    Permission,
    PermissionChangeLog,
    Role,
    RolePermission,
    SecurityAuditLog,
    SecuritySetting,
    User,
    UserPermissionOverride,
)
from app.utils.time import utcnow as _utcnow


def utcnow() -> datetime:
    return _utcnow()


DEFAULT_SECURITY_SETTINGS: dict[str, Any] = {
    "session_timeout_minutes": 30,
    "max_failed_login_attempts": 5,
    "account_lockout_duration_minutes": 15,
    "require_password_change_days": 90,
    "minimum_password_length": 8,
    "require_complex_password": True,
    "allow_concurrent_logins": False,
    "after_hours_login_mode": "Alert only",
    "pos_pin_login_enabled": True,
    "pin_length": 4,
}


DEFAULT_ROLE_DEFS = [
    {"name": "owner", "display_name": "Owner", "level": 5, "description": "Full access", "is_protected": True},
    {"name": "admin", "display_name": "Admin", "level": 4, "description": "Administrative access", "is_protected": False},
    {"name": "manager", "display_name": "Manager", "level": 3, "description": "Operations and reports", "is_protected": False},
    {"name": "accountant", "display_name": "Accountant", "level": 3, "description": "Financial operations and reporting", "is_protected": False},
    {"name": "cashier", "display_name": "Cashier", "level": 1, "description": "POS and customer operations", "is_protected": False},
    {"name": "storekeeper", "display_name": "Storekeeper", "level": 2, "description": "Inventory and GRN operations", "is_protected": False},
    {"name": "technician", "display_name": "Technician", "level": 2, "description": "Repair workflow", "is_protected": False},
    {"name": "viewer", "display_name": "Viewer", "level": 0, "description": "Read-only access", "is_protected": False},
]


MODULE_ACTIONS: dict[str, list[str]] = {
    "dashboard": ["view", "export"],
    "search": ["view", "global"],
    "pos": [
        "view",
        "checkout",
        "discount",
        "override_discount",
        "void_invoice",
        "refund",
        "reprint",
        "apply_advance",
        "split_payment",
        "repair_billing",
        "reservation_billing",
        # legacy compatibility permissions
        "create",
        "edit",
        "void",
        "print",
    ],
    "repairs": [
        "view",
        "create",
        "edit",
        "assign_technician",
        "change_status",
        "add_parts",
        "create_estimate",
        "approve_estimate",
        "deliver",
        "print_job_card",
        "delete",
        # legacy compatibility permissions
        "approve",
        "print",
    ],
    "inventory": [
        "view",
        "create_product",
        "edit_product",
        "delete_product",
        "adjust_stock",
        "stock_take",
        "grn_create",
        "price_adjust",
        "view_cost_price",
        "serial_manage",
        # legacy compatibility permissions
        "create",
        "edit",
        "delete",
        "approve",
        "print",
        "export",
    ],
    "customers": ["view", "create", "edit", "delete", "restore", "view_history", "view_balance", "export"],
    "suppliers": ["view", "create", "edit", "delete", "view_ledger"],
    "purchasing": ["view", "create_po", "approve_po", "receive_grn", "cancel_po"],
    "expenses": ["view", "create", "edit", "approve", "reject", "delete", "report", "export"],
    "warranty": [
        "view",
        "create_manual",
        "edit_rules",
        "create_claim",
        "inspect_claim",
        "approve_claim",
        "reject_claim",
        "resolve_claim",
        "void",
        "print",
        "export",
        # legacy compatibility permissions
        "create",
        "edit",
        "delete",
        "approve",
    ],
    "reports": ["view", "export", "print"],
    "notifications": ["view", "acknowledge", "clear", "configure", "create", "edit", "delete"],
    "returns": [
        "view",
        "create",
        "inspect",
        "approve",
        "reject",
        "refund",
        "exchange",
        "store_credit",
        "cancel",
        "report",
        "override",
        # legacy compatibility permissions
        "edit",
        "delete",
        "print",
    ],
    "settings": [
        "view",
        "store_profile",
        "business_rules",
        "financial",
        "invoice_design",
        "notification_rules",
        "system_settings",
        # legacy compatibility permissions
        "edit",
        "manage_settings",
    ],
    "backup": ["view", "create", "restore", "download", "delete", "configure", "export", "manage_settings"],
    "audit": ["view", "export", "archive"],
    "access": ["view", "create_user", "edit_user", "disable_user", "reset_password", "manage_roles", "manage_permissions", "force_logout", "view_sessions"],
    "labels": ["view", "print", "design", "export", "create", "edit", "delete"],
    "system": ["view", "debug_dev_only", "maintenance", "database_tools"],
    # legacy compatibility modules
    "audit_logs": ["view", "create", "export"],
    "financial_audit": ["view", "export", "approve", "close_period", "reopen_period"],
    "advance": ["view", "create", "apply", "refund", "cancel", "override", "report"],
    "reservation": ["view", "create", "edit", "cancel", "invoice"],
}


SENSITIVE_PERMISSION_KEYS = {
    "pos.void_invoice",
    "pos.refund",
    "returns.refund",
    "returns.override",
    "inventory.adjust_stock",
    "inventory.delete_product",
    "backup.restore",
    "settings.financial",
    "access.manage_permissions",
    "access.reset_password",
}


PERMISSION_ALIASES: dict[str, set[str]] = {
    "settings.manage_settings": {"access.manage_permissions"},
    "audit_logs.view": {"audit.view"},
    "audit_logs.export": {"audit.export"},
    "backup.manage_settings": {"backup.configure"},
}


METHOD_DEFAULT_ACTION = {
    "GET": "view",
    "POST": "create",
    "PUT": "edit",
    "PATCH": "edit",
    "DELETE": "delete",
}


def canonical_role_name(raw_role: str | None) -> str:
    key = str(raw_role or "").strip().lower()
    if not key:
        return "cashier"
    if "owner" in key:
        return "owner"
    if "admin" in key:
        return "admin"
    if "manager" in key:
        return "manager"
    if "accountant" in key or "finance" in key:
        return "accountant"
    if "storekeeper" in key or "store keeper" in key or "keeper" in key:
        return "storekeeper"
    if "tech" in key:
        return "technician"
    if "viewer" in key:
        return "viewer"
    if key in {"view_only", "view-only", "view only"}:
        return "viewer"
    if "view" in key:
        return "view_only"
    if "cashier" in key or "staff" in key or "employee" in key:
        return "cashier"
    return key.replace(" ", "_")


def role_display_from_name(role_name: str) -> str:
    mapping = {
        "owner": "Owner",
        "admin": "Admin",
        "manager": "Manager",
        "accountant": "Accountant",
        "cashier": "Cashier / Staff",
        "storekeeper": "Storekeeper",
        "technician": "Technician",
        "viewer": "Viewer",
        "view_only": "View Only",
    }
    return mapping.get(role_name, role_name.replace("_", " ").title())


def normalize_role_for_legacy(role_name: str) -> str:
    mapping = {
        "owner": "Owner",
        "admin": "Admin",
        "manager": "Manager",
        "accountant": "Accountant",
        "cashier": "Cashier / Staff",
        "storekeeper": "Storekeeper",
        "technician": "Technician",
        "viewer": "Viewer",
        "view_only": "View Only",
    }
    return mapping.get(role_name, role_display_from_name(role_name))


def permission_code(module: str, action: str) -> str:
    return f"{module}.{action}"


def get_request_ip(request: Request | None) -> str | None:
    if not request:
        return None
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def get_request_device_info(request: Request | None) -> str | None:
    if not request:
        return None
    return request.headers.get("user-agent") or request.headers.get("sec-ch-ua") or "Unknown Device"


def is_suspicious_ip(ip_address: str | None) -> bool:
    ip = str(ip_address or "")
    if not ip:
        return False
    if ip == "127.0.0.1" or ip == "::1":
        return False
    if ip.startswith("192.168.") or ip.startswith("10."):
        return False
    if ip.startswith("172."):
        try:
            second = int(ip.split(".")[1])
            if 16 <= second <= 31:
                return False
        except Exception:
            pass
    return True


def _json_load(raw: str | None, fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except Exception:
        return fallback


def _json_dump(value: Any) -> str:
    return json.dumps(value)


def get_security_settings(db: Session) -> dict[str, Any]:
    rows = db.query(SecuritySetting).all()
    current: dict[str, Any] = {}
    for row in rows:
        current[row.key] = _json_load(row.value, row.value)
    merged = dict(DEFAULT_SECURITY_SETTINGS)
    for k, v in current.items():
        merged[k] = v
    return merged


def set_security_settings(db: Session, payload: dict[str, Any], updated_by_user_id: int | None = None) -> dict[str, Any]:
    existing = get_security_settings(db)
    merged = dict(existing)
    merged.update(payload or {})
    for key, value in merged.items():
        row = db.query(SecuritySetting).filter(SecuritySetting.key == key).first()
        if not row:
            row = SecuritySetting(key=key, value=_json_dump(value), updated_by_user_id=updated_by_user_id)
            db.add(row)
        else:
            row.value = _json_dump(value)
            row.updated_by_user_id = updated_by_user_id
            row.updated_at = utcnow()
    db.commit()
    return merged


def _ensure_roles(db: Session) -> dict[str, Role]:
    role_map: dict[str, Role] = {}
    for rd in DEFAULT_ROLE_DEFS:
        role = db.query(Role).filter(Role.name == rd["name"]).first()
        if not role:
            role = Role(
                name=rd["name"],
                display_name=rd["display_name"],
                level=rd["level"],
                description=rd["description"],
                is_protected=rd["is_protected"],
                is_locked=rd["is_protected"],
                is_system_role=True,
                is_system=True,
                is_active=True,
            )
            db.add(role)
            db.flush()
        else:
            role.display_name = rd["display_name"]
            role.level = rd["level"]
            role.description = rd["description"]
            role.is_system = True
            role.is_system_role = True
            role.is_protected = rd["is_protected"]
            role.is_locked = bool(rd["is_protected"])
            if role.is_active is None:
                role.is_active = True
            role.updated_at = utcnow()
        role_map[rd["name"]] = role
    return role_map


def _ensure_permissions(db: Session) -> dict[str, Permission]:
    perms: dict[str, Permission] = {}
    for module, actions in MODULE_ACTIONS.items():
        for action in actions:
            code = permission_code(module, action)
            p = db.query(Permission).filter(Permission.code == code).first()
            if not p:
                p = Permission(
                    permission_key=code,
                    code=code,
                    module=module,
                    action=action,
                    label=f"{module.replace('_', ' ').title()} - {action.title()}",
                    description=f"Allow {action} in {module.replace('_', ' ').title()}",
                    is_sensitive=code in SENSITIVE_PERMISSION_KEYS,
                    is_active=True,
                )
                db.add(p)
                db.flush()
            else:
                p.permission_key = code
                p.module = module
                p.action = action
                if not p.label:
                    p.label = f"{module.replace('_', ' ').title()} - {action.title()}"
                p.is_sensitive = bool(code in SENSITIVE_PERMISSION_KEYS)
                if p.is_active is None:
                    p.is_active = True
            perms[code] = p
    return perms


def _default_role_permission_allowed(role_name: str, module: str, action: str) -> bool:
    code = permission_code(module, action)
    if role_name == "owner":
        return True
    if role_name == "admin":
        return True
    if role_name == "manager":
        manager_block = {
            "system.debug_dev_only",
            "system.database_tools",
            "system.maintenance",
            "access.manage_permissions",
            "access.manage_roles",
            "access.create_user",
            "access.edit_user",
            "access.disable_user",
            "access.reset_password",
            "access.force_logout",
            "backup.restore",
            "backup.delete",
            "backup.configure",
            # legacy blockers
            "settings.manage_settings",
            "backup.manage_settings",
        }
        return code not in manager_block
    if role_name == "accountant":
        allowed = {
            "dashboard.view",
            "dashboard.export",
            "notifications.view",
            "expenses.view",
            "expenses.create",
            "expenses.edit",
            "expenses.approve",
            "expenses.reject",
            "expenses.report",
            "reports.view",
            "reports.sales",
            "reports.repairs",
            "reports.inventory",
            "reports.financial",
            "reports.customers",
            "reports.export_pdf",
            "reports.export_csv",
            "customers.view",
            "customers.view_history",
            "customers.view_balance",
            "audit.view",
            "audit.export",
            # legacy compatibility
            "financial_audit.view",
            "financial_audit.export",
            "financial_audit.approve",
            "financial_audit.close_period",
            "audit_logs.view",
        }
        return code in allowed
    if role_name == "cashier":
        allowed = {
            "dashboard.view",
            "search.view",
            "search.global",
            "notifications.view",
            "notifications.acknowledge",
            "notifications.clear",
            "pos.view",
            "pos.checkout",
            "pos.discount",
            "pos.reprint",
            "pos.apply_advance",
            "pos.split_payment",
            "pos.repair_billing",
            "pos.reservation_billing",
            "customers.view",
            "customers.create",
            "customers.edit",
            "customers.view_history",
            "customers.view_balance",
            "returns.view",
            "returns.create",
            "returns.exchange",
            "returns.store_credit",
            "labels.view",
            "labels.print",
            "repairs.view",
            "warranty.view",
            "advance.view",
            "advance.create",
            "advance.apply",
            "reservation.view",
            "reservation.create",
            "reservation.edit",
            "reservation.invoice",
            # legacy compatibility
            "pos.create",
            "pos.print",
            "returns.print",
        }
        return code in allowed
    if role_name == "storekeeper":
        allowed = {
            "dashboard.view",
            "notifications.view",
            "inventory.view",
            "inventory.create_product",
            "inventory.edit_product",
            "inventory.adjust_stock",
            "inventory.stock_take",
            "inventory.grn_create",
            "inventory.price_adjust",
            "inventory.serial_manage",
            "inventory.view_cost_price",
            "purchasing.view",
            "purchasing.create_po",
            "purchasing.receive_grn",
            "suppliers.view",
            "suppliers.create",
            "suppliers.edit",
            "suppliers.view_ledger",
            "labels.view",
            "labels.print",
            # legacy compatibility
            "inventory.create",
            "inventory.edit",
            "inventory.approve",
            "inventory.export",
            "suppliers.create",
        }
        return code in allowed
    if role_name == "technician":
        allowed = {
            "dashboard.view",
            "search.view",
            "notifications.view",
            "pos.view",
            "pos.repair_billing",
            "repairs.view",
            "repairs.create",
            "repairs.edit",
            "repairs.assign_technician",
            "repairs.change_status",
            "repairs.add_parts",
            "repairs.create_estimate",
            "repairs.print_job_card",
            "warranty.view",
            "warranty.create_claim",
            "warranty.inspect_claim",
            "returns.view",
            "returns.inspect",
            "labels.view",
            "labels.print",
            "inventory.view",
            "reservation.view",
            # legacy compatibility
            "warranty.create",
            "warranty.edit",
            "returns.edit",
        }
        return code in allowed
    if role_name in {"viewer", "view_only"}:
        return action == "view" or code in {"reports.view", "dashboard.view", "search.view"}
    return False


def _ensure_default_role_permissions(db: Session, role_map: dict[str, Role], perm_map: dict[str, Permission]) -> None:
    for role_name, role in role_map.items():
        for code, perm in perm_map.items():
            allowed = _default_role_permission_allowed(role_name, perm.module, perm.action)
            row = db.query(RolePermission).filter(RolePermission.role_id == role.id, RolePermission.permission_id == perm.id).first()
            if not row:
                row = RolePermission(role_id=role.id, permission_id=perm.id, allowed=allowed)
                db.add(row)
            elif role_name in {"owner", "admin"}:
                row.allowed = allowed


def ensure_security_defaults(db: Session) -> None:
    Base.metadata.create_all(bind=engine)
    users_table_exists = db.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
    ).first()
    if not users_table_exists:
        # In some reload scenarios (notably tests), model metadata can be stale.
        # Reload models so tables bind to the current Base, then create again.
        import app.models as models_module
        importlib.reload(models_module)
        Base.metadata.create_all(bind=engine)

    required_user_columns = {
        "role_id": "INTEGER",
        "pin_hash": "TEXT",
        "phone_number": "TEXT",
        "email": "TEXT",
        "profile_photo": "TEXT",
        "notes": "TEXT",
        "failed_login_count": "INTEGER DEFAULT 0",
        "account_locked_until": "DATETIME",
        "last_login_at": "DATETIME",
        "last_password_change_at": "DATETIME",
        "is_deleted": "BOOLEAN DEFAULT 0",
        "deleted_at": "DATETIME",
        "created_at": "DATETIME",
        "updated_at": "DATETIME",
    }
    columns = db.execute(text("PRAGMA table_info(users)")).fetchall()
    if not columns:
        return
    existing = {row[1] for row in columns}
    for column, col_type in required_user_columns.items():
        if column not in existing:
            db.execute(text(f"ALTER TABLE users ADD COLUMN {column} {col_type}"))
    db.commit()

    def _ensure_columns(table_name: str, required_columns: dict[str, str]) -> None:
        rows = db.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
        if not rows:
            return
        have = {row[1] for row in rows}
        for column, col_type in required_columns.items():
            if column not in have:
                db.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column} {col_type}"))

    # Backward-safe patching for deployments where RBAC/audit tables were created
    # with older schema shape before security hardening.
    _ensure_columns(
        "roles",
        {
            "created_by": "INTEGER",
            "is_system_role": "BOOLEAN DEFAULT 1",
            "is_locked": "BOOLEAN DEFAULT 0",
            "is_system": "BOOLEAN DEFAULT 1",
            "is_protected": "BOOLEAN DEFAULT 0",
            "is_active": "BOOLEAN DEFAULT 1",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
    )
    _ensure_columns(
        "permissions",
        {
            "permission_key": "TEXT",
            "label": "TEXT",
            "description": "TEXT",
            "is_sensitive": "BOOLEAN DEFAULT 0",
            "is_active": "BOOLEAN DEFAULT 1",
            "created_at": "DATETIME",
        },
    )
    _ensure_columns(
        "role_permissions",
        {
            "role_id": "INTEGER",
            "permission_id": "INTEGER",
            "allowed": "BOOLEAN DEFAULT 1",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
    )
    _ensure_columns(
        "user_permission_overrides",
        {
            "override_type": "TEXT",
            "effect": "TEXT",
            "reason": "TEXT",
            "created_by_user_id": "INTEGER",
            "created_at": "DATETIME",
            "updated_at": "DATETIME",
        },
    )
    _ensure_columns(
        "auth_sessions",
        {
            "session_token_hash": "TEXT",
            "login_at": "DATETIME",
            "revoked_by": "INTEGER",
            "revoke_reason": "TEXT",
        },
    )
    _ensure_columns(
        "permission_change_logs",
        {
            "changed_by": "INTEGER",
            "target_type": "TEXT",
            "target_id": "INTEGER",
            "permission_id": "INTEGER",
            "old_value": "TEXT",
            "new_value": "TEXT",
            "reason": "TEXT",
            "created_at": "DATETIME",
            "session_id": "TEXT",
        },
    )
    _ensure_columns(
        "audit_logs",
        {
            "user_id": "INTEGER",
            "module": "TEXT",
            "action": "TEXT",
            "target_type": "TEXT",
            "target_id": "INTEGER",
            "old_value": "TEXT",
            "new_value": "TEXT",
            "ip_address": "TEXT",
            "device_name": "TEXT",
            "session_id": "TEXT",
            "created_at": "DATETIME",
        },
    )
    db.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_permissions_permission_key ON permissions (permission_key)"))
    db.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_role_permissions_role_permission "
            "ON role_permissions (role_id, permission_id)"
        )
    )
    db.commit()

    role_map = _ensure_roles(db)
    perm_map = _ensure_permissions(db)
    _ensure_default_role_permissions(db, role_map, perm_map)
    set_security_settings(db, get_security_settings(db))

    users = db.query(User).all()
    for user in users:
        canonical = canonical_role_name(user.role)
        role = role_map.get(canonical) or role_map.get("cashier")
        if role:
            user.role_id = role.id
            user.role = normalize_role_for_legacy(role.name)
            if role.name == "owner":
                user.is_active = True
            if user.last_password_change_at is None:
                user.last_password_change_at = utcnow()
    db.commit()


def ensure_development_test_admin(db: Session) -> None:
    """
    Development-only test bootstrap users.
    Disabled unless explicitly enabled and strong passwords are provided via:
      - TEST_OWNER_BOOTSTRAP_PASSWORD
      - TEST_ADMIN_BOOTSTRAP_PASSWORD
    """
    from app.config import settings

    if settings.env.lower() != "development" or not settings.allow_test_admin_bootstrap:
        return

    owner_password = str(settings.test_owner_bootstrap_password or "").strip()
    admin_password = str(settings.test_admin_bootstrap_password or "").strip()
    if len(owner_password) < 12 or len(admin_password) < 12:
        # Skip silently when strong credentials are not explicitly configured.
        return

    from app.auth import hash_password

    ensure_security_defaults(db)
    role_map = {r.name: r for r in db.query(Role).all()}
    owner_role = role_map.get("owner")
    admin_role = role_map.get("admin")
    if not owner_role or not admin_role:
        return

    # Keep an owner account in dev bootstrap so first-run guard remains satisfied.
    owner = db.query(User).filter(User.username == "owner_test").first()
    if not owner:
        owner = User(
            username="owner_test",
            full_name="Testing Owner",
            password_hash=hash_password(owner_password),
            role=normalize_role_for_legacy(owner_role.name),
            role_id=owner_role.id,
            is_active=True,
            is_deleted=False,
            last_password_change_at=utcnow(),
        )
        db.add(owner)

    admin = db.query(User).filter(User.username == "admin_test").first()
    if not admin:
        admin = User(
            username="admin_test",
            full_name="Testing Admin",
            password_hash=hash_password(admin_password),
            role=normalize_role_for_legacy(admin_role.name),
            role_id=admin_role.id,
            is_active=True,
            is_deleted=False,
            last_password_change_at=utcnow(),
        )
        db.add(admin)
    else:
        admin.role_id = admin_role.id
        admin.role = normalize_role_for_legacy(admin_role.name)
        admin.is_active = True
        admin.is_deleted = False
        admin.password_hash = hash_password(admin_password)
        admin.last_password_change_at = utcnow()

    owner.password_hash = hash_password(owner_password)
    owner.last_password_change_at = utcnow()

    db.commit()


def _role_for_user(db: Session, user: User) -> Role | None:
    if user.role_id:
        role = db.query(Role).filter(Role.id == user.role_id).first()
        if role:
            return role
    canonical = canonical_role_name(user.role)
    role = db.query(Role).filter(Role.name == canonical).first()
    if role:
        user.role_id = role.id
        db.commit()
    return role


def list_roles(db: Session) -> list[Role]:
    return db.query(Role).order_by(Role.level.desc(), Role.id.asc()).all()


def list_permissions(db: Session) -> list[Permission]:
    return db.query(Permission).filter(Permission.is_active == True).order_by(Permission.module.asc(), Permission.action.asc()).all()


def get_effective_permission_codes(db: Session, user: User) -> set[str]:
    role = _role_for_user(db, user)
    if role and role.name in {"owner", "admin"}:
        return {p.code for p in list_permissions(db)}

    allowed_codes: set[str] = set()
    if role:
        role_rows = (
            db.query(RolePermission, Permission)
            .join(Permission, Permission.id == RolePermission.permission_id)
            .filter(RolePermission.role_id == role.id)
            .all()
        )
        for rp, perm in role_rows:
            if rp.allowed:
                allowed_codes.add(perm.code)
            elif perm.code in allowed_codes:
                allowed_codes.remove(perm.code)

    overrides = (
        db.query(UserPermissionOverride, Permission)
        .join(Permission, Permission.id == UserPermissionOverride.permission_id)
        .filter(UserPermissionOverride.user_id == user.id)
        .all()
    )
    for ov, perm in overrides:
        if ov.effect == "allow":
            allowed_codes.add(perm.code)
        elif ov.effect == "deny" and perm.code in allowed_codes:
            allowed_codes.remove(perm.code)
    return allowed_codes


def has_permission(db: Session, user: User, permission: str) -> bool:
    role = _role_for_user(db, user)
    if role and role.name in {"owner", "admin"}:
        return True
    effective = get_effective_permission_codes(db, user)
    if permission in effective:
        return True
    for alias in PERMISSION_ALIASES.get(permission, set()):
        if alias in effective:
            return True
    for parent, aliases in PERMISSION_ALIASES.items():
        if permission in aliases and parent in effective:
            return True
    return False


def infer_action_from_request(request: Request) -> str:
    method = request.method.upper()
    path = request.url.path.lower()
    if path.startswith("/settings"):
        if method in {"PUT", "PATCH", "POST", "DELETE"}:
            return "manage_settings"
        return "view"
    if "/export" in path:
        return "export"
    if "/print" in path:
        return "print"
    if "/approve" in path or "/verify" in path:
        return "approve"
    if "/void" in path:
        return "void"
    if "/refund" in path:
        return "refund"
    if "/restore" in path:
        return "restore"
    return METHOD_DEFAULT_ACTION.get(method, "view")


def permission_from_module_action(module: str, action: str) -> str:
    return permission_code(module, action)


def validate_password_against_policy(password: str, settings: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    min_len = int(settings.get("minimum_password_length", 8) or 8)
    if len(password or "") < min_len:
        issues.append(f"Password must be at least {min_len} characters.")
    if bool(settings.get("require_complex_password", True)):
        if not re.search(r"[A-Z]", password or ""):
            issues.append("Password must include an uppercase letter.")
        if not re.search(r"[a-z]", password or ""):
            issues.append("Password must include a lowercase letter.")
        if not re.search(r"\d", password or ""):
            issues.append("Password must include a number.")
        if not re.search(r"[^A-Za-z0-9]", password or ""):
            issues.append("Password must include a symbol.")
    return issues


def validate_pin(pin: str | None, pin_length: int = 4) -> bool:
    if not pin:
        return False
    return bool(re.fullmatch(rf"\d{{{int(pin_length)}}}", str(pin)))


def is_admin_lockout_exempt(user: User | None) -> bool:
    return bool(user and str(user.username or "").strip().lower() == "admin")


def is_user_locked(user: User) -> bool:
    if is_admin_lockout_exempt(user):
        if user.account_locked_until:
            user.account_locked_until = None
        return False
    return bool(user.account_locked_until and user.account_locked_until > utcnow())


def remaining_lockout_seconds(user: User) -> int:
    if not user.account_locked_until:
        return 0
    delta = user.account_locked_until - utcnow()
    return max(0, int(delta.total_seconds()))


def record_security_audit(
    db: Session,
    action: str,
    user_id: int | None = None,
    target_type: str | None = None,
    target_id: int | None = None,
    target_ref: str | None = None,
    detail: str | None = None,
    ip_address: str | None = None,
    device_info: str | None = None,
    result: str = "success",
    metadata: dict[str, Any] | None = None,
) -> SecurityAuditLog:
    row = SecurityAuditLog(
        user_id=user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        target_ref=target_ref,
        detail=detail,
        ip_address=ip_address,
        device_info=device_info,
        result=result,
        metadata_json=_json_dump(metadata or {}),
    )
    db.add(row)
    db.commit()
    return row


def build_session_payload(session: AuthSession) -> dict[str, Any]:
    now = utcnow()
    duration_seconds = max(0, int((now - (session.login_time or now)).total_seconds()))
    return {
        "session_id": session.session_code,
        "user_id": session.user_id,
        "user_name": session.user.full_name if session.user else None,
        "role": session.user.role if session.user else None,
        "device_name": session.device_name,
        "device_info": session.device_info,
        "ip_address": session.ip_address,
        "location": session.location or ("External Network" if is_suspicious_ip(session.ip_address) else "Store LAN"),
        "login_time": session.login_time.isoformat() if session.login_time else None,
        "last_seen_at": session.last_seen_at.isoformat() if session.last_seen_at else None,
        "session_duration_seconds": duration_seconds,
        "status": "Active" if session.is_active and (not session.expires_at or session.expires_at > now) else "Expired",
        "is_current": bool(session.is_current),
        "is_suspicious": bool(session.is_suspicious),
        "login_method": session.login_method,
    }


def create_auth_session(
    db: Session,
    user: User,
    token_jti: str,
    expires_at: datetime,
    request: Request | None = None,
    login_method: str = "password",
    force_single_session: bool = False,
    session_code: str | None = None,
) -> AuthSession:
    ip = get_request_ip(request)
    device_info = get_request_device_info(request)
    if force_single_session:
        active = db.query(AuthSession).filter(AuthSession.user_id == user.id, AuthSession.is_active == True).all()
        for row in active:
            row.is_active = False
            row.revoked_at = utcnow()
            row.revoke_reason = "Concurrent login blocked"
            row.is_current = False
    session = AuthSession(
        session_code=session_code or f"sess_{uuid.uuid4().hex[:16]}",
        session_token_hash=token_jti,
        user_id=user.id,
        token_jti=token_jti,
        device_name="Desktop",
        device_info=device_info,
        ip_address=ip,
        location="External Network" if is_suspicious_ip(ip) else "Store LAN",
        login_method=login_method,
        login_at=utcnow(),
        login_time=utcnow(),
        last_seen_at=utcnow(),
        expires_at=expires_at,
        is_active=True,
        is_current=True,
        is_suspicious=is_suspicious_ip(ip),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def touch_session_by_jti(db: Session, token_jti: str) -> AuthSession | None:
    row = (
        db.query(AuthSession)
        .filter(AuthSession.token_jti == token_jti)
        .first()
    )
    if not row:
        return None
    row.last_seen_at = utcnow()
    db.commit()
    return row


def revoke_session(
    db: Session,
    session_code: str,
    revoked_by_user_id: int | None = None,
    reason: str = "Force logout",
) -> bool:
    row = db.query(AuthSession).filter(AuthSession.session_code == session_code).first()
    if not row:
        return False
    row.is_active = False
    row.is_current = False
    row.revoked_at = utcnow()
    row.revoked_by_user_id = revoked_by_user_id
    row.revoke_reason = reason
    db.commit()
    return True


def revoke_all_user_sessions(
    db: Session,
    user_id: int,
    except_session_code: str | None = None,
    revoked_by_user_id: int | None = None,
    reason: str = "Force logout all",
) -> int:
    rows = db.query(AuthSession).filter(AuthSession.user_id == user_id, AuthSession.is_active == True).all()
    count = 0
    for row in rows:
        if except_session_code and row.session_code == except_session_code:
            continue
        row.is_active = False
        row.is_current = False
        row.revoked_at = utcnow()
        row.revoked_by_user_id = revoked_by_user_id
        row.revoke_reason = reason
        count += 1
    db.commit()
    return count


def get_active_sessions(db: Session) -> list[AuthSession]:
    now = utcnow()
    rows = (
        db.query(AuthSession)
        .filter(AuthSession.is_active == True)
        .all()
    )
    out: list[AuthSession] = []
    for row in rows:
        if row.expires_at and row.expires_at <= now:
            row.is_active = False
            row.is_current = False
            row.revoke_reason = row.revoke_reason or "Session expired"
            row.revoked_at = row.revoked_at or now
        else:
            out.append(row)
    db.commit()
    return out


def record_login_failed(
    db: Session,
    user: User | None,
    username: str,
    request: Request | None,
    reason: str,
    login_method: str = "password",
) -> None:
    settings = get_security_settings(db)
    max_attempts = int(settings.get("max_failed_login_attempts", 5) or 5)
    lockout_minutes = int(settings.get("account_lockout_duration_minutes", 15) or 15)

    if user:
        user.failed_login_count = int(user.failed_login_count or 0) + 1
        if is_admin_lockout_exempt(user):
            user.account_locked_until = None
        elif user.failed_login_count >= max_attempts:
            user.account_locked_until = utcnow() + timedelta(minutes=lockout_minutes)
    db.add(
        LoginAttempt(
            username=username,
            user_id=user.id if user else None,
            login_method=login_method,
            ip_address=get_request_ip(request),
            device_info=get_request_device_info(request),
            attempted_at=utcnow(),
            success=False,
            failure_reason=reason,
        )
    )
    db.commit()

    record_security_audit(
        db,
        action="failed_login",
        user_id=user.id if user else None,
        target_type="user",
        target_id=user.id if user else None,
        target_ref=username,
        detail=reason,
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="failed",
        metadata={"failed_attempts": int(user.failed_login_count or 0) if user else None},
    )


def record_login_success(
    db: Session,
    user: User,
    request: Request | None,
    login_method: str = "password",
) -> None:
    user.failed_login_count = 0
    user.account_locked_until = None
    user.last_login_at = utcnow()
    user.updated_at = utcnow()
    db.add(
        LoginAttempt(
            username=user.username,
            user_id=user.id,
            login_method=login_method,
            ip_address=get_request_ip(request),
            device_info=get_request_device_info(request),
            attempted_at=utcnow(),
            success=True,
            failure_reason=None,
        )
    )
    db.commit()
    record_security_audit(
        db,
        action="login",
        user_id=user.id,
        target_type="user",
        target_id=user.id,
        target_ref=user.username,
        detail="User login successful",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
    )


def role_matrix_payload(db: Session) -> dict[str, Any]:
    roles = list_roles(db)
    permissions = list_permissions(db)
    rows = db.query(RolePermission).all()
    role_perm = {(row.role_id, row.permission_id): bool(row.allowed) for row in rows}

    grouped_modules: dict[str, list[dict[str, Any]]] = {}
    for perm in permissions:
        grouped_modules.setdefault(perm.module, []).append(
            {
                "permission_id": perm.id,
                "code": perm.code,
                "action": perm.action,
                "label": perm.label or perm.code,
            }
        )
    for module in grouped_modules:
        grouped_modules[module] = sorted(grouped_modules[module], key=lambda x: x["action"])

    role_rows = []
    for role in roles:
        allowed_ids = {
            perm_id
            for (r_id, perm_id), allowed in role_perm.items()
            if r_id == role.id and allowed
        }
        role_rows.append(
            {
                "id": role.id,
                "name": role.name,
                "display_name": role.display_name,
                "level": role.level,
                "description": role.description,
                "is_protected": bool(role.is_protected),
                "is_system": bool(role.is_system),
                "enabled_permissions": len(allowed_ids),
                "total_permissions": len(permissions),
            }
        )

    return {
        "roles": role_rows,
        "permissions": [{"id": p.id, "code": p.code, "module": p.module, "action": p.action, "label": p.label} for p in permissions],
        "grouped_modules": grouped_modules,
        "role_permissions": [
            {"role_id": row.role_id, "permission_id": row.permission_id, "allowed": bool(row.allowed)}
            for row in rows
        ],
    }


def set_role_permissions(db: Session, role_id: int, permission_ids: list[int], allowed: bool) -> None:
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.name == "owner" or bool(role.is_protected) or bool(getattr(role, "is_locked", False)):
        raise HTTPException(status_code=400, detail="Locked role permissions cannot be modified")

    for permission_id in permission_ids:
        rp = (
            db.query(RolePermission)
            .filter(RolePermission.role_id == role_id, RolePermission.permission_id == permission_id)
            .first()
        )
        if not rp:
            rp = RolePermission(role_id=role_id, permission_id=permission_id, allowed=allowed)
            db.add(rp)
        else:
            rp.allowed = allowed
    db.commit()


def set_role_permissions_bulk(db: Session, role_id: int, allowed: bool) -> None:
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.name == "owner" or bool(role.is_protected) or bool(getattr(role, "is_locked", False)):
        raise HTTPException(status_code=400, detail="Locked role permissions cannot be modified")
    perms = list_permissions(db)
    for perm in perms:
        row = db.query(RolePermission).filter(RolePermission.role_id == role_id, RolePermission.permission_id == perm.id).first()
        if not row:
            row = RolePermission(role_id=role_id, permission_id=perm.id, allowed=allowed)
            db.add(row)
        else:
            row.allowed = allowed
    db.commit()


def reset_role_permissions_to_default(db: Session, role_id: int) -> None:
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.name == "owner" or role.is_protected or bool(getattr(role, "is_locked", False)):
        raise HTTPException(status_code=400, detail="Owner role permissions are locked")
    perms = list_permissions(db)
    for perm in perms:
        default_allowed = _default_role_permission_allowed(role.name, perm.module, perm.action)
        row = db.query(RolePermission).filter(RolePermission.role_id == role.id, RolePermission.permission_id == perm.id).first()
        if not row:
            row = RolePermission(role_id=role.id, permission_id=perm.id, allowed=default_allowed)
            db.add(row)
        else:
            row.allowed = bool(default_allowed)
            row.updated_at = utcnow()
    db.commit()


def copy_role_permissions(db: Session, *, role_id: int, source_role_id: int) -> int:
    role = db.query(Role).filter(Role.id == int(role_id)).first()
    source = db.query(Role).filter(Role.id == int(source_role_id)).first()
    if not role or not source:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.name == "owner" or role.is_protected or bool(getattr(role, "is_locked", False)):
        raise HTTPException(status_code=400, detail="Owner role permissions are locked")
    source_state = role_permission_state(db, source.id)
    changed = 0
    for perm in list_permissions(db):
        new_allowed = bool(source_state.get(int(perm.id), False))
        row = db.query(RolePermission).filter(RolePermission.role_id == role.id, RolePermission.permission_id == perm.id).first()
        if not row:
            db.add(RolePermission(role_id=role.id, permission_id=perm.id, allowed=new_allowed))
            changed += 1
        else:
            if bool(row.allowed) != new_allowed:
                row.allowed = new_allowed
                row.updated_at = utcnow()
                changed += 1
    db.commit()
    return changed


def get_user_permission_override_payload(db: Session, user_id: int) -> dict[str, Any]:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    overrides = (
        db.query(UserPermissionOverride, Permission)
        .join(Permission, Permission.id == UserPermissionOverride.permission_id)
        .filter(UserPermissionOverride.user_id == user_id)
        .all()
    )
    out = []
    for row, perm in overrides:
        out.append(
            {
                "id": row.id,
                "permission_id": perm.id,
                "permission_code": perm.code,
                "override_type": row.override_type or row.effect,
                "effect": row.effect,
                "reason": row.reason,
                "created_by_user_id": row.created_by_user_id,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
        )
    return {"user_id": user_id, "overrides": out}


def set_user_permission_override(
    db: Session,
    user_id: int,
    permission_id: int,
    effect: str,
    actor_user_id: int | None = None,
    reason: str | None = None,
) -> UserPermissionOverride:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    role = _role_for_user(db, user)
    if role and role.name == "owner":
        raise HTTPException(status_code=400, detail="Owner permissions cannot be overridden")
    perm = db.query(Permission).filter(Permission.id == permission_id).first()
    if not perm:
        raise HTTPException(status_code=404, detail="Permission not found")
    effect_normalized = str(effect or "").lower()
    if effect_normalized not in {"allow", "deny"}:
        raise HTTPException(status_code=400, detail="effect must be allow or deny")
    row = (
        db.query(UserPermissionOverride)
        .filter(UserPermissionOverride.user_id == user_id, UserPermissionOverride.permission_id == permission_id)
        .first()
    )
    if not row:
        row = UserPermissionOverride(
            user_id=user_id,
            permission_id=permission_id,
            override_type=effect_normalized,
            effect=effect_normalized,
            reason=reason or "",
            created_by_user_id=actor_user_id,
        )
        db.add(row)
    else:
        row.override_type = effect_normalized
        row.effect = effect_normalized
        row.reason = reason or row.reason
        row.created_by_user_id = actor_user_id
    db.commit()
    db.refresh(row)
    return row


def clear_user_permission_override(db: Session, user_id: int, permission_id: int) -> bool:
    row = (
        db.query(UserPermissionOverride)
        .filter(UserPermissionOverride.user_id == user_id, UserPermissionOverride.permission_id == permission_id)
        .first()
    )
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


def clear_user_permission_override_by_id(db: Session, user_id: int, override_id: int) -> UserPermissionOverride | None:
    row = (
        db.query(UserPermissionOverride)
        .filter(UserPermissionOverride.user_id == user_id, UserPermissionOverride.id == override_id)
        .first()
    )
    if not row:
        return None
    db.delete(row)
    db.commit()
    return row


def count_active_owner_users(db: Session) -> int:
    owner_role = db.query(Role).filter(Role.name == "owner").first()
    if owner_role:
        return (
            db.query(User)
            .filter(
                User.role_id == owner_role.id,
                User.is_deleted == False,  # noqa: E712
                User.is_active == True,  # noqa: E712
            )
            .count()
        )
    users = db.query(User).filter(User.is_deleted == False, User.is_active == True).all()  # noqa: E712
    return len([u for u in users if canonical_role_name(u.role) == "owner"])


def is_owner_user(db: Session, user: User | None) -> bool:
    if not user:
        return False
    role = _role_for_user(db, user)
    return bool((role and role.name == "owner") or canonical_role_name(user.role) == "owner")


def is_last_active_owner_user(db: Session, user: User | None) -> bool:
    if not is_owner_user(db, user):
        return False
    return count_active_owner_users(db) <= 1


def enforce_owner_user_change_guard(
    db: Session,
    *,
    target_user: User,
    new_role_name: str | None = None,
    new_is_active: bool | None = None,
    deleting: bool = False,
) -> None:
    if not is_owner_user(db, target_user):
        return
    owner_remaining = count_active_owner_users(db)
    changing_role = bool(new_role_name and str(new_role_name).strip().lower() != "owner")
    deactivating = new_is_active is False
    if deleting or changing_role or deactivating:
        if owner_remaining <= 1:
            raise HTTPException(status_code=400, detail="Last Owner user cannot be deleted, deactivated, or demoted")


def enforce_role_locked_guard(role: Role, operation: str) -> None:
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.name == "owner" or bool(role.is_protected) or bool(getattr(role, "is_locked", False)):
        raise HTTPException(status_code=400, detail=f"Locked role cannot be {operation}")


def log_permission_change(
    db: Session,
    *,
    changed_by: int | None,
    target_type: str,
    target_id: int,
    permission_id: int | None,
    old_value: Any,
    new_value: Any,
    reason: str | None,
    session_id: str | None,
    ip_address: str | None = None,
    device_name: str | None = None,
) -> PermissionChangeLog:
    row = PermissionChangeLog(
        changed_by=changed_by,
        target_type=target_type,
        target_id=target_id,
        permission_id=permission_id,
        old_value=_json_dump(old_value) if old_value is not None else None,
        new_value=_json_dump(new_value) if new_value is not None else None,
        reason=reason or None,
        session_id=session_id,
        created_at=utcnow(),
    )
    db.add(row)
    db.add(
        AuditLog(
            user_id=changed_by,
            module="ACCESS_CONTROL",
            action="permission_change",
            target_type=target_type,
            target_id=target_id,
            old_value=_json_dump(old_value) if old_value is not None else None,
            new_value=_json_dump(new_value) if new_value is not None else None,
            ip_address=ip_address,
            device_name=device_name,
            session_id=session_id,
            created_at=utcnow(),
        )
    )
    return row


def log_access_control_audit(
    db: Session,
    *,
    user_id: int | None,
    action: str,
    target_type: str | None,
    target_id: int | None,
    old_value: Any = None,
    new_value: Any = None,
    session_id: str | None = None,
    ip_address: str | None = None,
    device_name: str | None = None,
) -> AuditLog:
    row = AuditLog(
        user_id=user_id,
        module="ACCESS_CONTROL",
        action=action,
        target_type=target_type,
        target_id=target_id,
        old_value=_json_dump(old_value) if old_value is not None else None,
        new_value=_json_dump(new_value) if new_value is not None else None,
        ip_address=ip_address,
        device_name=device_name,
        session_id=session_id,
        created_at=utcnow(),
    )
    db.add(row)
    db.add(
        SecurityAuditLog(
            user_id=user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            target_ref=session_id,
            detail="ACCESS_CONTROL event",
            ip_address=ip_address,
            device_info=device_name,
            result="success",
            metadata_json=_json_dump(
                {
                    "module": "ACCESS_CONTROL",
                    "old_value": old_value,
                    "new_value": new_value,
                    "session_id": session_id,
                }
            ),
            created_at=utcnow(),
        )
    )
    return row


def role_permission_state(db: Session, role_id: int) -> dict[int, bool]:
    rows = (
        db.query(RolePermission)
        .filter(RolePermission.role_id == int(role_id))
        .all()
    )
    return {int(row.permission_id): bool(row.allowed) for row in rows}


def get_role_permissions_payload(db: Session, role_id: int) -> dict[str, Any]:
    role = db.query(Role).filter(Role.id == int(role_id)).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    permissions = list_permissions(db)
    state = role_permission_state(db, role.id)
    rows = []
    for perm in permissions:
        rows.append(
            {
                "permission_id": perm.id,
                "permission_key": perm.permission_key or perm.code,
                "module": perm.module,
                "action": perm.action,
                "description": perm.description,
                "is_sensitive": bool(perm.is_sensitive),
                "allowed": bool(state.get(int(perm.id), False) or role.name in {"owner", "admin"}),
            }
        )
    return {
        "role_id": role.id,
        "role_name": role.name,
        "role_display_name": role.display_name,
        "locked": bool(role.name == "owner" or role.is_protected or getattr(role, "is_locked", False)),
        "permissions": rows,
    }


def revoke_sessions_for_users(
    db: Session,
    *,
    user_ids: list[int],
    except_user_id: int | None,
    reason: str,
    revoked_by_user_id: int | None,
) -> int:
    terminated = 0
    unique_ids = sorted({int(x) for x in user_ids if x is not None})
    for uid in unique_ids:
        except_session = None
        if except_user_id is not None and int(uid) == int(except_user_id):
            # Keep current actor session unless explicitly targeted.
            except_session = None
        terminated += revoke_all_user_sessions(
            db,
            user_id=int(uid),
            except_session_code=except_session,
            revoked_by_user_id=revoked_by_user_id,
            reason=reason,
        )
    return terminated


SIMULATION_ROUTE_RULES = [
    {"path": "/dashboard", "permission": "dashboard.view", "label": "Dashboard"},
    {"path": "/search", "permission": "search.view", "label": "Search Hub"},
    {"path": "/pos", "permission": "pos.view", "label": "POS / Billing"},
    {"path": "/repairs", "permission": "repairs.view", "label": "Repair Management"},
    {"path": "/inventory", "permission": "inventory.view", "label": "Inventory"},
    {"path": "/customers", "permission": "customers.view", "label": "Customers"},
    {"path": "/purchase", "permission": "purchasing.view", "label": "Purchasing"},
    {"path": "/expenses", "permission": "expenses.view", "label": "Expenses"},
    {"path": "/warranty", "permission": "warranty.view", "label": "Warranty"},
    {"path": "/returns", "permission": "returns.view", "label": "Returns & Refunds"},
    {"path": "/reports", "permission": "reports.view", "label": "Reports & Analytics"},
    {"path": "/backup", "permission": "backup.view", "label": "Backup & Restore"},
    {"path": "/audit", "permission": "audit.view", "label": "Audit Trail"},
    {"path": "/settings", "permission": "settings.view", "label": "Settings"},
    {"path": "/permissions", "permission": "access.view", "label": "Access Control"},
]


def simulate_access_from_codes(codes: set[str]) -> dict[str, Any]:
    allowed_routes = []
    blocked_routes = []
    for row in SIMULATION_ROUTE_RULES:
        required = str(row["permission"])
        if required in codes:
            allowed_routes.append({"path": row["path"], "permission": required, "label": row["label"]})
        else:
            blocked_routes.append({"path": row["path"], "permission": required, "label": row["label"]})
    sensitive = sorted([code for code in codes if code in SENSITIVE_PERMISSION_KEYS])
    visible_sidebar_pages = [row["path"] for row in allowed_routes]
    return {
        "visible_sidebar_pages": visible_sidebar_pages,
        "accessible_routes": allowed_routes,
        "blocked_routes": blocked_routes,
        "allowed_actions": sorted(list(codes)),
        "blocked_actions": sorted([row["permission"] for row in blocked_routes]),
        "sensitive_permissions": sensitive,
    }
