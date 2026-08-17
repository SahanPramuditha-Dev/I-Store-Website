import logging
import json
import os
import base64
from datetime import datetime, date, timedelta
from typing import Dict, Any, List, Generator, Optional
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
from app.models import Sale, SaleItem, InventoryItem, Customer, RepairTicket, Expense, AppSetting
from app.utils.time import utcnow

# Gemini AI Service - Live store integration with auto model fallback
logger = logging.getLogger("istore.ai_service")

def get_gemini_config(db: Optional[Session] = None) -> tuple[str, str]:
    """Resolves the active Gemini API key and model from DB settings first, falling back to .env."""
    key = ""
    model = ""
    if db:
        try:
            # 1. Check settings_state_v2
            state_row = db.query(AppSetting).filter(AppSetting.key == "settings_state_v2").first()
            if state_row and state_row.value:
                state_data = json.loads(state_row.value)
                ai_conf = state_data.get("system_apis", {}).get("ai_configuration", {})
                key = (ai_conf.get("gemini_api_key") or "").strip()
                model = (ai_conf.get("model") or "").strip()

            # 2. Check standalone gemini_api_key in AppSetting
            if not key:
                key_row = db.query(AppSetting).filter(AppSetting.key == "gemini_api_key").first()
                if key_row and key_row.value:
                    key = key_row.value.strip()
            if not model:
                model_row = db.query(AppSetting).filter(AppSetting.key == "gemini_model").first()
                if model_row and model_row.value:
                    model = model_row.value.strip()
        except Exception as e:
            logger.debug(f"Error loading Gemini config from DB: {e}")

    if not key:
        key = (settings.gemini_api_key or os.getenv("GEMINI_API_KEY", "")).strip()
    if not model:
        model = (settings.gemini_model or os.getenv("GEMINI_MODEL", "")).strip()

    return key, model or "gemini-2.5-flash"

def init_gemini(db: Optional[Session] = None) -> bool:
    if not GENAI_AVAILABLE:
        logger.warning("google-generativeai package is not installed.")
        return False
    try:
        import certifi
        os.environ.setdefault("SSL_CERT_FILE", certifi.where())
        os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
        os.environ.setdefault("GRPC_DEFAULT_SSL_ROOTS_FILE_PATH", certifi.where())
    except Exception:
        pass

    api_key, _ = get_gemini_config(db)
    if not api_key:
        logger.warning("GEMINI_API_KEY is not set.")
        return False
    genai.configure(api_key=api_key, transport="rest")
    return True

def get_store_context(db: Session, user_role: str = "admin", user_name: str = "Manager") -> Dict[str, Any]:
    """Fetches comprehensive store snapshot metrics to inject into Gemini system prompt."""
    now = utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start = today_start - timedelta(days=1)
    week_start = today_start - timedelta(days=7)
    
    # 1. Sales today (matching dashboard filters)
    sales_query = db.query(
        func.coalesce(func.sum(Sale.total), 0.0).label("total_sales"),
        func.count(Sale.id).label("total_orders")
    ).filter(
        Sale.created_at >= today_start,
        Sale.is_voided == False,
        Sale.is_return == False
    ).first()
    
    # 2. Today's Gross Profit and Margin % Estimation
    profit_data = db.query(
        func.coalesce(func.sum(SaleItem.quantity * SaleItem.price), 0.0).label("revenue"),
        func.coalesce(func.sum(SaleItem.quantity * func.coalesce(SaleItem.cost_price, 0.0)), 0.0).label("cogs")
    ).join(Sale, Sale.id == SaleItem.sale_id).filter(
        Sale.created_at >= today_start,
        Sale.is_voided == False,
        Sale.is_return == False
    ).first()
    
    today_revenue = float(profit_data.revenue or sales_query.total_sales or 0.0)
    today_cogs = float(profit_data.cogs or 0.0)
    today_gross_profit = max(0.0, today_revenue - today_cogs)
    today_margin_pct = (today_gross_profit / today_revenue * 100.0) if today_revenue > 0 else 0.0

    # 3. Yesterday's Comparison
    yesterday_sales = db.query(
        func.coalesce(func.sum(Sale.total), 0.0)
    ).filter(
        Sale.created_at >= yesterday_start,
        Sale.created_at < today_start,
        Sale.is_voided == False,
        Sale.is_return == False
    ).scalar() or 0.0

    # 4. Low stock count and top critical items
    low_stock_query = db.query(InventoryItem).filter(
        InventoryItem.is_deleted == False,
        InventoryItem.quantity <= InventoryItem.low_stock_threshold
    ).order_by(InventoryItem.quantity.asc())
    
    low_stock_count = low_stock_query.count()
    critical_items = low_stock_query.limit(5).all()
    critical_items_summary = [
        f"{item.name} (SKU: {item.sku}, Stock: {item.quantity}, Min: {item.low_stock_threshold})"
        for item in critical_items
    ]

    # 5. Dead stock calculation (items with no movement in 60+ days)
    dead_stock_threshold = today_start - timedelta(days=60)
    dead_stock_items = db.query(InventoryItem).filter(
        InventoryItem.is_deleted == False,
        InventoryItem.quantity > 0,
        InventoryItem.created_at < dead_stock_threshold
    ).all()
    dead_stock_count = len(dead_stock_items)
    dead_stock_value = sum(float(i.quantity * (i.cost_price or 0.0)) for i in dead_stock_items)

    # 6. Active / Pending repairs breakdown
    active_repairs = db.query(RepairTicket).filter(
        RepairTicket.is_deleted == False,
        RepairTicket.status.notin_(["completed", "delivered", "cancelled"])
    ).all()
    
    active_repairs_count = len(active_repairs)
    pending_repairs = sum(1 for r in active_repairs if r.status in ["received", "pending", "diagnosing"])
    in_progress_repairs = sum(1 for r in active_repairs if r.status in ["in_progress", "awaiting_parts"])
    ready_repairs = sum(1 for r in active_repairs if r.status in ["ready_for_pickup", "ready", "tested"])

    # 7. Total Unpaid Customer Balances (Receivables)
    unpaid_sales = db.query(Sale).filter(
        Sale.is_voided == False,
        Sale.is_return == False,
        Sale.balance_due > 0,
        Sale.customer_id.isnot(None)
    ).all()
    total_unpaid = sum(float(s.balance_due) for s in unpaid_sales)

    # 8. Expenses today
    today_expenses = db.query(
        func.coalesce(func.sum(Expense.amount), 0.0)
    ).filter(
        Expense.is_deleted == False,
        Expense.expense_date >= today_start
    ).scalar() or 0.0

    # 9. Operational Anomalies / Risk Flags today
    voided_sales_today = db.query(func.count(Sale.id)).filter(
        Sale.created_at >= today_start,
        Sale.is_voided == True
    ).scalar() or 0

    return {
        "date": now.strftime("%B %d, %Y"),
        "currency": "LKR",
        "user_role": user_role,
        "user_name": user_name,
        "today_sales_amount": float(sales_query.total_sales or 0.0),
        "today_order_count": int(sales_query.total_orders or 0),
        "today_gross_profit": float(today_gross_profit),
        "today_margin_pct": float(today_margin_pct),
        "yesterday_sales_amount": float(yesterday_sales),
        "today_expenses_amount": float(today_expenses),
        "low_stock_items_count": low_stock_count,
        "critical_low_stock_items": critical_items_summary,
        "dead_stock_count": dead_stock_count,
        "dead_stock_value": float(dead_stock_value),
        "active_repairs_count": active_repairs_count,
        "pending_repairs_count": pending_repairs,
        "in_progress_repairs_count": in_progress_repairs,
        "ready_repairs_count": ready_repairs,
        "total_unpaid_customer_balance": total_unpaid,
        "voided_sales_today": int(voided_sales_today)
    }

# Ordered fallback chain — prioritized by highest daily quota (500 RPD & 15 RPM)
MODEL_FALLBACK_CHAIN = [
    "gemini-3.5-flash-lite",     # 15 RPM / 500 RPD (Highest capacity)
    "gemini-3.1-flash-lite",     # 15 RPM / 500 RPD (High capacity secondary)
    "gemini-flash-lite-latest",  # High-speed alias
    "gemini-flash-latest",       # Standard flash alias
    "gemini-3.5-flash",          # 5 RPM / 20 RPD
    "gemini-3.7-flash",          # 5 RPM / 20 RPD
    "gemini-3.6-flash",          # 5 RPM / 20 RPD
]

def _is_quota_error(e: Exception) -> bool:
    """Returns True if the exception is a 429 quota/rate-limit error."""
    msg = str(e).lower()
    return "429" in msg or "quota" in msg or "rate limit" in msg or "rate_limit" in msg or "resource_exhausted" in msg

def _is_model_error(e: Exception) -> bool:
    """Returns True if the model is unavailable/not found — should try next model."""
    msg = str(e).lower()
    return ("404" in msg and "not found" in msg) or "not supported" in msg

def _try_model(model_name: str, gemini_contents: list) -> Generator[str, None, None]:
    """Attempt to stream a response from a specific model."""
    model = genai.GenerativeModel(model_name)
    try:
        response = model.generate_content(gemini_contents, stream=True)
        for chunk in response:
            if chunk.text:
                yield chunk.text
    except Exception as e:
        msg = str(e).lower()
        if "stream=false" in msg or ("400" in msg and "stream" in msg):
            logger.warning(f"Model {model_name} doesn't support streaming, retrying without stream.")
            response = model.generate_content(gemini_contents, stream=False)
            if response.text:
                yield response.text
        else:
            raise

def generate_ai_response_stream(
    messages: List[Dict[str, Any]], 
    db: Session,
    user_role: str = "admin",
    user_name: str = "Manager"
) -> Generator[str, None, None]:
    """Generates streaming text response from Gemini API with live store context, role personalization, and multimodal vision support."""
    api_key, active_model = get_gemini_config(db)
    if not api_key:
        yield "Gemini API Key is not configured. Please add your key under Settings → System & APIs → Gemini AI Integration or via `GEMINI_API_KEY`."
        return

    try:
        if not init_gemini(db):
            yield "Failed to initialize Gemini client. Check server logs."
            return

        context = get_store_context(db, user_role=user_role, user_name=user_name)
        critical_items_str = "\n".join([f"  • {item}" for item in context['critical_low_stock_items']]) or "  • None (Stock levels healthy)"

        comparison_note = f"vs Yesterday (LKR {context['yesterday_sales_amount']:,.2f})" if context['yesterday_sales_amount'] > 0 else "First day of period tracking"

        system_instruction = f"""
You are 'E Store AI' — the proactive AI business copilot for E Store (Electronics Retail, Repair Center, and POS ERP).
Current User: {context['user_name']} (Role: {context['user_role'].upper()})

LIVE STORE SNAPSHOT ({context['date']}):
- Sales Revenue Today: LKR {context['today_sales_amount']:,.2f} ({context['today_order_count']} orders) | {comparison_note}
- Estimated Gross Profit: LKR {context['today_gross_profit']:,.2f} (Estimated Margin: {context['today_margin_pct']:.1f}%)
- Today's Store Expenses: LKR {context['today_expenses_amount']:,.2f}
- Outstanding Customer Debt (Receivables): LKR {context['total_unpaid_customer_balance']:,.2f}
- Low Stock Items: {context['low_stock_items_count']} item(s) below threshold
  Critical Items:
{critical_items_str}
- Dead Stock: {context['dead_stock_count']} item(s) with no movement in 60+ days (Tied-up Capital: LKR {context['dead_stock_value']:,.2f})
- Active Repairs: {context['active_repairs_count']} total ({context['pending_repairs_count']} pending/diagnosing, {context['in_progress_repairs_count']} in progress/parts, {context['ready_repairs_count']} ready for pickup)
- Voided Sales Today: {context['voided_sales_today']} void(s)

Role Tailoring:
- Admin/Owner: Emphasize net margins, expenses, receivables recovery, and dead stock capital release.
- Technician: Emphasize diagnosis procedures, ticket queue turnaround, and spare parts availability.
- Cashier: Emphasize quick POS operations, register status, and pending walk-ins.

Formatting Guidelines:
- Currency is always 'LKR X,XXX.XX'.
- Use bold headers, clean bullets, and concise actionable recommendations.
- When referencing actions, include actionable prompts (e.g. 'Navigate to /inventory to reorder', 'Review tickets at /repairs').
"""
        
        # Build prompt history for Gemini with Multimodal Image Support
        gemini_contents = []
        gemini_contents.append({"role": "user", "parts": [system_instruction]})
        gemini_contents.append({"role": "model", "parts": ["Understood. I am ready to assist with live store operations, diagnostics, and metrics."]})
        
        for msg in messages:
            role = "user" if msg.get("role") == "user" else "model"
            content = msg.get("content", "")
            image_b64 = msg.get("image_base64")
            
            parts = []
            if content:
                parts.append(content)
            
            # Handle attached image for Multimodal Vision (damage diagnosis, invoice OCR)
            if image_b64 and isinstance(image_b64, str):
                try:
                    clean_b64 = image_b64.split(",")[-1]
                    img_bytes = base64.b64decode(clean_b64)
                    mime = "image/png" if "data:image/png" in image_b64 else "image/jpeg"
                    parts.append({"mime_type": mime, "data": img_bytes})
                except Exception as img_err:
                    logger.warning(f"Failed to process attached image: {img_err}")
            
            if parts:
                gemini_contents.append({"role": role, "parts": parts})
        
        # Build fallback chain: configured model first, then defaults
        configured_model = active_model or MODEL_FALLBACK_CHAIN[0]
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
                    return
                logger.warning(f"Model {model_name} returned empty response, trying next.")
            except Exception as e:
                last_error = e
                if _is_quota_error(e) or _is_model_error(e):
                    reason = "Quota exceeded" if _is_quota_error(e) else "Model unavailable"
                    logger.warning(f"{reason} on {model_name}, trying next model. Error: {e}")
                    continue
                else:
                    logger.error(f"Non-recoverable error on {model_name}: {e}", exc_info=True)
                    yield f"\n[AI Error: {str(e)}]"
                    return

        logger.error(f"All models in fallback chain exhausted. Last error: {last_error}")
        yield "\n[AI unavailable: All model quotas are currently exhausted. Please try again later.]"

    except Exception as e:
        logger.error(f"Error calling Gemini API: {e}", exc_info=True)
        yield f"\n[AI Error: {str(e)}]"

def _generate_single_prompt(prompt: str, db: Optional[Session] = None) -> str:
    """Helper to run a prompt through the model fallback chain synchronously."""
    if not init_gemini(db):
        raise Exception("Gemini API is not configured or initialized.")
        
    _, active_model = get_gemini_config(db)
    configured_model = active_model or MODEL_FALLBACK_CHAIN[0]
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
            
    raise Exception(f"All models failed. Last error: {last_err}")

def diagnose_repair_ticket(device_brand: str, device_model: str, issue_description: str, db: Session) -> Dict[str, Any]:
    """Uses AI to diagnose device issues, recommend parts from inventory, and estimate labor cost."""
    # Fetch available parts from inventory for context
    parts = db.query(InventoryItem).filter(
        InventoryItem.is_deleted == False,
        InventoryItem.quantity > 0
    ).limit(50).all()
    
    parts_list = [f"- {p.name} (SKU: {p.sku}, Stock: {p.quantity}, Price: LKR {getattr(p, 'sale_price', 0) or getattr(p, 'price', 0)})" for p in parts]
    parts_str = "\n".join(parts_list) if parts_list else "No active inventory loaded."
    
    prompt = f"""
You are an expert electronics repair technician at 'E Store'.
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
    try:
        raw_response = _generate_single_prompt(prompt, db=db)
        clean_json = raw_response.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        return json.loads(clean_json)
    except Exception:
        return {
            "probable_cause": f"Issue reported: '{issue_description}' on {device_brand} {device_model}. Likely hardware or component wear.",
            "suggested_action": "Perform standard diagnostic checks, test power rails, inspect display/connectors.",
            "estimated_labor_hours": 1.0,
            "estimated_cost": 2500.00,
            "recommended_parts": [p.name for p in parts[:2]] if parts else [],
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
You are the inventory optimization AI for 'E Store'.
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
    try:
        raw_response = _generate_single_prompt(prompt, db=db)
        clean_json = raw_response.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
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

def draft_customer_message(message_type: str, customer_name: str, details: Dict[str, Any], db: Optional[Session] = None) -> Dict[str, str]:
    """Generates customer-facing SMS/WhatsApp message drafts."""
    prompt = f"""
You are a customer relationship assistant for 'E Store'.
Draft a professional, polite, and clear customer message.

MESSAGE TYPE: {message_type} (e.g., repair_ready, payment_reminder, invoice_receipt)
CUSTOMER NAME: {customer_name}
CONTEXT DETAILS:
{json.dumps(details, indent=2)}

Guidelines:
- Include 'E Store' branding.
- Keep SMS short, clear, and action-oriented.
- Return ONLY JSON format:
{{
  "sms": "Short message text",
  "whatsapp": "Formatted WhatsApp text with linebreaks and emojis"
}}
"""
    try:
        raw_response = _generate_single_prompt(prompt, db=db)
        clean_json = raw_response.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        return json.loads(clean_json)
    except Exception:
        return {
            "sms": f"Hello {customer_name}, updates regarding your {message_type.replace('_', ' ')} are ready at E Store.",
            "whatsapp": f"Hello *{customer_name}*,\n\nUpdates regarding your *{message_type.replace('_', ' ')}* are ready.\n\nThank you for choosing *E Store*!"
        }
