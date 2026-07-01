"""returns and refunds management module

Revision ID: 20260521_0008
Revises: 20260521_0007
Create Date: 2026-05-21
"""

from alembic import op
import sqlalchemy as sa


revision = "20260521_0008"
down_revision = "20260521_0007"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return name in _inspector().get_table_names()


def _create_index_if_missing(index_name: str, table_name: str, columns: list[str]) -> None:
    if not _has_table(table_name):
        return
    indexes = _inspector().get_indexes(table_name)
    if any(idx.get("name") == index_name for idx in indexes):
        return
    op.create_index(index_name, table_name, columns, unique=False)


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    columns = _inspector().get_columns(table_name)
    return any(col.get("name") == column_name for col in columns)


def upgrade() -> None:
    if not _has_table("returns"):
        op.create_table(
            "returns",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("return_number", sa.String(), nullable=True),
            sa.Column("original_invoice_id", sa.Integer(), nullable=True),
            sa.Column("customer_id", sa.Integer(), nullable=True),
            sa.Column("warranty_claim_id", sa.Integer(), nullable=True),
            sa.Column("return_type", sa.String(), nullable=True, server_default="return"),
            sa.Column("reason", sa.String(), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("inspection_status", sa.String(), nullable=True, server_default="pending_inspection"),
            sa.Column("decision_status", sa.String(), nullable=True, server_default="pending"),
            sa.Column("refund_status", sa.String(), nullable=True, server_default="none"),
            sa.Column("total_return_amount", sa.Float(), nullable=True, server_default="0"),
            sa.Column("refund_amount", sa.Float(), nullable=True, server_default="0"),
            sa.Column("store_credit_amount", sa.Float(), nullable=True, server_default="0"),
            sa.Column("approved_by", sa.Integer(), nullable=True),
            sa.Column("rejected_by", sa.Integer(), nullable=True),
            sa.Column("processed_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.Column("closed_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["original_invoice_id"], ["sales.id"]),
            sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
            sa.ForeignKeyConstraint(["warranty_claim_id"], ["warranty_claims.id"]),
            sa.ForeignKeyConstraint(["approved_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["rejected_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["processed_by"], ["users.id"]),
            sa.CheckConstraint("total_return_amount >= 0", name="ck_returns_total_return_amount_non_negative"),
            sa.CheckConstraint("refund_amount >= 0", name="ck_returns_refund_amount_non_negative"),
            sa.CheckConstraint("store_credit_amount >= 0", name="ck_returns_store_credit_amount_non_negative"),
        )
        op.create_unique_constraint("uq_returns_return_number", "returns", ["return_number"])
    elif not _has_column("returns", "warranty_claim_id"):
        op.add_column("returns", sa.Column("warranty_claim_id", sa.Integer(), nullable=True))

    if not _has_table("return_items"):
        op.create_table(
            "return_items",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("return_id", sa.Integer(), nullable=False),
            sa.Column("original_invoice_item_id", sa.Integer(), nullable=True),
            sa.Column("product_id", sa.Integer(), nullable=False),
            sa.Column("variant_id", sa.String(), nullable=True),
            sa.Column("serial_id", sa.Integer(), nullable=True),
            sa.Column("imei", sa.String(), nullable=True),
            sa.Column("quantity", sa.Integer(), nullable=True, server_default="1"),
            sa.Column("unit_price", sa.Float(), nullable=True, server_default="0"),
            sa.Column("return_amount", sa.Float(), nullable=True, server_default="0"),
            sa.Column("item_condition", sa.String(), nullable=True, server_default="sellable"),
            sa.Column("restock_action", sa.String(), nullable=True, server_default="restock"),
            sa.Column("replacement_product_id", sa.Integer(), nullable=True),
            sa.Column("replacement_serial_id", sa.Integer(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["return_id"], ["returns.id"]),
            sa.ForeignKeyConstraint(["original_invoice_item_id"], ["sale_items.id"]),
            sa.ForeignKeyConstraint(["product_id"], ["inventory_items.id"]),
            sa.ForeignKeyConstraint(["serial_id"], ["inventory_serials.id"]),
            sa.ForeignKeyConstraint(["replacement_product_id"], ["inventory_items.id"]),
            sa.ForeignKeyConstraint(["replacement_serial_id"], ["inventory_serials.id"]),
            sa.CheckConstraint("quantity > 0", name="ck_return_items_quantity_positive"),
            sa.CheckConstraint("unit_price >= 0", name="ck_return_items_unit_price_non_negative"),
            sa.CheckConstraint("return_amount >= 0", name="ck_return_items_return_amount_non_negative"),
        )

    if not _has_table("refund_payments"):
        op.create_table(
            "refund_payments",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("refund_number", sa.String(), nullable=True),
            sa.Column("return_id", sa.Integer(), nullable=False),
            sa.Column("original_payment_id", sa.Integer(), nullable=True),
            sa.Column("customer_id", sa.Integer(), nullable=False),
            sa.Column("refund_amount", sa.Float(), nullable=True, server_default="0"),
            sa.Column("refund_method", sa.String(), nullable=True, server_default="cash"),
            sa.Column("refund_status", sa.String(), nullable=True, server_default="pending"),
            sa.Column("approved_by", sa.Integer(), nullable=True),
            sa.Column("paid_by", sa.Integer(), nullable=True),
            sa.Column("paid_at", sa.DateTime(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["return_id"], ["returns.id"]),
            sa.ForeignKeyConstraint(["original_payment_id"], ["invoice_payments.id"]),
            sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
            sa.ForeignKeyConstraint(["approved_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["paid_by"], ["users.id"]),
            sa.CheckConstraint("refund_amount >= 0", name="ck_refund_payments_refund_amount_non_negative"),
        )
        op.create_unique_constraint("uq_refund_payments_refund_number", "refund_payments", ["refund_number"])

    if not _has_table("store_credits"):
        op.create_table(
            "store_credits",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("credit_number", sa.String(), nullable=True),
            sa.Column("customer_id", sa.Integer(), nullable=False),
            sa.Column("return_id", sa.Integer(), nullable=True),
            sa.Column("amount", sa.Float(), nullable=True, server_default="0"),
            sa.Column("remaining_amount", sa.Float(), nullable=True, server_default="0"),
            sa.Column("status", sa.String(), nullable=True, server_default="active"),
            sa.Column("expiry_date", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
            sa.ForeignKeyConstraint(["return_id"], ["returns.id"]),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.CheckConstraint("amount >= 0", name="ck_store_credits_amount_non_negative"),
            sa.CheckConstraint("remaining_amount >= 0", name="ck_store_credits_remaining_non_negative"),
        )
        op.create_unique_constraint("uq_store_credits_credit_number", "store_credits", ["credit_number"])

    if not _has_table("exchange_records"):
        op.create_table(
            "exchange_records",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("exchange_number", sa.String(), nullable=True),
            sa.Column("return_id", sa.Integer(), nullable=False),
            sa.Column("old_invoice_item_id", sa.Integer(), nullable=False),
            sa.Column("old_product_id", sa.Integer(), nullable=False),
            sa.Column("new_product_id", sa.Integer(), nullable=False),
            sa.Column("new_invoice_id", sa.Integer(), nullable=True),
            sa.Column("price_difference", sa.Float(), nullable=True, server_default="0"),
            sa.Column("balance_to_pay", sa.Float(), nullable=True, server_default="0"),
            sa.Column("balance_to_refund", sa.Float(), nullable=True, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["return_id"], ["returns.id"]),
            sa.ForeignKeyConstraint(["old_invoice_item_id"], ["sale_items.id"]),
            sa.ForeignKeyConstraint(["old_product_id"], ["inventory_items.id"]),
            sa.ForeignKeyConstraint(["new_product_id"], ["inventory_items.id"]),
            sa.ForeignKeyConstraint(["new_invoice_id"], ["sales.id"]),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        )
        op.create_unique_constraint("uq_exchange_records_exchange_number", "exchange_records", ["exchange_number"])

    if not _has_table("damaged_stock_records"):
        op.create_table(
            "damaged_stock_records",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("return_item_id", sa.Integer(), nullable=False),
            sa.Column("product_id", sa.Integer(), nullable=False),
            sa.Column("serial_id", sa.Integer(), nullable=True),
            sa.Column("quantity", sa.Integer(), nullable=True, server_default="1"),
            sa.Column("damage_reason", sa.String(), nullable=False),
            sa.Column("action", sa.String(), nullable=True, server_default="hold"),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["return_item_id"], ["return_items.id"]),
            sa.ForeignKeyConstraint(["product_id"], ["inventory_items.id"]),
            sa.ForeignKeyConstraint(["serial_id"], ["inventory_serials.id"]),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        )

    _create_index_if_missing("idx_returns_original_invoice_id", "returns", ["original_invoice_id"])
    _create_index_if_missing("idx_returns_customer_id", "returns", ["customer_id"])
    _create_index_if_missing("idx_returns_warranty_claim_id", "returns", ["warranty_claim_id"])
    _create_index_if_missing("idx_returns_return_type", "returns", ["return_type"])
    _create_index_if_missing("idx_returns_inspection_status", "returns", ["inspection_status"])
    _create_index_if_missing("idx_returns_decision_status", "returns", ["decision_status"])
    _create_index_if_missing("idx_returns_refund_status", "returns", ["refund_status"])
    _create_index_if_missing("idx_returns_created_at", "returns", ["created_at"])
    _create_index_if_missing("idx_return_items_return_id", "return_items", ["return_id"])
    _create_index_if_missing("idx_return_items_original_invoice_item_id", "return_items", ["original_invoice_item_id"])
    _create_index_if_missing("idx_return_items_product_id", "return_items", ["product_id"])
    _create_index_if_missing("idx_return_items_serial_id", "return_items", ["serial_id"])
    _create_index_if_missing("idx_refund_payments_return_id", "refund_payments", ["return_id"])
    _create_index_if_missing("idx_refund_payments_customer_id", "refund_payments", ["customer_id"])
    _create_index_if_missing("idx_refund_payments_method_status", "refund_payments", ["refund_method", "refund_status"])
    _create_index_if_missing("idx_refund_payments_created_at", "refund_payments", ["created_at"])
    _create_index_if_missing("idx_store_credits_customer_id", "store_credits", ["customer_id"])
    _create_index_if_missing("idx_store_credits_status", "store_credits", ["status"])
    _create_index_if_missing("idx_store_credits_expiry_date", "store_credits", ["expiry_date"])
    _create_index_if_missing("idx_exchange_records_return_id", "exchange_records", ["return_id"])
    _create_index_if_missing("idx_exchange_records_new_invoice_id", "exchange_records", ["new_invoice_id"])
    _create_index_if_missing("idx_damaged_stock_records_return_item_id", "damaged_stock_records", ["return_item_id"])
    _create_index_if_missing("idx_damaged_stock_records_product_id", "damaged_stock_records", ["product_id"])
    _create_index_if_missing("idx_damaged_stock_records_action", "damaged_stock_records", ["action"])
    _create_index_if_missing("idx_damaged_stock_records_created_at", "damaged_stock_records", ["created_at"])


def downgrade() -> None:
    # no-op downgrade for data safety
    pass
