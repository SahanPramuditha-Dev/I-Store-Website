"""Turnkey Industry Catalog Seeder Script for E-Store Ecosystem
Usage:
  python seed_industry_demos.py

Populates pre-configured test catalogues for:
  - Mobile Retail (Nexus Cellular & Repairs)
  - Grocery & Supermarket (GreenLife Supermarket)
  - Fashion & Apparel (Vogue Fashion Avenue)
"""

import os
import sys
from datetime import datetime, timedelta

# Append app paths
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.database import SessionLocal
from app.models import InventoryItem, ProductCategory, Brand, Organization

def seed_industry_catalogues():
    db = SessionLocal()
    print("🌱 Seeding Multi-Industry Catalogs into E-Store ERP...")

    try:
        # 1. Check or Create Organizations
        org = db.query(Organization).first()
        if not org:
            org = Organization(name="E-Store Enterprise Multi-Branch", industry_type="MOBILE_RETAIL")
            db.add(org)
            db.commit()

        # 2. Grocery Catalog
        grocery_cat = db.query(ProductCategory).filter(ProductCategory.name == "Fresh Produce & Grocery").first()
        if not grocery_cat:
            grocery_cat = ProductCategory(name="Fresh Produce & Grocery")
            db.add(grocery_cat)
            db.commit()

        grocery_items = [
            {
                "name": "Organic Red Cavendish Bananas",
                "sku": "GRO-BAN-001",
                "category": "Fresh Produce & Grocery",
                "unit_of_measure": "kg",
                "is_weighted": True,
                "allow_decimal_qty": True,
                "cost_price": 220.0,
                "sale_price": 350.0,
                "quantity": 85.500,
                "batch_number": "BAT-BAN-2026-08",
                "expiry_date": (datetime.now() + timedelta(days=5)).date(),
            },
            {
                "name": "Farm Fresh Pasteurized Milk 1L",
                "sku": "GRO-MLK-002",
                "category": "Fresh Produce & Grocery",
                "unit_of_measure": "pcs",
                "is_weighted": False,
                "allow_decimal_qty": False,
                "cost_price": 380.0,
                "sale_price": 460.0,
                "quantity": 40.0,
                "batch_number": "BAT-MLK-0822",
                "expiry_date": (datetime.now() + timedelta(days=12)).date(),
            },
            {
                "name": "Premium Basmati Rice 5kg",
                "sku": "GRO-RICE-003",
                "category": "Fresh Produce & Grocery",
                "unit_of_measure": "pcs",
                "is_weighted": False,
                "allow_decimal_qty": False,
                "cost_price": 1850.0,
                "sale_price": 2400.0,
                "quantity": 120.0,
                "batch_number": "BAT-RICE-2026",
                "expiry_date": (datetime.now() + timedelta(days=365)).date(),
            },
        ]

        for item_data in grocery_items:
            existing = db.query(InventoryItem).filter(InventoryItem.sku == item_data["sku"]).first()
            if not existing:
                db.add(InventoryItem(**item_data))

        # 3. Fashion Catalog
        fashion_cat = db.query(ProductCategory).filter(ProductCategory.name == "Apparel & Menswear").first()
        if not fashion_cat:
            fashion_cat = ProductCategory(name="Apparel & Menswear")
            db.add(fashion_cat)
            db.commit()

        fashion_items = [
            {
                "name": "Classic Oxford Cotton Shirt (M / Navy Blue)",
                "sku": "FSH-SHIRT-M-BLU",
                "category": "Apparel & Menswear",
                "brand": "Vogue Avenue",
                "storage": "M",
                "color": "Navy Blue",
                "model": "Summer 2026",
                "unit_of_measure": "pcs",
                "cost_price": 2800.0,
                "sale_price": 4500.0,
                "quantity": 25.0,
            },
            {
                "name": "Classic Oxford Cotton Shirt (L / White)",
                "sku": "FSH-SHIRT-L-WHT",
                "category": "Apparel & Menswear",
                "brand": "Vogue Avenue",
                "storage": "L",
                "color": "White",
                "model": "Summer 2026",
                "unit_of_measure": "pcs",
                "cost_price": 2800.0,
                "sale_price": 4500.0,
                "quantity": 30.0,
            },
        ]

        for item_data in fashion_items:
            existing = db.query(InventoryItem).filter(InventoryItem.sku == item_data["sku"]).first()
            if not existing:
                db.add(InventoryItem(**item_data))

        db.commit()
        print("✅ Multi-Industry seed completed successfully.")
    except Exception as e:
        db.rollback()
        print(f"❌ Seed failed: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    seed_industry_catalogues()
