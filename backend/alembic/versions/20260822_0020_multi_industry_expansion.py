"""add multi-industry expansion fields (unit_of_measure, is_weighted, batch_number, expiry_date, org industry_type)

Revision ID: 20260822_0020
Revises: 20260801_0018
Create Date: 2026-08-22
"""

from alembic import op
import sqlalchemy as sa


revision = "20260822_0020"
down_revision = "20260801_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # 1. Add columns to inventory_items
    if "inventory_items" in inspector.get_table_names():
        existing_cols = {c["name"] for c in inspector.get_columns("inventory_items")}
        with op.batch_alter_table("inventory_items") as batch_op:
            if "unit_of_measure" not in existing_cols:
                batch_op.add_column(sa.Column("unit_of_measure", sa.String(20), nullable=True, server_default="pcs"))
            if "is_weighted" not in existing_cols:
                batch_op.add_column(sa.Column("is_weighted", sa.Boolean(), nullable=True, server_default=sa.text("0")))
            if "allow_decimal_qty" not in existing_cols:
                batch_op.add_column(sa.Column("allow_decimal_qty", sa.Boolean(), nullable=True, server_default=sa.text("0")))
            if "batch_number" not in existing_cols:
                batch_op.add_column(sa.Column("batch_number", sa.String(50), nullable=True))
                batch_op.create_index("ix_inventory_items_batch_number", ["batch_number"])
            if "expiry_date" not in existing_cols:
                batch_op.add_column(sa.Column("expiry_date", sa.Date(), nullable=True))
                batch_op.create_index("ix_inventory_items_expiry_date", ["expiry_date"])

    # 2. Add columns to organizations
    if "organizations" in inspector.get_table_names():
        existing_cols = {c["name"] for c in inspector.get_columns("organizations")}
        with op.batch_alter_table("organizations") as batch_op:
            if "industry_type" not in existing_cols:
                batch_op.add_column(sa.Column("industry_type", sa.String(50), nullable=True, server_default="MOBILE_RETAIL"))
            if "configuration_version" not in existing_cols:
                batch_op.add_column(sa.Column("configuration_version", sa.Integer(), nullable=True, server_default="1"))
            if "capabilities_override" not in existing_cols:
                batch_op.add_column(sa.Column("capabilities_override", sa.JSON(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "inventory_items" in inspector.get_table_names():
        existing_cols = {c["name"] for c in inspector.get_columns("inventory_items")}
        with op.batch_alter_table("inventory_items") as batch_op:
            if "expiry_date" in existing_cols:
                batch_op.drop_index("ix_inventory_items_expiry_date")
                batch_op.drop_column("expiry_date")
            if "batch_number" in existing_cols:
                batch_op.drop_index("ix_inventory_items_batch_number")
                batch_op.drop_column("batch_number")
            if "allow_decimal_qty" in existing_cols:
                batch_op.drop_column("allow_decimal_qty")
            if "is_weighted" in existing_cols:
                batch_op.drop_column("is_weighted")
            if "unit_of_measure" in existing_cols:
                batch_op.drop_column("unit_of_measure")

    if "organizations" in inspector.get_table_names():
        existing_cols = {c["name"] for c in inspector.get_columns("organizations")}
        with op.batch_alter_table("organizations") as batch_op:
            if "capabilities_override" in existing_cols:
                batch_op.drop_column("capabilities_override")
            if "configuration_version" in existing_cols:
                batch_op.drop_column("configuration_version")
            if "industry_type" in existing_cols:
                batch_op.drop_column("industry_type")
