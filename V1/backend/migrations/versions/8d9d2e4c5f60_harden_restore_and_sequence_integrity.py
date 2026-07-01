"""Harden restore workflow and sequence integrity

Revision ID: 8d9d2e4c5f60
Revises: 131d8685d2ab
Create Date: 2026-05-20 12:20:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "8d9d2e4c5f60"
down_revision: Union[str, Sequence[str], None] = "131d8685d2ab"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def _has_column(inspector, table_name: str, column_name: str) -> bool:
    return any(col.get("name") == column_name for col in inspector.get_columns(table_name))


def _has_index(inspector, table_name: str, index_name: str) -> bool:
    return any(idx.get("name") == index_name for idx in inspector.get_indexes(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_table(inspector, "sales"):
        if not _has_column(inspector, "sales", "invoice_no"):
            op.add_column("sales", sa.Column("invoice_no", sa.String(), nullable=True))
        if not _has_column(inspector, "sales", "repair_ticket_id"):
            op.add_column("sales", sa.Column("repair_ticket_id", sa.Integer(), nullable=True))
        if not _has_column(inspector, "sales", "amount_paid"):
            op.add_column("sales", sa.Column("amount_paid", sa.Float(), nullable=True, server_default=sa.text("0")))
        if not _has_column(inspector, "sales", "balance_due"):
            op.add_column("sales", sa.Column("balance_due", sa.Float(), nullable=True, server_default=sa.text("0")))
        if not _has_column(inspector, "sales", "payment_status"):
            op.add_column("sales", sa.Column("payment_status", sa.String(), nullable=True, server_default=sa.text("'paid'")))

    if _has_table(inspector, "sale_items"):
        if not _has_column(inspector, "sale_items", "line_type"):
            op.add_column("sale_items", sa.Column("line_type", sa.String(), nullable=True, server_default=sa.text("'product'")))
        if not _has_column(inspector, "sale_items", "description"):
            op.add_column("sale_items", sa.Column("description", sa.Text(), nullable=True))

    if _has_table(inspector, "repair_tickets"):
        repair_columns = {
            "assigned_technician_user_id": sa.Integer(),
            "assigned_at": sa.DateTime(),
            "estimate_status": sa.String(),
            "approval_status": sa.String(),
            "invoice_status": sa.String(),
            "payment_status": sa.String(),
            "delivery_status": sa.String(),
            "outstanding_balance": sa.Float(),
            "final_sale_id": sa.Integer(),
            "approved_at": sa.DateTime(),
            "invoiced_at": sa.DateTime(),
            "is_deleted": sa.Boolean(),
            "deleted_at": sa.DateTime(),
            "deleted_by": sa.Integer(),
            "delete_reason": sa.Text(),
        }
        for column_name, column_type in repair_columns.items():
            if not _has_column(inspector, "repair_tickets", column_name):
                op.add_column("repair_tickets", sa.Column(column_name, column_type, nullable=True))

        # Normalize legacy repair status text values to canonical enum values.
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

    if not _has_table(inspector, "number_sequences"):
        op.create_table(
            "number_sequences",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("entity", sa.String(), nullable=True),
            sa.Column("year", sa.Integer(), nullable=True),
            sa.Column("current_value", sa.Integer(), nullable=True, server_default=sa.text("0")),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("entity", "year", name="uq_number_sequences_entity_year"),
        )
    if _has_table(inspector, "number_sequences"):
        if not _has_index(inspector, "number_sequences", "ix_number_sequences_entity"):
            op.create_index("ix_number_sequences_entity", "number_sequences", ["entity"], unique=False)
        if not _has_index(inspector, "number_sequences", "ix_number_sequences_year"):
            op.create_index("ix_number_sequences_year", "number_sequences", ["year"], unique=False)
        if not _has_index(inspector, "number_sequences", "ix_number_sequences_updated_at"):
            op.create_index("ix_number_sequences_updated_at", "number_sequences", ["updated_at"], unique=False)

    if not _has_table(inspector, "backup_records"):
        op.create_table(
            "backup_records",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("backup_code", sa.String(), nullable=True),
            sa.Column("filename", sa.String(), nullable=True),
            sa.Column("status", sa.String(), nullable=True, server_default=sa.text("'created'")),
            sa.Column("backup_type", sa.String(), nullable=True, server_default=sa.text("'manual'")),
            sa.Column("storage_target", sa.String(), nullable=True, server_default=sa.text("'local'")),
            sa.Column("checksum", sa.String(), nullable=True),
            sa.Column("size_bytes", sa.Integer(), nullable=True),
            sa.Column("created_by_user_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("metadata_json", sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("backup_code"),
            sa.UniqueConstraint("filename"),
        )
    if _has_table(inspector, "backup_records"):
        for index_name, columns in [
            ("ix_backup_records_backup_code", ["backup_code"]),
            ("ix_backup_records_filename", ["filename"]),
            ("ix_backup_records_status", ["status"]),
            ("ix_backup_records_backup_type", ["backup_type"]),
            ("ix_backup_records_storage_target", ["storage_target"]),
            ("ix_backup_records_created_by_user_id", ["created_by_user_id"]),
            ("ix_backup_records_created_at", ["created_at"]),
        ]:
            if not _has_index(inspector, "backup_records", index_name):
                op.create_index(index_name, "backup_records", columns, unique=False)

    if not _has_table(inspector, "restore_requests"):
        op.create_table(
            "restore_requests",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("request_code", sa.String(), nullable=True),
            sa.Column("backup_record_id", sa.Integer(), nullable=False),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("status", sa.String(), nullable=True, server_default=sa.text("'pending_approval'")),
            sa.Column("requested_by_user_id", sa.Integer(), nullable=False),
            sa.Column("requested_at", sa.DateTime(), nullable=True),
            sa.Column("executed_by_user_id", sa.Integer(), nullable=True),
            sa.Column("executed_at", sa.DateTime(), nullable=True),
            sa.Column("execution_result", sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(["backup_record_id"], ["backup_records.id"]),
            sa.ForeignKeyConstraint(["requested_by_user_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["executed_by_user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("request_code"),
        )
    if _has_table(inspector, "restore_requests"):
        for index_name, columns in [
            ("ix_restore_requests_request_code", ["request_code"]),
            ("ix_restore_requests_backup_record_id", ["backup_record_id"]),
            ("ix_restore_requests_status", ["status"]),
            ("ix_restore_requests_requested_by_user_id", ["requested_by_user_id"]),
            ("ix_restore_requests_requested_at", ["requested_at"]),
            ("ix_restore_requests_executed_by_user_id", ["executed_by_user_id"]),
            ("ix_restore_requests_executed_at", ["executed_at"]),
        ]:
            if not _has_index(inspector, "restore_requests", index_name):
                op.create_index(index_name, "restore_requests", columns, unique=False)

    if not _has_table(inspector, "restore_approvals"):
        op.create_table(
            "restore_approvals",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("restore_request_id", sa.Integer(), nullable=False),
            sa.Column("decision", sa.String(), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("decided_by_user_id", sa.Integer(), nullable=False),
            sa.Column("decided_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["restore_request_id"], ["restore_requests.id"]),
            sa.ForeignKeyConstraint(["decided_by_user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    if _has_table(inspector, "restore_approvals"):
        for index_name, columns in [
            ("ix_restore_approvals_restore_request_id", ["restore_request_id"]),
            ("ix_restore_approvals_decision", ["decision"]),
            ("ix_restore_approvals_decided_by_user_id", ["decided_by_user_id"]),
            ("ix_restore_approvals_decided_at", ["decided_at"]),
        ]:
            if not _has_index(inspector, "restore_approvals", index_name):
                op.create_index(index_name, "restore_approvals", columns, unique=False)

    if not _has_table(inspector, "restore_audit_events"):
        op.create_table(
            "restore_audit_events",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("restore_request_id", sa.Integer(), nullable=False),
            sa.Column("event_type", sa.String(), nullable=True),
            sa.Column("event_status", sa.String(), nullable=True, server_default=sa.text("'success'")),
            sa.Column("actor_user_id", sa.Integer(), nullable=True),
            sa.Column("detail", sa.Text(), nullable=True),
            sa.Column("metadata_json", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["restore_request_id"], ["restore_requests.id"]),
            sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    if _has_table(inspector, "restore_audit_events"):
        for index_name, columns in [
            ("ix_restore_audit_events_restore_request_id", ["restore_request_id"]),
            ("ix_restore_audit_events_event_type", ["event_type"]),
            ("ix_restore_audit_events_event_status", ["event_status"]),
            ("ix_restore_audit_events_actor_user_id", ["actor_user_id"]),
            ("ix_restore_audit_events_created_at", ["created_at"]),
        ]:
            if not _has_index(inspector, "restore_audit_events", index_name):
                op.create_index(index_name, "restore_audit_events", columns, unique=False)

    op.execute("CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs (created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_security_audit_logs_created_at ON security_audit_logs (created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_security_audit_logs_action ON security_audit_logs (action)")


def downgrade() -> None:
    # Intentionally non-destructive for production safety.
    pass
