"""Allow SQLite to generate account IDs while preserving existing records."""
from alembic import op
import sqlalchemy as sa

revision = '9c52e7a1bd30'
down_revision = '8a31d9e4c602'
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name == 'sqlite':
        with op.batch_alter_table('accounts') as batch:
            batch.alter_column('account_id', existing_type=sa.BigInteger(), type_=sa.Integer(), existing_nullable=False)


def downgrade():
    if op.get_bind().dialect.name == 'sqlite':
        with op.batch_alter_table('accounts') as batch:
            batch.alter_column('account_id', existing_type=sa.Integer(), type_=sa.BigInteger(), existing_nullable=False)
