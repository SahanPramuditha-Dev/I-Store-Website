"""
Sample data generator for Print Center preview mode.
Provides realistic demo data for all document types when no reference ID is provided.
"""

from datetime import datetime, timedelta
from app.utils.money import to_float


def generate_sample_invoice():
    """Generate sample invoice data for preview."""
    return {
        "id": 12345,
        "invoice_number": "INV-12345",
        "invoice_type": "product_sale",
        "invoice_status": "finalized",
        "payment_status": "paid",
        "customer_id": 999,
        "customer_name": "Sarah Johnson",
        "customer_phone": "+94 77 123 4567",
        "created_at": datetime.now().isoformat(),
        "created_by": 1,
        "created_by_name": "Admin User",
        "lines": [
            {
                "id": 1,
                "line_type": "product",
                "product_id": 101,
                "description": "Smartphone Stand (Aluminum)",
                "item_name": "Smartphone Stand (Aluminum)",
                "sku": "STD-ALU-001",
                "quantity": 2,
                "unit_price": to_float(2500),
                "discount_amount": to_float(0),
                "line_total": to_float(5000),
                "warranty_days": 365,
            },
            {
                "id": 2,
                "line_type": "product",
                "product_id": 102,
                "description": "USB-C Cable (2m)",
                "item_name": "USB-C Cable (2m)",
                "sku": "CBL-USB-002",
                "quantity": 3,
                "unit_price": to_float(800),
                "discount_amount": to_float(0),
                "line_total": to_float(2400),
                "warranty_days": 180,
            },
            {
                "id": 3,
                "line_type": "product",
                "product_id": 103,
                "description": "Screen Protector (Pack of 5)",
                "item_name": "Screen Protector (Pack of 5)",
                "sku": "PROT-SCRE-001",
                "quantity": 1,
                "unit_price": to_float(1200),
                "discount_amount": to_float(0),
                "line_total": to_float(1200),
                "warranty_days": 90,
            },
        ],
        "subtotal": to_float(8600),
        "discount_total": to_float(500),
        "tax_total": to_float(1215),
        "grand_total": to_float(9315),
        "advance_applied_total": to_float(0),
        "paid_total": to_float(9315),
        "balance_due": to_float(0),
        "payments": [
            {
                "id": 1,
                "payment_number": "PAY-12345",
                "payment_method": "Card",
                "payment_type": "Full Payment",
                "amount": to_float(9315),
                "reference_number": "CARD-REF-001",
                "received_by": "Admin User",
                "created_at": datetime.now().isoformat(),
            }
        ],
        "warranty_records": [],
        "audit_events": [],
    }


def generate_sample_sales_receipt():
    """Generate sample sales receipt (thermal) data."""
    invoice = generate_sample_invoice()
    return invoice


def generate_sample_return_case():
    """Generate sample return/exchange case data."""
    return {
        "id": 54321,
        "return_number": "RET-54321",
        "return_id": 54321,
        "original_invoice_number": "INV-12345",
        "invoice_id": 12345,
        "customer_name": "Sarah Johnson",
        "decision_status": "approved",
        "status": "approved",
        "items": [
            {
                "product_id": 101,
                "product_name": "Smartphone Stand (Aluminum)",
                "item_name": "Smartphone Stand (Aluminum)",
                "quantity": 1,
                "item_condition": "defective",
                "restock_action": "replace",
                "return_amount": to_float(2500),
                "unit_price": to_float(2500),
            }
        ],
        "total_return_amount": to_float(2500),
        "refund_amount": to_float(2500),
        "store_credit_amount": to_float(0),
    }


def generate_sample_refund_receipt():
    """Generate sample refund receipt."""
    return generate_sample_return_case()


def generate_sample_exchange_receipt():
    """Generate sample exchange receipt."""
    return generate_sample_return_case()


def generate_sample_advance_receipt():
    """Generate sample advance payment receipt."""
    return {
        "id": 789,
        "receipt_number": "ADV-789",
        "advance_number": "ADV-789",
        "customer_name": "Sarah Johnson",
        "customer_id": 999,
        "payment_method": "Cash",
        "payment_date": datetime.now().isoformat(),
        "created_at": datetime.now().isoformat(),
        "amount_paid": to_float(5000),
        "amount": to_float(5000),
        "estimated_total": to_float(12000),
        "remaining_balance": to_float(7000),
        "status": "active",
        "reservation_number": "RES-001",
        "repair_ticket_number": None,
    }


def generate_sample_repair_job_card():
    """Generate sample repair job card."""
    return {
        "id": 5001,
        "ticket_no": "RPR-5001",
        "customer_name": "John Smith",
        "customer_phone": "+94 77 987 6543",
        "device_model": "iPhone 14 Pro",
        "imei": "123456789012345",
        "issue": "Cracked screen, battery not charging",
        "status": "pending_parts",
        "status_label": "Pending Parts",
        "priority": "high",
        "technician": "Mike Johnson",
        "estimated_cost": to_float(8500),
        "advance_payment": to_float(3000),
        "outstanding_balance": to_float(5500),
    }


def generate_sample_repair_delivery_receipt():
    """Generate sample repair delivery receipt."""
    return {
        "id": 5001,
        "ticket_no": "RPR-5001",
        "customer_name": "John Smith",
        "customer_phone": "+94 77 987 6543",
        "device_model": "iPhone 14 Pro",
        "imei": "123456789012345",
        "issue": "Cracked screen, battery not charging",
        "status": "completed",
        "status_label": "Completed",
        "priority": "high",
        "technician": "Mike Johnson",
        "estimated_cost": to_float(8500),
        "advance_payment": to_float(3000),
        "outstanding_balance": to_float(5500),
        "parts_used": [
            {
                "item_name": "iPhone Screen Assembly",
                "quantity": 1,
                "unit_cost": to_float(5000),
                "line_total": to_float(5000),
            },
            {
                "item_name": "Battery",
                "quantity": 1,
                "unit_cost": to_float(2500),
                "line_total": to_float(2500),
            },
        ],
    }


def generate_sample_warranty_certificate():
    """Generate sample warranty certificate."""
    return {
        "id": 4001,
        "warranty_number": "WAR-4001",
        "warranty_id": 4001,
        "product_or_service_name": "Smartphone Stand (Aluminum)",
        "customer_name": "Sarah Johnson",
        "customer_phone": "+94 77 123 4567",
        "serial_number": "SN-12345-ALUM",
        "imei_or_serial": "SN-12345-ALUM",
        "start_date": (datetime.now() - timedelta(days=1)).isoformat(),
        "end_date": (datetime.now() + timedelta(days=365)).isoformat(),
        "warranty_days": 365,
        "coverage_type": "Full Replacement",
        "status": "active",
    }


def generate_sample_payment_receipt():
    """Generate sample payment receipt."""
    return {
        "id": 6001,
        "payment_number": "PAY-6001",
        "invoice_id": 12345,
        "invoice_number": "INV-12345",
        "customer_name": "Sarah Johnson",
        "payment_method": "Card",
        "payment_type": "Full Payment",
        "amount": to_float(9315),
        "reference_number": "CARD-REF-2026",
        "created_at": datetime.now().isoformat(),
        "paid_total": to_float(9315),
        "balance_due": to_float(0),
    }


def generate_sample_barcode_sheet():
    """Generate sample barcode data for label sheet."""
    return {
        "barcodes": [
            {"sku": "STD-ALU-001", "product_name": "Smartphone Stand", "barcode": "4891234567890"},
            {"sku": "CBL-USB-002", "product_name": "USB-C Cable", "barcode": "4891234567891"},
            {"sku": "PROT-SCRE-001", "product_name": "Screen Protector", "barcode": "4891234567892"},
            {"sku": "STD-ALU-002", "product_name": "Tablet Stand", "barcode": "4891234567893"},
            {"sku": "CBL-USB-003", "product_name": "Micro USB Cable", "barcode": "4891234567894"},
        ],
        "count": 5,
        "notes": "[SAMPLE DATA - Preview Mode]",
    }


def generate_sample_product_label():
    """Generate sample product label."""
    return {
        "id": 101,
        "sku": "STD-ALU-001",
        "product_name": "Smartphone Stand (Aluminum)",
        "description": "Premium aluminum phone stand",
        "price": to_float(2500),
        "barcode": "4891234567890",
        "stock_qty": 45,
        "notes": "[SAMPLE DATA - Preview Mode]",
    }


SAMPLE_GENERATORS = {
    "sales_receipt": generate_sample_sales_receipt,
    "invoice": generate_sample_invoice,
    "return_receipt": generate_sample_return_case,
    "refund_receipt": generate_sample_refund_receipt,
    "exchange_receipt": generate_sample_exchange_receipt,
    "advance_receipt": generate_sample_advance_receipt,
    "repair_job_card": generate_sample_repair_job_card,
    "repair_delivery_receipt": generate_sample_repair_delivery_receipt,
    "warranty_certificate": generate_sample_warranty_certificate,
    "payment_receipt": generate_sample_payment_receipt,
    "barcode_sheet": generate_sample_barcode_sheet,
    "product_label": generate_sample_product_label,
}


def get_sample_data(document_type: str) -> dict:
    """Get sample data for a given document type."""
    doc_key = str(document_type or "").strip().lower()
    generator = SAMPLE_GENERATORS.get(doc_key)
    if not generator:
        raise ValueError(f"No sample data generator for document type: {document_type}")
    return generator()
