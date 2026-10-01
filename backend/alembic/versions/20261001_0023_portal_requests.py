"""Verified customer requests. Apply before enabling the extended portal API."""
from alembic import op
import sqlalchemy as sa

revision = "20261001_0023"
down_revision = "20260923_0022"
branch_labels = None
depends_on = None


def upgrade():
    if "portal_service_requests" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table("portal_service_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=False),
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("customers.id"), nullable=False),
        sa.Column("receipt_sale_id", sa.Integer(), sa.ForeignKey("sales.id"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("related_id", sa.Integer(), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("requested_at", sa.DateTime(), nullable=True),
        sa.Column("staff_response", sa.Text(), nullable=True),
        sa.Column("reviewed_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False))
    for column in ("organization_id", "branch_id", "customer_id", "kind", "status"):
        op.create_index(f"ix_portal_service_requests_{column}", "portal_service_requests", [column])


def downgrade():
    op.drop_table("portal_service_requests")
