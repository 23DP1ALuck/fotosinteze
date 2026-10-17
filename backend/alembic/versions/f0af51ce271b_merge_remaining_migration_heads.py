"""merge remaining migration heads

Revision ID: f0af51ce271b
Revises: a6d4e9b217c0, e8c031b47f62
Create Date: 2026-10-16 14:06:03.639177

"""
from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = 'f0af51ce271b'
down_revision: Union[str, Sequence[str], None] = ('a6d4e9b217c0', 'e8c031b47f62')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
