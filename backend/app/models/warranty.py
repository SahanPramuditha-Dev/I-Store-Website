from app.database import Base
from sqlalchemy import Column, Integer, String, Numeric, DateTime, Boolean, ForeignKey, Text


class WarrantyRule(Base):
    __tablename__ = "warranty_rules"

    id = Column(Integer, primary_key=True, index=True)
    rule_type = Column(String, nullable=False)
    category_id = Column(Integer, ForeignKey("product_categories.id"), nullable=True)
    product_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=True)
    variant_id = Column(String, nullable=True)
    serial_id = Column(Integer, nullable=True)
    repair_service_id = Column(String, nullable=True)
    warranty_duration_value = Column(Integer, default=0)
    warranty_duration_unit = Column(String, default="days")
    coverage_type = Column(String, default="repair")
    priority = Column(Integer, default=100)
    conditions_text = Column(Text, nullable=True)
    exclusion_text = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    is_deleted = Column(Boolean, default=False)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, nullable=True)
    delete_reason = Column(Text, nullable=True)


class WarrantyRecord(Base):
    __tablename__ = "warranty_records"

    id = Column(Integer, primary_key=True, index=True)
    warranty_number = Column(String, unique=True, index=True, nullable=False)
    invoice_item_id = Column(Integer, nullable=True)
    warranty_rule_id = Column(Integer, ForeignKey("warranty_rules.id"), nullable=True)
    product_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=True)
    variant_id = Column(String, nullable=True)
    serial_id = Column(Integer, nullable=True)
    imei = Column(String, nullable=True)
    device_model = Column(String, nullable=True)
    coverage_type = Column(String, default="repair")
    warranty_days = Column(Integer, default=0)
    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime, nullable=False)
    status = Column(String, default="active")
    terms_summary = Column(Text, nullable=True)
    conditions_text = Column(Text, nullable=True)
    exclusion_text = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    is_voided = Column(Boolean, default=False)
    voided_at = Column(DateTime, nullable=True)
    voided_by = Column(Integer, nullable=True)
    void_reason = Column(Text, nullable=True)
    is_deleted = Column(Boolean, default=False)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, nullable=True)
    delete_reason = Column(Text, nullable=True)


class WarrantyClaim(Base):
    __tablename__ = "warranty_claims"

    id = Column(Integer, primary_key=True, index=True)
    claim_number = Column(String, unique=True, index=True, nullable=False)
    warranty_record_id = Column(Integer, ForeignKey("warranty_records.id"), nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    repair_ticket_id = Column(Integer, ForeignKey("repair_tickets.id"), nullable=True)
    claim_date = Column(DateTime, nullable=False)
    reported_issue = Column(Text, nullable=False)
    technician_notes = Column(Text, nullable=True)
    decision_status = Column(String, default="submitted")
    decision_notes = Column(Text, nullable=True)
    decided_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    decided_at = Column(DateTime, nullable=True)
    resolution_type = Column(String, nullable=True)
    approved_amount = Column(Numeric(12, 2), default=0)
    replacement_product_id = Column(Integer, nullable=True)
    replacement_serial_id = Column(Integer, nullable=True)
    replacement_imei = Column(String, nullable=True)
    fulfillment_status = Column(String, default="pending")
    fulfilled_at = Column(DateTime, nullable=True)
    fulfilled_by = Column(Integer, nullable=True)
    rejection_reason = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    is_deleted = Column(Boolean, default=False)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, nullable=True)
    delete_reason = Column(Text, nullable=True)
