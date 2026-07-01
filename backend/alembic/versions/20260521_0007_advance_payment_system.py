"""advance payment and product reservation system

Revision ID: 20260521_0007
Revises: 20260521_0006
Create Date: 2026-05-21
"""

from alembic import op
import sqlalchemy as sa


revision = "20260521_0007"
down_revision = "20260521_0006"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _create_index_if_missing(index_name: str, table_name: str, columns: list[str]) -> None:
    if not _has_table(table_name):
        return
    indexes = _inspector().get_indexes(table_name)
    if any(idx.get("name") == index_name for idx in indexes):
        return
    op.create_index(index_name, table_name, columns, unique=False)


def upgrade() -> None:
    if not _has_table("product_reservations"):
        op.create_table(
            "product_reservations",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("reservation_number", sa.String(), nullable=True),
            sa.Column("customer_id", sa.Integer(), nullable=False),
            sa.Column("product_id", sa.Integer(), nullable=True),
            sa.Column("variant_id", sa.String(), nullable=True),
            sa.Column("serial_id", sa.Integer(), nullable=True),
            sa.Column("requested_product_name", sa.String(), nullable=True),
            sa.Column("reservation_type", sa.String(), nullable=True, server_default="in_stock_reservation"),
            sa.Column("quantity", sa.Integer(), nullable=True, server_default="1"),
            sa.Column("estimated_total", sa.Float(), nullable=True, server_default="0"),
            sa.Column("advance_required", sa.Boolean(), nullable=True, server_default=sa.text("0")),
            sa.Column("advance_required_amount", sa.Float(), nullable=True, server_default="0"),
            sa.Column("advance_paid_total", sa.Float(), nullable=True, server_default="0"),
            sa.Column("balance_due", sa.Float(), nullable=True, server_default="0"),
            sa.Column("status", sa.String(), nullable=True, server_default="draft"),
            sa.Column("expected_arrival_date", sa.DateTime(), nullable=True),
            sa.Column("expiry_date", sa.DateTime(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("linked_invoice_id", sa.Integer(), nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
            sa.ForeignKeyConstraint(["product_id"], ["inventory_items.id"]),
            sa.ForeignKeyConstraint(["serial_id"], ["inventory_serials.id"]),
            sa.ForeignKeyConstraint(["linked_invoice_id"], ["sales.id"]),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.CheckConstraint("quantity > 0", name="ck_product_reservations_quantity_positive"),
        )
        op.create_unique_constraint("uq_product_reservations_reservation_number", "product_reservations", ["reservation_number"])

    if not _has_table("repair_estimates"):
        op.create_table(
            "repair_estimates",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("repair_ticket_id", sa.Integer(), nullable=False),
            sa.Column("customer_id", sa.Integer(), nullable=False),
            sa.Column("estimated_parts_cost", sa.Float(), nullable=True, server_default="0"),
            sa.Column("estimated_labor_cost", sa.Float(), nullable=True, server_default="0"),
            sa.Column("estimated_total", sa.Float(), nullable=True, server_default="0"),
            sa.Column("advance_required", sa.Boolean(), nullable=True, server_default=sa.text("0")),
            sa.Column("advance_required_amount", sa.Float(), nullable=True, server_default="0"),
            sa.Column("approval_status", sa.String(), nullable=True, server_default="pending"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("approved_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["repair_ticket_id"], ["repair_tickets.id"]),
            sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        )
        op.create_unique_constraint("uq_repair_estimates_repair_ticket_id", "repair_estimates", ["repair_ticket_id"])

    if not _has_table("advance_payments"):
        op.create_table(
            "advance_payments",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("advance_number", sa.String(), nullable=True),
            sa.Column("advance_type", sa.String(), nullable=True, server_default="other"),
            sa.Column("customer_id", sa.Integer(), nullable=False),
            sa.Column("repair_ticket_id", sa.Integer(), nullable=True),
            sa.Column("product_order_id", sa.Integer(), nullable=True),
            sa.Column("reservation_id", sa.Integer(), nullable=True),
            sa.Column("estimate_id", sa.Integer(), nullable=True),
            sa.Column("invoice_id", sa.Integer(), nullable=True),
            sa.Column("amount", sa.Float(), nullable=True, server_default="0"),
            sa.Column("applied_amount", sa.Float(), nullable=True, server_default="0"),
            sa.Column("refunded_amount", sa.Float(), nullable=True, server_default="0"),
            sa.Column("payment_method", sa.String(), nullable=True, server_default="cash"),
            sa.Column("payment_date", sa.DateTime(), nullable=True),
            sa.Column("status", sa.String(), nullable=True, server_default="received"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("cancellation_reason", sa.Text(), nullable=True),
            sa.Column("refund_reason", sa.Text(), nullable=True),
            sa.Column("manager_override_used", sa.Boolean(), nullable=True, server_default=sa.text("0")),
            sa.Column("received_by", sa.Integer(), nullable=True),
            sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default=sa.text("0")),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
            sa.ForeignKeyConstraint(["repair_ticket_id"], ["repair_tickets.id"]),
            sa.ForeignKeyConstraint(["product_order_id"], ["purchase_orders.id"]),
            sa.ForeignKeyConstraint(["reservation_id"], ["product_reservations.id"]),
            sa.ForeignKeyConstraint(["estimate_id"], ["repair_estimates.id"]),
            sa.ForeignKeyConstraint(["invoice_id"], ["sales.id"]),
            sa.ForeignKeyConstraint(["received_by"], ["users.id"]),
        )
        op.create_unique_constraint("uq_advance_payments_advance_number", "advance_payments", ["advance_number"])

    if not _has_table("invoice_payments"):
        op.create_table(
            "invoice_payments",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("invoice_id", sa.Integer(), nullable=False),
            sa.Column("customer_id", sa.Integer(), nullable=True),
            sa.Column("amount", sa.Float(), nullable=True, server_default="0"),
            sa.Column("payment_method", sa.String(), nullable=True, server_default="cash"),
            sa.Column("payment_type", sa.String(), nullable=True, server_default="normal_payment"),
            sa.Column("linked_advance_payment_id", sa.Integer(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("received_by", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["invoice_id"], ["sales.id"]),
            sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
            sa.ForeignKeyConstraint(["linked_advance_payment_id"], ["advance_payments.id"]),
            sa.ForeignKeyConstraint(["received_by"], ["users.id"]),
            sa.CheckConstraint("amount >= 0", name="ck_invoice_payments_amount_non_negative"),
        )

    _create_index_if_missing("idx_product_reservations_customer_id", "product_reservations", ["customer_id"])
    _create_index_if_missing("idx_product_reservations_status", "product_reservations", ["status"])
    _create_index_if_missing("idx_product_reservations_product_id_status", "product_reservations", ["product_id", "status"])
    _create_index_if_missing("idx_product_reservations_expected_arrival_date", "product_reservations", ["expected_arrival_date"])
    _create_index_if_missing("idx_repair_estimates_repair_ticket_id", "repair_estimates", ["repair_ticket_id"])
    _create_index_if_missing("idx_repair_estimates_approval_status", "repair_estimates", ["approval_status"])
    _create_index_if_missing("idx_advance_payments_customer_id", "advance_payments", ["customer_id"])
    _create_index_if_missing("idx_advance_payments_repair_ticket_id", "advance_payments", ["repair_ticket_id"])
    _create_index_if_missing("idx_advance_payments_reservation_id", "advance_payments", ["reservation_id"])
    _create_index_if_missing("idx_advance_payments_status_payment_date", "advance_payments", ["status", "payment_date"])
    _create_index_if_missing("idx_invoice_payments_invoice_id", "invoice_payments", ["invoice_id"])
    _create_index_if_missing("idx_invoice_payments_customer_id", "invoice_payments", ["customer_id"])
    _create_index_if_missing("idx_invoice_payments_linked_advance_payment_id", "invoice_payments", ["linked_advance_payment_id"])
    _create_index_if_missing("idx_invoice_payments_created_at", "invoice_payments", ["created_at"])


def downgrade() -> None:
    # no-op downgrade for production safety
    pass
