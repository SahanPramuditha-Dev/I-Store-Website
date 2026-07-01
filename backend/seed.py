import os
import random
from datetime import datetime, timedelta
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal
from app.models import User, Customer, Supplier, InventoryItem, RepairTicket, Sale, SaleItem, StockMovement, RepairPartUsage, RepairHistory
from app.auth import hash_password

db = SessionLocal()

print("Clearing old data...")
db.query(StockMovement).delete()
db.query(RepairHistory).delete()
db.query(RepairPartUsage).delete()
db.query(SaleItem).delete()
db.query(Sale).delete()
db.query(RepairTicket).delete()
db.query(InventoryItem).delete()
db.query(Customer).delete()
db.query(Supplier).delete()
db.query(User).delete()
db.commit()

print("Seeding Users...")
owner_seed_password = os.getenv("ISTORE_SEED_OWNER_PASSWORD")
if not owner_seed_password:
    raise RuntimeError("Set ISTORE_SEED_OWNER_PASSWORD before running backend/seed.py")
users = [
    User(username="owner", full_name="Owner User", password_hash=hash_password(owner_seed_password), role="owner"),
    User(username="cashier1", full_name="Nimal Perera", password_hash=hash_password("123"), role="employee"),
    User(username="tech1", full_name="Kasun Silva", password_hash=hash_password("123"), role="technician"),
    User(username="tech2", full_name="Chamara Fernando", password_hash=hash_password("123"), role="technician"),
]
db.add_all(users)
db.commit()

print("Seeding Customers...")
sl_first_names = ["Kamal", "Nuwan", "Amila", "Ruwan", "Dulanjali", "Thilini", "Dinuka", "Sachin", "Gayan", "Heshan", "Lahiru", "Roshan", "Mahesh"]
sl_last_names = ["Perera", "Silva", "Fernando", "De Silva", "Jayawardena", "Rajapaksha", "Bandara", "Kumara", "Rathnayake", "Dissanayake", "Gamage"]

customers = []
for i in range(20):
    c = Customer(
        name=f"{random.choice(sl_first_names)} {random.choice(sl_last_names)}",
        phone=f"07{random.randint(10000000, 99999999)}",
        email=f"customer{i}@example.com",
        address=f"No. {random.randint(1, 100)}, Galle Road, Colombo {random.randint(1, 10)}"
    )
    db.add(c)
    customers.append(c)
db.commit()
for c in customers: db.refresh(c)

print("Seeding Suppliers...")
sup = Supplier(name="Transasia Mobile Parts", contact="0112345678")
db.add(sup)
db.commit()
db.refresh(sup)

print("Seeding Inventory...")
inventory_data = [
    {"name": "Apple iPhone 15 Pro Max (256GB)", "cat": "Smartphones", "cost": 350000, "sale": 420000, "qty": 5},
    {"name": "Apple iPhone 13 (128GB)", "cat": "Smartphones", "cost": 150000, "sale": 180000, "qty": 8},
    {"name": "Samsung Galaxy S24 Ultra", "cat": "Smartphones", "cost": 300000, "sale": 360000, "qty": 6},
    {"name": "Samsung Galaxy A54", "cat": "Smartphones", "cost": 85000, "sale": 105000, "qty": 12},
    {"name": "Redmi Note 13 Pro", "cat": "Smartphones", "cost": 65000, "sale": 78000, "qty": 15},
    {"name": "Vivo V29 5G", "cat": "Smartphones", "cost": 90000, "sale": 110000, "qty": 10},
    {"name": "Apple iPhone X (Used - 64GB)", "cat": "Used Phones", "cost": 40000, "sale": 60000, "qty": 3},
    {"name": "Samsung Galaxy S21 (Used)", "cat": "Used Phones", "cost": 60000, "sale": 85000, "qty": 2},
    {"name": "Apple 20W USB-C Power Adapter", "cat": "Chargers", "cost": 3500, "sale": 6500, "qty": 40},
    {"name": "Samsung 25W Fast Charger", "cat": "Chargers", "cost": 2500, "sale": 4500, "qty": 35},
    {"name": "Baseus 65W GaN Charger", "cat": "Chargers", "cost": 5000, "sale": 8500, "qty": 15},
    {"name": "Apple AirPods Pro (2nd Gen)", "cat": "Earphones", "cost": 55000, "sale": 75000, "qty": 10},
    {"name": "JBL Wave Buds", "cat": "Earphones", "cost": 9000, "sale": 14500, "qty": 20},
    {"name": "Anker PowerCore 10000mAh", "cat": "Power Banks", "cost": 6500, "sale": 11500, "qty": 25},
    {"name": "Joyroom 20000mAh Power Bank", "cat": "Power Banks", "cost": 8000, "sale": 14000, "qty": 15},
    {"name": "iPhone 15 Pro Clear Case", "cat": "Cases & Covers", "cost": 500, "sale": 1500, "qty": 50},
    {"name": "Samsung S24 Ultra Silicone Cover", "cat": "Cases & Covers", "cost": 400, "sale": 1200, "qty": 45},
    {"name": "iPhone 15 Pro Tempered Glass", "cat": "Tempered Glass", "cost": 200, "sale": 1000, "qty": 100},
    {"name": "Samsung S24 Ultra Curved Glass", "cat": "Tempered Glass", "cost": 400, "sale": 1800, "qty": 80},
    {"name": "iPhone 13 Pro Max Display (OLED)", "cat": "Spare Parts", "cost": 45000, "sale": 65000, "qty": 4},
    {"name": "iPhone 11 Battery (Original)", "cat": "Spare Parts", "cost": 4500, "sale": 8500, "qty": 10},
    {"name": "Samsung A51 Display (In-cell)", "cat": "Spare Parts", "cost": 8000, "sale": 14000, "qty": 5},
    {"name": "Type-C Charging Port IC", "cat": "Spare Parts", "cost": 500, "sale": 2500, "qty": 30},
    {"name": "iPhone 12 Pro Camera Module", "cat": "Spare Parts", "cost": 15000, "sale": 25000, "qty": 2},
]

items_dict = {}
barcode_idx = 1000
for i, d in enumerate(inventory_data):
    it = InventoryItem(
        name=d["name"],
        category=d["cat"],
        sku=f"SKU-{100+i}",
        barcode=f"890100{barcode_idx}",
        quantity=d["qty"],
        cost_price=d["cost"],
        sale_price=d["sale"],
        low_stock_threshold=5,
        supplier_id=sup.id
    )
    db.add(it)
    barcode_idx += 1
db.commit()

for it in db.query(InventoryItem).all():
    items_dict[it.name] = it

print("Seeding Sales...")
now = datetime.utcnow()
for i in range(80):
    days_ago = random.randint(0, 30)
    created = now - timedelta(days=days_ago, hours=random.randint(1, 12))
    
    c_customer = random.choice(customers) if random.random() > 0.3 else None
    cart_items = random.sample(list(items_dict.values()), random.randint(1, 3))
    
    subtotal = 0
    lines = []
    for ci in cart_items:
        qty = random.randint(1, 2)
        price = ci.sale_price
        subtotal += price * qty
        lines.append(SaleItem(item_id=ci.id, quantity=qty, price=price, cost_price=ci.cost_price, warranty_days=random.choice([0, 30, 90])))
    
    discount = random.choice([0, 0, 0, 500, 1000])
    total = subtotal - discount
    pay_method = random.choice(["Cash", "Card", "Bank Transfer"])
    
    s = Sale(
        customer_id=c_customer.id if c_customer else None,
        subtotal=subtotal,
        discount_amount=discount,
        tax_amount=0,
        total=total,
        payment_method=pay_method,
        cash_amount=total if pay_method == "Cash" else 0,
        card_amount=total if pay_method == "Card" else 0,
        paid=True,
        created_at=created
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    
    for l in lines:
        l.sale_id = s.id
        db.add(l)
db.commit()

print("Seeding Repairs...")
repair_scenarios = [
    {"issue": "Broken Screen", "model": "iPhone 11", "parts": []},
    {"issue": "Battery draining fast", "model": "iPhone 11", "parts": ["iPhone 11 Battery (Original)"]},
    {"issue": "Not charging, port loose", "model": "Samsung S21", "parts": ["Type-C Charging Port IC"]},
    {"issue": "Water damage, doesn't turn on", "model": "Redmi Note 10", "parts": []},
    {"issue": "Camera blurry", "model": "iPhone 12 Pro", "parts": ["iPhone 12 Pro Camera Module"]},
]

statuses = ["Pending", "Diagnosing", "Waiting for Parts", "Repairing", "Completed", "Delivered"]

ticket_count = 1001
for i in range(25):
    days_ago = random.randint(0, 15)
    created = now - timedelta(days=days_ago)
    
    c_customer = random.choice(customers)
    scenario = random.choice(repair_scenarios)
    tech = random.choice(["Kasun Silva", "Chamara Fernando"])
    
    status = random.choice(statuses)
    
    r = RepairTicket(
        ticket_no=f"R-{ticket_count}",
        customer_id=c_customer.id,
        device_model=scenario["model"],
        imei=f"35{random.randint(1000000000000, 9999999999999)}",
        issue=scenario["issue"],
        status=status,
        priority=random.choice(["Normal", "Normal", "High", "Urgent"]),
        technician=tech,
        estimated_cost=random.randint(5000, 25000),
        advance_payment=random.choice([0, 0, 1000, 2000]),
        created_at=created,
        estimated_completion=created + timedelta(days=2)
    )
    
    if status == "Delivered":
        r.delivered_at = created + timedelta(days=3)
        
    db.add(r)
    db.commit()
    db.refresh(r)
    ticket_count += 1
    
    db.add(RepairHistory(repair_id=r.id, status="Intake", note="Device received", created_at=created))
    
    if status in ["Completed", "Delivered"] and scenario["parts"]:
        for p_name in scenario["parts"]:
            if p_name in items_dict:
                part_item = items_dict[p_name]
                ru = RepairPartUsage(repair_id=r.id, item_id=part_item.id, quantity=1, unit_cost=part_item.cost_price, created_at=created+timedelta(days=1))
                db.add(ru)
                
    db.commit()

print("Database seeding completed successfully!")
