import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

BACKEND = Path(__file__).resolve().parents[1]


class SharedCategoryMigrationTests(unittest.TestCase):
    def test_existing_categories_survive_and_shared_categories_block_unsafe_downgrade(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'categories.sqlite'
            config = Config(str(BACKEND / 'alembic.ini'))
            config.set_main_option('script_location', str(BACKEND / 'alembic'))
            with patch.dict(os.environ, {'DATABASE_URL': 'sqlite+aiosqlite:///' + str(path)}):
                command.upgrade(config, 'e14a86c72d39')
                engine = create_engine('sqlite:///' + str(path))
                try:
                    with engine.begin() as db:
                        db.execute(text("INSERT INTO workspaces(workspace_id,name,type,base_currency,created_at,updated_at) VALUES (1,'Personal','PERSONAL','EUR',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
                        db.execute(text("INSERT INTO category(category_id,name,type,workspace_id) VALUES (1,'Custom','expense',1)"))
                    command.upgrade(config, 'c30d921a8f04')
                    with engine.begin() as db:
                        self.assertTrue(next(c for c in inspect(db).get_columns('category') if c['name'] == 'workspace_id')['nullable'])
                        self.assertEqual(db.execute(text('SELECT name,workspace_id FROM category')).all(), [('Custom', 1)])
                        db.execute(text("INSERT INTO category(name,type,workspace_id) VALUES ('Shared','expense',NULL)"))
                    with self.assertRaisesRegex(RuntimeError, 'shared categories'):
                        command.downgrade(config, 'e14a86c72d39')
                    with engine.begin() as db:
                        self.assertEqual(db.execute(text('SELECT count(*) FROM category')).scalar(), 2)
                        db.execute(text('DELETE FROM category WHERE workspace_id IS NULL'))
                    command.downgrade(config, 'e14a86c72d39')
                    with engine.connect() as db:
                        self.assertFalse(next(c for c in inspect(db).get_columns('category') if c['name'] == 'workspace_id')['nullable'])
                        self.assertEqual(db.execute(text('PRAGMA foreign_key_check')).all(), [])
                finally:
                    engine.dispose()
