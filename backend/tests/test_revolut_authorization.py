import json
import tempfile
import subprocess
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import httpx
from pydantic import SecretStr
import jwt
from cryptography.fernet import Fernet
from cryptography import x509
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.config import Settings
from app.database import Base, get_db_session
from app.dependencies.auth import get_current_user
from app.main import app
from app.models import User, Workspace, WorkspaceUsers, WorkspaceRole, RevolutConnection
from app.models.workspace import WorkspaceTypeEnum
from app.services import revolut_authorization_service as service


class RevolutConnectionTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.cert = Path(cls.temp.name) / 'cert.pem'
        cls.key = Path(cls.temp.name) / 'private.key'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-keyout', str(cls.key), '-out', str(cls.cert), '-days', '1',
                        '-subj', '/CN=localhost'], check=True, capture_output=True)

    async def asyncSetUp(self):
        self.engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.db = async_sessionmaker(self.engine, expire_on_commit=False)()
        self.db.add_all([User(user_id=1, email='owner@test.com', display_name='Owner', password='unused'),
                         Workspace(workspace_id=1, name='Personal', type=WorkspaceTypeEnum.PERSONAL),
                         Workspace(workspace_id=2, name='Business', type=WorkspaceTypeEnum.BUSINESS)])
        await self.db.flush()
        self.db.add_all([WorkspaceUsers(user_id=1, workspace_id=i, role=WorkspaceRole.OWNER) for i in (1, 2)])
        await self.db.commit()
        self.config = Settings(_env_file=None, database_url='sqlite+aiosqlite://', jwt_secret='test',
                               client_url='http://localhost:5173', revolut_api_client_id='sandbox-client',
                               revolut_transport_cert_path=self.cert, revolut_private_key_path=self.key,
                               revolut_ca_bundle_path=self.cert, revolut_signing_cert_path=self.cert,
                               revolut_redirect_uri='https://backend.test/revolut/callback',
                               revolut_token_encryption_key=Fernet.generate_key().decode())
        self.config_patch = patch.object(service, 'settings', self.config)
        self.config_patch.start()
        self.http_patch = patch.object(service.revolut_service, 'sandbox_request', side_effect=self.provider)
        self.outbound = self.http_patch.start()
        self.old_overrides = app.dependency_overrides.copy()
        async def session():
            yield self.db
        app.dependency_overrides[get_db_session] = session
        app.dependency_overrides[get_current_user] = lambda: {'sub': '1'}
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='https://backend.test')
        self.bad_nonce = False
        self.claim_changes = {}

    async def asyncTearDown(self):
        self.config_patch.stop()
        self.http_patch.stop()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.old_overrides)
        await self.client.aclose()
        await self.db.close()
        await self.engine.dispose()

    async def provider(self, method, path, config, **kwargs):
        if path == '/account-access-consents':
            self.assertEqual(kwargs['headers']['x-fapi-financial-id'], '001580000103UAvAAM')
            self.assertIn('ReadTransactionsDetail', kwargs['json']['Data']['Permissions'])
            return {'Data': {'ConsentId': 'consent-id', 'Status': 'AwaitingAuthorisation'}}
        if kwargs['data']['grant_type'] == 'client_credentials':
            return {'access_token': 'application-secret', 'token_type': 'Bearer', 'expires_in': 2399}
        self.assertEqual(kwargs['data']['code'], 'one-time-code')
        flow = await self.db.scalar(select(RevolutConnection))
        claims = {'iss': service.AUTH_BASE, 'aud': 'sandbox-client',
                  'exp': datetime.now(timezone.utc) + timedelta(minutes=5),
                  'nonce': 'wrong' if self.bad_nonce else flow.authorization_nonce, 'openbanking_intent_id': 'consent-id'}
        claims.update(self.claim_changes)
        return {'access_token': 'customer-secret', 'refresh_token': 'refresh-secret',
                'token_type': 'Bearer', 'expires_in': 3599,
                'id_token': jwt.encode(claims, 'provider-test-secret-at-least-32-bytes', algorithm='HS256')}

    async def start(self):
        response = await self.client.post('/revolut/authorize', headers={'Workspace-ID': '1'})
        self.assertEqual(response.status_code, 200, response.text)
        query = parse_qs(urlparse(response.json()['authorization_url']).query)
        cert = x509.load_pem_x509_certificate(self.cert.read_bytes())
        claims = jwt.decode(query['request'][0], cert.public_key(), algorithms=['PS256'], audience=service.AUTH_BASE)
        return response, claims

    async def test_signed_consent_redirect_and_encrypted_code_exchange(self):
        response, claims = await self.start()
        self.assertEqual(claims['claims']['id_token']['openbanking_intent_id']['value'], 'consent-id')
        self.assertEqual(claims['response_mode'], 'fragment')
        self.assertIn('HttpOnly', response.headers['set-cookie'])
        self.assertIn('Secure', response.headers['set-cookie'])
        flow = await self.db.scalar(select(RevolutConnection))
        self.assertNotEqual(flow.authorization_state_hash, claims['state'])
        response = await self.client.post('/revolut/callback', json={'state': claims['state'], 'code': 'one-time-code'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['status'], 'authorized')
        self.assertNotIn('secret', response.text)
        await self.db.refresh(flow)
        self.assertEqual(flow.authorization_status, 'authorized')
        self.assertEqual(flow.status, 'active')
        self.assertNotIn('customer-secret', flow.access_token_encrypted)
        cipher = Fernet(self.config.revolut_token_encryption_key.get_secret_value())
        self.assertEqual(cipher.decrypt(flow.access_token_encrypted.encode()).decode(), 'customer-secret')
        self.assertEqual(cipher.decrypt(flow.refresh_token_encrypted.encode()).decode(), 'refresh-secret')
        replay = await self.client.post('/revolut/callback', json={'state': claims['state'], 'code': 'one-time-code'})
        self.assertEqual(replay.status_code, 400)

    async def test_only_accessible_personal_workspace_can_start(self):
        for wid, status in [('2', 400), ('999', 403)]:
            response = await self.client.post('/revolut/authorize', headers={'Workspace-ID': wid})
            self.assertEqual(response.status_code, status, response.text)
        self.assertEqual(self.outbound.await_count, 0)

    async def test_start_requires_authentication(self):
        app.dependency_overrides.pop(get_current_user)
        response = await self.client.post('/revolut/authorize', headers={'Workspace-ID': '1'})
        self.assertEqual(response.status_code, 401)

    async def test_invalid_state_or_browser_cookie_cannot_consume_flow(self):
        _, claims = await self.start()
        before = self.outbound.await_count
        response = await self.client.post('/revolut/callback', json={'state': 'invalid', 'code': 'one-time-code'})
        self.assertEqual(response.status_code, 400)
        self.client.cookies.clear()
        response = await self.client.post('/revolut/callback', json={'state': claims['state'], 'code': 'one-time-code'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.outbound.await_count, before)
        flow = await self.db.scalar(select(RevolutConnection))
        self.assertEqual(flow.authorization_status, 'pending')

    async def test_expired_or_already_claimed_callback_does_not_exchange(self):
        for status in ['pending', 'exchanging']:
            _, claims = await self.start()
            flow = await self.db.scalar(select(RevolutConnection).order_by(RevolutConnection.created_at.desc()))
            flow.authorization_status = status
            flow.authorization_expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=1)
            await self.db.commit()
            before = self.outbound.await_count
            response = await self.client.post('/revolut/callback', json={'state': claims['state'], 'code': 'one-time-code'})
            self.assertEqual(response.status_code, 400)
            self.assertEqual(self.outbound.await_count, before)

    async def test_denied_callback_is_consumed_and_sanitized(self):
        _, claims = await self.start()
        response = await self.client.post('/revolut/callback', json={'state': claims['state'], 'error': 'untrusted-message'})
        self.assertEqual(response.status_code, 400)
        self.assertNotIn('untrusted-message', response.text)
        flow = await self.db.scalar(select(RevolutConnection))
        self.assertEqual(flow.authorization_status, 'failed')

    async def test_removed_membership_cannot_finish(self):
        _, claims = await self.start()
        await self.db.delete(await self.db.get(WorkspaceUsers, (1, 1)))
        await self.db.commit()
        response = await self.client.post('/revolut/callback', json={'state': claims['state'], 'code': 'one-time-code'})
        self.assertEqual(response.status_code, 403)

    async def test_wrong_nonce_or_exchange_failure_never_stores_tokens(self):
        _, claims = await self.start()
        self.bad_nonce = True
        response = await self.client.post('/revolut/callback', json={'state': claims['state'], 'code': 'one-time-code'})
        self.assertEqual(response.status_code, 502, response.text)
        flow = await self.db.scalar(select(RevolutConnection))
        self.assertIsNone(flow.access_token_encrypted)
        self.assertEqual(flow.authorization_status, 'failed')

    async def test_jwks_exposes_only_public_key(self):
        response = await self.client.get('/.well-known/jwks.json')
        self.assertEqual(response.status_code, 200, response.text)
        key = response.json()['keys'][0]
        self.assertEqual(key['alg'], 'PS256')
        self.assertNotIn('d', key)
        self.assertNotIn('PRIVATE', response.text)
        self.assertEqual(key['kid'], self.config.revolut_signing_kid)

    async def test_fragment_bridge_does_not_accept_codes_in_query(self):
        response = await self.client.get('/revolut/callback?code=secret&state=secret')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('secret', response.text)
        self.assertIn('location.hash', response.text)
        self.assertIn('no-store', response.headers['cache-control'])

    async def test_malformed_callback_does_not_echo_codes(self):
        response = await self.client.post('/revolut/callback', json={'state': 'test', 'code': 'sensitive-code' * 500})
        self.assertEqual(response.status_code, 400)
        self.assertNotIn('sensitive-code', response.text)

    async def test_provider_failure_consumes_callback_and_hides_details(self):
        _, claims = await self.start()
        self.outbound.side_effect = RuntimeError('upstream-sensitive-token')
        response = await self.client.post('/revolut/callback', json={'state': claims['state'], 'code': 'one-time-code'})
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('upstream-sensitive-token', response.text)
        flow = await self.db.scalar(select(RevolutConnection))
        self.assertEqual(flow.authorization_status, 'failed')
        self.assertIsNone(flow.access_token_encrypted)

    async def test_missing_configuration_fails_before_creating_consent(self):
        self.config.revolut_token_encryption_key = None
        response = await self.client.post('/revolut/authorize', headers={'Workspace-ID': '1'})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.outbound.await_count, 0)

    async def test_encryption_key_is_not_returned_in_validation_errors(self):
        self.config.revolut_token_encryption_key = SecretStr('invalid-sensitive-key')
        response = await self.client.post('/revolut/authorize', headers={'Workspace-ID': '1'})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('invalid-sensitive-key', response.text)

    async def test_mismatched_token_claims_cannot_complete_authorization(self):
        for changes in [{'iss': 'https://attacker.test'}, {'aud': 'another-app'},
                        {'openbanking_intent_id': 'other-consent'}, {'exp': 1},
                        {'aud': ['sandbox-client', 'another-app']},
                        {'aud': ['sandbox-client', 'another-app'], 'azp': 'sandbox-client'},
                        {'azp': 'another-app'}]:
            with self.subTest(changes=changes):
                # Each rejection needs its own fresh, one-use attempt.
                await self.db.execute(delete(RevolutConnection))
                await self.db.commit()
                _, claims = await self.start()
                self.claim_changes = changes
                response = await self.client.post('/revolut/callback', json={'state': claims['state'], 'code': 'one-time-code'})
                self.assertEqual(response.status_code, 502, response.text)
                flow = await self.db.scalar(select(RevolutConnection))
                self.assertEqual(flow.authorization_status, 'failed')
                self.assertIsNone(flow.access_token_encrypted)
                self.claim_changes = {}

    async def test_failed_reconnect_preserves_existing_connection_and_tokens(self):
        connection = RevolutConnection(workspace_id=1, connected_by_id=1,
            external_consent_id='existing-consent', status='active',
            access_token_encrypted='existing-access-ciphertext', refresh_token_encrypted='existing-refresh-ciphertext',
            expires_at=datetime(2030, 1, 1))
        self.db.add(connection)
        await self.db.commit()
        connection_id = connection.revolut_connection_id
        _, claims = await self.start()
        response = await self.client.post('/revolut/callback', json={'state': claims['state'], 'error': 'access_denied'})
        self.assertEqual(response.status_code, 400)
        await self.db.refresh(connection)
        self.assertEqual(connection.revolut_connection_id, connection_id)
        self.assertEqual(connection.external_consent_id, 'existing-consent')
        self.assertEqual(connection.access_token_encrypted, 'existing-access-ciphertext')
        self.assertEqual(connection.refresh_token_encrypted, 'existing-refresh-ciphertext')
        self.assertEqual(connection.expires_at, datetime(2030, 1, 1))
        self.assertEqual(connection.status, 'active')
        self.assertEqual(len((await self.db.scalars(select(RevolutConnection))).all()), 1)

    async def test_new_attempt_invalidates_previous_state_and_reuses_row(self):
        _, first = await self.start()
        _, second = await self.start()
        self.assertEqual(len((await self.db.scalars(select(RevolutConnection))).all()), 1)
        response = await self.client.post('/revolut/callback', json={'state': first['state'], 'code': 'one-time-code'})
        self.assertEqual(response.status_code, 400)
        response = await self.client.post('/revolut/callback', json={'state': second['state'], 'code': 'one-time-code'})
        self.assertEqual(response.status_code, 200, response.text)

    async def test_reconnect_cannot_replace_in_progress_exchange(self):
        await self.start()
        connection = await self.db.scalar(select(RevolutConnection))
        connection.authorization_status = 'exchanging'
        await self.db.commit()
        before = self.outbound.await_count
        response = await self.client.post('/revolut/authorize', headers={'Workspace-ID': '1'})
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.outbound.await_count, before)
