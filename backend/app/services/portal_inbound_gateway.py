"""
portal_inbound_gateway.py
=========================
Inbound Synchronization Gateway for Customer Portal Events.
Pulls and ingests online warranty claims, repair booking requests, service appointments,
and customer feedback from Supabase Cloud into the local ERP database with strict idempotency.
"""

import os
import json
import logging
import hmac
import urllib.request
import ssl
from urllib.parse import quote
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session

from app.models import Customer, RepairTicket, WarrantyClaim, WarrantyRecord, Organization
from app.constants import (
    REPAIR_STATUS_PENDING,
    REPAIR_STATUS_LABELS,
)
from app.services.warranty_service import (
    CLAIM_STATUS_PENDING,
    CLAIM_STATUS_PENDING_INSPECTION,
)
from app.services.numbering_service import next_number
from app.utils.time import utcnow

logger = logging.getLogger("istore.portal_inbound")

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL") or os.getenv("SUPABASE_URL", "https://bibwrndmbugtlyuvpmzi.supabase.co")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def _get_or_create_customer(db: Session, name: str, phone: str, organization_id: int) -> Customer:
    """Finds existing customer by phone number or creates a new customer profile."""
    clean_phone = str(phone).strip().replace(" ", "").replace("-", "")
    customer = db.query(Customer).filter(
        Customer.phone == clean_phone,
        Customer.organization_id == organization_id,
    ).first()

    if not customer:
        customer = Customer(
            name=name or "Portal Customer",
            phone=clean_phone,
            organization_id=organization_id
        )
        db.add(customer)
        db.flush()
    return customer


def ingest_portal_claim(db: Session, payload: Dict[str, Any], organization_id: int, branch_id: Optional[int] = None) -> Optional[WarrantyClaim]:
    """
    Ingests an online warranty claim submitted by a customer into the local ERP database.
    Guarantees idempotency based on claim id / external reference.
    """
    external_id = str(payload.get("id") or "").strip()
    contact_phone = payload.get("contact_phone") or payload.get("customer_phone") or ""
    customer_name = payload.get("customer_name") or "Portal Customer"
    issue_description = payload.get("issue_description") or payload.get("issue") or "Warranty claim submitted via portal"
    invoice_id = payload.get("invoice_id")
    serial_number = payload.get("serial_number") or payload.get("imei")

    if not contact_phone:
        logger.warning("Ingest claim rejected: missing customer contact phone.")
        return None

    # Check for duplicate claim already ingested
    existing = db.query(WarrantyClaim).filter(
        WarrantyClaim.organization_id == organization_id,
        (WarrantyClaim.claim_number == external_id) |
        (WarrantyClaim.claim_code == external_id)
    ).first()

    if existing:
        logger.debug(f"Warranty claim {external_id} already ingested (ID: {existing.id}).")
        return existing

    customer = _get_or_create_customer(db, name=customer_name, phone=contact_phone, organization_id=organization_id)

    # Attempt to link with existing warranty record
    warranty_record = None
    if serial_number:
        warranty_query = db.query(WarrantyRecord).filter(
            WarrantyRecord.serial_number == serial_number,
            WarrantyRecord.organization_id == organization_id,
        )
        if branch_id is not None:
            warranty_query = warranty_query.filter(WarrantyRecord.branch_id == branch_id)
        warranty_record = warranty_query.first()

    claim_num = external_id or next_number(db, "CLM")
    claim = WarrantyClaim(
        claim_code=claim_num,
        claim_number=claim_num,
        warranty_id=warranty_record.id if warranty_record else None,
        customer_id=customer.id,
        organization_id=organization_id,
        branch_id=branch_id,
        issue_description=issue_description,
        customer_complaint=issue_description,
        claim_status="Pending Inspection",
        decision_status="pending_inspection",
        created_at=utcnow()
    )
    db.add(claim)
    db.commit()
    db.refresh(claim)
    logger.info(f"Successfully ingested customer portal claim {claim.claim_number} (ID: {claim.id}).")
    return claim


def ingest_portal_repair_booking(db: Session, payload: Dict[str, Any], organization_id: int, branch_id: Optional[int] = None) -> Optional[RepairTicket]:
    """
    Ingests an online repair booking requested by a customer into the local ERP repair workflow.
    """
    external_ticket = str(payload.get("id") or "").strip()
    customer_phone = payload.get("customer_phone") or ""
    customer_name = payload.get("customer_name") or "Portal Customer"
    device_name = payload.get("device_name") or payload.get("device_model") or "Device"
    imei_or_serial = payload.get("imei_or_serial") or ""
    problem_description = payload.get("issue_description") or payload.get("issue") or "Online Repair Request"
    estimated_cost = float(payload.get("estimated_cost") or 0.0)

    if not customer_phone:
        logger.warning("Ingest repair booking rejected: missing customer phone.")
        return None

    # Check for duplicate ticket
    if external_ticket:
        existing = db.query(RepairTicket).filter(
            RepairTicket.ticket_no == external_ticket,
            RepairTicket.organization_id == organization_id,
        ).first()
        if existing:
            logger.debug(f"Repair booking {external_ticket} already ingested.")
            return existing

    customer = _get_or_create_customer(db, name=customer_name, phone=customer_phone, organization_id=organization_id)

    ticket = RepairTicket(
        ticket_no=external_ticket or next_number(db, "JOB"),
        customer_id=customer.id,
        device_model=device_name,
        imei=imei_or_serial,
        issue=problem_description,
        status=REPAIR_STATUS_PENDING,
        estimated_cost=estimated_cost,
        advance_payment=0.0,
        outstanding_balance=estimated_cost,
        payment_status="unpaid",
        notes="Online booking registered from Customer Portal.",
        organization_id=organization_id,
        branch_id=branch_id,
        created_at=utcnow()
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    logger.info(f"Successfully ingested portal repair booking {ticket.ticket_no} (ID: {ticket.id}).")
    return ticket


def pull_customer_portal_events(db_session: Optional[Session] = None, store_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Polls the Cloud Supabase REST API for new customer submissions and ingests them into ERP.
    """
    configured_store = os.getenv("PORTAL_WEBHOOK_STORE_REF", "")
    configured_org = os.getenv("PORTAL_WEBHOOK_ORGANIZATION_ID", "")
    configured_branch = os.getenv("PORTAL_WEBHOOK_BRANCH_ID", "")
    if not configured_store or not configured_org.isdigit() or int(configured_org) <= 0 or not configured_branch.isdigit() or int(configured_branch) <= 0 or (store_id and store_id != configured_store):
        return {"claims_ingested": 0, "repairs_ingested": 0, "status": "tenant_configuration_required"}
    if not SUPABASE_SERVICE_ROLE_KEY:
        logger.debug("SUPABASE_SERVICE_ROLE_KEY not configured. Skipping portal pull.")
        return {"claims_ingested": 0, "repairs_ingested": 0, "status": "skipped"}

    close_session_at_end = False
    if db_session is None:
        try:
            from app.database import SessionLocal
            db_session = SessionLocal()
            close_session_at_end = True
        except Exception as e:
            return {"claims_ingested": 0, "repairs_ingested": 0, "status": "error", "error": str(e)}

    claims_count = 0
    repairs_count = 0

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Accept": "application/json"
    }

    try:
        ctx = ssl.create_default_context()

        # 1. Pull recent warranty claims
        try:
            claims_url = f"{SUPABASE_URL}/rest/v1/warranty_claims?order=created_at.desc&limit=20"
            claims_url += f"&store_id=eq.{quote(configured_store, safe='')}"
            req = urllib.request.Request(claims_url, headers=headers, method="GET")
            with urllib.request.urlopen(req, context=ctx) as resp:
                claims_data = json.loads(resp.read().decode("utf-8"))
                for claim_item in claims_data:
                    if claim_item.get("store_id") != configured_store:
                        continue
                    c = ingest_portal_claim(db_session, claim_item, organization_id=int(configured_org), branch_id=int(configured_branch))
                    if c:
                        claims_count += 1
        except Exception as ce:
            logger.debug(f"Claims pull notice: {ce}")

        # 2. Pull recent repair bookings
        try:
            repairs_url = f"{SUPABASE_URL}/rest/v1/repair_tickets?status=eq.Submitted&limit=20"
            repairs_url += f"&store_id=eq.{quote(configured_store, safe='')}"
            req = urllib.request.Request(repairs_url, headers=headers, method="GET")
            with urllib.request.urlopen(req, context=ctx) as resp:
                repairs_data = json.loads(resp.read().decode("utf-8"))
                for repair_item in repairs_data:
                    if repair_item.get("store_id") != configured_store:
                        continue
                    r = ingest_portal_repair_booking(db_session, repair_item, organization_id=int(configured_org), branch_id=int(configured_branch))
                    if r:
                        repairs_count += 1
        except Exception as re:
            logger.debug(f"Repairs pull notice: {re}")

        return {
            "claims_ingested": claims_count,
            "repairs_ingested": repairs_count,
            "status": "completed"
        }
    except Exception as e:
        logger.error(f"Inbound gateway pull encountered error: {e}")
        return {"claims_ingested": claims_count, "repairs_ingested": repairs_count, "status": "error", "error": str(e)}
    finally:
        if close_session_at_end and db_session:
            db_session.close()


def process_inbound_webhook(
    db: Session,
    event_type: str,
    payload: Dict[str, Any],
    secret_token: Optional[str] = None
) -> Dict[str, Any]:
    """
    Direct webhook handler for realtime events emitted by Cloud Supabase.
    """
    configured_secret = os.getenv("PORTAL_WEBHOOK_SECRET", "")
    if len(configured_secret) < 32 or not secret_token or not hmac.compare_digest(secret_token, configured_secret):
        return {"success": False, "error": "Invalid webhook secret"}

    # This legacy Supabase gateway may write only to its explicitly mapped ERP
    # organization. Never fall back to organization 1 or trust a payload tenant.
    configured_org = os.getenv("PORTAL_WEBHOOK_ORGANIZATION_ID", "")
    configured_branch = os.getenv("PORTAL_WEBHOOK_BRANCH_ID", "")
    configured_store = os.getenv("PORTAL_WEBHOOK_STORE_REF", "")
    if not configured_org.isdigit() or int(configured_org) <= 0 or not configured_branch.isdigit() or int(configured_branch) <= 0 or not configured_store:
        return {"success": False, "error": "Portal tenant mapping is not configured"}
    if payload.get("store_id") != configured_store:
        return {"success": False, "error": "Portal store does not match configured tenant"}

    if event_type == "claim_submitted":
        record = ingest_portal_claim(db, payload, organization_id=int(configured_org), branch_id=int(configured_branch))
        return {"success": True, "claim_id": record.id if record else None}
    elif event_type == "repair_submitted":
        record = ingest_portal_repair_booking(db, payload, organization_id=int(configured_org), branch_id=int(configured_branch))
        return {"success": True, "repair_id": record.id if record else None}
    else:
        return {"success": True, "message": f"Event {event_type} received."}
