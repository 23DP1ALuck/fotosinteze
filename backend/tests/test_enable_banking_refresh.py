from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy import select
from starlette.requests import Request

from app.models import EnableBankingConnection, Workspace
from app.services import enable_banking_refresh as service
from tests.bank_test_case import BankTestCase


def request(ip='8.8.8.8', **headers):
    return Request({'type': 'http', 'client': (ip, 1234),
        'headers': [(key.lower().replace('_', '-').encode(), value.encode())
                    for key, value in {'user-agent': 'Real browser',
                        **{key.lower().replace('_', '-'): value for key, value in headers.items()}}.items()]})


class EnableBankingRefreshTests(BankTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.workspace = await self.db.get(Workspace, 1)
        self.connection = EnableBankingConnection(workspace_id=1, connected_by_id=1,
            session_encrypted='existing-ciphertext', expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1))
        self.db.add(self.connection)
        await self.db.commit()
        self.sync_patch = patch.object(service.sync_service, 'sync', new_callable=AsyncMock,
                                      return_value={'imported_count': 0})
        self.sync = self.sync_patch.start()
        self.addCleanup(self.sync_patch.stop)

    def test_psu_headers_ignore_forged_forwarding_and_require_global_ip(self):
        self.assertEqual(service.psu_headers(request(CF_Connecting_IP='1.1.1.1', X_Forwarded_For='9.9.9.9')),
                         {'Psu-Ip-Address': '8.8.8.8', 'Psu-User-Agent': 'Real browser'})
        self.assertIsNone(service.psu_headers(request('127.0.0.1', CF_Connecting_IP='1.1.1.1')))
        self.assertIsNone(service.psu_headers(request(user_agent='bad\r\nInjected: value')))
        self.config.enable_banking_trusted_proxy_cidrs = '10.0.0.0/8,2001:4860::/32'
        self.assertEqual(service.psu_headers(request('10.1.2.3', CF_Connecting_IP='1.1.1.1'))['Psu-Ip-Address'], '1.1.1.1')
        for forwarded in ('127.0.0.1', 'bad', '1.1.1.1,8.8.8.8'):
            self.assertIsNone(service.psu_headers(request('10.1.2.3', CF_Connecting_IP=forwarded)))
        self.assertIsNone(service.psu_headers(request('10.1.2.3', X_Forwarded_For='1.1.1.1')))

    async def test_second_tab_cannot_refresh_during_first_claim_or_cooldown(self):
        async def first(*args, **kwargs):
            with self.assertRaises(HTTPException) as error:
                await service.refresh(self.workspace, self.db, request=request())
            self.assertEqual(error.exception.status_code, 429)
            self.assertGreaterEqual(int(error.exception.headers['Retry-After']), 1)
            self.assertIsNotNone(kwargs['claim_started_at'])
            return {'imported_count': 0}
        self.sync.side_effect = first
        await service.refresh(self.workspace, self.db, request=request(), recent=True)
        with self.assertRaises(HTTPException) as error:
            await service.refresh(self.workspace, self.db, request=request())
        self.assertEqual(error.exception.status_code, 429)
        self.assertEqual(self.sync.await_count, 1)
        await self.db.refresh(self.connection)
        self.assertIsNotNone(self.connection.sync_started_at)
        self.assertIsNone(self.connection.sync_lease_until)

    async def test_provider_429_records_retry_without_erasing_snapshot(self):
        self.connection.pending_transactions_encrypted = 'untouched-snapshot'
        await self.db.commit()
        self.sync.side_effect = HTTPException(429, 'Upstream secret', headers={'Retry-After': '120'})
        with self.assertRaises(HTTPException) as error:
            await service.refresh(self.workspace, self.db, request=request())
        self.assertEqual(error.exception.status_code, 429)
        self.assertNotIn('secret', str(error.exception.detail))
        await self.db.refresh(self.connection)
        self.assertEqual(self.connection.pending_transactions_encrypted, 'untouched-snapshot')
        self.assertIsNone(self.connection.sync_lease_until)
        self.assertGreaterEqual(self.connection.sync_retry_at - self.connection.sync_started_at, timedelta(seconds=120))
        self.sync.reset_mock()
        await self.db.refresh(self.workspace)
        with self.assertRaises(HTTPException):
            await service.refresh(self.workspace, self.db, request=request())
        self.sync.assert_not_awaited()

    async def test_failed_background_attempt_still_consumes_six_hour_quota(self):
        self.sync.side_effect = HTTPException(502, 'Unavailable')
        with self.assertRaises(HTTPException):
            await service.refresh(self.workspace, self.db, request=request('127.0.0.1'))
        await self.db.refresh(self.connection)
        deadline = service.next_sync_at(self.connection, None)
        self.assertEqual(deadline.replace(tzinfo=None) - self.connection.sync_started_at, timedelta(hours=6))
        self.assertIsNone(self.connection.sync_lease_until)
        await self.db.refresh(self.workspace)
        with self.assertRaises(HTTPException) as error:
            await service.refresh(self.workspace, self.db, request=request('127.0.0.1'))
        self.assertEqual(error.exception.status_code, 429)
        self.assertEqual(self.sync.await_count, 1)

    async def test_automatic_requires_explicit_configuration_and_real_psu(self):
        for ip in ('8.8.8.8', '127.0.0.1'):
            with self.assertRaises(HTTPException) as error:
                await service.refresh(self.workspace, self.db, request=request(ip), automatic=True)
            self.assertEqual(error.exception.status_code, 503)
        self.config.enable_banking_auto_sync_interval_seconds = 30
        with self.assertRaises(HTTPException):
            await service.refresh(self.workspace, self.db, request=request('127.0.0.1'), automatic=True)
        self.sync.assert_not_awaited()
        await service.refresh(self.workspace, self.db, request=request(), automatic=True)
        self.assertTrue(self.sync.await_args.kwargs['automatic'])

    async def test_replacement_connection_is_not_changed_by_old_lease_release(self):
        async def replace(*args, **kwargs):
            self.connection.session_encrypted = 'new-session'
            self.connection.sync_started_at = datetime(2026, 1, 1)
            self.connection.sync_lease_until = datetime(2026, 1, 2)
            await self.db.commit()
            raise HTTPException(429, 'Unavailable', headers={'Retry-After': '120'})
        self.sync.side_effect = replace
        with self.assertRaises(HTTPException):
            await service.refresh(self.workspace, self.db, request=request())
        await self.db.refresh(self.connection)
        self.assertEqual(self.connection.sync_lease_until, datetime(2026, 1, 2))
        self.assertIsNone(self.connection.sync_retry_at)

    async def test_deleting_connection_is_not_changed_by_old_lease_release(self):
        async def deleting(*args, **kwargs):
            self.connection.pending_status = 'deleting'
            self.connection.sync_retry_at = datetime(2026, 1, 2)
            await self.db.commit()
            raise HTTPException(429, 'Unavailable')
        self.sync.side_effect = deleting
        with self.assertRaises(HTTPException):
            await service.refresh(self.workspace, self.db, request=request())
        await self.db.refresh(self.connection)
        self.assertEqual(self.connection.sync_retry_at, datetime(2026, 1, 2))
        self.assertIsNotNone(self.connection.sync_lease_until)

    async def test_provider_retry_is_clamped_and_background_minimum_is_enforced(self):
        now = datetime.now(timezone.utc)
        for value, expected in [('5', 60), ('9999999', 86400), ('NaN', 60), ('bad', 60)]:
            error = HTTPException(429, 'Unavailable', headers={'Retry-After': value})
            self.assertEqual(service.provider_retry(error, now, {'Psu-Ip-Address': '8.8.8.8'}) - now,
                             timedelta(seconds=expected))
        self.assertEqual(service.provider_retry(HTTPException(429, 'Unavailable'), now, None) - now,
                         timedelta(hours=6))
