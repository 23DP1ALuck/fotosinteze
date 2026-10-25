"""Allow multiple external accounts per Revolut connection."""
from alembic import op
import sqlalchemy as sa

revision = 'd73e41a9c602'
down_revision = 'b49d02e71a63'
branch_labels = None
depends_on = None


def upgrade():
    unique = next(c for c in sa.inspect(op.get_bind()).get_unique_constraints('accounts')
                  if c['column_names'] == ['connection_id'])
    with op.batch_alter_table('accounts', naming_convention={'uq': 'uq_%(table_name)s_%(column_0_name)s'}) as batch:
        batch.drop_constraint(unique['name'] or 'uq_accounts_connection_id', type_='unique')
        batch.add_column(sa.Column('external_account_id', sa.String(255), nullable=True))
        batch.create_unique_constraint('uq_accounts_revolut_external', ['connection_id', 'external_account_id'])


def downgrade():
    if op.get_bind().execute(sa.text('SELECT connection_id FROM accounts WHERE connection_id IS NOT NULL GROUP BY connection_id HAVING COUNT(*) > 1')).first():
        raise RuntimeError('Cannot downgrade while a Revolut connection has multiple accounts')
    with op.batch_alter_table('accounts', naming_convention={'uq': 'uq_%(table_name)s_%(column_0_name)s'}) as batch:
        batch.drop_constraint('uq_accounts_revolut_external', type_='unique')
        batch.drop_column('external_account_id')
        batch.create_unique_constraint('uq_accounts_connection_id', ['connection_id'])
