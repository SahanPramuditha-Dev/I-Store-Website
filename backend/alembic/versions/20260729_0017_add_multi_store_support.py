"""add multi store support tables and store_id foreign keys

Revision ID: 20260729_0017
Revises: 20260729_0016
Create Date: 2026-07-29
"""

from alembic import op
import sqlalchemy as sa


revision = "20260729_0017"
down_revision = "20260729_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    
    if "stores" not in inspector.get_table_names():
        op.create_table(
            "stores",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("location", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        )
        op.create_index("ix_stores_name", "stores", ["name"])
    
    # Add store_id nullable foreign key to affected tables for multi-tenant scalability
    tables_to_update = ["products", "inventory_items", "sales", "repairs", "customers", "payments"]
    for table in tables_to_update:
        if table in inspector.get_table_names():
            existing_cols = {c["name"] for c in inspector.get_columns(table)}
            if "store_id" not in existing_cols:
                with op.batch_alter_table(table) as batch_op:
                    batch_op.add_column(sa.Column("store_id", sa.Integer(), sa.ForeignKey("stores.id"), nullable=True))
                    batch_op.create_index(f"ix_{table}_store_id", ["store_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    
    tables_to_update = ["products", "inventory_items", "sales", "repairs", "customers", "payments"]
    for table in tables_to_update:
        if table in inspector.get_table_names():
            existing_cols = {c["name"] for c in inspector.get_columns(table)}
            if "store_id" in existing_cols:
                with op.batch_alter_table(table) as batch_op:
                    batch_op.drop_index(f"ix_{table}_store_id")
                    batch_op.drop_column("store_id")

    if "stores" in inspector.get_table_names():
        op.drop_table("stores")
