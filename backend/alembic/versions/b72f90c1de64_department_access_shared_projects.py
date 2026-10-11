"""Assign employees to departments and share projects across departments.

Revision ID: b72f90c1de64
Revises: a18c72e40b91
"""
from alembic import op
import sqlalchemy as sa

revision = 'b72f90c1de64'
down_revision = 'a18c72e40b91'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == 'sqlite' and bind.execute(sa.text('PRAGMA foreign_key_check')).first() is not None:
        raise RuntimeError('Foreign key violations exist in legacy data; repair orphan references before upgrading.')
    invalid = bind.execute(sa.text('''
        SELECT p.project_id FROM projects p
        LEFT JOIN departments d ON p.department_id = d.department_id
        WHERE p.department_id IS NOT NULL
          AND (d.department_id IS NULL OR p.workspace_id <> d.workspace_id)
        LIMIT 1
    ''')).first()
    if invalid is not None:
        raise RuntimeError('Legacy project department belongs to another workspace or is missing; repair links before upgrading.')
    legacy_links = bind.execute(sa.text('SELECT department_id, project_id, workspace_id FROM projects WHERE department_id IS NOT NULL')).mappings().all()
    with op.batch_alter_table('departments') as batch:
        batch.create_unique_constraint('uq_department_workspace', ['department_id', 'workspace_id'])
    # Reflect legacy unnamed SQLite foreign keys with a deterministic name.
    naming = {'fk': 'fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s'}
    department_fk = next(fk for fk in sa.inspect(bind).get_foreign_keys('projects') if fk['constrained_columns'] == ['department_id'])
    with op.batch_alter_table('projects', naming_convention=naming) as batch:
        batch.drop_constraint(department_fk['name'] or 'fk_projects_department_id_departments', type_='foreignkey')
        batch.drop_column('department_id')
        batch.create_unique_constraint('uq_project_workspace', ['project_id', 'workspace_id'])
    with op.batch_alter_table('workspace_users') as batch:
        batch.add_column(sa.Column('department_id', sa.Integer(), nullable=True))
        batch.create_foreign_key('fk_workspace_users_department', 'departments', ['department_id', 'workspace_id'], ['department_id', 'workspace_id'])
        batch.create_index('ix_workspace_users_department_id', ['department_id'])
    association = op.create_table(
        'department_projects',
        sa.Column('department_id', sa.Integer(), primary_key=True),
        sa.Column('project_id', sa.Integer(), primary_key=True),
        sa.Column('workspace_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['department_id', 'workspace_id'], ['departments.department_id', 'departments.workspace_id'], name='fk_department_projects_department', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id', 'workspace_id'], ['projects.project_id', 'projects.workspace_id'], name='fk_department_projects_project', ondelete='CASCADE'),
    )
    if legacy_links:
        op.bulk_insert(association, [dict(row) for row in legacy_links])
    if bind.dialect.name == 'sqlite' and bind.execute(sa.text('PRAGMA foreign_key_check')).first() is not None:
        raise RuntimeError('Foreign key violations exist after migration; repair legacy data.')


def downgrade():
    bind = op.get_bind()
    shared = bind.execute(sa.text('SELECT project_id FROM department_projects GROUP BY project_id HAVING count(*) > 1 LIMIT 1')).first()
    if shared is not None:
        raise RuntimeError('Cannot downgrade shared projects; remove additional department links first.')
    assigned = bind.execute(sa.text('SELECT user_id FROM workspace_users WHERE department_id IS NOT NULL LIMIT 1')).first()
    if assigned is not None:
        raise RuntimeError('Cannot downgrade while employee department assignments exist; explicitly clear assignments first.')
    # Check before any DDL so unsupported downgrade never loses data.
    with op.batch_alter_table('projects') as batch:
        batch.add_column(sa.Column('department_id', sa.Integer(), nullable=True))
        batch.create_foreign_key('fk_projects_department_id_departments', 'departments', ['department_id'], ['department_id'], ondelete='SET NULL')
    bind.execute(sa.text('UPDATE projects SET department_id = (SELECT department_id FROM department_projects WHERE department_projects.project_id = projects.project_id)'))
    op.drop_table('department_projects')
    with op.batch_alter_table('workspace_users') as batch:
        batch.drop_index('ix_workspace_users_department_id')
        batch.drop_constraint('fk_workspace_users_department', type_='foreignkey')
        batch.drop_column('department_id')
    with op.batch_alter_table('projects') as batch:
        batch.drop_constraint('uq_project_workspace', type_='unique')
    with op.batch_alter_table('departments') as batch:
        batch.drop_constraint('uq_department_workspace', type_='unique')
