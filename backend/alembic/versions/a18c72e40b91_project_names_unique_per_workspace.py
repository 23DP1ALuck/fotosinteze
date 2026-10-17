"""Make project names unique within each workspace.

Revision ID: a18c72e40b91
Revises: d209ed3f2490
"""
from alembic import op
import sqlalchemy as sa

revision = 'a18c72e40b91'
down_revision = 'd209ed3f2490'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    duplicate = bind.execute(sa.text(
        'SELECT workspace_id, name FROM projects GROUP BY workspace_id, name HAVING COUNT(*) > 1 LIMIT 1'
    )).first()
    if duplicate is not None:
        raise RuntimeError('Duplicate project names exist within a workspace; rename them before upgrading.')
    with op.batch_alter_table('projects') as batch:
        batch.drop_constraint('uq_department_project_name', type_='unique')
        batch.create_unique_constraint('uq_workspace_project_name', ['workspace_id', 'name'])


def downgrade():
    with op.batch_alter_table('projects') as batch:
        batch.drop_constraint('uq_workspace_project_name', type_='unique')
        batch.create_unique_constraint('uq_department_project_name', ['department_id', 'name'])
