"""pos billing contract upgrade

Revision ID: 20260521_0009
Revises: 20260521_0008
Create Date: 2026-05-21
"""

from alembic import op
import sqlalchemy as sa


revision = "20260521_0009"
down_revision = "20260521_0008"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return name in _inspector().get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    columns = _inspector().get_columns(table_name)
    return any(col.get("name") == column_name for col in columns)


def _add_column_if_missing(table_name: str, column: sa.Column) -> None:
    if not _has_table(table_name):
        return
    if _has_column(table_name, column.name):
        return
    op.add_column(table_name, column)


def _create_index_if_missing(index_name: str, table_name: str, columns: list[str], unique: bool = False) -> None:
    if not _has_table(table_name):
        return
    indexes = _inspector().get_indexes(table_name)
    if any(idx.get("name") == index_name for idx in indexes):
        return
    op.create_index(index_name, table_name, columns, unique=unique)


def upgrade() -> None:
    _add_column_if_missing("sales", sa.Column("invoice_type", sa.String(), nullable=True, server_default="product_sale"))
    _add_column_if_missing("sales", sa.Column("reservation_id", sa.Integer(), nullable=True))
    _add_column_if_missing("sales", sa.Column("advance_applied_total", sa.Float(), nullable=True, server_default="0"))
    _add_column_if_missing("sales", sa.Column("invoice_status", sa.String(), nullable=True, server_default="finalized"))
    _add_column_if_missing("sales", sa.Column("created_by", sa.Integer(), nullable=True))
    _add_column_if_missing("sales", sa.Column("finalized_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("sales", sa.Column("voided_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("sales", sa.Column("voided_by", sa.Integer(), nullable=True))

    _add_column_if_missing("sale_items", sa.Column("variant_id", sa.String(), nullable=True))
    _add_column_if_missing("sale_items", sa.Column("serial_id", sa.Integer(), nullable=True))
    _add_column_if_missing("sale_items", sa.Column("discount_amount", sa.Float(), nullable=True, server_default="0"))
    _add_column_if_missing("sale_items", sa.Column("line_total", sa.Float(), nullable=True, server_default="0"))
    _add_column_if_missing("sale_items", sa.Column("warranty_rule_id", sa.Integer(), nullable=True))
    _add_column_if_missing("sale_items", sa.Column("warranty_record_id", sa.Integer(), nullable=True))

    _add_column_if_missing("invoice_payments", sa.Column("payment_number", sa.String(), nullable=True))
    _add_column_if_missing("invoice_payments", sa.Column("reference_number", sa.String(), nullable=True))

    if not _has_table("invoice_audit_events"):
        op.create_table(
            "invoice_audit_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("invoice_id", sa.Integer(), nullable=False),
            sa.Column("event_type", sa.String(), nullable=False),
            sa.Column("event_message", sa.Text(), nullable=True),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["invoice_id"], ["sales.id"]),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        )

    _create_index_if_missing("idx_sales_invoice_type", "sales", ["invoice_type"])
    _create_index_if_missing("idx_sales_reservation_id", "sales", ["reservation_id"])
    _create_index_if_missing("idx_sales_invoice_status", "sales", ["invoice_status"])
    _create_index_if_missing("idx_sale_items_line_type", "sale_items", ["line_type"])
    _create_index_if_missing("idx_invoice_payments_payment_number", "invoice_payments", ["payment_number"])
    _create_index_if_missing("idx_invoice_payments_reference_number", "invoice_payments", ["reference_number"])
    _create_index_if_missing("idx_invoice_audit_events_invoice_id", "invoice_audit_events", ["invoice_id"])
    _create_index_if_missing("idx_invoice_audit_events_created_at", "invoice_audit_events", ["created_at"])

    # SQLite doesn't support adding foreign keys directly via ALTER TABLE in place.
    # We still create helpful indexes for relational lookups.
    _create_index_if_missing("idx_sales_created_by", "sales", ["created_by"])
    _create_index_if_missing("idx_sales_voided_by", "sales", ["voided_by"])
    _create_index_if_missing("idx_sale_items_serial_id", "sale_items", ["serial_id"])
    _create_index_if_missing("idx_sale_items_warranty_rule_id", "sale_items", ["warranty_rule_id"])
    _create_index_if_missing("idx_sale_items_warranty_record_id", "sale_items", ["warranty_record_id"])


def downgrade() -> None:
    # Intentional no-op for destructive safety on local production SQLite deployments.
    pass

