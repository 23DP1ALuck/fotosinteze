import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

BACKEND = Path(__file__).resolve().parents[1]


class MigrationHeadTests(unittest.TestCase):
    def test_existing_heads_upgrade_to_one_head(self):
        config = Config(str(BACKEND / 'alembic.ini'))
        config.set_main_option('script_location', str(BACKEND / 'alembic'))
        heads = ScriptDirectory.from_config(config).get_heads()
        self.assertEqual(len(heads), 1)
        for starting_revision in ('74448962612b', '9c52e7a1bd30', 'a6d4e9b217c0', 'e8c031b47f62'):
            with self.subTest(starting_revision=starting_revision), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'migration.sqlite'
                with patch.dict(os.environ, {'DATABASE_URL': 'sqlite+aiosqlite:///' + str(path)}):
                    command.upgrade(config, starting_revision)
                    command.upgrade(config, 'head')
                    engine = create_engine('sqlite:///' + str(path))
                    try:
                        with engine.connect() as db:
                            self.assertEqual(db.execute(text('SELECT version_num FROM alembic_version')).scalars().all(), heads)
                            self.assertIn('workspace_id', [c['name'] for c in inspect(db).get_columns('budgets')])
                            self.assertEqual(str(next(c for c in inspect(db).get_columns('accounts') if c['name'] == 'account_id')['type']), 'INTEGER')
                            self.assertEqual(db.execute(text('PRAGMA foreign_key_check')).all(), [])
                    finally:
                        engine.dispose()
