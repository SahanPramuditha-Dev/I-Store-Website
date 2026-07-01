import api from "./api";

export function isApprovalRequiredError(error) {
  const status = Number(error?.response?.status || 0);
  const detail = String(error?.response?.data?.detail || error?.userMessage || "").toLowerCase();
  return status === 403 && detail.includes("approval");
}

export async function requestApprovalCode({ approval, confirm, toast, prompt }) {
  const ok = await confirm(
    "Approval Required",
    "This action needs an approved request before it can continue. Create an approval request now?"
  );
  if (!ok) return null;

  const { data } = await api.post("/financial-audit/approvals", {
    module: approval.module,
    action: approval.action,
    target_type: approval.target_type,
    target_id: approval.target_id ?? null,
    reason: approval.reason,
    payload: approval.payload || {},
  });

  const code = data?.request_code || "";
  toast(`Approval request ${code} created. Ask an approver to approve it, then enter the approved code.`, "warning", 9000);
  if (typeof prompt !== "function") return null;
  const entered = await prompt("Approved Request Code", "Enter the approved request code to continue.", {
    defaultValue: code,
    placeholder: "APP-...",
  });
  return String(entered || "").trim() || null;
}

export async function runWithApproval({ execute, approval, confirm, toast, prompt }) {
  try {
    return await execute();
  } catch (error) {
    if (!isApprovalRequiredError(error)) throw error;
    const code = await requestApprovalCode({ approval, confirm, toast, prompt });
    if (!code) {
      toast("Action paused. Run it again after the approval is ready.", "info");
      const cancelled = new Error("Approval flow cancelled");
      cancelled.approvalCancelled = true;
      throw cancelled;
    }
    return execute(code);
  }
}
