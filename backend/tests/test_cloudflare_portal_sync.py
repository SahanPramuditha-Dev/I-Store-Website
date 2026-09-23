import os
import unittest
from unittest.mock import patch
from app.services.cloudflare_portal_sync import build_payload, normalize_phone, portal_url, NoRedirect

class CloudflarePortalTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"CLOUDFLARE_PORTAL_STORE_REF": "shop", "CLOUDFLARE_RECEIPT_LINK_KEY": "a" * 43, "CLOUDFLARE_PORTAL_URL": "https://portal.example"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.invoice = {"id": "INV-1", "store_id": "shop", "customer_phone": "0771234567", "customer_name": "Test", "subtotal": 100, "discount": 0, "tax": 0, "total": 100, "payment_method": "Cash", "status": "Paid", "items": [{"item_name": "Item", "quantity": 1, "unit_price": 100}]}

    def test_receipt_link_is_stable_and_not_guessable_from_invoice(self):
        a = build_payload(self.invoice)
        b = build_payload(self.invoice)
        self.assertEqual(a["receiptToken"], b["receiptToken"])
        self.assertEqual(len(a["receiptToken"]), 43)
        self.assertNotIn("0771234567", portal_url(a))
        self.invoice["customer_phone"] = "0777654321"
        self.assertNotEqual(a["receiptToken"], build_payload(self.invoice)["receiptToken"])

    def test_cross_store_rejected(self):
        self.invoice["store_id"] = "other"
        with self.assertRaises(ValueError): build_payload(self.invoice)

    def test_registered_mobile_required(self):
        for bad in ["", "1234", "+12025550123"]:
            with self.assertRaises(ValueError): normalize_phone(bad)
        self.assertEqual(normalize_phone("+94 77 123 4567"), "+94771234567")

    def test_preserves_sale_date(self):
        self.invoice["created_at"] = "2026-01-01T12:00:00Z"
        self.assertEqual(build_payload(self.invoice)["bill"]["issuedAt"], self.invoice["created_at"])

    def test_redirects_and_insecure_endpoints_rejected(self):
        self.assertIsNone(NoRedirect().redirect_request(None,None,None,None,None,None))
        with patch.dict(os.environ, {"CLOUDFLARE_PORTAL_URL": "http://portal.example"}):
            with self.assertRaises(ValueError): portal_url(build_payload(self.invoice))

if __name__ == "__main__": unittest.main()
