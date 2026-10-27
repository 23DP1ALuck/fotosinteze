import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

BACKEND = Path(__file__).resolve().parents[1]


class DefaultCategorySeedTests(unittest.TestCase):
    def test_seed_preserves_custom_categories_and_referenced_defaults(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'seed.sqlite'
            config = Config(str(BACKEND / 'alembic.ini'))
            config.set_main_option('script_location', str(BACKEND / 'alembic'))
            with patch.dict(os.environ, {'DATABASE_URL': 'sqlite+aiosqlite:///' + str(path)}):
                command.upgrade(config, 'c30d921a8f04')
                engine = create_engine('sqlite:///' + str(path))
                try:
                    with engine.begin() as db:
                        db.execute(text("INSERT INTO workspaces(workspace_id,name,type,base_currency,created_at,updated_at) VALUES (1,'Personal','PERSONAL','EUR',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
                        db.execute(text("INSERT INTO category(name,type,workspace_id) VALUES ('Groceries','expense',1)"))
                    command.upgrade(config, 'head')
                    command.upgrade(config, 'head')
                    with engine.begin() as db:
                        rows = db.execute(text('SELECT category_id,name,type,icon FROM category WHERE workspace_id IS NULL')).all()
                        self.assertEqual(len(rows), 20)
                        self.assertEqual(len({row.name for row in rows}), 20)
                        self.assertTrue(all(row.icon for row in rows))
                        self.assertEqual({row.type for row in rows}, {'income', 'expense'})
                        self.assertIn(('Groceries', 'expense'), {(row.name, row.type) for row in rows})
                        self.assertIn(('Salary', 'income'), {(row.name, row.type) for row in rows})
                        self.assertEqual(db.execute(text('SELECT name,workspace_id,icon FROM category WHERE workspace_id=1')).all(), [('Groceries', 1, None)])
                        category_id = rows[0].category_id
                        db.execute(text("INSERT INTO budgets(workspace_id,category_id,name,limit_amount,currency,period_start,period_length,created_at,updated_at) VALUES (1,:id,'Plan',100,'EUR','2026-10-01','MONTHLY',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"), {'id': category_id})
                    with self.assertRaisesRegex(RuntimeError, 'referenced'):
                        command.downgrade(config, 'c30d921a8f04')
                    with engine.begin() as db:
                        self.assertEqual(db.execute(text('SELECT count(*) FROM category WHERE workspace_id IS NULL')).scalar(), 20)
                        db.execute(text('DELETE FROM budgets'))
                    command.downgrade(config, 'c30d921a8f04')
                    with engine.connect() as db:
                        self.assertEqual(db.execute(text('SELECT name,workspace_id FROM category')).all(), [('Groceries', 1)])
                    command.upgrade(config, 'head')
                    with engine.connect() as db:
                        self.assertEqual(db.execute(text('SELECT count(*) FROM category WHERE workspace_id IS NULL')).scalar(), 20)
                        self.assertEqual(db.execute(text('PRAGMA foreign_key_check')).all(), [])
                finally:
                    engine.dispose()
