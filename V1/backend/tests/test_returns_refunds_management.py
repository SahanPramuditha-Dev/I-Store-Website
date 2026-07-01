def _pick_stock_item(rows, *, min_qty=2, exclude_ids=None):
    exclude = set(exclude_ids or [])
    for row in rows:
        if int(row.get("id") or 0) in exclude:
            continue
        if int(row.get("quantity") or 0) >= min_qty:
            return row
    return None


def test_returns_refund_and_store_credit_flow(client, auth_headers):
    # Create a customer for store-credit and refund linkage.
    customer_resp = client.post(
        "/customers",
        json={
            "name": "Returns Flow Customer",
            "phone": "0777777777",
            "email": "returns@example.com",
            "address": "Colombo",
            "notes": "test",
        },
        headers=auth_headers,
    )
    assert customer_resp.status_code == 200, customer_resp.text
    customer_id = int(customer_resp.json()["id"])

    inventory_rows = client.get("/inventory", headers=auth_headers).json()
    old_item = _pick_stock_item(inventory_rows, min_qty=3)
    alt_item = _pick_stock_item(inventory_rows, min_qty=3, exclude_ids={old_item["id"]})
    assert old_item, "No inventory item with enough stock for return flow test"
    assert alt_item, "No secondary inventory item with enough stock for credit usage test"

    old_item_id = int(old_item["id"])
    old_item_qty_before = int(old_item["quantity"])
    old_item_price = float(old_item["sale_price"])

    sale_resp = client.post(
        "/pos/checkout",
        json={
            "customer_id": customer_id,
            "payment_method": "Cash",
            "paid": True,
            "discount_amount": 0,
            "tax_amount": 0,
            "lines": [
                {"item_id": old_item_id, "quantity": 2, "price": old_item_price, "warranty_days": 0},
            ],
        },
        headers=auth_headers,
    )
    assert sale_resp.status_code == 200, sale_resp.text
    sale_payload = sale_resp.json()
    sale_id = int(sale_payload["sale_id"])

    lookup_resp = client.get(f"/returns/lookup-invoice/{sale_id}", headers=auth_headers)
    assert lookup_resp.status_code == 200, lookup_resp.text
    invoice_payload = lookup_resp.json()["selected_invoice"]
    line = next((row for row in invoice_payload["items"] if int(row["product_id"] or 0) == old_item_id), None)
    assert line, "Eligible sale line not found for return test"
    unit_price = float(line["unit_price"])

    create_return_resp = client.post(
        "/returns",
        json={
            "original_invoice_id": sale_id,
            "customer_id": customer_id,
            "return_type": "return",
            "reason": "Defective item",
            "notes": "Testing refund flow",
            "requested_resolution": "refund",
            "items": [
                {
                    "original_invoice_item_id": line["sale_item_id"],
                    "product_id": old_item_id,
                    "quantity": 1,
                    "unit_price": unit_price,
                    "item_condition": "sellable",
                    "restock_action": "restock",
                }
            ],
        },
        headers=auth_headers,
    )
    assert create_return_resp.status_code == 200, create_return_resp.text
    return_case = create_return_resp.json()
    return_id = int(return_case["id"])

    inspect_resp = client.patch(
        f"/returns/{return_id}/inspect",
        json={"inspection_status": "inspected", "inspection_notes": "Looks valid"},
        headers=auth_headers,
    )
    assert inspect_resp.status_code == 200, inspect_resp.text

    approve_resp = client.patch(f"/returns/{return_id}/approve", json={"notes": "Approved"}, headers=auth_headers)
    assert approve_resp.status_code == 200, approve_resp.text

    refund_create_resp = client.post(
        f"/returns/{return_id}/refund",
        json={
            "refund_amount": unit_price,
            "refund_method": "cash",
            "reason": "Approved customer refund",
            "notes": "Refund test",
        },
        headers=auth_headers,
    )
    assert refund_create_resp.status_code == 200, refund_create_resp.text
    refund_row = refund_create_resp.json()
    refund_id = int(refund_row["id"])

    refund_approve_resp = client.patch(f"/refunds/{refund_id}/approve", json={"notes": "ok"}, headers=auth_headers)
    assert refund_approve_resp.status_code == 200, refund_approve_resp.text

    refund_paid_resp = client.patch(f"/refunds/{refund_id}/mark-paid", json={"notes": "paid"}, headers=auth_headers)
    assert refund_paid_resp.status_code == 200, refund_paid_resp.text
    assert refund_paid_resp.json()["refund_status"] == "paid"

    # Create another return (remaining qty) and issue store credit.
    second_return_resp = client.post(
        "/returns",
        json={
            "original_invoice_id": sale_id,
            "customer_id": customer_id,
            "return_type": "store_credit",
            "reason": "Customer changed mind",
            "notes": "Store credit flow",
            "requested_resolution": "store_credit",
            "items": [
                {
                    "original_invoice_item_id": line["sale_item_id"],
                    "product_id": old_item_id,
                    "quantity": 1,
                    "unit_price": unit_price,
                    "item_condition": "sellable",
                    "restock_action": "restock",
                }
            ],
        },
        headers=auth_headers,
    )
    assert second_return_resp.status_code == 200, second_return_resp.text
    second_return = second_return_resp.json()
    second_return_id = int(second_return["id"])
    assert client.patch(f"/returns/{second_return_id}/inspect", json={"inspection_status": "inspected"}, headers=auth_headers).status_code == 200
    assert client.patch(f"/returns/{second_return_id}/approve", json={"notes": "approve"}, headers=auth_headers).status_code == 200

    credit_issue_resp = client.post(
        f"/returns/{second_return_id}/store-credit",
        json={"amount": unit_price, "notes": "credit issue"},
        headers=auth_headers,
    )
    assert credit_issue_resp.status_code == 200, credit_issue_resp.text
    credit_row = credit_issue_resp.json()
    credit_id = int(credit_row["id"])

    # Create a new sale and apply store credit on invoice.
    sale2_resp = client.post(
        "/pos/checkout",
        json={
            "customer_id": customer_id,
            "payment_method": "Cash",
            "paid": False,
            "discount_amount": 0,
            "tax_amount": 0,
            "lines": [
                {"item_id": int(alt_item["id"]), "quantity": 1, "price": float(alt_item["sale_price"]), "warranty_days": 0},
            ],
        },
        headers=auth_headers,
    )
    assert sale2_resp.status_code == 200, sale2_resp.text
    sale2_id = int(sale2_resp.json()["sale_id"])

    use_credit_resp = client.patch(
        f"/store-credits/{credit_id}/use",
        json={"amount": min(unit_price, float(alt_item["sale_price"])), "invoice_id": sale2_id, "notes": "apply credit"},
        headers=auth_headers,
    )
    assert use_credit_resp.status_code == 200, use_credit_resp.text
    assert float(use_credit_resp.json()["remaining_amount"]) >= 0

    # Ensure returned stock was restored after refund and credit flows.
    inventory_after = client.get("/inventory", headers=auth_headers).json()
    old_item_after = next(row for row in inventory_after if int(row["id"]) == old_item_id)
    assert int(old_item_after["quantity"]) == old_item_qty_before


def test_returns_exchange_flow_updates_inventory(client, auth_headers):
    inventory_rows = client.get("/inventory", headers=auth_headers).json()
    sold_item = _pick_stock_item(inventory_rows, min_qty=2)
    replacement_item = _pick_stock_item(inventory_rows, min_qty=2, exclude_ids={sold_item["id"]})
    assert sold_item, "No stock item for exchange sold side"
    assert replacement_item, "No stock item for exchange replacement side"

    sold_id = int(sold_item["id"])
    replacement_id = int(replacement_item["id"])
    sold_qty_before = int(sold_item["quantity"])
    replacement_qty_before = int(replacement_item["quantity"])

    sale_resp = client.post(
        "/pos/checkout",
        json={
            "customer_id": None,
            "payment_method": "Cash",
            "paid": True,
            "discount_amount": 0,
            "tax_amount": 0,
            "lines": [
                {"item_id": sold_id, "quantity": 1, "price": float(sold_item["sale_price"]), "warranty_days": 0},
            ],
        },
        headers=auth_headers,
    )
    assert sale_resp.status_code == 200, sale_resp.text
    sale_id = int(sale_resp.json()["sale_id"])

    lookup_resp = client.get(f"/returns/lookup-invoice/{sale_id}", headers=auth_headers)
    assert lookup_resp.status_code == 200, lookup_resp.text
    invoice_payload = lookup_resp.json()["selected_invoice"]
    line = next((row for row in invoice_payload["items"] if int(row["product_id"] or 0) == sold_id), None)
    assert line, "Exchange test line not found"

    create_return_resp = client.post(
        "/returns",
        json={
            "original_invoice_id": sale_id,
            "return_type": "exchange",
            "reason": "Wrong item sold",
            "notes": "Exchange test",
            "requested_resolution": "exchange",
            "items": [
                {
                    "original_invoice_item_id": line["sale_item_id"],
                    "product_id": sold_id,
                    "quantity": 1,
                    "unit_price": float(line["unit_price"]),
                    "item_condition": "sellable",
                    "restock_action": "restock",
                }
            ],
        },
        headers=auth_headers,
    )
    assert create_return_resp.status_code == 200, create_return_resp.text
    return_id = int(create_return_resp.json()["id"])

    assert client.patch(f"/returns/{return_id}/inspect", json={"inspection_status": "inspected"}, headers=auth_headers).status_code == 200
    assert client.patch(f"/returns/{return_id}/approve", json={"notes": "approve"}, headers=auth_headers).status_code == 200

    exchange_resp = client.post(
        f"/returns/{return_id}/exchange",
        json={"new_product_id": replacement_id, "new_quantity": 1, "notes": "exchange done"},
        headers=auth_headers,
    )
    assert exchange_resp.status_code == 200, exchange_resp.text
    exchange_payload = exchange_resp.json()
    assert exchange_payload["new_product_id"] == replacement_id

    create_invoice_resp = client.post(
        f"/returns/{return_id}/exchange/create-invoice",
        json={"exchange_id": exchange_payload["id"], "payment_method": "Cash", "paid": True},
        headers=auth_headers,
    )
    assert create_invoice_resp.status_code == 200, create_invoice_resp.text
    exchange_invoice = create_invoice_resp.json()
    assert exchange_invoice["sale_id"] > 0
    assert str(exchange_invoice["invoice_no"]).startswith("EXC-")

    inventory_after = client.get("/inventory", headers=auth_headers).json()
    sold_after = next(row for row in inventory_after if int(row["id"]) == sold_id)
    replacement_after = next(row for row in inventory_after if int(row["id"]) == replacement_id)
    # Sold item: sale -1, return restock +1 => back to baseline
    assert int(sold_after["quantity"]) == sold_qty_before
    # Replacement item: exchange reduces by one
    assert int(replacement_after["quantity"]) == replacement_qty_before - 1

    movement_resp = client.get("/inventory/movements", headers=auth_headers)
    assert movement_resp.status_code == 200, movement_resp.text
    movements = movement_resp.json()
    assert any(
        int(row.get("item_id") or 0) == replacement_id
        and int(row.get("reference_id") or 0) == return_id
        and str(row.get("reference_type") or "") == "return_exchange"
        and str(row.get("movement_type") or "") == "EXCHANGE_OUT"
        and int(row.get("quantity") or 0) == -1
        for row in movements
    )
