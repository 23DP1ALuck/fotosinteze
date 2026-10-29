import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

BACKEND = Path(__file__).resolve().parents[1]


class EnableBankingMigrationTests(unittest.TestCase):
    def test_preserves_existing_history_and_enforces_provider_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / 'db.sqlite')
            config = Config(str(BACKEND / 'alembic.ini'))
            config.set_main_option('script_location', str(BACKEND / 'alembic'))
            with patch.dict(os.environ, {'DATABASE_URL': 'sqlite+aiosqlite:///' + path}):
                command.upgrade(config, 'd73e41a9c602')
                engine = create_engine('sqlite:///' + path)
                with engine.begin() as db:
                    db.execute(text("INSERT INTO users(user_id,email,display_name,password,created_at,updated_at) VALUES(1,'test@test.com','Test','unused',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
                    db.execute(text("INSERT INTO workspaces(workspace_id,name,type,base_currency,created_at,updated_at) VALUES(1,'Personal','PERSONAL','EUR',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
                    db.execute(text("INSERT INTO accounts(account_id,name,currency,balance,workspace_id,is_main) VALUES(1,'Cash','EUR',42,1,1)"))
                    db.execute(text("INSERT INTO transactions(transaction_id,amount,currency,description,source,account_id,workspace_id,created_at,updated_at) VALUES(1,2,'EUR','Existing','MANUAL',1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
                command.upgrade(config, 'head')
                with engine.begin() as db:
                    self.assertEqual(db.execute(text('SELECT account_id,balance,is_main,banking_connection_id FROM accounts')).one(), (1,42,1,None))
                    self.assertEqual(db.execute(text('SELECT account_id,amount FROM transactions')).one(), (1,2))
                    self.assertEqual(db.execute(text('PRAGMA foreign_key_check')).all(), [])
                    self.assertEqual(db.execute(text('SELECT pending_transactions_encrypted,sync_started_at,sync_retry_at,sync_lease_until FROM enable_banking_connections')).all(), [])
                    db.execute(text("INSERT INTO enable_banking_connections(connection_id,workspace_id,connected_by_id) VALUES(1,1,1)"))
                    db.execute(text("INSERT INTO accounts(account_id,name,currency,balance,workspace_id,banking_connection_id,external_account_id,is_main) VALUES(2,'Bank','EUR',12,1,1,'stable',0)"))
                    db.execute(text("INSERT INTO transactions(amount,currency,description,source,account_id,workspace_id,external_transaction_id,created_at,updated_at) VALUES(2,'EUR','Imported','BANK',2,1,'entry',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
                with self.assertRaises(IntegrityError), engine.begin() as db:
                    db.execute(text("INSERT INTO accounts(name,currency,balance,workspace_id,banking_connection_id,external_account_id) VALUES('Duplicate','EUR',12,1,1,'stable')"))
                with self.assertRaises(IntegrityError), engine.begin() as db:
                    db.execute(text("INSERT INTO transactions(amount,currency,description,source,account_id,workspace_id,external_transaction_id,created_at,updated_at) VALUES(2,'EUR','Duplicate','BANK',2,1,'entry',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
                with self.assertRaisesRegex(RuntimeError, 'preserve'):
                    command.downgrade(config, 'd73e41a9c602')
                with engine.connect() as db:
                    self.assertEqual(db.scalar(text('SELECT COUNT(*) FROM transactions')), 2)
                engine.dispose()
