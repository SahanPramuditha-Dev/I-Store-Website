"""generic approval requests

Revision ID: 20260522_0015
Revises: 20260522_0014
Create Date: 2026-05-22
"""

from alembic import op
import sqlalchemy as sa


revision = "20260522_0015"
down_revision = "20260522_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "approval_requests" in inspector.get_table_names():
        return
    op.create_table(
        "approval_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("request_code", sa.String(), nullable=False),
        sa.Column("module", sa.String(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("target_type", sa.String(), nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=True, server_default="pending"),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("payload_json", sa.Text(), nullable=True),
        sa.Column("requested_by_user_id", sa.Integer(), nullable=True),
        sa.Column("requested_at", sa.DateTime(), nullable=False),
        sa.Column("decided_by_user_id", sa.Integer(), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column("executed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("executed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["requested_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["decided_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["executed_by_user_id"], ["users.id"]),
        sa.UniqueConstraint("request_code"),
    )
    for column in [
        "request_code",
        "module",
        "action",
        "target_type",
        "target_id",
        "status",
        "requested_by_user_id",
        "requested_at",
        "decided_by_user_id",
        "decided_at",
        "executed_by_user_id",
        "executed_at",
        "created_at",
    ]:
        op.create_index(f"ix_approval_requests_{column}", "approval_requests", [column])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "approval_requests" not in inspector.get_table_names():
        return
    op.drop_table("approval_requests")
