from datetime import UTC, datetime, timedelta


def test_product_reservation_advance_and_invoice_flow(client, auth_headers):
    customers_resp = client.get("/customers", headers=auth_headers)
    assert customers_resp.status_code == 200, customers_resp.text
    customer_id = customers_resp.json()[0]["id"]

    inventory_resp = client.get("/inventory", headers=auth_headers)
    assert inventory_resp.status_code == 200, inventory_resp.text
    product = next((row for row in inventory_resp.json() if int(row.get("quantity") or 0) > 0), None)
    assert product is not None, "Expected seeded inventory with available stock"

    estimated_total = float(product["sale_price"] or 0) * 1
    reservation_resp = client.post(
        "/product-reservations",
        json={
            "customer_id": customer_id,
            "product_id": product["id"],
            "reservation_type": "in_stock_reservation",
            "quantity": 1,
            "estimated_total": estimated_total,
            "advance_required": True,
            "advance_required_amount": 0,
            "expected_arrival_date": (datetime.now(UTC) + timedelta(days=3)).isoformat(),
            "expiry_date": (datetime.now(UTC) + timedelta(days=14)).isoformat(),
            "notes": "Automated reservation flow test",
        },
        headers=auth_headers,
    )
    assert reservation_resp.status_code == 200, reservation_resp.text
    reservation = reservation_resp.json()
    reservation_id = int(reservation["id"])

    advance_amount = round(max(1.0, estimated_total * 0.4), 2)
    advance_resp = client.post(
        "/advance-payments",
        json={
            "advance_type": "product_reservation",
            "customer_id": customer_id,
            "reservation_id": reservation_id,
            "amount": advance_amount,
            "payment_method": "cash",
            "notes": "Reservation advance test",
        },
        headers=auth_headers,
    )
    assert advance_resp.status_code == 200, advance_resp.text
    advance = advance_resp.json()

    invoice_resp = client.post(
        f"/product-reservations/{reservation_id}/create-invoice",
        json={
            "payment_method": "Cash",
            "paid": True,
            "auto_apply_advances": True,
        },
        headers=auth_headers,
    )
    assert invoice_resp.status_code == 200, invoice_resp.text
    invoice_payload = invoice_resp.json()
    assert invoice_payload["invoice_id"] is not None
    assert float(invoice_payload["applied_advance_total"]) >= 0

    reservation_after = client.get(f"/product-reservations/{reservation_id}", headers=auth_headers)
    assert reservation_after.status_code == 200, reservation_after.text
    reservation_row = reservation_after.json()
    assert reservation_row["linked_invoice_id"] is not None
    assert reservation_row["status"] in {"invoiced", "completed"}

    advances_after_resp = client.get(f"/advance-payments/product-reservation/{reservation_id}", headers=auth_headers)
    assert advances_after_resp.status_code == 200, advances_after_resp.text
    advances_after = advances_after_resp.json()
    assert any(int(row["id"]) == int(advance["id"]) for row in advances_after)
    assert any(float(row["applied_amount"] or 0) >= 0 for row in advances_after)


def test_repair_estimate_advance_and_pos_apply_flow(client, auth_headers):
    customers_resp = client.get("/customers", headers=auth_headers)
    assert customers_resp.status_code == 200, customers_resp.text
    customer_id = customers_resp.json()[0]["id"]

    create_repair_resp = client.post(
        "/repairs",
        json={
            "customer_id": customer_id,
            "device_model": "Pixel 8 Pro",
            "imei": f"357999{datetime.now(UTC).strftime('%H%M%S%f')[:9]}",
            "issue": "Display flickering",
            "status": "pending",
            "priority": "Normal",
            "estimated_cost": 25000,
            "advance_payment": 0,
            "notes": "Advance workflow test",
            "estimated_completion": (datetime.now(UTC) + timedelta(days=2)).isoformat(),
        },
        headers=auth_headers,
    )
    assert create_repair_resp.status_code == 200, create_repair_resp.text
    repair = create_repair_resp.json()
    repair_id = int(repair["id"])

    estimate_resp = client.post(
        f"/repairs/{repair_id}/estimate",
        json={
            "estimated_parts_cost": 16000,
            "estimated_labor_cost": 4000,
            "estimated_total": 20000,
            "advance_required": True,
            "advance_required_amount": 8000,
            "notes": "Estimate for testing",
        },
        headers=auth_headers,
    )
    assert estimate_resp.status_code == 200, estimate_resp.text

    approve_resp = client.patch(
        f"/repairs/{repair_id}/estimate/approve",
        json={"notes": "Approved in test"},
        headers=auth_headers,
    )
    assert approve_resp.status_code == 200, approve_resp.text
    assert approve_resp.json()["approval_status"] == "approved"

    advance_resp = client.post(
        "/advance-payments",
        json={
            "advance_type": "repair",
            "customer_id": customer_id,
            "repair_ticket_id": repair_id,
            "amount": 8000,
            "payment_method": "cash",
            "notes": "Repair advance test",
        },
        headers=auth_headers,
    )
    assert advance_resp.status_code == 200, advance_resp.text
    advance = advance_resp.json()

    checkout_resp = client.post(
        "/pos/checkout",
        json={
            "customer_id": customer_id,
            "repair_ticket_id": repair_id,
            "payment_method": "Cash",
            "paid": True,
            "discount_amount": 0,
            "tax_amount": 0,
            "applied_advances": [
                {
                    "advance_payment_id": advance["id"],
                    "amount": 8000,
                }
            ],
            "lines": [
                {
                    "item_id": None,
                    "line_type": "service",
                    "description": "Repair service charge",
                    "quantity": 1,
                    "price": 20000,
                }
            ],
        },
        headers=auth_headers,
    )
    assert checkout_resp.status_code == 200, checkout_resp.text
    sale_payload = checkout_resp.json()
    assert float(sale_payload.get("applied_advance_total") or 0) >= 8000
    assert float(sale_payload.get("balance_due") or 0) == 0

    repair_advances_resp = client.get(f"/advance-payments/repair/{repair_id}", headers=auth_headers)
    assert repair_advances_resp.status_code == 200, repair_advances_resp.text
    rows = repair_advances_resp.json()
    assert any(str(row.get("status")) in {"applied", "received"} for row in rows)


def test_special_order_advance_receipt_and_ord_numbering(client, auth_headers):
    customers_resp = client.get("/customers", headers=auth_headers)
    assert customers_resp.status_code == 200, customers_resp.text
    customer_id = customers_resp.json()[0]["id"]

    reservation_resp = client.post(
        "/product-reservations",
        json={
            "customer_id": customer_id,
            "requested_product_name": "Samsung Galaxy S24 Ultra 512GB",
            "reservation_type": "special_order",
            "quantity": 1,
            "estimated_total": 225000,
            "advance_required": True,
            "advance_required_amount": 75000,
            "notes": "Special order with ORD numbering",
        },
        headers=auth_headers,
    )
    assert reservation_resp.status_code == 200, reservation_resp.text
    reservation = reservation_resp.json()
    assert str(reservation["reservation_number"]).startswith("ORD-")

    advance_resp = client.post(
        "/advance-payments",
        json={
            "advance_type": "product_order",
            "customer_id": customer_id,
            "reservation_id": reservation["id"],
            "amount": 50000,
            "payment_method": "cash",
            "notes": "Special-order advance",
        },
        headers=auth_headers,
    )
    assert advance_resp.status_code == 200, advance_resp.text
    advance = advance_resp.json()

    receipt_resp = client.get(f"/advance-payments/{advance['id']}/receipt", headers=auth_headers)
    assert receipt_resp.status_code == 200, receipt_resp.text
    receipt = receipt_resp.json()

    assert receipt["software_name"] == "I Store"
    assert receipt["shop_name"]
    assert receipt["reservation_number"] == reservation["reservation_number"]
    assert float(receipt["amount_paid"] or 0) == 50000
