import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models import (
    User, Role, Organization, Branch, Customer, Supplier,
    InventoryItem, InventorySerial, Sale, SaleItem,
    RepairTicket, RepairEstimate, RepairPartUsage,
    WarrantyRule, WarrantyRecord, WarrantyClaim
)
from app.constants import REPAIR_STATUS_PENDING, REPAIR_STATUS_COMPLETED

@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

def test_mobile_pos_serialized_sale_workflow(db_session):
    # 1. Setup Tenant & Branch
    org = Organization(name="Apple Store Colombo", slug="apple-colombo", status="active")
    db_session.add(org)
    db_session.flush()

    branch = Branch(organization_id=org.id, code="COL-01", name="Main Outlet")
    db_session.add(branch)
    db_session.flush()

    # 2. Setup Customer & Inventory with Serial
    cust = Customer(organization_id=org.id, name="Kasun Perera", phone="0771234567")
    db_session.add(cust)

    phone = InventoryItem(
        organization_id=org.id,
        name="iPhone 15 Pro",
        category="Smartphones",
        brand="Apple",
        model="15 Pro",
        storage="256GB",
        color="Natural Titanium",
        condition="New",
        sku="IPHONE-15P-256",
        quantity=1,
        cost_price=350000,
        sale_price=410000,
        has_serials=True,
        warranty_days=365
    )
    db_session.add(phone)
    db_session.flush()

    serial = InventorySerial(
        item_id=phone.id,
        serial_number="354890123456789", # IMEI
        status="in_stock"
    )
    db_session.add(serial)
    db_session.flush()

    # 3. Process POS Serialized Sale
    sale = Sale(
        organization_id=org.id,
        invoice_no="INV-2026-0001",
        customer_id=cust.id,
        subtotal=410000,
        total=410000,
        payment_method="Cash",
        cash_amount=410000,
        amount_paid=410000,
        payment_status="paid"
    )
    db_session.add(sale)
    db_session.flush()

    sale_item = SaleItem(
        organization_id=org.id,
        sale_id=sale.id,
        item_id=phone.id,
        serial_id=serial.id,
        serial_number=serial.serial_number,
        quantity=1,
        price=410000,
        line_total=410000,
        cost_price=350000,
        warranty_days=365
    )
    db_session.add(sale_item)
    
    # Update inventory state
    phone.quantity -= 1
    serial.status = "sold"
    serial.sale_id = sale.id

    # Create Warranty Record
    from datetime import datetime, timedelta
    warranty = WarrantyRecord(
        organization_id=org.id,
        invoice_id=sale.id,
        sale_item_id=sale_item.id,
        customer_id=cust.id,
        customer_name=cust.name,
        product_or_service_name=phone.name,
        product_id=phone.id,
        serial_id=serial.id,
        serial_number=serial.serial_number,
        warranty_type="product",
        start_date=datetime.utcnow(),
        end_date=datetime.utcnow() + timedelta(days=365),
        warranty_days=365,
        status="active"
    )
    db_session.add(warranty)
    db_session.commit()

    # Assertions
    assert phone.quantity == 0
    assert serial.status == "sold"
    assert serial.sale_id == sale.id
    assert warranty.status == "active"
    assert warranty.serial_number == "354890123456789"

def test_repair_ticket_lifecycle(db_session):
    org = Organization(name="iFix Repairs", slug="ifix", status="active")
    db_session.add(org)
    db_session.flush()

    cust = Customer(organization_id=org.id, name="Amal Silva", phone="0719876543")
    db_session.add(cust)
    db_session.flush()

    # Create Repair Ticket
    ticket = RepairTicket(
        organization_id=org.id,
        ticket_no="REP-2026-001",
        customer_id=cust.id,
        device_model="Samsung S23 Ultra",
        imei="990012345678901",
        issue="Cracked Display",
        status=REPAIR_STATUS_PENDING
    )
    db_session.add(ticket)
    db_session.flush()

    assert ticket.status == "pending"
    assert ticket.imei == "990012345678901"

    # Complete Repair
    ticket.status = REPAIR_STATUS_COMPLETED
    db_session.commit()
    assert ticket.status == "completed"

def test_tenant_isolation(db_session):
    org_a = Organization(name="Shop A", slug="shop-a")
    org_b = Organization(name="Shop B", slug="shop-b")
    db_session.add_all([org_a, org_b])
    db_session.flush()

    item_a = InventoryItem(organization_id=org_a.id, name="Item A", sku="SKU-A", quantity=10)
    item_b = InventoryItem(organization_id=org_b.id, name="Item B", sku="SKU-B", quantity=20)
    db_session.add_all([item_a, item_b])
    db_session.commit()

    items_org_a = db_session.query(InventoryItem).filter(InventoryItem.organization_id == org_a.id).all()
    assert len(items_org_a) == 1
    assert items_org_a[0].name == "Item A"
