import logging
import json
import os
from datetime import datetime, date
from typing import Dict, Any, List, Generator
from sqlalchemy.orm import Session
from sqlalchemy import func

try:
    import google.generativeai as genai
    GENAI_AVAILABLE = True
except ImportError:
    genai = None
    GENAI_AVAILABLE = False

from app.config import settings
from app.models import Sale, InventoryItem, Customer, RepairTicket

# Gemini AI Service - Live store integration with auto model fallback
logger = logging.getLogger("istore.ai_service")

def init_gemini():
    if not GENAI_AVAILABLE:
        logger.warning("google-generativeai package is not installed.")
        return False
    api_key = settings.gemini_api_key or os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        logger.warning("GEMINI_API_KEY is not set.")
        return False
    genai.configure(api_key=api_key, transport="rest")
    return True

def get_store_context(db: Session) -> Dict[str, Any]:
    """Fetches real-time store snapshot metrics to inject into Gemini system prompt."""
    today_start = datetime.combine(date.today(), datetime.min.time())
    
    # 1. Sales today
    sales_query = db.query(
        func.coalesce(func.sum(Sale.total), 0.0).label("total_sales"),
        func.count(Sale.id).label("total_orders")
    ).filter(Sale.created_at >= today_start, Sale.is_voided == False).first()
    
    # 2. Low stock count
    low_stock_count = db.query(func.count(InventoryItem.id)).filter(
        InventoryItem.is_deleted == False,
        InventoryItem.quantity <= InventoryItem.low_stock_threshold
    ).scalar() or 0

    # 3. Active / Pending repairs count
    active_repairs_count = db.query(func.count(RepairTicket.id)).filter(
        RepairTicket.is_deleted == False,
        RepairTicket.status.notin_(["completed", "delivered", "cancelled"])
    ).scalar() or 0

    # 4. Total Unpaid Customer Balances
    unpaid_sales = db.query(Sale).filter(
        Sale.is_voided == False,
        Sale.balance_due > 0,
        Sale.customer_id.isnot(None)
    ).all()
    total_unpaid = sum(float(s.balance_due) for s in unpaid_sales)

    return {
        "date": date.today().isoformat(),
        "today_sales_amount": float(sales_query.total_sales or 0.0),
        "today_order_count": int(sales_query.total_orders or 0),
        "low_stock_items_count": low_stock_count,
        "active_repairs_count": active_repairs_count,
        "total_unpaid_customer_balance": total_unpaid
    }

# Ordered fallback chain — official stable models (from ai.google.dev/gemini-api/docs/models)
# gemini-2.0-flash and gemini-2.0-flash-lite are SHUT DOWN per official docs
MODEL_FALLBACK_CHAIN = [
    "gemini-3.5-flash-lite",  # Stable ✓ - fastest/cheapest 3.5
    "gemini-3.1-flash-lite",  # Stable ✓ - fallback
    "gemini-3.6-flash",       # Stable ✓ - most capable fallback
]

def _is_quota_error(e: Exception) -> bool:
    """Returns True if the exception is a 429 quota/rate-limit error."""
    msg = str(e).lower()
    return "429" in msg or "quota" in msg or "rate" in msg or "resource_exhausted" in msg

def _is_model_error(e: Exception) -> bool:
    """Returns True if the model is unavailable/not found — should try next model."""
    msg = str(e).lower()
    return ("404" in msg and "not found" in msg) or "not supported" in msg

def _try_model(model_name: str, gemini_contents: list) -> Generator[str, None, None]:
    """Attempt to stream a response from a specific model.
    If streaming is unsupported (400), retries without streaming and yields full text."""
    model = genai.GenerativeModel(model_name)
    try:
        response = model.generate_content(gemini_contents, stream=True)
        for chunk in response:
            if chunk.text:
                yield chunk.text
    except Exception as e:
        msg = str(e).lower()
        # If the model doesn't support streaming, retry without it
        if "stream=false" in msg or ("400" in msg and "stream" in msg):
            logger.warning(f"Model {model_name} doesn't support streaming, retrying without stream.")
            response = model.generate_content(gemini_contents, stream=False)
            if response.text:
                yield response.text
        else:
            raise  # Re-raise for the caller to handle (quota/model errors)

def generate_ai_response_stream(messages: List[Dict[str, str]], db: Session) -> Generator[str, None, None]:
    """Generates streaming text response from Gemini API using conversation history and live store context.
    Automatically falls back through the model chain if quota is exceeded on any model."""
    api_key = settings.gemini_api_key or os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        yield "Gemini API Key is not configured on the server. Please add `GEMINI_API_KEY` to `.env`."
        return

    try:
        if not init_gemini():
            yield "Failed to initialize Gemini client. Check server logs."
            return

        context = get_store_context(db)
        system_instruction = f"""
You are the AI Assistant for 'I Store', an electronics repair, retail, and inventory management POS system.
Answer store managers concisely, professionally, and accurately.

LIVE STORE SNAPSHOT ({context['date']}):
- Today's Sales Revenue: ${context['today_sales_amount']:.2f} ({context['today_order_count']} orders)
- Low Stock Items Count: {context['low_stock_items_count']}
- Active Repair Tickets: {context['active_repairs_count']}
- Total Outstanding Unpaid Customer Balance: ${context['total_unpaid_customer_balance']:.2f}

Guidelines:
- Use bullet points and clear formatting.
- Be direct and friendly.
- Highlight urgent issues if asked about store health (e.g. low stock, delayed repairs).
"""
        
        # Build prompt history for Gemini
        gemini_contents = []
        gemini_contents.append({"role": "user", "parts": [system_instruction]})
        gemini_contents.append({"role": "model", "parts": ["Understood. I am ready to assist with live I Store metrics and management tasks."]})
        
        for msg in messages:
            role = "user" if msg.get("role") == "user" else "model"
            content = msg.get("content", "")
            if content:
                gemini_contents.append({"role": role, "parts": [content]})
        
        # Build fallback chain: configured model first, then defaults
        configured_model = settings.gemini_model or MODEL_FALLBACK_CHAIN[0]
        chain = [configured_model] + [m for m in MODEL_FALLBACK_CHAIN if m != configured_model]

        last_error = None
        for model_name in chain:
            try:
                logger.info(f"Trying model: {model_name}")
                yielded_anything = False
                for chunk in _try_model(model_name, gemini_contents):
                    yield chunk
                    yielded_anything = True
                if yielded_anything:
                    return  # Success — done
                # Empty response, try next model
                logger.warning(f"Model {model_name} returned empty response, trying next.")
            except Exception as e:
                last_error = e
                if _is_quota_error(e) or _is_model_error(e):
                    reason = "Quota exceeded" if _is_quota_error(e) else "Model unavailable"
                    logger.warning(f"{reason} on {model_name}, trying next model. Error: {e}")
                    continue  # Try next model in chain
                else:
                    # Non-quota, non-model error (auth, network, etc.) — stop immediately
                    logger.error(f"Non-recoverable error on {model_name}: {e}", exc_info=True)
                    yield f"\n[AI Error: {str(e)}]"
                    return

        # All models exhausted
        logger.error(f"All models in fallback chain exhausted. Last error: {last_error}")
        yield "\n[AI unavailable: All model quotas are currently exhausted. Please try again later.]"

    except Exception as e:
        logger.error(f"Error calling Gemini API: {e}", exc_info=True)
        yield f"\n[AI Error: {str(e)}]"
