import io
from contextlib import redirect_stdout
from pathlib import Path
import ssl
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs

import httpx

from app.config import Settings
from app.services import revolut_service

HTTP_CLIENT = httpx.AsyncClient


class RevolutSandboxTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.cert = Path(cls.temp.name) / 'test.pem'
        cls.key = Path(cls.temp.name) / 'test.key'
        # Generate disposable credentials rather than committing any certificate or key.
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-keyout', str(cls.key), '-out', str(cls.cert), '-days', '1',
                        '-subj', '/CN=localhost'], check=True, capture_output=True)

    def config(self, **changes):
        return Settings(_env_file=None, database_url='sqlite+aiosqlite:///:memory:',
                        jwt_secret='test', client_url='http://localhost:5173',
                        **{'revolut_api_client_id': 'sandbox-client',
                           'revolut_transport_cert_path': self.cert,
                           'revolut_private_key_path': self.key,
                           'revolut_ca_bundle_path': self.cert, **changes})

    def client_factory(self, handler):
        def factory(**kwargs):
            context = kwargs['verify']
            self.assertIsInstance(context, ssl.SSLContext)
            self.assertTrue(context.check_hostname)
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
            self.assertFalse(kwargs['trust_env'])
            self.assertGreater(kwargs['timeout'], 0)
            return HTTP_CLIENT(**kwargs, transport=httpx.MockTransport(handler))
        return factory

    async def test_token_request_uses_verified_mtls_and_keeps_token_out_of_output(self):
        def respond(request):
            self.assertEqual(str(request.url), 'https://sandbox-oba-auth.revolut.com/token')
            self.assertEqual(request.method, 'POST')
            self.assertEqual(parse_qs(request.content.decode()), {
                'client_id': ['sandbox-client'], 'grant_type': ['client_credentials'], 'scope': ['accounts']})
            return httpx.Response(200, json={'access_token': 'sensitive-token', 'token_type': 'Bearer', 'expires_in': 2399})
        with patch.object(revolut_service.httpx, 'AsyncClient', self.client_factory(respond)):
            token = await revolut_service.get_sandbox_access_token(self.config())
            self.assertEqual(token.access_token.get_secret_value(), 'sensitive-token')
            self.assertEqual(token.expires_in, 2399)
            self.assertNotIn('sensitive-token', repr(token))
            output = io.StringIO()
            with redirect_stdout(output):
                await revolut_service.check_sandbox_connection(self.config())
            self.assertIn('2399', output.getvalue())
            self.assertNotIn('sensitive-token', output.getvalue())

    async def test_configuration_is_optional_until_revolut_is_used(self):
        config = self.config(revolut_api_client_id=None, revolut_transport_cert_path=None,
                             revolut_private_key_path=None, revolut_ca_bundle_path=None)
        with self.assertRaisesRegex(RuntimeError, 'Configure REVOLUT_'):
            await revolut_service.get_sandbox_access_token(config)

    async def test_missing_and_invalid_certificates_fail_before_network_request(self):
        bad_cert = Path(self.temp.name) / 'invalid.pem'
        bad_cert.write_text('invalid certificate')
        for changes in [{'revolut_private_key_path': Path(self.temp.name) / 'missing.key'},
                        {'revolut_ca_bundle_path': bad_cert}, {'revolut_transport_cert_path': bad_cert}]:
            with self.subTest(changes=changes), self.assertRaisesRegex(RuntimeError, 'certificate/key/CA'):
                await revolut_service.get_sandbox_access_token(self.config(**changes))

    async def test_http_errors_do_not_expose_response_body(self):
        def respond(request):
            return httpx.Response(401, text='sensitive-response')
        with patch.object(revolut_service.httpx, 'AsyncClient', self.client_factory(respond)):
            with self.assertRaisesRegex(RuntimeError, 'HTTP 401') as error:
                await revolut_service.get_sandbox_access_token(self.config())
            self.assertNotIn('sensitive-response', str(error.exception))

    async def test_invalid_token_responses_are_rejected_without_exposing_body(self):
        for payload in [{'access_token': 'sensitive-response'},
                        {'access_token': '', 'token_type': 'Bearer', 'expires_in': 2399},
                        {'access_token': 'sensitive-response', 'token_type': 'Bearer', 'expires_in': 0}]:
            with self.subTest(payload=payload):
                with patch.object(revolut_service.httpx, 'AsyncClient', self.client_factory(
                        lambda request: httpx.Response(200, json=payload))):
                    with self.assertRaisesRegex(RuntimeError, 'Invalid Revolut sandbox token response') as error:
                        await revolut_service.get_sandbox_access_token(self.config())
                    self.assertNotIn('sensitive-response', str(error.exception))

    async def test_timeout_is_reported_without_request_details(self):
        def respond(request):
            raise httpx.ReadTimeout('sensitive-details', request=request)
        with patch.object(revolut_service.httpx, 'AsyncClient', self.client_factory(respond)):
            with self.assertRaisesRegex(RuntimeError, 'Could not reach Revolut sandbox securely') as error:
                await revolut_service.get_sandbox_access_token(self.config())
            self.assertNotIn('sensitive-details', str(error.exception))


    async def test_account_reads_use_pinned_verified_transport_and_reject_other_paths(self):
        requests = []
        def respond(request):
            requests.append(str(request.url))
            return httpx.Response(200, json={'Data': {}})
        with patch.object(revolut_service.httpx, 'AsyncClient', self.client_factory(respond)):
            for path in ['/accounts', '/accounts/abc-123/balances']:
                await revolut_service.sandbox_request('GET', path, self.config())
            for method, path in [('GET', '/token'), ('POST', '/accounts'),
                                 ('GET', '/accounts/../../token'), ('GET', 'https://evil.test/accounts'),
                                 ('GET', '/accounts/abc%2F..%2Ftoken/balances')]:
                with self.assertRaisesRegex(RuntimeError, 'Unsupported sandbox endpoint'):
                    await revolut_service.sandbox_request(method, path, self.config())
        self.assertEqual(requests, ['https://sandbox-oba-auth.revolut.com/accounts',
                                  'https://sandbox-oba-auth.revolut.com/accounts/abc-123/balances'])
