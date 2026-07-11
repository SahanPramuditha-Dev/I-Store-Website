#!/usr/bin/env python3
"""
Local API testing script to reproduce checkout and endpoint errors.
"""
import sys
import json
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

# Seed the database first
from app.seed import seed_data
from app.database import SessionLocal
from app.auth import create_access_token
from app.models import User
from datetime import timedelta

print("=" * 80)
print("SEEDING DATABASE")
print("=" * 80)
seed_data()
print("✓ Database seeded\n")

# Get a token for a demo user
db = SessionLocal()
user = db.query(User).filter(User.username == "nimal").first()
if user:
    token = create_access_token(
        {"sub": user.username, "uid": user.id, "role": "employee"},
        expires_delta=timedelta(hours=1)
    )
    print(f"✓ Generated token for user: {user.username}")
    print(f"  Token: {token[:50]}...\n")
else:
    print("✗ Demo user not found")
    sys.exit(1)

db.close()

# Now test endpoints via HTTP
import httpx

BASE_URL = "http://127.0.0.1:8000"
headers = {"Authorization": f"Bearer {token}"}

print("=" * 80)
print("TESTING GET ENDPOINTS (should return 401 without auth, or 200/500 with auth)")
print("=" * 80)

test_urls = [
    "/product-reservations",
    "/settings/section/store_profile",
    "/inventory/suppliers",
    "/inventory",
    "/repairs",
]

for url in test_urls:
    full_url = f"{BASE_URL}{url}"
    try:
        print(f"\nGET {url}")
        resp = httpx.get(full_url, headers=headers, timeout=10.0)
        print(f"  Status: {resp.status_code}")
        if resp.status_code >= 400:
            print(f"  Body: {resp.text[:500]}")
    except Exception as e:
        print(f"  ERROR: {e}")

print("\n" + "=" * 80)
print("TESTING POST /pos/checkout (minimal payload)")
print("=" * 80)

# Minimal checkout payload
# Item 1 (iPhone 15 Pro Screen) has sale_price=65000, cost_price=45000
# Customer required for invoices above 10000
# Mark as paid to avoid credit limit
checkout_payload = {
    "lines": [
        {
            "item_id": 1,
            "line_type": "product",
            "quantity": 1,
            "price": 65000.0,  # Use the sale_price from seed data
            "warranty_days": 0
        }
    ],
    "paid": True,  # Mark as paid to avoid credit limit
    "discount_amount": 0.0,
    "tax_amount": 0.0,
    "customer_id": 1,
    "payment_method": "cash",
    "cash_amount": 65000.0
}

try:
    print(f"\nPOST /pos/checkout")
    print(f"  Payload: {json.dumps(checkout_payload, indent=2)}")
    resp = httpx.post(
        f"{BASE_URL}/pos/checkout",
        json=checkout_payload,
        headers=headers,
        timeout=10.0
    )
    print(f"  Status: {resp.status_code}")
    print(f"  Body:")
    try:
        body = resp.json()
        print(f"    {json.dumps(body, indent=4)}")
    except:
        print(f"    {resp.text[:1000]}")
except Exception as e:
    print(f"  ERROR: {e}")

print("\n" + "=" * 80)
print("DONE")
print("=" * 80)
