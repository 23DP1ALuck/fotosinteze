"""Enable Banking sessions and account/transaction identity."""
from alembic import op
import sqlalchemy as sa
revision = 'e14a86c72d39'
down_revision = 'd73e41a9c602'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('enable_banking_connections',
        sa.Column('connection_id',sa.Integer(),primary_key=True),
        sa.Column('workspace_id',sa.Integer(),sa.ForeignKey('workspaces.workspace_id',ondelete='CASCADE'),nullable=False,unique=True),
        sa.Column('connected_by_id',sa.Integer(),sa.ForeignKey('users.user_id'),nullable=False),
        sa.Column('session_encrypted',sa.Text(),nullable=True),
        sa.Column('expires_at',sa.DateTime(),nullable=True),
        sa.Column('last_sync_at',sa.DateTime(),nullable=True),
        sa.Column('state_hash',sa.String(64),unique=True,nullable=True),
        sa.Column('browser_hash',sa.String(64),nullable=True),
        sa.Column('pending_expires_at',sa.DateTime(),nullable=True),
        sa.Column('pending_status',sa.String(20),nullable=True),
        sa.Column('pending_user_id',sa.Integer(),sa.ForeignKey('users.user_id'),nullable=True))
    with op.batch_alter_table('accounts') as batch:
        batch.add_column(sa.Column('banking_connection_id',sa.Integer(),nullable=True))
        batch.create_foreign_key('fk_accounts_enable_banking','enable_banking_connections',['banking_connection_id'],['connection_id'],ondelete='SET NULL')
        batch.create_unique_constraint('uq_accounts_enable_external',['banking_connection_id','external_account_id'])
    # A unique index avoids rebuilding the large transaction table on SQLite.
    op.create_index('uq_transaction_bank_external','transactions',['account_id','external_transaction_id'],unique=True)


def downgrade():
    if op.get_bind().execute(sa.text('SELECT 1 FROM accounts WHERE banking_connection_id IS NOT NULL LIMIT 1')).first():
        raise RuntimeError('Disconnect and preserve imported banking accounts before downgrade')
    op.drop_index('uq_transaction_bank_external',table_name='transactions')
    with op.batch_alter_table('accounts') as batch:
        batch.drop_constraint('uq_accounts_enable_external',type_='unique')
        batch.drop_constraint('fk_accounts_enable_banking',type_='foreignkey')
        batch.drop_column('banking_connection_id')
    op.drop_table('enable_banking_connections')
