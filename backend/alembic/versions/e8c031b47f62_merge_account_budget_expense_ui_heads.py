"""Merge account, workspace budget and restored expense UI migration heads.

Keep the original expense UI merge revision for checkouts which already applied
it before the task split; all paths converge without skipping schema updates.
"""
revision = 'e8c031b47f62'
down_revision = ('9c52e7a1bd30', '74448962612b', 'd4817a0e9c25')
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
