from app.database import Base
from sqlalchemy import Column, Integer, String, Numeric, DateTime, Boolean, ForeignKey, Text


class ProductCategory(Base):
    __tablename__ = "product_categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(Text, nullable=True)


class Brand(Base):
    __tablename__ = "brands"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)


class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    sku = Column(String, unique=True, index=True, nullable=False)
    category_id = Column(Integer, ForeignKey("product_categories.id"), nullable=True)
    brand = Column(String, nullable=True)
    model = Column(String, nullable=True)
    storage = Column(String, nullable=True)
    color = Column(String, nullable=True)
    condition = Column(String, nullable=True)
    product_type = Column(String, nullable=True)
    location = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    quantity = Column(Integer, default=0)
    reorder_level = Column(Integer, default=5)
    cost_price = Column(Numeric(12, 2), default=0)
    selling_price = Column(Numeric(12, 2), default=0)
    wholesale_price = Column(Numeric(12, 2), default=0)
    warranty_days = Column(Integer, default=0)
    damaged_quantity = Column(Integer, default=0)
    is_draft = Column(Boolean, default=False)
    is_manual_creation = Column(Boolean, default=False)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    is_deleted = Column(Boolean, default=False)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, nullable=True)
    delete_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, nullable=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=True)


class InventorySerial(Base):
    __tablename__ = "inventory_serials"

    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False)
    serial_number = Column(String, unique=True, index=True, nullable=False)
    imei = Column(String, nullable=True)
    status = Column(String, default="in_stock")
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=True)
    created_at = Column(DateTime, nullable=True)
