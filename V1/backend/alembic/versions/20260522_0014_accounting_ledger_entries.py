"""accounting ledger entries

Revision ID: 20260522_0014
Revises: 20260522_0013
Create Date: 2026-05-22
"""

from alembic import op
import sqlalchemy as sa


revision = "20260522_0014"
down_revision = "20260522_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "accounting_ledger_entries" not in inspector.get_table_names():
        op.create_table(
            "accounting_ledger_entries",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("entry_number", sa.String(), nullable=False),
            sa.Column("entry_date", sa.DateTime(), nullable=False),
            sa.Column("module", sa.String(), nullable=False),
            sa.Column("entry_type", sa.String(), nullable=False),
            sa.Column("direction", sa.String(), nullable=False),
            sa.Column("amount", sa.Float(), nullable=False),
            sa.Column("currency", sa.String(), nullable=True, server_default="LKR"),
            sa.Column("account_code", sa.String(), nullable=True),
            sa.Column("counterparty_type", sa.String(), nullable=True),
            sa.Column("counterparty_id", sa.Integer(), nullable=True),
            sa.Column("counterparty_name", sa.String(), nullable=True),
            sa.Column("reference_type", sa.String(), nullable=True),
            sa.Column("reference_id", sa.Integer(), nullable=True),
            sa.Column("reference_number", sa.String(), nullable=True),
            sa.Column("source_table", sa.String(), nullable=True),
            sa.Column("source_id", sa.Integer(), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("metadata_json", sa.Text(), nullable=True),
            sa.Column("created_by_user_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.CheckConstraint("amount >= 0", name="ck_accounting_ledger_amount_non_negative"),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
            sa.UniqueConstraint("entry_number", name="uq_accounting_ledger_entry_number"),
        )
        for column in [
            "entry_number",
            "entry_date",
            "module",
            "entry_type",
            "direction",
            "account_code",
            "counterparty_type",
            "counterparty_id",
            "reference_type",
            "reference_id",
            "reference_number",
            "source_table",
            "source_id",
            "created_by_user_id",
            "created_at",
        ]:
            op.create_index(f"ix_accounting_ledger_entries_{column}", "accounting_ledger_entries", [column])
    op.execute(
        """
        CREATE TRIGGER IF NOT EXISTS trg_accounting_ledger_entries_no_update
        BEFORE UPDATE ON accounting_ledger_entries
        BEGIN
            SELECT RAISE(ABORT, 'accounting ledger entries are immutable');
        END
        """
    )
    op.execute(
        """
        CREATE TRIGGER IF NOT EXISTS trg_accounting_ledger_entries_no_delete
        BEFORE DELETE ON accounting_ledger_entries
        BEGIN
            SELECT RAISE(ABORT, 'accounting ledger entries are immutable');
        END
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "accounting_ledger_entries" not in inspector.get_table_names():
        return
    op.execute("DROP TRIGGER IF EXISTS trg_accounting_ledger_entries_no_update")
    op.execute("DROP TRIGGER IF EXISTS trg_accounting_ledger_entries_no_delete")
    op.drop_table("accounting_ledger_entries")
