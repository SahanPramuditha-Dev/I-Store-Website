"""
Supabase Sync Service for I-Store POS
Automatically pushes POS billing checkout invoices, customer profiles,
warranty items, and repair tickets to the Cloud Customer Portal (Supabase).
Implements the Transactional Outbox Pattern for non-blocking local POS execution
and guaranteed asynchronous cloud delivery with exponential backoff retries.
"""

import os
import json
import logging
import urllib.request
import ssl
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
from urllib.parse import quote

logger = logging.getLogger("istore.supabase_sync")

# Supabase Credentials (Configured via secure server-side environment variables)
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL") or os.getenv("SUPABASE_URL", "https://bibwrndmbugtlyuvpmzi.supabase.co")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
CUSTOMER_PORTAL_BASE_URL = os.getenv("CUSTOMER_PORTAL_BASE_URL", "https://i-store-customer-portal-one.vercel.app")


def generate_invoice_token(invoice_id: str) -> str:
    """
    Generates deterministic 12-char security token for public invoice links
    with salted hash verification.
    """
    _salt = os.getenv("INVOICE_SECURITY_SALT", "istore_secure_salt_2026")
    _s = f"{str(invoice_id).strip().upper()}{_salt}"
    _hash_val = 0
    for _char in _s:
        _hash_val = (_hash_val << 5) - _hash_val + ord(_char)
        # Force 32-bit integer range
        _hash_val = (_hash_val + 2**31) % 2**32 - 2**31
    return f"sec_{abs(_hash_val):08x}"[:12]


def enqueue_outbox_event(
    db: Any,
    entity_type: str,
    entity_id: str,
    action: str,
    payload: Dict[str, Any],
    organization_id: Optional[int] = None,
    branch_id: Optional[int] = None
) -> Optional[Any]:
    """
    Persists a synchronization payload to the local SyncOutbox table within the same database transaction.
    """
    if db is None:
        return None

    try:
        from app.models import SyncOutbox
        outbox_entry = SyncOutbox(
            entity_type=entity_type,
            entity_id=str(entity_id),
            action=action.upper(),
            payload=json.dumps(payload),
            status="pending",
            retry_count=0,
            max_retries=5,
            organization_id=organization_id,
            branch_id=branch_id
        )
        db.add(outbox_entry)
        db.flush()
        logger.debug(f"Enqueued {entity_type} {entity_id} to SyncOutbox (ID: {outbox_entry.id})")
        return outbox_entry
    except Exception as e:
        logger.error(f"Failed to enqueue outbox event for {entity_type} {entity_id}: {e}")
        return None


def sync_checkout_invoice_to_cloud(
    invoice_id: str,
    customer_name: str,
    customer_phone: str,
    customer_email: Optional[str],
    subtotal: float,
    discount: float,
    tax: float,
    total: float,
    payment_method: str,
    items: List[Dict[str, Any]],
    status: str = "Paid",
    store_logo_url: Optional[str] = None,
    shop_name: Optional[str] = None,
    shop_address: Optional[str] = None,
    shop_phone: Optional[str] = None,
    shop_whatsapp: Optional[str] = None,
    store_id: Optional[str] = None,
    enable_loyalty: bool = True,
    loyalty_rate: int = 1000,
    db: Optional[Any] = None,
    organization_id: Optional[int] = None,
    branch_id: Optional[int] = None
) -> Dict[str, Any]:
    """
    Syncs a POS checkout transaction to the cloud Supabase database.
    Enqueues to SyncOutbox for non-blocking execution and returns instant smart bill & WhatsApp links.
    """
    token = generate_invoice_token(invoice_id)
    resolved_store_id = str(store_id).strip().lower().replace(" ", "-") if store_id else "default"
    display_shop_name = shop_name or "I-Store"
    loyalty_points = int(float(total or 0) // max(1, loyalty_rate or 1000)) if enable_loyalty else 0

    invoice_payload = {
        "id": invoice_id,
        "token": token,
        "store_id": resolved_store_id,
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "customer_email": customer_email or "",
        "subtotal": subtotal,
        "discount": discount,
        "tax": tax,
        "total": total,
        "payment_method": payment_method,
        "loyalty_points": loyalty_points,
        "status": status,
        "store_profile": {
            "id": resolved_store_id,
            "name": shop_name or "Retail Store",
            "tagline": "Digital Receipts & Warranty Portal",
            "logo_url": store_logo_url or "",
            "address": shop_address or "",
            "phone": shop_phone or "",
            "whatsapp_number": shop_whatsapp or shop_phone or "",
            "enable_loyalty_program": enable_loyalty,
            "loyalty_rate_lkr_per_point": loyalty_rate,
        } if (shop_name or resolved_store_id != "default" or shop_phone or shop_whatsapp) else None,
        "items": [
            {
                "invoice_id": invoice_id,
                "item_name": item.get("name") or item.get("description", "Product Item"),
                "quantity": item.get("qty", 1),
                "unit_price": item.get("price", 0.0),
                "warranty_months": item.get("warranty_months", 0),
                "imei_or_serial": item.get("imei_or_serial")
            }
            for item in (items or [])
        ]
    }

    # 1. Enqueue to Transactional Outbox (immediate, local persistence)
    if db is not None:
        enqueue_outbox_event(
            db=db,
            entity_type="invoice",
            entity_id=invoice_id,
            action="UPSERT",
            payload=invoice_payload,
            organization_id=organization_id,
            branch_id=branch_id
        )

    # 2. Build Store-Scoped Smart Bill Links
    store_query = f"&store={resolved_store_id}" if resolved_store_id != "default" else ""
    public_link = f"{CUSTOMER_PORTAL_BASE_URL}/invoice/{invoice_id}?token={token}{store_query}"
    whatsapp_text = quote(
        f"Thank you for shopping at {display_shop_name}! 🛍️\n"
        f"View your official digital receipt & warranty details here:\n{public_link}"
    )
    whatsapp_click_link = f"https://wa.me/{customer_phone.replace(' ', '').replace('+', '')}?text={whatsapp_text}"

    return {
        "invoice_id": invoice_id,
        "token": token,
        "public_link": public_link,
        "whatsapp_link": whatsapp_click_link
    }


def sync_repair_ticket_to_cloud(
    ticket_no: str,
    customer_name: str,
    customer_phone: str,
    device_model: str,
    imei_or_serial: str,
    problem_description: str,
    status: str = "Submitted",
    estimated_cost: float = 0.0,
    advance_paid: float = 0.0,
    balance_due: float = 0.0,
    status_note: str = "",
    store_id: Optional[str] = None,
    db: Optional[Any] = None,
    organization_id: Optional[int] = None,
    branch_id: Optional[int] = None
) -> Dict[str, Any]:
    """
    Syncs a repair ticket to Supabase `repair_tickets` table via Outbox.
    """
    resolved_store_id = str(store_id).strip().lower().replace(" ", "-") if store_id else "default"

    repair_payload = {
        "id": ticket_no,
        "store_id": resolved_store_id,
        "customer_phone": customer_phone,
        "device_name": device_model,
        "imei_or_serial": imei_or_serial or "",
        "issue_description": problem_description,
        "status": status,
        "estimated_cost": estimated_cost,
        "advance_paid": advance_paid,
        "balance_due": balance_due,
        "status_note": status_note,
    }

    if db is not None:
        enqueue_outbox_event(
            db=db,
            entity_type="repair_ticket",
            entity_id=ticket_no,
            action="UPSERT",
            payload=repair_payload,
            organization_id=organization_id,
            branch_id=branch_id
        )

    store_query = f"?store={resolved_store_id}" if resolved_store_id != "default" else ""
    portal_link = f"{CUSTOMER_PORTAL_BASE_URL}/repair/{ticket_no}{store_query}"
    return {"ticket_no": ticket_no, "portal_link": portal_link}


def _push_payload_to_supabase(entity_type: str, payload: Dict[str, Any]) -> None:
    """
    Direct HTTPS REST dispatcher to Cloud Supabase using SSL verification.
    """
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise ValueError("SUPABASE_SERVICE_ROLE_KEY is not configured")

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }
    ctx = ssl.create_default_context()

    if entity_type == "invoice":
        # A. Upsert Store Profile if present
        store_profile = payload.get("store_profile")
        if store_profile:
            try:
                sreq = urllib.request.Request(
                    f"{SUPABASE_URL}/rest/v1/stores",
                    data=json.dumps(store_profile).encode("utf-8"),
                    headers=headers,
                    method="POST"
                )
                with urllib.request.urlopen(sreq, context=ctx) as resp:
                    pass
            except Exception as se:
                logger.debug(f"Store profile sync notice: {se}")

        # B. Upsert Invoice Record
        invoice_row = {k: v for k, v in payload.items() if k not in ("store_profile", "items")}
        ireq = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/invoices",
            data=json.dumps(invoice_row).encode("utf-8"),
            headers=headers,
            method="POST"
        )
        with urllib.request.urlopen(ireq, context=ctx) as resp:
            pass

        # C. Insert Line Items
        items = payload.get("items", [])
        if items:
            itreq = urllib.request.Request(
                f"{SUPABASE_URL}/rest/v1/invoice_items",
                data=json.dumps(items).encode("utf-8"),
                headers=headers,
                method="POST"
            )
            with urllib.request.urlopen(itreq, context=ctx) as resp:
                pass

    elif entity_type == "repair_ticket":
        rreq = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/repair_tickets",
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST"
        )
        with urllib.request.urlopen(rreq, context=ctx) as resp:
            pass

    elif entity_type == "staff_pin":
        preq = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/staff_pins",
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST"
        )
        with urllib.request.urlopen(preq, context=ctx) as resp:
            pass


def process_offline_outbox_queue(db_session=None, batch_size: int = 50) -> Dict[str, Any]:
    """
    Background worker that flushes pending/failed outbox sync jobs to Supabase Cloud
    with exponential backoff and dead-letter protection.
    """
    close_session_at_end = False
    if db_session is None:
        try:
            from app.database import SessionLocal
            db_session = SessionLocal()
            close_session_at_end = True
        except Exception as e:
            logger.error(f"Cannot initialize database session for outbox worker: {e}")
            return {"flushed": 0, "status": "error", "error": str(e)}

    try:
        from app.models import SyncOutbox
        now = datetime.now(timezone.utc)

        # Query pending or failed items due for retry
        records = (
            db_session.query(SyncOutbox)
            .filter(
                SyncOutbox.status.in_(["pending", "failed"]),
                (SyncOutbox.next_retry_at.is_(None) | (SyncOutbox.next_retry_at <= now)),
                SyncOutbox.retry_count < SyncOutbox.max_retries
            )
            .order_by(SyncOutbox.created_at.asc())
            .limit(batch_size)
            .all()
        )

        if not records:
            return {"processed": 0, "synced": 0, "failed": 0, "status": "idle"}

        synced_count = 0
        failed_count = 0

        for rec in records:
            try:
                rec.status = "in_flight"
                payload_data = json.loads(rec.payload)
                _push_payload_to_supabase(rec.entity_type, payload_data)
                
                rec.status = "synced"
                rec.synced_at = datetime.now(timezone.utc)
                rec.last_error = None
                synced_count += 1
            except Exception as exc:
                rec.retry_count += 1
                rec.last_error = str(exc)
                if rec.retry_count >= (rec.max_retries or 5):
                    rec.status = "dead_letter"
                    logger.error(f"Outbox {rec.id} ({rec.entity_type} {rec.entity_id}) reached max retries. Moved to dead_letter.")
                else:
                    rec.status = "failed"
                    backoff_delay = min(3600, 2 ** rec.retry_count * 5)
                    rec.next_retry_at = datetime.now(timezone.utc) + timedelta(seconds=backoff_delay)
                    logger.warning(f"Outbox {rec.id} push failed: {exc}. Retrying in {backoff_delay}s (Attempt {rec.retry_count}).")
                failed_count += 1

        db_session.commit()
        logger.info(f"Outbox flush completed: {synced_count} synced, {failed_count} failed out of {len(records)} items.")
        return {
            "processed": len(records),
            "synced": synced_count,
            "failed": failed_count,
            "status": "completed"
        }

    except Exception as e:
        logger.error(f"Outbox worker encountered critical error: {e}")
        try:
            db_session.rollback()
        except Exception:
            pass
        return {"processed": 0, "synced": 0, "failed": 0, "status": "error", "error": str(e)}
    finally:
        if close_session_at_end and db_session:
            db_session.close()


def sync_staff_pin_to_cloud(username: str, role: str, pin_hash: str, db: Optional[Any] = None) -> None:
    """
    Syncs staff PIN hash to Supabase staff_pins table via Outbox.
    """
    payload = {
        "username": username,
        "role": role,
        "pin_hash": pin_hash,
    }
    if db is not None:
        enqueue_outbox_event(
            db=db,
            entity_type="staff_pin",
            entity_id=username,
            action="UPSERT",
            payload=payload
        )

