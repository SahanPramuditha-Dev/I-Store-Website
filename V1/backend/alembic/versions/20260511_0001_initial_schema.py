"""initial schema

Revision ID: 20260511_0001
Revises:
Create Date: 2026-05-11
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "20260511_0001"
down_revision = None
branch_labels = None
depends_on = None


def _has_table(inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def _has_column(inspector, table_name: str, column_name: str) -> bool:
    return any(c["name"] == column_name for c in inspector.get_columns(table_name))


def _has_index(inspector, table_name: str, index_name: str) -> bool:
    return any(i["name"] == index_name for i in inspector.get_indexes(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if not _has_table(inspector, "users"):
        op.create_table(
            "users",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("username", sa.String(), nullable=True),
            sa.Column("full_name", sa.String(), nullable=True),
            sa.Column("password_hash", sa.String(), nullable=True),
            sa.Column("role", sa.String(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=True),
        )
        op.create_index("ix_users_username", "users", ["username"], unique=True)

    if not _has_table(inspector, "customers"):
        op.create_table(
            "customers",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(), nullable=True),
            sa.Column("phone", sa.String(), nullable=True),
            sa.Column("email", sa.String(), nullable=True),
            sa.Column("address", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_customers_name", "customers", ["name"], unique=False)
        op.create_index("ix_customers_phone", "customers", ["phone"], unique=False)

    if not _has_table(inspector, "suppliers"):
        op.create_table(
            "suppliers",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(), nullable=True),
            sa.Column("contact", sa.String(), nullable=True),
        )

    if not _has_table(inspector, "inventory_items"):
        op.create_table(
            "inventory_items",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(), nullable=True),
            sa.Column("category", sa.String(), nullable=True),
            sa.Column("sku", sa.String(), nullable=True),
            sa.Column("barcode", sa.String(), nullable=True),
            sa.Column("quantity", sa.Integer(), nullable=True),
            sa.Column("cost_price", sa.Float(), nullable=True),
            sa.Column("sale_price", sa.Float(), nullable=True),
            sa.Column("supplier_id", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"]),
            sa.CheckConstraint("quantity >= 0", name="ck_inventory_items_quantity_non_negative"),
        )
        op.create_index("ix_inventory_items_name", "inventory_items", ["name"], unique=False)
        op.create_index("ix_inventory_items_category", "inventory_items", ["category"], unique=False)
        op.create_index("ix_inventory_items_sku", "inventory_items", ["sku"], unique=True)

    if not _has_table(inspector, "repair_tickets"):
        op.create_table(
            "repair_tickets",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("ticket_no", sa.String(), nullable=True),
            sa.Column("customer_id", sa.Integer(), nullable=True),
            sa.Column("device_model", sa.String(), nullable=True),
            sa.Column("imei", sa.String(), nullable=True),
            sa.Column("issue", sa.Text(), nullable=True),
            sa.Column("status", sa.String(), nullable=True),
            sa.Column("technician", sa.String(), nullable=True),
            sa.Column("estimated_cost", sa.Float(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("delivered_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
        )
        op.create_index("ix_repair_tickets_ticket_no", "repair_tickets", ["ticket_no"], unique=True)
        op.create_index("ix_repair_tickets_imei", "repair_tickets", ["imei"], unique=False)

    if not _has_table(inspector, "sales"):
        op.create_table(
            "sales",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("customer_id", sa.Integer(), nullable=True),
            sa.Column("subtotal", sa.Float(), nullable=True),
            sa.Column("discount_amount", sa.Float(), nullable=True),
            sa.Column("tax_amount", sa.Float(), nullable=True),
            sa.Column("total", sa.Float(), nullable=True),
            sa.Column("is_return", sa.Boolean(), nullable=True),
            sa.Column("original_sale_id", sa.Integer(), nullable=True),
            sa.Column("payment_method", sa.String(), nullable=True),
            sa.Column("paid", sa.Boolean(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
            sa.ForeignKeyConstraint(["original_sale_id"], ["sales.id"]),
        )
    else:
        if not _has_column(inspector, "sales", "subtotal"):
            op.add_column("sales", sa.Column("subtotal", sa.Float(), server_default="0", nullable=True))
        if not _has_column(inspector, "sales", "discount_amount"):
            op.add_column("sales", sa.Column("discount_amount", sa.Float(), server_default="0", nullable=True))
        if not _has_column(inspector, "sales", "tax_amount"):
            op.add_column("sales", sa.Column("tax_amount", sa.Float(), server_default="0", nullable=True))
        if not _has_column(inspector, "sales", "is_return"):
            op.add_column("sales", sa.Column("is_return", sa.Boolean(), server_default="0", nullable=True))
        if not _has_column(inspector, "sales", "original_sale_id"):
            op.add_column("sales", sa.Column("original_sale_id", sa.Integer(), nullable=True))

    if not _has_table(inspector, "sale_items"):
        op.create_table(
            "sale_items",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("sale_id", sa.Integer(), nullable=True),
            sa.Column("item_id", sa.Integer(), nullable=True),
            sa.Column("quantity", sa.Integer(), nullable=True),
            sa.Column("price", sa.Float(), nullable=True),
            sa.Column("cost_price", sa.Float(), nullable=True),
            sa.Column("warranty_days", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["sale_id"], ["sales.id"]),
            sa.ForeignKeyConstraint(["item_id"], ["inventory_items.id"]),
        )

    if not _has_table(inspector, "stock_movements"):
        op.create_table(
            "stock_movements",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("item_id", sa.Integer(), nullable=True),
            sa.Column("movement_type", sa.String(), nullable=True),
            sa.Column("quantity", sa.Integer(), nullable=True),
            sa.Column("reference_type", sa.String(), nullable=True),
            sa.Column("reference_id", sa.Integer(), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["item_id"], ["inventory_items.id"]),
        )
        op.create_index("ix_stock_movements_item_id", "stock_movements", ["item_id"], unique=False)

    if not _has_table(inspector, "repair_part_usage"):
        op.create_table(
            "repair_part_usage",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("repair_id", sa.Integer(), nullable=True),
            sa.Column("item_id", sa.Integer(), nullable=True),
            sa.Column("quantity", sa.Integer(), nullable=True),
            sa.Column("unit_cost", sa.Float(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["repair_id"], ["repair_tickets.id"]),
            sa.ForeignKeyConstraint(["item_id"], ["inventory_items.id"]),
        )

    if not _has_table(inspector, "app_settings"):
        op.create_table(
            "app_settings",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("key", sa.String(), nullable=True),
            sa.Column("value", sa.Text(), nullable=True),
        )
        op.create_index("ix_app_settings_key", "app_settings", ["key"], unique=True)

    inspector = inspect(bind)
    if _has_table(inspector, "sales"):
        if not _has_index(inspector, "sales", "ix_sales_created_at"):
            op.create_index("ix_sales_created_at", "sales", ["created_at"], unique=False)
        if not _has_index(inspector, "sales", "ix_sales_customer_id"):
            op.create_index("ix_sales_customer_id", "sales", ["customer_id"], unique=False)
    if _has_table(inspector, "sale_items") and not _has_index(inspector, "sale_items", "ix_sale_items_item_id"):
        op.create_index("ix_sale_items_item_id", "sale_items", ["item_id"], unique=False)


def downgrade() -> None:
    # Initial migration should not drop existing user data automatically.
    pass
