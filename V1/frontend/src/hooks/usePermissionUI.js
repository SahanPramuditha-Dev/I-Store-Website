import { useMemo } from "react";
import { hasPermission, loadPermissions } from "../lib/rbac";

function describePermission(permissionKey) {
  if (Array.isArray(permissionKey)) return permissionKey.join(", ");
  return String(permissionKey || "permission");
}

export function usePermissionsUI() {
  return useMemo(() => {
    const permissions = loadPermissions();
    const can = (permissionKey) => hasPermission(permissionKey, permissions);
    const guard = (permissionKey, reason = "Your role does not allow this action.") => {
      const allowed = can(permissionKey);
      return {
        allowed,
        denied: !allowed,
        disabled: !allowed,
        reason: allowed ? "" : reason,
        permission: permissionKey,
        label: describePermission(permissionKey),
        buttonProps: allowed ? {} : { disabled: true, title: reason, "aria-disabled": true },
        hiddenProps: allowed ? {} : { hidden: true, "aria-hidden": true },
      };
    };

    return {
      permissions,
      can,
      guard,
    };
  }, []);
}

export function usePermissionUI(permissionKey, reason = "Your role does not allow this action.") {
  const { guard } = usePermissionsUI();
  return useMemo(() => guard(permissionKey, reason), [guard, permissionKey, reason]);
}

export function PermissionGate({ permission, children, fallback = null, mode = "hide" }) {
  const access = usePermissionUI(permission);
  if (access.allowed) return typeof children === "function" ? children(access) : children;
  if (mode === "disable" && typeof children === "function") return children(access);
  return fallback;
}

export default usePermissionUI;
