"""
ai_voice_service.py
===================
I-Store ERP — WhatsApp Voice Note (Audio) Speech-to-Text Service.
Transcribes voice messages (.ogg, .opus, .mp3, .wav, .m4a) sent via WhatsApp using Gemini Audio.
Supports English, Sinhala, Tamil, and Singlish speech.
"""

import logging
import base64
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session

from app.services.ai_service import get_gemini_config, init_gemini, MODEL_FALLBACK_CHAIN

logger = logging.getLogger("istore.ai_voice")

def transcribe_voice_message_with_gemini(
    audio_base64: str,
    mime_type: str = "audio/ogg",
    db: Optional[Session] = None
) -> Optional[str]:
    """
    Uses Gemini multimodal audio capabilities to transcribe WhatsApp voice messages into plain text.
    Handles English, Sinhala, Tamil, and Singlish speech.
    """
    if not audio_base64:
        return None

    if not init_gemini(db):
        logger.warning("Gemini not initialized for voice transcription.")
        return None

    prompt = """
You are an accurate, fast speech-to-text audio transcriber for a customer service WhatsApp chat in Sri Lanka.
Transcribe the spoken audio message verbatim into text.
Guidelines:
1. Support English, Sinhala script, Tamil script, or colloquial Singlish (Sinhala written with English letters e.g. "machan display eka thiyeda").
2. Output ONLY the clean transcribed sentence/question.
3. Do NOT include filler explanations, quotation marks, prefixes like 'Transcription:', or markdown backticks.
4. If audio is unclear, blank, or unintelligible noise, output: UNINTELLIGIBLE_AUDIO
"""

    try:
        import google.generativeai as genai
        key, configured_model = get_gemini_config(db)
        
        # Priority models that support audio
        audio_model_chain = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"]
        if configured_model and configured_model not in audio_model_chain:
            audio_model_chain.insert(0, configured_model)

        audio_part = {
            "mime_type": mime_type,
            "data": audio_base64
        }

        for model_name in audio_model_chain:
            try:
                model = genai.GenerativeModel(model_name)
                res = model.generate_content([prompt, audio_part], stream=False)
                if res and res.text:
                    text = res.text.strip().removeprefix("```").removesuffix("```").strip()
                    if "UNINTELLIGIBLE_AUDIO" in text:
                        return None
                    return text
            except Exception as model_err:
                logger.warning(f"Voice transcription failed on model {model_name}: {model_err}")
                continue

    except Exception as e:
        logger.error(f"Voice note transcription error: {e}")

    return None
