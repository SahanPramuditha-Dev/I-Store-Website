import pytest


def _first_saleable_item(client, auth_headers):
    rows = client.get("/inventory", headers=auth_headers).json() or []
    item = next((row for row in rows if int(row.get("quantity") or 0) >= 1), None)
    assert item, "Expected at least one saleable inventory item"
    return item


def test_sales_and_expenses_write_immutable_accounting_ledger(client, auth_headers):
    item = _first_saleable_item(client, auth_headers)
    sale_resp = client.post(
        "/pos/checkout",
        json={
            "customer_id": None,
            "payment_method": "Cash",
            "paid": True,
            "discount_amount": 0,
            "tax_amount": 0,
            "lines": [{"item_id": item["id"], "quantity": 1, "price": float(item["sale_price"]), "warranty_days": 0}],
        },
        headers=auth_headers,
    )
    assert sale_resp.status_code == 200, sale_resp.text
    sale = sale_resp.json()

    sale_ledger_resp = client.get(
        "/financial-audit/ledger",
        params={"reference_type": "invoice", "reference_id": sale["sale_id"]},
        headers=auth_headers,
    )
    assert sale_ledger_resp.status_code == 200, sale_ledger_resp.text
    sale_entries = sale_ledger_resp.json()
    assert any(row["entry_type"] == "sale" and row["amount"] == sale["total"] for row in sale_entries)

    expense_resp = client.post(
        "/expenses",
        json={
            "category": "Operations",
            "amount": 250,
            "tax_amount": 0,
            "description": "Ledger regression expense",
            "payment_method": "Cash",
        },
        headers=auth_headers,
    )
    assert expense_resp.status_code == 200, expense_resp.text
    expense = expense_resp.json()

    expense_ledger_resp = client.get(
        "/financial-audit/ledger",
        params={"reference_type": "expense", "reference_id": expense["id"]},
        headers=auth_headers,
    )
    assert expense_ledger_resp.status_code == 200, expense_ledger_resp.text
    expense_entries = expense_ledger_resp.json()
    assert any(row["entry_type"] == "expense_created" and row["amount"] == 250 for row in expense_entries)

    from app.database import SessionLocal
    from app.models import AccountingLedgerEntry

    db = SessionLocal()
    try:
        row = db.query(AccountingLedgerEntry).filter(AccountingLedgerEntry.id == sale_entries[0]["id"]).first()
        assert row is not None
        row.amount = row.amount + 1
        with pytest.raises(ValueError, match="immutable"):
            db.commit()
    finally:
        db.rollback()
        db.close()
