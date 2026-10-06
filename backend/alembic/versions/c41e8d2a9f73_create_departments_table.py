"""Create departments table.

Revision ID: c41e8d2a9f73
Revises: af303b269fbe
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c41e8d2a9f73"
down_revision: Union[str, Sequence[str], None] = "af303b269fbe"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "departments",
        sa.Column("department_id", sa.Integer(), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.workspace_id"]),
        sa.PrimaryKeyConstraint("department_id"),
        sa.UniqueConstraint("workspace_id", "name", name="uq_workspace_department_name"),
    )
    op.create_index("ix_departments_department_id", "departments", ["department_id"])


def downgrade() -> None:
    op.drop_index("ix_departments_department_id", table_name="departments")
    op.drop_table("departments")
