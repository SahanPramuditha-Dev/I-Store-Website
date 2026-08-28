import pytest
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request
from fastapi import BackgroundTasks

from app.models import (
    Base, Organization, Branch, Role, User, Sale, CashReconciliation, AppSetting
)
from app.routers.shifts_router import (
    open_register_shift,
    record_shift_cash_movement,
    get_interim_x_report,
    close_register_shift,
    get_current_shift,
    OpenShiftIn,
    CashMovementIn,
    CloseShiftIn
)


SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _create_mock_request(org_id: int, branch_id: int):
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/shifts/current",
        "headers": [],
    }
    req = Request(scope)
    req.state.current_org_id = org_id
    req.state.current_branch_id = branch_id
    return req


class MockUser:
    def __init__(self, id: int, organization_id: int, branch_id: int, username: str = "cashier1"):
        self.id = id
        self.organization_id = organization_id
        self.branch_id = branch_id
        self.username = username
        self.name = f"Cashier {username}"
        self.role = "cashier"


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    org = Organization(id=201, slug="mega-mart", name="Mega Mart Supermarket", industry_type="GROCERY")
    branch = Branch(id=2011, organization_id=201, code="BR01", name="Colombo Central")
    role = Role(name="cashier", display_name="Cashier")
    db.add_all([org, branch, role])
    db.flush()

    user = User(id=10, username="kasun", organization_id=201, branch_id=2011, role_id=role.id, role="cashier")
    db.add(user)

    # Add store settings
    s1 = AppSetting(key="store_name", value="Mega Mart Supermarket")
    s2 = AppSetting(key="store_owner_phone", value="0771234567")
    db.add_all([s1, s2])

    db.commit()
    db.close()

    yield

    Base.metadata.drop_all(bind=engine)


def test_full_shift_lifecycle_x_and_z_reports():
    db = TestingSessionLocal()
    req = _create_mock_request(201, 2011)
    cashier = MockUser(id=10, organization_id=201, branch_id=2011, username="kasun")
    bg_tasks = BackgroundTasks()

    # 1. Open Shift with float 10,000 LKR
    open_res = open_register_shift(
        payload=OpenShiftIn(opening_float=10000.0, shift_name="Morning Shift", notes="Starting float"),
        request=req,
        db=db,
        current_user=cashier
    )
    assert open_res["ok"] is True
    assert open_res["shift_id"] is not None
    shift_id = open_res["shift_id"]

    # 2. Simulate 2 cash sales and 1 card sale completed during shift
    sale1 = Sale(
        invoice_no="INV-201-001",
        organization_id=201,
        branch_id=2011,
        created_by=10,
        payment_method="Cash",
        cash_amount=5000.0,
        total=5000.0,
        subtotal=5000.0,
        paid=True,
        is_voided=False
    )
    sale2 = Sale(
        invoice_no="INV-201-002",
        organization_id=201,
        branch_id=2011,
        created_by=10,
        payment_method="Cash",
        cash_amount=7500.0,
        total=7500.0,
        subtotal=7500.0,
        paid=True,
        is_voided=False
    )
    sale3 = Sale(
        invoice_no="INV-201-003",
        organization_id=201,
        branch_id=2011,
        created_by=10,
        payment_method="Card",
        card_amount=12000.0,
        total=12000.0,
        subtotal=12000.0,
        paid=True,
        is_voided=False
    )
    db.add_all([sale1, sale2, sale3])
    db.commit()

    # 3. Check Current Shift status: Opening Float (10,000) + Cash Sales (12,500) = Expected (22,500)
    cur_shift = get_current_shift(request=req, db=db, current_user=cashier)
    assert cur_shift["has_active_shift"] is True
    assert cur_shift["shift"]["sales_summary"]["cash_sales"] == 12500.0
    assert cur_shift["shift"]["sales_summary"]["card_sales"] == 12000.0
    assert cur_shift["shift"]["sales_summary"]["expected_drawer_cash"] == 22500.0

    # 4. Midday Cash Drop to safe: Skim 15,000 LKR to safe
    drop_res = record_shift_cash_movement(
        payload=CashMovementIn(movement_type="drop", amount=15000.0, reason="Safe drop 1"),
        request=req,
        db=db,
        current_user=cashier
    )
    assert drop_res["ok"] is True
    assert drop_res["cash_drops_total"] == 15000.0

    # Expected drawer now = 22,500 - 15,000 = 7,500 LKR
    # 5. Fetch Interim X-Report
    x_rep = get_interim_x_report(request=req, db=db, current_user=cashier)
    assert x_rep["report_type"] == "X_READING"
    assert x_rep["expected_drawer_cash"] == 7500.0
    assert x_rep["cash_drops_total"] == 15000.0

    # 6. Close Shift (Z-Report) with counted total = 7,500 (Balanced)
    close_res = close_register_shift(
        payload=CloseShiftIn(
            counted_cash_total=7500.0,
            denominations={"5000": 1, "1000": 2, "500": 1}, # 5000 + 2000 + 500 = 7500
            send_whatsapp_report=True
        ),
        background_tasks=bg_tasks,
        request=req,
        db=db,
        current_user=cashier
    )

    assert close_res["ok"] is True
    assert close_res["status"] == "Balanced"
    assert close_res["difference"] == 0.0
    assert "End-of-Day Z-Report" in close_res["z_report_text"]
    assert close_res["z_report_dispatched"] is True

    # 7. Check database record
    recon_rec = db.query(CashReconciliation).filter(CashReconciliation.id == shift_id).first()
    assert recon_rec.status == "Closed"
    assert recon_rec.counted_cash_total == 7500.0
    assert recon_rec.cash_drops_total == 15000.0

    db.close()
