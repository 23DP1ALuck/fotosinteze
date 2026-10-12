"""make budget category nullable

Revision ID: 4b7f1c2d9e0a
Revises: 293fee959397
Create Date: 2026-10-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4b7f1c2d9e0a"
down_revision: Union[str, Sequence[str], None] = "293fee959397"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("budgets") as batch_op:
        batch_op.alter_column(
            "category_id",
            existing_type=sa.Integer(),
            nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("budgets") as batch_op:
        batch_op.alter_column(
            "category_id",
            existing_type=sa.Integer(),
            nullable=False,
        )
