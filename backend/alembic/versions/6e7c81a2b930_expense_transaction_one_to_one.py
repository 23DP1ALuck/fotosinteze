"""Enforce one transaction per expense.

Revision ID: 6e7c81a2b930
Revises: 4b7f1c2d9e0a
"""
from alembic import op
import sqlalchemy as sa

revision = '6e7c81a2b930'
down_revision = '4b7f1c2d9e0a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    duplicate = op.get_bind().execute(sa.text(
        'SELECT expense_id FROM transactions WHERE expense_id IS NOT NULL '
        'GROUP BY expense_id HAVING COUNT(*) > 1 LIMIT 1'
    )).first()
    if duplicate is not None:
        raise RuntimeError(
            'An expense has multiple transactions; resolve duplicate expense links before upgrading.'
        )
    with op.batch_alter_table('transactions') as batch_op:
        batch_op.create_unique_constraint('uq_transaction_expense', ['expense_id'])


def downgrade() -> None:
    with op.batch_alter_table('transactions') as batch_op:
        batch_op.drop_constraint('uq_transaction_expense', type_='unique')
