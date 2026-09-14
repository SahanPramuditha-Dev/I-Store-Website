"""add server-backed suspended POS carts

Revision ID: 20260914_0021
Revises: 20260822_0020
Create Date: 2026-09-14
"""

from alembic import op
import sqlalchemy as sa


revision = "20260914_0021"
down_revision = "20260822_0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "suspended_pos_carts" in inspector.get_table_names():
        return

    op.create_table(
        "suspended_pos_carts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("token", sa.String(length=40), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("item_count", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("cart_total", sa.Float(), nullable=True, server_default="0"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("uuid", sa.String(length=36), nullable=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True),
        sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id", ondelete="SET NULL"), nullable=True),
        sa.Column("store_id", sa.String(length=36), nullable=True),
        sa.Column("device_id", sa.String(length=100), nullable=True),
        sa.Column("sync_status", sa.String(length=20), nullable=True, server_default="synced"),
        sa.Column("sync_version", sa.Integer(), nullable=True, server_default="1"),
        sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default=sa.text("0")),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("organization_id", "token", name="uq_suspended_pos_cart_org_token"),
        sa.UniqueConstraint("uuid", name="uq_suspended_pos_carts_uuid"),
    )
    for column in ("token", "created_by", "created_at", "organization_id", "branch_id", "uuid", "sync_status", "is_deleted"):
        op.create_index(f"ix_suspended_pos_carts_{column}", "suspended_pos_carts", [column])


def downgrade() -> None:
    bind = op.get_bind()
    if "suspended_pos_carts" in sa.inspect(bind).get_table_names():
        op.drop_table("suspended_pos_carts")
