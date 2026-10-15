import unittest
from alembic import command
from sqlalchemy import text
from tests import test_department_project_migration


class AccountMigrationTests(unittest.TestCase):
    setUp = test_department_project_migration.DepartmentProjectMigrationTests.setUp

    def test_generated_ids_preserve_accounts_and_transaction_links(self):
        command.upgrade(self.config, 'head')
        with self.engine.begin() as db:
            db.execute(text("INSERT INTO accounts(name,currency,balance,workspace_id) VALUES ('New','EUR',12,1)"))
            self.assertEqual(db.execute(text("SELECT account_id FROM accounts WHERE name='New'")).scalar(), 2)
            self.assertEqual(db.execute(text('SELECT balance FROM accounts WHERE account_id=1')).scalar(), 100)
            self.assertEqual(db.execute(text('SELECT account_id FROM transactions WHERE transaction_id=1')).scalar(), 1)
            self.assertEqual(db.execute(text('PRAGMA foreign_key_check')).all(), [])
        command.downgrade(self.config, '8a31d9e4c602')
        with self.engine.connect() as db:
            self.assertEqual(db.execute(text('SELECT count(*) FROM accounts')).scalar(), 2)
