from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import get_current_user, require_permission
from app.services.ai_service import generate_ai_response_stream, get_store_context

router = APIRouter(prefix="/api/ai", tags=["AI Integration"])

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]

@router.post("/chat", dependencies=[Depends(require_permission("reports.view"))])
def ai_chat_endpoint(
    request: ChatRequest,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Streaming endpoint for Gemini AI chat assistant."""
    messages_dict = [{"role": msg.role, "content": msg.content} for msg in request.messages]
    
    return StreamingResponse(
        generate_ai_response_stream(messages_dict, db),
        media_type="text/plain"
    )

@router.get("/context", dependencies=[Depends(require_permission("reports.view"))])
def get_ai_store_context(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Returns current store metrics context snapshot."""
    return get_store_context(db)
