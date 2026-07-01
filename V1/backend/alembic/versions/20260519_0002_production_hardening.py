"""production hardening schema updates

Revision ID: 20260519_0002
Revises: 131d8685d2ab
Create Date: 2026-05-19
"""

from alembic import op
import sqlalchemy as sa


revision = "20260519_0002"
down_revision = "131d8685d2ab"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return any(col["name"] == column_name for col in _inspector().get_columns(table_name))


def _add_column_if_missing(table_name: str, column: sa.Column) -> None:
    if _has_column(table_name, column.name):
        return
    with op.batch_alter_table(table_name, schema=None) as batch_op:
        batch_op.add_column(column)


def _create_index_if_missing(index_name: str, table_name: str, columns: list[str]) -> None:
    indexes = _inspector().get_indexes(table_name) if _has_table(table_name) else []
    if any(idx.get("name") == index_name for idx in indexes):
        return
    op.create_index(index_name, table_name, columns, unique=False)


def upgrade() -> None:
    _add_column_if_missing("customers", sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default=sa.text("0")))
    _add_column_if_missing("customers", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("customers", sa.Column("deleted_by", sa.Integer(), nullable=True))
    _add_column_if_missing("customers", sa.Column("delete_reason", sa.Text(), nullable=True))
    _add_column_if_missing("customers", sa.Column("created_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("customers", sa.Column("updated_at", sa.DateTime(), nullable=True))

    _add_column_if_missing("suppliers", sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default=sa.text("0")))
    _add_column_if_missing("suppliers", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("suppliers", sa.Column("deleted_by", sa.Integer(), nullable=True))
    _add_column_if_missing("suppliers", sa.Column("delete_reason", sa.Text(), nullable=True))
    _add_column_if_missing("suppliers", sa.Column("created_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("suppliers", sa.Column("updated_at", sa.DateTime(), nullable=True))

    _add_column_if_missing("inventory_items", sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default=sa.text("0")))
    _add_column_if_missing("inventory_items", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("inventory_items", sa.Column("deleted_by", sa.Integer(), nullable=True))
    _add_column_if_missing("inventory_items", sa.Column("delete_reason", sa.Text(), nullable=True))
    _add_column_if_missing("inventory_items", sa.Column("created_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("inventory_items", sa.Column("updated_at", sa.DateTime(), nullable=True))

    _add_column_if_missing("repair_tickets", sa.Column("assigned_technician_user_id", sa.Integer(), nullable=True))
    _add_column_if_missing("repair_tickets", sa.Column("assigned_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("repair_tickets", sa.Column("estimate_status", sa.String(), nullable=True, server_default="draft"))
    _add_column_if_missing("repair_tickets", sa.Column("approval_status", sa.String(), nullable=True, server_default="pending"))
    _add_column_if_missing("repair_tickets", sa.Column("invoice_status", sa.String(), nullable=True, server_default="not_invoiced"))
    _add_column_if_missing("repair_tickets", sa.Column("payment_status", sa.String(), nullable=True, server_default="unpaid"))
    _add_column_if_missing("repair_tickets", sa.Column("delivery_status", sa.String(), nullable=True, server_default="not_delivered"))
    _add_column_if_missing("repair_tickets", sa.Column("outstanding_balance", sa.Float(), nullable=True, server_default="0"))
    _add_column_if_missing("repair_tickets", sa.Column("final_sale_id", sa.Integer(), nullable=True))
    _add_column_if_missing("repair_tickets", sa.Column("approved_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("repair_tickets", sa.Column("invoiced_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("repair_tickets", sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default=sa.text("0")))
    _add_column_if_missing("repair_tickets", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("repair_tickets", sa.Column("deleted_by", sa.Integer(), nullable=True))
    _add_column_if_missing("repair_tickets", sa.Column("delete_reason", sa.Text(), nullable=True))

    if _has_table("repair_tickets"):
        # Normalize legacy status values to canonical workflow statuses.
        op.execute(
            """
            UPDATE repair_tickets
            SET status = CASE
                WHEN lower(trim(coalesce(status, ''))) IN ('pending', 'received') THEN 'pending'
                WHEN lower(trim(coalesce(status, ''))) IN ('diagnosing') THEN 'diagnosing'
                WHEN lower(trim(coalesce(status, ''))) IN ('waiting for approval', 'waiting_for_approval', 'waiting approval') THEN 'waiting_for_approval'
                WHEN lower(trim(coalesce(status, ''))) IN ('waiting for parts', 'waiting_for_parts') THEN 'waiting_for_parts'
                WHEN lower(trim(coalesce(status, ''))) IN ('in progress', 'in-progress', 'repairing') THEN 'repairing'
                WHEN lower(trim(coalesce(status, ''))) IN ('quality checking', 'quality_checking', 'quality check') THEN 'quality_checking'
                WHEN lower(trim(coalesce(status, ''))) IN ('completed') THEN 'completed'
                WHEN lower(trim(coalesce(status, ''))) IN ('delivered') THEN 'delivered'
                WHEN lower(trim(coalesce(status, ''))) IN ('cancelled', 'canceled') THEN 'cancelled'
                ELSE status
            END
            """
        )

    _add_column_if_missing("sales", sa.Column("invoice_no", sa.String(), nullable=True))
    _add_column_if_missing("sales", sa.Column("repair_ticket_id", sa.Integer(), nullable=True))
    _add_column_if_missing("sales", sa.Column("amount_paid", sa.Float(), nullable=True, server_default="0"))
    _add_column_if_missing("sales", sa.Column("balance_due", sa.Float(), nullable=True, server_default="0"))
    _add_column_if_missing("sales", sa.Column("payment_status", sa.String(), nullable=True, server_default="paid"))

    _add_column_if_missing("sale_items", sa.Column("line_type", sa.String(), nullable=True, server_default="product"))
    _add_column_if_missing("sale_items", sa.Column("description", sa.Text(), nullable=True))

    _add_column_if_missing("inventory_serials", sa.Column("status", sa.String(), nullable=True, server_default="in_stock"))
    _add_column_if_missing("inventory_serials", sa.Column("sale_id", sa.Integer(), nullable=True))

    _add_column_if_missing("notifications", sa.Column("read_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("notifications", sa.Column("is_acknowledged", sa.Boolean(), nullable=True, server_default=sa.text("0")))
    _add_column_if_missing("notifications", sa.Column("acknowledged_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("notifications", sa.Column("acknowledged_by_user_id", sa.Integer(), nullable=True))
    _add_column_if_missing("notifications", sa.Column("severity", sa.String(), nullable=True, server_default="medium"))
    _add_column_if_missing("notifications", sa.Column("source_module", sa.String(), nullable=True))
    _add_column_if_missing("notifications", sa.Column("escalation_level", sa.Integer(), nullable=True, server_default="0"))
    _add_column_if_missing("notifications", sa.Column("due_at", sa.DateTime(), nullable=True))

    if not _has_table("number_sequences"):
        op.create_table(
            "number_sequences",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("entity", sa.String(), nullable=False),
            sa.Column("year", sa.Integer(), nullable=False),
            sa.Column("current_value", sa.Integer(), nullable=True, server_default="0"),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("entity", "year", name="uq_number_sequences_entity_year"),
        )

    if not _has_table("backup_records"):
        op.create_table(
            "backup_records",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("backup_code", sa.String(), nullable=False, unique=True),
            sa.Column("filename", sa.String(), nullable=False, unique=True),
            sa.Column("status", sa.String(), nullable=True, server_default="created"),
            sa.Column("backup_type", sa.String(), nullable=True, server_default="manual"),
            sa.Column("storage_target", sa.String(), nullable=True, server_default="local"),
            sa.Column("checksum", sa.String(), nullable=True),
            sa.Column("size_bytes", sa.Integer(), nullable=True),
            sa.Column("created_by_user_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("metadata_json", sa.Text(), nullable=True),
        )

    if not _has_table("restore_requests"):
        op.create_table(
            "restore_requests",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("request_code", sa.String(), nullable=False, unique=True),
            sa.Column("backup_record_id", sa.Integer(), nullable=False),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("status", sa.String(), nullable=True, server_default="pending_approval"),
            sa.Column("requested_by_user_id", sa.Integer(), nullable=False),
            sa.Column("requested_at", sa.DateTime(), nullable=True),
            sa.Column("executed_by_user_id", sa.Integer(), nullable=True),
            sa.Column("executed_at", sa.DateTime(), nullable=True),
            sa.Column("execution_result", sa.Text(), nullable=True),
        )

    if not _has_table("restore_approvals"):
        op.create_table(
            "restore_approvals",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("restore_request_id", sa.Integer(), nullable=False),
            sa.Column("decision", sa.String(), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("decided_by_user_id", sa.Integer(), nullable=False),
            sa.Column("decided_at", sa.DateTime(), nullable=True),
        )

    if not _has_table("restore_audit_events"):
        op.create_table(
            "restore_audit_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("restore_request_id", sa.Integer(), nullable=False),
            sa.Column("event_type", sa.String(), nullable=True),
            sa.Column("event_status", sa.String(), nullable=True, server_default="success"),
            sa.Column("actor_user_id", sa.Integer(), nullable=True),
            sa.Column("detail", sa.Text(), nullable=True),
            sa.Column("metadata_json", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )

    _create_index_if_missing("ix_sales_invoice_no", "sales", ["invoice_no"])
    _create_index_if_missing("ix_sales_repair_ticket_id", "sales", ["repair_ticket_id"])
    _create_index_if_missing("ix_sale_items_line_type", "sale_items", ["line_type"])
    _create_index_if_missing("ix_notifications_severity", "notifications", ["severity"])
    _create_index_if_missing("idx_activity_logs_created_at", "activity_logs", ["created_at"])
    _create_index_if_missing("idx_activity_logs_user_id", "activity_logs", ["user_id"])
    _create_index_if_missing("idx_security_audit_logs_created_at", "security_audit_logs", ["created_at"])
    _create_index_if_missing("idx_security_audit_logs_action", "security_audit_logs", ["action"])


def downgrade() -> None:
    # Intentionally conservative downgrade for production data safety.
    pass
