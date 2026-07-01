from datetime import UTC, datetime, timedelta


def _seed_customer_id(client, auth_headers) -> int:
    rows = client.get("/customers", headers=auth_headers).json()
    return int(rows[0]["id"])


def _seed_inventory_item(client, auth_headers):
    rows = client.get("/inventory", headers=auth_headers).json()
    for row in rows:
        if int(row.get("quantity") or 0) > 0:
            return row
    raise AssertionError("Expected inventory item with positive stock")


def test_pos_contract_endpoints_and_invoice_payments(client, auth_headers):
    customer_id = _seed_customer_id(client, auth_headers)
    item = _seed_inventory_item(client, auth_headers)

    checkout_resp = client.post(
        "/pos/checkout",
        json={
            "customer_id": customer_id,
            "payment_method": "Cash",
            "paid": False,
            "discount_amount": 0,
            "tax_amount": 0,
            "lines": [
                {
                    "item_id": item["id"],
                    "line_type": "product",
                    "quantity": 1,
                    "price": float(item.get("sale_price") or 1000),
                }
            ],
        },
        headers=auth_headers,
    )
    assert checkout_resp.status_code == 200, checkout_resp.text
    checkout = checkout_resp.json()
    invoice_id = int(checkout["sale_id"])
    invoice_no = checkout["invoice_no"]

    recent_resp = client.get("/pos/recent-transactions?limit=10", headers=auth_headers)
    assert recent_resp.status_code == 200, recent_resp.text
    assert any(int(row["id"]) == invoice_id for row in recent_resp.json())

    product_search_resp = client.get(f"/pos/product-search?q={item['sku']}", headers=auth_headers)
    assert product_search_resp.status_code == 200, product_search_resp.text
    search_rows = product_search_resp.json()
    assert any(int(row["id"]) == int(item["id"]) for row in search_rows)
    assert "stock" in search_rows[0]

    code = item.get("barcode") or item.get("sku")
    barcode_resp = client.get(f"/pos/barcode/{code}", headers=auth_headers)
    assert barcode_resp.status_code == 200, barcode_resp.text
    assert int(barcode_resp.json()["id"]) == int(item["id"])

    advances_resp = client.get(f"/pos/customer/{customer_id}/available-advances", headers=auth_headers)
    assert advances_resp.status_code == 200, advances_resp.text

    credits_resp = client.get(f"/pos/customer/{customer_id}/available-credits", headers=auth_headers)
    assert credits_resp.status_code == 200, credits_resp.text
    assert "total_available" in credits_resp.json()

    split_resp = client.post(
        "/payments/split",
        json={
            "invoice_id": invoice_id,
            "payments": [
                {"payment_method": "cash", "amount": max(0.0, float(checkout.get("balance_due") or 0) / 2)},
                {"payment_method": "card", "amount": max(0.0, float(checkout.get("balance_due") or 0) / 2)},
            ],
        },
        headers=auth_headers,
    )
    assert split_resp.status_code == 200, split_resp.text

    payments_resp = client.get(f"/payments/invoice/{invoice_id}", headers=auth_headers)
    assert payments_resp.status_code == 200, payments_resp.text
    payments = payments_resp.json()
    assert len(payments) >= 1
    assert any(str(row.get("payment_number", "")).startswith("PAY-") for row in payments)

    invoice_get_resp = client.get(f"/invoices/{invoice_id}", headers=auth_headers)
    assert invoice_get_resp.status_code == 200, invoice_get_resp.text
    invoice_get = invoice_get_resp.json()
    assert invoice_get["invoice_number"] == invoice_no

    invoice_no_resp = client.get(f"/invoices/number/{invoice_no}", headers=auth_headers)
    assert invoice_no_resp.status_code == 200, invoice_no_resp.text
    assert int(invoice_no_resp.json()["id"]) == invoice_id

    reprint_resp = client.post(f"/invoices/{invoice_id}/reprint", headers=auth_headers)
    assert reprint_resp.status_code == 200, reprint_resp.text

    a4_resp = client.get(f"/invoices/{invoice_id}/print/a4", headers=auth_headers)
    assert a4_resp.status_code == 200, a4_resp.text
    assert "<html" in a4_resp.text.lower()

    thermal_resp = client.get(f"/invoices/{invoice_id}/print/thermal", headers=auth_headers)
    assert thermal_resp.status_code == 200, thermal_resp.text
    assert "<html" in thermal_resp.text.lower()

    # Bank transfer checkout captures reference number in payment ledger.
    bank_checkout_resp = client.post(
        "/pos/checkout",
        json={
            "customer_id": customer_id,
            "payment_method": "Bank Transfer",
            "payment_reference": "BT-REF-1001",
            "paid": True,
            "discount_amount": 0,
            "tax_amount": 0,
            "lines": [
                {
                    "item_id": None,
                    "line_type": "service",
                    "description": "Service line test",
                    "quantity": 1,
                    "price": 500.0,
                }
            ],
        },
        headers=auth_headers,
    )
    assert bank_checkout_resp.status_code == 200, bank_checkout_resp.text
    bank_invoice_id = int(bank_checkout_resp.json()["sale_id"])
    bank_payments_resp = client.get(f"/payments/invoice/{bank_invoice_id}", headers=auth_headers)
    assert bank_payments_resp.status_code == 200, bank_payments_resp.text
    assert any(str(row.get("reference_number") or "") == "BT-REF-1001" for row in bank_payments_resp.json())


def test_repair_billing_contract_endpoints(client, auth_headers):
    customer_id = _seed_customer_id(client, auth_headers)
    spare_item = _seed_inventory_item(client, auth_headers)
    spare_item_id = int(spare_item["id"])
    spare_price = float(spare_item.get("sale_price") or 1000)
    repair_resp = client.post(
        "/repairs",
        json={
            "customer_id": customer_id,
            "device_model": "Samsung A55",
            "imei": f"357999{datetime.now(UTC).strftime('%H%M%S%f')[:9]}",
            "issue": "Charging issue",
            "status": "pending",
            "priority": "Normal",
            "estimated_cost": 4500,
            "advance_payment": 0,
            "estimated_completion": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        },
        headers=auth_headers,
    )
    assert repair_resp.status_code == 200, repair_resp.text
    repair_id = int(repair_resp.json()["id"])

    summary_resp = client.get(f"/repairs/{repair_id}/billing-summary", headers=auth_headers)
    assert summary_resp.status_code == 200, summary_resp.text
    summary = summary_resp.json()
    assert int(summary["repair_id"]) == repair_id

    create_invoice_resp = client.post(
        f"/repairs/{repair_id}/create-invoice",
        json={
            "payment_method": "Cash",
            "paid": True,
            "discount_amount": 0,
            "tax_amount": 0,
            "lines": [
                {
                    "item_id": spare_item_id,
                    "line_type": "spare_part",
                    "description": "Spare part used",
                    "quantity": 1,
                    "price": spare_price,
                },
                {
                    "item_id": None,
                    "line_type": "labor",
                    "description": "Labor charge",
                    "quantity": 1,
                    "price": 4500,
                }
            ],
        },
        headers=auth_headers,
    )
    assert create_invoice_resp.status_code == 200, create_invoice_resp.text
    created = create_invoice_resp.json()
    assert created["repair_ticket_id"] == repair_id
    assert str(created["invoice_no"]).startswith("RINV-")
    created_sale_id = int(created["sale_id"])

    repair_invoices_resp = client.get(f"/repairs/{repair_id}/invoices", headers=auth_headers)
    assert repair_invoices_resp.status_code == 200, repair_invoices_resp.text
    assert len(repair_invoices_resp.json()) >= 1

    movements_resp = client.get("/inventory/movements", headers=auth_headers)
    assert movements_resp.status_code == 200, movements_resp.text
    movements = movements_resp.json()
    assert any(
        int(row.get("item_id") or 0) == spare_item_id
        and int(row.get("reference_id") or 0) == created_sale_id
        and str(row.get("reference_type") or "") == "sale"
        and str(row.get("movement_type") or "") == "REPAIR_PART_USED"
        and int(row.get("quantity") or 0) == -1
        for row in movements
    )


def test_reservation_settlement_contract_endpoints(client, auth_headers):
    customer_id = _seed_customer_id(client, auth_headers)
    inventory_rows = client.get("/inventory", headers=auth_headers).json()
    item = next((row for row in inventory_rows if int(row.get("quantity") or 0) >= 1), None)
    assert item, "Expected inventory item with available stock for reservation settlement"
    item_id = int(item["id"])
    unit_price = float(item.get("sale_price") or 1000)

    create_reservation_resp = client.post(
        "/product-reservations",
        json={
            "customer_id": customer_id,
            "product_id": item_id,
            "reservation_type": "in_stock_reservation",
            "quantity": 1,
            "estimated_total": unit_price,
            "advance_required": True,
            "advance_required_amount": round(unit_price * 0.4, 2),
            "notes": "POS reservation settlement contract test",
        },
        headers=auth_headers,
    )
    assert create_reservation_resp.status_code == 200, create_reservation_resp.text
    reservation_row = create_reservation_resp.json()
    reservation_id = int(reservation_row["id"])

    reserve_mark_resp = client.patch(
        f"/product-reservations/{reservation_id}/reserve",
        json={"notes": "Marked reserved for POS settlement test"},
        headers=auth_headers,
    )
    assert reserve_mark_resp.status_code == 200, reserve_mark_resp.text

    advance_amount = round(max(1.0, unit_price * 0.3), 2)
    create_advance_resp = client.post(
        "/advance-payments",
        json={
            "advance_type": "product_reservation",
            "customer_id": customer_id,
            "reservation_id": reservation_id,
            "amount": advance_amount,
            "payment_method": "cash",
            "notes": "Reservation advance for POS checkout/reservation test",
        },
        headers=auth_headers,
    )
    assert create_advance_resp.status_code == 200, create_advance_resp.text
    advance_row = create_advance_resp.json()

    avail_adv_resp = client.get(
        f"/pos/customer/{customer_id}/available-advances?reservation_id={reservation_id}",
        headers=auth_headers,
    )
    assert avail_adv_resp.status_code == 200, avail_adv_resp.text
    available_advances = avail_adv_resp.json()
    assert any(int(row["id"]) == int(advance_row["id"]) for row in available_advances)

    settlement_resp = client.post(
        "/pos/checkout/reservation",
        json={
            "customer_id": customer_id,
            "reservation_id": reservation_id,
            "payment_method": "Cash",
            "paid": True,
            "discount_amount": 0,
            "tax_amount": 0,
            "applied_advances": [
                {
                    "advance_payment_id": int(advance_row["id"]),
                    "amount": float(advance_amount),
                }
            ],
            "lines": [
                {
                    "item_id": item_id,
                    "line_type": "product",
                    "quantity": 1,
                    "price": unit_price,
                }
            ],
        },
        headers=auth_headers,
    )
    assert settlement_resp.status_code == 200, settlement_resp.text
    settlement = settlement_resp.json()
    invoice_id = int(settlement["sale_id"])
    assert int(settlement.get("reservation_id") or 0) == reservation_id
    assert float(settlement.get("applied_advance_total") or 0) >= 0

    reservation_after_resp = client.get(f"/product-reservations/{reservation_id}", headers=auth_headers)
    assert reservation_after_resp.status_code == 200, reservation_after_resp.text
    reservation_after = reservation_after_resp.json()
    assert int(reservation_after.get("linked_invoice_id") or 0) == invoice_id
    assert str(reservation_after.get("status") or "").lower() in {"invoiced", "completed"}

    invoice_resp = client.get(f"/invoices/{invoice_id}", headers=auth_headers)
    assert invoice_resp.status_code == 200, invoice_resp.text
    invoice_payload = invoice_resp.json()
    assert invoice_payload["invoice_type"] == "reservation_invoice"

    payments_resp = client.get(f"/payments/invoice/{invoice_id}", headers=auth_headers)
    assert payments_resp.status_code == 200, payments_resp.text
    payment_types = {str(row.get("payment_type") or "") for row in payments_resp.json()}
    assert "advance_applied" in payment_types or "balance_payment" in payment_types
