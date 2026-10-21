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


class RevolutAuthorizationMigrationTests(unittest.TestCase):
    def test_clean_upgrade_merges_heads_and_round_trips_connection_columns(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'revolut.sqlite'
            config = Config(str(BACKEND / 'alembic.ini'))
            config.set_main_option('script_location', str(BACKEND / 'alembic'))
            with patch.dict(os.environ, {'DATABASE_URL': 'sqlite+aiosqlite:///' + str(path)}):
                self.assertEqual(len(ScriptDirectory.from_config(config).get_heads()), 1)
                command.upgrade(config, 'head')
                engine = create_engine('sqlite:///' + str(path))
                try:
                    columns = {c['name'] for c in inspect(engine).get_columns('revolut_connections')}
                    self.assertIn('authorization_state_hash', columns)
                    self.assertIn('access_token_encrypted', columns)
                    self.assertNotIn('revolut_authorizations', inspect(engine).get_table_names())
                    self.assertIn('workspace_id', columns)
                    command.downgrade(config, '74448962612b')
                    self.assertNotIn('revolut_authorizations', inspect(engine).get_table_names())
                    self.assertIn('accounts', inspect(engine).get_table_names())
                    command.upgrade(config, 'head')
                    self.assertIn('authorization_state_hash', {c['name'] for c in inspect(engine).get_columns('revolut_connections')})
                finally:
                    engine.dispose()

    def test_upgrade_preserves_legacy_connections_tokens_and_account_links(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'legacy.sqlite'
            config = Config(str(BACKEND / 'alembic.ini'))
            config.set_main_option('script_location', str(BACKEND / 'alembic'))
            with patch.dict(os.environ, {'DATABASE_URL': 'sqlite+aiosqlite:///' + str(path)}):
                command.upgrade(config, '74448962612b')
                engine = create_engine('sqlite:///' + str(path))
                try:
                    with engine.begin() as db:
                        db.execute(text("INSERT INTO users(user_id,email,display_name,password,created_at,updated_at) VALUES (1,'user@test.com','User','unused',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
                        db.execute(text("INSERT INTO workspaces(workspace_id,name,type,base_currency,created_at,updated_at) VALUES (1,'Personal','PERSONAL','EUR',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
                        db.execute(text("INSERT INTO revolut_connections(revolut_connection_id,external_consent_id,access_token_encrypted,refresh_token_encrypted,status,connected_by_id,created_at,updated_at) VALUES (1,'old-consent','old-access','old-refresh','active',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"))
                        db.execute(text("INSERT INTO accounts(account_id,name,currency,balance,workspace_id,connection_id) VALUES (1,'Bank','EUR',42,1,1)"))
                    command.upgrade(config, 'head')
                    with engine.connect() as db:
                        self.assertEqual(db.execute(text('SELECT workspace_id,external_consent_id,access_token_encrypted,refresh_token_encrypted,status FROM revolut_connections')).one(),
                                         (1, 'old-consent', 'old-access', 'old-refresh', 'active'))
                        self.assertEqual(db.execute(text('SELECT account_id,connection_id,balance FROM accounts')).one(), (1, 1, 42))
                    command.downgrade(config, '74448962612b')
                    with engine.connect() as db:
                        self.assertEqual(db.execute(text('SELECT external_consent_id,access_token_encrypted,status FROM revolut_connections')).one(), ('old-consent', 'old-access', 'active'))
                finally:
                    engine.dispose()
