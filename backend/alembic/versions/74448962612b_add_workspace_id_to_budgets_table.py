"""add workspace_id to budgets table

Revision ID: 74448962612b
Revises: 8a31d9e4c602
Create Date: 2026-10-14 15:06:04.293785

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '74448962612b'
down_revision: Union[str, Sequence[str], None] = '8a31d9e4c602'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = op.get_bind()
    budgets = connection.execute(sa.text("""
        SELECT b.budget_id, c.workspace_id, p.workspace_id, d.workspace_id
        FROM budgets b
        LEFT JOIN category c ON c.category_id = b.category_id
        LEFT JOIN projects p ON p.project_id = b.project_id
        LEFT JOIN departments d ON d.department_id = b.department_id
    """)).all()
    assignments = []
    for budget_id, *workspace_ids in budgets:
        workspace_ids = {value for value in workspace_ids if value is not None}
        if len(workspace_ids) != 1:
            raise RuntimeError(
                f"Budget {budget_id} needs links to exactly one workspace before migration"
            )
        assignments.append({"budget_id": budget_id, "workspace_id": workspace_ids.pop()})

    with op.batch_alter_table('budgets') as batch_op:
        batch_op.add_column(sa.Column('workspace_id', sa.Integer(), nullable=True))
    if assignments:
        connection.execute(sa.text(
            "UPDATE budgets SET workspace_id=:workspace_id WHERE budget_id=:budget_id"
        ), assignments)
    with op.batch_alter_table('budgets') as batch_op:
        batch_op.alter_column('workspace_id', existing_type=sa.Integer(), nullable=False)
        batch_op.create_foreign_key('fk_budgets_workspace_id', 'workspaces', ['workspace_id'], ['workspace_id'])


def downgrade() -> None:
    with op.batch_alter_table('budgets') as batch_op:
        batch_op.drop_constraint('fk_budgets_workspace_id', type_='foreignkey')
        batch_op.drop_column('workspace_id')
