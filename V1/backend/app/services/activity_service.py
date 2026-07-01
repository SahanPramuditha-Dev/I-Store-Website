import json
from sqlalchemy.orm import Session
from app.models import ActivityLog
from typing import Any, Optional

def log_activity(
    db: Session,
    user_id: Optional[int],
    action: str,
    entity_type: str,
    entity_id: int,
    description: str,
    old_value: Any = None,
    new_value: Any = None,
    is_reversible: bool = False
):
    log = ActivityLog(
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        description=description,
        old_value=json.dumps(old_value) if old_value else None,
        new_value=json.dumps(new_value) if new_value else None,
        is_reversible=is_reversible
    )
    db.add(log)
    db.commit()
    return log
