import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from sqlalchemy import select
from app.models import Account, RevolutConnection
from tests import test_revolut_authorization as auth_tests
from app.services import revolut_authorization_service as authorization


class RevolutAccountTests(unittest.IsolatedAsyncioTestCase):
    setUpClass = classmethod(auth_tests.RevolutConnectionTests.setUpClass.__func__)
    asyncTearDown = auth_tests.RevolutConnectionTests.asyncTearDown
    provider = auth_tests.RevolutConnectionTests.provider

    async def asyncSetUp(self):
        await auth_tests.RevolutConnectionTests.asyncSetUp(self)
        cipher = authorization.encryption_cipher()
        self.connection = RevolutConnection(workspace_id=1, connected_by_id=1,
            external_consent_id='consent', status='active', authorization_status='authorized',
            access_token_encrypted=cipher.encrypt(b'customer-secret').decode(),
            expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1))
        self.db.add(self.connection)
        await self.db.commit()
        self.currencies = ['GBP', 'EUR', 'USD']
        self.amount = '12.34'
        self.failure = False
        self.outbound.side_effect = self.bank

    async def bank(self, method, path, config, **kwargs):
        self.assertEqual(method, 'GET')
        if path == '/accounts':
            return {'Data': {'Account': [{'AccountId': str(i), 'Currency': c} for i,c in enumerate(self.currencies)]}}
        index = int(path.split('/')[2])
        if self.failure and index == 1:
            raise RuntimeError('sensitive-provider-message')
        return {'Data': {'Balance': [{'AccountId': str(index), 'Amount': {
            'Amount': self.amount, 'Currency': self.currencies[index]},
            'Type': 'InterimAvailable', 'CreditDebitIndicator': 'Debit' if index == 1 else 'Credit'}]}}

    async def run_import(self, workspace='1'):
        return await self.client.post('/revolut/accounts/import', headers={'Workspace-ID': workspace})

    async def test_import_updates_without_duplicates_and_preserves_main_and_name(self):
        self.db.add(Account(name='Cash', workspace_id=1, currency='EUR', balance=50, is_main=True))
        await self.db.commit()
        response = await self.run_import()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['imported_count'], 3)
        self.assertNotIn('secret', response.text)
        accounts = (await self.db.scalars(select(Account).order_by(Account.account_id))).all()
        self.assertEqual(len(accounts), 4)
        self.assertEqual([a.balance for a in accounts], [Decimal('50'), Decimal('12.34'), Decimal('-12.34'), Decimal('12.34')])
        accounts[1].name = 'My bank'
        await self.db.commit()
        self.amount = '20.00'
        self.assertEqual((await self.run_import()).status_code, 200)
        await self.db.refresh(accounts[1])
        self.assertEqual(accounts[1].name, 'My bank')
        self.assertEqual(accounts[1].balance, Decimal('20'))
        self.assertTrue(accounts[0].is_main)
        self.assertEqual(len((await self.db.scalars(select(Account))).all()), 4)
        await self.db.refresh(self.connection)
        self.assertIsNotNone(self.connection.last_sync_at)

    async def test_failure_and_malformed_balance_do_not_write_partial_accounts(self):
        for failure, amount in [(True, '1.00'), (False, 'NaN'), (False, '1.234'), (False, '-1.00')]:
            self.failure, self.amount = failure, amount
            response = await self.run_import()
            self.assertEqual(response.status_code, 502, response.text)
            self.assertNotIn('sensitive', response.text)
            self.assertEqual((await self.db.scalars(select(Account))).all(), [])
            await self.db.refresh(self.connection)
            self.assertIsNone(self.connection.last_sync_at)

    async def test_access_and_expired_credentials(self):
        for wid, code in [('2',400), ('999',403)]:
            self.assertEqual((await self.run_import(wid)).status_code, code)
        self.connection.expires_at = datetime(2000,1,1)
        await self.db.commit()
        self.assertEqual((await self.run_import()).status_code, 409)
        self.assertEqual(self.outbound.await_count, 0)

    async def test_first_import_assigns_only_one_main_account(self):
        response = await self.run_import()
        self.assertEqual(response.status_code, 200, response.text)
        accounts = (await self.db.scalars(select(Account))).all()
        self.assertEqual(sum(a.is_main for a in accounts), 1)

    async def test_reconnect_during_fetch_cannot_store_old_accounts(self):
        bank = self.bank
        async def reconnect(method, path, config, **kwargs):
            result = await bank(method, path, config, **kwargs)
            if path == '/accounts':
                self.connection.external_consent_id = 'new-consent'
                await self.db.commit()
            return result
        self.outbound.side_effect = reconnect
        response = await self.run_import()
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual((await self.db.scalars(select(Account))).all(), [])

    async def test_mismatched_balances_and_duplicate_ids_are_rejected(self):
        bank = self.bank
        for defect in ['id', 'currency', 'duplicate', 'type']:
            async def malformed(method, path, config, **kwargs):
                result = await bank(method, path, config, **kwargs)
                if path == '/accounts':
                    if defect == 'duplicate': result['Data']['Account'].append(result['Data']['Account'][0])
                else:
                    balance = result['Data']['Balance'][0]
                    if defect == 'id': balance['AccountId'] = 'foreign-id'
                    if defect == 'currency': balance['Amount']['Currency'] = 'XXX'
                    if defect == 'type': balance['Type'] = 'Unknown'
                return result
            self.outbound.side_effect = malformed
            self.assertEqual((await self.run_import()).status_code, 502)
            self.assertEqual((await self.db.scalars(select(Account))).all(), [])

    async def test_failed_refresh_keeps_previous_balances_and_sync_time(self):
        self.assertEqual((await self.run_import()).status_code, 200)
        before = (await self.db.execute(select(Account.external_account_id, Account.balance))).all()
        await self.db.refresh(self.connection)
        previous_sync = self.connection.last_sync_at
        self.amount, self.failure = '50.00', True
        self.assertEqual((await self.run_import()).status_code, 502)
        self.assertEqual((await self.db.execute(select(Account.external_account_id, Account.balance))).all(), before)
        await self.db.refresh(self.connection)
        self.assertEqual(self.connection.last_sync_at, previous_sync)

    async def test_invalid_token_and_unauthenticated_request_never_call_bank(self):
        from app.dependencies.auth import get_current_user
        from app.main import app
        self.connection.access_token_encrypted = 'invalid-ciphertext'
        await self.db.commit()
        self.assertEqual((await self.run_import()).status_code, 409)
        app.dependency_overrides.pop(get_current_user)
        self.assertEqual((await self.run_import()).status_code, 401)
        self.assertEqual(self.outbound.await_count, 0)

    async def test_empty_mapping_cannot_be_accepted_as_account_list(self):
        async def invalid(*args, **kwargs):
            return {'Data': {'Account': {}}}
        self.outbound.side_effect = invalid
        self.assertEqual((await self.run_import()).status_code, 502)
        await self.db.refresh(self.connection)
        self.assertIsNone(self.connection.last_sync_at)

    async def test_currency_change_rolls_back_all_balance_and_sync_updates(self):
        self.assertEqual((await self.run_import()).status_code, 200)
        before = (await self.db.execute(select(Account.external_account_id, Account.balance))).all()
        await self.db.refresh(self.connection)
        previous_sync = self.connection.last_sync_at
        self.amount, self.currencies[1] = '50.00', 'GBP'
        self.assertEqual((await self.run_import()).status_code, 502)
        self.assertEqual((await self.db.execute(select(Account.external_account_id, Account.balance))).all(), before)
        await self.db.refresh(self.connection)
        self.assertEqual(self.connection.last_sync_at, previous_sync)
