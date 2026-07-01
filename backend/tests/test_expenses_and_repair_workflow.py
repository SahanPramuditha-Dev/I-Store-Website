from datetime import UTC, datetime, timedelta


def test_expense_lifecycle_and_reporting(client, auth_headers):
    payload = {
        "category": "Rent",
        "amount": 12000,
        "description": "Monthly shop rent",
        "payment_method": "Bank Transfer",
        "vendor_name": "Property Owner",
        "reference_no": "RENT-APR",
        "expense_date": datetime.now(UTC).isoformat(),
        "is_recurring": True,
        "recurring_cycle": "Monthly",
        "notes": "Created from automated test",
    }
    create_resp = client.post("/expenses", json=payload, headers=auth_headers)
    assert create_resp.status_code == 200, create_resp.text
    created = create_resp.json()
    assert created["status"] == "Pending Approval"
    expense_id = created["id"]

    approve_resp = client.put(
        f"/expenses/{expense_id}/approve",
        json={"action": "approve", "note": "Approved in test"},
        headers=auth_headers,
    )
    assert approve_resp.status_code == 200, approve_resp.text
    assert approve_resp.json()["status"] == "Approved"

    paid_resp = client.put(
        f"/expenses/{expense_id}/approve",
        json={"action": "paid", "note": "Paid in test"},
        headers=auth_headers,
    )
    assert paid_resp.status_code == 200, paid_resp.text
    assert paid_resp.json()["status"] == "Paid"

    summary_resp = client.get("/expenses/summary", headers=auth_headers)
    assert summary_resp.status_code == 200, summary_resp.text
    summary = summary_resp.json()
    assert summary["paid_count"] >= 1
    assert summary["total_expenses"] >= 12000

    report_resp = client.get("/reports/expenses", headers=auth_headers)
    assert report_resp.status_code == 200, report_resp.text
    report_rows = report_resp.json()
    assert any(row["id"] == expense_id for row in report_rows)


def test_repair_status_transition_rules(client, auth_headers):
    customers_resp = client.get("/customers", headers=auth_headers)
    assert customers_resp.status_code == 200, customers_resp.text
    customers = customers_resp.json()
    assert customers, "Expected seeded customers"
    customer_id = customers[0]["id"]

    create_repair_payload = {
        "customer_id": customer_id,
        "device_model": "iPhone 14 Pro",
        "imei": "357999123456789",
        "condition_notes": "Good",
        "issue": "Battery drains quickly",
        "accessories": "Case",
        "status": "Pending",
        "priority": "Normal",
        "warranty_status": "None",
        "technician": "Test Technician",
        "estimated_cost": 4500,
        "advance_payment": 0,
        "notes": "Workflow test",
        "estimated_completion": (datetime.now(UTC) + timedelta(days=2)).isoformat(),
    }
    create_resp = client.post("/repairs", json=create_repair_payload, headers=auth_headers)
    assert create_resp.status_code == 200, create_resp.text
    repair_id = create_resp.json()["id"]

    invalid_jump_resp = client.put(
        f"/repairs/{repair_id}/status",
        params={"status": "Repairing"},
        headers=auth_headers,
    )
    assert invalid_jump_resp.status_code == 400

    diagnosing_resp = client.put(
        f"/repairs/{repair_id}/status",
        params={"status": "Diagnosing"},
        headers=auth_headers,
    )
    assert diagnosing_resp.status_code == 200, diagnosing_resp.text

    waiting_approval_resp = client.put(
        f"/repairs/{repair_id}/status",
        params={"status": "Waiting for Approval"},
        headers=auth_headers,
    )
    assert waiting_approval_resp.status_code == 200, waiting_approval_resp.text

    repairing_resp = client.put(
        f"/repairs/{repair_id}/status",
        params={"status": "Repairing"},
        headers=auth_headers,
    )
    assert repairing_resp.status_code == 200, repairing_resp.text

    invalid_delivered_resp = client.put(
        f"/repairs/{repair_id}/status",
        params={"status": "Delivered"},
        headers=auth_headers,
    )
    assert invalid_delivered_resp.status_code == 400


def test_repair_cancel_endpoint_marks_ticket_cancelled(client, auth_headers):
    customers_resp = client.get("/customers", headers=auth_headers)
    assert customers_resp.status_code == 200, customers_resp.text
    customer_id = customers_resp.json()[0]["id"]

    create_resp = client.post(
        "/repairs",
        json={
            "customer_id": customer_id,
            "device_model": "Samsung S23",
            "imei": f"357999{datetime.now(UTC).strftime('%H%M%S%f')[:9]}",
            "condition_notes": "Used",
            "issue": "Display issue",
            "accessories": "None",
            "status": "pending",
            "priority": "Normal",
            "warranty_status": "None",
            "technician": "Test Technician",
            "estimated_cost": 3500,
            "advance_payment": 0,
            "notes": "Cancel endpoint test",
            "estimated_completion": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        },
        headers=auth_headers,
    )
    assert create_resp.status_code == 200, create_resp.text
    repair_id = int(create_resp.json()["id"])

    short_reason_resp = client.post(
        f"/repairs/{repair_id}/cancel",
        json={"reason": "bad"},
        headers=auth_headers,
    )
    assert short_reason_resp.status_code == 400

    cancel_resp = client.post(
        f"/repairs/{repair_id}/cancel",
        json={"reason": "Customer declined estimate"},
        headers=auth_headers,
    )
    assert cancel_resp.status_code == 200, cancel_resp.text
    cancelled = cancel_resp.json()["repair"]
    assert str(cancelled["status"]).lower() == "cancelled"
    assert str(cancelled["delivery_status"]).lower() == "cancelled"
