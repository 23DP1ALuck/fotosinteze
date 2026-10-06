"""Create auth sessions table.

Revision ID: 7e4b8f2c1a90
Revises: cf14ed65f562
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7e4b8f2c1a90"
down_revision: Union[str, Sequence[str], None] = "cf14ed65f562"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "auth_sessions",
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("jti", sa.String(length=36), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.user_id"]),
        sa.PrimaryKeyConstraint("session_id"),
        sa.UniqueConstraint("jti"),
    )
    op.create_index(op.f("ix_auth_sessions_session_id"), "auth_sessions", ["session_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_auth_sessions_session_id"), table_name="auth_sessions")
    op.drop_table("auth_sessions")
