import asyncio
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

BACKEND = Path(__file__).resolve().parents[1]
OLD_HEAD = 'b72f90c1de64'


class ExpenseMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        path = Path(self.temp.name) / 'expense.sqlite'
        self.database_url = 'sqlite+aiosqlite:///' + str(path)
        environment = patch.dict(os.environ, {'DATABASE_URL': 'sqlite+aiosqlite:///' + str(path)})
        environment.start()
        self.addCleanup(environment.stop)
        self.config = Config(str(BACKEND / 'alembic.ini'))
        self.config.set_main_option('script_location', str(BACKEND / 'alembic'))
        self.engine = create_engine('sqlite:///' + str(path))
        self.addCleanup(self.engine.dispose)
        command.upgrade(self.config, OLD_HEAD)
        with self.engine.begin() as db:
            db.execute(text("INSERT INTO users(user_id,email,display_name,password,created_at,updated_at) VALUES (1,'expense@test.com','User','unused',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
            db.execute(text("INSERT INTO workspaces(workspace_id,name,type,base_currency,created_at,updated_at) VALUES (1,'Business','BUSINESS','EUR',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
            db.execute(text("INSERT INTO workspace_users(user_id,workspace_id,role,joined_at) VALUES (1,1,'OWNER',CURRENT_TIMESTAMP)"))
            db.execute(text("INSERT INTO category(category_id,name,type,workspace_id) VALUES (1,'Travel','expense',1)"))
            for i, status in enumerate(('pending', 'approved', 'rejected'), start=1):
                db.execute(text("INSERT INTO expenses(expense_id,workspace_id,submitted_by,category_id,amount,currency,description,status,reviewed_by,reviewed_at,created_at,updated_at) VALUES (:id,1,1,1,12.34,'EUR','Legacy',:status,:reviewer,:reviewed_at,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"),
                           dict(id=i, status=status, reviewer=None if i == 1 else 1, reviewed_at=None if i == 1 else '2026-10-01 12:00:00'))
            db.execute(text("INSERT INTO accounts(account_id,name,currency,balance,workspace_id) VALUES (1,'Cash','EUR',87.66,1)"))
            db.execute(text("INSERT INTO transactions(transaction_id,amount,currency,description,source,account_id,category_id,expense_id,workspace_id,created_at,updated_at) VALUES (1,12.34,'EUR','Approved','EXPENSE',1,1,2,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))

    def test_upgrade_preserves_records_and_enforces_status_and_category(self):
        command.upgrade(self.config, 'head')
        with self.engine.connect() as db:
            self.assertEqual(db.execute(text('SELECT status FROM expenses ORDER BY expense_id')).scalars().all(), ['PENDING', 'APPROVED', 'REJECTED'])
            columns = {c['name']: c for c in inspect(db).get_columns('expenses')}
            self.assertIn('receipt_url', columns)
            self.assertFalse(columns['category_id']['nullable'])
            self.assertEqual(db.execute(text('SELECT expense_id FROM transactions')).scalar(), 2)
            self.assertEqual(db.execute(text('SELECT balance FROM accounts')).scalar(), 87.66)
            self.assertEqual(db.execute(text('PRAGMA foreign_key_check')).all(), [])
            self.assertIn('CHECK', db.execute(text("SELECT sql FROM sqlite_master WHERE name='expenses'")).scalar())
        with self.assertRaises(IntegrityError), self.engine.begin() as db:
            db.execute(text("UPDATE expenses SET status='INVALID' WHERE expense_id=1"))
        with self.assertRaises(IntegrityError), self.engine.begin() as db:
            db.execute(text('UPDATE expenses SET category_id=NULL WHERE expense_id=1'))
        with self.engine.connect() as db:
            db.exec_driver_sql('PRAGMA foreign_keys=ON')
            with self.assertRaises(IntegrityError):
                db.execute(text('DELETE FROM category WHERE category_id=1'))
            db.rollback()

    def test_approval_works_against_migrated_schema(self):
        command.upgrade(self.config, 'head')
        async def approve():
            from app.services import expense_service
            from app.models import Account, Transaction
            from sqlalchemy import select, func
            engine = create_async_engine(self.database_url)
            try:
                async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                    result = await expense_service.review_expense(1, True, 1, 1, {'sub': '1'}, db)
                    self.assertEqual(result.status.value, 'APPROVED')
                    self.assertEqual(await db.scalar(select(func.count()).select_from(Transaction)), 2)
                    self.assertEqual(str((await db.get(Account, 1)).balance), '75.32')
            finally:
                await engine.dispose()
        asyncio.run(approve())

    def test_downgrade_round_trip_preserves_receipts(self):
        command.upgrade(self.config, 'head')
        with self.engine.begin() as db:
            db.execute(text("UPDATE expenses SET receipt_url='https://example.com/receipt' WHERE expense_id=1"))
        command.downgrade(self.config, OLD_HEAD)
        with self.engine.connect() as db:
            self.assertEqual(db.execute(text('SELECT status FROM expenses ORDER BY expense_id')).scalars().all(), ['pending', 'approved', 'rejected'])
            self.assertEqual(db.execute(text('SELECT expense_id FROM transactions')).scalar(), 2)
            self.assertEqual(db.execute(text('SELECT receipt_url FROM expenses WHERE expense_id=1')).scalar(), 'https://example.com/receipt')
        command.upgrade(self.config, 'head')

    def test_upgrade_rejects_missing_category_before_schema_changes(self):
        with self.engine.connect() as db:
            original_schema = db.execute(text("SELECT sql FROM sqlite_master WHERE name='expenses'")).scalar()
        with self.engine.begin() as db:
            db.execute(text('UPDATE expenses SET category_id=NULL WHERE expense_id=1'))
        with self.assertRaisesRegex(RuntimeError, 'category'):
            command.upgrade(self.config, 'head')
        with self.engine.connect() as db:
            self.assertEqual(db.execute(text("SELECT sql FROM sqlite_master WHERE name='expenses'")).scalar(), original_schema)
            self.assertEqual(db.execute(text('SELECT version_num FROM alembic_version')).scalar(), OLD_HEAD)
            self.assertEqual(db.execute(text('SELECT status FROM expenses WHERE expense_id=1')).scalar(), 'pending')


    def test_original_expense_ui_head_can_upgrade_to_merged_schema(self):
        command.upgrade(self.config, 'd4817a0e9c25')
        command.upgrade(self.config, 'head')
        with self.engine.connect() as db:
            self.assertIn('workspace_id', {column['name'] for column in inspect(db).get_columns('budgets')})
            self.assertEqual(db.execute(text('SELECT version_num FROM alembic_version')).scalars().all(), ['f0af51ce271b'])
            self.assertEqual(db.execute(text('PRAGMA foreign_key_check')).all(), [])
