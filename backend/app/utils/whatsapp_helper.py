"""
whatsapp_helper.py
==================
I Store ERP — Enterprise WhatsApp Notification Engine & Provider Layer.

Features:
  - Provider Abstraction Layer (BaseWhatsAppProvider, LocalWebWhatsAppProvider)
  - Pipeline Tracer (Visual step-by-step audit tracing)
  - Multi-Category Template & Variable Substitution Engine (25+ ERP placeholders)
  - Database Queue & Exponential Backoff Retry Engine
  - Opt-in & Customer Consent Enforcement
"""

import os
import re
import json
import uuid
import logging
import httpx
from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.database import SessionLocal
from app.models import WhatsAppTemplate, WhatsAppMessageLog, WhatsAppQueue, Customer, SecuritySetting, WhatsAppAutomationRule

logger = logging.getLogger("whatsapp_engine")

WHATSAPP_SERVICE_URL    = os.getenv("WHATSAPP_SERVICE_URL", "http://127.0.0.1:3001")
WHATSAPP_SERVICE_SECRET = os.getenv("WHATSAPP_SERVICE_SECRET", "istore_whatsapp_secret_change_this_in_production")


# ─── Template Catalog & Metadata ──────────────────────────────────────────────

DEFAULT_TEMPLATES = {
    # Sales
    "pos_receipt": (
        "━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "🧾  *OFFICIAL DIGITAL RECEIPT*\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        "👋 Hello *{{customer_name}}*,\n\n"
        "Thank you for shopping with *{{store_name}}*!\n"
        "Your transaction has been confirmed ✅\n\n"
        "┌─────────────────────────\n"
        "│ 📋 *Invoice:*  #{{invoice_number}}\n"
        "│ 📅 *Date:*     {{invoice_date}}\n"
        "│ 💳 *Payment:*  {{payment_method}}\n"
        "└─────────────────────────\n\n"
        "💰 *Payment Summary*\n"
        "▸ Subtotal         LKR {{subtotal}}\n"
        "▸ Discount         LKR {{discount_amount}}\n"
        "▸ *Grand Total   LKR {{invoice_total}}* 🏷️\n"
        "▸ Amount Paid    LKR {{paid_amount}}\n"
        "▸ *Balance Due   LKR {{balance_due}}*\n\n"
        "🔗 *View & Download Digital Bill*\n"
        "{{smart_bill_url}}\n\n"
        "🛡️ *Warranty & Digital Records*\n"
        "Your warranty coverage and device serial\n"
        "numbers are digitally registered with your\n"
        "bill for easy future access.\n\n"
        "📞 *Support Hotline:* {{store_phone}}\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "_Thank you for choosing *{{store_name}}*!_\n"
        "_Have a wonderful day!_ 🌟"
    ),
    "invoice_created": (
        "Hello {{customer_name}}, your invoice #{{invoice_number}} has been created at *{{store_name}}*.\n"
        "💰 Total Amount: LKR {{invoice_total}}\n"
        "💳 Paid: LKR {{paid_amount}} | Balance: LKR {{balance_due}}\n"
        "📄 Smart Bill Link: {{smart_bill_url}}"
    ),
    "payment_receipt": (
        "✅ *Payment Received!*\n"
        "Thank you {{customer_name}}, we received LKR {{payment_amount}} for Invoice #{{invoice_number}} via {{payment_method}}.\n"
        "Remaining Balance: LKR {{balance_due}}.\n"
        "📄 Updated Bill: {{smart_bill_url}}"
    ),
    "payment_reminder": (
        "🔔 *Payment Reminder*\n"
        "Dear {{customer_name}}, this is a friendly reminder regarding Invoice #{{invoice_number}} from *{{store_name}}*.\n"
        "Outstanding Balance: *LKR {{balance_due}}*.\n"
        "📄 View Invoice: {{smart_bill_url}}"
    ),
    "refund_processed": (
        "🔄 *Refund Confirmation*\n"
        "Dear {{customer_name}}, a refund of LKR {{refund_amount}} for Invoice #{{invoice_number}} has been processed at *{{store_name}}*.\n"
        "Method: {{refund_method}}."
    ),

    # Repairs
    "repair_intake": (
        "🔧 *REPAIR TICKET REGISTERED*\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "👋 Hello *{{customer_name}}*,\n\n"
        "Your device has been received and checked in for repair at *{{store_name}}*:\n\n"
        "📋 *Job Ticket:* #{{job_number}}\n"
        "📱 *Device Model:* {{device_model}}\n"
        "🔍 *Reported Issue:* {{reported_issue}}\n"
        "💰 *Initial Advance:* LKR {{advance_paid}}\n"
        "⚡ *Current Status:* *{{repair_status}}*\n\n"
        "🌐 *Live Job Tracking:* {{repair_tracking_url}}\n"
        "📞 *Hotline:* {{store_phone}}\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "_We will notify you as soon as diagnosis is complete!_"
    ),
    "repair_estimate": (
        "📋 *REPAIR ESTIMATE & DIAGNOSIS*\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "👋 Hello *{{customer_name}}*,\n\n"
        "The technician diagnosis for Job #{{job_number}} ({{device_model}}) is complete:\n\n"
        "🔍 *Diagnostic Findings:* {{technician_notes}}\n"
        "💵 *Estimated Cost:* LKR {{estimate_amount}}\n"
        "💰 *Advance Paid:* LKR {{advance_paid}}\n"
        "💳 *Estimated Balance:* LKR {{balance_due}}\n\n"
        "🌐 *Approve or View Details:* {{repair_tracking_url}}\n"
        "Please reply *YES* to approve this repair work.\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "_Thank you for choosing {{store_name}}!_"
    ),
    "repair_status": (
        "🛠️ *REPAIR JOB STATUS UPDATE*\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "👋 Hello *{{customer_name}}*,\n\n"
        "Here is the latest progress on your repair with *{{store_name}}*:\n\n"
        "📋 *Job Ticket:* #{{job_number}}\n"
        "📱 *Device:* {{device_model}}\n"
        "🔍 *Reported Issue:* {{reported_issue}}\n"
        "⚡ *Current Status:* *{{repair_status}}*\n"
        "📝 *Status Note:* {{status_note}}\n\n"
        "💰 *Financial Breakdown:*\n"
        "• Estimated Total: LKR {{estimated_cost}}\n"
        "• Advance Paid: LKR {{advance_paid}}\n"
        "• *Balance Due: LKR {{balance_due}}*\n\n"
        "🌐 *Live Tracking:* {{repair_tracking_url}}\n"
        "📞 *Support Hotline:* {{store_phone}}\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "_Thank you for your patience while we service your device._"
    ),
    "repair_completed": (
        "🎉 *REPAIR COMPLETED & READY FOR PICKUP!*\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "👋 Hello *{{customer_name}}*,\n\n"
        "Great news! Your device has been successfully repaired, tested, and is ready for pickup:\n\n"
        "📋 *Job Ticket:* #{{job_number}}\n"
        "📱 *Device Model:* {{device_model}}\n"
        "🔍 *Service Done:* {{reported_issue}}\n"
        "✅ *Final Status:* *Completed & Quality Checked*\n"
        "📝 *Technician Note:* {{status_note}}\n\n"
        "💰 *Payment Summary:*\n"
        "• Total Cost: LKR {{estimated_cost}}\n"
        "• Advance Paid: LKR {{advance_paid}}\n"
        "• *Balance Payable: LKR {{balance_due}}*\n\n"
        "📍 *Pickup Location:* {{store_address}}\n"
        "⏰ *Store Hours:* 9:00 AM – 8:00 PM\n"
        "📞 *Hotline:* {{store_phone}}\n\n"
        "Please present this message or your job ticket when collecting your device.\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "_Thank you for trusting {{store_name}}!_"
    ),
    "repair_collected": (
        "📦 *DEVICE HANDOVER & WARRANTY CONFIRMATION*\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "👋 Thank you *{{customer_name}}*!\n\n"
        "Your repair job #{{job_number}} ({{device_model}}) has been completed and collected.\n\n"
        "🛡️ *Service Warranty:* {{warranty_period}}\n"
        "🧾 *Receipt/Warranty Slip:* {{repair_tracking_url}}\n\n"
        "📞 *Hotline:* {{store_phone}}\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "_We appreciate your business with {{store_name}}!_"
    ),

    # Warranty
    "warranty_registered": (
        "🛡️ *Warranty Registered*\n"
        "Dear {{customer_name}}, warranty for *{{product_name}}* (S/N: {{serial_number}}) is active until *{{expiry_date}}*.\n"
        "Store: {{store_name}}"
    ),
    "warranty_expiring": (
        "⚠️ *Warranty Expiring Soon*\n"
        "Dear {{customer_name}}, the warranty for your *{{product_name}}* (S/N: {{serial_number}}) will expire on *{{expiry_date}}*.\n"
        "Contact *{{store_name}}* at {{store_phone}} for renewals or service."
    ),

    # Customer & Alerts
    "customer_welcome": (
        "👋 Welcome to *{{store_name}}*, {{customer_name}}!\n"
        "Thank you for registering with us. We look forward to serving you.\n"
        "📞 Hotline: {{store_phone}} | 🌐 {{store_website}}"
    ),
    "security_alert": (
        "⚠️ *Security Alert - Manager Override*\n"
        "A manager PIN override was used for Transaction #{{transaction_id}} on {{current_date}} at {{current_time}}.\n"
        "User: {{staff_name}} | Reason: {{override_reason}}"
    ),

    # 2-Way Self-Service Chatbot
    "bot_greeting": (
        "👋 *Hello {{customer_name}}! Welcome to {{store_name}} ERP Digital Care.* 📱✨\n\n"
        "How can we help you today? Please reply with a number:\n\n"
        "*1* ➔ View my latest *Digital Bill & Receipt*\n"
        "*2* ➔ Check live *Repair Job Status* & Milestones\n"
        "*3* ➔ Check registered *Device Warranties*\n"
        "*4* ➔ Store Location, Hours & *Support Hotline*\n\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "_You can reply with 1, 2, 3, or 4 at any time._"
    ),
    "bot_bill_lookup": (
        "🧾 *DIGITAL BILL LOOKUP*\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "👋 Hello *{{customer_name}}*,\n\n"
        "Here is your latest verified invoice from *{{store_name}}*:\n\n"
        "📋 *Invoice No:* #{{invoice_number}}\n"
        "📅 *Date:* {{invoice_date}}\n"
        "💰 *Total Amount:* LKR {{invoice_total}}\n"
        "💳 *Payment Method:* {{payment_method}}\n"
        "💵 *Paid / Balance:* LKR {{paid_amount}} / LKR {{balance_due}}\n\n"
        "📄 *Instant PDF Bill & Receipt:* {{smart_bill_url}}\n\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "_Thank you for choosing {{store_name}}!_"
    ),
    "bot_repair_status": (
        "🛠️ *LIVE REPAIR STATUS TRACKER*\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "👋 Hello *{{customer_name}}*,\n\n"
        "Here is your active repair progress at *{{store_name}}*:\n\n"
        "📋 *Ticket Number:* #{{job_number}}\n"
        "📱 *Device Model:* {{device_model}}\n"
        "⚡ *Current Stage:* *{{repair_status}}*\n"
        "📝 *Technician Note:* {{status_note}}\n"
        "💰 *Advance Paid:* LKR {{advance_paid}}\n"
        "💳 *Balance Payable:* LKR {{balance_due}}\n\n"
        "🌐 *Full Milestone Tracker:* {{repair_tracking_url}}\n\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "_We'll notify you as soon as your device is ready for pickup!_"
    ),
    "bot_warranty_check": (
        "🛡️ *ACTIVE DEVICE WARRANTIES*\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "👋 Hello *{{customer_name}}*,\n\n"
        "Registered warranty coverage with *{{store_name}}*:\n\n"
        "📱 *Product:* {{product_name}}\n"
        "🔢 *Serial / IMEI:* {{serial_number}}\n"
        "📅 *Valid Until:* {{expiry_date}}\n"
        "⚡ *Status:* *ACTIVE & VERIFIED*\n\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "_For warranty claims, please bring your device to our store with this reference._"
    ),
    "bot_store_info": (
        "🏬 *STORE LOCATION & SUPPORT*\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "📍 *Store Address:* {{store_address}}\n"
        "⏰ *Working Hours:* Mon - Sat: 9:00 AM – 8:00 PM | Sun: 9:30 AM – 6:00 PM\n"
        "📞 *Direct Phone / WhatsApp:* {{store_phone}}\n"
        "🌐 *Website / Portal:* {{store_website}}\n\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "_Feel free to visit us or message our team here!_"
    ),
}

TEMPLATE_METADATA = {
    "pos_receipt": {
        "name": "POS Sales Receipt",
        "category": "sales",
        "variables": ["customer_name", "store_name", "invoice_number", "invoice_date", "invoice_total", "subtotal", "discount_amount", "paid_amount", "balance_due", "payment_method", "smart_bill_url", "store_phone"],
        "description": "Triggered when a point-of-sale checkout is completed."
    },
    "invoice_created": {
        "name": "Invoice Created & Smart Bill",
        "category": "sales",
        "variables": ["customer_name", "store_name", "invoice_number", "invoice_date", "invoice_total", "paid_amount", "balance_due", "smart_bill_url", "store_phone"],
        "description": "Triggered when any commercial invoice is created."
    },
    "payment_receipt": {
        "name": "Payment Receipt Confirmation",
        "category": "payments",
        "variables": ["customer_name", "store_name", "invoice_number", "payment_amount", "payment_method", "balance_due", "smart_bill_url", "store_phone"],
        "description": "Triggered when invoice payment is recorded."
    },
    "payment_reminder": {
        "name": "Outstanding Payment Reminder",
        "category": "payments",
        "variables": ["customer_name", "store_name", "invoice_number", "balance_due", "smart_bill_url", "store_phone"],
        "description": "Sent for overdue or credit sales."
    },
    "refund_processed": {
        "name": "Refund Confirmation",
        "category": "sales",
        "variables": ["customer_name", "store_name", "invoice_number", "refund_amount", "refund_method", "store_phone"],
        "description": "Triggered upon product return or refund."
    },
    "repair_intake": {
        "name": "Repair Intake Registration",
        "category": "repairs",
        "variables": ["customer_name", "store_name", "job_number", "device_model", "reported_issue", "advance_paid", "repair_status", "repair_tracking_url", "store_phone"],
        "description": "Sent immediately upon receiving a device."
    },
    "repair_estimate": {
        "name": "Repair Cost Estimate",
        "category": "repairs",
        "variables": ["customer_name", "store_name", "job_number", "device_model", "estimate_amount", "advance_paid", "balance_due", "technician_notes", "repair_tracking_url", "store_phone"],
        "description": "Sent when technician completes diagnostic."
    },
    "repair_status": {
        "name": "Repair Status Change",
        "category": "repairs",
        "variables": ["customer_name", "store_name", "job_number", "device_model", "reported_issue", "repair_status", "status_note", "estimated_cost", "advance_paid", "balance_due", "repair_tracking_url", "store_phone"],
        "description": "Triggered on any repair ticket status change."
    },
    "repair_completed": {
        "name": "Repair Ready for Pickup",
        "category": "repairs",
        "variables": ["customer_name", "store_name", "job_number", "device_model", "reported_issue", "status_note", "estimated_cost", "advance_paid", "balance_due", "store_address", "store_phone"],
        "description": "Triggered when repair status changes to Ready for Pickup."
    },
    "repair_collected": {
        "name": "Repair Collected / Handover",
        "category": "repairs",
        "variables": ["customer_name", "store_name", "job_number", "device_model", "warranty_period", "repair_tracking_url", "store_phone"],
        "description": "Triggered when customer collects their repaired device."
    },
    "warranty_registered": {
        "name": "Warranty Registration",
        "category": "warranty",
        "variables": ["customer_name", "store_name", "product_name", "serial_number", "expiry_date", "store_phone"],
        "description": "Sent when a serialized product warranty is registered."
    },
    "warranty_expiring": {
        "name": "Warranty Expiry Reminder",
        "category": "warranty",
        "variables": ["customer_name", "store_name", "product_name", "serial_number", "expiry_date", "store_phone"],
        "description": "Automated reminder sent 30 days before expiration."
    },
    "customer_welcome": {
        "name": "Customer Welcome",
        "category": "customer",
        "variables": ["customer_name", "store_name", "store_phone", "store_website"],
        "description": "Sent upon creating a new customer profile."
    },
    "security_alert": {
        "name": "Manager Security Override Alert",
        "category": "system",
        "variables": ["transaction_id", "current_date", "current_time", "staff_name", "override_reason"],
        "description": "Internal security alert sent to store manager."
    },
    "bot_greeting": {
        "name": "Bot Menu: Welcome & Options",
        "category": "chatbot",
        "variables": ["customer_name", "store_name", "store_phone"],
        "description": "Automated self-service menu sent when customers text Hi, Menu, Help, etc."
    },
    "bot_bill_lookup": {
        "name": "Bot Reply: Option 1 (Digital Bill)",
        "category": "chatbot",
        "variables": ["customer_name", "store_name", "invoice_number", "invoice_date", "invoice_total", "paid_amount", "balance_due", "payment_method", "smart_bill_url", "store_phone"],
        "description": "Automated response sent when customer requests Option 1 (Bill/Invoice)."
    },
    "bot_repair_status": {
        "name": "Bot Reply: Option 2 (Repair Tracker)",
        "category": "chatbot",
        "variables": ["customer_name", "store_name", "job_number", "device_model", "repair_status", "status_note", "advance_paid", "balance_due", "repair_tracking_url", "store_phone"],
        "description": "Automated response sent when customer requests Option 2 (Repair Status)."
    },
    "bot_warranty_check": {
        "name": "Bot Reply: Option 3 (Warranty Check)",
        "category": "chatbot",
        "variables": ["customer_name", "store_name", "product_name", "serial_number", "expiry_date", "store_phone"],
        "description": "Automated response sent when customer requests Option 3 (Device Warranty)."
    },
    "bot_store_info": {
        "name": "Bot Reply: Option 4 (Store & Hours)",
        "category": "chatbot",
        "variables": ["store_name", "store_address", "store_phone", "store_website"],
        "description": "Automated response sent when customer requests Option 4 (Store Location/Hours)."
    }
}


# ─── Phone Normalization ──────────────────────────────────────────────────────

def normalize_sri_lankan_phone(phone: str, default_cc: str = "94") -> str:
    """
    Normalizes any Sri Lankan or international phone number:
      0764158980       → 94764158980
      +94764158980     → 94764158980
      94764158980      → 94764158980
      764158980        → 94764158980
      +193398820618326 → 193398820618326
    """
    if not phone:
        return ""
    digits = re.sub(r"[^\d]", "", str(phone))
    if not digits:
        return ""
    if digits.startswith("0") and len(digits) == 10:
        return default_cc + digits[1:]
    if len(digits) == 9 and digits.startswith("7"):
        return default_cc + digits
    if len(digits) >= 7 and len(digits) <= 18:
        return digits
    return ""


# ─── Pipeline Tracer Helper ───────────────────────────────────────────────────

class PipelineTracer:
    """Utility to maintain structured step-by-step diagnostic records for each message."""
    @staticmethod
    def create_trace(initial_step: str = "TRIGGER_RECEIVED", detail: str = "") -> List[Dict[str, Any]]:
        return [{
            "step": initial_step,
            "status": "OK",
            "time": datetime.utcnow().isoformat(),
            "detail": detail
        }]

    @staticmethod
    def append_step(trace_json: Optional[str], step: str, status: str = "OK", detail: str = "") -> str:
        trace = []
        if trace_json:
            try:
                trace = json.loads(trace_json)
                if not isinstance(trace, list):
                    trace = []
            except Exception:
                trace = []
        trace.append({
            "step": step,
            "status": status,
            "time": datetime.utcnow().isoformat(),
            "detail": detail
        })
        return json.dumps(trace)


# ─── Provider Abstraction Layer ───────────────────────────────────────────────

class BaseWhatsAppProvider(ABC):
    @abstractmethod
    async def send_text(self, phone: str, message: str) -> Dict[str, Any]:
        pass

    @abstractmethod
    async def send_media(self, phone: str, media_url: str, caption: str = "", filename: str = "receipt_qr.png") -> Dict[str, Any]:
        pass

    @abstractmethod
    async def check_number(self, phone: str) -> Dict[str, Any]:
        pass

    @abstractmethod
    async def get_service_status(self) -> Dict[str, Any]:
        pass


class LocalWebWhatsAppProvider(BaseWhatsAppProvider):
    """Communicates with the Node.js whatsapp-web.js microservice."""

    def __init__(self, service_url: str = WHATSAPP_SERVICE_URL, secret: Optional[str] = WHATSAPP_SERVICE_SECRET):
        self.service_url = service_url
        self.secret = secret

    def _get_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.secret:
            headers["X-Internal-Secret"] = self.secret
        return headers

    async def send_text(self, phone: str, message: str) -> Dict[str, Any]:
        url = f"{self.service_url}/api/send-message"
        payload = {"phone": phone, "message": message}
        try:
            async with httpx.AsyncClient(timeout=18.0) as client:
                res = await client.post(url, json=payload, headers=self._get_headers())
                return res.json()
        except httpx.ConnectError:
            return {"success": False, "status": "OFFLINE", "error": "WhatsApp microservice is offline or unreachable."}
        except httpx.TimeoutException:
            return {"success": False, "status": "TIMEOUT", "error": "WhatsApp microservice request timed out."}
        except Exception as e:
            return {"success": False, "status": "ERROR", "error": str(e)}

    async def send_media(
        self,
        phone: str,
        media_url: Optional[str] = None,
        caption: str = "",
        filename: str = "attachment.png",
        media_base64: Optional[str] = None,
        mimetype: Optional[str] = None
    ) -> Dict[str, Any]:
        url = f"{self.service_url}/api/send-media"
        payload = {
            "phone": phone,
            "mediaUrl": media_url,
            "mediaBase64": media_base64,
            "mimetype": mimetype,
            "caption": caption,
            "filename": filename
        }
        try:
            async with httpx.AsyncClient(timeout=25.0) as client:
                res = await client.post(url, json=payload, headers=self._get_headers())
                if res.status_code in [200, 201]:
                    data = res.json()
                    if data.get("success"):
                        return data
                # Fallback to plain text if media download / sending failed
                logger.warning(f"[WhatsApp] send-media returned non-success ({res.status_code}), falling back to text.")
                return await self.send_text(phone, caption)
        except Exception as e:
            logger.warning(f"[WhatsApp] send-media error ({e}), falling back to text delivery.")
            return await self.send_text(phone, caption)

    async def check_number(self, phone: str) -> Dict[str, Any]:
        url = f"{self.service_url}/api/check-number/{phone}"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get(url, headers=self._get_headers())
                return res.json()
        except Exception as e:
            return {"success": False, "error": str(e), "isRegistered": False}

    async def get_service_status(self) -> Dict[str, Any]:
        url = f"{self.service_url}/status"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.get(url)
                return res.json()
        except Exception as e:
            return {"success": False, "status": "OFFLINE", "error": str(e)}


# Singleton provider instance
whatsapp_provider = LocalWebWhatsAppProvider()


# ─── Template Substitution Engine ─────────────────────────────────────────────

def resolve_store_variables(db: Session) -> Dict[str, str]:
    """Extracts store details from Settings."""
    store_name = "I-Store ERP"
    store_phone = "+94 77 123 4567"
    store_address = "Colombo, Sri Lanka"
    store_website = "https://i-store.app"

    try:
        settings = db.query(SecuritySetting).all()
        s_map = {s.key: s.value for s in settings}
        if "store_name" in s_map and s_map["store_name"]:
            store_name = s_map["store_name"]
        if "store_phone" in s_map and s_map["store_phone"]:
            store_phone = s_map["store_phone"]
        if "store_address" in s_map and s_map["store_address"]:
            store_address = s_map["store_address"]
        if "store_website" in s_map and s_map["store_website"]:
            store_website = s_map["store_website"]
    except Exception:
        pass

    now = datetime.now()
    return {
        "store_name": store_name,
        "store_phone": store_phone,
        "store_address": store_address,
        "store_website": store_website,
        "current_date": now.strftime("%Y-%m-%d"),
        "current_time": now.strftime("%I:%M %p"),
    }


def render_template(template_body: str, variables: Dict[str, Any]) -> str:
    """Substitutes placeholders like {{customer_name}} with real values."""
    rendered = template_body
    for key, value in variables.items():
        placeholder = f"{{{{{key}}}}}"
        rendered = rendered.replace(placeholder, str(value if value is not None else ""))
    return rendered


def get_template_body(db: Session, event_type: str) -> str:
    tmpl = (
        db.query(WhatsAppTemplate)
        .filter(WhatsAppTemplate.event_type == event_type, WhatsAppTemplate.is_active == True)
        .first()
    )
    if tmpl and tmpl.template_body:
        return tmpl.template_body
    return DEFAULT_TEMPLATES.get(event_type, "")


def is_event_automation_enabled(db: Session, event_type: str) -> bool:
    """Checks if the given event type has automated WhatsApp notifications enabled in automation rules."""
    rule = db.query(WhatsAppAutomationRule).filter(WhatsAppAutomationRule.event_type == event_type).first()
    if rule is not None:
        return bool(rule.is_enabled)
    return True  # Enabled by default if no rule explicitly overrides


# ─── High-Level Event Dispatcher with Durable Queue ───────────────────────────

async def dispatch_whatsapp_event(
    event_type: str,
    phone: str,
    variables: Dict[str, Any],
    customer_id: Optional[int] = None,
    user_id: Optional[int] = None,
    invoice_no: Optional[str] = None,
    repair_no: Optional[str] = None,
    trigger_type: str = "automatic",
    is_marketing: bool = False,
    media_url: Optional[str] = None
) -> Dict[str, Any]:
    """
    High-level event dispatcher:
      1. Normalizes phone number
      2. Validates customer opt-in consent
      3. Validates event automation rule is enabled
      4. Renders template with store + event variables
      5. Creates WhatsAppMessageLog entry with pipeline trace
      6. Enqueues or immediately dispatches to WhatsApp Provider (Text or Media+Caption)
    """
    clean_phone = normalize_sri_lankan_phone(phone)
    if not clean_phone:
        logger.warning(f"[WhatsApp] Skipping dispatch for {event_type}: invalid phone '{phone}'")
        return {"success": False, "error": f"Invalid phone format: '{phone}'"}

    db: Session = SessionLocal()
    try:
        # Check if event automation is enabled
        if trigger_type == "automatic" and not is_event_automation_enabled(db, event_type):
            logger.info(f"[WhatsApp] Automation for event '{event_type}' is currently toggled OFF in rules. Skipping dispatch.")
            return {"success": False, "skipped": True, "reason": f"Automation rule for '{event_type}' is disabled."}

        # Check customer opt-in
        if customer_id:
            cust = db.query(Customer).filter(Customer.id == customer_id).first()
            if cust:
                if cust.whatsapp_opt_in is False:
                    logger.info(f"[WhatsApp] Customer #{customer_id} opted out of WhatsApp. Skipping.")
                    return {"success": False, "error": "Customer opted out of WhatsApp notifications."}
                if is_marketing and not cust.whatsapp_marketing_opt_in:
                    logger.info(f"[WhatsApp] Customer #{customer_id} opted out of marketing. Skipping.")
                    return {"success": False, "error": "Customer opted out of marketing communications."}

        # Resolve all variables
        store_vars = resolve_store_variables(db)
        all_vars = {**store_vars, **variables}

        template_body = get_template_body(db, event_type)
        if not template_body:
            return {"success": False, "error": f"No active template found for '{event_type}'."}

        message_text = render_template(template_body, all_vars)
        meta = TEMPLATE_METADATA.get(event_type, {})

        # Create Initial Log Entry with Pipeline Trace
        trace = PipelineTracer.create_trace("TRIGGER_RECEIVED", f"Event '{event_type}' triggered for {clean_phone}")
        trace_json = json.dumps(trace)
        trace_json = PipelineTracer.append_step(trace_json, "TEMPLATE_RENDERED", "OK", f"Template '{meta.get('name', event_type)}' resolved")

        log_entry = WhatsAppMessageLog(
            id=str(uuid.uuid4()),
            customer_id=customer_id,
            user_id=user_id,
            phone_number=clean_phone,
            event_type=event_type,
            category=meta.get("category", "sales"),
            template_name=meta.get("name", event_type),
            message_body=message_text,
            status="QUEUED",
            trigger_type=trigger_type,
            invoice_no=invoice_no,
            repair_no=repair_no,
            pipeline_trace=trace_json
        )
        db.add(log_entry)
        db.commit()

        # Dispatch through provider
        trace_json = PipelineTracer.append_step(log_entry.pipeline_trace, "DISPATCHING_TO_PROVIDER", "OK", f"Sending HTTP request ({'Media+Caption' if media_url else 'Text'}) to WhatsApp microservice")
        log_entry.pipeline_trace = trace_json
        db.commit()

        if media_url:
            res = await whatsapp_provider.send_media(clean_phone, media_url, caption=message_text, filename="official_receipt_qr.png")
        else:
            res = await whatsapp_provider.send_text(clean_phone, message_text)

        if res.get("success"):
            log_entry.status = res.get("status", "SENT")
            log_entry.message_id = res.get("messageId", f"sent-{int(datetime.utcnow().timestamp() * 1000)}")
            log_entry.ack_status = res.get("ack", "PENDING")
            log_entry.sent_at = datetime.utcnow()
            log_entry.pipeline_trace = PipelineTracer.append_step(
                log_entry.pipeline_trace,
                "PROVIDER_ACCEPTED",
                "OK",
                f"WhatsApp accepted message. ID: {log_entry.message_id} • ACK: {log_entry.ack_status}"
            )
            db.commit()
            return {"success": True, "message_id": log_entry.message_id, "status": log_entry.status, "log_id": log_entry.id}
        else:
            err = res.get("error", "Dispatch failed")
            status = res.get("status", "FAILED")
            log_entry.status = "FAILED"
            log_entry.error_detail = f"[{status}] {err}"
            log_entry.pipeline_trace = PipelineTracer.append_step(
                log_entry.pipeline_trace,
                "PROVIDER_REJECTED",
                "FAILED",
                f"Reason: {err} (status={status})"
            )
            db.commit()
            return {"success": False, "error": err, "status": status, "log_id": log_entry.id}

    except Exception as e:
        logger.exception(f"[WhatsApp] Unexpected error in dispatch_whatsapp_event: {e}")
        return {"success": False, "error": str(e)}
    finally:
        db.close()


def log_and_send_whatsapp(event_type: str, phone: str, variables: Dict[str, Any], customer_id: Optional[int] = None, **kwargs):
    """
    Synchronous bridge for background tasks (FastAPI BackgroundTasks or thread workers).
    Runs dispatch_whatsapp_event inside an event loop.
    """
    import asyncio
    try:
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import threading
                def _run():
                    asyncio.run(dispatch_whatsapp_event(
                        event_type=event_type,
                        phone=phone,
                        variables=variables,
                        customer_id=customer_id,
                        **kwargs
                    ))
                threading.Thread(target=_run, daemon=True).start()
                return
        except Exception:
            pass
        asyncio.run(dispatch_whatsapp_event(
            event_type=event_type,
            phone=phone,
            variables=variables,
            customer_id=customer_id,
            **kwargs
        ))
    except Exception as err:
        logger.warning(f"[WhatsApp] log_and_send_whatsapp error: {err}")

