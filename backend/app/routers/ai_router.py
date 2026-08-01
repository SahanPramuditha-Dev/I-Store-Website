from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import get_current_user, require_permission
from app.services.ai_service import (
    generate_ai_response_stream, 
    get_store_context,
    diagnose_repair_ticket,
    forecast_inventory_restock,
    draft_customer_message
)

router = APIRouter(prefix="/api/ai", tags=["AI Integration"])

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]

class DiagnoseRequest(BaseModel):
    device_brand: str
    device_model: str
    issue_description: str

class DraftMessageRequest(BaseModel):
    message_type: str
    customer_name: str
    details: Dict[str, Any]

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

@router.post("/repair-diagnose", dependencies=[Depends(require_permission("repairs.create"))])
def ai_diagnose_repair(
    request: DiagnoseRequest,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """AI diagnosis and price/part estimation for repair tickets."""
    return diagnose_repair_ticket(
        device_brand=request.device_brand,
        device_model=request.device_model,
        issue_description=request.issue_description,
        db=db
    )

@router.get("/inventory-forecast", dependencies=[Depends(require_permission("inventory.view"))])
def ai_inventory_forecast(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """AI restock advice and purchase strategy for low stock inventory."""
    return forecast_inventory_restock(db)

@router.post("/draft-message", dependencies=[Depends(require_permission("customers.view"))])
def ai_draft_message(
    request: DraftMessageRequest,
    current_user = Depends(get_current_user)
):
    """AI-powered SMS/WhatsApp customer notification drafter."""
    return draft_customer_message(
        message_type=request.message_type,
        customer_name=request.customer_name,
        details=request.details
    )
