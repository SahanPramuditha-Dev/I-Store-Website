def test_generic_approval_request_lifecycle(client, auth_headers):
    create_resp = client.post(
        "/financial-audit/approvals",
        json={
            "module": "inventory",
            "action": "stock_adjustment",
            "target_type": "InventoryItem",
            "target_id": 123,
            "reason": "Large stock correction requires approval",
            "payload": {"quantity_change": 50},
        },
        headers=auth_headers,
    )
    assert create_resp.status_code == 200, create_resp.text
    request = create_resp.json()
    assert request["status"] == "pending"
    assert request["request_code"].startswith("APR-")

    approve_resp = client.post(
        f"/financial-audit/approvals/{request['request_code']}/approve",
        json={"note": "Approved by test owner"},
        headers=auth_headers,
    )
    assert approve_resp.status_code == 200, approve_resp.text
    assert approve_resp.json()["status"] == "approved"

    execute_resp = client.post(
        f"/financial-audit/approvals/{request['request_code']}/execute",
        json={"note": "Sensitive action executed"},
        headers=auth_headers,
    )
    assert execute_resp.status_code == 200, execute_resp.text
    assert execute_resp.json()["status"] == "executed"

    reject_after_execute = client.post(
        f"/financial-audit/approvals/{request['request_code']}/reject",
        json={"note": "Too late to reject"},
        headers=auth_headers,
    )
    assert reject_after_execute.status_code == 409, reject_after_execute.text


def _create_approval(client, auth_headers, payload):
    create_resp = client.post("/financial-audit/approvals", json=payload, headers=auth_headers)
    assert create_resp.status_code == 200, create_resp.text
    row = create_resp.json()
    approve_resp = client.post(
        f"/financial-audit/approvals/{row['request_code']}/approve",
        json={"note": "Approved for sensitive action test"},
        headers=auth_headers,
    )
    assert approve_resp.status_code == 200, approve_resp.text
    return row["request_code"]


def test_stock_adjustment_above_threshold_requires_and_consumes_approval(client, auth_headers):
    marker = "APP-STOCK-001"
    create_item = client.post(
        "/inventory",
        json={
            "name": "Approval Stock Item",
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
            "sku": marker,
            "barcode": marker,
            "quantity": 1,
            "cost_price": 10,
            "sale_price": 20,
            "has_serials": False,
            "supplier_id": None,
        },
        headers=auth_headers,
    )
    assert create_item.status_code == 200, create_item.text
    item = create_item.json()

    missing_approval = client.post(
        "/inventory/adjust",
        json={"item_id": item["id"], "quantity_change": 25, "note": "Large approval stock adjustment"},
        headers=auth_headers,
    )
    assert missing_approval.status_code == 403, missing_approval.text

    approval_code = _create_approval(
        client,
        auth_headers,
        {
            "module": "inventory",
            "action": "stock_adjustment",
            "target_type": "InventoryItem",
            "target_id": item["id"],
            "reason": "Large stock adjustment",
            "payload": {"quantity_change": 25},
        },
    )
    adjust_resp = client.post(
        "/inventory/adjust",
        json={
            "item_id": item["id"],
            "quantity_change": 25,
            "note": "Large approval stock adjustment",
            "approval_request_code": approval_code,
        },
        headers=auth_headers,
    )
    assert adjust_resp.status_code == 200, adjust_resp.text
    assert adjust_resp.json()["new_quantity"] == 26

    approvals = client.get("/financial-audit/approvals", params={"status": "executed"}, headers=auth_headers)
    assert approvals.status_code == 200, approvals.text
    assert any(row["request_code"] == approval_code for row in approvals.json())

    reuse_resp = client.post(
        "/inventory/adjust",
        json={
            "item_id": item["id"],
            "quantity_change": 25,
            "note": "Large approval stock adjustment reuse",
            "approval_request_code": approval_code,
        },
        headers=auth_headers,
    )
    assert reuse_resp.status_code == 409, reuse_resp.text


def test_expense_archive_requires_approval_request(client, auth_headers):
    create_resp = client.post(
        "/expenses",
        json={
            "category": "Operations",
            "amount": 100,
            "tax_amount": 0,
            "description": "Approval-gated archive",
            "payment_method": "Cash",
        },
        headers=auth_headers,
    )
    assert create_resp.status_code == 200, create_resp.text
    expense = create_resp.json()

    missing_approval = client.delete(f"/expenses/{expense['id']}", headers=auth_headers)
    assert missing_approval.status_code == 403, missing_approval.text

    approval_code = _create_approval(
        client,
        auth_headers,
        {
            "module": "expenses",
            "action": "archive",
            "target_type": "Expense",
            "target_id": expense["id"],
            "reason": "Archive test expense",
            "payload": {"expense_code": expense["expense_code"]},
        },
    )
    archive_resp = client.delete(
        f"/expenses/{expense['id']}",
        params={"approval_request_code": approval_code},
        headers=auth_headers,
    )
    assert archive_resp.status_code == 200, archive_resp.text


def test_high_value_pos_void_requires_approval_request(client, auth_headers):
    marker = "APP-POS-VOID-001"
    customer_resp = client.post(
        "/customers",
        json={"name": "Approval Customer", "phone": "0771234567", "email": None, "address": "", "notes": ""},
        headers=auth_headers,
    )
    assert customer_resp.status_code == 200, customer_resp.text
    customer = customer_resp.json()

    create_item = client.post(
        "/inventory",
        json={
            "name": "Approval High Value Item",
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
            "sku": marker,
            "barcode": marker,
            "quantity": 2,
            "cost_price": 1000,
            "sale_price": 150000,
            "has_serials": False,
            "supplier_id": None,
        },
        headers=auth_headers,
    )
    assert create_item.status_code == 200, create_item.text
    item = create_item.json()

    checkout_resp = client.post(
        "/pos/checkout",
        json={
            "customer_id": customer["id"],
            "payment_method": "Cash",
            "paid": True,
            "discount_amount": 0,
            "tax_amount": 0,
            "lines": [{"item_id": item["id"], "quantity": 1, "price": 150000, "warranty_days": 0}],
        },
        headers=auth_headers,
    )
    assert checkout_resp.status_code == 200, checkout_resp.text
    sale = checkout_resp.json()

    missing_approval = client.post(
        f"/pos/sales/{sale['sale_id']}/void",
        json={"reason": "High value approval void"},
        headers=auth_headers,
    )
    assert missing_approval.status_code == 403, missing_approval.text

    approval_code = _create_approval(
        client,
        auth_headers,
        {
            "module": "pos",
            "action": "void",
            "target_type": "Sale",
            "target_id": sale["sale_id"],
            "reason": "High value sale void",
            "payload": {"amount": 150000.0},
        },
    )
    void_resp = client.post(
        f"/pos/sales/{sale['sale_id']}/void",
        json={"reason": "High value approval void", "approval_request_code": approval_code},
        headers=auth_headers,
    )
    assert void_resp.status_code == 200, void_resp.text
