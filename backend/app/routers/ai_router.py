from typing import List, Dict, Any, Optional
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
    draft_customer_message,
    forecast_financial_trends,
    analyze_repair_sla_risks
)

router = APIRouter(prefix="/api/ai", tags=["AI Integration"])

class ChatMessage(BaseModel):
    role: str
    content: str
    image_base64: Optional[str] = None

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    user_role: Optional[str] = None
    user_name: Optional[str] = None

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
    """Streaming endpoint for Gemini AI chat assistant with vision & role intelligence."""
    messages_dict = [
        {
            "role": msg.role, 
            "content": msg.content,
            "image_base64": msg.image_base64
        } 
        for msg in request.messages
    ]
    
    user_role = getattr(current_user, "role", request.user_role or "admin")
    user_name = getattr(current_user, "full_name", getattr(current_user, "username", request.user_name or "Manager"))
    
    return StreamingResponse(
        generate_ai_response_stream(messages_dict, db, user_role=user_role, user_name=user_name),
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

class TestKeyRequest(BaseModel):
    api_key: Optional[str] = None
    model: Optional[str] = None

@router.post("/test-key", dependencies=[Depends(require_permission("settings.view"))])
def test_gemini_key(
    request: TestKeyRequest,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Tests if the provided Gemini API key or saved key can successfully reach Gemini API."""
    import warnings
    try:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=FutureWarning, module="google.generativeai")
            import google.generativeai as genai
    except ImportError:
        raise HTTPException(status_code=500, detail="google-generativeai package not installed")

    from app.services.ai_service import get_gemini_config
    db_key, db_model = get_gemini_config(db)
    test_key = (request.api_key or "").strip() or db_key
    test_model = (request.model or "").strip() or db_model or "gemini-2.5-flash"

    if not test_key:
        raise HTTPException(status_code=400, detail="No Gemini API Key provided or found in settings")

    try:
        import certifi
        import os
        os.environ.setdefault("SSL_CERT_FILE", certifi.where())
        os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
        os.environ.setdefault("GRPC_DEFAULT_SSL_ROOTS_FILE_PATH", certifi.where())
    except Exception:
        pass

    try:
        genai.configure(api_key=test_key, transport="rest")
        model = genai.GenerativeModel(test_model)
        res = model.generate_content("Ping! Reply with 'PONG' only.", stream=False)
        return {
            "success": True,
            "model": test_model,
            "message": "Gemini API connection successful!",
            "response": res.text.strip() if res and res.text else "OK"
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Gemini API test failed: {str(e)}")

@router.post("/draft-message", dependencies=[Depends(require_permission("customers.view"))])
def ai_draft_message(
    request: DraftMessageRequest,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """AI-powered SMS/WhatsApp customer notification drafter."""
    return draft_customer_message(
        message_type=request.message_type,
        customer_name=request.customer_name,
        details=request.details,
        db=db
    )

@router.get("/financial-forecast", dependencies=[Depends(require_permission("reports.view"))])
def ai_financial_forecast(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Predictive CFO analytics: 90-day financial trend projection, margin opportunities & expense savings."""
    return forecast_financial_trends(db=db)

@router.get("/repair-sla-risks", dependencies=[Depends(require_permission("repairs.view"))])
def ai_repair_sla_risks(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Predictive SLA risk analyzer: monitors active tickets, predicts breaches & alerts managers."""
    return analyze_repair_sla_risks(db=db)

