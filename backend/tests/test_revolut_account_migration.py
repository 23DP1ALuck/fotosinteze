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


class RevolutAccountMigrationTests(unittest.TestCase):
    def test_multiple_accounts_preserve_legacy_link_and_downgrade_refuses_data_loss(self):
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / 'db.sqlite')
            config = Config(str(BACKEND / 'alembic.ini'))
            config.set_main_option('script_location', str(BACKEND / 'alembic'))
            with patch.dict(os.environ, {'DATABASE_URL':'sqlite+aiosqlite:///'+path}):
                command.upgrade(config, 'b49d02e71a63')
                engine = create_engine('sqlite:///'+path)
                with engine.begin() as db:
                    db.execute(text("INSERT INTO users(user_id,email,display_name,password,created_at,updated_at) VALUES(1,'test@test.com','Test','unused',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
                    db.execute(text("INSERT INTO workspaces(workspace_id,name,type,base_currency,created_at,updated_at) VALUES(1,'Personal','PERSONAL','EUR',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
                    db.execute(text("INSERT INTO revolut_connections(revolut_connection_id,external_consent_id,status,connected_by_id,workspace_id,created_at,updated_at) VALUES(1,'consent','active',1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
                    db.execute(text("INSERT INTO accounts(account_id,name,currency,balance,workspace_id,connection_id,is_main) VALUES(1,'Legacy','EUR',42,1,1,1)"))
                    db.execute(text("INSERT INTO transactions(transaction_id,amount,currency,description,source,account_id,workspace_id,created_at,updated_at) VALUES(1,2,'EUR','Legacy transaction','MANUAL',1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
                command.upgrade(config, 'head')
                with engine.begin() as db:
                    self.assertEqual(db.execute(text('SELECT account_id,connection_id,balance,is_main,external_account_id FROM accounts')).one(), (1,1,42,1,None))
                    db.execute(text("INSERT INTO accounts(name,currency,balance,workspace_id,connection_id,external_account_id) VALUES('Revolut GBP','GBP',5,1,1,'gbp')"))
                    db.execute(text("INSERT INTO accounts(name,currency,balance,workspace_id,connection_id,external_account_id) VALUES('Revolut USD','USD',6,1,1,'usd')"))
                    self.assertEqual(db.execute(text('PRAGMA foreign_key_check')).all(), [])
                    self.assertEqual(db.execute(text('SELECT account_id,amount FROM transactions')).one(), (1,2))
                with self.assertRaises(IntegrityError), engine.begin() as db:
                    db.execute(text("INSERT INTO accounts(name,currency,balance,workspace_id,connection_id,external_account_id) VALUES('Duplicate','GBP',1,1,1,'gbp')"))
                with self.assertRaisesRegex(RuntimeError, 'multiple accounts'):
                    command.downgrade(config, 'b49d02e71a63')
                with engine.connect() as db:
                    self.assertEqual(db.scalar(text('SELECT COUNT(*) FROM accounts')), 3)
                engine.dispose()
