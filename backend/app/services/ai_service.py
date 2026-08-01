import logging
import json
import os
from datetime import datetime, date
from typing import Dict, Any, List, Generator
from sqlalchemy.orm import Session
from sqlalchemy import func

import warnings
try:
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=FutureWarning, module="google.generativeai")
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

def _generate_single_prompt(prompt: str) -> str:
    """Helper to run a prompt through the model fallback chain synchronously."""
    if not init_gemini():
        raise Exception("Gemini API is not configured or initialized.")
        
    configured_model = settings.gemini_model or MODEL_FALLBACK_CHAIN[0]
    chain = [configured_model] + [m for m in MODEL_FALLBACK_CHAIN if m != configured_model]
    
    contents = [{"role": "user", "parts": [prompt]}]
    last_err = None
    
    for model_name in chain:
        try:
            model = genai.GenerativeModel(model_name)
            res = model.generate_content(contents, stream=False)
            if res and res.text:
                return res.text
        except Exception as e:
            last_err = e
            if _is_quota_error(e) or _is_model_error(e):
                continue
            raise e
            
    raise Exception(f"All models failed. Last error: {last_err}")

def diagnose_repair_ticket(device_brand: str, device_model: str, issue_description: str, db: Session) -> Dict[str, Any]:
    """Uses AI to diagnose device issues, recommend parts from inventory, and estimate labor cost."""
    # Fetch available parts from inventory for context
    parts = db.query(InventoryItem).filter(
        InventoryItem.is_deleted == False,
        InventoryItem.quantity > 0
    ).limit(50).all()
    
    parts_list = [f"- {p.name} (SKU: {p.sku}, Stock: {p.quantity}, Price: ${p.selling_price})" for p in parts]
    parts_str = "\n".join(parts_list) if parts_list else "No active inventory loaded."
    
    prompt = f"""
You are an expert electronics repair technician at 'I Store'.
Diagnose the following repair ticket and output ONLY valid JSON without markdown codeblock wrappers.

DEVICE: {device_brand} {device_model}
ISSUE REPORTED: {issue_description}

AVAILABLE IN-STORE PARTS INVENTORY:
{parts_str}

REQUIRED JSON OUTPUT FORMAT:
{{
  "probable_cause": "Detailed explanation of the likely fault",
  "suggested_action": "Recommended repair procedure",
  "estimated_labor_hours": 1.5,
  "estimated_cost": 85.00,
  "recommended_parts": ["Part name from inventory if applicable"],
  "urgency": "High | Medium | Low"
}}
"""
    raw_response = _generate_single_prompt(prompt)
    clean_json = raw_response.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        return json.loads(clean_json)
    except Exception:
        return {
            "probable_cause": raw_response,
            "suggested_action": "Manual inspection required",
            "estimated_labor_hours": 1.0,
            "estimated_cost": 50.00,
            "recommended_parts": [],
            "urgency": "Medium"
        }

def forecast_inventory_restock(db: Session) -> Dict[str, Any]:
    """Analyzes low stock items and generates an AI restock strategy."""
    low_stock = db.query(InventoryItem).filter(
        InventoryItem.is_deleted == False,
        InventoryItem.quantity <= InventoryItem.low_stock_threshold
    ).all()
    
    items_data = [
        {
            "name": item.name,
            "sku": item.sku,
            "current_stock": item.quantity,
            "threshold": item.low_stock_threshold,
            "cost": float(item.cost_price or 0),
            "supplier": item.supplier or "Unknown"
        }
        for item in low_stock
    ]
    
    prompt = f"""
You are the inventory optimization AI for 'I Store'.
Review these low stock inventory items and create an actionable restock plan.
Return ONLY valid JSON without markdown formatting.

ITEMS BELOW THRESHOLD:
{json.dumps(items_data, indent=2)}

REQUIRED JSON OUTPUT FORMAT:
{{
  "summary": "Brief executive summary of inventory status",
  "total_estimated_restock_cost": 450.00,
  "action_items": [
    {{
      "item_name": "Name",
      "sku": "SKU",
      "suggested_order_qty": 10,
      "estimated_cost": 150.00,
      "priority": "Critical | High | Medium",
      "reason": "Explanation for suggestion"
    }}
  ]
}}
"""
    raw_response = _generate_single_prompt(prompt)
    clean_json = raw_response.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        return json.loads(clean_json)
    except Exception:
        return {
            "summary": "Low stock items detected requiring reorder.",
            "total_estimated_restock_cost": sum(item["cost"] * 10 for item in items_data),
            "action_items": [
                {
                    "item_name": item["name"],
                    "sku": item["sku"],
                    "suggested_order_qty": max(5, item["threshold"] * 2 - item["current_stock"]),
                    "estimated_cost": item["cost"] * 10,
                    "priority": "High" if item["current_stock"] == 0 else "Medium",
                    "reason": "Stock below safety threshold"
                }
                for item in items_data
            ]
        }

def draft_customer_message(message_type: str, customer_name: str, details: Dict[str, Any]) -> Dict[str, str]:
    """Generates customer-facing SMS/WhatsApp message drafts."""
    prompt = f"""
You are a customer relationship assistant for 'I Store'.
Draft a professional, polite, and clear customer message.

MESSAGE TYPE: {message_type} (e.g., repair_ready, payment_reminder, invoice_receipt)
CUSTOMER NAME: {customer_name}
CONTEXT DETAILS:
{json.dumps(details, indent=2)}

Guidelines:
- Include 'I Store' branding.
- Keep SMS short, clear, and action-oriented.
- Return ONLY JSON format:
{{
  "sms_draft": "Short SMS version under 160 chars",
  "whatsapp_draft": "Formatted WhatsApp/Email version with emojis and line breaks"
}}
"""
    raw_response = _generate_single_prompt(prompt)
    clean_json = raw_response.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        return json.loads(clean_json)
    except Exception:
        return {
            "sms_draft": f"Hello {customer_name}, update regarding your service at I Store. Please contact us for details.",
            "whatsapp_draft": f"Hello {customer_name},\n\nThis is a notification from I Store regarding your account/service.\n\nThank you for choosing I Store!"
        }
