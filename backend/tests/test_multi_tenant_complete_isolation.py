import pytest
from datetime import datetime, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request

from app.models import (
    Base,
    Organization,
    Branch,
    Customer,
    InventoryItem,
    Sale,
    SaleItem,
    RepairTicket,
    PurchaseOrder,
    PurchaseOrderItem,
    Expense,
    GoodsReceivedNote,
    Supplier,
)
from app.routers.search_router import global_search, get_suggestions
from app.routers.dashboard_router import _dashboard_impl
from app.routers.report_router import detailed_sales_report, summary, detailed_expenses_report
from app.routers.purchase_router import list_pos, get_po
from app.routers.expenses_router import list_expenses, expense_summary


def _create_mock_request(org_id: int, branch_id: int):
    scope = {
        "type": "http",
        "method": "GET",
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

    # Seed 2 distinct organizations & branches
    org1 = Organization(id=1, slug="tenant-001", name="Alpha Mobile", industry_type="MOBILE_RETAIL")
    org2 = Organization(id=2, slug="tenant-002", name="Beta Grocery", industry_type="GROCERY")
    session.add_all([org1, org2])
    session.flush()

    branch1 = Branch(id=1, organization_id=1, code="BR-ALPHA-1", name="Alpha Main")
    branch2 = Branch(id=2, organization_id=2, code="BR-BETA-1", name="Beta Main")
    session.add_all([branch1, branch2])
    session.flush()

    # Seed Tenant 1 data
    c1 = Customer(id=1, name="Alice Alpha", phone="0771111111", organization_id=1, branch_id=1)
    i1 = InventoryItem(id=1, name="iPhone 15 Pro", sku="IPHONE-15-PRO", organization_id=1, branch_id=1, quantity=10, cost_price=1000, sale_price=1500)
    s1 = Sale(id=1, invoice_no="INV-ALPHA-001", customer_id=1, organization_id=1, branch_id=1, total=1500, subtotal=1500, paid=True)
    rep1 = RepairTicket(id=1, ticket_no="REP-ALPHA-001", customer_id=1, device_model="iPhone 13", issue="Screen cracked", organization_id=1, branch_id=1)
    sup1 = Supplier(id=1, name="Alpha Supply Corp", organization_id=1, branch_id=1)
    po1 = PurchaseOrder(id=1, po_number="PO-ALPHA-001", supplier_id=1, total_cost=5000, status="Draft", organization_id=1, branch_id=1)
    exp1 = Expense(id=1, expense_code="EXP-ALPHA-001", category="Utilities", amount=350, organization_id=1, branch_id=1)
    session.add_all([c1, i1, s1, rep1, sup1, po1, exp1])

    # Seed Tenant 2 data
    c2 = Customer(id=2, name="Bob Beta", phone="0772222222", organization_id=2, branch_id=2)
    i2 = InventoryItem(id=2, name="Organic Fresh Milk", sku="MILK-1L", organization_id=2, branch_id=2, quantity=50, cost_price=200, sale_price=350)
    s2 = Sale(id=2, invoice_no="INV-BETA-001", customer_id=2, organization_id=2, branch_id=2, total=700, subtotal=700, paid=True)
    sup2 = Supplier(id=2, name="Beta Farm Supply", organization_id=2, branch_id=2)
    po2 = PurchaseOrder(id=2, po_number="PO-BETA-001", supplier_id=2, total_cost=12000, status="Draft", organization_id=2, branch_id=2)
    exp2 = Expense(id=2, expense_code="EXP-BETA-001", category="Logistics", amount=800, organization_id=2, branch_id=2)
    session.add_all([c2, i2, s2, sup2, po2, exp2])

    session.commit()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


def test_search_isolation_between_tenants(db_session):
    req_t1 = _create_mock_request(org_id=1, branch_id=1)
    user_t1 = MockUser(id=1, organization_id=1, branch_id=1)

    req_t2 = _create_mock_request(org_id=2, branch_id=2)
    user_t2 = MockUser(id=2, organization_id=2, branch_id=2)

    # Search for customer in Tenant 1
    t1_res = global_search(q="Alice", request=req_t1, db=db_session, current_user=user_t1)
    assert len(t1_res.get("customers", [])) == 1
    assert t1_res["customers"][0]["name"] == "Alice Alpha"

    # Tenant 2 searching for Alice must return 0 results
    t2_res = global_search(q="Alice", request=req_t2, db=db_session, current_user=user_t2)
    assert len(t2_res.get("customers", [])) == 0

    # Tenant 2 search for Bob returns Bob
    t2_bob = global_search(q="Bob", request=req_t2, db=db_session, current_user=user_t2)
    assert len(t2_bob.get("customers", [])) == 1
    assert t2_bob["customers"][0]["name"] == "Bob Beta"


def test_dashboard_isolation_between_tenants(db_session):
    req_t1 = _create_mock_request(org_id=1, branch_id=1)
    user_t1 = MockUser(id=1, organization_id=1, branch_id=1)

    req_t2 = _create_mock_request(org_id=2, branch_id=2)
    user_t2 = MockUser(id=2, organization_id=2, branch_id=2)

    t1_dash = _dashboard_impl(period="month", db=db_session, request=req_t1, current_user=user_t1)
    t2_dash = _dashboard_impl(period="month", db=db_session, request=req_t2, current_user=user_t2)

    # Tenant 1 has 1 customer, 1 sale of 1500, repair metrics present
    assert t1_dash["customers_count"] == 1
    assert t1_dash["daily_revenue"] == 1500.0
    assert "repair_stats" in t1_dash

    # Tenant 2 has 1 customer, 1 sale of 700, and GROCERY industry has NO repairs
    assert t2_dash["customers_count"] == 1
    assert t2_dash["daily_revenue"] == 700.0
    assert t2_dash["repair_stats"]["total"] == 0


def test_reports_isolation_between_tenants(db_session):
    req_t1 = _create_mock_request(org_id=1, branch_id=1)
    user_t1 = MockUser(id=1, organization_id=1, branch_id=1)

    req_t2 = _create_mock_request(org_id=2, branch_id=2)
    user_t2 = MockUser(id=2, organization_id=2, branch_id=2)

    # Sales report
    t1_sales = detailed_sales_report(request=req_t1, date_from=None, date_to=None, page=1, page_size=500, db=db_session, _=user_t1)
    t2_sales = detailed_sales_report(request=req_t2, date_from=None, date_to=None, page=1, page_size=500, db=db_session, _=user_t2)

    assert len(t1_sales) == 1
    assert t1_sales[0]["invoice_no"] == "INV-ALPHA-001"
    assert len(t2_sales) == 1
    assert t2_sales[0]["invoice_no"] == "INV-BETA-001"

    # Expenses report
    t1_exp = detailed_expenses_report(request=req_t1, date_from=None, date_to=None, page=1, page_size=500, db=db_session)
    t2_exp = detailed_expenses_report(request=req_t2, date_from=None, date_to=None, page=1, page_size=500, db=db_session)

    assert len(t1_exp) == 1
    assert t1_exp[0]["expense_code"] == "EXP-ALPHA-001"
    assert len(t2_exp) == 1
    assert t2_exp[0]["expense_code"] == "EXP-BETA-001"


def test_purchases_and_expenses_isolation(db_session):
    req_t1 = _create_mock_request(org_id=1, branch_id=1)
    user_t1 = MockUser(id=1, organization_id=1, branch_id=1)

    req_t2 = _create_mock_request(org_id=2, branch_id=2)
    user_t2 = MockUser(id=2, organization_id=2, branch_id=2)

    from fastapi import Response
    mock_resp = Response()

    # Purchase Orders list
    t1_pos = list_pos(request=req_t1, response=mock_resp, offset=0, limit=100, db=db_session, _=user_t1)
    t2_pos = list_pos(request=req_t2, response=mock_resp, offset=0, limit=100, db=db_session, _=user_t2)

    assert len(t1_pos) == 1
    assert t1_pos[0]["po_number"] == "PO-ALPHA-001"
    assert len(t2_pos) == 1
    assert t2_pos[0]["po_number"] == "PO-BETA-001"

    # Cross-tenant get_po returns 404
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        get_po(request=req_t2, po_id=1, db=db_session, _=user_t2)
    assert exc_info.value.status_code == 404
