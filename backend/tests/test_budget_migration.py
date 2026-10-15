import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

BACKEND = Path(__file__).resolve().parents[1]
OLD_HEAD = '8a31d9e4c602'


class BudgetMigrationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        path = Path(temp.name) / 'budgets.sqlite'
        environment = patch.dict(os.environ, {'DATABASE_URL': 'sqlite+aiosqlite:///' + str(path)})
        environment.start()
        self.addCleanup(environment.stop)
        self.config = Config(str(BACKEND / 'alembic.ini'))
        self.config.set_main_option('script_location', str(BACKEND / 'alembic'))
        self.engine = create_engine('sqlite:///' + str(path))
        self.addCleanup(self.engine.dispose)
        command.upgrade(self.config, OLD_HEAD)
        with self.engine.begin() as db:
            db.execute(text("INSERT INTO workspaces(workspace_id,name,type,base_currency,created_at,updated_at) VALUES (1,'Personal','PERSONAL','EUR',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP), (2,'Business','BUSINESS','EUR',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
            db.execute(text("INSERT INTO category(category_id,name,type,workspace_id) VALUES (1,'Food','expense',1)"))
            db.execute(text("INSERT INTO departments(department_id,name,workspace_id,created_at,updated_at) VALUES (1,'Team',2,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
            db.execute(text("INSERT INTO budgets(budget_id,category_id,name,limit_amount,currency,period_start,period_length,created_at,updated_at) VALUES (1,1,'Food',100,'EUR','2025-01-01','MONTHLY',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))

    def test_populated_budgets_backfill_and_round_trip(self):
        with self.engine.begin() as db:
            db.execute(text("INSERT INTO budgets(budget_id,department_id,name,limit_amount,currency,period_start,period_length,created_at,updated_at) VALUES (2,1,'Team',200,'EUR','2025-01-01','WEEKLY',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
        command.upgrade(self.config, 'head')
        with self.engine.connect() as db:
            self.assertEqual(db.execute(text('SELECT budget_id,workspace_id FROM budgets ORDER BY budget_id')).all(), [(1, 1), (2, 2)])
            self.assertFalse(next(c for c in inspect(db).get_columns('budgets') if c['name'] == 'workspace_id')['nullable'])
            self.assertEqual(db.execute(text('PRAGMA foreign_key_check')).all(), [])
        command.downgrade(self.config, OLD_HEAD)
        with self.engine.connect() as db:
            self.assertNotIn('workspace_id', [c['name'] for c in inspect(db).get_columns('budgets')])
            self.assertEqual(db.execute(text('SELECT count(*) FROM budgets')).scalar(), 2)
        command.upgrade(self.config, 'head')

    def test_ambiguous_legacy_budget_stops_before_schema_changes(self):
        with self.engine.begin() as db:
            db.execute(text('UPDATE budgets SET department_id=1 WHERE budget_id=1'))
        with self.assertRaisesRegex(RuntimeError, 'workspace'):
            command.upgrade(self.config, 'head')
        with self.engine.connect() as db:
            self.assertNotIn('workspace_id', [c['name'] for c in inspect(db).get_columns('budgets')])
            self.assertEqual(db.execute(text('SELECT name FROM budgets')).scalar(), 'Food')

    def test_unassigned_legacy_budget_stops_before_schema_changes(self):
        with self.engine.begin() as db:
            db.execute(text('UPDATE budgets SET category_id=NULL WHERE budget_id=1'))
        with self.assertRaisesRegex(RuntimeError, 'workspace'):
            command.upgrade(self.config, 'head')
        with self.engine.connect() as db:
            self.assertNotIn('workspace_id', [c['name'] for c in inspect(db).get_columns('budgets')])
