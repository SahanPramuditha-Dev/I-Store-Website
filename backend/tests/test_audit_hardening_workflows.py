from datetime import datetime, timezone
import re


def _pick_inventory_item(rows):
    for row in rows:
        if int(row.get("quantity") or 0) >= 1:
            return row
    return rows[0] if rows else None


def test_bootstrap_owner_flow_enforced(client):
    status_resp = client.get("/auth/bootstrap/status")
    assert status_resp.status_code == 200, status_resp.text
    assert status_resp.json().get("setup_required") is True

    login_resp = client.post(
        "/auth/login",
        data={"username": "owner", "password": "Owner#Pass2026"},
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    assert login_resp.status_code == 428, login_resp.text

    create_resp = client.post(
        "/auth/bootstrap/owner",
        json={
            "username": "owner",
            "full_name": "Owner User",
            "password": "Owner#Pass2026",
            "phone_number": "0770000000",
            "email": "owner@example.com",
        },
    )
    assert create_resp.status_code == 200, create_resp.text

    duplicate_resp = client.post(
        "/auth/bootstrap/owner",
        json={
            "username": "owner2",
            "full_name": "Owner User 2",
            "password": "Owner#Pass2026",
        },
    )
    assert duplicate_resp.status_code == 409


def test_no_default_admin_account_created(client, auth_headers):
    staff_resp = client.get("/auth/staff", headers=auth_headers)
    assert staff_resp.status_code == 200, staff_resp.text
    usernames = {str(row.get("username") or "").lower() for row in staff_resp.json()}
    assert "admin" not in usernames
    assert "admin_test" not in usernames


def test_admin_username_is_never_locked_out(client, auth_headers):
    from app.auth import hash_password
    from app.database import SessionLocal
    from app.models import Role, User

    with SessionLocal() as db:
        admin_role = db.query(Role).filter(Role.name == "admin").first()
        admin = User(
            username="admin",
            full_name="Store Admin",
            password_hash=hash_password("Admin#Pass2026"),
            role="admin",
            role_id=admin_role.id if admin_role else None,
            is_active=True,
            is_deleted=False,
        )
        db.add(admin)
        db.commit()

    for _ in range(7):
        resp = client.post(
            "/auth/login",
            data={"username": "admin", "password": "wrong-password"},
            headers={"content-type": "application/x-www-form-urlencoded"},
        )
        assert resp.status_code == 401, resp.text

    with SessionLocal() as db:
        admin = db.query(User).filter(User.username == "admin").first()
        assert admin is not None
        assert admin.failed_login_count >= 7
        assert admin.account_locked_until is None

    good_resp = client.post(
        "/auth/login",
        data={"username": "admin", "password": "Admin#Pass2026"},
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    assert good_resp.status_code == 200, good_resp.text


def test_repair_pos_checkout_allows_labor_and_links_ticket(client, auth_headers):
    customers = client.get("/customers", headers=auth_headers).json()
    customer_id = customers[0]["id"]

    inventory_rows = client.get("/inventory", headers=auth_headers).json()
    item = _pick_inventory_item(inventory_rows)
    assert item is not None, "Expected at least one inventory item"
    item_id = item["id"]
    before_qty = int(item.get("quantity") or 0)

    repair_create = client.post(
        "/repairs",
        json={
            "customer_id": customer_id,
            "device_model": "Samsung S24",
            "imei": "356123456789012",
            "issue": "Screen replacement",
            "status": "pending",
            "technician": "Service Tech",
            "estimated_cost": 15000,
            "advance_payment": 0,
        },
        headers=auth_headers,
    )
    assert repair_create.status_code == 200, repair_create.text
    repair = repair_create.json()

    checkout = client.post(
        "/pos/checkout",
        json={
            "customer_id": customer_id,
            "repair_ticket_id": repair["id"],
            "payment_method": "Cash",
            "paid": True,
            "discount_amount": 0,
            "tax_amount": 0,
            "lines": [
                {
                    "item_id": item_id,
                    "line_type": "spare_part",
                    "description": "Display spare part",
                    "quantity": 1,
                    "price": float(item.get("sale_price") or 0) or 1000.0,
                    "warranty_days": 0,
                },
                {
                    "item_id": None,
                    "line_type": "labor",
                    "description": "Labor charge",
                    "quantity": 1,
                    "price": 2500,
                    "warranty_days": 0,
                },
            ],
        },
        headers=auth_headers,
    )
    assert checkout.status_code == 200, checkout.text
    sale = checkout.json()
    assert sale["repair_ticket_id"] == repair["id"]

    sale_detail = client.get(f"/pos/sales/{sale['sale_id']}", headers=auth_headers)
    assert sale_detail.status_code == 200, sale_detail.text
    lines = sale_detail.json().get("lines") or []
    assert any(str(row.get("line_type")) == "labor" and row.get("item_id") is None for row in lines)
    assert any(str(row.get("line_type")) == "spare_part" for row in lines)

    inventory_after = client.get("/inventory", headers=auth_headers).json()
    row_after = next((r for r in inventory_after if r["id"] == item_id), None)
    assert row_after is not None
    assert int(row_after.get("quantity") or 0) == before_qty - 1

    repairs_after = client.get("/repairs", headers=auth_headers).json()
    repair_after = next((r for r in repairs_after if r["id"] == repair["id"]), None)
    assert repair_after is not None
    assert repair_after.get("invoice_status") == "invoiced"


def test_stock_take_draft_then_post_changes_stock_once(client, auth_headers):
    inventory_rows = client.get("/inventory", headers=auth_headers).json()
    item = _pick_inventory_item(inventory_rows)
    assert item is not None
    item_id = item["id"]
    original_qty = int(item.get("quantity") or 0)
    counted_qty = original_qty + 2

    created = client.post("/inventory/stock-takes", json={"name": "Cycle Count A"}, headers=auth_headers)
    assert created.status_code == 200, created.text
    session_id = created.json()["id"]

    line_resp = client.post(
        f"/inventory/stock-takes/{session_id}/lines",
        json={"item_id": item_id, "physical_qty": counted_qty},
        headers=auth_headers,
    )
    assert line_resp.status_code == 200, line_resp.text

    inventory_mid = client.get("/inventory", headers=auth_headers).json()
    mid_item = next((r for r in inventory_mid if r["id"] == item_id), None)
    assert mid_item is not None
    assert int(mid_item.get("quantity") or 0) == original_qty

    close_resp = client.post(f"/inventory/stock-takes/{session_id}/close", headers=auth_headers)
    assert close_resp.status_code == 200, close_resp.text
    assert str(close_resp.json().get("status")).lower() == "review"

    post_resp = client.post(f"/inventory/stock-takes/{session_id}/post", headers=auth_headers)
    assert post_resp.status_code == 200, post_resp.text
    assert str(post_resp.json().get("status")).lower() == "posted"

    inventory_after = client.get("/inventory", headers=auth_headers).json()
    after_item = next((r for r in inventory_after if r["id"] == item_id), None)
    assert after_item is not None
    assert int(after_item.get("quantity") or 0) == counted_qty


def test_bulk_technician_assignment_persists(client, auth_headers):
    customers = client.get("/customers", headers=auth_headers).json()
    customer_id = customers[0]["id"]

    repairs_created = []
    for idx in range(2):
        resp = client.post(
            "/repairs",
            json={
                "customer_id": customer_id,
                "device_model": f"Pixel {idx}",
                "imei": f"3591234567890{idx}",
                "issue": "Battery replacement",
                "status": "pending",
                "technician": "",
                "estimated_cost": 4000,
                "advance_payment": 0,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        repairs_created.append(resp.json())

    staff = client.get("/auth/staff", headers=auth_headers)
    assert staff.status_code == 200, staff.text
    staff_rows = staff.json()
    assert staff_rows, "Expected at least one active staff user"
    technician = staff_rows[0]

    assign_resp = client.post(
        "/repairs/assign-technician/bulk",
        json={
            "repair_ids": [repairs_created[0]["id"], repairs_created[1]["id"]],
            "technician_user_id": technician["id"],
        },
        headers=auth_headers,
    )
    assert assign_resp.status_code == 200, assign_resp.text
    assert int(assign_resp.json().get("updated_count") or 0) == 2

    repairs_after = client.get("/repairs", headers=auth_headers).json()
    for row in repairs_after:
        if row["id"] in {repairs_created[0]["id"], repairs_created[1]["id"]}:
            assert row.get("assigned_technician_user_id") == technician["id"]
            assert row.get("technician")


def test_restore_workflow_persists_in_normalized_tables(client, auth_headers):
    backup_resp = client.post("/backup/create", headers=auth_headers)
    assert backup_resp.status_code == 200, backup_resp.text
    backup_filename = backup_resp.json().get("filename")
    assert backup_filename

    direct_restore_resp = client.post(f"/backup/restore/{backup_filename}", headers=auth_headers)
    assert direct_restore_resp.status_code == 410

    request_resp = client.post(
        "/backup/restore/request",
        json={"filename": backup_filename, "reason": "Validation restore workflow"},
        headers=auth_headers,
    )
    assert request_resp.status_code == 200, request_resp.text
    request_id = request_resp.json().get("request_id")
    assert request_id

    approve_resp = client.post(
        f"/backup/restore/requests/{request_id}/approve",
        json={"note": "Approved in automated test"},
        headers=auth_headers,
    )
    assert approve_resp.status_code == 200, approve_resp.text

    execute_resp = client.post(f"/backup/restore/requests/{request_id}/execute", headers=auth_headers)
    assert execute_resp.status_code == 200, execute_resp.text
    req_payload = execute_resp.json().get("request") or {}
    assert req_payload.get("status") == "Executed"

    from app.database import SessionLocal
    from app.models import AppSetting, RestoreApproval, RestoreAuditEvent, RestoreRequest

    with SessionLocal() as db:
        req_row = db.query(RestoreRequest).filter(RestoreRequest.request_code == request_id).first()
        assert req_row is not None
        assert str(req_row.status or "").lower() == "executed"
        approval_count = (
            db.query(RestoreApproval)
            .filter(
                RestoreApproval.restore_request_id == req_row.id,
                RestoreApproval.decision == "approved",
            )
            .count()
        )
        assert approval_count >= 1
        completed_count = (
            db.query(RestoreAuditEvent)
            .filter(
                RestoreAuditEvent.restore_request_id == req_row.id,
                RestoreAuditEvent.event_type == "restore_completed",
            )
            .count()
        )
        assert completed_count >= 1

        legacy_setting = db.query(AppSetting).filter(AppSetting.key == "backup_restore_requests_v1").first()
        if legacy_setting:
            assert str(legacy_setting.value or "").strip() in {"", "[]"}


def test_sequence_numbering_applied_to_return_and_warranty_records(client, auth_headers):
    inventory_rows = client.get("/inventory", headers=auth_headers).json()
    item = _pick_inventory_item(inventory_rows)
    assert item is not None

    checkout_resp = client.post(
        "/pos/checkout",
        json={
            "customer_id": None,
            "payment_method": "Cash",
            "paid": True,
            "discount_amount": 0,
            "tax_amount": 0,
            "lines": [
                {
                    "item_id": item["id"],
                    "quantity": 1,
                    "price": float(item.get("sale_price") or 1000),
                    "warranty_days": 0,
                }
            ],
        },
        headers=auth_headers,
    )
    assert checkout_resp.status_code == 200, checkout_resp.text
    sale_id = checkout_resp.json()["sale_id"]

    invoice_lookup = client.get(f"/returns/invoice-lookup/{sale_id}", headers=auth_headers)
    assert invoice_lookup.status_code == 200, invoice_lookup.text
    sale_lines = invoice_lookup.json().get("items") or []
    assert sale_lines, "Expected sale lines for return workflow"
    sale_item_id = sale_lines[0]["sale_item_id"]

    return_resp = client.post(
        "/returns/records",
        json={
            "original_invoice_id": sale_id,
            "original_sale_item_id": sale_item_id,
            "quantity": 1,
            "return_type": "Product Return",
            "return_reason": "Customer changed mind",
            "item_condition": "Reusable",
        },
        headers=auth_headers,
    )
    assert return_resp.status_code == 200, return_resp.text
    return_id = str(return_resp.json().get("return_id") or "")
    assert re.match(r"^RET-\d{4}-\d{6}$", return_id), return_id

    warranty_resp = client.post(
        "/warranty/records",
        json={
            "customer_name": "Walk-in",
            "product_or_service_name": "Test Coverage",
            "warranty_type": "Product",
            "start_date": datetime.now(timezone.utc).isoformat(),
            "warranty_days": 30,
            "status": "Active",
            "quantity_covered": 1,
        },
        headers=auth_headers,
    )
    assert warranty_resp.status_code == 200, warranty_resp.text
    warranty_id = str(warranty_resp.json().get("warranty_id") or "")
    assert re.match(r"^WRN-\d{4}-\d{6}$", warranty_id), warranty_id
