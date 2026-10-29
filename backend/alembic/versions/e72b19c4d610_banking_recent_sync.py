"""Encrypted pending snapshot and shared bank refresh cooldown."""
from alembic import op
import sqlalchemy as sa
revision='e72b19c4d610'
down_revision='d410e82b6c57'
branch_labels=None
depends_on=None


def upgrade():
    for name, kind in [('pending_transactions_encrypted', sa.Text()), ('sync_started_at', sa.DateTime()),
                       ('sync_retry_at', sa.DateTime()), ('sync_lease_until', sa.DateTime())]:
        op.add_column('enable_banking_connections', sa.Column(name,kind,nullable=True))


def downgrade():
    with op.batch_alter_table('enable_banking_connections') as batch:
        for name in ('pending_transactions_encrypted','sync_started_at','sync_retry_at','sync_lease_until'):
            batch.drop_column(name)
