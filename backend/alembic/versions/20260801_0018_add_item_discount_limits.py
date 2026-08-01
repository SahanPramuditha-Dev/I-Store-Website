"""add max discount columns to inventory_items and product_variants

Revision ID: 20260801_0018
Revises: 20260729_0017
Create Date: 2026-08-01
"""

from alembic import op
import sqlalchemy as sa


revision = "20260801_0018"
down_revision = "20260729_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Add columns to inventory_items
    if "inventory_items" in inspector.get_table_names():
        existing_cols = {c["name"] for c in inspector.get_columns("inventory_items")}
        with op.batch_alter_table("inventory_items") as batch_op:
            if "max_discount_amount" not in existing_cols:
                batch_op.add_column(sa.Column("max_discount_amount", sa.Float(), nullable=True, server_default="0"))
                batch_op.create_index("ix_inventory_items_max_discount_amount", ["max_discount_amount"])
            if "max_discount_percent" not in existing_cols:
                batch_op.add_column(sa.Column("max_discount_percent", sa.Float(), nullable=True, server_default="0"))
                batch_op.create_index("ix_inventory_items_max_discount_percent", ["max_discount_percent"])

    # Add columns to product_variants
    if "product_variants" in inspector.get_table_names():
        existing_cols = {c["name"] for c in inspector.get_columns("product_variants")}
        with op.batch_alter_table("product_variants") as batch_op:
            if "max_discount_amount" not in existing_cols:
                batch_op.add_column(sa.Column("max_discount_amount", sa.Float(), nullable=True, server_default="0"))
                batch_op.create_index("ix_product_variants_max_discount_amount", ["max_discount_amount"])
            if "max_discount_percent" not in existing_cols:
                batch_op.add_column(sa.Column("max_discount_percent", sa.Float(), nullable=True, server_default="0"))
                batch_op.create_index("ix_product_variants_max_discount_percent", ["max_discount_percent"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "inventory_items" in inspector.get_table_names():
        existing_cols = {c["name"] for c in inspector.get_columns("inventory_items")}
        with op.batch_alter_table("inventory_items") as batch_op:
            if "max_discount_amount" in existing_cols:
                batch_op.drop_index("ix_inventory_items_max_discount_amount")
                batch_op.drop_column("max_discount_amount")
            if "max_discount_percent" in existing_cols:
                batch_op.drop_index("ix_inventory_items_max_discount_percent")
                batch_op.drop_column("max_discount_percent")

    if "product_variants" in inspector.get_table_names():
        existing_cols = {c["name"] for c in inspector.get_columns("product_variants")}
        with op.batch_alter_table("product_variants") as batch_op:
            if "max_discount_amount" in existing_cols:
                batch_op.drop_index("ix_product_variants_max_discount_amount")
                batch_op.drop_column("max_discount_amount")
            if "max_discount_percent" in existing_cols:
                batch_op.drop_index("ix_product_variants_max_discount_percent")
                batch_op.drop_column("max_discount_percent")
