"""
ai_followup_service.py
======================
I-Store ERP — Automated WhatsApp Follow-Up Engine.
Manages controlled, safe, non-spam follow-ups with server-side eligibility checks, quiet hours, and cancellation hooks.
"""

import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, time as dtime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, desc

from app.models import (
    AIFollowUpRule, AIFollowUpLog, AIOptOut, Customer, Sale,
    ProductReservation, RepairTicket, WhatsAppConversationSession, WhatsAppMessageLog
)
from app.utils.time import utcnow
from app.utils.whatsapp_helper import normalize_sri_lankan_phone, whatsapp_provider

logger = logging.getLogger("istore.ai_followup")

# Default rule templates if none configured
DEFAULT_FOLLOW_UP_RULES = [
    {
        "name": "Product Inquiry Follow-Up",
        "trigger_type": "product_inquiry",
        "delay_hours": 2,
        "max_follow_ups": 2,
        "quiet_hours_start": "21:00",
        "quiet_hours_end": "08:00",
        "template_body": (
            "👋 Hi {customer_name}! Just following up on your inquiry about products at {store_name}.\n"
            "Would you like me to check the latest availability or help you reserve an item?\n\n"
            "_Reply STOP anytime if you prefer not to receive follow-up messages._"
        ),
        "is_enabled": True
    },
    {
        "name": "Repair Inquiry Follow-Up",
        "trigger_type": "repair_inquiry",
        "delay_hours": 3,
        "max_follow_ups": 2,
        "quiet_hours_start": "21:00",
        "quiet_hours_end": "08:00",
        "template_body": (
            "🔧 Hi {customer_name}, just checking in regarding your device repair inquiry at {store_name}.\n"
            "Our technicians are available for same-day diagnostic service. Let us know if you would like to drop off your device today!\n\n"
            "_Reply STOP to opt out._"
        ),
        "is_enabled": True
    },
    {
        "name": "Reservation Draft Follow-Up",
        "trigger_type": "reservation_draft",
        "delay_hours": 1,
        "max_follow_ups": 1,
        "quiet_hours_start": "21:00",
        "quiet_hours_end": "08:00",
        "template_body": (
            "📱 Hi {customer_name}, we noticed you were interested in reserving a device at {store_name}.\n"
            "Would you like us to confirm and hold this unit for in-store pickup today?\n\n"
            "_Reply STOP to opt out._"
        ),
        "is_enabled": True
    }
]


def seed_default_follow_up_rules(db: Session) -> int:
    """Seeds default follow-up automation rules if none exist."""
    existing_count = db.query(AIFollowUpRule).count()
    if existing_count > 0:
        return 0

    count = 0
    for r in DEFAULT_FOLLOW_UP_RULES:
        rule = AIFollowUpRule(
            name=r["name"],
            trigger_type=r["trigger_type"],
            delay_hours=r["delay_hours"],
            max_follow_ups=r["max_follow_ups"],
            quiet_hours_start=r["quiet_hours_start"],
            quiet_hours_end=r["quiet_hours_end"],
            template_body=r["template_body"],
            is_enabled=r["is_enabled"],
            stop_on_customer_reply=True,
            stop_on_purchase=True,
            stop_on_reservation=True,
            stop_on_handover=True,
            created_at=utcnow()
        )
        db.add(rule)
        count += 1
    db.commit()
    logger.info(f"Seeded {count} default follow-up automation rules.")
    return count


def is_phone_opted_out(db: Session, phone_number: str) -> bool:
    """Checks if a phone number is registered in the opt-out list."""
    norm_phone = normalize_sri_lankan_phone(phone_number) or phone_number
    return db.query(AIOptOut).filter(AIOptOut.phone_number == norm_phone).first() is not None


def record_customer_opt_out(db: Session, phone_number: str, reason: str = "customer_requested") -> None:
    """Adds a phone number to the opt-out list and cancels all scheduled follow-ups."""
    norm_phone = normalize_sri_lankan_phone(phone_number) or phone_number
    if not is_phone_opted_out(db, norm_phone):
        opt = AIOptOut(phone_number=norm_phone, reason=reason, created_at=utcnow())
        db.add(opt)
        db.commit()

    # Cancel all active follow-ups
    cancel_active_follow_ups(db, norm_phone, cancel_reason="Customer opted out (STOP)")


def is_within_quiet_hours(quiet_start: str = "21:00", quiet_end: str = "08:00") -> bool:
    """
    Checks if current time falls within configured quiet hours (e.g. 21:00 to 08:00).
    """
    try:
        now_time = datetime.now().time()
        start_parts = [int(p) for p in quiet_start.split(":")]
        end_parts = [int(p) for p in quiet_end.split(":")]
        start_t = dtime(start_parts[0], start_parts[1])
        end_t = dtime(end_parts[0], end_parts[1])

        if start_t > end_t:  # Crosses midnight (e.g. 21:00 to 08:00)
            return now_time >= start_t or now_time <= end_t
        else:
            return start_t <= now_time <= end_t
    except Exception:
        return False


def cancel_active_follow_ups(db: Session, phone_number: str, cancel_reason: str) -> int:
    """Cancels any pending/scheduled follow-ups for a customer."""
    norm_phone = normalize_sri_lankan_phone(phone_number) or phone_number
    pending = db.query(AIFollowUpLog).filter(
        AIFollowUpLog.phone_number == norm_phone,
        AIFollowUpLog.status == "SCHEDULED"
    ).all()

    for item in pending:
        item.status = "CANCELLED"
        item.cancel_reason = cancel_reason
        item.updated_at = utcnow()

    if pending:
        db.commit()
        logger.info(f"Cancelled {len(pending)} follow-ups for {norm_phone}: {cancel_reason}")
    return len(pending)


def schedule_customer_follow_up(
    db: Session,
    phone_number: str,
    trigger_type: str,
    customer_name: Optional[str] = None
) -> Optional[AIFollowUpLog]:
    """
    Evaluates follow-up eligibility and schedules a future follow-up message if permitted.
    """
    clean_phone = normalize_sri_lankan_phone(phone_number) or phone_number
    if not clean_phone:
        return None

    # Check Opt-out
    if is_phone_opted_out(db, clean_phone):
        return None

    # Ensure rule exists & is enabled
    seed_default_follow_up_rules(db)
    rule = db.query(AIFollowUpRule).filter(
        AIFollowUpRule.trigger_type == trigger_type,
        AIFollowUpRule.is_enabled == True  # noqa: E712
    ).first()

    if not rule:
        return None

    # Check conversation session state: if HUMAN_ACTIVE or CLOSED, do not follow up
    session = db.query(WhatsAppConversationSession).filter(
        WhatsAppConversationSession.phone_number == clean_phone
    ).first()
    if session and session.state in ["HUMAN_ACTIVE", "HUMAN_REQUESTED", "CLOSED"]:
        return None

    # Check previous follow-up count for this trigger
    past_follow_ups = db.query(AIFollowUpLog).filter(
        AIFollowUpLog.phone_number == clean_phone,
        AIFollowUpLog.trigger_type == trigger_type,
        AIFollowUpLog.status.in_(["SENT", "SCHEDULED"])
    ).count()

    if past_follow_ups >= rule.max_follow_ups:
        return None

    # Check if there is already an active SCHEDULED follow-up
    existing_scheduled = db.query(AIFollowUpLog).filter(
        AIFollowUpLog.phone_number == clean_phone,
        AIFollowUpLog.status == "SCHEDULED"
    ).first()
    if existing_scheduled:
        return None

    # Match customer for variable substitution
    cust = db.query(Customer).filter(
        or_(Customer.phone == clean_phone, Customer.whatsapp_number == clean_phone)
    ).first()
    cust_display_name = customer_name or (cust.name if cust else "Valued Customer")
    from app.utils.whatsapp_helper import resolve_store_variables
    store_info = resolve_store_variables(db)
    store_name = store_info.get("store_name", "I-Store")

    msg_body = rule.template_body.replace("{customer_name}", cust_display_name).replace("{store_name}", store_name)

    scheduled_time = utcnow() + timedelta(hours=rule.delay_hours)

    follow_up = AIFollowUpLog(
        phone_number=clean_phone,
        customer_id=cust.id if cust else None,
        rule_id=rule.id,
        trigger_type=trigger_type,
        follow_up_number=past_follow_ups + 1,
        message_body=msg_body,
        status="SCHEDULED",
        scheduled_at=scheduled_time,
        created_at=utcnow()
    )
    db.add(follow_up)
    db.commit()
    db.refresh(follow_up)

    logger.info(f"Scheduled follow-up #{follow_up.follow_up_number} for {clean_phone} at {scheduled_time.isoformat()}")
    return follow_up


async def process_due_follow_up_queue(db: Session) -> Dict[str, Any]:
    """
    Cron / Background Worker: Processes all SCHEDULED follow-ups that are due.
    Evaluates server-side safety checks (opt-out, customer replies, quiet hours).
    """
    now = utcnow()
    due_items = db.query(AIFollowUpLog).filter(
        AIFollowUpLog.status == "SCHEDULED",
        AIFollowUpLog.scheduled_at <= now
    ).all()

    sent_count = 0
    cancelled_count = 0
    postponed_count = 0

    for item in due_items:
        rule = db.query(AIFollowUpRule).filter(AIFollowUpRule.id == item.rule_id).first()
        quiet_start = rule.quiet_hours_start if rule else "21:00"
        quiet_end = rule.quiet_hours_end if rule else "08:00"

        # 1. Check Quiet Hours — postpone rather than discard
        if is_within_quiet_hours(quiet_start, quiet_end):
            postponed_count += 1
            continue

        # 2. Check Opt-out
        if is_phone_opted_out(db, item.phone_number):
            item.status = "OPTED_OUT"
            item.cancel_reason = "Customer is in opt-out list"
            item.updated_at = utcnow()
            cancelled_count += 1
            continue

        # 3. Check if customer replied after this follow-up was scheduled
        recent_reply = db.query(WhatsAppMessageLog).filter(
            WhatsAppMessageLog.phone_number == item.phone_number,
            WhatsAppMessageLog.trigger_type == "customer_inbound",
            WhatsAppMessageLog.created_at >= item.created_at
        ).first()

        if recent_reply:
            item.status = "CANCELLED"
            item.customer_replied = True
            item.reply_received_at = recent_reply.created_at
            item.cancel_reason = "Customer already replied to conversation"
            item.updated_at = utcnow()
            cancelled_count += 1
            continue

        # 4. Check if human staff took over
        session = db.query(WhatsAppConversationSession).filter(
            WhatsAppConversationSession.phone_number == item.phone_number
        ).first()
        if session and session.state in ["HUMAN_ACTIVE", "HUMAN_REQUESTED"]:
            item.status = "CANCELLED"
            item.cancel_reason = "Human agent actively handling chat"
            item.updated_at = utcnow()
            cancelled_count += 1
            continue

        # 5. Check if recent sale or reservation was completed
        if item.customer_id:
            recent_sale = db.query(Sale).filter(
                Sale.customer_id == item.customer_id,
                Sale.created_at >= item.created_at,
                Sale.is_voided == False
            ).first()
            if recent_sale:
                item.status = "CANCELLED"
                item.cancel_reason = "Customer made a completed purchase"
                item.updated_at = utcnow()
                cancelled_count += 1
                continue

        # 6. Execute Dispatch via WhatsApp Provider
        try:
            res = await whatsapp_provider.send_text(item.phone_number, item.message_body)
            if res.get("success"):
                item.status = "SENT"
                item.sent_at = utcnow()
                item.updated_at = utcnow()
                sent_count += 1

                # Record in general message log
                log = WhatsAppMessageLog(
                    phone_number=item.phone_number,
                    customer_id=item.customer_id,
                    event_type="ai_follow_up",
                    category="marketing",
                    template_name=f"AI Follow-up #{item.follow_up_number}",
                    message_body=item.message_body,
                    status="SENT",
                    trigger_type="ai_follow_up_engine",
                    message_id=res.get("messageId"),
                    sent_at=utcnow()
                )
                db.add(log)
            else:
                item.status = "FAILED"
                item.error_detail = res.get("error")
                item.updated_at = utcnow()
        except Exception as e:
            item.status = "FAILED"
            item.error_detail = str(e)
            item.updated_at = utcnow()

    db.commit()

    return {
        "processed_total": len(due_items),
        "sent": sent_count,
        "cancelled": cancelled_count,
        "postponed_quiet_hours": postponed_count
    }
