"""Create projects table.

Revision ID: e3a9b47c6d12
Revises: c41e8d2a9f73, dff14d94469b
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e3a9b47c6d12"
down_revision: Union[str, Sequence[str], None] = (
    "c41e8d2a9f73",
    "dff14d94469b",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("department_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=True),
        sa.Column("start_date", sa.DateTime(), nullable=True),
        sa.Column("end_date", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.workspace_id"]),
        sa.ForeignKeyConstraint(["department_id"], ["departments.department_id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("project_id"),
        sa.UniqueConstraint("department_id", "name", name="uq_department_project_name"),
    )
    op.create_index("ix_projects_project_id", "projects", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_projects_project_id", table_name="projects")
    op.drop_table("projects")
