import os
import subprocess
import sys
from datetime import UTC, datetime


def _login(client, username: str, password: str) -> dict:
    resp = client.post(
        "/auth/login",
        data={"username": username, "password": password},
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _create_sale(client, auth_headers) -> dict:
    inventory = client.get("/inventory", headers=auth_headers).json()
    item = next(row for row in inventory if int(row.get("quantity") or 0) >= 1)
    resp = client.post(
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
                    "price": float(item["sale_price"]),
                    "warranty_days": 0,
                }
            ],
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _first_customer_id(client, auth_headers) -> int:
    rows = client.get("/customers", headers=auth_headers).json()
    if rows:
        return int(rows[0]["id"])
    resp = client.post(
        "/customers",
        json={"name": "Print Center Customer", "phone": "0770001000", "email": "print@example.com", "address": "Colombo"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    return int(resp.json()["id"])


def _create_repair(client, auth_headers) -> dict:
    customer_id = _first_customer_id(client, auth_headers)
    resp = client.post(
        "/repairs",
        json={
            "customer_id": customer_id,
            "device_model": "Print Center Phone",
            "imei": f"PRINT{datetime.now(UTC).strftime('%H%M%S%f')[:10]}",
            "issue": "Intermittent charging",
            "status": "pending",
            "priority": "Normal",
            "estimated_cost": 12000,
            "advance_payment": 0,
            "outstanding_balance": 12000,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _create_return_case(client, auth_headers, sale_id: int, item_id: int) -> int:
    lookup_resp = client.get(f"/returns/lookup-invoice/{sale_id}", headers=auth_headers)
    assert lookup_resp.status_code == 200, lookup_resp.text
    invoice_payload = lookup_resp.json()["selected_invoice"]
    line = next(row for row in invoice_payload["items"] if int(row["product_id"] or 0) == int(item_id))
    resp = client.post(
        "/returns",
        json={
            "original_invoice_id": sale_id,
            "customer_id": invoice_payload.get("customer_id"),
            "return_type": "return",
            "reason": "Defective item",
            "manual_exception": True,
            "requested_resolution": "refund",
            "items": [
                {
                    "original_invoice_item_id": line["sale_item_id"],
                    "product_id": item_id,
                    "quantity": 1,
                    "unit_price": float(line["unit_price"]),
                    "item_condition": "sellable",
                    "restock_action": "restock",
                }
            ],
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    return int(resp.json()["id"])


def test_print_center_backend_render_and_money_integrity(client, auth_headers):
    sale = _create_sale(client, auth_headers)
    invoice_id = int(sale["sale_id"])

    documents = client.get("/print-center/documents", headers=auth_headers)
    assert documents.status_code == 200, documents.text
    doc_types = {row["document_type"] for row in documents.json()["documents"]}
    assert "invoice" in doc_types
    assert "repair_job_card" in doc_types
    assert "repair_delivery_receipt" in doc_types

    render = client.get(
        "/print-center/render",
        params={"document_type": "invoice", "reference": invoice_id, "paper": "a4"},
        headers=auth_headers,
    )
    assert render.status_code == 200, render.text
    assert "text/html" in render.headers["content-type"]
    sale_label = sale.get("invoice_no") or sale.get("invoice_number") or f"INV-{invoice_id:05d}"
    assert str(invoice_id) in render.text or sale_label in render.text
    assert "I Point" in render.text

    audit = client.get("/financial-audit/money-integrity", headers=auth_headers)
    assert audit.status_code == 200, audit.text
    audit_payload = audit.json()
    assert audit_payload["checked_invoices"] >= 1
    assert "totals" in audit_payload
    assert "invoice_total" in audit_payload["totals"]
    assert "mismatch_totals" in audit_payload


def test_print_center_render_rejects_unauthorized_staff(client, auth_headers):
    sale = _create_sale(client, auth_headers)
    invoice_id = int(sale["sale_id"])
    username = f"print_staff_{datetime.now(UTC).strftime('%H%M%S%f')}"
    create_staff = client.post(
        "/settings/employees",
        json={
            "username": username,
            "full_name": "Print Staff",
            "password": "Staff#Pass2026",
            "role": "View Only",
            "phone_number": "0779992222",
            "email": f"{username}@example.com",
            "pin": "3333",
            "notes": "print center permission test user",
            "is_active": True,
        },
        headers=auth_headers,
    )
    assert create_staff.status_code == 200, create_staff.text
    staff_headers = _login(client, username, "Staff#Pass2026")

    render = client.get(
        "/print-center/render",
        params={"document_type": "invoice", "reference": invoice_id, "paper": "a4"},
        headers=staff_headers,
    )
    assert render.status_code == 403


def test_print_center_renders_all_document_types(client, auth_headers):
    inventory = client.get("/inventory", headers=auth_headers).json()
    item = next(row for row in inventory if int(row.get("quantity") or 0) >= 2)
    item_id = int(item["id"])
    customer_id = _first_customer_id(client, auth_headers)
    sale_resp = client.post(
        "/pos/checkout",
        json={
            "customer_id": customer_id,
            "payment_method": "Cash",
            "paid": True,
            "discount_amount": 0,
            "tax_amount": 0,
            "lines": [{"item_id": item_id, "quantity": 1, "price": float(item["sale_price"]), "warranty_days": 30}],
        },
        headers=auth_headers,
    )
    assert sale_resp.status_code == 200, sale_resp.text
    sale = sale_resp.json()
    sale_id = int(sale["sale_id"])

    payments_resp = client.get(f"/payments/invoice/{sale_id}", headers=auth_headers)
    assert payments_resp.status_code == 200, payments_resp.text
    payment_id = int(payments_resp.json()[0]["id"])

    warranty_resp = client.get("/warranty/records", headers=auth_headers)
    assert warranty_resp.status_code == 200, warranty_resp.text
    warranty = next(row for row in warranty_resp.json() if int(row.get("invoice_id") or 0) == sale_id)

    repair = _create_repair(client, auth_headers)
    repair_id = int(repair["id"])
    advance_resp = client.post(
        "/advance-payments",
        json={
            "advance_type": "repair",
            "customer_id": customer_id,
            "repair_ticket_id": repair_id,
            "amount": 2500.125,
            "payment_method": "cash",
            "notes": "Print Center advance render",
        },
        headers=auth_headers,
    )
    assert advance_resp.status_code == 200, advance_resp.text
    advance_id = int(advance_resp.json()["id"])

    return_id = _create_return_case(client, auth_headers, sale_id, item_id)
    queue_resp = client.post(
        "/labels/queue",
        json={
            "items": [
                {
                    "label_type": "Product",
                    "entity_type": "inventory_item",
                    "entity_id": item_id,
                    "entity_ref": item.get("sku") or str(item_id),
                    "item_name": item["name"],
                    "qty": 1,
                    "metadata": {"barcode": item.get("barcode") or item.get("sku") or str(item_id)},
                }
            ]
        },
        headers=auth_headers,
    )
    assert queue_resp.status_code == 200, queue_resp.text
    label_job_id = int(queue_resp.json()[0]["id"])

    cases = [
        ("sales_receipt", sale_id, "thermal_80"),
        ("invoice", sale_id, "a4"),
        ("return_receipt", return_id, "thermal_80"),
        ("refund_receipt", return_id, "thermal_80"),
        ("exchange_receipt", return_id, "thermal_80"),
        ("advance_receipt", advance_id, "thermal_80"),
        ("repair_job_card", repair_id, "a4"),
        ("repair_delivery_receipt", repair_id, "a4"),
        ("warranty_certificate", int(warranty["id"]), "a4"),
        ("payment_receipt", payment_id, "thermal_80"),
        ("product_label", item_id, "label_50x30"),
        ("barcode_sheet", label_job_id, "label_50x30"),
    ]
    for document_type, reference, paper in cases:
        resp = client.get(
            "/print-center/render",
            params={"document_type": document_type, "reference": reference, "paper": paper},
            headers=auth_headers,
        )
        assert resp.status_code == 200, f"{document_type}: {resp.text}"
        assert "text/html" in resp.headers["content-type"]
        assert "I Point" in resp.text or document_type in {"barcode_sheet", "product_label"}


def test_backup_cleanup_dry_run_and_owner_restore_gate(client, auth_headers):
    backup_resp = client.post("/backup/create", headers=auth_headers)
    assert backup_resp.status_code == 200, backup_resp.text
    filename = backup_resp.json()["filename"]
    from app.database import SessionLocal
    from app.models import BackupRecord, User
    from app.utils.time import utcnow

    db = SessionLocal()
    try:
        owner = db.query(User).filter(User.username == "owner").first()
        marker = datetime.now(UTC).strftime("%H%M%S%f")
        protected_backup = BackupRecord(
            backup_code=f"BKP-TEST-{marker}",
            filename=f"missing-latest-{marker}.db",
            status="verified",
            backup_type="manual",
            storage_target="local",
            created_by_user_id=owner.id if owner else None,
            created_at=utcnow(),
        )
        db.add(protected_backup)
        db.commit()
        protected_backup_id = int(protected_backup.id)
    finally:
        db.close()

    cleanup = client.post(
        "/backup/cleanup",
        json={"dry_run": True, "targets": ["missing_backup_records", "failed_restore_requests", "expired_export_history"], "keep_latest_verified": True},
        headers=auth_headers,
    )
    assert cleanup.status_code == 200, cleanup.text
    assert cleanup.json()["dry_run"] is True
    assert "missing_backup_records" in cleanup.json()["targets"]

    cleanup_execute = client.post(
        "/backup/cleanup",
        json={"dry_run": False, "targets": ["missing_backup_records", "failed_restore_requests", "expired_export_history"], "keep_latest_verified": True},
        headers=auth_headers,
    )
    assert cleanup_execute.status_code == 200, cleanup_execute.text
    cleanup_execute_payload = cleanup_execute.json()
    assert cleanup_execute_payload["dry_run"] is False
    assert cleanup_execute_payload["keep_latest_verified"] is True
    assert cleanup_execute_payload["latest_verified_backup_id"] == protected_backup_id
    assert cleanup_execute_payload["targets"]["missing_backup_records"]["protected_latest_verified"] >= 1
    assert filename in client.get("/backup", headers=auth_headers).json()

    username = f"admin_restore_{datetime.now(UTC).strftime('%H%M%S%f')}"
    create_admin = client.post(
        "/settings/employees",
        json={
            "username": username,
            "full_name": "Restore Admin",
            "password": "Admin#Pass2026",
            "role": "Admin",
            "phone_number": "0779991111",
            "email": f"{username}@example.com",
            "pin": "2222",
            "notes": "restore gate test user",
            "is_active": True,
        },
        headers=auth_headers,
    )
    assert create_admin.status_code == 200, create_admin.text
    admin_headers = _login(client, username, "Admin#Pass2026")

    request_resp = client.post(
        "/backup/restore/request",
        json={"filename": filename, "reason": "owner gate test"},
        headers=auth_headers,
    )
    assert request_resp.status_code == 200, request_resp.text
    request_id = request_resp.json()["request_id"]

    admin_approve = client.post(
        f"/backup/restore/requests/{request_id}/approve",
        json={"note": "admin should be blocked"},
        headers=admin_headers,
    )
    assert admin_approve.status_code == 403

    owner_approve = client.post(
        f"/backup/restore/requests/{request_id}/approve",
        json={"note": "owner approval"},
        headers=auth_headers,
    )
    assert owner_approve.status_code == 200, owner_approve.text


def test_production_config_rejects_direct_restore_opt_in(tmp_path):
    env = os.environ.copy()
    env.update(
        {
            "APP_ENV": "production",
            "SECRET_KEY": "x" * 40,
            "BACKUP_ENCRYPT": "true",
            "BACKUP_ENCRYPTION_PASSPHRASE": "passphrase-for-production-test",
            "ALLOW_DIRECT_RESTORE": "true",
            "CORS_ORIGINS": "http://localhost:5173",
            "SQLITE_FILE": str(tmp_path / "prod_guard.db"),
            "SQLITE_URL": f"sqlite:///{(tmp_path / 'prod_guard.db').as_posix()}",
            "BACKUP_FOLDER": str(tmp_path / "backups"),
            "PYTHONPATH": "backend",
        }
    )
    result = subprocess.run(
        [sys.executable, "-c", "import app.config"],
        cwd=os.getcwd(),
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode != 0
    assert "ALLOW_DIRECT_RESTORE must remain disabled" in (result.stderr + result.stdout)
