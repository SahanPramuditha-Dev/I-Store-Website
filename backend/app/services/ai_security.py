"""
ai_security.py
==============
I-Store ERP — WhatsApp AI Security, Rate Limiting & Prompt Injection Protection.
Protects the Gemini AI layer against quota exhaustion, flooding, prompt overrides, and unauthorized discounts.
"""

import re
import time
import logging
from typing import Dict, Tuple, Optional

logger = logging.getLogger("istore.ai_security")

# In-memory sliding window rate limiter: {phone: [timestamp1, timestamp2, ...]}
_RATE_LIMIT_STORE: Dict[str, list] = {}
RATE_LIMIT_MAX_MESSAGES = 6
RATE_LIMIT_WINDOW_SECONDS = 60

# Known Prompt Injection / System Override Attack Patterns
PROMPT_INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules|commands)",
    r"system\s+(prompt|override|reset|mode)",
    r"you\s+are\s+now\s+(in\s+)?(developer\s+mode|dan\s+mode|unrestricted\s+mode|jailbreak)",
    r"pretend\s+you\s+are\s+(an\s+ai\s+without\s+rules|unfiltered|a\s+different\s+assistant)",
    r"(give|grant|apply)\s+(me\s+)?(a\s+)?(9[0-9]%|100%|free|99%)\s+(discount|price|item)",
    r"(reveal|print|show|output)\s+(your|the)\s+(system\s+prompt|initial\s+instructions|instructions)",
    r"disregard\s+(the\s+)?(safety\s+guidelines|system\s+rules)",
    r"as\s+an\s+admin,\s+i\s+command\s+you",
    r"bypass\s+all\s+(security|filters|restrictions)"
]

_INJECTION_REGEX = re.compile("|".join(PROMPT_INJECTION_PATTERNS), re.IGNORECASE)


def check_rate_limit(phone_number: str) -> Tuple[bool, Optional[str]]:
    """
    Evaluates whether the incoming phone number has exceeded the rate limit.
    Returns (is_allowed, warning_message).
    """
    if not phone_number:
        return True, None

    now = time.time()
    clean_phone = phone_number.replace("+", "").strip()

    history = _RATE_LIMIT_STORE.get(clean_phone, [])
    # Filter out timestamps older than the sliding window
    history = [t for t in history if now - t < RATE_LIMIT_WINDOW_SECONDS]

    if len(history) >= RATE_LIMIT_MAX_MESSAGES:
        logger.warning(f"Rate limit triggered for phone: {clean_phone} ({len(history)} msgs in {RATE_LIMIT_WINDOW_SECONDS}s)")
        _RATE_LIMIT_STORE[clean_phone] = history
        return False, (
            "⏳ *Please slow down!*\n\n"
            "You are sending messages too quickly. Please wait 1 minute before sending another message."
        )

    history.append(now)
    _RATE_LIMIT_STORE[clean_phone] = history
    return True, None


def sanitize_and_check_injection(text: str) -> Tuple[str, bool]:
    """
    Scans input for prompt injection attempts and returns (sanitized_text, is_suspicious).
    If suspicious, flags the message and neutralizes override phrases.
    """
    if not text:
        return "", False

    is_suspicious = bool(_INJECTION_REGEX.search(text))
    if is_suspicious:
        logger.warning(f"Prompt injection pattern detected in input: {text[:80]}...")
        # Neutralize common jailbreak tokens
        sanitized = _INJECTION_REGEX.sub("[sanitized input]", text)
        return sanitized, True

    return text, False
