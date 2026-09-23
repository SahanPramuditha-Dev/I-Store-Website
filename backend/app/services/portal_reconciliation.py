"""Bounded local reconciliation. Only changed snapshots use cloud requests.

Requires explicit tenant configuration; never guesses an organization. Checkpoints
and outbox entries commit together. Rotating pages eventually revisit older bills.
"""
import hashlib
import json
import os
import threading
import time
from datetime import timezone
from sqlalchemy import func
from app.models import AppSetting, Customer, Sale, SaleItem, Return, ReturnRecord
from app.services.cloudflare_portal_sync import build_payload, enabled, normalize_phone

_lock = threading.Lock()


def _state(db, key):
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    return row, json.loads(row.value) if row else {}


def _save(db, key, row, value):
    if row is None:
        row = AppSetting(key=key)
        db.add(row)
    row.value = json.dumps(value, sort_keys=True)


def _snapshot(db, sale, customer, store):
    legacy_refund = db.query(func.coalesce(func.sum(ReturnRecord.refund_amount), 0)).filter(
        ReturnRecord.original_sale_id == sale.id, ReturnRecord.organization_id == sale.organization_id,
        ReturnRecord.is_deleted.is_(False), ReturnRecord.decision_status == "Refunded").scalar()
    modern_refund = db.query(func.coalesce(func.sum(Return.refund_amount), 0)).filter(
        Return.original_invoice_id == sale.id, Return.organization_id == sale.organization_id,
        Return.is_deleted.is_(False), Return.decision_status.notin_(["rejected", "cancelled"])).scalar()
    refund = round(float(legacy_refund or 0) + float(modern_refund or 0), 2)
    status = "Paid" if sale.paid or float(sale.balance_due or 0) <= 0 else "Pending"
    if sale.invoice_status == "partially_refunded" or refund > 0:
        status = "Partially refunded"
    if sale.invoice_status == "refunded" or (refund > 0 and refund + .01 >= float(sale.total or 0)):
        status = "Refunded"
    if sale.is_voided or sale.invoice_status in ("voided", "cancelled"):
        status = "Cancelled"
    items = db.query(SaleItem).filter(SaleItem.sale_id == sale.id, SaleItem.is_deleted.is_(False)).order_by(SaleItem.id).all()
    issued = sale.created_at.replace(tzinfo=timezone.utc).isoformat()
    invoice = {
        "id": sale.invoice_no or f"INV-{sale.id:05d}", "store_id": store,
        "customer_name": customer.name or "Customer", "customer_phone": customer.whatsapp_number or customer.phone,
        "created_at": issued, "subtotal": float(sale.subtotal or 0), "discount": float(sale.discount_amount or 0),
        "tax": float(sale.tax_amount or 0), "total": float(sale.total or 0), "status": status,
        "payment_method": sale.payment_method or "Cash",
        "items": [{"item_name": x.description or "Item", "quantity": float(x.quantity or 0), "unit_price": float(x.price or 0),
                   "warranty_months": round((x.warranty_days or 0) / 30), "imei_or_serial": x.serial_number or ""} for x in items],
    }
    payload = build_payload(invoice)
    payload["bill"].update(amountPaid=float(sale.amount_paid or 0), balanceDue=float(sale.balance_due or 0), refundAmount=refund)
    return payload


def reconcile_customer_bills(db, batch_size=50):
    if not enabled():
        return {"status": "disabled", "queued": 0}
    store = os.getenv("CLOUDFLARE_PORTAL_STORE_REF", "")
    org = os.getenv("CLOUDFLARE_PORTAL_ORGANIZATION_ID", "")
    branch = os.getenv("CLOUDFLARE_PORTAL_BRANCH_ID", "")
    if not store or not org.isdigit() or int(org) <= 0 or (branch and not branch.isdigit()):
        return {"status": "tenant_configuration_required", "queued": 0}
    if not _lock.acquire(blocking=False):
        return {"status": "busy", "queued": 0}
    try:
        from app.services.supabase_pos_sync import enqueue_outbox_event
        cursor_key = f"portal_cursor:{store}:{org}:{branch}"
        cursor_row, cursor = _state(db, cursor_key)
        query = db.query(Sale).filter(Sale.organization_id == int(org), Sale.is_return.is_(False))
        if branch:
            query = query.filter(Sale.branch_id == int(branch))
        sales = query.filter(Sale.id > cursor.get("last_id", 0)).order_by(Sale.id).limit(min(max(batch_size, 1), 100)).all()
        queued = 0
        for sale in sales:
            key = f"portal_bill:{store}:{org}:{sale.id}"
            row, old = _state(db, key)
            customer = db.query(Customer).filter(Customer.id == sale.customer_id, Customer.organization_id == int(org)).first()
            invoice_ref = sale.invoice_no or f"INV-{sale.id:05d}"
            if old.get("revoked"):
                continue  # Re-issuing access is an explicit, separate workflow.
            try:
                phone = normalize_phone(customer.whatsapp_number or customer.phone) if customer and not customer.is_deleted else None
            except ValueError:
                phone = None
            identity = hashlib.sha256(f"{sale.customer_id}:{phone}".encode()).hexdigest() if phone else None
            revoke = bool(old and (sale.is_deleted or not phone or old.get("identity") != identity or old.get("invoice_ref") != invoice_ref))
            if revoke:
                payload = {"revoked": True, "storeRef": store, "invoiceRef": old["invoice_ref"]}
            elif sale.is_deleted or not phone or sale.invoice_status == "draft":
                continue
            else:
                payload = _snapshot(db, sale, customer, store)
            payload.pop("sourceVersion", None)
            fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            if old.get("fingerprint") == fingerprint:
                continue
            version = max(time.time_ns() // 1000000, old.get("version", 0) + 1)
            payload["sourceVersion"] = version
            event = enqueue_outbox_event(db, "cloudflare_invoice", str(sale.id), "UPSERT", payload, sale.organization_id, sale.branch_id)
            if event is None:
                raise RuntimeError("Could not persist bill reconciliation")
            event.max_retries = 1440
            _save(db, key, row, {"fingerprint": fingerprint, "identity": identity, "version": version,
                               "invoice_ref": old.get("invoice_ref", invoice_ref) if revoke else invoice_ref, "revoked": revoke})
            queued += 1
        _save(db, cursor_key, cursor_row, {"last_id": sales[-1].id if sales else 0})
        db.commit()
        return {"status": "complete", "scanned": len(sales), "queued": queued}
    except Exception:
        db.rollback()
        raise
    finally:
        _lock.release()
