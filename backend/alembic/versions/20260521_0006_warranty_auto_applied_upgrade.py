"""warranty auto-applied workflow upgrade

Revision ID: 20260521_0006
Revises: 20260520_0005
Create Date: 2026-05-21
"""

from alembic import op
import sqlalchemy as sa


revision = "20260521_0006"
down_revision = "20260520_0005"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    cols = _inspector().get_columns(table_name)
    return any(col.get("name") == column_name for col in cols)


def _add_column_if_missing(table_name: str, column: sa.Column) -> None:
    if not _has_table(table_name):
        return
    if _has_column(table_name, str(column.name)):
        return
    op.add_column(table_name, column)


def _create_index_if_missing(index_name: str, table_name: str, columns: list[str]) -> None:
    if not _has_table(table_name):
        return
    indexes = _inspector().get_indexes(table_name)
    if any(idx.get("name") == index_name for idx in indexes):
        return
    op.create_index(index_name, table_name, columns, unique=False)


def upgrade() -> None:
    # warranty_rules upgrades
    _add_column_if_missing("warranty_rules", sa.Column("rule_type", sa.String(), nullable=True))
    _add_column_if_missing("warranty_rules", sa.Column("category_id", sa.Integer(), nullable=True))
    _add_column_if_missing("warranty_rules", sa.Column("product_id", sa.Integer(), nullable=True))
    _add_column_if_missing("warranty_rules", sa.Column("variant_id", sa.String(), nullable=True))
    _add_column_if_missing("warranty_rules", sa.Column("serial_id", sa.Integer(), nullable=True))
    _add_column_if_missing("warranty_rules", sa.Column("repair_service_id", sa.String(), nullable=True))
    _add_column_if_missing("warranty_rules", sa.Column("warranty_duration_value", sa.Integer(), nullable=True, server_default="0"))
    _add_column_if_missing("warranty_rules", sa.Column("warranty_duration_unit", sa.String(), nullable=True, server_default="days"))
    _add_column_if_missing("warranty_rules", sa.Column("coverage_type", sa.String(), nullable=True, server_default="repair"))
    _add_column_if_missing("warranty_rules", sa.Column("priority", sa.Integer(), nullable=True, server_default="100"))
    _add_column_if_missing("warranty_rules", sa.Column("conditions_text", sa.Text(), nullable=True))
    _add_column_if_missing("warranty_rules", sa.Column("exclusion_text", sa.Text(), nullable=True))
    _add_column_if_missing("warranty_rules", sa.Column("created_by", sa.Integer(), nullable=True))
    _add_column_if_missing("warranty_rules", sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default=sa.text("0")))
    _add_column_if_missing("warranty_rules", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("warranty_rules", sa.Column("deleted_by", sa.Integer(), nullable=True))
    _add_column_if_missing("warranty_rules", sa.Column("delete_reason", sa.Text(), nullable=True))

    # warranty_records upgrades
    _add_column_if_missing("warranty_records", sa.Column("warranty_number", sa.String(), nullable=True))
    _add_column_if_missing("warranty_records", sa.Column("invoice_item_id", sa.Integer(), nullable=True))
    _add_column_if_missing("warranty_records", sa.Column("warranty_rule_id", sa.Integer(), nullable=True))
    _add_column_if_missing("warranty_records", sa.Column("product_id", sa.Integer(), nullable=True))
    _add_column_if_missing("warranty_records", sa.Column("variant_id", sa.String(), nullable=True))
    _add_column_if_missing("warranty_records", sa.Column("serial_id", sa.Integer(), nullable=True))
    _add_column_if_missing("warranty_records", sa.Column("imei", sa.String(), nullable=True))
    _add_column_if_missing("warranty_records", sa.Column("coverage_type", sa.String(), nullable=True, server_default="repair"))
    _add_column_if_missing("warranty_records", sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default=sa.text("0")))
    _add_column_if_missing("warranty_records", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("warranty_records", sa.Column("deleted_by", sa.Integer(), nullable=True))
    _add_column_if_missing("warranty_records", sa.Column("delete_reason", sa.Text(), nullable=True))

    # warranty_claims upgrades
    _add_column_if_missing("warranty_claims", sa.Column("claim_number", sa.String(), nullable=True))
    _add_column_if_missing("warranty_claims", sa.Column("customer_id", sa.Integer(), nullable=True))
    _add_column_if_missing("warranty_claims", sa.Column("claim_date", sa.DateTime(), nullable=True))
    _add_column_if_missing("warranty_claims", sa.Column("issue_description", sa.Text(), nullable=True))
    _add_column_if_missing("warranty_claims", sa.Column("technician_id", sa.Integer(), nullable=True))
    _add_column_if_missing("warranty_claims", sa.Column("inspection_notes", sa.Text(), nullable=True))
    _add_column_if_missing("warranty_claims", sa.Column("decision_status", sa.String(), nullable=True, server_default="pending_inspection"))
    _add_column_if_missing("warranty_claims", sa.Column("rejection_reason", sa.Text(), nullable=True))
    _add_column_if_missing("warranty_claims", sa.Column("resolution_type", sa.String(), nullable=True))
    _add_column_if_missing("warranty_claims", sa.Column("replacement_product_id", sa.Integer(), nullable=True))
    _add_column_if_missing("warranty_claims", sa.Column("replacement_serial_id", sa.Integer(), nullable=True))
    _add_column_if_missing("warranty_claims", sa.Column("linked_repair_ticket_id", sa.Integer(), nullable=True))
    _add_column_if_missing("warranty_claims", sa.Column("resolved_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("warranty_claims", sa.Column("created_by", sa.Integer(), nullable=True))
    _add_column_if_missing("warranty_claims", sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default=sa.text("0")))
    _add_column_if_missing("warranty_claims", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("warranty_claims", sa.Column("deleted_by", sa.Integer(), nullable=True))
    _add_column_if_missing("warranty_claims", sa.Column("delete_reason", sa.Text(), nullable=True))

    # new tables
    if not _has_table("warranty_claim_events"):
        op.create_table(
            "warranty_claim_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("claim_id", sa.Integer(), nullable=False, index=True),
            sa.Column("event_type", sa.String(), nullable=False, index=True),
            sa.Column("event_message", sa.Text(), nullable=True),
            sa.Column("old_status", sa.String(), nullable=True, index=True),
            sa.Column("new_status", sa.String(), nullable=True, index=True),
            sa.Column("performed_by", sa.Integer(), nullable=True, index=True),
            sa.Column("created_at", sa.DateTime(), nullable=True, index=True),
            sa.ForeignKeyConstraint(["claim_id"], ["warranty_claims.id"]),
            sa.ForeignKeyConstraint(["performed_by"], ["users.id"]),
        )

    if not _has_table("warranty_replacements"):
        op.create_table(
            "warranty_replacements",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("old_warranty_id", sa.Integer(), nullable=False, index=True),
            sa.Column("new_warranty_id", sa.Integer(), nullable=True, index=True),
            sa.Column("claim_id", sa.Integer(), nullable=False, index=True),
            sa.Column("old_product_id", sa.Integer(), nullable=True, index=True),
            sa.Column("new_product_id", sa.Integer(), nullable=True, index=True),
            sa.Column("old_serial_id", sa.Integer(), nullable=True, index=True),
            sa.Column("new_serial_id", sa.Integer(), nullable=True, index=True),
            sa.Column("replacement_reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True, index=True),
            sa.Column("created_by", sa.Integer(), nullable=True, index=True),
            sa.ForeignKeyConstraint(["old_warranty_id"], ["warranty_records.id"]),
            sa.ForeignKeyConstraint(["new_warranty_id"], ["warranty_records.id"]),
            sa.ForeignKeyConstraint(["claim_id"], ["warranty_claims.id"]),
            sa.ForeignKeyConstraint(["old_product_id"], ["inventory_items.id"]),
            sa.ForeignKeyConstraint(["new_product_id"], ["inventory_items.id"]),
            sa.ForeignKeyConstraint(["old_serial_id"], ["inventory_serials.id"]),
            sa.ForeignKeyConstraint(["new_serial_id"], ["inventory_serials.id"]),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        )

    if not _has_table("supplier_warranty_records"):
        op.create_table(
            "supplier_warranty_records",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("supplier_id", sa.Integer(), nullable=False, index=True),
            sa.Column("grn_id", sa.Integer(), nullable=False, index=True),
            sa.Column("product_id", sa.Integer(), nullable=False, index=True),
            sa.Column("serial_id", sa.Integer(), nullable=True, index=True),
            sa.Column("supplier_warranty_start", sa.DateTime(), nullable=True, index=True),
            sa.Column("supplier_warranty_end", sa.DateTime(), nullable=True, index=True),
            sa.Column("supplier_invoice_number", sa.String(), nullable=True, index=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True, index=True),
            sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"]),
            sa.ForeignKeyConstraint(["grn_id"], ["goods_received_notes.id"]),
            sa.ForeignKeyConstraint(["product_id"], ["inventory_items.id"]),
            sa.ForeignKeyConstraint(["serial_id"], ["inventory_serials.id"]),
        )

    _create_index_if_missing("idx_warranty_rules_rule_type_priority", "warranty_rules", ["rule_type", "priority"])
    _create_index_if_missing("idx_warranty_records_status_end_date", "warranty_records", ["status", "end_date"])
    _create_index_if_missing("idx_warranty_records_invoice_item_id", "warranty_records", ["invoice_item_id"])
    _create_index_if_missing("idx_warranty_records_warranty_number", "warranty_records", ["warranty_number"])
    _create_index_if_missing("idx_warranty_claims_decision_status", "warranty_claims", ["decision_status"])
    _create_index_if_missing("idx_warranty_claims_claim_number", "warranty_claims", ["claim_number"])


def downgrade() -> None:
    # no-op downgrade for production safety
    pass
