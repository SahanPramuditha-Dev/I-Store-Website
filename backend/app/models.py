from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, DateTime, Date, Boolean, ForeignKey, Text, CheckConstraint, UniqueConstraint, event
from sqlalchemy.orm import relationship
from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    full_name = Column(String)
    password_hash = Column(String)
    role = Column(String, default="cashier")
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=True, index=True)
    pin_hash = Column(String, nullable=True)
    phone_number = Column(String, nullable=True, index=True)
    email = Column(String, nullable=True, index=True)
    profile_photo = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    failed_login_count = Column(Integer, default=0)
    account_locked_until = Column(DateTime, nullable=True, index=True)
    last_login_at = Column(DateTime, nullable=True, index=True)
    last_password_change_at = Column(DateTime, nullable=True)
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
    is_active = Column(Boolean, default=True)

    assigned_role = relationship("Role", foreign_keys=[role_id])


class Role(Base):
    __tablename__ = "roles"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)  # owner/admin/manager/cashier/technician
    display_name = Column(String, nullable=False)
    level = Column(Integer, default=1, index=True)
    description = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    is_system_role = Column(Boolean, default=True, index=True)
    is_locked = Column(Boolean, default=False, index=True)
    is_system = Column(Boolean, default=True, index=True)
    is_protected = Column(Boolean, default=False, index=True)
    is_active = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class Permission(Base):
    __tablename__ = "permissions"
    id = Column(Integer, primary_key=True, index=True)
    permission_key = Column(String, unique=True, index=True, nullable=True)
    code = Column(String, unique=True, index=True)  # e.g. inventory.view
    module = Column(String, index=True)  # e.g. inventory
    action = Column(String, index=True)  # e.g. view
    label = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    is_sensitive = Column(Boolean, default=False, index=True)
    is_active = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, default=utcnow, index=True)

    __table_args__ = (
        UniqueConstraint("module", "action", name="uq_permissions_module_action"),
    )


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (
        UniqueConstraint("role_id", "permission_id", name="uq_role_permissions_role_permission"),
    )

    id = Column(Integer, primary_key=True, index=True)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False, index=True)
    permission_id = Column(Integer, ForeignKey("permissions.id"), nullable=False, index=True)
    allowed = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, index=True)

    role = relationship("Role", foreign_keys=[role_id])
    permission = relationship("Permission", foreign_keys=[permission_id])


class UserPermissionOverride(Base):
    __tablename__ = "user_permission_overrides"
    __table_args__ = (
        UniqueConstraint("user_id", "permission_id", name="uq_user_permission_overrides_user_permission"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    permission_id = Column(Integer, ForeignKey("permissions.id"), nullable=False, index=True)
    override_type = Column(String, default="allow", index=True)  # allow | deny
    effect = Column(String, default="allow", index=True)  # allow | deny
    reason = Column(Text, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, index=True)

    user = relationship("User", foreign_keys=[user_id])
    permission = relationship("Permission", foreign_keys=[permission_id])
    created_by = relationship("User", foreign_keys=[created_by_user_id])


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_code = Column(String, unique=True, index=True)
    session_token_hash = Column(String, nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token_jti = Column(String, unique=True, index=True)
    device_name = Column(String, nullable=True)
    device_info = Column(String, nullable=True)
    ip_address = Column(String, nullable=True, index=True)
    location = Column(String, nullable=True)
    login_method = Column(String, default="password", index=True)
    login_at = Column(DateTime, nullable=True, index=True)
    login_time = Column(DateTime, default=utcnow, index=True)
    last_seen_at = Column(DateTime, default=utcnow, index=True)
    expires_at = Column(DateTime, nullable=True, index=True)
    is_active = Column(Boolean, default=True, index=True)
    is_current = Column(Boolean, default=True, index=True)
    is_suspicious = Column(Boolean, default=False, index=True)
    revoked_at = Column(DateTime, nullable=True, index=True)
    revoked_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    revoked_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    revoke_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)

    user = relationship("User", foreign_keys=[user_id])
    revoked_by = relationship("User", foreign_keys=[revoked_by_user_id])


class LoginAttempt(Base):
    __tablename__ = "login_attempts"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    login_method = Column(String, default="password", index=True)
    ip_address = Column(String, nullable=True, index=True)
    device_info = Column(String, nullable=True)
    attempted_at = Column(DateTime, default=utcnow, index=True)
    success = Column(Boolean, default=False, index=True)
    failure_reason = Column(Text, nullable=True)

    user = relationship("User", foreign_keys=[user_id])


class SecurityAuditLog(Base):
    __tablename__ = "security_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    action = Column(String, index=True)  # login/logout/failed_login/password_reset/etc
    target_type = Column(String, nullable=True, index=True)
    target_id = Column(Integer, nullable=True, index=True)
    target_ref = Column(String, nullable=True, index=True)
    detail = Column(Text, nullable=True)
    ip_address = Column(String, nullable=True, index=True)
    device_info = Column(String, nullable=True)
    result = Column(String, default="success", index=True)  # success|failed|blocked
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)

    user = relationship("User", foreign_keys=[user_id])


class PermissionChangeLog(Base):
    __tablename__ = "permission_change_logs"

    id = Column(Integer, primary_key=True, index=True)
    changed_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    target_type = Column(String, nullable=False, index=True)  # role | user
    target_id = Column(Integer, nullable=False, index=True)
    permission_id = Column(Integer, ForeignKey("permissions.id"), nullable=True, index=True)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    reason = Column(Text, nullable=True)
    session_id = Column(String, nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow, index=True)

    changed_by_user = relationship("User", foreign_keys=[changed_by])
    permission = relationship("Permission", foreign_keys=[permission_id])


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    module = Column(String, nullable=False, index=True)
    action = Column(String, nullable=False, index=True)
    target_type = Column(String, nullable=True, index=True)
    target_id = Column(Integer, nullable=True, index=True)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    ip_address = Column(String, nullable=True, index=True)
    device_name = Column(String, nullable=True)
    session_id = Column(String, nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow, index=True)

    user = relationship("User", foreign_keys=[user_id])


class SecuritySetting(Base):
    __tablename__ = "security_settings"
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, index=True)
    value = Column(Text, default="")
    updated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, index=True)

    updated_by = relationship("User")

class Customer(Base):
    __tablename__ = "customers"
    id = Column(Integer, primary_key=True)
    name = Column(String, index=True)
    phone = Column(String, index=True)
    email = Column(String, nullable=True)
    address = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    birthday = Column(Date, nullable=True)
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True, index=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    delete_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, index=True)

class Supplier(Base):
    __tablename__ = "suppliers"
    id = Column(Integer, primary_key=True)
    name = Column(String)
    contact = Column(String)
    email = Column(String, nullable=True)
    address = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    payment_terms_days = Column(Integer, default=0)
    opening_balance = Column(Float, default=0)
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True, index=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    delete_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, index=True)
    ledger_entries = relationship("SupplierLedgerEntry", back_populates="supplier", cascade="all, delete-orphan")

class ProductCategory(Base):
    __tablename__ = "product_categories"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, index=True)
    icon_url = Column(String, nullable=True)
    parent_id = Column(Integer, ForeignKey("product_categories.id"), nullable=True)
    is_active = Column(Boolean, default=True)

class Brand(Base):
    __tablename__ = "brands"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, index=True)
    logo_url = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)

class InventoryItem(Base):
    __tablename__ = "inventory_items"
    __table_args__ = (
        CheckConstraint("quantity >= 0", name="ck_inventory_items_quantity_non_negative"),
    )
    id = Column(Integer, primary_key=True)
    name = Column(String, index=True)
    category = Column(String, index=True)
    brand = Column(String, nullable=True, index=True)
    model = Column(String, nullable=True, index=True)
    storage = Column(String, nullable=True)
    color = Column(String, nullable=True)
    condition = Column(String, nullable=True)  # New, Used, Refurbished
    product_type = Column(String, nullable=True)  # Retail, Spare Parts, Service
    location = Column(String, nullable=True)  # shelf/bin
    image_url = Column(String, nullable=True)
    warranty_days = Column(Integer, default=0)
    sku = Column(String, unique=True)
    barcode = Column(String, nullable=True)
    quantity = Column(Integer, default=0)
    damaged_quantity = Column(Integer, default=0)
    cost_price = Column(Float, default=0)
    sale_price = Column(Float, default=0)
    low_stock_threshold = Column(Integer, default=5)
    has_serials = Column(Boolean, default=False)
    is_draft = Column(Boolean, default=False, index=True)
    is_manual_creation = Column(Boolean, default=False, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True, index=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    delete_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, index=True)
    supplier = relationship("Supplier")

class InventorySerial(Base):
    __tablename__ = "inventory_serials"
    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey("inventory_items.id"))
    serial_number = Column(String, unique=True, index=True)
    status = Column(String, default="in_stock", index=True)  # in_stock, sold, reserved, returned, damaged, voided
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=True)
    created_at = Column(DateTime, default=utcnow)
    item = relationship("InventoryItem")

class RepairTicket(Base):
    __tablename__ = "repair_tickets"
    id = Column(Integer, primary_key=True)
    ticket_no = Column(String, unique=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"))
    device_model = Column(String)
    imei = Column(String, index=True)
    condition_notes = Column(Text, nullable=True)
    issue = Column(Text)
    accessories = Column(Text, nullable=True)
    status = Column(String, default="pending", index=True)
    priority = Column(String, default="Normal") # Low, Normal, High, Urgent
    warranty_status = Column(String, default="None")
    technician = Column(String, nullable=True)
    assigned_technician_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    assigned_at = Column(DateTime, nullable=True, index=True)
    estimate_status = Column(String, default="draft", index=True)
    approval_status = Column(String, default="pending", index=True)
    invoice_status = Column(String, default="not_invoiced", index=True)
    payment_status = Column(String, default="unpaid", index=True)
    delivery_status = Column(String, default="not_delivered", index=True)
    estimated_cost = Column(Float, default=0)
    advance_payment = Column(Float, default=0)
    outstanding_balance = Column(Float, default=0)
    final_sale_id = Column(Integer, ForeignKey("sales.id"), nullable=True, index=True)
    approved_at = Column(DateTime, nullable=True, index=True)
    invoiced_at = Column(DateTime, nullable=True, index=True)
    notes = Column(Text, default="")
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True, index=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    delete_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    estimated_completion = Column(DateTime, nullable=True)
    delivered_at = Column(DateTime, nullable=True)
    customer = relationship("Customer")
    assigned_technician = relationship("User", foreign_keys=[assigned_technician_user_id])
    final_sale = relationship("Sale", foreign_keys=[final_sale_id])
    parts_usage = relationship("RepairPartUsage", back_populates="repair", cascade="all, delete-orphan")
    history = relationship("RepairHistory", back_populates="repair", cascade="all, delete-orphan")

class RepairHistory(Base):
    __tablename__ = "repair_history"
    id = Column(Integer, primary_key=True)
    repair_id = Column(Integer, ForeignKey("repair_tickets.id"))
    status = Column(String)
    note = Column(String, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    repair = relationship("RepairTicket", back_populates="history")


class RepairEstimate(Base):
    __tablename__ = "repair_estimates"
    __table_args__ = (
        UniqueConstraint("repair_ticket_id", name="uq_repair_estimates_repair_ticket_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    repair_ticket_id = Column(Integer, ForeignKey("repair_tickets.id"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    estimated_parts_cost = Column(Float, default=0)
    estimated_labor_cost = Column(Float, default=0)
    estimated_total = Column(Float, default=0, index=True)
    advance_required = Column(Boolean, default=False)
    advance_required_amount = Column(Float, default=0)
    approval_status = Column(String, default="pending", index=True)  # pending | approved | rejected
    notes = Column(Text, nullable=True)
    approved_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    repair_ticket = relationship("RepairTicket")
    customer = relationship("Customer")
    creator = relationship("User", foreign_keys=[created_by])


class Sale(Base):
    __tablename__ = "sales"
    id = Column(Integer, primary_key=True)
    invoice_no = Column(String, unique=True, index=True, nullable=True)
    invoice_type = Column(String, default="product_sale", index=True)  # product_sale | repair_invoice | reservation_invoice | exchange_invoice
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    repair_ticket_id = Column(Integer, ForeignKey("repair_tickets.id"), nullable=True, index=True)
    reservation_id = Column(Integer, ForeignKey("product_reservations.id"), nullable=True, index=True)
    subtotal = Column(Float, default=0)
    discount_amount = Column(Float, default=0)
    tax_amount = Column(Float, default=0)
    total = Column(Float, default=0)
    advance_applied_total = Column(Float, default=0)
    is_return = Column(Boolean, default=False)
    original_sale_id = Column(Integer, ForeignKey("sales.id"), nullable=True)
    payment_method = Column(String, default="Cash") # Cash, Card, Bank Transfer, Multiple
    cash_amount = Column(Float, default=0)
    card_amount = Column(Float, default=0)
    amount_paid = Column(Float, default=0)
    balance_due = Column(Float, default=0)
    payment_status = Column(String, default="paid", index=True)
    invoice_status = Column(String, default="finalized", index=True)  # draft | finalized | voided | refunded | partially_refunded
    paid = Column(Boolean, default=True)
    is_voided = Column(Boolean, default=False)
    void_reason = Column(String, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    finalized_at = Column(DateTime, nullable=True, index=True)
    voided_at = Column(DateTime, nullable=True, index=True)
    voided_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    customer = relationship("Customer")
    reservation = relationship("ProductReservation", foreign_keys=[reservation_id])
    creator = relationship("User", foreign_keys=[created_by])
    voider = relationship("User", foreign_keys=[voided_by])

class SaleItem(Base):
    __tablename__ = "sale_items"
    id = Column(Integer, primary_key=True)
    sale_id = Column(Integer, ForeignKey("sales.id"))
    item_id = Column(Integer, ForeignKey("inventory_items.id"), index=True, nullable=True)
    variant_id = Column(String, nullable=True, index=True)
    serial_id = Column(Integer, ForeignKey("inventory_serials.id"), nullable=True, index=True)
    line_type = Column(String, default="product", index=True)  # product | spare_part | labor | service | discount | adjustment
    description = Column(Text, nullable=True)
    quantity = Column(Integer)
    price = Column(Float)
    discount_amount = Column(Float, default=0)
    line_total = Column(Float, default=0)
    cost_price = Column(Float, default=0)
    warranty_days = Column(Integer, default=0)
    warranty_rule_id = Column(Integer, ForeignKey("warranty_rules.id"), nullable=True, index=True)
    warranty_record_id = Column(Integer, ForeignKey("warranty_records.id"), nullable=True, index=True)
    serial_number = Column(String, nullable=True)

    serial = relationship("InventorySerial", foreign_keys=[serial_id])
    warranty_rule = relationship("WarrantyRule", foreign_keys=[warranty_rule_id])
    warranty_record = relationship("WarrantyRecord", foreign_keys=[warranty_record_id])


class ProductReservation(Base):
    __tablename__ = "product_reservations"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_product_reservations_quantity_positive"),
    )

    id = Column(Integer, primary_key=True, index=True)
    reservation_number = Column(String, unique=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=True, index=True)
    variant_id = Column(String, nullable=True, index=True)
    serial_id = Column(Integer, ForeignKey("inventory_serials.id"), nullable=True, index=True)
    requested_product_name = Column(String, nullable=True)
    reservation_type = Column(String, default="in_stock_reservation", index=True)
    quantity = Column(Integer, default=1)
    estimated_total = Column(Float, default=0)
    advance_required = Column(Boolean, default=False)
    advance_required_amount = Column(Float, default=0)
    advance_paid_total = Column(Float, default=0)
    balance_due = Column(Float, default=0)
    status = Column(String, default="draft", index=True)
    expected_arrival_date = Column(DateTime, nullable=True, index=True)
    expiry_date = Column(DateTime, nullable=True, index=True)
    notes = Column(Text, nullable=True)
    linked_invoice_id = Column(Integer, ForeignKey("sales.id"), nullable=True, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, index=True)

    customer = relationship("Customer")
    product = relationship("InventoryItem", foreign_keys=[product_id])
    serial = relationship("InventorySerial", foreign_keys=[serial_id])
    linked_invoice = relationship("Sale", foreign_keys=[linked_invoice_id])
    creator = relationship("User", foreign_keys=[created_by])


class AdvancePayment(Base):
    __tablename__ = "advance_payments"

    id = Column(Integer, primary_key=True, index=True)
    advance_number = Column(String, unique=True, index=True)
    advance_type = Column(String, default="other", index=True)  # repair | product_reservation | product_order | spare_part_order | other
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    repair_ticket_id = Column(Integer, ForeignKey("repair_tickets.id"), nullable=True, index=True)
    product_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=True, index=True)
    reservation_id = Column(Integer, ForeignKey("product_reservations.id"), nullable=True, index=True)
    estimate_id = Column(Integer, ForeignKey("repair_estimates.id"), nullable=True, index=True)
    invoice_id = Column(Integer, ForeignKey("sales.id"), nullable=True, index=True)
    amount = Column(Float, default=0)
    applied_amount = Column(Float, default=0)
    refunded_amount = Column(Float, default=0)
    payment_method = Column(String, default="cash")
    payment_date = Column(DateTime, default=utcnow, index=True)
    status = Column(String, default="received", index=True)  # received | partially_applied | applied | refunded | partially_refunded | cancelled
    notes = Column(Text, nullable=True)
    cancellation_reason = Column(Text, nullable=True)
    refund_reason = Column(Text, nullable=True)
    manager_override_used = Column(Boolean, default=False)
    received_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    is_deleted = Column(Boolean, default=False, index=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, index=True)

    customer = relationship("Customer")
    repair_ticket = relationship("RepairTicket")
    product_order = relationship("PurchaseOrder")
    reservation = relationship("ProductReservation")
    estimate = relationship("RepairEstimate")
    invoice = relationship("Sale")
    receiver = relationship("User", foreign_keys=[received_by])


class InvoicePayment(Base):
    __tablename__ = "invoice_payments"
    __table_args__ = (
        CheckConstraint("amount >= 0", name="ck_invoice_payments_amount_non_negative"),
    )

    id = Column(Integer, primary_key=True, index=True)
    payment_number = Column(String, unique=True, index=True, nullable=True)
    invoice_id = Column(Integer, ForeignKey("sales.id"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    amount = Column(Float, default=0)
    payment_method = Column(String, default="cash")
    payment_type = Column(String, default="normal", index=True)  # normal | advance_applied | balance_payment | refund | store_credit
    reference_number = Column(String, nullable=True, index=True)
    linked_advance_payment_id = Column(Integer, ForeignKey("advance_payments.id"), nullable=True, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    received_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    invoice = relationship("Sale")
    customer = relationship("Customer")
    linked_advance_payment = relationship("AdvancePayment")
    receiver = relationship("User", foreign_keys=[received_by])


class InvoiceAuditEvent(Base):
    __tablename__ = "invoice_audit_events"

    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("sales.id"), nullable=False, index=True)
    event_type = Column(String, nullable=False, index=True)
    event_message = Column(Text, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow, index=True)

    invoice = relationship("Sale", foreign_keys=[invoice_id])
    user = relationship("User", foreign_keys=[user_id])


class ReturnRecord(Base):
    __tablename__ = "return_records"
    id = Column(Integer, primary_key=True, index=True)
    return_code = Column(String, unique=True, index=True)
    return_type = Column(String, default="Product Return", index=True)  # Product Return | Product Exchange | Refund | Warranty Replacement
    original_sale_id = Column(Integer, ForeignKey("sales.id"), index=True)
    original_sale_item_id = Column(Integer, ForeignKey("sale_items.id"), index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    customer_name = Column(String, nullable=False)
    customer_phone = Column(String, nullable=True, index=True)
    item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=True, index=True)
    product_name = Column(String, nullable=False)
    sku_barcode = Column(String, nullable=True)
    serial_number = Column(String, nullable=True, index=True)
    quantity = Column(Integer, default=1)
    return_reason = Column(String, nullable=False)
    item_condition = Column(String, default="Reusable", index=True)  # Reusable | Damaged
    inspection_note = Column(Text, nullable=True)
    staff_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    refund_approved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    decision_status = Column(String, default="Pending Inspection", index=True)  # Pending Inspection | Approved | Rejected | Refunded | Exchanged | Closed
    refund_amount = Column(Float, default=0)
    refund_method = Column(String, nullable=True)  # Cash | Card | Bank Transfer
    replacement_item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=True, index=True)
    replacement_item_name = Column(String, nullable=True)
    replacement_quantity = Column(Integer, default=0)
    inventory_applied = Column(Boolean, default=False)
    payment_applied = Column(Boolean, default=False)
    closed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    sale = relationship("Sale", foreign_keys=[original_sale_id])
    sale_item = relationship("SaleItem", foreign_keys=[original_sale_item_id])
    customer = relationship("Customer")
    item = relationship("InventoryItem", foreign_keys=[item_id])
    replacement_item = relationship("InventoryItem", foreign_keys=[replacement_item_id])
    staff_user = relationship("User", foreign_keys=[staff_user_id])
    approved_by = relationship("User", foreign_keys=[approved_by_user_id])
    refund_approved_by = relationship("User", foreign_keys=[refund_approved_by_user_id])
    damaged_logs = relationship("DamagedStockLog", back_populates="return_record", cascade="all, delete-orphan")


class DamagedStockLog(Base):
    __tablename__ = "damaged_stock_logs"
    id = Column(Integer, primary_key=True, index=True)
    return_record_id = Column(Integer, ForeignKey("return_records.id"), index=True)
    item_id = Column(Integer, ForeignKey("inventory_items.id"), index=True)
    quantity = Column(Integer, default=0)
    reason = Column(String, nullable=False)
    note = Column(Text, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)

    return_record = relationship("ReturnRecord", back_populates="damaged_logs")
    item = relationship("InventoryItem")
    created_by = relationship("User")


class Return(Base):
    __tablename__ = "returns"
    __table_args__ = (
        CheckConstraint("total_return_amount >= 0", name="ck_returns_total_return_amount_non_negative"),
        CheckConstraint("refund_amount >= 0", name="ck_returns_refund_amount_non_negative"),
        CheckConstraint("store_credit_amount >= 0", name="ck_returns_store_credit_amount_non_negative"),
    )

    id = Column(Integer, primary_key=True, index=True)
    return_number = Column(String, unique=True, index=True)
    original_invoice_id = Column(Integer, ForeignKey("sales.id"), nullable=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    warranty_claim_id = Column(Integer, ForeignKey("warranty_claims.id"), nullable=True, index=True)
    return_type = Column(String, default="return", index=True)  # return | refund | exchange | warranty_replacement | store_credit
    reason = Column(String, nullable=False, index=True)
    notes = Column(Text, nullable=True)
    inspection_status = Column(String, default="pending_inspection", index=True)  # pending_inspection | inspected | approved | rejected
    decision_status = Column(String, default="pending", index=True)  # pending | approved | rejected | refunded | exchanged | closed | cancelled
    refund_status = Column(String, default="none", index=True)  # none | pending | partial_refund | full_refund | completed
    total_return_amount = Column(Float, default=0)
    refund_amount = Column(Float, default=0)
    store_credit_amount = Column(Float, default=0)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    rejected_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    processed_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, index=True)
    closed_at = Column(DateTime, nullable=True, index=True)

    original_invoice = relationship("Sale", foreign_keys=[original_invoice_id])
    customer = relationship("Customer", foreign_keys=[customer_id])
    warranty_claim = relationship("WarrantyClaim", foreign_keys=[warranty_claim_id])
    approver = relationship("User", foreign_keys=[approved_by])
    rejector = relationship("User", foreign_keys=[rejected_by])
    processor = relationship("User", foreign_keys=[processed_by])
    items = relationship("ReturnItem", back_populates="return_case", cascade="all, delete-orphan")
    refund_payments = relationship("RefundPayment", back_populates="return_case", cascade="all, delete-orphan")
    exchange_records = relationship("ExchangeRecord", back_populates="return_case", cascade="all, delete-orphan")
    store_credits = relationship("StoreCredit", back_populates="return_case")


class ReturnItem(Base):
    __tablename__ = "return_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_return_items_quantity_positive"),
        CheckConstraint("unit_price >= 0", name="ck_return_items_unit_price_non_negative"),
        CheckConstraint("return_amount >= 0", name="ck_return_items_return_amount_non_negative"),
    )

    id = Column(Integer, primary_key=True, index=True)
    return_id = Column(Integer, ForeignKey("returns.id"), nullable=False, index=True)
    original_invoice_item_id = Column(Integer, ForeignKey("sale_items.id"), nullable=True, index=True)
    product_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False, index=True)
    variant_id = Column(String, nullable=True, index=True)
    serial_id = Column(Integer, ForeignKey("inventory_serials.id"), nullable=True, index=True)
    imei = Column(String, nullable=True, index=True)
    quantity = Column(Integer, default=1)
    unit_price = Column(Float, default=0)
    return_amount = Column(Float, default=0)
    item_condition = Column(String, default="sellable", index=True)  # sellable | damaged | opened | defective | missing_parts
    restock_action = Column(String, default="restock", index=True)  # restock | damaged_stock | scrap | return_to_supplier | no_stock_change
    replacement_product_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=True, index=True)
    replacement_serial_id = Column(Integer, ForeignKey("inventory_serials.id"), nullable=True, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)

    return_case = relationship("Return", back_populates="items")
    original_invoice_item = relationship("SaleItem", foreign_keys=[original_invoice_item_id])
    product = relationship("InventoryItem", foreign_keys=[product_id])
    serial = relationship("InventorySerial", foreign_keys=[serial_id])
    replacement_product = relationship("InventoryItem", foreign_keys=[replacement_product_id])
    replacement_serial = relationship("InventorySerial", foreign_keys=[replacement_serial_id])
    damaged_records = relationship("DamagedStockRecord", back_populates="return_item", cascade="all, delete-orphan")


class RefundPayment(Base):
    __tablename__ = "refund_payments"
    __table_args__ = (
        CheckConstraint("refund_amount >= 0", name="ck_refund_payments_refund_amount_non_negative"),
    )

    id = Column(Integer, primary_key=True, index=True)
    refund_number = Column(String, unique=True, index=True)
    return_id = Column(Integer, ForeignKey("returns.id"), nullable=False, index=True)
    original_payment_id = Column(Integer, ForeignKey("invoice_payments.id"), nullable=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    refund_amount = Column(Float, default=0)
    refund_method = Column(String, default="cash", index=True)  # cash | card | bank_transfer | store_credit
    refund_status = Column(String, default="pending", index=True)  # pending | approved | paid | cancelled
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    paid_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    paid_at = Column(DateTime, nullable=True, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)

    return_case = relationship("Return", back_populates="refund_payments")
    original_payment = relationship("InvoicePayment", foreign_keys=[original_payment_id])
    customer = relationship("Customer", foreign_keys=[customer_id])
    approver = relationship("User", foreign_keys=[approved_by])
    payer = relationship("User", foreign_keys=[paid_by])


class StoreCredit(Base):
    __tablename__ = "store_credits"
    __table_args__ = (
        CheckConstraint("amount >= 0", name="ck_store_credits_amount_non_negative"),
        CheckConstraint("remaining_amount >= 0", name="ck_store_credits_remaining_non_negative"),
    )

    id = Column(Integer, primary_key=True, index=True)
    credit_number = Column(String, unique=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    return_id = Column(Integer, ForeignKey("returns.id"), nullable=True, index=True)
    amount = Column(Float, default=0)
    remaining_amount = Column(Float, default=0)
    status = Column(String, default="active", index=True)  # active | used | expired | cancelled
    expiry_date = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    customer = relationship("Customer", foreign_keys=[customer_id])
    return_case = relationship("Return", back_populates="store_credits")
    creator = relationship("User", foreign_keys=[created_by])


class ExchangeRecord(Base):
    __tablename__ = "exchange_records"

    id = Column(Integer, primary_key=True, index=True)
    exchange_number = Column(String, unique=True, index=True, nullable=True)
    return_id = Column(Integer, ForeignKey("returns.id"), nullable=False, index=True)
    old_invoice_item_id = Column(Integer, ForeignKey("sale_items.id"), nullable=False, index=True)
    old_product_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False, index=True)
    new_product_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False, index=True)
    new_invoice_id = Column(Integer, ForeignKey("sales.id"), nullable=True, index=True)
    price_difference = Column(Float, default=0)
    balance_to_pay = Column(Float, default=0)
    balance_to_refund = Column(Float, default=0)
    created_at = Column(DateTime, default=utcnow, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    return_case = relationship("Return", back_populates="exchange_records")
    old_invoice_item = relationship("SaleItem", foreign_keys=[old_invoice_item_id])
    old_product = relationship("InventoryItem", foreign_keys=[old_product_id])
    new_product = relationship("InventoryItem", foreign_keys=[new_product_id])
    new_invoice = relationship("Sale", foreign_keys=[new_invoice_id])
    creator = relationship("User", foreign_keys=[created_by])


class DamagedStockRecord(Base):
    __tablename__ = "damaged_stock_records"

    id = Column(Integer, primary_key=True, index=True)
    return_item_id = Column(Integer, ForeignKey("return_items.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False, index=True)
    serial_id = Column(Integer, ForeignKey("inventory_serials.id"), nullable=True, index=True)
    quantity = Column(Integer, default=1)
    damage_reason = Column(String, nullable=False)
    action = Column(String, default="hold", index=True)  # hold | repair | scrap | return_to_supplier
    created_at = Column(DateTime, default=utcnow, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    return_item = relationship("ReturnItem", back_populates="damaged_records")
    product = relationship("InventoryItem", foreign_keys=[product_id])
    serial = relationship("InventorySerial", foreign_keys=[serial_id])
    creator = relationship("User", foreign_keys=[created_by])


class WarrantyRule(Base):
    __tablename__ = "warranty_rules"
    id = Column(Integer, primary_key=True, index=True)
    rule_name = Column(String, nullable=False)
    scope_type = Column(String, nullable=False, index=True)  # product_category | repair_service | spare_part | product
    scope_value = Column(String, nullable=False, default="*")
    warranty_days = Column(Integer, default=0)
    description = Column(Text, nullable=True)
    # New normalized rule system (keeps legacy scope_* fields for compatibility)
    rule_type = Column(String, nullable=True, index=True)  # category | product | variant | serial | repair_service | global
    category_id = Column(Integer, nullable=True, index=True)
    product_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=True, index=True)
    variant_id = Column(String, nullable=True, index=True)
    serial_id = Column(Integer, ForeignKey("inventory_serials.id"), nullable=True, index=True)
    repair_service_id = Column(String, nullable=True, index=True)
    warranty_duration_value = Column(Integer, default=0)
    warranty_duration_unit = Column(String, default="days")  # days | months | years
    coverage_type = Column(String, default="repair")  # repair | replacement | service_only | no_warranty
    priority = Column(Integer, default=100, index=True)
    conditions_text = Column(Text, nullable=True)
    exclusion_text = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    is_active = Column(Boolean, default=True, index=True)
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True, index=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    delete_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class WarrantyCondition(Base):
    __tablename__ = "warranty_conditions"
    id = Column(Integer, primary_key=True, index=True)
    condition_code = Column(String, unique=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    is_covered = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=utcnow)


class WarrantyRecord(Base):
    __tablename__ = "warranty_records"
    id = Column(Integer, primary_key=True, index=True)
    warranty_code = Column(String, unique=True, index=True)
    warranty_number = Column(String, nullable=True, unique=True, index=True)
    invoice_id = Column(Integer, ForeignKey("sales.id"), nullable=True, index=True)
    invoice_item_id = Column(Integer, ForeignKey("sale_items.id"), nullable=True, index=True)
    repair_ticket_id = Column(Integer, ForeignKey("repair_tickets.id"), nullable=True, index=True)
    sale_item_id = Column(Integer, ForeignKey("sale_items.id"), nullable=True, index=True)
    warranty_rule_id = Column(Integer, ForeignKey("warranty_rules.id"), nullable=True, index=True)
    product_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=True, index=True)
    variant_id = Column(String, nullable=True, index=True)
    serial_id = Column(Integer, ForeignKey("inventory_serials.id"), nullable=True, index=True)
    item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    customer_name = Column(String, nullable=False, default="Walk-in")
    customer_phone = Column(String, nullable=True, index=True)
    product_or_service_name = Column(String, nullable=False)
    product_category = Column(String, nullable=True, index=True)
    brand = Column(String, nullable=True, index=True)
    supplier_name = Column(String, nullable=True, index=True)
    device_brand_model = Column(String, nullable=True)
    imei = Column(String, nullable=True, index=True)
    imei_or_serial = Column(String, nullable=True, index=True)
    serial_number = Column(String, nullable=True, index=True)
    warranty_type = Column(String, nullable=False, index=True)  # product | repair | replacement | manual_exception
    start_date = Column(DateTime, nullable=False, index=True)
    end_date = Column(DateTime, nullable=False, index=True)
    status = Column(String, default="active", index=True)  # active | expired | claimed | rejected | replaced | voided | cancelled
    coverage_type = Column(String, default="repair", index=True)
    quantity_covered = Column(Integer, default=1)
    warranty_days = Column(Integer, default=0)
    conditions_json = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True, index=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    delete_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    customer = relationship("Customer", foreign_keys=[customer_id])
    item = relationship("InventoryItem", foreign_keys=[item_id])
    product = relationship("InventoryItem", foreign_keys=[product_id])
    sale = relationship("Sale", foreign_keys=[invoice_id])
    invoice_item = relationship("SaleItem", foreign_keys=[invoice_item_id])
    sale_item = relationship("SaleItem", foreign_keys=[sale_item_id])
    rule = relationship("WarrantyRule", foreign_keys=[warranty_rule_id])
    serial = relationship("InventorySerial", foreign_keys=[serial_id])
    repair_ticket = relationship("RepairTicket", foreign_keys=[repair_ticket_id])
    claims = relationship("WarrantyClaim", back_populates="warranty", cascade="all, delete-orphan")


class WarrantyClaim(Base):
    __tablename__ = "warranty_claims"
    id = Column(Integer, primary_key=True, index=True)
    claim_code = Column(String, unique=True, index=True)
    claim_number = Column(String, unique=True, index=True, nullable=True)
    warranty_id = Column(Integer, ForeignKey("warranty_records.id"), index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    claim_date = Column(DateTime, default=utcnow, index=True)
    issue_description = Column(Text, nullable=True)
    customer_complaint = Column(Text, nullable=False)
    technician_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    inspection_notes = Column(Text, nullable=True)
    technician_inspection_note = Column(Text, nullable=True)
    decision_status = Column(String, default="pending_inspection", index=True)
    claim_status = Column(String, default="Pending Inspection", index=True)  # Pending Inspection | Approved | Rejected | Repaired | Replaced | Closed
    rejection_reason = Column(Text, nullable=True)
    resolution_type = Column(String, nullable=True)  # repair | replacement | refund | no_action
    replacement_product_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=True, index=True)
    replacement_serial_id = Column(Integer, ForeignKey("inventory_serials.id"), nullable=True, index=True)
    linked_repair_ticket_id = Column(Integer, ForeignKey("repair_tickets.id"), nullable=True, index=True)
    claim_decision = Column(String, nullable=True)
    replacement_item = Column(String, nullable=True)
    repair_action = Column(String, nullable=True)
    processed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True, index=True)
    closed_at = Column(DateTime, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True, index=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    delete_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    warranty = relationship("WarrantyRecord", back_populates="claims")
    processed_by = relationship("User", foreign_keys=[processed_by_id])
    approved_by = relationship("User", foreign_keys=[approved_by_id])
    customer = relationship("Customer")
    technician = relationship("User", foreign_keys=[technician_id])
    replacement_product = relationship("InventoryItem", foreign_keys=[replacement_product_id])
    replacement_serial = relationship("InventorySerial", foreign_keys=[replacement_serial_id])
    linked_repair_ticket = relationship("RepairTicket", foreign_keys=[linked_repair_ticket_id])
    events = relationship("WarrantyClaimEvent", back_populates="claim", cascade="all, delete-orphan")


class WarrantyClaimEvent(Base):
    __tablename__ = "warranty_claim_events"
    id = Column(Integer, primary_key=True, index=True)
    claim_id = Column(Integer, ForeignKey("warranty_claims.id"), nullable=False, index=True)
    event_type = Column(String, nullable=False, index=True)
    event_message = Column(Text, nullable=True)
    old_status = Column(String, nullable=True, index=True)
    new_status = Column(String, nullable=True, index=True)
    performed_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow, index=True)

    claim = relationship("WarrantyClaim", back_populates="events")
    actor = relationship("User", foreign_keys=[performed_by])


class WarrantyReplacement(Base):
    __tablename__ = "warranty_replacements"
    id = Column(Integer, primary_key=True, index=True)
    old_warranty_id = Column(Integer, ForeignKey("warranty_records.id"), nullable=False, index=True)
    new_warranty_id = Column(Integer, ForeignKey("warranty_records.id"), nullable=True, index=True)
    claim_id = Column(Integer, ForeignKey("warranty_claims.id"), nullable=False, index=True)
    old_product_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=True, index=True)
    new_product_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=True, index=True)
    old_serial_id = Column(Integer, ForeignKey("inventory_serials.id"), nullable=True, index=True)
    new_serial_id = Column(Integer, ForeignKey("inventory_serials.id"), nullable=True, index=True)
    replacement_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)


class SupplierWarrantyRecord(Base):
    __tablename__ = "supplier_warranty_records"
    id = Column(Integer, primary_key=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False, index=True)
    grn_id = Column(Integer, ForeignKey("goods_received_notes.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False, index=True)
    serial_id = Column(Integer, ForeignKey("inventory_serials.id"), nullable=True, index=True)
    supplier_warranty_start = Column(DateTime, nullable=True, index=True)
    supplier_warranty_end = Column(DateTime, nullable=True, index=True)
    supplier_invoice_number = Column(String, nullable=True, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)

class StockMovement(Base):
    __tablename__ = "stock_movements"
    id = Column(Integer, primary_key=True)
    item_id = Column(Integer, ForeignKey("inventory_items.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    movement_type = Column(String)  # IN, OUT, ADJUSTMENT, SALE, RETURN, REPAIR_CONSUME
    quantity = Column(Integer)
    reference_type = Column(String, nullable=True)
    reference_id = Column(Integer, nullable=True)
    note = Column(Text, default="")
    created_at = Column(DateTime, default=utcnow)
    item = relationship("InventoryItem")
    user = relationship("User")

class RepairPartUsage(Base):
    __tablename__ = "repair_part_usage"
    id = Column(Integer, primary_key=True)
    repair_id = Column(Integer, ForeignKey("repair_tickets.id"))
    item_id = Column(Integer, ForeignKey("inventory_items.id"))
    quantity = Column(Integer, default=1)
    unit_cost = Column(Float, default=0)
    created_at = Column(DateTime, default=utcnow)
    repair = relationship("RepairTicket", back_populates="parts_usage")
    item = relationship("InventoryItem")


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint("amount >= 0", name="ck_expenses_amount_non_negative"),
    )

    id = Column(Integer, primary_key=True, index=True)
    expense_code = Column(String, unique=True, index=True)
    expense_date = Column(DateTime, default=utcnow, index=True)
    category = Column(String, index=True)
    description = Column(Text, nullable=True)
    amount = Column(Float, default=0)
    tax_amount = Column(Float, default=0)
    payment_method = Column(String, default="Cash", index=True)
    status = Column(String, default="Pending Approval", index=True)  # Pending Approval | Approved | Rejected | Paid | Cancelled
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True, index=True)
    vendor_name = Column(String, nullable=True, index=True)
    reference_no = Column(String, nullable=True, index=True)
    is_recurring = Column(Boolean, default=False, index=True)
    recurring_cycle = Column(String, nullable=True)  # Monthly | Weekly | Yearly
    receipt_attachment = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    approved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    approved_at = Column(DateTime, nullable=True, index=True)
    rejection_reason = Column(Text, nullable=True)
    paid_at = Column(DateTime, nullable=True, index=True)
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True, index=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    delete_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    supplier = relationship("Supplier")
    created_by = relationship("User", foreign_keys=[created_by_user_id])
    approved_by = relationship("User", foreign_keys=[approved_by_user_id])

class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    id = Column(Integer, primary_key=True)
    po_number = Column(String, unique=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"))
    status = Column(String, default="Draft") # Draft, Ordered, Received, Cancelled
    total_cost = Column(Float, default=0)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    received_at = Column(DateTime, nullable=True)
    supplier = relationship("Supplier")
    items = relationship("PurchaseOrderItem", back_populates="po", cascade="all, delete-orphan")
    grns = relationship("GoodsReceivedNote", back_populates="po")

class PurchaseOrderItem(Base):
    __tablename__ = "purchase_order_items"
    id = Column(Integer, primary_key=True)
    po_id = Column(Integer, ForeignKey("purchase_orders.id"))
    item_id = Column(Integer, ForeignKey("inventory_items.id"))
    quantity = Column(Integer)
    unit_cost = Column(Float)
    po = relationship("PurchaseOrder", back_populates="items")
    item = relationship("InventoryItem")

class GoodsReceivedNote(Base):
    __tablename__ = "goods_received_notes"
    id = Column(Integer, primary_key=True)
    grn_no = Column(String, unique=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"))
    po_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=True, index=True)
    invoice_no = Column(String, nullable=True)
    note = Column(Text, nullable=True)
    is_cancelled = Column(Boolean, default=False, index=True)
    cancelled_at = Column(DateTime, nullable=True, index=True)
    cancelled_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    cancel_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    supplier = relationship("Supplier")
    po = relationship("PurchaseOrder", back_populates="grns")
    lines = relationship("GoodsReceivedNoteItem", back_populates="grn", cascade="all, delete-orphan")
    cancelled_by = relationship("User", foreign_keys=[cancelled_by_user_id])

class GoodsReceivedNoteItem(Base):
    __tablename__ = "goods_received_note_items"
    id = Column(Integer, primary_key=True)
    grn_id = Column(Integer, ForeignKey("goods_received_notes.id"))
    item_id = Column(Integer, ForeignKey("inventory_items.id"))
    quantity = Column(Integer, default=0)
    damaged_qty = Column(Integer, default=0)
    unit_cost = Column(Float, default=0)
    item = relationship("InventoryItem")
    grn = relationship("GoodsReceivedNote", back_populates="lines")


class SupplierLedgerEntry(Base):
    __tablename__ = "supplier_ledger_entries"
    id = Column(Integer, primary_key=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), index=True)
    entry_type = Column(String, default="note", index=True)  # purchase | payment | adjustment | note
    direction = Column(String, default="memo", index=True)  # debit | credit | memo
    amount = Column(Float, default=0)
    reference_type = Column(String, nullable=True, index=True)
    reference_id = Column(Integer, nullable=True, index=True)
    note = Column(Text, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow, index=True)

    supplier = relationship("Supplier", back_populates="ledger_entries")
    created_by = relationship("User")

class PriceAdjustmentLog(Base):
    __tablename__ = "price_adjustment_logs"
    id = Column(Integer, primary_key=True)
    item_id = Column(Integer, ForeignKey("inventory_items.id"))
    old_cost_price = Column(Float, default=0)
    old_sale_price = Column(Float, default=0)
    new_cost_price = Column(Float, default=0)
    new_sale_price = Column(Float, default=0)
    reason = Column(String, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    item = relationship("InventoryItem")

class ProductDiscount(Base):
    __tablename__ = "product_discounts"
    id = Column(Integer, primary_key=True)
    item_id = Column(Integer, ForeignKey("inventory_items.id"))
    discount_type = Column(String, default="percent")  # percent | fixed
    value = Column(Float, default=0)
    start_date = Column(DateTime, nullable=True)
    end_date = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    note = Column(String, nullable=True)
    item = relationship("InventoryItem")

class StockTakeSession(Base):
    __tablename__ = "stock_take_sessions"
    id = Column(Integer, primary_key=True)
    name = Column(String, index=True)
    note = Column(Text, nullable=True)
    status = Column(String, default="Open")
    created_at = Column(DateTime, default=utcnow)
    closed_at = Column(DateTime, nullable=True)

class StockTakeLine(Base):
    __tablename__ = "stock_take_lines"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("stock_take_sessions.id"), index=True)
    item_id = Column(Integer, ForeignKey("inventory_items.id"))
    system_qty = Column(Integer, default=0)
    physical_qty = Column(Integer, default=0)
    difference = Column(Integer, default=0)
    item = relationship("InventoryItem")

class AppSetting(Base):
    __tablename__ = "app_settings"
    id = Column(Integer, primary_key=True)
    key = Column(String, unique=True, index=True)
    value = Column(Text, default="")

class ActivityLog(Base):
    __tablename__ = "activity_logs"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String) # Create, Update, Delete, Void, Adjustment
    entity_type = Column(String) # Repair, Sale, Inventory, etc.
    entity_id = Column(Integer)
    description = Column(Text)
    old_value = Column(Text, nullable=True) # JSON string of previous state
    new_value = Column(Text, nullable=True) # JSON string of new state
    is_reversible = Column(Boolean, default=False)
    is_reversed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)
    user = relationship("User")

class DailyClosing(Base):
    __tablename__ = "daily_closings"
    id = Column(Integer, primary_key=True)
    closing_date = Column(DateTime, default=utcnow, index=True)
    opening_cash = Column(Float, default=0)
    actual_cash = Column(Float, default=0)
    system_cash = Column(Float, default=0)
    system_card = Column(Float, default=0)
    difference = Column(Float, default=0)
    notes = Column(Text, nullable=True)
    closed_by_id = Column(Integer, ForeignKey("users.id"))
    closed_by = relationship("User")


class AccountingPeriod(Base):
    __tablename__ = "accounting_periods"

    id = Column(Integer, primary_key=True, index=True)
    period_code = Column(String, unique=True, index=True)
    start_date = Column(DateTime, nullable=False, index=True)
    end_date = Column(DateTime, nullable=False, index=True)
    status = Column(String, default="open", index=True)  # open | closed
    close_reason = Column(Text, nullable=True)
    closed_at = Column(DateTime, nullable=True, index=True)
    closed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    reopened_at = Column(DateTime, nullable=True)
    reopened_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reopen_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    closed_by = relationship("User", foreign_keys=[closed_by_user_id])
    reopened_by = relationship("User", foreign_keys=[reopened_by_user_id])


class AccountingLedgerEntry(Base):
    __tablename__ = "accounting_ledger_entries"
    __table_args__ = (
        CheckConstraint("amount >= 0", name="ck_accounting_ledger_amount_non_negative"),
        UniqueConstraint("entry_number", name="uq_accounting_ledger_entry_number"),
    )

    id = Column(Integer, primary_key=True, index=True)
    entry_number = Column(String, nullable=False, unique=True, index=True)
    entry_date = Column(DateTime, default=utcnow, nullable=False, index=True)
    module = Column(String, nullable=False, index=True)
    entry_type = Column(String, nullable=False, index=True)
    direction = Column(String, nullable=False, index=True)  # debit | credit | memo
    amount = Column(Float, default=0, nullable=False)
    currency = Column(String, default="LKR")
    account_code = Column(String, nullable=True, index=True)
    counterparty_type = Column(String, nullable=True, index=True)
    counterparty_id = Column(Integer, nullable=True, index=True)
    counterparty_name = Column(String, nullable=True)
    reference_type = Column(String, nullable=True, index=True)
    reference_id = Column(Integer, nullable=True, index=True)
    reference_number = Column(String, nullable=True, index=True)
    source_table = Column(String, nullable=True, index=True)
    source_id = Column(Integer, nullable=True, index=True)
    description = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)

    created_by = relationship("User", foreign_keys=[created_by_user_id])


class ApprovalRequest(Base):
    __tablename__ = "approval_requests"

    id = Column(Integer, primary_key=True, index=True)
    request_code = Column(String, nullable=False, unique=True, index=True)
    module = Column(String, nullable=False, index=True)
    action = Column(String, nullable=False, index=True)
    target_type = Column(String, nullable=False, index=True)
    target_id = Column(Integer, nullable=True, index=True)
    status = Column(String, default="pending", index=True)  # pending | approved | rejected | executed | cancelled
    reason = Column(Text, nullable=True)
    payload_json = Column(Text, nullable=True)
    requested_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    requested_at = Column(DateTime, default=utcnow, nullable=False, index=True)
    decided_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    decided_at = Column(DateTime, nullable=True, index=True)
    decision_note = Column(Text, nullable=True)
    executed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    executed_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    requested_by = relationship("User", foreign_keys=[requested_by_user_id])
    decided_by = relationship("User", foreign_keys=[decided_by_user_id])
    executed_by = relationship("User", foreign_keys=[executed_by_user_id])


@event.listens_for(AccountingLedgerEntry, "before_update")
def _prevent_accounting_ledger_update(_mapper, _connection, _target):
    raise ValueError("Accounting ledger entries are immutable")


@event.listens_for(AccountingLedgerEntry, "before_delete")
def _prevent_accounting_ledger_delete(_mapper, _connection, _target):
    raise ValueError("Accounting ledger entries are immutable")


class CashReconciliation(Base):
    __tablename__ = "cash_reconciliations"
    id = Column(Integer, primary_key=True, index=True)
    recon_code = Column(String, unique=True, index=True)
    recon_date = Column(DateTime, default=utcnow, index=True)
    shift = Column(String, default="Full Day")  # Full Day | Morning | Evening
    cashier_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    opening_float = Column(Float, default=0)
    system_cash_total = Column(Float, default=0)
    counted_cash_total = Column(Float, default=0)
    closing_float = Column(Float, default=0)
    cash_transactions_count = Column(Integer, default=0)
    denomination_json = Column(Text, nullable=True)
    difference = Column(Float, default=0)
    status = Column(String, default="Pending Count", index=True)  # Balanced | Minor Variance | Major Variance | Pending Count | Resolved
    notes = Column(Text, nullable=True)
    verified_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    verified_at = Column(DateTime, nullable=True)
    resolution_notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    cashier = relationship("User", foreign_keys=[cashier_id])
    verified_by = relationship("User", foreign_keys=[verified_by_user_id])


class FinancialDailyClosing(Base):
    __tablename__ = "financial_daily_closings"
    id = Column(Integer, primary_key=True, index=True)
    report_code = Column(String, unique=True, index=True)
    report_date = Column(DateTime, default=utcnow, index=True)
    generated_at = Column(DateTime, default=utcnow, index=True)
    verified_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    verification_time = Column(DateTime, nullable=True)
    status = Column(String, default="Unsigned", index=True)  # Signed | Unsigned | Flagged

    sales_cash = Column(Float, default=0)
    sales_card = Column(Float, default=0)
    sales_transfer = Column(Float, default=0)
    sales_credit = Column(Float, default=0)
    sales_total = Column(Float, default=0)

    repairs_cash = Column(Float, default=0)
    repairs_card = Column(Float, default=0)
    repairs_credit = Column(Float, default=0)
    repairs_total = Column(Float, default=0)

    total_revenue = Column(Float, default=0)
    refunds_issued = Column(Float, default=0)
    discounts_applied = Column(Float, default=0)
    voids_cancellations = Column(Float, default=0)
    net_revenue = Column(Float, default=0)
    expenses_today = Column(Float, default=0)
    net_income_today = Column(Float, default=0)

    expected_cash = Column(Float, default=0)
    counted_cash = Column(Float, default=0)
    variance = Column(Float, default=0)
    cash_status = Column(String, default="PENDING")

    total_invoices = Column(Integer, default=0)
    total_repairs_completed = Column(Integer, default=0)
    voids_count = Column(Integer, default=0)
    refunds_count = Column(Integer, default=0)
    partial_payments = Column(Integer, default=0)

    has_unresolved_flags = Column(Boolean, default=False, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    verified_by = relationship("User", foreign_keys=[verified_by_user_id])


class FinancialTransactionReview(Base):
    __tablename__ = "financial_transaction_reviews"
    id = Column(Integer, primary_key=True, index=True)
    transaction_type = Column(String, index=True)  # Sale | Repair | Expense | Refund | Payment
    transaction_id = Column(Integer, index=True)
    status = Column(String, default="Pending Review", index=True)  # Verified | Flagged | Pending Review | Resolved
    notes = Column(Text, nullable=True)
    flagged_reason = Column(String, nullable=True)
    verified_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    verified_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    verified_by = relationship("User")


class FinancialAuditFlag(Base):
    __tablename__ = "financial_audit_flags"
    id = Column(Integer, primary_key=True, index=True)
    flag_code = Column(String, unique=True, index=True)
    raised_at = Column(DateTime, default=utcnow, index=True)
    severity = Column(String, default="Medium", index=True)  # Critical | High | Medium | Low
    module = Column(String, index=True)
    flag_type = Column(String, index=True)
    description = Column(Text, nullable=False)
    raised_by_source = Column(String, default="System")  # System | User
    raised_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    assigned_to_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    status = Column(String, default="Open", index=True)  # Open | Pending Review | Resolved | Escalated
    resolution_notes = Column(Text, nullable=True)
    resolved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    resolved_at = Column(DateTime, nullable=True)
    transaction_type = Column(String, nullable=True, index=True)
    transaction_id = Column(Integer, nullable=True, index=True)
    reference_code = Column(String, nullable=True, index=True)
    amount = Column(Float, default=0)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    raised_by = relationship("User", foreign_keys=[raised_by_user_id])
    assigned_to = relationship("User", foreign_keys=[assigned_to_user_id])
    resolved_by = relationship("User", foreign_keys=[resolved_by_user_id])


class LabelTemplate(Base):
    __tablename__ = "label_templates"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    label_scope = Column(String, index=True)  # Product | Repair Job | Spare Part | Asset
    width_mm = Column(Integer, default=50)
    height_mm = Column(Integer, default=30)
    canvas_json = Column(Text, nullable=True)
    is_default = Column(Boolean, default=False, index=True)
    is_builtin = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    created_by = relationship("User")


class LabelPrintJob(Base):
    __tablename__ = "label_print_jobs"
    id = Column(Integer, primary_key=True, index=True)
    job_code = Column(String, unique=True, index=True)
    label_type = Column(String, index=True)  # Product | Repair Job | Spare Part | Asset
    entity_type = Column(String, index=True)  # inventory_item | repair_ticket | asset | customer
    entity_id = Column(Integer, nullable=True, index=True)
    entity_ref = Column(String, nullable=True, index=True)
    item_name = Column(String, nullable=False)
    qty = Column(Integer, default=1)
    template_id = Column(Integer, ForeignKey("label_templates.id"), nullable=True, index=True)
    template_name = Column(String, nullable=True)
    barcode_format = Column(String, nullable=True)
    printer_name = Column(String, nullable=True)
    paper_type = Column(String, nullable=True)
    print_quality = Column(String, nullable=True)
    orientation = Column(String, nullable=True)
    status = Column(String, default="Waiting", index=True)  # Waiting | Printing | Completed | Failed | Paused | Cancelled
    priority = Column(Integer, default=100, index=True)
    is_reprint = Column(Boolean, default=False, index=True)
    reprint_reason = Column(String, nullable=True)
    generated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    completed_at = Column(DateTime, nullable=True, index=True)
    error_message = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    generated_by = relationship("User")
    template = relationship("LabelTemplate")


class LabelAsset(Base):
    __tablename__ = "label_assets"
    id = Column(Integer, primary_key=True, index=True)
    asset_code = Column(String, unique=True, index=True)
    asset_name = Column(String, index=True)
    asset_type = Column(String, index=True)
    department = Column(String, nullable=True, index=True)
    location = Column(String, nullable=True, index=True)
    purchase_date = Column(DateTime, nullable=True)
    warranty_expiry_date = Column(DateTime, nullable=True)
    assigned_to = Column(String, nullable=True)
    maintenance_due_date = Column(DateTime, nullable=True)
    barcode_value = Column(String, unique=True, index=True)
    qr_value = Column(String, nullable=True)
    status = Column(String, default="Active", index=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class LabelScanLog(Base):
    __tablename__ = "label_scan_logs"
    id = Column(Integer, primary_key=True, index=True)
    barcode_value = Column(String, index=True)
    scan_mode = Column(String, default="scanner")  # scanner | manual | camera
    scanned_type = Column(String, default="Unknown", index=True)  # Product | Repair Job | Part | Customer | Asset | Unknown
    result_ref = Column(String, nullable=True, index=True)
    result_id = Column(Integer, nullable=True, index=True)
    result_summary = Column(String, nullable=True)
    scanned_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow, index=True)

    scanned_by = relationship("User")


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True)
    type = Column(String) # Low Stock, Overdue Repair, Payment Pending
    title = Column(String)
    message = Column(Text)
    is_read = Column(Boolean, default=False)
    read_at = Column(DateTime, nullable=True, index=True)
    is_acknowledged = Column(Boolean, default=False, index=True)
    acknowledged_at = Column(DateTime, nullable=True, index=True)
    acknowledged_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    severity = Column(String, default="medium", index=True)  # low | medium | high | critical
    source_module = Column(String, nullable=True, index=True)
    escalation_level = Column(Integer, default=0, index=True)
    due_at = Column(DateTime, nullable=True, index=True)
    entity_type = Column(String, nullable=True)
    entity_id = Column(Integer, nullable=True)
    is_archived = Column(Boolean, default=False, index=True)
    archived_at = Column(DateTime, nullable=True, index=True)
    archived_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    acknowledged_by = relationship("User", foreign_keys=[acknowledged_by_user_id])
    archived_by = relationship("User", foreign_keys=[archived_by_user_id])


class NumberSequence(Base):
    __tablename__ = "number_sequences"
    id = Column(Integer, primary_key=True, index=True)
    entity = Column(String, index=True)  # INV | JOB | PO | GRN | RET | WRN
    year = Column(Integer, index=True)
    current_value = Column(Integer, default=0)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, index=True)

    __table_args__ = (
        UniqueConstraint("entity", "year", name="uq_number_sequences_entity_year"),
    )


class BackupRecord(Base):
    __tablename__ = "backup_records"
    id = Column(Integer, primary_key=True, index=True)
    backup_code = Column(String, unique=True, index=True)
    filename = Column(String, unique=True, index=True)
    status = Column(String, default="created", index=True)  # created | verified | failed
    backup_type = Column(String, default="manual", index=True)  # manual | auto | pre_restore | recovered
    storage_target = Column(String, default="local", index=True)
    checksum = Column(String, nullable=True)
    size_bytes = Column(Integer, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow, index=True)
    metadata_json = Column(Text, nullable=True)

    created_by = relationship("User", foreign_keys=[created_by_user_id])


class RestoreRequest(Base):
    __tablename__ = "restore_requests"
    id = Column(Integer, primary_key=True, index=True)
    request_code = Column(String, unique=True, index=True)
    backup_record_id = Column(Integer, ForeignKey("backup_records.id"), nullable=False, index=True)
    reason = Column(Text, nullable=True)
    status = Column(String, default="pending_approval", index=True)  # pending_approval | approved | rejected | executed | failed
    requested_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    requested_at = Column(DateTime, default=utcnow, index=True)
    executed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    executed_at = Column(DateTime, nullable=True, index=True)
    execution_result = Column(Text, nullable=True)

    backup_record = relationship("BackupRecord")
    requested_by = relationship("User", foreign_keys=[requested_by_user_id])
    executed_by = relationship("User", foreign_keys=[executed_by_user_id])


class RestoreApproval(Base):
    __tablename__ = "restore_approvals"
    id = Column(Integer, primary_key=True, index=True)
    restore_request_id = Column(Integer, ForeignKey("restore_requests.id"), nullable=False, index=True)
    decision = Column(String, index=True)  # approved | rejected
    note = Column(Text, nullable=True)
    decided_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    decided_at = Column(DateTime, default=utcnow, index=True)

    restore_request = relationship("RestoreRequest")
    decided_by = relationship("User", foreign_keys=[decided_by_user_id])


class RestoreAuditEvent(Base):
    __tablename__ = "restore_audit_events"
    id = Column(Integer, primary_key=True, index=True)
    restore_request_id = Column(Integer, ForeignKey("restore_requests.id"), nullable=False, index=True)
    event_type = Column(String, index=True)  # request_created | approved | rejected | pre_restore_backup | restore_started | restore_completed | restore_failed
    event_status = Column(String, default="success", index=True)  # success | failed | pending
    actor_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    detail = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, index=True)

    restore_request = relationship("RestoreRequest")
    actor = relationship("User", foreign_keys=[actor_user_id])
