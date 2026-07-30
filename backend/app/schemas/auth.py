from typing import Optional
from pydantic import BaseModel, ConfigDict
from datetime import datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: Optional[datetime] = None
    session_id: Optional[str] = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    full_name: str
    role: str
    role_id: Optional[int] = None
    phone_number: Optional[str] = None
    email: Optional[str] = None
    profile_photo: Optional[str] = None
    is_active: bool = True
