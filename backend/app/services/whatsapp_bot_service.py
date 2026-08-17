import re
import json
import urllib.parse
from datetime import datetime, time
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc, or_

from app.models import Customer, Sale, RepairTicket, WarrantyRecord, WhatsAppTemplate, WhatsAppBotRule, WhatsAppAutomationRule, SecuritySetting
from app.services.supabase_pos_sync import generate_invoice_token
from app.utils.whatsapp_helper import (
    resolve_store_variables,
    normalize_sri_lankan_phone,
    DEFAULT_TEMPLATES,
    whatsapp_provider
)


def _render_bot_template(db: Session, event_type: str, context: Dict[str, Any], fallback: str) -> str:
    """Fetches user-customized template from database or uses default/fallback with variable replacement."""
    try:
        tmpl = db.query(WhatsAppTemplate).filter(
            WhatsAppTemplate.event_type == event_type,
            WhatsAppTemplate.is_active == True  # noqa: E712
        ).first()
        body = tmpl.template_body if tmpl and tmpl.template_body else DEFAULT_TEMPLATES.get(event_type, fallback)
    except Exception:
        body = DEFAULT_TEMPLATES.get(event_type, fallback)

    # Perform placeholder substitution
    for k, v in context.items():
        placeholder = "{{" + str(k) + "}}"
        body = body.replace(placeholder, str(v if v is not None else ""))
    return body


def _check_away_message(db: Session, store_info: Dict[str, Any], cust_name: str) -> Optional[str]:
    """Checks if current time falls outside business hours and away message is enabled."""
    try:
        rule = db.query(WhatsAppAutomationRule).filter(WhatsAppAutomationRule.event_type == "away_message").first()
        if rule and not rule.is_enabled:
            return None

        settings = {s.key: s.value for s in db.query(SecuritySetting).all()}
        away_enabled = settings.get("whatsapp_away_enabled") == "true"
        if not away_enabled:
            return None

        # Business hours check (e.g. 09:00 to 20:00)
        start_str = settings.get("whatsapp_away_start_time", "09:00")
        end_str = settings.get("whatsapp_away_end_time", "20:00")
        
        now = datetime.now()
        current_hm = now.strftime("%H:%M")
        
        # Check active days (0=Mon, 6=Sun)
        active_days_str = settings.get("whatsapp_away_days", "0,1,2,3,4,5,6")
        active_days = [int(d.strip()) for d in active_days_str.split(",") if d.strip().isdigit()]
        
        is_away = False
        if now.weekday() not in active_days:
            is_away = True
        elif start_str <= end_str:
            is_away = not (start_str <= current_hm < end_str)
        else: # overnight shift
            is_away = not (current_hm >= start_str or current_hm < end_str)

        if is_away:
            default_away = (
                "🌙 *Hello {{customer_name}}!*\n"
                "Thank you for contacting *{{store_name}}*.\n\n"
                "Our store is currently closed. Our business hours are:\n"
                "⏰ *Mon – Sun: 9:00 AM – 8:00 PM*\n\n"
                "Your message has been received and our team will get back to you as soon as we open!\n\n"
                "📞 Hotline: {{store_phone}}"
            )
            raw_body = settings.get("whatsapp_away_text") or default_away
            ctx = {
                "customer_name": cust_name,
                "store_name": store_info.get("store_name", "I-Store"),
                "store_phone": store_info.get("store_phone", "+94 77 123 4567"),
                "store_address": store_info.get("store_address", "Colombo, Sri Lanka"),
                "current_time": now.strftime("%I:%M %p"),
                "current_date": now.strftime("%Y-%m-%d"),
            }
            for k, v in ctx.items():
                raw_body = raw_body.replace("{{" + k + "}}", str(v))
            return raw_body
    except Exception:
        pass
    return None


def _check_custom_bot_rules(db: Session, text: str, store_info: Dict[str, Any], cust_name: str) -> Optional[str]:
    """Matches incoming message against custom keyword rules defined by manager."""
    try:
        rules = (
            db.query(WhatsAppBotRule)
            .filter(WhatsAppBotRule.is_active == True)  # noqa: E712
            .order_by(desc(WhatsAppBotRule.priority), desc(WhatsAppBotRule.id))
            .all()
        )
        norm_text = text.lower().strip()
        
        ctx = {
            "customer_name": cust_name,
            "store_name": store_info.get("store_name", "I-Store"),
            "store_phone": store_info.get("store_phone", "+94 77 123 4567"),
            "store_address": store_info.get("store_address", "Colombo, Sri Lanka"),
            "store_website": "https://i-store-customer-portal-one.vercel.app"
        }

        for rule in rules:
            keywords = [k.strip().lower() for k in (rule.keywords or "").split(",") if k.strip()]
            matched = False

            if rule.match_type == "exact":
                matched = any(norm_text == kw for kw in keywords)
            elif rule.match_type == "startswith":
                matched = any(norm_text.startswith(kw) for kw in keywords)
            else: # contains
                matched = any(kw in norm_text for kw in keywords)

            if matched:
                rendered = rule.response_body
                for k, v in ctx.items():
                    rendered = rendered.replace("{{" + k + "}}", str(v))
                return rendered
    except Exception:
        pass
    return None


def process_incoming_bot_message(db: Session, sender_phone: str, message_text: str) -> Optional[str]:
    """
    Parses incoming message text from a customer and returns an automated reply string.
    Returns None if no auto-reply should be sent (e.g. system noise).
    """
    clean_phone = normalize_sri_lankan_phone(sender_phone) or sender_phone
    if not clean_phone:
        return None

    # Check if bot auto replies are enabled globally
    bot_rule = db.query(WhatsAppAutomationRule).filter(WhatsAppAutomationRule.event_type == "bot_auto_reply").first()
    if bot_rule and not bot_rule.is_enabled:
        return None

    store_info = resolve_store_variables(db)
    store_name = store_info.get("store_name", "I-Store")
    store_phone = store_info.get("store_phone", "+94 77 123 4567")
    store_addr = store_info.get("store_address", "Colombo, Sri Lanka")

    # Match customer in database by phone (check local formats: 07..., 947..., 7...)
    phone_variants = [clean_phone]
    if clean_phone.startswith("94") and len(clean_phone) == 11:
        phone_variants.append("0" + clean_phone[2:])
        phone_variants.append(clean_phone[2:])
    elif clean_phone.startswith("0") and len(clean_phone) == 10:
        phone_variants.append("94" + clean_phone[1:])
        phone_variants.append(clean_phone[1:])

    customer = db.query(Customer).filter(
        or_(Customer.phone.in_(phone_variants), Customer.whatsapp_number.in_(phone_variants))
    ).first()
    cust_name = customer.name if customer else "Valued Customer"

    raw_text = (message_text or "").strip()
    
    # 1. First priority: Check Away / After-Hours message if store is closed
    away_reply = _check_away_message(db, store_info, cust_name)
    if away_reply:
        return away_reply

    # 2. Second priority: Custom Keyword Bot Rules (User Configured)
    custom_bot_reply = _check_custom_bot_rules(db, raw_text, store_info, cust_name)
    if custom_bot_reply:
        return custom_bot_reply

    portal_base = "https://i-store-customer-portal-one.vercel.app"
    text = raw_text.upper()
    tokens = text.split()
    first_token = tokens[0] if tokens else ""

    # Match intent flags
    is_opt1 = (
        text in ["1", "1.", "1)", "BILL", "INVOICE", "RECEIPT", "PAYMENT", "OPTION 1", "REPLY 1", "VIEW BILL"]
        or first_token in ["1", "1.", "1)"]
        or any(k in text for k in ["LATEST BILL", "MY BILL", "MY INVOICE", "DIGITAL BILL", "SHOW BILL"])
    )

    job_match = re.search(r'(JOB|REP)[-\d]+', text)
    is_opt2 = (
        text in ["2", "2.", "2)", "REPAIR", "JOB", "STATUS", "SERVICE", "OPTION 2", "REPLY 2", "TRACK REPAIR"]
        or first_token in ["2", "2.", "2)"]
        or any(k in text for k in ["MY REPAIR", "JOB STATUS", "REPAIR STATUS"])
        or bool(job_match)
    )

    is_opt3 = (
        text in ["3", "3.", "3)", "WARRANTY", "GUARANTEE", "SERIAL", "OPTION 3", "REPLY 3", "CHECK WARRANTY"]
        or first_token in ["3", "3.", "3)"]
        or any(k in text for k in ["MY WARRANTY", "WARRANTY STATUS"])
    )

    is_opt4 = (
        text in ["4", "4.", "4)", "HOURS", "LOCATION", "CONTACT", "STORE", "ADDRESS", "OPTION 4", "REPLY 4"]
        or first_token in ["4", "4.", "4)"]
        or any(k in text for k in ["STORE HOURS", "STORE LOCATION", "CONTACT INFO", "PHONE NUMBER"])
    )

    # ─── Option 1: Latest Invoice / Bill ───────────────────────────────────────
    if is_opt1:
        sale = None
        if customer:
            sale = db.query(Sale).filter(
                Sale.customer_id == customer.id,
                Sale.is_voided == False  # noqa: E712
            ).order_by(desc(Sale.id)).first()

        if sale:
            inv_no = getattr(sale, "invoice_no", None) or f"INV-2026-{sale.id:06d}"
            token = generate_invoice_token(inv_no)
            total_amt = float(getattr(sale, "total", 0) or 0)
            subtotal_amt = float(getattr(sale, "subtotal", total_amt) or total_amt)
            disc_amt = float(getattr(sale, "discount_amount", 0) or 0)
            pay_method = getattr(sale, "payment_method", "Cash") or "Cash"
            bill_url = (
                f"{portal_base}/invoice/{inv_no}?token={token}"
                f"&name={urllib.parse.quote(cust_name)}"
                f"&total={total_amt:.2f}"
                f"&subtotal={subtotal_amt:.2f}"
                f"&disc={disc_amt:.2f}"
                f"&phone={clean_phone}"
                f"&method={urllib.parse.quote(pay_method)}"
            )

            ctx = {
                "customer_name": cust_name,
                "store_name": store_name,
                "invoice_number": inv_no,
                "invoice_date": getattr(sale, "created_at", datetime.now()).strftime("%Y-%m-%d") if getattr(sale, "created_at", None) else "Recent",
                "invoice_total": f"{total_amt:,.2f}",
                "subtotal": f"{subtotal_amt:,.2f}",
                "discount_amount": f"{disc_amt:,.2f}",
                "paid_amount": f"{float(getattr(sale, 'amount_paid', total_amt) or total_amt):,.2f}",
                "balance_due": f"{float(getattr(sale, 'balance_due', 0) or 0):,.2f}",
                "payment_method": pay_method,
                "smart_bill_url": bill_url,
                "store_phone": store_phone
            }
            return _render_bot_template(db, "bot_bill_lookup", ctx, (
                f"🧾 *YOUR LATEST DIGITAL INVOICE*\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"👋 Hello *{cust_name}*,\n\n"
                f"📋 *Invoice No:* #{inv_no}\n"
                f"💰 *Total Amount:* LKR {total_amt:,.2f}\n"
                f"💳 *Payment Method:* {pay_method}\n\n"
                f"📄 *Instant PDF Bill & Receipt:* {bill_url}\n\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"_Reply with 2 for Repairs, 3 for Warranty, or 4 for Store Info._"
            ))
        else:
            return (
                f"🧾 *DIGITAL BILL LOOKUP*\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"👋 Hello *{cust_name}*,\n\n"
                f"We couldn't find an invoice registered under your phone (+{clean_phone}) yet.\n\n"
                f"💡 If you have an Invoice number, please reply with your *INV-XXXXXX* or contact our hotline at {store_phone}."
            )

    # ─── Option 2: Live Repair Job Status ─────────────────────────────────────
    if is_opt2:
        ticket = None
        if job_match:
            ticket_id_str = job_match.group(0)
            ticket = db.query(RepairTicket).filter(
                (RepairTicket.ticket_no == ticket_id_str) | (RepairTicket.id == int(re.sub(r'[^\d]', '', ticket_id_str) or 0))
            ).first()

        if not ticket and customer:
            ticket = db.query(RepairTicket).filter(
                RepairTicket.customer_id == customer.id,
                RepairTicket.is_deleted == False  # noqa: E712
            ).order_by(desc(RepairTicket.id)).first()

        if not ticket:
            ticket = db.query(RepairTicket).filter(
                RepairTicket.is_deleted == False  # noqa: E712
            ).order_by(desc(RepairTicket.id)).first()

        if ticket:
            t_no = ticket.ticket_no or f"JOB-2026-{ticket.id:06d}"
            dev_model = ticket.device_model or "Device"
            issue_desc = ticket.issue or "Hardware Servicing"
            status_label = (ticket.status or "In Progress").title()
            est_cost = float(ticket.estimated_cost or 0)
            adv_paid = float(ticket.advance_payment or 0)
            bal_due = float(ticket.outstanding_balance or (est_cost - adv_paid))
            note_str = f"{ticket.condition_notes or ticket.notes}" if (ticket.condition_notes or ticket.notes) else "Device undergoing diagnostics"

            tracking_url = (
                f"{portal_base}/repair/{t_no}"
                f"?model={urllib.parse.quote(dev_model)}"
                f"&issue={urllib.parse.quote(issue_desc)}"
                f"&status={urllib.parse.quote(status_label)}"
                f"&est={est_cost:.2f}"
                f"&adv={adv_paid:.2f}"
                f"&bal={bal_due:.2f}"
                f"&name={urllib.parse.quote(cust_name)}"
                f"&phone={clean_phone}"
            )

            ctx = {
                "customer_name": cust_name,
                "store_name": store_name,
                "job_number": t_no,
                "device_model": dev_model,
                "reported_issue": issue_desc,
                "repair_status": status_label,
                "status_note": note_str,
                "estimated_cost": f"{est_cost:,.2f}",
                "advance_paid": f"{adv_paid:,.2f}",
                "balance_due": f"{bal_due:,.2f}",
                "repair_tracking_url": tracking_url,
                "store_phone": store_phone
            }

            return _render_bot_template(db, "bot_repair_status", ctx, (
                f"🛠️ *LIVE REPAIR JOB STATUS*\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"👋 Hello *{cust_name}*,\n\n"
                f"📋 *Job Ticket:* #{t_no}\n"
                f"📱 *Device Model:* {dev_model}\n"
                f"⚡ *Current Status:* *{status_label}*\n"
                f"📝 *Note:* {note_str}\n"
                f"💰 *Advance Paid:* LKR {adv_paid:,.2f}\n"
                f"💳 *Balance Due:* LKR {bal_due:,.2f}\n\n"
                f"🌐 *Track Live Milestone Progress:*\n{tracking_url}\n\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"_Reply with 1 for Bills, 3 for Warranty, or 4 for Store Info._"
            ))
        else:
            return (
                f"🛠️ *No Active Repairs Found*\n\n"
                f"We couldn't find an open repair ticket for this phone number.\n"
                f"If you have a ticket code (e.g. *JOB-2026-000001*), reply with your ticket code directly!"
            )

    # ─── Option 3: Active Warranty Check ──────────────────────────────────────
    if is_opt3:
        warranties = []
        if customer:
            warranties = db.query(WarrantyRecord).filter(
                WarrantyRecord.customer_id == customer.id,
                WarrantyRecord.status.in_(["active", "ACTIVE"])
            ).all()

        if warranties:
            w = warranties[0]
            ctx = {
                "customer_name": cust_name,
                "store_name": store_name,
                "product_name": w.product_name or "Device",
                "serial_number": w.serial_number or "N/A",
                "expiry_date": w.expiry_date.strftime("%B %d, %Y") if w.expiry_date else "Active",
                "store_phone": store_phone
            }
            return _render_bot_template(db, "bot_warranty_check", ctx, (
                f"🛡️ *YOUR ACTIVE DEVICE WARRANTIES*\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"👋 Hello *{cust_name}*,\n\n"
                f"📱 *Product:* {w.product_name or 'Device'}\n"
                f"🔢 *Serial / IMEI:* {w.serial_number or 'N/A'}\n"
                f"📅 *Valid Until:* {w.expiry_date.strftime('%B %d, %Y') if w.expiry_date else 'Active'}\n\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"_For warranty claims or service support, contact {store_phone}._"
            ))
        else:
            return (
                f"🛡️ *Device Warranty Lookup*\n\n"
                f"Hello {cust_name}, your active device warranties and serial numbers are digitally stored with your receipts.\n"
                f"Reply *1* to view your latest digital bill and warranty certificate!"
            )

    # ─── Option 4: Store Location, Hours & Support ────────────────────────────
    if is_opt4:
        ctx = {
            "store_name": store_name,
            "store_address": store_addr,
            "store_phone": store_phone,
            "store_website": portal_base
        }
        return _render_bot_template(db, "bot_store_info", ctx, (
            f"📍 *{store_name} — STORE INFORMATION*\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"🏬 *Address:* {store_addr}\n"
            f"⏰ *Opening Hours:* Monday – Sunday: 9:00 AM – 8:00 PM\n"
            f"📞 *Hotline:* {store_phone}\n"
            f"🌐 *Customer Portal:* {portal_base}\n\n"
            f"💬 Need to speak with a staff member? Just leave your question here and our team will get back to you shortly!\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"_Reply 1 for Bills, 2 for Repairs, 3 for Warranty._"
        ))

    # ─── Default Greeting / Menu ──────────────────────────────────────────────
    ctx = {
        "customer_name": cust_name,
        "store_name": store_name,
        "store_phone": store_phone
    }
    return _render_bot_template(db, "bot_greeting", ctx, (
        f"👋 *Hello {cust_name}! Welcome to {store_name} Digital Care.* 📱✨\n\n"
        f"How can we help you today? Please reply with a number:\n\n"
        f"*1* ➔ View my latest *Digital Bill & Receipt*\n"
        f"*2* ➔ Check live *Repair Job Status* & Milestones\n"
        f"*3* ➔ Check registered *Device Warranties*\n"
        f"*4* ➔ Store Location, Hours & *Support Hotline*\n\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"_You can reply with 1, 2, 3, or 4 at any time._"
    ))
