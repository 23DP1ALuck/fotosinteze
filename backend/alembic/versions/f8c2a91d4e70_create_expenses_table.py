"""Create expenses table.

Revision ID: f8c2a91d4e70
Revises: e3a9b47c6d12
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f8c2a91d4e70"
down_revision: Union[str, Sequence[str], None] = "e3a9b47c6d12"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "expenses",
        sa.Column("expense_id", sa.Integer(), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("submitted_by", sa.Integer(), nullable=False),
        sa.Column("reviewed_by", sa.Integer(), nullable=True),
        sa.Column("department_id", sa.Integer(), nullable=True),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("status", sa.Enum("pending", "approved", "rejected", name="expensestatusenum"), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.workspace_id"]),
        sa.ForeignKeyConstraint(["submitted_by"], ["users.user_id"]),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.user_id"]),
        sa.ForeignKeyConstraint(["department_id"], ["departments.department_id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.project_id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["category_id"], ["category.category_id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("expense_id"),
    )
    op.create_index("ix_expenses_expense_id", "expenses", ["expense_id"])


def downgrade() -> None:
    op.drop_index("ix_expenses_expense_id", table_name="expenses")
    op.drop_table("expenses")
    sa.Enum("pending", "approved", "rejected", name="expensestatusenum").drop(op.get_bind(), checkfirst=True)
