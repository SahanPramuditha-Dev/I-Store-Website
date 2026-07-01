def test_app_startup_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_pos_checkout_and_return_stock_consistency(client, auth_headers):
    inv_resp = client.get("/inventory", headers=auth_headers)
    assert inv_resp.status_code == 200, inv_resp.text
    inventory = inv_resp.json()
    item = next(i for i in inventory if i["quantity"] >= 2)
    item_id = item["id"]
    original_qty = item["quantity"]
    unit_price = float(item["sale_price"])

    checkout_payload = {
        "customer_id": None,
        "payment_method": "Cash",
        "paid": True,
        "discount_amount": 0,
        "tax_amount": 0,
        "lines": [
            {
                "item_id": item_id,
                "quantity": 2,
                "price": unit_price,
                "warranty_days": 0,
            }
        ],
    }
    checkout_resp = client.post("/pos/checkout", json=checkout_payload, headers=auth_headers)
    assert checkout_resp.status_code == 200, checkout_resp.text
    sale = checkout_resp.json()
    assert sale["total"] == unit_price * 2
    sale_id = sale["sale_id"]

    inv_after_sale = client.get("/inventory", headers=auth_headers).json()
    sold_item = next(i for i in inv_after_sale if i["id"] == item_id)
    assert sold_item["quantity"] == original_qty - 2

    return_payload = {
        "sale_id": sale_id,
        "note": "test return",
        "lines": [{"item_id": item_id, "quantity": 2, "price": unit_price, "warranty_days": 0}],
    }
    return_resp = client.post("/pos/return", json=return_payload, headers=auth_headers)
    assert return_resp.status_code == 200, return_resp.text

    inv_after_return = client.get("/inventory", headers=auth_headers).json()
    returned_item = next(i for i in inv_after_return if i["id"] == item_id)
    assert returned_item["quantity"] == original_qty

    movement_resp = client.get("/inventory/movements", headers=auth_headers)
    assert movement_resp.status_code == 200
    movements = movement_resp.json()
    sale_movements = [m for m in movements if m["reference_type"] == "sale" and m["reference_id"] == sale_id and m["item_id"] == item_id]
    assert any(m["movement_type"] in {"SALE", "SALE_OUT"} and m["quantity"] == -2 for m in sale_movements)

    return_sale_id = return_resp.json()["return_sale_id"]
    return_movements = [m for m in movements if m["reference_type"] == "sale_return" and m["reference_id"] == return_sale_id and m["item_id"] == item_id]
    assert any(m["movement_type"] in {"RETURN", "RETURN_RESTOCK"} and m["quantity"] == 2 for m in return_movements)


def test_serial_tracked_checkout_requires_available_serial(client, auth_headers):
    sku = "SERIAL-LOCK-001"
    create_resp = client.post(
        "/inventory",
        json={
            "name": "Serial Locked Phone",
            "category": "Phones",
            "brand": "I Store",
            "model": "S1",
            "storage": "128GB",
            "color": "Black",
            "condition": "New",
            "product_type": "Retail",
            "location": "Test shelf",
            "warranty_days": 365,
            "sku": sku,
            "barcode": sku,
            "quantity": 1,
            "cost_price": 100,
            "sale_price": 150,
            "has_serials": True,
        },
        headers=auth_headers,
    )
    assert create_resp.status_code == 200, create_resp.text
    item_id = int(create_resp.json()["id"])

    payload = {
        "customer_id": None,
        "payment_method": "Cash",
        "paid": True,
        "discount_amount": 0,
        "tax_amount": 0,
        "lines": [{"item_id": item_id, "quantity": 1, "price": 150, "warranty_days": 365}],
    }
    missing_serial = client.post("/pos/checkout", json=payload, headers=auth_headers)
    assert missing_serial.status_code == 400
    assert "Serial/IMEI is required" in missing_serial.text

    bad_serial_payload = {
        **payload,
        "lines": [{**payload["lines"][0], "serial_number": "NOT-IN-STOCK"}],
    }
    unavailable_serial = client.post("/pos/checkout", json=bad_serial_payload, headers=auth_headers)
    assert unavailable_serial.status_code == 400
    assert "is not available" in unavailable_serial.text

    item_after_fail = next(row for row in client.get("/inventory", headers=auth_headers).json() if int(row["id"]) == item_id)
    assert int(item_after_fail["quantity"]) == 1

    add_serial = client.post(f"/inventory/{item_id}/serials?serial_number=IMEI-LOCK-001", headers=auth_headers)
    assert add_serial.status_code == 200, add_serial.text

    good_payload = {
        **payload,
        "lines": [{**payload["lines"][0], "serial_number": "IMEI-LOCK-001"}],
    }
    checkout_resp = client.post("/pos/checkout", json=good_payload, headers=auth_headers)
    assert checkout_resp.status_code == 200, checkout_resp.text
    assert checkout_resp.json()["lines"][0]["serial_number"] == "IMEI-LOCK-001"

    reused_serial = client.post("/pos/checkout", json=good_payload, headers=auth_headers)
    assert reused_serial.status_code == 400
