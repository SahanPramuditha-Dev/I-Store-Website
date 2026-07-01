"""Legacy revision bridge for older local databases.

Revision ID: 131d8685d2ab
Revises: e9053aafee3c
Create Date: 2026-05-21 16:05:00
"""

# This migration intentionally does not alter schema.
# It provides a compatible Alembic graph node for databases that were
# previously stamped/applied on a legacy migration path using revision
# 131d8685d2ab.

revision = "131d8685d2ab"
down_revision = "e9053aafee3c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
