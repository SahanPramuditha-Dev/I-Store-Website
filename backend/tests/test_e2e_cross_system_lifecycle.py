import os
import json
import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

TEST_DB_URL = "sqlite:///:memory:"

from app.database import Base
from app.models import (
    Customer,
    Organization,
    SaaSPlan,
    User,
    Sale,
    SaleItem,
    WarrantyRecord,
    WarrantyClaim,
    RepairTicket,
    SyncOutbox
)
from app.core.license_guard import (
    verify_license_token,
    save_cached_license,
    get_cached_license
)
from app.services.capability_service import (
    get_effective_capabilities,
    has_capability
)
from app.services.supabase_pos_sync import (
    enqueue_outbox_event,
    process_offline_outbox_queue
)
from app.services.customer_auth_service import (
    request_customer_otp,
    verify_customer_otp,
    verify_smart_invoice_token,
    generate_customer_session_token,
    verify_customer_session_token,
    _ACTIVE_OTPS
)
from app.services.portal_inbound_gateway import (
    ingest_portal_claim,
    ingest_portal_repair_booking
)

from cryptography.hazmat.primitives.asymmetric import ed25519
import base64

@pytest.fixture(autouse=True)
def clean_license_cache(monkeypatch, tmp_path):
    cache_file = str(tmp_path / "test_license_cache.json")
    monkeypatch.setattr("app.core.license_guard.LICENSE_CACHE_FILE", cache_file)
    yield
    if os.path.exists(cache_file):
        try:
            os.remove(cache_file)
        except Exception:
            pass

@pytest.fixture
def db():
    engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def keys():
    private_key = ed25519.Ed25519PrivateKey.generate()
    public_key = private_key.public_key()
    pub_bytes = public_key.public_bytes_raw()
    pub_b64 = base64.b64encode(pub_bytes).decode('ascii')
    return {
        "private": private_key,
        "public": public_key,
        "pub_b64": pub_b64
    }


from app.core.license_guard import (
    canonicalize_bytes,
    verify_license_token,
    save_cached_license,
    get_cached_license
)

def create_signed_token(payload_dict, private_key, key_id="e2e-key-v1"):
    canonical = canonicalize_bytes(payload_dict)
    sig = private_key.sign(canonical)
    sig_b64 = base64.b64encode(sig).decode('ascii')
    return {
        "payload": payload_dict,
        "signature": sig_b64,
        "signature_algorithm": "Ed25519",
        "key_id": key_id
    }


def test_full_cross_system_e2e_lifecycle(db, keys, monkeypatch):
    """
    E2E Test executing complete 5-stage lifecycle across Control Center, ERP, and Portal:
    1. Licensing & Capability Provisioning (Control Center -> ERP)
    2. POS Transaction & Transactional Outbox (ERP Engine)
    3. Dual-Mode Customer Portal Authentication (Portal -> ERP)
    4. Bidirectional Warranty Claim Ingestion (Portal -> ERP Gateway)
    5. Dynamic Industry Switching & Re-signing
    """

    # -------------------------------------------------------------------------
    # STAGE 1: Control Center Issues Ed25519 License -> ERP Activates
    # -------------------------------------------------------------------------
    monkeypatch.setattr("app.core.license_guard.ESTORE_PUBLIC_KEY_B64", keys["pub_b64"])
    monkeypatch.setattr("app.core.license_guard.ALLOW_DEV_LICENSE_BYPASS", False)

    now = datetime.now(timezone.utc)
    expires = (now + timedelta(days=365)).isoformat().replace("+00:00", "Z")

    mobile_license_payload = {
        "license_schema_version": 1,
        "license_id": "ISTORE-E2E-2026-0001",
        "tenant_code": "tenant-apex-lk",
        "shop_code": "MAIN-01",
        "package_code": "ENTERPRISE",
        "entitlements": ["pos", "repairs", "warranty", "inventory", "whatsapp"],
        "industry_code": "MOBILE_RETAIL",
        "capabilities": ["repairs_management", "warranty_management", "imei_tracking", "trade_ins"],
        "configuration_version": 1,
        "license_type": "SUBSCRIPTION",
        "issued_at": now.isoformat().replace("+00:00", "Z"),
        "starts_at": now.isoformat().replace("+00:00", "Z"),
        "expires_at": expires,
        "machine_fingerprint": "MACH-TEST-E2E-001",
        "grace_period_days": 7
    }

    signed_token = create_signed_token(mobile_license_payload, keys["private"])

    # Verify & Activate in ERP
    is_valid, msg, validated_payload = verify_license_token(
        token_data=signed_token,
        current_machine_fingerprint="MACH-TEST-E2E-001"
    )
    assert is_valid is True
    assert validated_payload["industry_code"] == "MOBILE_RETAIL"
    assert "repairs_management" in validated_payload["capabilities"]

    # Save to local ERP cache
    save_cached_license(signed_token)
    assert get_cached_license() is not None

    # ERP Resolves Capabilities from License
    caps = get_effective_capabilities(db)
    assert caps["source"] == "CENTRAL_ED25519_LICENSE"
    assert caps["industry_type"] == "MOBILE_RETAIL"
    assert caps["capabilities"]["repairs_management"] is True
    assert caps["capabilities"]["imei_tracking"] is True
    assert caps["capabilities"]["weighted_products"] is False

    # -------------------------------------------------------------------------
    # STAGE 2: POS Transaction Execution & Transactional Outbox (ERP)
    # -------------------------------------------------------------------------
    org = Organization(name="Apex Mobile", slug="apex-lk")
    db.add(org)
    db.commit()

    customer = Customer(
        name="Kasun Perera",
        phone="+94771234567",
        organization_id=org.id
    )
    db.add(customer)
    db.commit()

    # POS Sale Checkout with IMEI
    sale = Sale(
        invoice_no="INV-2026-E2E-001",
        customer_id=customer.id,
        subtotal=285000.0,
        discount_amount=0.0,
        total=285000.0,
        payment_method="Cash",
        payment_status="paid",
        invoice_status="finalized",
        organization_id=org.id
    )
    db.add(sale)
    db.flush()

    item = SaleItem(
        sale_id=sale.id,
        description="iPhone 15 Pro Max (256GB)",
        quantity=1.0,
        price=285000.0,
        line_total=285000.0,
        organization_id=org.id
    )
    db.add(item)

    warranty = WarrantyRecord(
        warranty_code="WR-E2E-001",
        invoice_id=sale.id,
        customer_id=customer.id,
        customer_name=customer.name,
        customer_phone=customer.phone,
        product_or_service_name=item.description,
        imei_or_serial="359871234567890",
        warranty_type="product",
        start_date=now.replace(tzinfo=None),
        end_date=(now + timedelta(days=365)).replace(tzinfo=None),
        status="active",
        organization_id=org.id
    )
    db.add(warranty)

    # Atomic Outbox Enqueueing
    ev_sale = enqueue_outbox_event(
        db=db,
        entity_type="invoice",
        entity_id=str(sale.invoice_no),
        action="UPSERT",
        payload={
            "invoice_number": sale.invoice_no,
            "customer_phone": customer.phone,
            "total_amount": sale.total,
            "imei": "359871234567890"
        }
    )
    ev_warr = enqueue_outbox_event(
        db=db,
        entity_type="warranty",
        entity_id=str(warranty.id),
        action="UPSERT",
        payload={
            "imei_or_serial": warranty.imei_or_serial,
            "product_name": warranty.product_or_service_name
        }
    )
    db.commit()

    pending_count = db.query(SyncOutbox).filter(SyncOutbox.status == "pending").count()
    assert pending_count == 2

    # Flush Outbox Dispatch (Mock cloud push)
    with patch("app.services.supabase_pos_sync._push_payload_to_supabase", return_value=None):
        flush_result = process_offline_outbox_queue(db_session=db)

    assert flush_result["processed"] == 2
    assert flush_result["synced"] == 2
    assert flush_result["failed"] == 0

    synced_count = db.query(SyncOutbox).filter(SyncOutbox.status == "synced").count()
    assert synced_count == 2

    # -------------------------------------------------------------------------
    # STAGE 3: Dual-Mode Customer Portal Authentication (Portal -> ERP)
    # -------------------------------------------------------------------------
    # Mode A: Smart Invoice Token
    from app.services.supabase_pos_sync import generate_invoice_token
    inv_token = generate_invoice_token("INV-2026-E2E-001")
    is_valid_inv, inv_msg, customer_session_token, verified_store = verify_smart_invoice_token("INV-2026-E2E-001", inv_token)
    assert is_valid_inv is True
    assert customer_session_token is not None

    # Mode B: WhatsApp 6-digit OTP
    otp_res = request_customer_otp(
        phone="0771234567",
        channel="whatsapp",
        store_name="Apex Mobile"
    )
    assert otp_res["success"] is True

    # In test environment, assign test OTP hash to test verification flow
    from app.services.customer_auth_service import _hash_otp
    test_code = "654321"
    _ACTIVE_OTPS["0771234567"]["hash"] = _hash_otp("0771234567", test_code)

    # Verify OTP & create authenticated session
    is_valid_otp, otp_msg, session_token = verify_customer_otp("0771234567", test_code)
    assert is_valid_otp is True
    assert session_token is not None

    is_tok_valid, tok_msg, session_data = verify_customer_session_token(session_token)
    assert is_tok_valid is True
    assert session_data is not None
    assert session_data["phone"] == "0771234567"

    # -------------------------------------------------------------------------
    # STAGE 4: Customer Submits Claim -> Ingested by ERP Inbound Gateway
    # -------------------------------------------------------------------------
    claim_payload = {
        "id": "CLM-E2E-9901",
        "customer_name": "Kasun Perera",
        "contact_phone": "0771234567",
        "serial_number": "359871234567890",
        "issue_description": "Green vertical line on OLED display after software update."
    }

    ingested_claim = ingest_portal_claim(db, claim_payload, organization_id=org.id)
    assert ingested_claim is not None
    assert ingested_claim.claim_number == "CLM-E2E-9901"
    assert ingested_claim.customer.phone == "0771234567"
    assert ingested_claim.decision_status == "pending_inspection"

    # Ingest portal repair booking
    booking_payload = {
        "id": "BKG-E2E-8801",
        "customer_name": "Kasun Perera",
        "customer_phone": "0771234567",
        "device_name": "iPhone 15 Pro Max",
        "issue_description": "Display repair booking"
    }
    ingested_ticket = ingest_portal_repair_booking(db, booking_payload, organization_id=org.id)
    assert ingested_ticket is not None
    assert ingested_ticket.ticket_no == "BKG-E2E-8801"
    assert ingested_ticket.device_model == "iPhone 15 Pro Max"
    assert ingested_ticket.customer.phone == "0771234567"

    # Idempotent re-submission
    idemp_claim = ingest_portal_claim(db, claim_payload, organization_id=org.id)
    assert idemp_claim.id == ingested_claim.id

    # -------------------------------------------------------------------------
    # STAGE 5: Control Center Switches Industry & Re-Signs License
    # -------------------------------------------------------------------------
    grocery_license_payload = {
        "license_schema_version": 1,
        "license_id": "ISTORE-E2E-2026-0001",
        "tenant_code": "tenant-apex-lk",
        "shop_code": "MAIN-01",
        "package_code": "ENTERPRISE",
        "entitlements": ["pos", "inventory", "whatsapp"],
        "industry_code": "GROCERY",
        "capabilities": ["batch_tracking", "expiry_tracking", "weighted_products", "decimal_quantities"],
        "configuration_version": 2,
        "license_type": "SUBSCRIPTION",
        "issued_at": now.isoformat().replace("+00:00", "Z"),
        "starts_at": now.isoformat().replace("+00:00", "Z"),
        "expires_at": expires,
        "machine_fingerprint": "MACH-TEST-E2E-001",
        "grace_period_days": 7
    }

    signed_grocery_token = create_signed_token(grocery_license_payload, keys["private"])
    save_cached_license(signed_grocery_token)

    # ERP Resolves Updated Capabilities
    grocery_caps = get_effective_capabilities(db)
    assert grocery_caps["industry_type"] == "GROCERY"
    assert grocery_caps["configuration_version"] == 2
    assert grocery_caps["capabilities"]["repairs_management"] is False
    assert grocery_caps["capabilities"]["weighted_products"] is True
    assert grocery_caps["capabilities"]["batch_tracking"] is True
