"""
whatsapp_router.py
==================
I Store ERP — Enterprise WhatsApp Hub & Automation Router (FastAPI).

Endpoints:
  GET  /api/whatsapp/overview
  POST /api/whatsapp/internal-webhook/ack
  GET  /api/whatsapp/templates
  PUT  /api/whatsapp/templates/{event_type}
  POST /api/whatsapp/templates/{event_type}/reset
  GET  /api/whatsapp/logs
  GET  /api/whatsapp/logs/{log_id}/trace
  POST /api/whatsapp/logs/{log_id}/retry
  GET  /api/whatsapp/queue
  POST /api/whatsapp/queue/{queue_id}/process
  DELETE /api/whatsapp/queue/{queue_id}
  POST /api/whatsapp/send-direct
  GET  /api/whatsapp/check-number/{phone}
  GET  /api/whatsapp/service-status
  GET  /api/whatsapp/diagnostics/run
  POST /api/whatsapp/service/reconnect
"""

import json
import uuid
import httpx
from datetime import datetime, timedelta, date
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, Header, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import desc, func, or_, and_

from app.database import get_db
from app.auth import get_current_user, require_permission
from app.models import (
    WhatsAppTemplate,
    WhatsAppMessageLog,
    WhatsAppQueue,
    Customer,
    User,
    Sale,
    RepairTicket,
    WhatsAppAutomationRule,
    WhatsAppQuickReply,
    WhatsAppBotRule,
    SecuritySetting
)
from app.utils.time import format_iso_utc
from app.utils.whatsapp_helper import (
    DEFAULT_TEMPLATES,
    TEMPLATE_METADATA,
    WHATSAPP_SERVICE_URL,
    WHATSAPP_SERVICE_SECRET,
    normalize_sri_lankan_phone,
    render_template,
    resolve_store_variables,
    whatsapp_provider,
    PipelineTracer,
    dispatch_whatsapp_event,
)

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])


# ─── Schemas ─────────────────────────────────────────────────────────────────

class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    template_body: str
    category: Optional[str] = "sales"
    is_active: bool = True


class DirectMessageRequest(BaseModel):
    phone: str
    message: str
    customer_id: Optional[int] = None
    invoice_no: Optional[str] = None
    repair_no: Optional[str] = None
    category: Optional[str] = "manual"
    media_url: Optional[str] = None


class WebhookAckPayload(BaseModel):
    messageId: str
    ack: str
    ackCode: int
    to: Optional[str] = None
    timestamp: Optional[str] = None


class AutomationRuleUpdate(BaseModel):
    is_enabled: bool
    delay_seconds: Optional[int] = 0
    name: Optional[str] = None
    description: Optional[str] = None


class BulkRuleToggle(BaseModel):
    category: Optional[str] = None
    is_enabled: bool


class QuickReplyCreate(BaseModel):
    shortcut: str
    title: str
    content: str
    category: Optional[str] = "general"


class QuickReplyUpdate(BaseModel):
    shortcut: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None


class BotRuleCreate(BaseModel):
    name: str
    keywords: str
    match_type: Optional[str] = "contains"
    response_body: str
    category: Optional[str] = "custom"
    priority: Optional[int] = 10
    is_active: Optional[bool] = True


class BotRuleUpdate(BaseModel):
    name: Optional[str] = None
    keywords: Optional[str] = None
    match_type: Optional[str] = None
    response_body: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[int] = None
    is_active: Optional[bool] = None


class AwaySettingsUpdate(BaseModel):
    enabled: bool
    text: str
    start_time: str = "09:00"
    end_time: str = "20:00"
    active_days: str = "0,1,2,3,4,5,6"


DEFAULT_AUTOMATION_RULES = [
    {"event_type": "pos_receipt", "name": "POS Checkout Receipt", "category": "sales", "description": "Auto-send digital bill and QR receipt after point-of-sale checkout.", "is_enabled": True},
    {"event_type": "invoice_created", "name": "Commercial Invoice Notice", "category": "sales", "description": "Notify customer with Smart Bill link on commercial invoice creation.", "is_enabled": True},
    {"event_type": "payment_receipt", "name": "Payment Deposit Confirmation", "category": "payments", "description": "Send confirmation when a partial or full payment is received.", "is_enabled": True},
    {"event_type": "payment_reminder", "name": "Overdue Balance Reminder", "category": "payments", "description": "Send automated reminders for outstanding invoice balances.", "is_enabled": True},
    {"event_type": "refund_processed", "name": "Refund Confirmation", "category": "sales", "description": "Notify customer upon product return or cash refund.", "is_enabled": True},
    {"event_type": "repair_intake", "name": "Repair Check-in Ticket", "category": "repairs", "description": "Send job ticket and initial diagnosis link on device check-in.", "is_enabled": True},
    {"event_type": "repair_estimate", "name": "Repair Quotation / Estimate", "category": "repairs", "description": "Send cost estimate when technician finishes diagnostics.", "is_enabled": True},
    {"event_type": "repair_status", "name": "Repair Status Change", "category": "repairs", "description": "Send real-time milestone updates when repair status advances.", "is_enabled": True},
    {"event_type": "repair_completed", "name": "Ready for Pickup Alert", "category": "repairs", "description": "Notify customer when device is repaired and tested for collection.", "is_enabled": True},
    {"event_type": "repair_collected", "name": "Device Handover & Warranty", "category": "repairs", "description": "Send service warranty proof when customer collects repaired device.", "is_enabled": True},
    {"event_type": "warranty_registered", "name": "Warranty Registration", "category": "warranty", "description": "Register serialized hardware warranty with digital coverage certificate.", "is_enabled": True},
    {"event_type": "warranty_expiring", "name": "Warranty Expiry Reminder", "category": "warranty", "description": "Send automatic 7-day prior notice before warranty expires.", "is_enabled": True},
    {"event_type": "customer_welcome", "name": "New Customer Welcome", "category": "customer", "description": "Send welcome message with store hotline when new customer profile is created.", "is_enabled": True},
    {"event_type": "security_alert", "name": "Manager PIN Override Alert", "category": "security", "description": "Send instant security alert to store owner when cashier uses manager PIN.", "is_enabled": True},
    {"event_type": "low_stock_alert", "name": "Low Stock Manager Alert", "category": "inventory", "description": "Notify store management when inventory stock levels drop below reorder threshold.", "is_enabled": True},
    {"event_type": "bot_auto_reply", "name": "Self-Service 2-Way Bot", "category": "chatbot", "description": "Automated self-service menu (Bills, Repairs, Warranty, Store info).", "is_enabled": True},
    {"event_type": "away_message", "name": "After-Hours Away Responder", "category": "chatbot", "description": "Automatic away reply when customers message outside store working hours.", "is_enabled": True},
]

DEFAULT_QUICK_REPLIES = [
    {"shortcut": "/bank", "title": "Bank Account Details", "category": "payments", "content": "🏦 *Bank Transfer Details*\nBank: Commercial Bank PLC\nAccount Name: I-Store Lanka (Pvt) Ltd\nAccount No: 100029384812\nBranch: Colombo 03\n\n_Please send the transfer slip once completed._"},
    {"shortcut": "/hours", "title": "Store Opening Hours", "category": "general", "content": "⏰ *Store Opening Hours*\n• Monday – Saturday: 9:00 AM – 8:00 PM\n• Sunday: 9:30 AM – 6:00 PM\n• Poya Days & Public Holidays: Open (Special Hours)"},
    {"shortcut": "/locate", "title": "Store Location & Map", "category": "general", "content": "📍 *Visit Our Store*\nAddress: No. 128, Galle Road, Colombo 03, Sri Lanka.\nGoogle Maps: https://maps.google.com/?q=I-Store+Colombo\nHotline: +94 77 123 4567"},
    {"shortcut": "/warranty", "title": "Warranty Policy Terms", "category": "support", "content": "🛡️ *Warranty Policy Summary*\n• Hardware parts: 6 Months to 1 Year manufacturer warranty\n• Repair service: 30 Days service warranty on replaced components\n• Physical, liquid, or burn damage is not covered under warranty terms."},
    {"shortcut": "/thanks", "title": "Thank You Closing", "category": "support", "content": "🌟 Thank you for reaching out to *I-Store Digital Care*! If you need any further assistance, feel free to text us here. Have a great day!"},
]


def _seed_automation_and_quick_replies(db: Session):
    # 1. Automation rules
    existing_rules = {r.event_type: r for r in db.query(WhatsAppAutomationRule).all()}
    for r in DEFAULT_AUTOMATION_RULES:
        if r["event_type"] not in existing_rules:
            db.add(WhatsAppAutomationRule(
                id=str(uuid.uuid4()),
                event_type=r["event_type"],
                name=r["name"],
                category=r["category"],
                description=r["description"],
                is_enabled=r["is_enabled"],
                delay_seconds=0
            ))
    
    # 2. Quick replies
    existing_qr = {qr.shortcut: qr for qr in db.query(WhatsAppQuickReply).all()}
    for qr in DEFAULT_QUICK_REPLIES:
        if qr["shortcut"] not in existing_qr:
            db.add(WhatsAppQuickReply(
                id=str(uuid.uuid4()),
                shortcut=qr["shortcut"],
                title=qr["title"],
                content=qr["content"],
                category=qr["category"]
            ))
    
    db.commit()


# ─── Template Seeder ─────────────────────────────────────────────────────────

def _seed_templates_if_needed(db: Session):
    existing_map = {t.event_type: t for t in db.query(WhatsAppTemplate).all()}
    changed = False
    for event_type, body in DEFAULT_TEMPLATES.items():
        meta = TEMPLATE_METADATA.get(event_type, {})
        target_category = meta.get("category", "sales")
        target_name = meta.get("name", event_type.replace("_", " ").title())

        if event_type not in existing_map:
            db.add(WhatsAppTemplate(
                id=str(uuid.uuid4()),
                name=target_name,
                event_type=event_type,
                category=target_category,
                template_body=body,
                is_active=True
            ))
            changed = True
        else:
            tmpl = existing_map[event_type]
            if tmpl.category != target_category or not tmpl.name or tmpl.name == event_type:
                tmpl.category = target_category
                tmpl.name = target_name
                changed = True
    if changed:
        db.commit()


# ─── Hub Overview Metrics ────────────────────────────────────────────────────

@router.get("/overview")
async def get_hub_overview(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Returns comprehensive WhatsApp Hub health, session status, and daily telemetry."""
    now_utc = datetime.utcnow()
    today_start = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)

    # Message counts today
    today_logs = db.query(WhatsAppMessageLog).filter(WhatsAppMessageLog.created_at >= today_start).all()
    sent_today = sum(1 for m in today_logs if m.status in ("SENT", "DELIVERED", "READ"))
    delivered_today = sum(1 for m in today_logs if m.status in ("DELIVERED", "READ"))
    read_today = sum(1 for m in today_logs if m.status == "READ")
    failed_today = sum(1 for m in today_logs if m.status == "FAILED")
    queued_today = sum(1 for m in today_logs if m.status == "QUEUED")

    # Overall totals
    total_messages = db.query(func.count(WhatsAppMessageLog.id)).scalar() or 0
    total_failed = db.query(func.count(WhatsAppMessageLog.id)).filter(WhatsAppMessageLog.status == "FAILED").scalar() or 0

    # Last successful & last failed message
    last_success = (
        db.query(WhatsAppMessageLog)
        .filter(WhatsAppMessageLog.status.in_(["SENT", "DELIVERED", "READ"]))
        .order_by(desc(WhatsAppMessageLog.created_at))
        .first()
    )
    last_failed = (
        db.query(WhatsAppMessageLog)
        .filter(WhatsAppMessageLog.status == "FAILED")
        .order_by(desc(WhatsAppMessageLog.created_at))
        .first()
    )

    # Queue status
    active_queue_count = db.query(func.count(WhatsAppQueue.id)).filter(WhatsAppQueue.status.in_(["PENDING", "PROCESSING"])).scalar() or 0

    # Node microservice live status
    service_status = await whatsapp_provider.get_service_status()

    return {
        "metrics": {
            "sent_today": sent_today,
            "delivered_today": delivered_today,
            "read_today": read_today,
            "failed_today": failed_today,
            "queued_today": queued_today,
            "total_messages": total_messages,
            "total_failed": total_failed,
            "active_queue_count": active_queue_count,
            "delivery_rate_pct": round((delivered_today / sent_today * 100), 1) if sent_today > 0 else 100.0,
        },
        "last_activity": {
            "last_success_at": format_iso_utc(last_success.created_at) if last_success else None,
            "last_success_recipient": last_success.phone_number if last_success else None,
            "last_failed_at": format_iso_utc(last_failed.created_at) if last_failed else None,
            "last_failed_recipient": last_failed.phone_number if last_failed else None,
            "last_failed_reason": last_failed.error_detail if last_failed else None,
        },
        "service": service_status,
        "available_variables": list(resolve_store_variables(db).keys()) + [
            "customer_name", "customer_phone", "invoice_number", "invoice_total",
            "paid_amount", "balance_due", "smart_bill_url", "job_number",
            "device_model", "repair_status", "repair_tracking_url", "product_name",
            "serial_number", "expiry_date", "payment_amount", "payment_method"
        ]
    }


# ─── Internal Webhook Receiver (Node -> Python ACK Sync) ─────────────────────

@router.post("/internal-webhook/ack")
async def receive_ack_webhook(
    payload: WebhookAckPayload,
    request: Request,
    db: Session = Depends(get_db),
    x_internal_secret: Optional[str] = Header(None)
):
    """
    Called by Node.js microservice whenever WhatsApp fires a `message_ack` event.
    Synchronizes status (DELIVERED, READ, FAILED) into the database audit trail.
    """
    if WHATSAPP_SERVICE_SECRET and x_internal_secret != WHATSAPP_SERVICE_SECRET:
        raise HTTPException(status_code=403, detail="Invalid internal secret")

    log_entry = db.query(WhatsAppMessageLog).filter(WhatsAppMessageLog.message_id == payload.messageId).first()
    if not log_entry:
        return {"ok": True, "matched": False, "message": "No matching log record for messageId"}

    log_entry.ack_status = payload.ack
    now = datetime.utcnow()

    if payload.ackCode == -1:
        log_entry.status = "FAILED"
        log_entry.error_detail = f"WhatsApp ACK_ERROR received for {log_entry.phone_number}"
        log_entry.pipeline_trace = PipelineTracer.append_step(
            log_entry.pipeline_trace, "ACK_ERROR", "FAILED", "WhatsApp server rejected message delivery"
        )
    elif payload.ackCode in (2, 4):  # DEVICE or PLAYED
        log_entry.status = "DELIVERED"
        if not log_entry.delivered_at:
            log_entry.delivered_at = now
        log_entry.pipeline_trace = PipelineTracer.append_step(
            log_entry.pipeline_trace, "DELIVERED_TO_DEVICE", "OK", f"Delivered to recipient phone at {now.strftime('%H:%M:%S')}"
        )
    elif payload.ackCode == 3:  # READ
        log_entry.status = "READ"
        if not log_entry.delivered_at:
            log_entry.delivered_at = now
        if not log_entry.read_at:
            log_entry.read_at = now
        log_entry.pipeline_trace = PipelineTracer.append_step(
            log_entry.pipeline_trace, "MESSAGE_READ", "OK", f"Read by customer at {now.strftime('%H:%M:%S')}"
        )

    db.commit()
    return {"ok": True, "matched": True, "new_status": log_entry.status}


# ─── Visual Pipeline Trace Inspector ──────────────────────────────────────────

@router.get("/logs/{log_id}/trace")
def get_log_trace(
    log_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Returns the parsed step-by-step pipeline execution trace for a message."""
    log = db.query(WhatsAppMessageLog).filter(WhatsAppMessageLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Log entry not found")

    trace = []
    if log.pipeline_trace:
        try:
            trace = json.loads(log.pipeline_trace)
        except Exception:
            trace = []

    return {
        "id": log.id,
        "phone": log.phone_number,
        "event": log.event_type,
        "status": log.status,
        "message_id": log.message_id,
        "created_at": format_iso_utc(log.created_at),
        "sent_at": format_iso_utc(log.sent_at),
        "delivered_at": format_iso_utc(log.delivered_at),
        "read_at": format_iso_utc(log.read_at),
        "trace": trace
    }


# ─── End-to-End Diagnostic Pipeline Test ─────────────────────────────────────

@router.get("/diagnostics/run")
async def run_pipeline_diagnostic(
    phone: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("settings.manage"))
):
    """
    Runs an 8-step automated diagnostic test suite verifying every component in the chain:
      1. Backend Reachability
      2. Database Connectivity
      3. Service Secret Configuration
      4. WhatsApp Microservice Connection
      5. WhatsApp Session Authentication
      6. Sri Lankan Number Normalizer
      7. Recipient WhatsApp Validation (via check-number)
      8. Message Transport Readiness
    """
    results = []
    test_phone = phone or "94785571342"

    # Step 1: Backend Reachability
    results.append({
        "step": "Backend API Server",
        "status": "PASS",
        "detail": "FastAPI engine running and responsive."
    })

    # Step 2: Database Connectivity
    try:
        count = db.query(func.count(WhatsAppMessageLog.id)).scalar()
        results.append({
            "step": "Database Audit Engine",
            "status": "PASS",
            "detail": f"SQLite connection active. {count} message logs recorded."
        })
    except Exception as e:
        results.append({
            "step": "Database Audit Engine",
            "status": "FAIL",
            "detail": f"Database query error: {e}"
        })

    # Step 3: Service Secret Configuration
    if WHATSAPP_SERVICE_SECRET:
        results.append({
            "step": "Internal Security Authentication",
            "status": "PASS",
            "detail": "WHATSAPP_SERVICE_SECRET configured in environment."
        })
    else:
        results.append({
            "step": "Internal Security Authentication",
            "status": "WARN",
            "detail": "No secret configured — running in open internal mode."
        })

    # Step 4 & 5: Node Service & WhatsApp Session
    service_status = await whatsapp_provider.get_service_status()
    if service_status.get("success") and service_status.get("status") == "CONNECTED":
        user_info = service_status.get("user") or {}
        results.append({
            "step": "WhatsApp Microservice",
            "status": "PASS",
            "detail": f"Microservice online on port 3001 (Node.js/Puppeteer)."
        })
        results.append({
            "step": "WhatsApp Session Authentication",
            "status": "PASS",
            "detail": f"Authenticated as {user_info.get('pushname', 'Account')} (+{user_info.get('wid', 'N/A')})."
        })
    else:
        status_name = service_status.get("status", "OFFLINE")
        results.append({
            "step": "WhatsApp Microservice",
            "status": "FAIL",
            "detail": f"Service status is {status_name}. Please ensure node server.js is running."
        })
        results.append({
            "step": "WhatsApp Session Authentication",
            "status": "FAIL",
            "detail": f"Client not connected (Status: {status_name}). Scan QR in pairing tab."
        })

    # Step 6: Phone Normalization
    norm = normalize_sri_lankan_phone(test_phone)
    if norm.startswith("94") and len(norm) == 11:
        results.append({
            "step": "Phone Number Normalizer",
            "status": "PASS",
            "detail": f"Converted '{test_phone}' → E.164 '{norm}' correctly."
        })
    else:
        results.append({
            "step": "Phone Number Normalizer",
            "status": "WARN",
            "detail": f"Normalization output: '{norm}'."
        })

    # Step 7: Number Validation
    if service_status.get("status") == "CONNECTED":
        check_res = await whatsapp_provider.check_number(norm)
        if check_res.get("isRegistered"):
            results.append({
                "step": "Recipient Registration Check",
                "status": "PASS",
                "detail": f"+{norm} confirmed active on WhatsApp."
            })
        else:
            results.append({
                "step": "Recipient Registration Check",
                "status": "WARN",
                "detail": f"+{norm} does not have an active WhatsApp account or check timed out."
            })
    else:
        results.append({
            "step": "Recipient Registration Check",
            "status": "SKIP",
            "detail": "Skipped because WhatsApp session is offline."
        })

    # Step 8: Transport Readiness
    all_passed = all(r["status"] in ("PASS", "WARN") for r in results)
    results.append({
        "step": "Message Transport Readiness",
        "status": "PASS" if all_passed else "FAIL",
        "detail": "Pipeline ready for outbound dispatches." if all_passed else "Pipeline has blocking failures."
    })

    return {
        "timestamp": datetime.utcnow().isoformat(),
        "overall_health": "HEALTHY" if all_passed else "DEGRADED",
        "results": results
    }


# ─── Reconnect / Session Management ──────────────────────────────────────────

@router.post("/service/reconnect")
async def reconnect_service(
    current_user=Depends(require_permission("settings.manage"))
):
    """Proxies a reconnect trigger to the microservice."""
    try:
        headers = {}
        if WHATSAPP_SERVICE_SECRET:
            headers["X-Internal-Secret"] = WHATSAPP_SERVICE_SECRET
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(f"{WHATSAPP_SERVICE_URL}/api/reconnect", headers=headers)
            return res.json()
    except Exception as e:
        return {"success": False, "error": f"Failed to reach microservice: {e}"}


# ─── Check Number Proxy ───────────────────────────────────────────────────────

@router.get("/check-number/{phone}")
async def check_number(phone: str, current_user=Depends(get_current_user)):
    clean = normalize_sri_lankan_phone(phone)
    if not clean:
        raise HTTPException(status_code=400, detail=f"Invalid phone number format: '{phone}'")
    return await whatsapp_provider.check_number(clean)


# ─── Service Status Proxy ────────────────────────────────────────────────────

@router.get("/service-status")
async def get_service_status(current_user=Depends(get_current_user)):
    return await whatsapp_provider.get_service_status()


# ─── Template Management ──────────────────────────────────────────────────────

@router.get("/templates")
def get_templates(
    category: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    _seed_templates_if_needed(db)
    query = db.query(WhatsAppTemplate)
    if category and category.lower() != "all":
        query = query.filter(WhatsAppTemplate.category == category.lower())
    templates = query.all()
    res = []
    for tmpl in templates:
        meta = TEMPLATE_METADATA.get(tmpl.event_type, {})
        res.append({
            "id": tmpl.id,
            "event_type": tmpl.event_type,
            "category": tmpl.category or meta.get("category", "sales"),
            "name": tmpl.name or meta.get("name", tmpl.event_type),
            "template_body": tmpl.template_body,
            "is_active": tmpl.is_active,
            "variables": meta.get("variables", []),
            "description": meta.get("description", ""),
            "updated_at": tmpl.updated_at.isoformat() if tmpl.updated_at else None
        })
    return res


@router.put("/templates/{event_type}")
def update_template(
    event_type: str,
    payload: TemplateUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("settings.manage"))
):
    _seed_templates_if_needed(db)
    tmpl = db.query(WhatsAppTemplate).filter(WhatsAppTemplate.event_type == event_type).first()
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template event type not found.")
    tmpl.template_body = payload.template_body
    tmpl.is_active = payload.is_active
    if payload.name:
        tmpl.name = payload.name
    if payload.category:
        tmpl.category = payload.category
    tmpl.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "message": f"Template '{event_type}' updated successfully."}


@router.post("/templates/{event_type}/reset")
def reset_template(
    event_type: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("settings.manage"))
):
    _seed_templates_if_needed(db)
    if event_type not in DEFAULT_TEMPLATES:
        raise HTTPException(status_code=404, detail="Default template not found for event.")
    tmpl = db.query(WhatsAppTemplate).filter(WhatsAppTemplate.event_type == event_type).first()
    if tmpl:
        tmpl.template_body = DEFAULT_TEMPLATES[event_type]
        tmpl.updated_at = datetime.utcnow()
        db.commit()
    return {"ok": True, "template_body": DEFAULT_TEMPLATES[event_type]}


# ─── Audit Log Management ────────────────────────────────────────────────────

@router.get("/logs")
def get_logs(
    status: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    query = db.query(WhatsAppMessageLog)
    if status and status.upper() != "ALL":
        query = query.filter(WhatsAppMessageLog.status == status.upper())
    if event_type and event_type.lower() != "all":
        query = query.filter(WhatsAppMessageLog.event_type == event_type)
    if category and category.lower() != "all":
        query = query.filter(WhatsAppMessageLog.category == category.lower())
    if search:
        s = f"%{search}%"
        query = query.filter(
            or_(
                WhatsAppMessageLog.phone_number.like(s),
                WhatsAppMessageLog.message_body.like(s),
                WhatsAppMessageLog.message_id.like(s),
                WhatsAppMessageLog.invoice_no.like(s),
                WhatsAppMessageLog.repair_no.like(s),
            )
        )

    total_count = query.count()
    logs = query.order_by(desc(WhatsAppMessageLog.created_at)).offset(offset).limit(limit).all()

    res = []
    for log in logs:
        cust_name = None
        if log.customer_id:
            cust = db.query(Customer).filter(Customer.id == log.customer_id).first()
            if cust:
                cust_name = cust.name
        res.append({
            "id": log.id,
            "customer_id": log.customer_id,
            "customer_name": cust_name,
            "phone_number": log.phone_number,
            "event_type": log.event_type,
            "category": log.category,
            "template_name": log.template_name,
            "message_body": log.message_body,
            "status": log.status,
            "ack_status": log.ack_status,
            "error_detail": log.error_detail,
            "message_id": log.message_id,
            "retry_count": log.retry_count,
            "trigger_type": log.trigger_type,
            "invoice_no": log.invoice_no,
            "repair_no": log.repair_no,
            "created_at": format_iso_utc(log.created_at),
            "sent_at": format_iso_utc(log.sent_at),
            "delivered_at": format_iso_utc(log.delivered_at),
            "read_at": format_iso_utc(log.read_at),
        })
    return {"total": total_count, "logs": res}


@router.post("/logs/{log_id}/retry")
async def retry_failed_log(
    log_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Manually retries a failed message and appends a retry step to its pipeline trace."""
    log = db.query(WhatsAppMessageLog).filter(WhatsAppMessageLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Log entry not found.")

    log.retry_count = (log.retry_count or 0) + 1
    log.pipeline_trace = PipelineTracer.append_step(
        log.pipeline_trace, "MANUAL_RETRY_INITIATED", "OK", f"Retry #{log.retry_count} triggered by user"
    )
    db.commit()

    res = await whatsapp_provider.send_text(log.phone_number, log.message_body)

    if res.get("success"):
        log.status = res.get("status", "SENT")
        log.message_id = res.get("messageId", f"sent-{int(datetime.utcnow().timestamp())}")
        log.ack_status = res.get("ack", "PENDING")
        log.sent_at = datetime.utcnow()
        log.error_detail = None
        log.pipeline_trace = PipelineTracer.append_step(
            log.pipeline_trace, "RETRY_SUCCESS", "OK", f"Message ID: {log.message_id}"
        )
        db.commit()
        return {
            "ok": True,
            "message": "Message successfully retried and dispatched.",
            "message_id": log.message_id,
            "status": log.status
        }
    else:
        err = res.get("error", "Dispatch failed")
        log.status = "FAILED"
        log.error_detail = f"[{res.get('status', 'FAILED')}] {err}"
        log.pipeline_trace = PipelineTracer.append_step(
            log.pipeline_trace, "RETRY_FAILED", "FAILED", f"Reason: {err}"
        )
        db.commit()
        raise HTTPException(status_code=400, detail=f"Retry failed: {err}")


# ─── Direct Message Dispatch ─────────────────────────────────────────────────

@router.post("/send-direct")
async def send_direct_message(
    payload: DirectMessageRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Sends a direct manual message with pipeline tracing and E.164 normalization."""
    clean_phone = normalize_sri_lankan_phone(payload.phone)
    if not clean_phone:
        raise HTTPException(status_code=400, detail=f"Invalid phone number: '{payload.phone}'")

    trace = PipelineTracer.create_trace("MANUAL_SEND_REQUESTED", f"Direct message to {clean_phone}")
    trace_json = json.dumps(trace)

    log_entry = WhatsAppMessageLog(
        id=str(uuid.uuid4()),
        customer_id=payload.customer_id,
        user_id=current_user.id if hasattr(current_user, "id") else None,
        phone_number=clean_phone,
        event_type="manual_direct",
        category=payload.category or "manual",
        template_name="Instant Message",
        message_body=payload.message,
        status="QUEUED",
        trigger_type="manual",
        invoice_no=payload.invoice_no,
        repair_no=payload.repair_no,
        pipeline_trace=trace_json
    )
    db.add(log_entry)
    db.commit()

    if payload.media_url:
        res = await whatsapp_provider.send_media(clean_phone, payload.media_url, caption=payload.message, filename="official_receipt_qr.png")
    else:
        res = await whatsapp_provider.send_text(clean_phone, payload.message)

    if res.get("success"):
        log_entry.status = res.get("status", "SENT")
        log_entry.message_id = res.get("messageId", f"sent-{int(datetime.utcnow().timestamp())}")
        log_entry.ack_status = res.get("ack", "PENDING")
        log_entry.sent_at = datetime.utcnow()
        log_entry.error_detail = None
        log_entry.pipeline_trace = PipelineTracer.append_step(
            log_entry.pipeline_trace, "PROVIDER_ACCEPTED", "OK", f"ID: {log_entry.message_id} • ACK: {log_entry.ack_status}"
        )
        db.commit()
        return {
            "ok": True,
            "message": "WhatsApp message dispatched successfully.",
            "message_id": log_entry.message_id,
            "phone": clean_phone,
            "recipient_id": f"{clean_phone}@c.us",
            "status": log_entry.status
        }
    else:
        err = res.get("error", "Dispatch failed")
        node_status = res.get("status", "FAILED")
        log_entry.status = "FAILED"
        log_entry.error_detail = f"[{node_status}] {err}"
        log_entry.pipeline_trace = PipelineTracer.append_step(
            log_entry.pipeline_trace, "PROVIDER_REJECTED", "FAILED", f"Reason: {err}"
        )
        db.commit()

        if node_status == "RECIPIENT_NOT_FOUND":
            raise HTTPException(status_code=422, detail=f"The phone number is not registered on WhatsApp: {err}")
        raise HTTPException(status_code=400, detail=f"WhatsApp dispatch failed: {err}")


# ─── Daily Z-Report Summary Dispatch ─────────────────────────────────────────

@router.post("/send-daily-summary")
async def send_daily_summary(
    phone: Optional[str] = Query(default=None, description="Optional target phone; defaults to store owner phone"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Generates today's Z-Report and dispatches it directly to the store owner via WhatsApp."""
    from app.services.daily_summary_service import get_daily_business_metrics, format_daily_summary_whatsapp_message
    from app.utils.whatsapp_helper import resolve_store_variables, normalize_sri_lankan_phone

    store_info = resolve_store_variables(db)
    store_name = store_info.get("store_name", "I-Store")

    target_phone = phone
    if not target_phone:
        # Check Owner's phone from User table or SecuritySetting
        owner_user = db.query(User).filter(User.role.in_(["Owner", "owner", "Admin", "admin"])).first()
        if owner_user and hasattr(owner_user, "phone") and owner_user.phone:
            target_phone = owner_user.phone
        elif store_info.get("store_phone"):
            target_phone = store_info.get("store_phone")
        else:
            target_phone = "0764158980"

    clean_phone = normalize_sri_lankan_phone(target_phone)
    if not clean_phone:
        raise HTTPException(status_code=400, detail=f"No valid owner phone number configured ({target_phone}).")

    metrics = get_daily_business_metrics(db)
    msg_body = format_daily_summary_whatsapp_message(metrics, store_name=store_name)

    log_entry = WhatsAppMessageLog(
        id=str(uuid.uuid4()),
        customer_id=None,
        user_id=current_user.id if hasattr(current_user, "id") else None,
        phone_number=clean_phone,
        event_type="daily_summary_z_report",
        category="reports",
        template_name="Daily Closing Z-Report",
        message_body=msg_body,
        status="QUEUED",
        trigger_type="manual",
        pipeline_trace=json.dumps(PipelineTracer.create_trace("DAILY_REPORT_TRIGGERED", f"Sent to {clean_phone}"))
    )
    db.add(log_entry)
    db.commit()

    res = await whatsapp_provider.send_text(clean_phone, msg_body)
    if res.get("success"):
        log_entry.status = "SENT"
        log_entry.message_id = res.get("messageId", f"zreport-{int(datetime.utcnow().timestamp())}")
        log_entry.sent_at = datetime.utcnow()
        db.commit()
        return {
            "ok": True,
            "message": f"Daily Closing Summary successfully sent to {clean_phone}!",
            "metrics": metrics
        }
    else:
        err = res.get("error", "Dispatch failed")
        log_entry.status = "FAILED"
        log_entry.error_detail = err
        db.commit()
        raise HTTPException(status_code=400, detail=f"Failed to send Daily Summary: {err}")


# ─── 2-Way WhatsApp Self-Service Bot Webhook ─────────────────────────────────

class IncomingBotMessage(BaseModel):
    phone: str
    message: str
    fromMe: Optional[bool] = False
    messageId: Optional[str] = None


class ChatSendPayload(BaseModel):
    message: str
    media_base64: Optional[str] = None
    mimetype: Optional[str] = None
    filename: Optional[str] = None
    caption: Optional[str] = None


# ─── Automation Rules Endpoints ──────────────────────────────────────────────

@router.get("/automation-rules")
async def get_automation_rules(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Retrieves all system WhatsApp notification triggers and their active state."""
    _seed_automation_and_quick_replies(db)
    rules = db.query(WhatsAppAutomationRule).order_by(WhatsAppAutomationRule.category, WhatsAppAutomationRule.name).all()
    return {
        "rules": [
            {
                "id": r.id,
                "event_type": r.event_type,
                "name": r.name,
                "category": r.category,
                "description": r.description,
                "is_enabled": r.is_enabled,
                "delay_seconds": r.delay_seconds,
                "updated_at": format_iso_utc(r.updated_at)
            }
            for r in rules
        ]
    }


@router.put("/automation-rules/{event_type}")
async def update_automation_rule(
    event_type: str,
    payload: AutomationRuleUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission(["settings.update", "admin", "owner"]))
):
    """Enables or disables an automated WhatsApp trigger rule."""
    rule = db.query(WhatsAppAutomationRule).filter(WhatsAppAutomationRule.event_type == event_type).first()
    if not rule:
        rule = WhatsAppAutomationRule(
            id=str(uuid.uuid4()),
            event_type=event_type,
            name=payload.name or event_type.replace("_", " ").title(),
            category="sales",
            description=payload.description or "",
            is_enabled=payload.is_enabled,
            delay_seconds=payload.delay_seconds or 0
        )
        db.add(rule)
    else:
        rule.is_enabled = payload.is_enabled
        if payload.delay_seconds is not None:
            rule.delay_seconds = payload.delay_seconds
        if payload.name:
            rule.name = payload.name
        if payload.description:
            rule.description = payload.description
        rule.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(rule)
    return {"ok": True, "event_type": rule.event_type, "is_enabled": rule.is_enabled}


@router.post("/automation-rules/bulk-toggle")
async def bulk_toggle_automation_rules(
    payload: BulkRuleToggle,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission(["settings.update", "admin", "owner"]))
):
    """Enables or disables all automation rules or rules within a specific category."""
    query = db.query(WhatsAppAutomationRule)
    if payload.category and payload.category != "all":
        query = query.filter(WhatsAppAutomationRule.category == payload.category)
    
    rules = query.all()
    for r in rules:
        r.is_enabled = payload.is_enabled
        r.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "count": len(rules), "is_enabled": payload.is_enabled}


# ─── Quick Replies Endpoints ──────────────────────────────────────────────────

@router.get("/quick-replies")
async def get_quick_replies(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Retrieves all canned response snippets for live chat."""
    _seed_automation_and_quick_replies(db)
    items = db.query(WhatsAppQuickReply).order_by(desc(WhatsAppQuickReply.usage_count), WhatsAppQuickReply.shortcut).all()
    return {
        "quick_replies": [
            {
                "id": q.id,
                "shortcut": q.shortcut,
                "title": q.title,
                "content": q.content,
                "category": q.category,
                "usage_count": q.usage_count,
                "updated_at": format_iso_utc(q.updated_at)
            }
            for q in items
        ]
    }


@router.post("/quick-replies")
async def create_quick_reply(
    payload: QuickReplyCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Creates a new canned quick reply shortcut."""
    shortcut = payload.shortcut.strip()
    if not shortcut.startswith("/"):
        shortcut = "/" + shortcut

    existing = db.query(WhatsAppQuickReply).filter(WhatsAppQuickReply.shortcut == shortcut).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Shortcut '{shortcut}' already exists.")

    item = WhatsAppQuickReply(
        id=str(uuid.uuid4()),
        shortcut=shortcut,
        title=payload.title.strip(),
        content=payload.content.strip(),
        category=payload.category or "general",
        usage_count=0
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"ok": True, "quick_reply": {"id": item.id, "shortcut": item.shortcut, "title": item.title, "content": item.content, "category": item.category}}


@router.put("/quick-replies/{reply_id}")
async def update_quick_reply(
    reply_id: str,
    payload: QuickReplyUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Updates an existing quick reply."""
    item = db.query(WhatsAppQuickReply).filter(WhatsAppQuickReply.id == reply_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Quick reply not found.")

    if payload.shortcut:
        s = payload.shortcut.strip()
        if not s.startswith("/"):
            s = "/" + s
        item.shortcut = s
    if payload.title:
        item.title = payload.title.strip()
    if payload.content:
        item.content = payload.content.strip()
    if payload.category:
        item.category = payload.category
    item.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "id": item.id}


@router.delete("/quick-replies/{reply_id}")
async def delete_quick_reply(
    reply_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Deletes a quick reply shortcut."""
    item = db.query(WhatsAppQuickReply).filter(WhatsAppQuickReply.id == reply_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Quick reply not found.")
    db.delete(item)
    db.commit()
    return {"ok": True}


# ─── Custom Bot Rules & Away Message Endpoints ───────────────────────────────

@router.get("/bot-rules")
async def get_bot_rules(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Fetches custom keyword trigger rules."""
    rules = db.query(WhatsAppBotRule).order_by(desc(WhatsAppBotRule.priority), desc(WhatsAppBotRule.id)).all()
    return {
        "bot_rules": [
            {
                "id": r.id,
                "name": r.name,
                "keywords": r.keywords,
                "match_type": r.match_type,
                "response_body": r.response_body,
                "category": r.category,
                "priority": r.priority,
                "is_active": r.is_active,
                "updated_at": format_iso_utc(r.updated_at)
            }
            for r in rules
        ]
    }


@router.post("/bot-rules")
async def create_bot_rule(
    payload: BotRuleCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission(["settings.update", "admin", "owner"]))
):
    """Creates a new keyword bot auto-reply rule."""
    rule = WhatsAppBotRule(
        id=str(uuid.uuid4()),
        name=payload.name.strip(),
        keywords=payload.keywords.strip(),
        match_type=payload.match_type or "contains",
        response_body=payload.response_body.strip(),
        category=payload.category or "custom",
        priority=payload.priority or 10,
        is_active=payload.is_active if payload.is_active is not None else True
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return {"ok": True, "id": rule.id}


@router.put("/bot-rules/{rule_id}")
async def update_bot_rule(
    rule_id: str,
    payload: BotRuleUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission(["settings.update", "admin", "owner"]))
):
    """Updates an existing keyword bot rule."""
    rule = db.query(WhatsAppBotRule).filter(WhatsAppBotRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Bot rule not found.")

    if payload.name is not None:
        rule.name = payload.name.strip()
    if payload.keywords is not None:
        rule.keywords = payload.keywords.strip()
    if payload.match_type is not None:
        rule.match_type = payload.match_type
    if payload.response_body is not None:
        rule.response_body = payload.response_body.strip()
    if payload.category is not None:
        rule.category = payload.category
    if payload.priority is not None:
        rule.priority = payload.priority
    if payload.is_active is not None:
        rule.is_active = payload.is_active
    rule.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "id": rule.id}


@router.delete("/bot-rules/{rule_id}")
async def delete_bot_rule(
    rule_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission(["settings.update", "admin", "owner"]))
):
    """Deletes a custom bot rule."""
    rule = db.query(WhatsAppBotRule).filter(WhatsAppBotRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Bot rule not found.")
    db.delete(rule)
    db.commit()
    return {"ok": True}


@router.get("/away-settings")
async def get_away_settings(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Retrieves after-hours auto-responder configurations."""
    settings = {s.key: s.value for s in db.query(SecuritySetting).all()}
    default_text = (
        "🌙 *Hello {{customer_name}}!*\n"
        "Thank you for contacting *{{store_name}}*.\n\n"
        "Our store is currently closed. Our business hours are:\n"
        "⏰ *Mon – Sun: 9:00 AM – 8:00 PM*\n\n"
        "Your message has been received and our team will get back to you as soon as we open!\n\n"
        "📞 Hotline: {{store_phone}}"
    )
    return {
        "enabled": settings.get("whatsapp_away_enabled") == "true",
        "text": settings.get("whatsapp_away_text") or default_text,
        "start_time": settings.get("whatsapp_away_start_time", "09:00"),
        "end_time": settings.get("whatsapp_away_end_time", "20:00"),
        "active_days": settings.get("whatsapp_away_days", "0,1,2,3,4,5,6")
    }


@router.put("/away-settings")
async def update_away_settings(
    payload: AwaySettingsUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission(["settings.update", "admin", "owner"]))
):
    """Updates after-hours auto-responder settings."""
    def _upsert(k: str, v: str):
        row = db.query(SecuritySetting).filter(SecuritySetting.key == k).first()
        if row:
            row.value = v
            row.updated_at = datetime.utcnow()
        else:
            db.add(SecuritySetting(id=str(uuid.uuid4()), key=k, value=v))

    _upsert("whatsapp_away_enabled", "true" if payload.enabled else "false")
    _upsert("whatsapp_away_text", payload.text)
    _upsert("whatsapp_away_start_time", payload.start_time)
    _upsert("whatsapp_away_end_time", payload.end_time)
    _upsert("whatsapp_away_days", payload.active_days)
    db.commit()
    return {"ok": True}


@router.post("/incoming-webhook")
async def handle_incoming_whatsapp_message(
    payload: IncomingBotMessage,
    x_internal_secret: Optional[str] = Header(default=None, alias="X-Internal-Secret"),
    db: Session = Depends(get_db)
):
    """Webhook invoked by node server.js when an incoming WhatsApp message is received from a customer."""
    from app.services.whatsapp_bot_service import process_incoming_bot_message

    if WHATSAPP_SERVICE_SECRET and x_internal_secret != WHATSAPP_SERVICE_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden: Invalid internal webhook secret.")

    if payload.fromMe:
        return {"ok": True, "action": "IGNORED_FROM_ME"}

    clean_phone = normalize_sri_lankan_phone(payload.phone) or payload.phone

    # Match customer in DB if exists
    phone_variants = [clean_phone]
    if clean_phone.startswith("94") and len(clean_phone) == 11:
        phone_variants.extend(["0" + clean_phone[2:], clean_phone[2:]])
    elif clean_phone.startswith("0") and len(clean_phone) == 10:
        phone_variants.extend(["94" + clean_phone[1:], clean_phone[1:]])

    customer = db.query(Customer).filter(
        or_(Customer.phone.in_(phone_variants), Customer.whatsapp_number.in_(phone_variants))
    ).first()

    # 1. Always record the incoming message into audit logs & live chats
    inbound_log = WhatsAppMessageLog(
        id=str(uuid.uuid4()),
        customer_id=customer.id if customer else None,
        user_id=None,
        phone_number=clean_phone,
        event_type="incoming_message",
        category="support",
        template_name="Customer Inbound Message",
        message_body=payload.message,
        status="RECEIVED",
        trigger_type="customer_inbound",
        message_id=payload.messageId or str(uuid.uuid4()),
        sent_at=datetime.utcnow(),
        pipeline_trace=json.dumps(PipelineTracer.create_trace("INBOUND_MESSAGE", f"Received from {clean_phone}: '{payload.message}'"))
    )
    db.add(inbound_log)
    db.commit()

    # 2. Process self-service bot response
    reply_text = process_incoming_bot_message(db, payload.phone, payload.message)
    if not reply_text:
        return {"ok": True, "action": "NO_REPLY_NEEDED"}

    # Dispatch bot auto-response back to customer
    res = await whatsapp_provider.send_text(clean_phone, reply_text)

    log_entry = WhatsAppMessageLog(
        id=str(uuid.uuid4()),
        customer_id=customer.id if customer else None,
        user_id=None,
        phone_number=clean_phone,
        event_type="bot_auto_reply",
        category="support",
        template_name="Self-Service Bot Reply",
        message_body=reply_text,
        status="SENT" if res.get("success") else "FAILED",
        trigger_type="bot_auto",
        message_id=res.get("messageId"),
        sent_at=datetime.utcnow() if res.get("success") else None,
        error_detail=res.get("error") if not res.get("success") else None,
        pipeline_trace=json.dumps(PipelineTracer.create_trace("BOT_AUTO_REPLY", f"Input: '{payload.message}' → Reply sent."))
    )
    db.add(log_entry)
    db.commit()

    return {
        "ok": True,
        "action": "AUTO_REPLY_SENT",
        "phone": clean_phone,
        "reply": reply_text
    }


# ─── Live Chat & Conversation Threads Endpoints ──────────────────────────────

@router.get("/chats")
def get_whatsapp_chats(
    search: Optional[str] = None,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns distinct conversation threads grouped by normalized phone number,
    including customer details, latest message snippet, timestamp, and message count.
    """
    latest_logs_subq = (
        db.query(
            WhatsAppMessageLog.phone_number,
            func.max(WhatsAppMessageLog.created_at).label("max_created_at")
        )
        .group_by(WhatsAppMessageLog.phone_number)
        .subquery()
    )

    query = (
        db.query(WhatsAppMessageLog)
        .join(
            latest_logs_subq,
            and_(
                WhatsAppMessageLog.phone_number == latest_logs_subq.c.phone_number,
                WhatsAppMessageLog.created_at == latest_logs_subq.c.max_created_at
            )
        )
    )

    threads_logs = query.order_by(desc(WhatsAppMessageLog.created_at)).all()

    results = []
    for log_item in threads_logs:
        phone = log_item.phone_number
        if not phone:
            continue

        clean_phone = normalize_sri_lankan_phone(phone) or phone
        phone_variants = [clean_phone]
        if clean_phone.startswith("94") and len(clean_phone) == 11:
            phone_variants.extend(["0" + clean_phone[2:], clean_phone[2:]])
        elif clean_phone.startswith("0") and len(clean_phone) == 10:
            phone_variants.extend(["94" + clean_phone[1:], clean_phone[1:]])

        customer = db.query(Customer).filter(
            or_(Customer.phone.in_(phone_variants), Customer.whatsapp_number.in_(phone_variants))
        ).first()

        msg_count = db.query(func.count(WhatsAppMessageLog.id)).filter(
            WhatsAppMessageLog.phone_number.in_(phone_variants)
        ).scalar() or 0

        cust_name = customer.name if customer else None
        if search:
            s = search.lower()
            if not (s in phone.lower() or (cust_name and s in cust_name.lower()) or (log_item.message_body and s in log_item.message_body.lower())):
                continue

        results.append({
            "phone": clean_phone,
            "display_phone": f"+{clean_phone}" if not clean_phone.startswith("+") else clean_phone,
            "customer_id": customer.id if customer else None,
            "customer_name": cust_name or "Customer",
            "customer_email": customer.email if customer else None,
            "last_message": {
                "id": log_item.id,
                "body": log_item.message_body,
                "direction": "inbound" if (log_item.trigger_type == "customer_inbound" or log_item.status == "RECEIVED") else "outbound",
                "trigger_type": log_item.trigger_type,
                "event_type": log_item.event_type,
                "status": log_item.status,
                "created_at": format_iso_utc(log_item.created_at),
            },
            "total_messages": msg_count,
            "updated_at": format_iso_utc(log_item.created_at)
        })

    return results[:limit]


@router.get("/chats/{phone}/messages")
def get_whatsapp_chat_messages(
    phone: str,
    limit: int = 150,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns full chronological message history for a given phone number.
    """
    clean_phone = normalize_sri_lankan_phone(phone) or phone
    phone_variants = [clean_phone]
    if clean_phone.startswith("94") and len(clean_phone) == 11:
        phone_variants.extend(["0" + clean_phone[2:], clean_phone[2:]])
    elif clean_phone.startswith("0") and len(clean_phone) == 10:
        phone_variants.extend(["94" + clean_phone[1:], clean_phone[1:]])

    customer = db.query(Customer).filter(
        or_(Customer.phone.in_(phone_variants), Customer.whatsapp_number.in_(phone_variants))
    ).first()

    messages = (
        db.query(WhatsAppMessageLog)
        .filter(WhatsAppMessageLog.phone_number.in_(phone_variants))
        .order_by(WhatsAppMessageLog.created_at.asc())
        .limit(limit)
        .all()
    )

    repairs_count = 0
    invoices_count = 0
    if customer:
        repairs_count = db.query(RepairTicket).filter(RepairTicket.customer_id == customer.id, RepairTicket.is_deleted == False).count()
        invoices_count = db.query(Sale).filter(Sale.customer_id == customer.id, Sale.is_voided == False).count()

    items = []
    for m in messages:
        items.append({
            "id": m.id,
            "phone_number": m.phone_number,
            "message_body": m.message_body,
            "direction": "inbound" if (m.trigger_type == "customer_inbound" or m.status == "RECEIVED") else "outbound",
            "trigger_type": m.trigger_type,
            "event_type": m.event_type,
            "category": m.category,
            "template_name": m.template_name,
            "status": m.status,
            "error_detail": m.error_detail,
            "created_at": format_iso_utc(m.created_at),
            "sent_at": format_iso_utc(m.sent_at) if m.sent_at else None,
            "invoice_no": m.invoice_no,
            "repair_no": m.repair_no,
        })

    return {
        "phone": clean_phone,
        "customer": {
            "id": customer.id if customer else None,
            "name": customer.name if customer else "Customer",
            "phone": customer.phone if customer else clean_phone,
            "repairs_count": repairs_count,
            "invoices_count": invoices_count
        } if customer else None,
        "messages": items
    }


@router.get("/chats/{phone}/profile-pic")
async def get_whatsapp_contact_profile_pic(
    phone: str,
    current_user: User = Depends(get_current_user)
):
    """
    Fetches the contact's live WhatsApp profile avatar URL via Node.js microservice.
    """
    clean_phone = normalize_sri_lankan_phone(phone) or phone
    clean_digits = "".join(filter(str.isdigit, clean_phone))
    try:
        async with httpx.AsyncClient(timeout=3.5) as client:
            resp = await client.get(f"{WHATSAPP_SERVICE_URL}/api/contact-profile/{clean_digits}")
            if resp.status_code == 200:
                return resp.json()
    except Exception as e:
        logger.debug(f"Failed to fetch profile picture for {phone}: {e}")
    return {"phone": clean_phone, "profilePicUrl": None}


@router.post("/chats/{phone}/send")
async def send_whatsapp_chat_message(
    phone: str,
    payload: ChatSendPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Sends a direct reply from the Live Chat Inbox to a customer's WhatsApp.
    """
    clean_phone = normalize_sri_lankan_phone(phone)
    if not clean_phone:
        raise HTTPException(status_code=400, detail="Invalid phone number format.")

    has_media = bool(payload.media_base64)
    msg_text = (payload.message or payload.caption or "").strip()
    if not msg_text and not has_media:
        raise HTTPException(status_code=400, detail="Message or attachment is required.")

    phone_variants = [clean_phone]
    if clean_phone.startswith("94") and len(clean_phone) == 11:
        phone_variants.extend(["0" + clean_phone[2:], clean_phone[2:]])
    customer = db.query(Customer).filter(
        or_(Customer.phone.in_(phone_variants), Customer.whatsapp_number.in_(phone_variants))
    ).first()

    if has_media:
        res = await whatsapp_provider.send_media(
            phone=clean_phone,
            caption=msg_text,
            filename=payload.filename or "attachment.png",
            media_base64=payload.media_base64,
            mimetype=payload.mimetype or "image/png"
        )
    else:
        res = await whatsapp_provider.send_text(clean_phone, msg_text)

    log_entry = WhatsAppMessageLog(
        id=str(uuid.uuid4()),
        customer_id=customer.id if customer else None,
        user_id=current_user.id if current_user else None,
        phone_number=clean_phone,
        event_type="chat_reply",
        category="support",
        template_name="Live Staff Reply (Media)" if has_media else "Live Staff Reply",
        message_body=msg_text or f"📎 Sent Attachment: {payload.filename or 'media'}",
        media_url=payload.filename if has_media else None,
        status="SENT" if res.get("success") else "FAILED",
        trigger_type="manual",
        message_id=res.get("messageId"),
        sent_at=datetime.utcnow() if res.get("success") else None,
        error_detail=res.get("error") if not res.get("success") else None,
        pipeline_trace=json.dumps(PipelineTracer.create_trace("LIVE_CHAT_REPLY", f"Manual staff {'media ' if has_media else ''}reply sent by user #{current_user.id if current_user else 'sys'}."))
    )
    db.add(log_entry)
    db.commit()
    db.refresh(log_entry)

    if not res.get("success"):
        raise HTTPException(status_code=400, detail=f"WhatsApp delivery failed: {res.get('error')}")

    return {
        "ok": True,
        "message": {
            "id": log_entry.id,
            "phone_number": log_entry.phone_number,
            "message_body": log_entry.message_body,
            "direction": "outbound",
            "trigger_type": "manual",
            "event_type": "chat_reply",
            "status": log_entry.status,
            "created_at": format_iso_utc(log_entry.created_at)
        }
    }


@router.post("/trigger-reminders")
async def trigger_reminder_jobs(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Manually trigger all scheduled WhatsApp reminder jobs."""
    from app.services.scheduled_jobs import (
        send_warranty_expiry_reminders, 
        send_payment_reminders, 
        send_repair_overdue_alerts
    )
    import threading
    threading.Thread(target=send_warranty_expiry_reminders, args=(db,), daemon=True).start()
    threading.Thread(target=send_payment_reminders, args=(db,), daemon=True).start()
    threading.Thread(target=send_repair_overdue_alerts, args=(db,), daemon=True).start()
    return {"ok": True, "message": "Reminder jobs triggered in background"}

