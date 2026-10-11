import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

BACKEND = Path(__file__).resolve().parents[1]
OLD_HEAD = 'a18c72e40b91'


class DepartmentProjectMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        path = Path(self.temp.name) / 'test.sqlite'
        self.environment = patch.dict(os.environ, {'DATABASE_URL': 'sqlite+aiosqlite:///' + str(path)})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.config = Config(str(BACKEND / 'alembic.ini'))
        self.config.set_main_option('script_location', str(BACKEND / 'alembic'))
        self.engine = create_engine('sqlite:///' + str(path))
        self.addCleanup(self.engine.dispose)
        command.upgrade(self.config, OLD_HEAD)
        with self.engine.begin() as db:
            db.execute(text("INSERT INTO users(user_id,email,display_name,password,created_at,updated_at) VALUES (1,'user@test.com','User','unused',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
            for i in (1, 2):
                db.execute(text("INSERT INTO workspaces(workspace_id,name,type,base_currency,created_at,updated_at) VALUES (:id,:name,'BUSINESS','EUR',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"), dict(id=i, name=f'Workspace {i}'))
            for i in (1, 2, 3):
                db.execute(text("INSERT INTO departments(department_id,workspace_id,name,created_at,updated_at) VALUES (:id,:workspace,:name,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"), dict(id=i, workspace=1 if i < 3 else 2, name=f'Department {i}'))
            db.execute(text("INSERT INTO workspace_users(user_id,workspace_id,role,joined_at) VALUES (1,1,'EMPLOYEE',CURRENT_TIMESTAMP)"))
            db.execute(text("INSERT INTO projects(project_id,workspace_id,department_id,name,created_at,updated_at) VALUES (1,1,1,'Legacy',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP), (2,1,NULL,'Unlinked',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
            db.execute(text("INSERT INTO accounts(account_id,name,currency,balance,workspace_id) VALUES (1,'Cash','EUR',100,1)"))
            db.execute(text("INSERT INTO category(category_id,name,type,workspace_id) VALUES (1,'Cost','expense',1)"))
            db.execute(text("INSERT INTO expenses(expense_id,workspace_id,submitted_by,department_id,project_id,category_id,amount,currency,description,status,created_at,updated_at) VALUES (1,1,1,1,1,1,10,'EUR','Legacy expense','pending',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
            db.execute(text("INSERT INTO transactions(transaction_id,amount,currency,description,source,account_id,category_id,project_id,department_id,expense_id,workspace_id,created_at,updated_at) VALUES (1,10,'EUR','Legacy transaction','MANUAL',1,1,1,1,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))

    def test_upgrade_preserves_links_and_downgrade_round_trip(self):
        command.upgrade(self.config, 'head')
        with self.engine.connect() as db:
            self.assertIn('department_projects', inspect(db).get_table_names())
            self.assertEqual(db.execute(text('SELECT department_id,project_id,workspace_id FROM department_projects')).all(), [(1, 1, 1)])
            self.assertEqual(db.execute(text('SELECT department_id FROM workspace_users')).scalar(), None)
            self.assertNotIn('department_id', [c['name'] for c in inspect(db).get_columns('projects')])
            self.assertEqual(db.execute(text('PRAGMA foreign_key_check')).all(), [])
            self.assertEqual(db.execute(text('SELECT project_id,department_id FROM transactions')).one(), (1, 1))
            self.assertEqual(db.execute(text('SELECT project_id,department_id FROM expenses')).one(), (1, 1))
        command.downgrade(self.config, OLD_HEAD)
        with self.engine.connect() as db:
            self.assertEqual(db.execute(text('SELECT project_id,department_id FROM projects ORDER BY project_id')).all(), [(1, 1), (2, None)])
            self.assertNotIn('department_projects', inspect(db).get_table_names())
        command.upgrade(self.config, 'head')

    def test_downgrade_refuses_shared_projects(self):
        command.upgrade(self.config, 'head')
        with self.engine.begin() as db:
            db.execute(text('INSERT INTO department_projects(department_id,project_id,workspace_id) VALUES (2,1,1)'))
        with self.assertRaisesRegex(RuntimeError, 'shared'):
            command.downgrade(self.config, OLD_HEAD)
        with self.engine.connect() as db:
            self.assertEqual(db.execute(text('SELECT count(*) FROM department_projects')).scalar(), 2)

    def test_downgrade_refuses_employee_assignments(self):
        command.upgrade(self.config, 'head')
        with self.engine.begin() as db:
            db.execute(text('UPDATE workspace_users SET department_id=1'))
        with self.assertRaisesRegex(RuntimeError, 'assignment'):
            command.downgrade(self.config, OLD_HEAD)

    def test_upgrade_rejects_invalid_legacy_department(self):
        with self.engine.begin() as db:
            db.execute(text('UPDATE projects SET department_id=3 WHERE project_id=1'))
        with self.assertRaisesRegex(RuntimeError, 'workspace'):
            command.upgrade(self.config, 'head')
        with self.engine.connect() as db:
            self.assertIn('department_id', [c['name'] for c in inspect(db).get_columns('projects')])

    def test_upgrade_preflights_foreign_keys_and_can_retry_after_repair(self):
        with self.engine.begin() as db:
            db.execute(text("INSERT INTO workspace_users(user_id,workspace_id,role,joined_at) VALUES (99,1,'EMPLOYEE',CURRENT_TIMESTAMP)"))
        with self.assertRaisesRegex(RuntimeError, '[Ff]oreign key'):
            command.upgrade(self.config, 'head')
        with self.engine.connect() as db:
            self.assertFalse(any(name.startswith('_alembic_tmp') for name in inspect(db).get_table_names()))
            self.assertIn('department_id', [c['name'] for c in inspect(db).get_columns('projects')])
        with self.engine.begin() as db:
            db.execute(text('DELETE FROM workspace_users WHERE user_id=99'))
        command.upgrade(self.config, 'head')
