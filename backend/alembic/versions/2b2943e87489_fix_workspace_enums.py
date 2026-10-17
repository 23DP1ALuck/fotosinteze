"""fix workspace enums

Revision ID: 2b2943e87489
Revises: f94bb1b1f174
Create Date: 2026-10-04 14:40:22.058795

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2b2943e87489'
down_revision: Union[str, Sequence[str], None] = 'f94bb1b1f174'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema to uppercase enum values."""
    bind = op.get_bind()

    if bind.dialect.name == "postgresql":
        # Rename native PostgreSQL enum labels
        op.execute("ALTER TYPE workspacetypeenum RENAME VALUE 'personal' TO 'PERSONAL'")
        op.execute("ALTER TYPE workspacetypeenum RENAME VALUE 'business' TO 'BUSINESS'")
        op.execute("ALTER TYPE workspacerole RENAME VALUE 'owner' TO 'OWNER'")
        op.execute("ALTER TYPE workspacerole RENAME VALUE 'employee' TO 'EMPLOYEE'")
    else:
        # Update text/VARCHAR columns for SQLite, MySQL, etc.
        op.execute("UPDATE workspaces SET type = 'PERSONAL' WHERE type = 'personal'")
        op.execute("UPDATE workspaces SET type = 'BUSINESS' WHERE type = 'business'")
        op.execute("UPDATE workspace_users SET role = 'OWNER' WHERE role = 'owner'")
        op.execute("UPDATE workspace_users SET role = 'EMPLOYEE' WHERE role = 'employee'")


def downgrade() -> None:
    """Downgrade schema back to lowercase enum values."""
    bind = op.get_bind()

    if bind.dialect.name == "postgresql":
        # Restore native PostgreSQL enum labels
        op.execute("ALTER TYPE workspacetypeenum RENAME VALUE 'PERSONAL' TO 'personal'")
        op.execute("ALTER TYPE workspacetypeenum RENAME VALUE 'BUSINESS' TO 'business'")
        op.execute("ALTER TYPE workspacerole RENAME VALUE 'OWNER' TO 'owner'")
        op.execute("ALTER TYPE workspacerole RENAME VALUE 'EMPLOYEE' TO 'employee'")
    else:
        # Restore text/VARCHAR columns
        op.execute("UPDATE workspaces SET type = 'personal' WHERE type = 'PERSONAL'")
        op.execute("UPDATE workspaces SET type = 'business' WHERE type = 'BUSINESS'")
        op.execute("UPDATE workspace_users SET role = 'owner' WHERE role = 'OWNER'")
        op.execute("UPDATE workspace_users SET role = 'employee' WHERE role = 'EMPLOYEE'")