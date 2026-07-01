from datetime import UTC, datetime


def _ensure_supplier(client, auth_headers, marker: str) -> dict:
    suppliers_resp = client.get("/inventory/suppliers", headers=auth_headers)
    assert suppliers_resp.status_code == 200, suppliers_resp.text
    suppliers = suppliers_resp.json() or []
    if suppliers:
        return suppliers[0]

    create_resp = client.post(
        "/inventory/suppliers",
        json={
            "name": f"{marker} Supplier",
            "contact": "0771234567",
            "email": f"{marker.lower()}@example.com",
            "address": "Colombo",
            "notes": "GRN test supplier",
            "payment_terms_days": 14,
            "opening_balance": 0,
        },
        headers=auth_headers,
    )
    assert create_resp.status_code == 200, create_resp.text
    return create_resp.json()


def _ensure_inventory_item(client, auth_headers, marker: str) -> dict:
    inventory_resp = client.get("/inventory", headers=auth_headers)
    assert inventory_resp.status_code == 200, inventory_resp.text
    rows = inventory_resp.json() or []
    if rows:
        return rows[0]

    create_resp = client.post(
        "/inventory",
        json={
            "name": f"{marker} Battery",
            "category": "Spare Parts",
            "brand": "Generic",
            "model": "",
            "storage": "",
            "color": "",
            "condition": "New",
            "product_type": "Spare Parts",
            "location": "Shelf A1",
            "image_url": "",
            "warranty_days": 0,
            "sku": f"{marker}-SKU",
            "barcode": f"{marker}-BARCODE",
            "quantity": 0,
            "cost_price": 50,
            "sale_price": 80,
            "has_serials": False,
            "supplier_id": None,
        },
        headers=auth_headers,
    )
    assert create_resp.status_code == 200, create_resp.text
    return create_resp.json()


def test_grn_detail_and_print_payload_flow(client, auth_headers):
    marker = f"GRN{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}"
    supplier = _ensure_supplier(client, auth_headers, marker)
    item = _ensure_inventory_item(client, auth_headers, marker)
    item_id = item["id"]

    before_rows = client.get("/inventory", headers=auth_headers).json()
    before_item = next(row for row in before_rows if row["id"] == item_id)
    before_qty = int(before_item.get("quantity") or 0)

    quantity = 5
    damaged_qty = 1
    received_qty = quantity - damaged_qty
    unit_cost = 123.5
    expected_total = round(received_qty * unit_cost, 2)

    create_grn_resp = client.post(
        "/inventory/grn",
        json={
            "supplier_id": int(supplier["id"]),
            "po_id": None,
            "invoice_no": f"INV-{marker}",
            "note": "GRN workflow test",
            "lines": [
                {
                    "item_id": int(item_id),
                    "quantity": quantity,
                    "damaged_qty": damaged_qty,
                    "unit_cost": unit_cost,
                }
            ],
        },
        headers=auth_headers,
    )
    assert create_grn_resp.status_code == 200, create_grn_resp.text
    created = create_grn_resp.json()
    grn_id = created["grn_id"]

    assert round(float(created["grn_total"] or 0), 2) == expected_total

    list_resp = client.get("/inventory/grn", headers=auth_headers)
    assert list_resp.status_code == 200, list_resp.text
    list_rows = list_resp.json()
    listed = next(row for row in list_rows if row["id"] == grn_id)
    assert int(listed["line_count"]) == 1
    assert round(float(listed["grn_total"] or 0), 2) == expected_total

    detail_resp = client.get(f"/inventory/grn/{grn_id}", headers=auth_headers)
    assert detail_resp.status_code == 200, detail_resp.text
    detail = detail_resp.json()
    assert detail["grn_no"] == created["grn_no"]
    assert int(detail["line_count"]) == 1
    assert int(detail["total_received_qty"]) == received_qty
    assert int(detail["total_damaged_qty"]) == damaged_qty
    assert round(float(detail["grn_total"] or 0), 2) == expected_total
    assert len(detail["lines"]) == 1
    assert int(detail["lines"][0]["item_id"]) == int(item_id)
    assert int(detail["lines"][0]["received_qty"]) == received_qty
    assert round(float(detail["lines"][0]["line_total"] or 0), 2) == expected_total

    after_rows = client.get("/inventory", headers=auth_headers).json()
    after_item = next(row for row in after_rows if row["id"] == item_id)
    after_qty = int(after_item.get("quantity") or 0)
    assert after_qty == before_qty + received_qty


def test_grn_cancel_reverses_stock_and_marks_cancelled(client, auth_headers):
    marker = f"GRNCANCEL{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}"
    supplier = _ensure_supplier(client, auth_headers, marker)
    item = _ensure_inventory_item(client, auth_headers, marker)
    item_id = int(item["id"])

    before_rows = client.get("/inventory", headers=auth_headers).json()
    before_item = next(row for row in before_rows if int(row["id"]) == item_id)
    before_qty = int(before_item.get("quantity") or 0)

    qty = 4
    damaged = 1
    received = qty - damaged
    unit_cost = 200.0

    create_resp = client.post(
        "/inventory/grn",
        json={
            "supplier_id": int(supplier["id"]),
            "invoice_no": f"INV-{marker}",
            "note": "Cancellation safety test",
            "lines": [
                {
                    "item_id": item_id,
                    "quantity": qty,
                    "damaged_qty": damaged,
                    "unit_cost": unit_cost,
                }
            ],
        },
        headers=auth_headers,
    )
    assert create_resp.status_code == 200, create_resp.text
    grn_id = int(create_resp.json()["grn_id"])
    grn_no = str(create_resp.json()["grn_no"])

    cancel_resp = client.post(
        f"/inventory/grn/{grn_id}/cancel",
        json={"reason": "Entered in error"},
        headers=auth_headers,
    )
    assert cancel_resp.status_code == 200, cancel_resp.text
    cancel_payload = cancel_resp.json()
    assert cancel_payload.get("ok") is True
    assert round(float(cancel_payload.get("reversal_total") or 0), 2) == round(received * unit_cost, 2)

    detail_resp = client.get(f"/inventory/grn/{grn_id}", headers=auth_headers)
    assert detail_resp.status_code == 200, detail_resp.text
    detail = detail_resp.json()
    assert detail.get("is_cancelled") is True
    assert str(detail.get("cancel_reason") or "") == "Entered in error"

    final_rows = client.get("/inventory", headers=auth_headers).json()
    final_item = next(row for row in final_rows if int(row["id"]) == item_id)
    final_qty = int(final_item.get("quantity") or 0)
    assert final_qty == before_qty

    movements_resp = client.get("/inventory/movements", headers=auth_headers)
    assert movements_resp.status_code == 200, movements_resp.text
    movement_rows = movements_resp.json() or []
    cancellation_rows = [
        row for row in movement_rows
        if str(row.get("reference_type") or "").lower() == "grn_cancel"
        and int(row.get("reference_id") or 0) == grn_id
        and str(row.get("movement_type") or "").upper() == "GRN_CANCEL"
    ]
    assert any(int(row.get("quantity") or 0) == -received for row in cancellation_rows), movement_rows

    repeat_cancel = client.post(
        f"/inventory/grn/{grn_id}/cancel",
        json={"reason": "Second attempt"},
        headers=auth_headers,
    )
    assert repeat_cancel.status_code == 200, repeat_cancel.text
    repeat_payload = repeat_cancel.json()
    assert repeat_payload.get("already_cancelled") is True
    assert str(repeat_payload.get("grn_no") or "") == grn_no


def test_purchase_order_cancel_requires_active_grn_to_be_cancelled_first(client, auth_headers):
    marker = f"POCANCEL{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}"
    supplier = _ensure_supplier(client, auth_headers, marker)
    item = _ensure_inventory_item(client, auth_headers, marker)

    create_po_resp = client.post(
        "/purchase",
        json={
            "supplier_id": int(supplier["id"]),
            "note": "PO cancellation flow",
            "items": [
                {
                    "item_id": int(item["id"]),
                    "quantity": 3,
                    "unit_cost": 99.5,
                }
            ],
        },
        headers=auth_headers,
    )
    assert create_po_resp.status_code == 200, create_po_resp.text
    po_payload = create_po_resp.json()
    po_id = int(po_payload["id"])

    receive_resp = client.post(f"/purchase/{po_id}/receive", headers=auth_headers)
    assert receive_resp.status_code == 200, receive_resp.text
    grn_id = int(receive_resp.json()["grn_id"])

    blocked_cancel = client.post(
        f"/purchase/{po_id}/cancel",
        json={"reason": "Order should be cancelled"},
        headers=auth_headers,
    )
    assert blocked_cancel.status_code == 409, blocked_cancel.text

    cancel_grn = client.post(
        f"/inventory/grn/{grn_id}/cancel",
        json={"reason": "Receiving was entered by mistake"},
        headers=auth_headers,
    )
    assert cancel_grn.status_code == 200, cancel_grn.text
    assert cancel_grn.json().get("ok") is True

    cancel_po = client.post(
        f"/purchase/{po_id}/cancel",
        json={"reason": "Order should be cancelled"},
        headers=auth_headers,
    )
    assert cancel_po.status_code == 200, cancel_po.text
    assert cancel_po.json().get("status") == "Cancelled"
