import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request
from fastapi import BackgroundTasks

from app.models import (
    Base, Organization, Branch, Role, User, InventoryItem, Sale, SaleItem
)
from app.schemas import SaleIn, SaleLine
from app.routers.pos_router import batch_sync_offline_sales, OfflineBatchSyncRequest, OfflineSaleBatchItem


SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _create_mock_request(org_id: int, branch_id: int):
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/pos/checkout/batch-sync",
        "headers": [],
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


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    org = Organization(id=101, slug="grocery-org", name="Fresh Grocery Store", industry_type="GROCERY")
    branch = Branch(id=1011, organization_id=101, code="BR01", name="Main Kandy Branch")
    role = Role(name="admin", display_name="Administrator")
    db.add_all([org, branch, role])
    db.flush()

    user = User(id=1, username="admin", organization_id=101, branch_id=1011, role_id=role.id, role="admin")
    db.add(user)

    # Seed Inventory Products
    prod1 = InventoryItem(
        id=501,
        organization_id=101,
        branch_id=1011,
        name="Fresh Milk 1L",
        sku="SKU-MILK-1L",
        quantity=100.0,
        sale_price=450.0,
        cost_price=380.0
    )
    prod2 = InventoryItem(
        id=502,
        organization_id=101,
        branch_id=1011,
        name="Basmati Rice 5kg",
        sku="SKU-RICE-5KG",
        quantity=50.0,
        sale_price=2200.0,
        cost_price=1900.0
    )
    db.add_all([prod1, prod2])
    db.commit()
    db.close()

    yield

    Base.metadata.drop_all(bind=engine)


def test_offline_batch_sync_success_and_idempotency():
    db = TestingSessionLocal()
    req = _create_mock_request(101, 1011)
    user = MockUser(id=1, organization_id=101, branch_id=1011)
    bg_tasks = BackgroundTasks()

    # Create 2 offline sales
    sale1_payload = SaleIn(
        payment_method="Cash",
        paid=True,
        cash_amount=900.0,
        card_amount=0.0,
        discount_amount=0.0,
        tax_amount=0.0,
        lines=[
            SaleLine(item_id=501, quantity=2.0, price=450.0) # 2 x 450 = 900
        ]
    )

    sale2_payload = SaleIn(
        payment_method="Cash",
        paid=True,
        cash_amount=2200.0,
        card_amount=0.0,
        discount_amount=0.0,
        tax_amount=0.0,
        lines=[
            SaleLine(item_id=502, quantity=1.0, price=2200.0) # 1 x 2200 = 2200
        ]
    )

    batch_req = OfflineBatchSyncRequest(
        sales=[
            OfflineSaleBatchItem(
                offline_invoice_no="INV-OFF-BR01-POS01-LX1A-001",
                checkout_payload=sale1_payload,
                terminal_id="POS01"
            ),
            OfflineSaleBatchItem(
                offline_invoice_no="INV-OFF-BR01-POS01-LX1A-002",
                checkout_payload=sale2_payload,
                terminal_id="POS01"
            )
        ]
    )

    # 1. First sync batch
    res = batch_sync_offline_sales(
        payload=batch_req,
        request=req,
        background_tasks=bg_tasks,
        db=db,
        current_user=user
    )

    assert res["success"] is True
    assert res["synced_count"] == 2
    assert res["skipped_count"] == 0

    # Verify inventory was deducted correctly
    p1 = db.query(InventoryItem).filter(InventoryItem.id == 501).first()
    p2 = db.query(InventoryItem).filter(InventoryItem.id == 502).first()
    assert p1.quantity == 98.0  # 100 - 2
    assert p2.quantity == 49.0  # 50 - 1

    # 2. Re-syncing the SAME batch should be completely idempotent (skipped without double deduction)
    res_retry = batch_sync_offline_sales(
        payload=batch_req,
        request=req,
        background_tasks=bg_tasks,
        db=db,
        current_user=user
    )

    assert res_retry["success"] is True
    assert res_retry["synced_count"] == 0
    assert res_retry["skipped_count"] == 2
    assert all(r["status"] == "already_synced" for r in res_retry["results"])

    # Stock must remain unchanged after idempotent resend
    db.refresh(p1)
    db.refresh(p2)
    assert p1.quantity == 98.0
    assert p2.quantity == 49.0

    db.close()
