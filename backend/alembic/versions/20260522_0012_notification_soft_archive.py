"""notification soft archive fields

Revision ID: 20260522_0012
Revises: 20260522_0011
Create Date: 2026-05-22
"""

from alembic import op
import sqlalchemy as sa


revision = "20260522_0012"
down_revision = "20260522_0011"
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
    _add_column_if_missing("notifications", sa.Column("is_archived", sa.Boolean(), nullable=True, server_default=sa.text("0")))
    _add_column_if_missing("notifications", sa.Column("archived_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("notifications", sa.Column("archived_by_user_id", sa.Integer(), nullable=True))
    _create_index_if_missing("notifications", "ix_notifications_is_archived", ["is_archived"])
    _create_index_if_missing("notifications", "ix_notifications_archived_at", ["archived_at"])
    _create_index_if_missing("notifications", "ix_notifications_archived_by_user_id", ["archived_by_user_id"])


def downgrade() -> None:
    if not _has_table("notifications"):
        return
    for index_name in [
        "ix_notifications_archived_by_user_id",
        "ix_notifications_archived_at",
        "ix_notifications_is_archived",
    ]:
        existing = {idx.get("name") for idx in _inspector().get_indexes("notifications")}
        if index_name in existing:
            op.drop_index(index_name, table_name="notifications")
    for column_name in ["archived_by_user_id", "archived_at", "is_archived"]:
        if _has_column("notifications", column_name):
            op.drop_column("notifications", column_name)
