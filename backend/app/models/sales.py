from app.database import Base
from sqlalchemy import Column, Integer, String, Numeric, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.orm import relationship


class Sale(Base):
    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, index=True)
    invoice_no = Column(String, unique=True, index=True, nullable=False)
    invoice_type = Column(String, default="product_sale")
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    repair_ticket_id = Column(Integer, nullable=True)
    reservation_id = Column(Integer, nullable=True)
    subtotal = Column(Numeric(12, 2), default=0)
    discount_total = Column(Numeric(12, 2), default=0)
    tax_total = Column(Numeric(12, 2), default=0)
    grand_total = Column(Numeric(12, 2), default=0)
    cash_amount = Column(Numeric(12, 2), default=0)
    card_amount = Column(Numeric(12, 2), default=0)
    amount_paid = Column(Numeric(12, 2), default=0)
    balance_due = Column(Numeric(12, 2), default=0)
    payment_status = Column(String, default="paid")
    payment_method = Column(String, default="Cash")
    advance_applied_total = Column(Numeric(12, 2), default=0)
    invoice_status = Column(String, default="finalized")
    is_return = Column(Boolean, default=False)
    paid = Column(Boolean, default=True)
    is_voided = Column(Boolean, default=False)
    void_reason = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False)
    finalized_at = Column(DateTime, nullable=True)
    voided_at = Column(DateTime, nullable=True)
    voided_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=True)

    items = relationship("SaleItem", back_populates="sale", cascade="all, delete-orphan")


class SaleItem(Base):
    __tablename__ = "sale_items"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    line_type = Column(String, default="product")
    item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=True)
    description = Column(String, nullable=True)
    variant_id = Column(String, nullable=True)
    serial_id = Column(Integer, nullable=True)
    serial_number = Column(String, nullable=True)
    quantity = Column(Integer, nullable=False, default=1)
    price = Column(Numeric(12, 2), nullable=False, default=0)
    discount_amount = Column(Numeric(12, 2), default=0)
    line_total = Column(Numeric(12, 2), default=0)
    cost_price = Column(Numeric(12, 2), default=0)
    warranty_rule_id = Column(Integer, nullable=True)
    warranty_record_id = Column(Integer, nullable=True)

    sale = relationship("Sale", back_populates="items")
