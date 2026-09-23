import { ShieldAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { canAccessPath, loadPermissions, NAV_PERMISSION_MAP } from "../lib/rbac";

export default function AccessDenied() {
  const navigate = useNavigate();
  const permissions = loadPermissions();
  const fallbackPath = Object.keys(NAV_PERMISSION_MAP).find((path) => canAccessPath(path, permissions)) || "/login";

  return (
    <div className="h-full min-h-0 grid place-items-center px-6">
      <div className="w-full max-w-xl rounded-2xl border border-rose-300 bg-rose-50 p-8 text-center shadow-sm dark:border-rose-400/25 dark:bg-rose-500/10">
        <div className="mx-auto mb-4 h-14 w-14 rounded-full border border-rose-300 bg-rose-100 grid place-items-center text-rose-700 dark:border-rose-300/35 dark:bg-rose-400/15 dark:text-rose-100">
          <ShieldAlert size={28} />
        </div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">Access Denied</h1>
        <p className="mt-2 text-sm text-rose-800 dark:text-rose-100/90">
          Your account does not have permission to view this section.
        </p>
        <div className="mt-6">
          <button
            type="button"
            onClick={() => navigate(fallbackPath)}
            className="rounded-xl border border-indigo-300 bg-indigo-100 px-4 py-2 text-sm font-bold text-indigo-800 hover:bg-indigo-200 transition dark:border-indigo-400/40 dark:bg-indigo-500/20 dark:text-indigo-100 dark:hover:bg-indigo-500/30"
          >
            Go To Available Workspace
          </button>
        </div>
      </div>
    </div>
  );
}
