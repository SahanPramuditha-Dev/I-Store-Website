from datetime import UTC, datetime, timedelta


def test_global_search_extended_categories_and_invoice_lookup(client, auth_headers):
    marker = f"SearchHub-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}"

    inventory_resp = client.get("/inventory", headers=auth_headers)
    assert inventory_resp.status_code == 200, inventory_resp.text
    inventory_rows = inventory_resp.json()
    assert inventory_rows, "Expected seeded inventory rows"
    item = next((row for row in inventory_rows if int(row.get("quantity") or 0) >= 1), inventory_rows[0])
    if int(item.get("quantity") or 0) < 1:
        adjust_resp = client.post(
            "/inventory/adjust",
            json={"item_id": item["id"], "quantity_change": 2, "note": "Search test stock top-up"},
            headers=auth_headers,
        )
        assert adjust_resp.status_code == 200, adjust_resp.text
        refreshed = client.get("/inventory", headers=auth_headers).json()
        item = next((row for row in refreshed if row["id"] == item["id"]), item)

    supplier_payload = {
        "name": marker,
        "contact": "0770000000",
        "email": f"{marker.lower()}@supplier.test",
        "address": "Colombo",
        "notes": "search test",
        "payment_terms_days": 7,
        "opening_balance": 0,
    }
    supplier_resp = client.post("/inventory/suppliers", json=supplier_payload, headers=auth_headers)
    assert supplier_resp.status_code == 200, supplier_resp.text
    supplier = supplier_resp.json()
    supplier_id = supplier["id"]

    po_payload = {
        "supplier_id": supplier_id,
        "note": f"{marker} purchase",
        "items": [
            {
                "item_id": item["id"],
                "quantity": 1,
                "unit_cost": float(item.get("cost_price") or 0) or 1.0,
            }
        ],
    }
    po_resp = client.post("/purchase", json=po_payload, headers=auth_headers)
    assert po_resp.status_code == 200, po_resp.text
    po = po_resp.json()

    supplier_payment_resp = client.post(
        f"/inventory/suppliers/{supplier_id}/payments",
        json={"amount": 1234.5, "note": f"{marker} settlement"},
        headers=auth_headers,
    )
    assert supplier_payment_resp.status_code == 200, supplier_payment_resp.text

    expense_resp = client.post(
        "/expenses",
        json={
            "category": "Miscellaneous",
            "amount": 999.0,
            "description": f"{marker} expense",
            "payment_method": "Cash",
            "vendor_name": marker,
            "reference_no": f"REF-{marker}",
            "expense_date": datetime.now(UTC).isoformat(),
        },
        headers=auth_headers,
    )
    assert expense_resp.status_code == 200, expense_resp.text
    expense = expense_resp.json()

    warranty_resp = client.post(
        "/warranty/records",
        json={
            "customer_name": marker,
            "customer_phone": "0711111111",
            "product_or_service_name": f"{marker} Product",
            "warranty_type": "Product",
            "start_date": datetime.now(UTC).isoformat(),
            "warranty_days": 30,
            "end_date": (datetime.now(UTC) + timedelta(days=30)).isoformat(),
            "status": "Active",
        },
        headers=auth_headers,
    )
    assert warranty_resp.status_code == 200, warranty_resp.text
    warranty = warranty_resp.json()

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
    sale_id = sale["sale_id"]

    expanded_search_resp = client.get("/search/global", params={"q": marker}, headers=auth_headers)
    assert expanded_search_resp.status_code == 200, expanded_search_resp.text
    expanded = expanded_search_resp.json()

    expected_keys = {"customers", "repairs", "inventory", "sales", "suppliers", "purchase_orders", "payments", "warranty", "expenses"}
    assert expected_keys.issubset(set(expanded.keys()))

    assert any(row["id"] == supplier_id and marker in row["name"] for row in expanded["suppliers"])
    assert any(row["id"] == po["id"] and row["po_number"] == po["po_number"] for row in expanded["purchase_orders"])
    assert any(row["id"] == expense["id"] and row["expense_code"] == expense["expense_code"] for row in expanded["expenses"])
    assert any(row["id"] == warranty["id"] and row["warranty_code"] == warranty["warranty_id"] for row in expanded["warranty"])
    assert any(row["source_type"] == "supplier_payment" and marker in (row.get("counterparty") or "") for row in expanded["payments"])

    invoice_query = f"INV-{sale_id:05d}"
    invoice_search_resp = client.get("/search/global", params={"q": invoice_query}, headers=auth_headers)
    assert invoice_search_resp.status_code == 200, invoice_search_resp.text
    invoice_search = invoice_search_resp.json()
    assert any(row["id"] == sale_id for row in invoice_search["sales"])
    assert any(row["source_type"] == "sale" and row["source_id"] == sale_id for row in invoice_search["payments"])
