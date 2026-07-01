"""expense soft delete fields

Revision ID: 20260522_0011
Revises: 20260522_0010
Create Date: 2026-05-22
"""

from alembic import op
import sqlalchemy as sa


revision = "20260522_0011"
down_revision = "20260522_0010"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return name in _inspector().get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return any(col.get("name") == column_name for col in _inspector().get_columns(table_name))


def _add_column_if_missing(table_name: str, column: sa.Column) -> None:
    if _has_column(table_name, column.name):
        return
    op.add_column(table_name, column)


def _create_index_if_missing(table_name: str, index_name: str, columns: list[str]) -> None:
    if not _has_table(table_name):
        return
    existing = {idx.get("name") for idx in _inspector().get_indexes(table_name)}
    if index_name not in existing:
        op.create_index(index_name, table_name, columns)


def upgrade() -> None:
    _add_column_if_missing("expenses", sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default=sa.text("0")))
    _add_column_if_missing("expenses", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("expenses", sa.Column("deleted_by", sa.Integer(), nullable=True))
    _add_column_if_missing("expenses", sa.Column("delete_reason", sa.Text(), nullable=True))
    _create_index_if_missing("expenses", "ix_expenses_is_deleted", ["is_deleted"])
    _create_index_if_missing("expenses", "ix_expenses_deleted_at", ["deleted_at"])
    _create_index_if_missing("expenses", "ix_expenses_deleted_by", ["deleted_by"])


def downgrade() -> None:
    if not _has_table("expenses"):
        return
    for index_name in ["ix_expenses_deleted_by", "ix_expenses_deleted_at", "ix_expenses_is_deleted"]:
        existing = {idx.get("name") for idx in _inspector().get_indexes("expenses")}
        if index_name in existing:
            op.drop_index(index_name, table_name="expenses")
    for column_name in ["delete_reason", "deleted_by", "deleted_at", "is_deleted"]:
        if _has_column("expenses", column_name):
            op.drop_column("expenses", column_name)
