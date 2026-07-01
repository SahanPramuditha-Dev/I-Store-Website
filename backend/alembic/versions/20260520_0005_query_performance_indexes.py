"""query performance indexes for production hardening

Revision ID: 20260520_0005
Revises: 20260520_0004
Create Date: 2026-05-20
"""

from alembic import op
import sqlalchemy as sa


revision = "20260520_0005"
down_revision = "20260520_0004"
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
    # invoices => sales
    _create_index_if_missing("idx_sales_created_at", "sales", ["created_at"])
    _create_index_if_missing("idx_sales_customer_id", "sales", ["customer_id"])
    _create_index_if_missing("idx_sales_repair_ticket_id", "sales", ["repair_ticket_id"])

    # repairs
    _create_index_if_missing("idx_repair_tickets_status", "repair_tickets", ["status"])
    _create_index_if_missing("idx_repair_tickets_customer_id", "repair_tickets", ["customer_id"])
    _create_index_if_missing("idx_repair_tickets_imei", "repair_tickets", ["imei"])

    # inventory
    _create_index_if_missing("idx_inventory_items_barcode", "inventory_items", ["barcode"])
    _create_index_if_missing("idx_inventory_items_sku", "inventory_items", ["sku"])

    # stock / audit / payments
    _create_index_if_missing("idx_stock_movements_created_at", "stock_movements", ["created_at"])
    _create_index_if_missing("idx_activity_logs_created_at", "activity_logs", ["created_at"])
    _create_index_if_missing("idx_activity_logs_user_id", "activity_logs", ["user_id"])
    _create_index_if_missing("idx_activity_logs_entity_type", "activity_logs", ["entity_type"])
    _create_index_if_missing("idx_activity_logs_action", "activity_logs", ["action"])
    _create_index_if_missing("idx_security_audit_logs_created_at", "security_audit_logs", ["created_at"])
    _create_index_if_missing("idx_sales_payment_status_created_at", "sales", ["payment_status", "created_at"])

    # requested composite patterns
    _create_index_if_missing("idx_sales_customer_created_at", "sales", ["customer_id", "created_at"])
    _create_index_if_missing("idx_repair_tickets_customer_created_at", "repair_tickets", ["customer_id", "created_at"])
    _create_index_if_missing("idx_repair_tickets_status_created_at", "repair_tickets", ["status", "created_at"])
    _create_index_if_missing("idx_sales_is_return_created_at", "sales", ["is_return", "created_at"])
    _create_index_if_missing(
        "idx_activity_logs_module_action_created_at",
        "activity_logs",
        ["entity_type", "action", "created_at"],
    )


def downgrade() -> None:
    # conservative, no-op downgrade for production safety.
    pass
