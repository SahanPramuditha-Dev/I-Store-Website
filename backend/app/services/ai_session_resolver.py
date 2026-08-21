"""
ai_session_resolver.py
======================
I-Store ERP — WhatsApp Inactivity Auto-Resolution, Handover Expiry & CSAT Dispatcher.
Monitors stagnant support conversations, auto-resolves tickets after 30-45 minutes of silence,
resumes AI auto-replies, and dispatches CSAT rating prompts.
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, Any
from sqlalchemy.orm import Session

from app.models import WhatsAppConversationSession, WhatsAppMessageLog
from app.utils.time import utcnow
from app.utils.whatsapp_helper import normalize_sri_lankan_phone, resolve_store_variables, whatsapp_provider
from app.services.whatsapp_bot_service import clear_ai_pause_for_phone

logger = logging.getLogger("istore.ai_session_resolver")

INACTIVITY_THRESHOLD_MINUTES = 35


async def process_inactivity_session_resolutions(db: Session) -> Dict[str, Any]:
    """
    Background Cron Task:
    Finds sessions in HUMAN_REQUESTED or HUMAN_ACTIVE that have had no interaction
    for over 35 minutes. Automatically closes the session, resumes AI mode, and
    sends a courtesy resolution note + CSAT satisfaction prompt.
    """
    cutoff = utcnow() - timedelta(minutes=INACTIVITY_THRESHOLD_MINUTES)
    store_info = resolve_store_variables(db)
    store_name = store_info.get("store_name", "I-Store")

    stagnant_sessions = db.query(WhatsAppConversationSession).filter(
        WhatsAppConversationSession.state.in_(["HUMAN_REQUESTED", "HUMAN_ACTIVE"]),
        WhatsAppConversationSession.last_interaction_at < cutoff
    ).all()

    auto_resolved_count = 0

    for session in stagnant_sessions:
        phone = session.phone_number
        try:
            # 1. Update session state back to AI_ACTIVE and enable CSAT expectation
            session.state = "AI_ACTIVE"
            session.csat_requested = True
            session.csat_requested_at = utcnow()
            clear_ai_pause_for_phone(phone)

            # 2. Build closing courtesy note + CSAT survey
            closing_msg = (
                f"🙏 *Support Session Concluded*\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"Thank you for contacting *{store_name}*! Since there has been no recent activity, this live support session has been automatically marked as resolved.\n\n"
                f"⭐ *How was our service today?*\n"
                f"Please reply with:\n"
                f"*1* ➔ 👍 Great / Solved\n"
                f"*2* ➔ 👎 Needs Improvement\n\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"_You can message us anytime or reply *MENU* to start a new inquiry!_"
            )

            # 3. Dispatch via WhatsApp Provider
            send_res = await whatsapp_provider.send_text(phone, closing_msg)
            if send_res.get("success"):
                log = WhatsAppMessageLog(
                    phone_number=phone,
                    event_type="csat_survey",
                    category="system",
                    template_name="Auto-Resolution & CSAT Survey",
                    message_body=closing_msg,
                    status="SENT",
                    trigger_type="ai_inactivity_resolver",
                    message_id=send_res.get("messageId"),
                    sent_at=utcnow()
                )
                db.add(log)

            auto_resolved_count += 1
            logger.info(f"Auto-resolved inactive WhatsApp session for {phone} and sent CSAT prompt.")
        except Exception as err:
            logger.error(f"Failed to auto-resolve session for {phone}: {err}")

    db.commit()

    return {
        "scanned": len(stagnant_sessions),
        "auto_resolved": auto_resolved_count
    }
