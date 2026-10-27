"""Allow shared categories without a workspace."""
from alembic import op
import sqlalchemy as sa

revision = 'c30d921a8f04'
down_revision = 'e14a86c72d39'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('category') as batch:
        batch.alter_column('workspace_id', existing_type=sa.Integer(), nullable=True)


def downgrade():
    if op.get_bind().execute(sa.text('SELECT 1 FROM category WHERE workspace_id IS NULL LIMIT 1')).first():
        raise RuntimeError('Cannot restore required workspace while shared categories exist')
    with op.batch_alter_table('category') as batch:
        batch.alter_column('workspace_id', existing_type=sa.Integer(), nullable=False)
