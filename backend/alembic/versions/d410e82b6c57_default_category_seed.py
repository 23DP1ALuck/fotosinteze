"""Seed 20 shared default categories and their icons."""
from alembic import op
import sqlalchemy as sa

revision = 'd410e82b6c57'
down_revision = 'c30d921a8f04'
branch_labels = None
depends_on = None

DEFAULT_CATEGORIES = [
    ('Groceries', 'expense', '🛒'),
    ('Shopping', 'expense', '🛍️'),
    ('Restaurants', 'expense', '🍽️'),
    ('Transportation', 'expense', '🚌'),
    ('Travel', 'expense', '✈️'),
    ('Entertainment', 'expense', '🎮'),
    ('Health', 'expense', '❤️'),
    ('Services', 'expense', '💼'),
    ('General', 'expense', '🪙'),
    ('Utilities', 'expense', '🏠'),
    ('Cash', 'expense', '💵'),
    ('Transfers', 'expense', '↔️'),
    ('Insurance', 'expense', '☂️'),
    ('Trading', 'expense', '📊'),
    ('Refund', 'income', '↩️'),
    ('Cashback', 'income', '💸'),
    ('Child allowance', 'income', '🎒'),
    ('Investments', 'expense', '📈'),
    ('Salary', 'income', '💰'),
    ('Donations', 'expense', '🎁'),
]


def upgrade():
    op.add_column('category', sa.Column('icon', sa.String(16), nullable=True))
    connection = op.get_bind()
    for name, category_type, icon in DEFAULT_CATEGORIES:
        connection.execute(sa.text("""
            INSERT INTO category (name, type, workspace_id, icon)
            SELECT :name, :type, NULL, :icon
            WHERE NOT EXISTS (
                SELECT 1 FROM category WHERE workspace_id IS NULL AND name=:name AND type=:type
            )
        """), {'name': name, 'type': category_type, 'icon': icon})


def downgrade():
    connection = op.get_bind()
    category = sa.table('category', sa.column('category_id'), sa.column('name'),
                        sa.column('type'), sa.column('workspace_id'), sa.column('icon'))
    seeded = sa.and_(category.c.workspace_id.is_(None), sa.or_(*[
        sa.and_(category.c.name == name, category.c.type == kind, category.c.icon == icon)
        for name, kind, icon in DEFAULT_CATEGORIES
    ]))
    ids = list(connection.scalars(sa.select(category.c.category_id).where(seeded)))
    if ids:
        for table in ('transactions', 'budgets', 'expenses'):
            reference = sa.table(table, sa.column('category_id'))
            if connection.scalar(sa.select(sa.literal(1)).select_from(reference).where(reference.c.category_id.in_(ids)).limit(1)):
                raise RuntimeError('Cannot remove default categories referenced by financial records')
        connection.execute(category.delete().where(category.c.category_id.in_(ids)))
    op.drop_column('category', 'icon')
