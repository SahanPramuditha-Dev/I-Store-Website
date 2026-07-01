from datetime import UTC, datetime
import ast
from pathlib import Path


def _role_by_name(rows, name: str):
    for row in rows:
        if str(row.get("name") or "").lower() == str(name).lower():
            return row
    return None


def test_public_business_routes_have_explicit_action_permissions():
    router_dir = Path(__file__).resolve().parents[1] / "app" / "routers"
    missing: list[str] = []
    for path in sorted(router_dir.glob("*_router.py")):
        if path.name == "auth_router.py":
            continue
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in node.decorator_list:
                target = decorator.func if isinstance(decorator, ast.Call) else decorator
                is_route = (
                    isinstance(target, ast.Attribute)
                    and isinstance(target.value, ast.Name)
                    and target.value.id == "router"
                    and target.attr in {"get", "post", "put", "patch", "delete"}
                )
                if not is_route:
                    continue
                decorator_source = ast.get_source_segment(source, decorator) or ""
                if "require_permission" not in decorator_source:
                    missing.append(f"{path.name}:{node.lineno}:{node.name}")

    assert not missing, "Routes missing explicit permissions:\n" + "\n".join(missing)


def test_access_control_contract_endpoints(client, auth_headers):
    roles_resp = client.get("/access/roles", headers=auth_headers)
    assert roles_resp.status_code == 200, roles_resp.text
    roles = roles_resp.json()
    assert _role_by_name(roles, "owner")
    assert _role_by_name(roles, "admin")
    assert _role_by_name(roles, "manager")
    assert _role_by_name(roles, "cashier")
    assert _role_by_name(roles, "technician")
    assert _role_by_name(roles, "storekeeper")
    assert _role_by_name(roles, "accountant")
    assert _role_by_name(roles, "viewer")

    permissions_resp = client.get("/access/permissions", headers=auth_headers)
    assert permissions_resp.status_code == 200, permissions_resp.text
    permissions = permissions_resp.json()["permissions"]
    perm_by_key = {str(row["permission_key"]): row for row in permissions}
    assert "access.manage_permissions" in perm_by_key
    assert "pos.refund" in perm_by_key

    created_role_resp = client.post(
        "/access/roles",
        json={
            "name": f"assistant_{datetime.now(UTC).strftime('%H%M%S')}",
            "display_name": "Assistant",
            "description": "Custom assistant role",
            "level": 1,
        },
        headers=auth_headers,
    )
    assert created_role_resp.status_code == 200, created_role_resp.text
    role_id = int(created_role_resp.json()["id"])

    manager = _role_by_name(roles, "manager")
    assert manager
    copy_resp = client.post(
        f"/access/roles/{role_id}/copy-from/{manager['id']}",
        json={"reason": "Bootstrap assistant role from manager"},
        headers=auth_headers,
    )
    assert copy_resp.status_code == 200, copy_resp.text

    role_perms_resp = client.get(f"/access/roles/{role_id}/permissions", headers=auth_headers)
    assert role_perms_resp.status_code == 200, role_perms_resp.text
    role_perms = role_perms_resp.json()["permissions"]
    assert len(role_perms) > 0

    # Sensitive permission change requires confirm_sensitive flag.
    sensitive_perm_id = int(perm_by_key["pos.refund"]["id"])
    missing_confirm_resp = client.put(
        f"/access/roles/{role_id}/permissions",
        json={
            "changes": [{"permission_id": sensitive_perm_id, "allowed": False}],
            "reason": "Downgrade role for safety",
        },
        headers=auth_headers,
    )
    assert missing_confirm_resp.status_code == 400, missing_confirm_resp.text

    sensitive_change_resp = client.put(
        f"/access/roles/{role_id}/permissions",
        json={
            "changes": [{"permission_id": sensitive_perm_id, "allowed": False}],
            "reason": "Downgrade role for safety",
            "confirm_sensitive": True,
        },
        headers=auth_headers,
    )
    assert sensitive_change_resp.status_code == 200, sensitive_change_resp.text
    assert int(sensitive_change_resp.json()["changed"]) >= 0

    sim_role_resp = client.get(f"/access/simulate/role/{role_id}", headers=auth_headers)
    assert sim_role_resp.status_code == 200, sim_role_resp.text
    assert "visible_sidebar_pages" in sim_role_resp.json()

    # Create a staff user and apply per-user override.
    create_user_resp = client.post(
        "/settings/employees",
        json={
            "username": f"rbac_user_{datetime.now(UTC).strftime('%H%M%S')}",
            "full_name": "RBAC User",
            "password": "User#Pass2026",
            "role": "Cashier / Staff",
            "phone_number": "0771231234",
            "email": "rbac.user@example.com",
            "pin": "1234",
            "notes": "RBAC test user",
            "is_active": True,
        },
        headers=auth_headers,
    )
    assert create_user_resp.status_code == 200, create_user_resp.text
    user_id = int(create_user_resp.json()["id"])

    override_perm_id = int(perm_by_key["reports.view"]["id"])
    override_set_resp = client.put(
        f"/access/users/{user_id}/overrides",
        json={
            "permission_id": override_perm_id,
            "override_type": "allow",
            "reason": "Temporary reporting visibility for this user",
        },
        headers=auth_headers,
    )
    assert override_set_resp.status_code == 200, override_set_resp.text

    overrides_resp = client.get(f"/access/users/{user_id}/overrides", headers=auth_headers)
    assert overrides_resp.status_code == 200, overrides_resp.text
    overrides = overrides_resp.json()["overrides"]
    assert len(overrides) >= 1
    override_id = int(overrides[0]["id"])

    eff_resp = client.get(f"/access/users/{user_id}/effective-permissions", headers=auth_headers)
    assert eff_resp.status_code == 200, eff_resp.text
    assert isinstance(eff_resp.json().get("permissions"), list)

    sim_user_resp = client.get(f"/access/simulate/user/{user_id}", headers=auth_headers)
    assert sim_user_resp.status_code == 200, sim_user_resp.text
    assert "accessible_routes" in sim_user_resp.json()

    override_delete_resp = client.delete(f"/access/users/{user_id}/overrides/{override_id}", headers=auth_headers)
    assert override_delete_resp.status_code == 200, override_delete_resp.text

    sessions_resp = client.get("/access/sessions", headers=auth_headers)
    assert sessions_resp.status_code == 200, sessions_resp.text
    sessions = sessions_resp.json()
    assert len(sessions) >= 1

    force_logout_user_resp = client.patch(
        f"/access/sessions/force-logout-user/{user_id}",
        json={"reason": "RBAC contract test"},
        headers=auth_headers,
    )
    assert force_logout_user_resp.status_code == 200, force_logout_user_resp.text

    history_resp = client.get("/access/permission-history?limit=200", headers=auth_headers)
    assert history_resp.status_code == 200, history_resp.text
    assert int(history_resp.json().get("total") or 0) >= 1


def test_owner_protection_guards(client, auth_headers):
    roles_resp = client.get("/access/roles", headers=auth_headers)
    assert roles_resp.status_code == 200, roles_resp.text
    owner_role = _role_by_name(roles_resp.json(), "owner")
    assert owner_role

    # Owner role is locked.
    patch_owner_resp = client.patch(
        f"/access/roles/{owner_role['id']}",
        json={"display_name": "Owner Updated"},
        headers=auth_headers,
    )
    assert patch_owner_resp.status_code == 400, patch_owner_resp.text

    delete_owner_resp = client.delete(f"/access/roles/{owner_role['id']}", headers=auth_headers)
    assert delete_owner_resp.status_code == 400, delete_owner_resp.text

    perms_resp = client.get("/access/permissions", headers=auth_headers)
    assert perms_resp.status_code == 200, perms_resp.text
    perm_by_key = {str(row["permission_key"]): row for row in perms_resp.json()["permissions"]}
    any_perm_id = int(perm_by_key["pos.view"]["id"])
    revoke_owner_perm_resp = client.put(
        f"/access/roles/{owner_role['id']}/permissions",
        json={
            "changes": [{"permission_id": any_perm_id, "allowed": False}],
            "reason": "Attempt owner revoke",
            "confirm_sensitive": True,
        },
        headers=auth_headers,
    )
    assert revoke_owner_perm_resp.status_code == 400, revoke_owner_perm_resp.text

    # Last owner user cannot be deactivated.
    employees_resp = client.get("/settings/employees", headers=auth_headers)
    assert employees_resp.status_code == 200, employees_resp.text
    owners = [row for row in employees_resp.json() if "owner" in str(row.get("role") or "").lower()]
    assert len(owners) >= 1
    owner_user_id = int(owners[0]["id"])
    deactivate_owner_resp = client.put(
        f"/settings/employees/{owner_user_id}",
        json={"is_active": False},
        headers=auth_headers,
    )
    assert deactivate_owner_resp.status_code == 400, deactivate_owner_resp.text
