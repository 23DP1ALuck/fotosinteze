"""Add a single main account per workspace."""
from alembic import op
import sqlalchemy as sa

revision = 'b49d02e71a63'
down_revision = 'c84b7a2e190d'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('accounts', sa.Column('is_main', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index('uq_accounts_main_per_workspace', 'accounts', ['workspace_id'], unique=True,
                    postgresql_where=sa.text('is_main = true'), sqlite_where=sa.text('is_main = 1'))


def downgrade():
    op.drop_index('uq_accounts_main_per_workspace', table_name='accounts')
    with op.batch_alter_table('accounts') as batch:
        batch.drop_column('is_main')
