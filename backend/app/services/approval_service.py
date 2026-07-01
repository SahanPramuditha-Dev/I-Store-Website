import json

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import ApprovalRequest, User
from app.services.domain_audit_service import record_domain_audit
from app.utils.time import utcnow


def _payload_matches(payload: dict, expected: dict | None) -> bool:
    if not expected:
        return True
    for key, value in expected.items():
        if value is None:
            continue
        if str(payload.get(key)) != str(value):
            return False
    return True


def consume_approval_request(
    db: Session,
    *,
    request_code: str | None,
    module: str,
    action: str,
    target_type: str,
    target_id: int | None,
    user: User | None,
    permission: str,
    expected_payload: dict | None = None,
    reason: str | None = None,
) -> ApprovalRequest:
    code = str(request_code or "").strip()
    if not code:
        raise HTTPException(
            status_code=403,
            detail="An approved approval request code is required for this sensitive action.",
        )

    row = db.query(ApprovalRequest).filter(ApprovalRequest.request_code == code).first()
    if not row:
        raise HTTPException(status_code=404, detail="Approval request not found")
    if str(row.status or "").lower() != "approved":
        raise HTTPException(status_code=409, detail=f"Approval request is {row.status}; expected approved")
    if str(row.module or "") != str(module):
        raise HTTPException(status_code=400, detail="Approval request module does not match this action")
    if str(row.action or "") != str(action):
        raise HTTPException(status_code=400, detail="Approval request action does not match this action")
    if str(row.target_type or "") != str(target_type):
        raise HTTPException(status_code=400, detail="Approval request target type does not match this action")
    if row.target_id is not None and target_id is not None and int(row.target_id) != int(target_id):
        raise HTTPException(status_code=400, detail="Approval request target does not match this action")

    payload = {}
    if row.payload_json:
        try:
            loaded = json.loads(row.payload_json)
            payload = loaded if isinstance(loaded, dict) else {}
        except Exception:
            payload = {}
    if not _payload_matches(payload, expected_payload):
        raise HTTPException(status_code=400, detail="Approval request payload does not match this action")

    row.status = "executed"
    row.executed_by_user_id = user.id if user else None
    row.executed_at = utcnow()
    record_domain_audit(
        db,
        module="financial_audit",
        action="approval_consumed",
        target_type="ApprovalRequest",
        target_id=row.id,
        user=user,
        old_value={"status": "approved"},
        new_value={
            "status": "executed",
            "request_code": row.request_code,
            "module": row.module,
            "action": row.action,
            "target_type": row.target_type,
            "target_id": row.target_id,
        },
        reason=reason or row.reason,
        permission=permission,
    )
    return row
