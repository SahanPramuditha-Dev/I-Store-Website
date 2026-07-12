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
        "invoice_no": "INV-12345",
        "invoice_date": datetime.now().isoformat(),
        "customer": {
            "id": 999,
            "name": "Sarah Johnson",
            "phone": "+94 77 123 4567",
            "email": "sarah@example.com",
            "address": "123 Main Street, Colombo, Sri Lanka",
        },
        "items": [
            {
                "product_id": 101,
                "product_name": "Smartphone Stand (Aluminum)",
                "sku": "STD-ALU-001",
                "quantity": 2,
                "unit_price": to_float(2500),
                "line_total": to_float(5000),
            },
            {
                "product_id": 102,
                "product_name": "USB-C Cable (2m)",
                "sku": "CBL-USB-002",
                "quantity": 3,
                "unit_price": to_float(800),
                "line_total": to_float(2400),
            },
            {
                "product_id": 103,
                "product_name": "Screen Protector (Pack of 5)",
                "sku": "PROT-SCRE-001",
                "quantity": 1,
                "unit_price": to_float(1200),
                "line_total": to_float(1200),
            },
        ],
        "subtotal": to_float(8600),
        "discount": to_float(500),
        "tax_rate": 0.15,
        "tax_amount": to_float(1215),
        "total": to_float(9315),
        "amount_paid": to_float(9315),
        "balance_due": to_float(0),
        "payment_method": "Card",
        "created_by": "Admin User",
        "notes": "[SAMPLE DATA - Preview Mode]",
    }


def generate_sample_sales_receipt():
    """Generate sample sales receipt (thermal) data."""
    return generate_sample_invoice()


def generate_sample_return_case():
    """Generate sample return/exchange case data."""
    return {
        "id": 54321,
        "case_no": "RET-54321",
        "case_type": "return",
        "case_type_label": "Return",
        "customer": {
            "id": 999,
            "name": "Sarah Johnson",
            "phone": "+94 77 123 4567",
            "email": "sarah@example.com",
        },
        "original_invoice_id": 12345,
        "original_invoice_no": "INV-12345",
        "reason": "Product defect",
        "items": [
            {
                "product_id": 101,
                "product_name": "Smartphone Stand (Aluminum)",
                "sku": "STD-ALU-001",
                "quantity": 1,
                "unit_price": to_float(2500),
                "line_total": to_float(2500),
                "refund_amount": to_float(2500),
            }
        ],
        "refund_total": to_float(2500),
        "exchange_total": to_float(0),
        "store_credit_issued": to_float(0),
        "status": "approved",
        "status_label": "Approved",
        "created_at": datetime.now().isoformat(),
        "notes": "[SAMPLE DATA - Preview Mode]",
    }


def generate_sample_refund_receipt():
    """Generate sample refund receipt."""
    return {
        "id": 54321,
        "case_no": "RET-54321",
        "case_type": "return",
        "customer": {
            "id": 999,
            "name": "Sarah Johnson",
            "phone": "+94 77 123 4567",
        },
        "original_invoice_no": "INV-12345",
        "items": [
            {
                "product_name": "Smartphone Stand (Aluminum)",
                "quantity": 1,
                "refund_amount": to_float(2500),
            }
        ],
        "refund_total": to_float(2500),
        "refund_method": "Original Payment Method",
        "created_at": datetime.now().isoformat(),
        "notes": "[SAMPLE DATA - Preview Mode]",
    }


def generate_sample_exchange_receipt():
    """Generate sample exchange receipt."""
    return {
        "id": 54322,
        "case_no": "RET-54322",
        "case_type": "exchange",
        "customer": {
            "id": 999,
            "name": "Sarah Johnson",
            "phone": "+94 77 123 4567",
        },
        "original_invoice_no": "INV-12345",
        "items_returned": [
            {
                "product_name": "Smartphone Stand (Aluminum)",
                "quantity": 1,
                "refund_amount": to_float(2500),
            }
        ],
        "items_issued": [
            {
                "product_name": "Phone Case (Premium Leather)",
                "quantity": 1,
                "price": to_float(2200),
            }
        ],
        "refund_due": to_float(300),
        "created_at": datetime.now().isoformat(),
        "notes": "[SAMPLE DATA - Preview Mode]",
    }


def generate_sample_advance_receipt():
    """Generate sample advance payment receipt."""
    return {
        "id": 789,
        "advance_number": "ADV-789",
        "customer": {
            "id": 999,
            "name": "Sarah Johnson",
            "phone": "+94 77 123 4567",
        },
        "advance_amount": to_float(5000),
        "purpose": "Mobile Device Purchase",
        "payment_method": "Cash",
        "payment_date": datetime.now().isoformat(),
        "reference_number": "REF-2026-001",
        "notes": "[SAMPLE DATA - Preview Mode]",
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
        "created_at": datetime.now().isoformat(),
        "notes": "[SAMPLE DATA - Preview Mode]",
    }


def generate_sample_repair_delivery_receipt():
    """Generate sample repair delivery receipt."""
    sample_job = generate_sample_repair_job_card()
    return {
        **sample_job,
        "status": "completed",
        "status_label": "Completed",
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
        "labor_cost": to_float(1000),
        "total_cost": to_float(8500),
        "paid_amount": to_float(3000),
        "balance_due": to_float(5500),
        "completion_date": datetime.now().isoformat(),
    }


def generate_sample_warranty_certificate():
    """Generate sample warranty certificate."""
    return {
        "id": 4001,
        "certificate_number": "WAR-4001",
        "product": {
            "id": 101,
            "name": "Smartphone Stand (Aluminum)",
            "sku": "STD-ALU-001",
        },
        "customer": {
            "id": 999,
            "name": "Sarah Johnson",
            "phone": "+94 77 123 4567",
        },
        "purchase_date": (datetime.now() - timedelta(days=1)).isoformat(),
        "warranty_period_months": 12,
        "warranty_start": (datetime.now() - timedelta(days=1)).isoformat(),
        "warranty_end": (datetime.now() + timedelta(days=365)).isoformat(),
        "warranty_terms": "Covers manufacturing defects and hardware failures",
        "coverage": "Full replacement or repair",
        "exclusions": "Accidental damage, misuse, modifications",
        "notes": "[SAMPLE DATA - Preview Mode]",
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
        "notes": "[SAMPLE DATA - Preview Mode]",
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
