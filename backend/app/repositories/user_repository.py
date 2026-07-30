from typing import List, Optional
from sqlalchemy.orm import Session
from app.models import User


class UserRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, user_id: int) -> Optional[User]:
        return self.db.query(User).filter(User.id == user_id).first()

    def get_by_username(self, username: str) -> Optional[User]:
        return self.db.query(User).filter(User.username.ilike(username.strip())).first()

    def list_active_users(self) -> List[User]:
        return (
            self.db.query(User)
            .filter(User.is_active == True, User.is_deleted == False)  # noqa: E712
            .all()
        )
