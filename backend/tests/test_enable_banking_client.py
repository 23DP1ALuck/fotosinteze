import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi import HTTPException

from app.services import enable_banking_client

HTTP_CLIENT = httpx.AsyncClient
UID = '3a57e2d3-2e0c-4336-af9b-7fa94f0606a3'


class EnableBankingClientTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.key_path = Path(self.temp.name) / 'private.pem'
        self.write_key(self.key)
        self.config = SimpleNamespace(enable_banking_app_id='test-app',
                                      enable_banking_private_key_path=self.key_path)
        self.settings_patch = patch.object(enable_banking_client, 'settings', self.config)
        self.settings_patch.start()
        self.addCleanup(self.settings_patch.stop)

    def write_key(self, key):
        self.key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM,
                                  serialization.PrivateFormat.PKCS8,
                                  serialization.NoEncryption()))

    def client_factory(self, handler):
        def factory(**kwargs):
            self.assertIs(kwargs['verify'], True)
            self.assertFalse(kwargs['trust_env'])
            self.assertFalse(kwargs['follow_redirects'])
            self.assertEqual(kwargs['timeout'], 20)
            return HTTP_CLIENT(**kwargs, transport=httpx.MockTransport(handler))
        return factory

    async def test_pinned_transport_and_valid_signed_jwt(self):
        now = int(time.time())
        def respond(request):
            self.assertEqual(str(request.url), 'https://api.enablebanking.com/aspsps?country=LV')
            self.assertEqual(request.method, 'GET')
            token = request.headers['Authorization'].removeprefix('Bearer ')
            self.assertEqual(jwt.get_unverified_header(token),
                             {'alg': 'RS256', 'typ': 'JWT', 'kid': 'test-app'})
            claims = jwt.decode(token, self.key.public_key(), algorithms=['RS256'],
                                issuer='enablebanking.com', audience='api.enablebanking.com')
            self.assertGreaterEqual(claims['iat'], now)
            self.assertEqual(claims['exp'] - claims['iat'], 300)
            return httpx.Response(200, json={'aspsps': []})
        with patch.object(enable_banking_client.httpx, 'AsyncClient', self.client_factory(respond)):
            self.assertEqual(await enable_banking_client.request('GET', '/aspsps', params={'country': 'LV'}),
                             {'aspsps': []})

    async def test_all_supported_endpoints(self):
        with patch.object(enable_banking_client.httpx, 'AsyncClient', self.client_factory(
                lambda request: httpx.Response(201, json={'ok': True}))):
            for method, path in [('GET', '/application'), ('GET', '/aspsps'), ('POST', '/auth'),
                                 ('POST', '/sessions'), ('GET', f'/sessions/{UID}'),
                                 ('GET', f'/accounts/{UID}/balances'), ('GET', f'/accounts/{UID}/transactions')]:
                with self.subTest(path=path):
                    self.assertEqual(await enable_banking_client.request(method, path), {'ok': True})

    async def test_rejects_paths_methods_and_transport_overrides_before_network(self):
        with patch.object(enable_banking_client.httpx, 'AsyncClient') as client:
            for method, path, kwargs in [
                ('GET', 'https://evil.test/application', {}), ('GET', '//evil.test/application', {}),
                ('GET', '/application?x=1', {}), ('GET', '/accounts/../balances', {}),
                ('GET', f'/accounts/{UID}%2f../balances', {}), ('GET', '/accounts/no-uuid/balances', {}),
                ('POST', '/application', {}), ('DELETE', '/application', {}),
                ('GET', '/application', {'follow_redirects': True}),
                ('GET', '/application', {'auth': ('user', 'password')}),
                ('GET', '/application', {'headers': {'authorization': 'secret'}}),
                ('GET', '/application', {'headers': {'Host': 'evil.test'}}),
            ]:
                with self.subTest(path=path, kwargs=kwargs), self.assertRaises(HTTPException) as error:
                    await enable_banking_client.request(method, path, **kwargs)
                self.assertEqual(error.exception.status_code, 400)
            client.assert_not_called()

    async def test_bad_configuration_is_scrubbed_and_key_is_reloaded(self):
        for invalid in [None, 'invalid-key-secret', rsa.generate_private_key(public_exponent=65537, key_size=1024),
                        ec.generate_private_key(ec.SECP256R1())]:
            if invalid is None:
                self.key_path.unlink(missing_ok=True)
            elif isinstance(invalid, str):
                self.key_path.write_text(invalid)
            else:
                self.write_key(invalid)
            with self.subTest(invalid=type(invalid).__name__), self.assertRaises(HTTPException) as error:
                await enable_banking_client.request('GET', '/application')
            self.assertEqual(error.exception.status_code, 503)
            self.assertNotIn('invalid-key-secret', str(error.exception))
            self.assertNotIn(str(self.key_path), str(error.exception))
        self.write_key(self.key)
        with patch.object(enable_banking_client.httpx, 'AsyncClient', self.client_factory(
                lambda request: httpx.Response(200, json={}))):
            await enable_banking_client.request('GET', '/application')
            self.key_path.write_text('invalid-key-secret')
            with self.assertRaises(HTTPException) as error:
                await enable_banking_client.request('GET', '/application')
            self.assertEqual(error.exception.status_code, 503)
        for field in ['enable_banking_app_id', 'enable_banking_private_key_path']:
            old = getattr(self.config, field)
            setattr(self.config, field, None)
            with self.assertRaises(HTTPException) as error:
                await enable_banking_client.request('GET', '/application')
            self.assertEqual(error.exception.status_code, 503)
            setattr(self.config, field, old)

    async def test_provider_errors_redirects_and_invalid_json_are_scrubbed(self):
        requests = []
        for response in [httpx.Response(401, text='sensitive-provider-body'),
                         httpx.Response(302, headers={'Location': 'https://evil.test/'}),
                         httpx.Response(200, text='sensitive-provider-body'),
                         httpx.Response(200, json=['sensitive-provider-body'])]:
            def respond(request):
                requests.append(str(request.url))
                return response
            with patch.object(enable_banking_client.httpx, 'AsyncClient', self.client_factory(respond)):
                with self.assertRaises(HTTPException) as error:
                    await enable_banking_client.request('GET', '/application')
                self.assertEqual(error.exception.status_code, 502)
                self.assertNotIn('sensitive-provider-body', str(error.exception))
        self.assertEqual(requests, ['https://api.enablebanking.com/application'] * 4)

    async def test_network_failure_is_scrubbed(self):
        def respond(request):
            raise httpx.ReadTimeout('sensitive-network-details', request=request)
        with patch.object(enable_banking_client.httpx, 'AsyncClient', self.client_factory(respond)):
            with self.assertRaises(HTTPException) as error:
                await enable_banking_client.request('GET', '/application')
            self.assertEqual(error.exception.status_code, 502)
            self.assertNotIn('sensitive-network-details', str(error.exception))

    async def test_delete_session_is_pinned_and_idempotent_and_429_keeps_safe_delay(self):
        for status in (200,204,404):
            def handler(request):
                self.assertEqual(request.method,'DELETE')
                self.assertEqual(str(request.url),'https://api.enablebanking.com/sessions/'+UID)
                return httpx.Response(status,json={'message':'OK'}) if status==200 else httpx.Response(status)
            with self.subTest(status=status), patch.object(enable_banking_client.httpx,'AsyncClient',self.client_factory(handler)):
                result=await enable_banking_client.request('DELETE','/sessions/'+UID)
                self.assertIsInstance(result,dict)
        for retry,expected in [('5','60'),('120','120'),('9999999','86400'),('secret-provider-message','60')]:
            with self.subTest(retry=retry), patch.object(enable_banking_client.httpx,'AsyncClient',
                    self.client_factory(lambda request:httpx.Response(429,headers={'Retry-After':retry},json={'secret':'never-echo'}))):
                with self.assertRaises(HTTPException) as error:
                    await enable_banking_client.request('GET','/aspsps')
                self.assertEqual(error.exception.status_code,429)
                self.assertEqual(error.exception.headers['Retry-After'],expected)
                self.assertNotIn('never-echo',error.exception.detail)
