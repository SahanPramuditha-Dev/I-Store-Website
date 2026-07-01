"""add GRN cancellation fields and indexes

Revision ID: f9a4b2c7d1e0
Revises: c2a7b41f6d10
Create Date: 2026-05-20
"""

from alembic import op
import sqlalchemy as sa


revision = "f9a4b2c7d1e0"
down_revision = "c2a7b41f6d10"
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
    _add_column_if_missing(
        "goods_received_notes",
        sa.Column("is_cancelled", sa.Boolean(), nullable=True, server_default=sa.false()),
    )
    _add_column_if_missing(
        "goods_received_notes",
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
    )
    _add_column_if_missing(
        "goods_received_notes",
        sa.Column("cancelled_by_user_id", sa.Integer(), nullable=True),
    )
    _add_column_if_missing(
        "goods_received_notes",
        sa.Column("cancel_reason", sa.Text(), nullable=True),
    )

    _create_index_if_missing("idx_goods_received_notes_is_cancelled", "goods_received_notes", ["is_cancelled"])
    _create_index_if_missing("idx_goods_received_notes_cancelled_at", "goods_received_notes", ["cancelled_at"])


def downgrade() -> None:
    pass
