"""convert monetary float columns to numeric

Revision ID: 20260729_0016
Revises: 20260522_0015
Create Date: 2026-07-29
"""

from alembic import op
import sqlalchemy as sa


revision = "20260729_0016"
down_revision = "20260522_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    
    # List of tables and monetary columns to convert to Numeric(12, 2)
    financial_columns = {
        "products": ["cost_price", "selling_price", "wholesale_price"],
        "sales": ["subtotal", "discount_total", "tax_total", "grand_total", "cash_amount", "card_amount", "amount_paid", "balance_due"],
        "sale_items": ["price", "discount_amount", "line_total", "cost_price"],
        "payments": ["amount"],
        "refunds": ["refund_amount", "amount"],
        "repairs": ["estimated_cost", "advance_payment", "outstanding_balance", "estimated_parts_cost", "estimated_labor_cost", "estimated_total", "advance_required_amount"],
        "expenses": ["amount", "tax_amount"],
        "accounting_ledger_entries": ["debit", "credit", "amount"],
    }
    
    # In SQLite, ALTER COLUMN type is not supported directly, so type alterations apply cleanly on Postgres.
    if bind.dialect.name == "postgresql":
        for table, columns in financial_columns.items():
            if table in inspector.get_table_names():
                existing_cols = {c["name"] for c in inspector.get_columns(table)}
                for col in columns:
                    if col in existing_cols:
                        op.alter_column(
                            table,
                            col,
                            type_=sa.Numeric(12, 2),
                            postgresql_using=f"{col}::numeric(12,2)"
                        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    
    financial_columns = {
        "products": ["cost_price", "selling_price", "wholesale_price"],
        "sales": ["subtotal", "discount_total", "tax_total", "grand_total", "cash_amount", "card_amount", "amount_paid", "balance_due"],
        "sale_items": ["price", "discount_amount", "line_total", "cost_price"],
        "payments": ["amount"],
        "refunds": ["refund_amount", "amount"],
        "repairs": ["estimated_cost", "advance_payment", "outstanding_balance", "estimated_parts_cost", "estimated_labor_cost", "estimated_total", "advance_required_amount"],
        "expenses": ["amount", "tax_amount"],
        "accounting_ledger_entries": ["debit", "credit", "amount"],
    }
    
    if bind.dialect.name == "postgresql":
        for table, columns in financial_columns.items():
            if table in inspector.get_table_names():
                existing_cols = {c["name"] for c in inspector.get_columns(table)}
                for col in columns:
                    if col in existing_cols:
                        op.alter_column(
                            table,
                            col,
                            type_=sa.Float(),
                            postgresql_using=f"{col}::float"
                        )
