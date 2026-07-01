"""add expense tax amount and reporting indexes

Revision ID: c2a7b41f6d10
Revises: 8d9d2e4c5f60
Create Date: 2026-05-20
"""

from alembic import op
import sqlalchemy as sa


revision = "c2a7b41f6d10"
down_revision = "8d9d2e4c5f60"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return any(col["name"] == column_name for col in _inspector().get_columns(table_name))


def _add_column_if_missing(table_name: str, column: sa.Column) -> None:
    if _has_column(table_name, column.name):
        return
    with op.batch_alter_table(table_name, schema=None) as batch_op:
        batch_op.add_column(column)


def _create_index_if_missing(index_name: str, table_name: str, columns: list[str]) -> None:
    if not _has_table(table_name):
        return
    indexes = _inspector().get_indexes(table_name)
    if any(idx.get("name") == index_name for idx in indexes):
        return
    op.create_index(index_name, table_name, columns, unique=False)


def upgrade() -> None:
    _add_column_if_missing("expenses", sa.Column("tax_amount", sa.Float(), nullable=True, server_default="0"))

    _create_index_if_missing("idx_activity_logs_action", "activity_logs", ["action"])
    _create_index_if_missing("idx_activity_logs_entity_type", "activity_logs", ["entity_type"])
    _create_index_if_missing("idx_security_audit_logs_target_type", "security_audit_logs", ["target_type"])
    _create_index_if_missing("idx_security_audit_logs_user_id", "security_audit_logs", ["user_id"])
    _create_index_if_missing("idx_expenses_expense_date", "expenses", ["expense_date"])
    _create_index_if_missing("idx_expenses_status", "expenses", ["status"])


def downgrade() -> None:
    pass
