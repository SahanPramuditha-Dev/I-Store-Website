from sqlalchemy.orm import Session
from app.models import Notification

def add_notification(db: Session, type: str, title: str, message: str, entity_type: str = None, entity_id: int = None):
    n = Notification(
        type=type,
        title=title,
        message=message,
        entity_type=entity_type,
        entity_id=entity_id
    )
    db.add(n)
    db.commit()
    return n
