"""Merge the budget and expense workflow migration branches.

Revision ID: d4817a0e9c25
Revises: 4b7f1c2d9e0a, c92e6a71bf03
"""

from typing import Sequence, Union


revision: str = 'd4817a0e9c25'
down_revision: Union[str, Sequence[str], None] = ('4b7f1c2d9e0a', 'c92e6a71bf03')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
