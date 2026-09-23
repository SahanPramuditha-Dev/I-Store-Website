"""Persist customer portal WhatsApp verification codes.

Revision ID: 20260923_0022
Revises: 20260914_0021
"""
from alembic import op
import sqlalchemy as sa

revision = "20260923_0022"
down_revision = "20260914_0021"
branch_labels = None
depends_on = None


def upgrade():
    if "customer_portal_otps_local" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "customer_portal_otps_local",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("phone", sa.String(length=32), nullable=False),
        sa.Column("store_id", sa.String(length=100), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_customer_portal_otps_local_phone", "customer_portal_otps_local", ["phone"])
    op.create_index("ix_customer_portal_otps_local_store_id", "customer_portal_otps_local", ["store_id"])


def downgrade():
    op.drop_table("customer_portal_otps_local")
