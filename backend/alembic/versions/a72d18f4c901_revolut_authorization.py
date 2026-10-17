"""Merge existing heads and add authorization state to Revolut connections."""
from alembic import op
import sqlalchemy as sa

revision = 'a72d18f4c901'
down_revision = ('74448962612b', '9c52e7a1bd30')
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    # Infer legacy ownership only from existing account links, never from the user's memberships.
    rows = connection.execute(sa.text("""
        SELECT c.revolut_connection_id, a.workspace_id, w.type
        FROM revolut_connections c JOIN accounts a ON a.connection_id = c.revolut_connection_id
        JOIN workspaces w ON w.workspace_id = a.workspace_id
    """)).all()
    linked = {}
    for connection_id, workspace_id, workspace_type in rows:
        linked.setdefault(connection_id, set()).add((workspace_id, workspace_type))
    assignments = []
    assigned_workspaces = set()
    for connection_id, targets in linked.items():
        if len(targets) != 1:
            raise RuntimeError('Repair Revolut connections shared across workspaces before migration')
        workspace_id, workspace_type = next(iter(targets))
        if workspace_type != 'PERSONAL':
            continue
        if workspace_id in assigned_workspaces:
            raise RuntimeError('Repair duplicate Revolut connections in a Personal Workspace before migration')
        assigned_workspaces.add(workspace_id)
        assignments.append(dict(connection_id=connection_id, workspace_id=workspace_id))
    with op.batch_alter_table('revolut_connections') as batch:
        batch.add_column(sa.Column('workspace_id', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('authorization_state_hash', sa.String(64), nullable=True))
        batch.add_column(sa.Column('authorization_browser_hash', sa.String(64), nullable=True))
        batch.add_column(sa.Column('authorization_nonce', sa.String(64), nullable=True))
        batch.add_column(sa.Column('authorization_expires_at', sa.DateTime(), nullable=True))
        batch.add_column(sa.Column('authorization_status', sa.String(20), nullable=True))
        batch.add_column(sa.Column('authorization_user_id', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('pending_consent_id', sa.String(255), nullable=True))
        batch.add_column(sa.Column('refresh_token_expires_at', sa.DateTime(), nullable=True))
        batch.create_foreign_key('fk_revolut_workspace', 'workspaces', ['workspace_id'], ['workspace_id'], ondelete='CASCADE')
        batch.create_foreign_key('fk_revolut_authorization_user', 'users', ['authorization_user_id'], ['user_id'])
        batch.create_unique_constraint('uq_revolut_workspace', ['workspace_id'])
        batch.create_unique_constraint('uq_revolut_authorization_state', ['authorization_state_hash'])

    if assignments:
        connection.execute(sa.text('UPDATE revolut_connections SET workspace_id=:workspace_id '
                                   'WHERE revolut_connection_id=:connection_id'), assignments)


def downgrade():
    with op.batch_alter_table('revolut_connections') as batch:
        batch.drop_constraint('uq_revolut_authorization_state', type_='unique')
        batch.drop_constraint('uq_revolut_workspace', type_='unique')
        batch.drop_constraint('fk_revolut_authorization_user', type_='foreignkey')
        batch.drop_constraint('fk_revolut_workspace', type_='foreignkey')
        for field in ('refresh_token_expires_at', 'pending_consent_id', 'authorization_user_id',
                      'authorization_status', 'authorization_expires_at', 'authorization_nonce',
                      'authorization_browser_hash', 'authorization_state_hash', 'workspace_id'):
            batch.drop_column(field)
