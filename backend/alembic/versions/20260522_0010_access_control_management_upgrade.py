"""access control management upgrade

Revision ID: 20260522_0010
Revises: 20260521_0009
Create Date: 2026-05-22
"""

from alembic import op
import sqlalchemy as sa


revision = "20260522_0010"
down_revision = "20260521_0009"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return name in _inspector().get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    columns = _inspector().get_columns(table_name)
    return any(col.get("name") == column_name for col in columns)


def _add_column_if_missing(table_name: str, column: sa.Column) -> None:
    if not _has_table(table_name):
        return
    if _has_column(table_name, column.name):
        return
    op.add_column(table_name, column)


def _create_index_if_missing(index_name: str, table_name: str, columns: list[str], unique: bool = False) -> None:
    if not _has_table(table_name):
        return
    indexes = _inspector().get_indexes(table_name)
    if any(idx.get("name") == index_name for idx in indexes):
        return
    op.create_index(index_name, table_name, columns, unique=unique)


def upgrade() -> None:
    _add_column_if_missing("roles", sa.Column("created_by", sa.Integer(), nullable=True))
    _add_column_if_missing("roles", sa.Column("is_system_role", sa.Boolean(), nullable=True, server_default=sa.text("1")))
    _add_column_if_missing("roles", sa.Column("is_locked", sa.Boolean(), nullable=True, server_default=sa.text("0")))

    _add_column_if_missing("permissions", sa.Column("permission_key", sa.String(), nullable=True))
    _add_column_if_missing("permissions", sa.Column("is_sensitive", sa.Boolean(), nullable=True, server_default=sa.text("0")))

    _add_column_if_missing("user_permission_overrides", sa.Column("override_type", sa.String(), nullable=True))

    _add_column_if_missing("auth_sessions", sa.Column("session_token_hash", sa.String(), nullable=True))
    _add_column_if_missing("auth_sessions", sa.Column("login_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("auth_sessions", sa.Column("revoked_by", sa.Integer(), nullable=True))

    if not _has_table("permission_change_logs"):
        op.create_table(
            "permission_change_logs",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("changed_by", sa.Integer(), nullable=True),
            sa.Column("target_type", sa.String(), nullable=False),
            sa.Column("target_id", sa.Integer(), nullable=False),
            sa.Column("permission_id", sa.Integer(), nullable=True),
            sa.Column("old_value", sa.Text(), nullable=True),
            sa.Column("new_value", sa.Text(), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("session_id", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["changed_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["permission_id"], ["permissions.id"]),
        )

    if not _has_table("audit_logs"):
        op.create_table(
            "audit_logs",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("module", sa.String(), nullable=False),
            sa.Column("action", sa.String(), nullable=False),
            sa.Column("target_type", sa.String(), nullable=True),
            sa.Column("target_id", sa.Integer(), nullable=True),
            sa.Column("old_value", sa.Text(), nullable=True),
            sa.Column("new_value", sa.Text(), nullable=True),
            sa.Column("ip_address", sa.String(), nullable=True),
            sa.Column("device_name", sa.String(), nullable=True),
            sa.Column("session_id", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        )

    # Backfills
    if _has_table("permissions"):
        op.execute("UPDATE permissions SET permission_key = code WHERE permission_key IS NULL OR permission_key = ''")
    if _has_table("roles"):
        op.execute("UPDATE roles SET is_system_role = COALESCE(is_system, 1) WHERE is_system_role IS NULL")
        op.execute("UPDATE roles SET is_locked = COALESCE(is_protected, 0) WHERE is_locked IS NULL")
    if _has_table("user_permission_overrides"):
        op.execute("UPDATE user_permission_overrides SET override_type = COALESCE(effect, 'allow') WHERE override_type IS NULL OR override_type = ''")
    if _has_table("auth_sessions"):
        op.execute("UPDATE auth_sessions SET session_token_hash = token_jti WHERE session_token_hash IS NULL")
        op.execute("UPDATE auth_sessions SET login_at = login_time WHERE login_at IS NULL")
        op.execute("UPDATE auth_sessions SET revoked_by = revoked_by_user_id WHERE revoked_by IS NULL")

    # Indexes
    _create_index_if_missing("idx_roles_is_system_role", "roles", ["is_system_role"])
    _create_index_if_missing("idx_roles_is_locked", "roles", ["is_locked"])
    _create_index_if_missing("idx_permissions_permission_key", "permissions", ["permission_key"], unique=True)
    _create_index_if_missing("idx_permissions_is_sensitive", "permissions", ["is_sensitive"])
    _create_index_if_missing("idx_user_permission_overrides_override_type", "user_permission_overrides", ["override_type"])
    _create_index_if_missing("idx_auth_sessions_session_token_hash", "auth_sessions", ["session_token_hash"])
    _create_index_if_missing("idx_auth_sessions_login_at", "auth_sessions", ["login_at"])
    _create_index_if_missing("idx_auth_sessions_revoked_by", "auth_sessions", ["revoked_by"])
    _create_index_if_missing("idx_permission_change_logs_target", "permission_change_logs", ["target_type", "target_id"])
    _create_index_if_missing("idx_permission_change_logs_created_at", "permission_change_logs", ["created_at"])
    _create_index_if_missing("idx_audit_logs_module_action", "audit_logs", ["module", "action"])
    _create_index_if_missing("idx_audit_logs_created_at", "audit_logs", ["created_at"])


def downgrade() -> None:
    # Intentional no-op for destructive safety on local production SQLite deployments.
    pass

