import pytest
from datetime import datetime, date
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import IntegrityError

from app.main import app
from app.database import Base, get_db
from app.models import (
    User, Role, Organization, Branch, InventoryItem, Sale, SaleItem,
    AdvancePayment, Customer, Return as ReturnCase
)
from app.auth import get_current_user, create_access_token


# Setup in-memory SQLite DB for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    # Query or Create Roles
    admin_role = db.query(Role).filter(Role.name == "admin").first()
    if not admin_role:
        admin_role = Role(name="admin", display_name="Administrator")
        db.add(admin_role)
    cashier_role = db.query(Role).filter(Role.name == "cashier").first()
    if not cashier_role:
        cashier_role = Role(name="cashier", display_name="Cashier")
        db.add(cashier_role)
    db.flush()

    # Seed Tenants
    tenant_a = Organization(
        id=101,
        slug="tenant-a-org",
        name="Tenant A Supermarket",
        industry_type="GROCERY",
        capabilities_override={"weighted_products": True, "decimal_quantities": True, "batch_tracking": True}
    )
    tenant_b = Organization(
        id=202,
        slug="tenant-b-boutique",
        name="Tenant B Boutique",
        industry_type="FASHION",
        capabilities_override={"matrix_variants": True}
    )
    db.add_all([tenant_a, tenant_b])
    db.flush()

    branch_a = Branch(id=1011, organization_id=101, code="BR-A1", name="A Main Branch")
    branch_b = Branch(id=2021, organization_id=202, code="BR-B1", name="B Main Branch")
    db.add_all([branch_a, branch_b])
    db.flush()

    # Seed Users
    user_a = User(
        id=11,
        username="user_a",
        password_hash="fakehash",
        role="admin",
        role_id=admin_role.id,
        organization_id=101,
        branch_id=1011,
        is_active=True
    )
    user_b = User(
        id=22,
        username="user_b",
        password_hash="fakehash",
        role="admin",
        role_id=admin_role.id,
        organization_id=202,
        branch_id=2021,
        is_active=True
    )
    db.add_all([user_a, user_b])
    db.commit()
    db.close()

    yield

    Base.metadata.drop_all(bind=engine)


def test_composite_unique_constraints_cross_tenants():
    """Verify separate tenants can create items with the exact same SKU without conflict."""
    db = TestingSessionLocal()
    
    # Tenant A creates SKU-COMMON-01
    item_a = InventoryItem(
        organization_id=101,
        branch_id=1011,
        name="Tenant A Organic Apples",
        sku="SKU-COMMON-01",
        quantity=50.0,
        sale_price=350.0,
        unit_of_measure="kg",
        is_weighted=True,
        allow_decimal_qty=True
    )
    db.add(item_a)
    db.commit()

    # Tenant B creates identical SKU-COMMON-01 under tenant 202
    item_b = InventoryItem(
        organization_id=202,
        branch_id=2021,
        name="Tenant B Silk Shirt",
        sku="SKU-COMMON-01",
        quantity=15.0,
        sale_price=4500.0,
        unit_of_measure="pcs"
    )
    db.add(item_b)
    db.commit()

    # Verify both items exist in database simultaneously
    items = db.query(InventoryItem).filter(InventoryItem.sku == "SKU-COMMON-01").all()
    assert len(items) == 2
    org_ids = {i.organization_id for i in items}
    assert org_ids == {101, 202}

    # Verify duplicate SKU within the SAME tenant violates composite uniqueness
    item_duplicate_a = InventoryItem(
        organization_id=101,
        branch_id=1011,
        name="Tenant A Duplicate Item",
        sku="SKU-COMMON-01",
        quantity=10.0,
        sale_price=100.0
    )
    db.add(item_duplicate_a)
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    db.close()


def test_composite_unique_invoice_numbers_cross_tenants():
    """Verify separate tenants can generate identical invoice numbers without collisions."""
    db = TestingSessionLocal()
    
    sale_a = Sale(
        organization_id=101,
        branch_id=1011,
        invoice_no="INV-2026-000001",
        total=1500.0,
        payment_method="Cash",
        payment_status="paid"
    )
    sale_b = Sale(
        organization_id=202,
        branch_id=2021,
        invoice_no="INV-2026-000001",
        total=4500.0,
        payment_method="Card",
        payment_status="paid"
    )
    db.add_all([sale_a, sale_b])
    db.commit()

    sales = db.query(Sale).filter(Sale.invoice_no == "INV-2026-000001").all()
    assert len(sales) == 2
    assert {s.organization_id for s in sales} == {101, 202}

    db.close()


def test_embedded_weigh_scale_barcode_lookup():
    """Verify EAN-13 Type 2 scale barcode lookup parses item code and embedded weight in kg."""
    from app.routers.pos_router import pos_barcode_lookup
    from starlette.requests import Request

    db = TestingSessionLocal()
    
    # Create weighted produce item with SKU '00123'
    produce = InventoryItem(
        organization_id=101,
        branch_id=1011,
        name="Fresh Cavendish Bananas",
        sku="00123",
        barcode="00123",
        quantity=100.0,
        sale_price=420.0,
        unit_of_measure="kg",
        is_weighted=True,
        allow_decimal_qty=True
    )
    db.add(produce)
    db.commit()

    req = Request({"type": "http", "method": "GET", "path": "/api/pos/barcode/2000123014506", "headers": []})
    req.state.current_org_id = 101
    req.state.current_branch_id = 1011

    # Scan weigh scale barcode: Prefix 20, Item Code 00123, Weight 01450 (1.450 kg), Checksum 6 -> '2000123014506'
    data = pos_barcode_lookup(
        barcode="2000123014506",
        request=req,
        db=db,
        _=None
    )
    assert data["sku"] == "00123"
    assert data.get("is_scale_scan") is True
    assert data.get("detected_weight") == 1.450
    assert data.get("detected_qty") == 1.450
    db.close()
