from app.database import Base
from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey, Text


class RepairTicket(Base):
    __tablename__ = "repair_tickets"

    id = Column(Integer, primary_key=True, index=True)
    ticket_number = Column(String, unique=True, index=True, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    device_name = Column(String, nullable=False)
    device_model = Column(String, nullable=True)
    imei_serial = Column(String, nullable=True)
    problem_description = Column(Text, nullable=False)
    condition_notes = Column(Text, nullable=True)
    accessories = Column(Text, nullable=True)
    status = Column(String, default="received")
    priority = Column(String, default="normal")
    assigned_technician_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    assigned_at = Column(DateTime, nullable=True)
    estimate_status = Column(String, default="draft")
    approval_status = Column(String, default="pending")
    invoice_status = Column(String, default="not_invoiced")
    payment_status = Column(String, default="unpaid")
    delivery_status = Column(String, default="not_delivered")
    estimated_cost = Column(Numeric(12, 2), default=0)
    advance_payment = Column(Numeric(12, 2), default=0)
    outstanding_balance = Column(Numeric(12, 2), default=0)
    final_sale_id = Column(Integer, nullable=True)
    estimated_completion = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False)
    approved_at = Column(DateTime, nullable=True)
    invoiced_at = Column(DateTime, nullable=True)
    is_deleted = Column(Integer, default=0)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, nullable=True)
    delete_reason = Column(Text, nullable=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=True)


class RepairHistory(Base):
    __tablename__ = "repair_history"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("repair_tickets.id"), nullable=False)
    status = Column(String, nullable=False)
    notes = Column(Text, nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False)


class RepairEstimate(Base):
    __tablename__ = "repair_estimates"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("repair_tickets.id"), nullable=False)
    estimated_parts_cost = Column(Numeric(12, 2), default=0)
    estimated_labor_cost = Column(Numeric(12, 2), default=0)
    estimated_total = Column(Numeric(12, 2), default=0)
    advance_required_amount = Column(Numeric(12, 2), default=0)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False)
