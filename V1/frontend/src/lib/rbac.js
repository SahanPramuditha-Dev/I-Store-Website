const ROUTE_PERMISSION_MAP = [
  { prefix: "/dashboard", permission: "dashboard.view" },
  { prefix: "/search", permission: "search.view" },
  { prefix: "/repairs", permission: "repairs.view" },
  { prefix: "/reservations", permission: "reservation.view" },
  { prefix: "/inventory", permission: "inventory.view" },
  { prefix: "/purchase", permission: "purchasing.view" },
  { prefix: "/expenses", permission: "expenses.view" },
  { prefix: "/pos", permission: "pos.view" },
  { prefix: "/customers", permission: "customers.view" },
  { prefix: "/warranty", permission: "warranty.view" },
  { prefix: "/returns", permission: "returns.view" },
  { prefix: "/advances", permission: "advance.view" },
  { prefix: "/reports", permission: "reports.view" },
  { prefix: "/barcodes", permission: "labels.view" },
  { prefix: "/print-center", permission: ["settings.view", "pos.print", "pos.reprint", "returns.print", "warranty.print", "repairs.print_job_card", "labels.print", "advance.view"] },
  { prefix: "/backup", permission: "backup.view" },
  { prefix: "/settings", permission: "settings.view" },
  { prefix: "/notifications", permission: "notifications.view" },
  { prefix: "/permissions", permission: "access.view" },
  { prefix: "/audit", permission: "audit.view" },
  { prefix: "/financials", permission: "reports.financial" },
];

export const AUTH_STORAGE_KEYS = ["token", "username", "permissions", "session_id", "login_role", "login_role_label"];
const SESSION_AUTH_KEYS = ["token", "session_id", "permissions"];

function uniqueStrings(values) {
  return [...new Set((values || []).map((v) => String(v || "").trim()).filter(Boolean))];
}

export function getRoutePermission(pathname) {
  const path = String(pathname || "");
  const match = ROUTE_PERMISSION_MAP.find((row) => path.startsWith(row.prefix));
  return match?.permission || null;
}

export function clearAuthState() {
  AUTH_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  SESSION_AUTH_KEYS.forEach((key) => sessionStorage.removeItem(key));
}

export function getAuthValue(key) {
  return sessionStorage.getItem(key) || localStorage.getItem(key);
}

export function setSessionAuthValue(key, value) {
  sessionStorage.setItem(key, value);
  localStorage.removeItem(key);
}

export function loadPermissions() {
  try {
    const raw = getAuthValue("permissions");
    const parsed = raw ? JSON.parse(raw) : [];
    return uniqueStrings(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

export function savePermissions(permissions) {
  const clean = uniqueStrings(Array.isArray(permissions) ? permissions : []);
  setSessionAuthValue("permissions", JSON.stringify(clean));
  return clean;
}

export async function bootstrapPermissions(apiClient) {
  const token = getAuthValue("token");
  if (!token) return [];

  let permissions = loadPermissions();
  if (permissions.length > 0) return permissions;

  if (!apiClient) return [];
  const res = await apiClient.get("/auth/me/permissions");
  permissions = savePermissions(res?.data?.permissions || []);
  return permissions;
}

export function hasPermission(permission, permissions = null) {
  if (!permission) return true;
  if (Array.isArray(permission)) {
    return permission.some((item) => hasPermission(item, permissions));
  }
  const list = Array.isArray(permissions) ? uniqueStrings(permissions) : loadPermissions();
  if (!Array.isArray(list) || list.length === 0) return false;
  if (list.includes("*")) return true;
  if (list.includes(permission)) return true;

  const [module] = String(permission).split(".");
  if (module && (list.includes(`${module}.*`) || list.includes(`${module}.all`))) {
    return true;
  }

  return false;
}

export function canAccessPath(pathname, permissions = null) {
  const required = getRoutePermission(pathname);
  return hasPermission(required, permissions);
}

export const NAV_PERMISSION_MAP = {
  "/dashboard": "dashboard.view",
  "/search": "search.view",
  "/repairs": "repairs.view",
  "/reservations": "reservation.view",
  "/warranty": "warranty.view",
  "/returns": "returns.view",
  "/advances": "advance.view",
  "/inventory/products": "inventory.view",
  "/purchase": "purchasing.view",
  "/expenses": "expenses.view",
  "/pos": "pos.view",
  "/customers": "customers.view",
  "/reports": "reports.view",
  "/financials": "reports.financial",
  "/barcodes": "labels.view",
  "/print-center": ["settings.view", "pos.print", "pos.reprint", "returns.print", "warranty.print", "repairs.print_job_card", "labels.print", "advance.view"],
  "/audit": "audit.view",
  "/backup": "backup.view",
  "/settings": "settings.view",
  "/notifications": "notifications.view",
  "/permissions": "access.view",
};
