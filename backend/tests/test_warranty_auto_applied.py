from datetime import UTC, datetime, timedelta


def _first_customer_id(client, auth_headers) -> int:
    customers_resp = client.get("/customers", headers=auth_headers)
    assert customers_resp.status_code == 200, customers_resp.text
    customers = customers_resp.json()
    assert customers, "Expected seeded customers"
    return int(customers[0]["id"])


def _first_inventory_item(client, auth_headers):
    inv_resp = client.get("/inventory", headers=auth_headers)
    assert inv_resp.status_code == 200, inv_resp.text
    rows = inv_resp.json()
    item = next((row for row in rows if int(row.get("quantity") or 0) >= 1), None)
    assert item, "Expected at least one in-stock inventory item"
    return item


def _checkout_single_item(client, auth_headers, item_id: int, unit_price: float, customer_id: int, serial_number: str):
    payload = {
        "customer_id": customer_id,
        "payment_method": "Cash",
        "paid": True,
        "discount_amount": 0,
        "tax_amount": 0,
        "lines": [
            {
                "item_id": int(item_id),
                "quantity": 1,
                "price": float(unit_price),
                "warranty_days": 0,
                "serial_number": serial_number,
            }
        ],
    }
    resp = client.post("/pos/checkout", json=payload, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_product_rule_overrides_category_rule(client, auth_headers):
    customer_id = _first_customer_id(client, auth_headers)
    item = _first_inventory_item(client, auth_headers)

    category_rule = {
        "rule_name": "Category Warranty 30d",
        "rule_type": "category",
        "scope_type": "product_category",
        "scope_value": item["category"],
        "warranty_duration_value": 30,
        "warranty_duration_unit": "days",
        "coverage_type": "repair",
        "priority": 400,
        "warranty_days": 30,
        "is_active": True,
    }
    product_rule = {
        "rule_name": f"Product Warranty 365d #{item['id']}",
        "rule_type": "product",
        "scope_type": "product",
        "scope_value": str(item["id"]),
        "product_id": int(item["id"]),
        "warranty_duration_value": 365,
        "warranty_duration_unit": "days",
        "coverage_type": "repair",
        "priority": 100,
        "warranty_days": 365,
        "is_active": True,
    }
    r1 = client.post("/warranty/rules", json=category_rule, headers=auth_headers)
    assert r1.status_code == 200, r1.text
    r2 = client.post("/warranty/rules", json=product_rule, headers=auth_headers)
    assert r2.status_code == 200, r2.text

    sale = _checkout_single_item(
        client,
        auth_headers,
        item_id=item["id"],
        unit_price=float(item["sale_price"]),
        customer_id=customer_id,
        serial_number=f"SN-PRIORITY-{datetime.now(UTC).strftime('%H%M%S%f')}",
    )
    warranty_rows = sale.get("warranty_records") or []
    assert warranty_rows, "Expected auto-created warranty record"
    assert int(warranty_rows[0]["warranty_days"]) == 365

    record_lookup = client.get(
        "/warranty/records",
        params={"q": warranty_rows[0]["warranty_id"]},
        headers=auth_headers,
    )
    assert record_lookup.status_code == 200, record_lookup.text
    records = record_lookup.json()
    assert records, "Expected warranty lookup to find the generated record"
    certificate = client.get(f"/warranty/records/{records[0]['id']}/certificate", headers=auth_headers)
    assert certificate.status_code == 200, certificate.text
    assert "Warranty Certificate" in certificate.text
    assert warranty_rows[0]["warranty_id"] in certificate.text


def test_category_rule_fallback_and_grn_does_not_create_customer_warranty(client, auth_headers):
    customer_id = _first_customer_id(client, auth_headers)
    unique_suffix = datetime.now(UTC).strftime("%H%M%S%f")
    category_name = f"WarrantyCat-{unique_suffix}"

    create_item_payload = {
        "name": f"Warranty Item {unique_suffix}",
        "category": category_name,
        "brand": "TestBrand",
        "model": "Model X",
        "storage": "128GB",
        "color": "Black",
        "condition": "New",
        "product_type": "Retail",
        "location": "A-01",
        "warranty_days": 0,
        "sku": f"SKU-{unique_suffix}",
        "barcode": f"BAR-{unique_suffix}",
        "quantity": 5,
        "cost_price": 1000,
        "sale_price": 1500,
        "has_serials": False,
        "supplier_id": None,
    }
    item_resp = client.post("/inventory", json=create_item_payload, headers=auth_headers)
    assert item_resp.status_code == 200, item_resp.text
    item = item_resp.json()

    category_rule = {
        "rule_name": f"Category Warranty 60d {unique_suffix}",
        "rule_type": "category",
        "scope_type": "product_category",
        "scope_value": category_name,
        "warranty_duration_value": 60,
        "warranty_duration_unit": "days",
        "coverage_type": "repair",
        "priority": 350,
        "warranty_days": 60,
        "is_active": True,
    }
    rule_resp = client.post("/warranty/rules", json=category_rule, headers=auth_headers)
    assert rule_resp.status_code == 200, rule_resp.text

    before_rows = client.get("/warranty/records", headers=auth_headers).json()
    before_count = len([r for r in before_rows if int(r.get("product_id") or r.get("item_id") or 0) == int(item["id"])])

    sale = _checkout_single_item(
        client,
        auth_headers,
        item_id=item["id"],
        unit_price=float(item["sale_price"]),
        customer_id=customer_id,
        serial_number=f"SN-CAT-{unique_suffix}",
    )
    warranty_rows = sale.get("warranty_records") or []
    assert warranty_rows, "Expected auto-created warranty record from category rule"
    assert int(warranty_rows[0]["warranty_days"]) == 60

    suppliers_resp = client.get("/inventory/suppliers", headers=auth_headers)
    assert suppliers_resp.status_code == 200, suppliers_resp.text
    suppliers = suppliers_resp.json()
    if suppliers:
        supplier_id = int(suppliers[0]["id"])
    else:
        supplier_payload = {"name": f"Supplier {unique_suffix}", "contact": "0770000000", "email": "", "address": "", "notes": "", "payment_terms_days": 0, "opening_balance": 0}
        supplier_create = client.post("/inventory/suppliers", json=supplier_payload, headers=auth_headers)
        assert supplier_create.status_code == 200, supplier_create.text
        supplier_id = int(supplier_create.json()["id"])

    grn_payload = {
        "supplier_id": supplier_id,
        "invoice_no": f"SUP-INV-{unique_suffix}",
        "note": "Warranty test GRN",
        "po_id": None,
        "lines": [
            {"item_id": int(item["id"]), "quantity": 2, "damaged_qty": 0, "unit_cost": float(item["cost_price"])}
        ],
    }
    grn_resp = client.post("/inventory/grn", json=grn_payload, headers=auth_headers)
    assert grn_resp.status_code == 200, grn_resp.text

    after_rows = client.get("/warranty/records", headers=auth_headers).json()
    after_count = len([r for r in after_rows if int(r.get("product_id") or r.get("item_id") or 0) == int(item["id"])])
    # GRN must not create customer warranties.
    assert after_count == before_count + 1


def test_repair_delivery_auto_creates_warranty(client, auth_headers):
    customer_id = _first_customer_id(client, auth_headers)
    unique_imei = f"357999{datetime.now(UTC).strftime('%H%M%S%f')[:9]}"
    create_payload = {
        "customer_id": customer_id,
        "device_model": "iPhone 14 Pro",
        "imei": unique_imei,
        "condition_notes": "Good",
        "issue": "Battery replacement required",
        "accessories": "None",
        "status": "pending",
        "priority": "Normal",
        "warranty_status": "None",
        "technician": "Tech A",
        "estimated_cost": 5000,
        "advance_payment": 5000,
        "notes": "Warranty delivery test",
        "estimated_completion": (datetime.now(UTC) + timedelta(days=2)).isoformat(),
    }
    create_resp = client.post("/repairs", json=create_payload, headers=auth_headers)
    assert create_resp.status_code == 200, create_resp.text
    repair_id = int(create_resp.json()["id"])

    for status in ["Diagnosing", "Waiting for Approval", "Repairing", "Quality Checking", "Completed"]:
        step_resp = client.put(f"/repairs/{repair_id}/status", params={"status": status}, headers=auth_headers)
        assert step_resp.status_code == 200, step_resp.text

    delivered_resp = client.put(f"/repairs/{repair_id}/status", params={"status": "Delivered"}, headers=auth_headers)
    assert delivered_resp.status_code == 200, delivered_resp.text
    warranty_record = delivered_resp.json().get("warranty_record")
    assert warranty_record is not None, "Expected warranty auto-created on repair delivery"
    assert int(warranty_record.get("warranty_days") or 0) > 0


def test_warranty_lookup_and_claim_workflow(client, auth_headers):
    customer_id = _first_customer_id(client, auth_headers)
    item = _first_inventory_item(client, auth_headers)
    serial = f"SN-LOOKUP-{datetime.now(UTC).strftime('%H%M%S%f')}"

    sale = _checkout_single_item(
        client,
        auth_headers,
        item_id=item["id"],
        unit_price=float(item["sale_price"]),
        customer_id=customer_id,
        serial_number=serial,
    )
    assert sale.get("warranty_records"), "Expected warranty records from sale"
    sale_id = int(sale["sale_id"])

    lookup_invoice = client.get(f"/warranty/lookup?invoice=INV-{sale_id:05d}", headers=auth_headers)
    assert lookup_invoice.status_code == 200, lookup_invoice.text
    rows = lookup_invoice.json()
    assert rows, "Expected lookup result by invoice"
    warranty = rows[0]

    lookup_serial = client.get(f"/warranty/lookup?serial={serial}", headers=auth_headers)
    assert lookup_serial.status_code == 200, lookup_serial.text
    assert lookup_serial.json(), "Expected lookup by serial"

    lookup_warranty = client.get(
        f"/warranty/lookup?warranty_number={warranty.get('warranty_number') or warranty.get('warranty_id')}",
        headers=auth_headers,
    )
    assert lookup_warranty.status_code == 200, lookup_warranty.text
    assert lookup_warranty.json(), "Expected lookup by warranty number"

    create_claim_resp = client.post(
        "/warranty/claims",
        json={
            "warranty_id": int(warranty["id"]),
            "customer_complaint": "Device not charging",
            "technician_inspection_note": "Port damage suspected",
        },
        headers=auth_headers,
    )
    assert create_claim_resp.status_code == 200, create_claim_resp.text
    claim = create_claim_resp.json()
    claim_id = int(claim["id"])

    inspect_resp = client.patch(
        f"/warranty/claims/{claim_id}/inspect",
        params={"technician_notes": "Verified charging IC issue"},
        headers=auth_headers,
    )
    assert inspect_resp.status_code == 200, inspect_resp.text

    approve_resp = client.patch(f"/warranty/claims/{claim_id}/approve", headers=auth_headers)
    assert approve_resp.status_code == 200, approve_resp.text
    assert approve_resp.json().get("claim_status_key") == "approved"

    resolve_resp = client.patch(
        f"/warranty/claims/{claim_id}/resolve",
        params={"resolution_type": "repair"},
        headers=auth_headers,
    )
    assert resolve_resp.status_code == 200, resolve_resp.text
    assert resolve_resp.json().get("claim_status_key") == "resolved"
