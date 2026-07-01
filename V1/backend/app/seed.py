import os
import secrets

from app.models import User, Customer, Supplier, InventoryItem, RepairTicket, Sale
from app.auth import hash_password


def _demo_password() -> str:
    configured = str(os.getenv("ISTORE_DEMO_USER_PASSWORD", "")).strip()
    if len(configured) >= 12:
        return configured
    # Random per startup if no explicit demo password is configured.
    return secrets.token_urlsafe(20)


def seed_data():
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        demo_password = _demo_password()
        # Staff / Technicians
        if not db.query(User).filter(User.username == "nimal").first():
            db.add(User(username="nimal", full_name="Nimal K.", password_hash=hash_password(demo_password), role="employee"))
        if not db.query(User).filter(User.username == "dimuth").first():
            db.add(User(username="dimuth", full_name="Dimuth R.", password_hash=hash_password(demo_password), role="employee"))
        if not db.query(User).filter(User.username == "kusal").first():
            db.add(User(username="kusal", full_name="Kusal P.", password_hash=hash_password(demo_password), role="employee"))
        db.flush()

        # Customers
        if not db.query(Customer).first():
            db.add_all([
                Customer(name="Kamal Silva", phone="077-123-4567", email="kamal@example.com"),
                Customer(name="Sanduni Perera", phone="076-234-5678", email="sanduni@example.com"),
                Customer(name="Ravi Fernando", phone="071-345-6789", email="ravi@example.com"),
                Customer(name="Malini Jayawardena", phone="078-456-7890", email="malini@example.com"),
                Customer(name="Charith Dias", phone="075-567-8901", email="charith@example.com"),
                Customer(name="Priya Wijesinghe", phone="077-678-9012", email="priya@example.com"),
                Customer(name="Nuwan Bandara", phone="076-789-0123", email="nuwan@example.com"),
                Customer(name="Dilrukshi Senanayake", phone="071-890-1234", email="dilrukshi@example.com"),
            ])
            db.flush()

        # Suppliers
        if not db.query(Supplier).first():
            s1 = Supplier(name="MobileHub Distributors", contact="0112456789")
            db.add(s1)
            db.flush()
            
            # Inventory
            db.add_all([
                InventoryItem(name="iPhone 15 Pro Screen", category="Spare Parts", sku="SCR-15P", quantity=5, cost_price=45000, sale_price=65000, supplier_id=s1.id),
                InventoryItem(name="Samsung S24 Battery", category="Spare Parts", sku="BAT-S24", quantity=12, cost_price=4500, sale_price=8500, supplier_id=s1.id),
                InventoryItem(name="Charging Port (Universal)", category="Spare Parts", sku="CP-UNI", quantity=50, cost_price=450, sale_price=1500, supplier_id=s1.id),
                InventoryItem(name="iPhone 13 Speaker", category="Spare Parts", sku="SPK-13", quantity=8, cost_price=2500, sale_price=4500, supplier_id=s1.id),
            ])
            db.flush()

        # Repair Tickets
        if not db.query(RepairTicket).first():
            db.add_all([
                RepairTicket(ticket_no="R-1042", customer_id=1, device_model="iPhone 15 Pro", imei="351234567890123", issue="Screen cracked", status="In Progress", technician="Nimal K.", estimated_cost=12500),
                RepairTicket(ticket_no="R-1041", customer_id=2, device_model="Samsung S24", imei="352345678901234", issue="Battery drain", status="Pending", technician="Dimuth R.", estimated_cost=5500),
                RepairTicket(ticket_no="R-1040", customer_id=3, device_model="Pixel 8", imei="353456789012345", issue="Charging port", status="Completed", technician="Nimal K.", estimated_cost=3500),
                RepairTicket(ticket_no="R-1039", customer_id=4, device_model="iPhone 13", imei="354567890123456", issue="Speaker issue", status="Completed", technician="Kusal P.", estimated_cost=4000),
                RepairTicket(ticket_no="R-1038", customer_id=5, device_model="Oppo Reno 11", imei="355678901234567", issue="Camera not working", status="Pending", technician="Dimuth R.", estimated_cost=7500),
                RepairTicket(ticket_no="R-1037", customer_id=6, device_model="Xiaomi 14", imei="356789012345678", issue="Display flickering", status="In Progress", technician="Nimal K.", estimated_cost=9000),
            ])
            
        db.commit()
    finally:
        db.close()
