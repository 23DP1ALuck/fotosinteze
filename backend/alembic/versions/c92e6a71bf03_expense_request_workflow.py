"""Complete business expense request fields and workflow states.

Revision ID: c92e6a71bf03
Revises: b72f90c1de64
"""
from alembic import op
import sqlalchemy as sa

revision = 'c92e6a71bf03'
down_revision = 'b72f90c1de64'
branch_labels = None
depends_on = None

NAMING = {'fk': 'fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s'}


def category_fk_name(bind):
    constraint = next(fk for fk in sa.inspect(bind).get_foreign_keys('expenses')
                      if fk['constrained_columns'] == ['category_id'])
    return constraint['name'] or 'fk_expenses_category_id_category'


def upgrade():
    bind = op.get_bind()
    # Stop before changing the schema if legacy rows need an explicit repair.
    if bind.dialect.name == 'sqlite' and bind.execute(sa.text('PRAGMA foreign_key_check')).first():
        raise RuntimeError('Repair existing foreign key violations before upgrading expenses.')
    if bind.execute(sa.text('SELECT expense_id FROM expenses WHERE category_id IS NULL LIMIT 1')).first():
        raise RuntimeError('Assign a category to every legacy expense before upgrading.')
    if bind.execute(sa.text("SELECT expense_id FROM expenses WHERE UPPER(CAST(status AS TEXT)) NOT IN ('PENDING','APPROVED','REJECTED') LIMIT 1")).first():
        raise RuntimeError('Repair invalid legacy expense status values before upgrading.')
    invalid = bind.execute(sa.text('''
        SELECT e.expense_id FROM expenses e
        JOIN workspaces w ON w.workspace_id = e.workspace_id
        LEFT JOIN workspace_users submitter ON submitter.user_id = e.submitted_by AND submitter.workspace_id = e.workspace_id
        LEFT JOIN workspace_users reviewer ON reviewer.user_id = e.reviewed_by AND reviewer.workspace_id = e.workspace_id
        LEFT JOIN departments d ON d.department_id = e.department_id
        LEFT JOIN projects p ON p.project_id = e.project_id
        LEFT JOIN category c ON c.category_id = e.category_id
        WHERE w.type <> 'BUSINESS' OR submitter.user_id IS NULL
           OR (e.reviewed_by IS NOT NULL AND (reviewer.user_id IS NULL OR reviewer.role <> 'OWNER'))
           OR (e.department_id IS NOT NULL AND d.workspace_id <> e.workspace_id)
           OR (e.project_id IS NOT NULL AND p.workspace_id <> e.workspace_id)
           OR c.workspace_id <> e.workspace_id
        LIMIT 1
    ''')).first()
    if invalid:
        raise RuntimeError('Repair legacy expense workspace, membership or reviewer references before upgrading.')
    if bind.dialect.name == 'postgresql':
        for old in ('pending', 'approved', 'rejected'):
            op.execute(sa.text(f"ALTER TYPE expensestatusenum RENAME VALUE '{old}' TO '{old.upper()}'"))
    else:
        bind.execute(sa.text('UPDATE expenses SET status = UPPER(status)'))
    fk_name = category_fk_name(bind)
    with op.batch_alter_table('expenses', naming_convention=NAMING) as batch:
        batch.alter_column('category_id', existing_type=sa.Integer(), nullable=False)
        # Store explicit uppercase states with a database check on all supported dialects.
        batch.alter_column('status', existing_type=sa.Enum('PENDING', 'APPROVED', 'REJECTED', name='expensestatusenum'),
                           type_=sa.String(8), existing_nullable=False, postgresql_using='status::text')
        batch.create_check_constraint('expense_status', "status IN ('PENDING','APPROVED','REJECTED')")
        batch.drop_constraint(fk_name, type_='foreignkey')
        batch.create_foreign_key('fk_expenses_category_id_category', 'category', ['category_id'], ['category_id'], ondelete='RESTRICT')
    if bind.dialect.name == 'sqlite' and bind.execute(sa.text('PRAGMA foreign_key_check')).first():
        raise RuntimeError('Foreign key violations exist after upgrading expenses.')


def downgrade():
    bind = op.get_bind()
    with op.batch_alter_table('expenses', naming_convention=NAMING) as batch:
        batch.drop_constraint('expense_status', type_='check')
        batch.alter_column('category_id', existing_type=sa.Integer(), nullable=True)
        batch.drop_constraint(category_fk_name(bind), type_='foreignkey')
        batch.create_foreign_key('fk_expenses_category_id_category', 'category', ['category_id'], ['category_id'], ondelete='SET NULL')
    bind.execute(sa.text('UPDATE expenses SET status = LOWER(status)'))
    if bind.dialect.name == 'postgresql':
        for old in ('pending', 'approved', 'rejected'):
            op.execute(sa.text(f"ALTER TYPE expensestatusenum RENAME VALUE '{old.upper()}' TO '{old}'"))
        op.alter_column('expenses', 'status', existing_type=sa.String(8),
                        type_=sa.Enum('pending', 'approved', 'rejected', name='expensestatusenum'),
                        postgresql_using='status::expensestatusenum')
