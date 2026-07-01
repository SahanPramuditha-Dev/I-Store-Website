from datetime import UTC, datetime, timedelta


def _utc_naive_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _first_saleable_item(client, auth_headers):
    rows = client.get("/inventory", headers=auth_headers).json() or []
    item = next((row for row in rows if int(row.get("quantity") or 0) >= 2), None)
    if item:
        return item

    marker = _utc_naive_now().strftime("%Y%m%d%H%M%S%f")
    create_resp = client.post(
        "/inventory",
        json={
            "name": f"Closed Period Test Item {marker}",
            "category": "Test",
            "brand": "Generic",
            "model": "",
            "storage": "",
            "color": "",
            "condition": "New",
            "product_type": "Accessory",
            "location": "QA",
            "image_url": "",
            "warranty_days": 0,
            "sku": f"CP-{marker}",
            "barcode": f"CP-{marker}",
            "quantity": 5,
            "cost_price": 10,
            "sale_price": 20,
            "has_serials": False,
            "supplier_id": None,
        },
        headers=auth_headers,
    )
    assert create_resp.status_code == 200, create_resp.text
    return create_resp.json()


def _checkout_single_item(client, auth_headers, item_id: int, unit_price: float):
    resp = client.post(
        "/pos/checkout",
        json={
            "customer_id": None,
            "payment_method": "Cash",
            "paid": True,
            "discount_amount": 0,
            "tax_amount": 0,
            "lines": [{"item_id": item_id, "quantity": 1, "price": unit_price, "warranty_days": 0}],
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _close_current_period(client, auth_headers):
    now = _utc_naive_now()
    resp = client.post(
        "/financial-audit/periods/close",
        json={
            "start_date": (now - timedelta(days=1)).isoformat(),
            "end_date": (now + timedelta(days=1)).isoformat(),
            "reason": "Regression test closed period",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_closed_accounting_period_blocks_stock_and_expense_mutations(client, auth_headers):
    item = _first_saleable_item(client, auth_headers)
    _close_current_period(client, auth_headers)

    adjust_resp = client.post(
        "/inventory/adjust",
        json={"item_id": item["id"], "quantity_change": 1, "note": "Closed period adjustment"},
        headers=auth_headers,
    )
    assert adjust_resp.status_code == 423, adjust_resp.text

    expense_resp = client.post(
        "/expenses",
        json={
            "category": "Operations",
            "amount": 100,
            "tax_amount": 0,
            "description": "Closed period expense",
            "payment_method": "Cash",
            "expense_date": _utc_naive_now().isoformat(),
        },
        headers=auth_headers,
    )
    assert expense_resp.status_code == 423, expense_resp.text


def test_closed_accounting_period_blocks_pos_refund_and_void(client, auth_headers):
    item = _first_saleable_item(client, auth_headers)
    unit_price = float(item["sale_price"])
    refund_sale = _checkout_single_item(client, auth_headers, item["id"], unit_price)
    void_sale = _checkout_single_item(client, auth_headers, item["id"], unit_price)
    _close_current_period(client, auth_headers)

    refund_resp = client.post(
        "/pos/return",
        json={
            "sale_id": refund_sale["sale_id"],
            "note": "Closed period refund",
            "lines": [{"item_id": item["id"], "quantity": 1, "price": unit_price, "warranty_days": 0}],
        },
        headers=auth_headers,
    )
    assert refund_resp.status_code == 423, refund_resp.text

    void_resp = client.post(
        f"/pos/sales/{void_sale['sale_id']}/void",
        json={"reason": "Closed period void"},
        headers=auth_headers,
    )
    assert void_resp.status_code == 423, void_resp.text
