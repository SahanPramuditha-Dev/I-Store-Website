import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request
from fastapi import HTTPException, BackgroundTasks

from app.models import (
    Base,
    Organization,
    Branch,
    Customer,
    InventoryItem,
    RepairTicket,
)
from app.schemas import InventoryIn, SaleIn, SaleLine
from app.routers.inventory_router import create_inventory
from app.routers.pos_router import checkout


def _create_mock_request(org_id: int, branch_id: int):
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/",
        "headers": [],
        "state": {
            "current_org_id": org_id,
            "current_branch_id": branch_id,
        },
    }
    req = Request(scope)
    req.state.current_org_id = org_id
    req.state.current_branch_id = branch_id
    return req


class MockUser:
    def __init__(self, id: int, organization_id: int, branch_id: int, role: str = "admin"):
        self.id = id
        self.organization_id = organization_id
        self.branch_id = branch_id
        self.role = role
        self.username = f"user_{id}"
        self.full_name = f"User {id}"


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()

    # Org 1: Grocery (No serial tracking, no repairs, but has batch, expiry, decimal, weighted)
    org1 = Organization(id=1, slug="grocery-001", name="Fresh Grocery", industry_type="GROCERY")
    # Org 2: Fashion (No batch, no serial tracking, no repairs, no decimal)
    org2 = Organization(id=2, slug="fashion-001", name="Vogue Avenue", industry_type="FASHION")
    # Org 3: Mobile Retail (Has serials, repairs, but no batch, no expiry, no decimal)
    org3 = Organization(id=3, slug="mobile-001", name="Apex Mobile", industry_type="MOBILE_RETAIL")
    session.add_all([org1, org2, org3])
    session.flush()

    branch1 = Branch(id=1, organization_id=1, code="BR-1", name="Grocery Main")
    branch2 = Branch(id=2, organization_id=2, code="BR-2", name="Fashion Main")
    branch3 = Branch(id=3, organization_id=3, code="BR-3", name="Mobile Main")
    session.add_all([branch1, branch2, branch3])
    session.flush()

    # Seed products for POS checkout
    c3 = Customer(id=1, name="John Doe", phone="0779999999", organization_id=3, branch_id=3)
    p3 = InventoryItem(id=1, name="Samsung Screen Replacement", sku="SAM-SCR-01", organization_id=3, branch_id=3, quantity=10, cost_price=50, sale_price=100)
    rep3 = RepairTicket(id=1, ticket_no="REP-001", customer_id=1, device_model="Galaxy S21", issue="Broken LCD", organization_id=3, branch_id=3)
    session.add_all([c3, p3, rep3])

    c1 = Customer(id=2, name="Grocery Customer", phone="0778888888", organization_id=1, branch_id=1)
    p1 = InventoryItem(id=2, name="Fresh Apples", sku="APPLE-KG", organization_id=1, branch_id=1, quantity=100, cost_price=2, sale_price=4, allow_decimal_qty=True)
    session.add_all([c1, p1])

    session.commit()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


def test_serial_tracking_capability_enforcement(db_session):
    # Grocery attempting to create product with has_serials=True must be rejected with 403
    req_grocery = _create_mock_request(org_id=1, branch_id=1)
    user_grocery = MockUser(id=1, organization_id=1, branch_id=1)

    payload_serial = InventoryIn(
        name="Serialized Grocery Item",
        category="Produce",
        sku="SER-GROC-01",
        quantity=5,
        cost_price=10,
        sale_price=20,
        has_serials=True,
    )

    with pytest.raises(HTTPException) as exc_info:
        create_inventory(request=req_grocery, payload=payload_serial, db=db_session, current_user=user_grocery)
    assert exc_info.value.status_code == 403
    assert "Serial / IMEI tracking is not licensed" in exc_info.value.detail


def test_batch_and_expiry_capability_enforcement(db_session):
    # Mobile Retail attempting to create product with batch_number must be rejected with 403
    req_mobile = _create_mock_request(org_id=3, branch_id=3)
    user_mobile = MockUser(id=3, organization_id=3, branch_id=3)

    payload_batch = InventoryIn(
        name="Phone Battery Pack",
        category="Parts",
        sku="BAT-001",
        quantity=20,
        cost_price=15,
        sale_price=30,
        batch_number="BATCH-2026-X",
    )

    with pytest.raises(HTTPException) as exc_info:
        create_inventory(request=req_mobile, payload=payload_batch, db=db_session, current_user=user_mobile)
    assert exc_info.value.status_code == 403
    assert "Batch tracking is not licensed" in exc_info.value.detail


def test_decimal_quantities_pos_enforcement(db_session):
    # Mobile Retail attempting to checkout decimal quantity (e.g. 1.5 units) must be rejected with 403
    req_mobile = _create_mock_request(org_id=3, branch_id=3)
    user_mobile = MockUser(id=3, organization_id=3, branch_id=3)
    bg_tasks = BackgroundTasks()

    payload_decimal_sale = SaleIn(
        customer_id=1,
        payment_method="Cash",
        cash_amount=150,
        paid=True,
        lines=[
            SaleLine(item_id=1, quantity=1.5, price=100.0)
        ]
    )

    with pytest.raises(HTTPException) as exc_info:
        checkout(payload=payload_decimal_sale, request=req_mobile, background_tasks=bg_tasks, db=db_session, current_user=user_mobile)
    assert exc_info.value.status_code == 403
    assert "Decimal quantities are not licensed" in exc_info.value.detail

    # Grocery checkout of 1.5 units succeeds
    req_grocery = _create_mock_request(org_id=1, branch_id=1)
    user_grocery = MockUser(id=1, organization_id=1, branch_id=1)

    payload_grocery_sale = SaleIn(
        customer_id=2,
        payment_method="Cash",
        cash_amount=6,
        paid=True,
        lines=[
            SaleLine(item_id=2, quantity=1.5, price=4.0)
        ]
    )
    res = checkout(payload=payload_grocery_sale, request=req_grocery, background_tasks=bg_tasks, db=db_session, current_user=user_grocery)
    assert res["total"] == 6.0
