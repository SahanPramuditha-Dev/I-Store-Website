"""Optional customer-bill copies in D1. The local POS remains authoritative."""
import base64
import hashlib
import hmac
import json
import os
import time
import urllib.request
from datetime import datetime, timezone
from urllib.parse import urlparse


def enabled():
    return os.getenv("CLOUDFLARE_PORTAL_ENABLED", "false").lower() == "true"


def normalize_phone(value):
    digits = "".join(c for c in str(value or "") if c.isascii() and c.isdigit())
    if len(digits) == 10 and digits.startswith("0"):
        digits = "94" + digits[1:]
    if len(digits) == 9 and digits.startswith("7"):
        digits = "94" + digits
    if len(digits) != 11 or not digits.startswith("947"):
        raise ValueError("A registered Sri Lankan mobile number is required")
    return "+" + digits


def build_payload(invoice):
    store = os.getenv("CLOUDFLARE_PORTAL_STORE_REF", "")
    if not store or invoice.get("store_id") != store:
        raise ValueError("Portal store configuration does not match the POS store")
    key = os.getenv("CLOUDFLARE_RECEIPT_LINK_KEY", "")
    if len(key) < 32:
        raise ValueError("Portal receipt-link key is not configured")
    phone = normalize_phone(invoice.get("customer_phone"))
    identity = json.dumps([store, str(invoice["id"]), phone], separators=(",", ":"))
    token = base64.urlsafe_b64encode(hmac.new(key.encode(), identity.encode(), hashlib.sha256).digest()).decode().rstrip("=")
    return {
        "receiptToken": token,
        "storeRef": store,
        "storeName": (invoice.get("store_profile") or {}).get("name") or "I-Store",
        "customerPhone": phone,
        "sourceVersion": time.time_ns() // 1000000,
        "bill": {
            "invoiceRef": str(invoice["id"]), "customerName": invoice.get("customer_name") or "Customer",
            "issuedAt": invoice.get("created_at") or datetime.now(timezone.utc).isoformat(),
            "currency": "LKR", "subtotal": invoice["subtotal"], "discount": invoice["discount"],
            "tax": invoice["tax"], "total": invoice["total"], "paymentMethod": invoice["payment_method"], "status": invoice["status"],
            "items": [{"name": x["item_name"], "quantity": x["quantity"], "unitPrice": x["unit_price"],
                       "warrantyMonths": x.get("warranty_months") or 0, "serial": x.get("imei_or_serial") or ""} for x in invoice["items"]],
        },
    }


def portal_url(payload):
    base = os.getenv("CLOUDFLARE_PORTAL_URL", "").rstrip("/")
    parsed = urlparse(base)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("HTTPS portal URL required")
    return f"{base}/r/{payload['receiptToken']}"


def printable_portal_url(db, sale):
    """Read-only: print only an already queued, identity-matching capability."""
    from app.models import AppSetting, Customer, SyncOutbox
    if not enabled() or sale.is_deleted or sale.is_return or sale.invoice_status == "draft":
        return None
    org = os.getenv("CLOUDFLARE_PORTAL_ORGANIZATION_ID", "")
    branch = os.getenv("CLOUDFLARE_PORTAL_BRANCH_ID", "")
    if not org.isdigit() or not branch.isdigit() or sale.organization_id != int(org) or str(sale.branch_id) != branch:
        return None
    customer = db.query(Customer).filter(Customer.id == sale.customer_id, Customer.organization_id == sale.organization_id).first()
    if not customer or customer.is_deleted:
        return None
    try:
        phone = normalize_phone(customer.whatsapp_number or customer.phone)
        store = os.getenv("CLOUDFLARE_PORTAL_STORE_REF", "")
        ref = sale.invoice_no or f"INV-{sale.id:05d}"
        checkpoint = db.query(AppSetting).filter(AppSetting.key == f"portal_bill:{store}:{org}:{sale.id}").first()
        if not checkpoint:
            return None  # Wait for reconciliation to bind the POS customer identity.
        if checkpoint:
            state = json.loads(checkpoint.value)
            identity = hashlib.sha256(f"{sale.customer_id}:{phone}".encode()).hexdigest()
            if state.get("revoked") or state.get("identity") != identity or state.get("invoice_ref") != ref:
                return None
        rows = db.query(SyncOutbox).filter(SyncOutbox.entity_type == "cloudflare_invoice",
            SyncOutbox.organization_id == sale.organization_id,
            SyncOutbox.entity_id.in_([str(sale.id), ref])).order_by(SyncOutbox.created_at.desc()).all()
        candidate = None
        for row in rows:
            payload = json.loads(row.payload)
            if payload.get("storeRef") != store:
                continue
            if payload.get("revoked"):
                return None
            if payload.get("bill", {}).get("invoiceRef") != ref:
                continue
            if payload.get("customerPhone") != phone or row.status == "dead_letter":
                return None
            candidate = candidate or payload
        return portal_url(candidate) if candidate else None
    except (ValueError, KeyError, TypeError):
        return None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward a POS credential to another host.


def push_bill(payload):
    if not enabled():
        raise ValueError("Cloudflare bill sync is disabled")
    base = portal_url({"receiptToken": ""}).split("/r/", 1)[0]
    secret = os.getenv("CLOUDFLARE_POS_API_KEY", "")
    if len(secret) < 32:
        raise ValueError("Portal POS key is not configured")
    body = json.dumps(payload).encode()
    if len(body) > 60000:
        raise ValueError("Portal bill exceeds size limit")
    request = urllib.request.Request(base + "/internal/bills", data=body, method="POST", headers={"X-POS-API-Key": secret, "Content-Type": "application/json"})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=15) as response:
        result = json.loads(response.read(4096))
    if result.get("success") is not True:
        raise ValueError("Portal did not acknowledge bill sync")
