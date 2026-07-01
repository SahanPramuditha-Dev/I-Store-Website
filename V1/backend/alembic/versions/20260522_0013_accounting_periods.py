"""accounting period close controls

Revision ID: 20260522_0013
Revises: 20260522_0012
Create Date: 2026-05-22
"""

from alembic import op
import sqlalchemy as sa


revision = "20260522_0013"
down_revision = "20260522_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "accounting_periods" in inspector.get_table_names():
        return
    op.create_table(
        "accounting_periods",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("period_code", sa.String(), nullable=True),
        sa.Column("start_date", sa.DateTime(), nullable=False),
        sa.Column("end_date", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(), nullable=True, server_default="open"),
        sa.Column("close_reason", sa.Text(), nullable=True),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("closed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("reopened_at", sa.DateTime(), nullable=True),
        sa.Column("reopened_by_user_id", sa.Integer(), nullable=True),
        sa.Column("reopen_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["closed_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["reopened_by_user_id"], ["users.id"]),
        sa.UniqueConstraint("period_code"),
    )
    op.create_index("ix_accounting_periods_period_code", "accounting_periods", ["period_code"])
    op.create_index("ix_accounting_periods_start_date", "accounting_periods", ["start_date"])
    op.create_index("ix_accounting_periods_end_date", "accounting_periods", ["end_date"])
    op.create_index("ix_accounting_periods_status", "accounting_periods", ["status"])
    op.create_index("ix_accounting_periods_closed_at", "accounting_periods", ["closed_at"])
    op.create_index("ix_accounting_periods_closed_by_user_id", "accounting_periods", ["closed_by_user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "accounting_periods" not in inspector.get_table_names():
        return
    op.drop_table("accounting_periods")
