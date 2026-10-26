import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from sqlalchemy import select
from app.models import EnableBankingConnection, WorkspaceUsers
from app.services import enable_banking_service as service
from app.services import revolut_authorization_service as authorization
from tests import test_revolut_authorization as base


class EnableBankingAuthorizationTests(unittest.IsolatedAsyncioTestCase):
    setUpClass = classmethod(base.RevolutConnectionTests.setUpClass.__func__)
    asyncTearDown = base.RevolutConnectionTests.asyncTearDown
    provider = base.RevolutConnectionTests.provider

    async def asyncSetUp(self):
        await base.RevolutConnectionTests.asyncSetUp(self)
        self.config.enable_banking_redirect_uri = 'https://backend.test/enable-banking/callback'
        config_patch = patch.object(service, 'settings', self.config)
        config_patch.start()
        self.addCleanup(config_patch.stop)
        bank_patch = patch.object(service.client, 'request', side_effect=self.bank_response)
        self.bank = bank_patch.start()
        self.addCleanup(bank_patch.stop)
        self.state = None
        self.payload = {'session_id': '497f6eca-6276-4993-bfeb-53cbbbba6f08',
            'aspsp': {'name': 'Revolut', 'country': 'LV'}, 'psu_type': 'personal',
            'access': {'valid_until': (datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()},
            'accounts': [{'uid': '497f6eca-6276-4993-bfeb-53cbbbba6f09',
                'identification_hash': 'stable-bank-hash', 'currency': 'EUR', 'account_id': {'iban': 'private-iban'}}]}

    async def bank_response(self, method, path, **kwargs):
        if path == '/aspsps':
            return {'aspsps': [{'name': 'Revolut', 'country': 'LV', 'maximum_consent_validity': 86400}]}
        if path == '/auth':
            body = kwargs['json']
            self.assertEqual(body['psu_type'], 'personal')
            self.assertEqual(body['aspsp'], {'name': 'Revolut', 'country': 'LV'})
            self.assertTrue(body['access']['transactions'])
            self.assertLess(datetime.fromisoformat(body['access']['valid_until']), datetime.now(timezone.utc)+timedelta(days=1))
            self.state = body['state']
            return {'url': 'https://auth.enablebanking.com/ais/start?sessionid=secret'}
        self.assertEqual((method, path), ('POST', '/sessions'))
        self.assertEqual(kwargs['json'], {'code': 'one-use-code'})
        return self.payload

    async def start(self):
        response = await self.client.post('/enable-banking/authorize', headers={'Workspace-ID': '1'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn('HttpOnly', response.headers['set-cookie'])
        self.assertIn('Secure', response.headers['set-cookie'])
        self.assertEqual(response.headers['cache-control'], 'no-store')
        return self.state

    async def finish(self, state=None, **changes):
        return await self.client.post('/enable-banking/callback', json={
            'state': state or self.state, 'code': 'one-use-code', **changes})

    async def test_status_exchange_encryption_and_replay(self):
        response = await self.client.get('/enable-banking/connection', headers={'Workspace-ID': '1'})
        self.assertEqual(response.json()['status'], 'not_connected')
        await self.start()
        response = await self.finish()
        self.assertEqual(response.status_code, 200, response.text)
        row = await self.db.scalar(select(EnableBankingConnection))
        self.assertNotIn('stable-bank-hash', row.session_encrypted)
        stored = json.loads(authorization.encryption_cipher().decrypt(row.session_encrypted.encode()))
        self.assertNotIn('private-iban', json.dumps(stored))
        self.assertEqual(stored['accounts'][0]['identification_hash'], 'stable-bank-hash')
        self.assertEqual((await self.finish()).status_code, 400)
        status = await self.client.get('/enable-banking/connection', headers={'Workspace-ID': '1'})
        self.assertEqual(status.json()['status'], 'connected')
        self.assertNotIn('secret', status.text)
        self.assertEqual((await self.client.post('/enable-banking/authorize', headers={'Workspace-ID': '2'})).status_code, 400)
        self.assertEqual((await self.client.get('/enable-banking/connection', headers={'Workspace-ID': '999'})).status_code, 403)

    async def test_state_cookie_membership_and_replaced_attempt(self):
        first = await self.start()
        await self.start()
        self.assertEqual((await self.finish(first)).status_code, 400)
        self.assertEqual((await self.finish('wrong')).status_code, 400)
        saved = list(self.client.cookies.jar)
        self.client.cookies.clear()
        self.assertEqual((await self.finish()).status_code, 400)
        for cookie in saved:
            self.client.cookies.jar.set_cookie(cookie)
        await self.db.delete(await self.db.get(WorkspaceUsers, (1, 1)))
        await self.db.commit()
        self.assertEqual((await self.finish()).status_code, 403)
        self.assertEqual(self.bank.await_count, 4)

    async def test_failure_preserves_existing_session_and_consumes_attempt(self):
        await self.start()
        self.assertEqual((await self.finish()).status_code, 200)
        row = await self.db.scalar(select(EnableBankingConnection))
        before = row.session_encrypted
        await self.start()
        self.payload['aspsp']['country'] = 'FI'
        self.assertEqual((await self.finish()).status_code, 502)
        await self.db.refresh(row)
        self.assertEqual(row.session_encrypted, before)
        self.assertEqual(row.pending_status, 'failed')
        self.assertEqual((await self.finish()).status_code, 400)

    async def test_callback_page_and_malformed_body_hide_codes(self):
        response = await self.client.get('/enable-banking/callback?code=private-code&state=private-state')
        self.assertEqual(response.status_code, 200)
        self.assertIn('location.search', response.text)
        self.assertNotIn('private-code', response.text)
        self.assertEqual(response.headers['referrer-policy'], 'no-referrer')
        response = await self.client.post('/enable-banking/callback', json={'state': 's', 'code': 'sensitive'*1000})
        self.assertEqual(response.status_code, 400)
        self.assertNotIn('sensitive', response.text)

    async def test_expired_flow_and_in_progress_exchange(self):
        await self.start()
        row = await self.db.scalar(select(EnableBankingConnection))
        row.pending_status = 'exchanging'
        await self.db.commit()
        count = self.bank.await_count
        self.assertEqual((await self.client.post('/enable-banking/authorize', headers={'Workspace-ID': '1'})).status_code, 409)
        self.assertEqual(self.bank.await_count, count)
        row.pending_status = 'pending'
        row.pending_expires_at = datetime(2000, 1, 1)
        await self.db.commit()
        self.assertEqual((await self.finish()).status_code, 400)

    async def test_invalid_redirect_and_provider_url_do_not_create_flow(self):
        self.config.enable_banking_redirect_uri = 'http://backend.test/enable-banking/callback'
        self.assertEqual((await self.client.post('/enable-banking/authorize', headers={'Workspace-ID': '1'})).status_code, 503)
        self.bank.assert_not_awaited()
        self.config.enable_banking_redirect_uri = 'https://backend.test/enable-banking/callback'
        self.bank.side_effect = [{'aspsps': [{'name': 'Revolut', 'country': 'LV', 'maximum_consent_validity': 86400}]}, {'url': 'https://attacker.test/'}]
        self.assertEqual((await self.client.post('/enable-banking/authorize', headers={'Workspace-ID': '1'})).status_code, 502)
        self.assertIsNone(await self.db.scalar(select(EnableBankingConnection)))

    async def test_unavailable_accounts_are_ignored_without_discarding_active_accounts(self):
        await self.start()
        self.payload['accounts'].append({'uid': None, 'identification_hash': 'closed-account'})
        self.assertEqual((await self.finish()).status_code, 200)
        row = await self.db.scalar(select(EnableBankingConnection))
        stored = json.loads(authorization.encryption_cipher().decrypt(row.session_encrypted.encode()))
        self.assertEqual(len(stored['accounts']), 1)

    async def test_missing_session_fields_and_denial_consume_attempt_safely(self):
        await self.start()
        self.payload.pop('accounts')
        self.assertEqual((await self.finish()).status_code, 502)
        self.assertEqual((await self.finish()).status_code, 400)
        await self.start()
        response = await self.finish(error='private-provider-error')
        self.assertEqual(response.status_code, 400)
        self.assertNotIn('private-provider-error', response.text)

    async def test_browser_connection_sync_and_existing_finance_api(self):
        await self.start()
        self.assertEqual((await self.finish()).status_code, 200)
        headers = {'Workspace-ID': '1'}
        async def balances_and_transactions(method, path, **kwargs):
            if path.endswith('/balances'):
                return {'balances': [{'balance_type': 'ITAV', 'balance_amount': {'amount': '100.00', 'currency': 'EUR'}}]}
            return {'transactions': [{'status': 'BOOK', 'entry_reference': 'entry-1',
                'transaction_amount': {'amount': '5.00', 'currency': 'EUR'}, 'credit_debit_indicator': 'DBIT',
                'booking_date': '2026-10-20'}]}
        self.bank.side_effect = balances_and_transactions
        response = await self.client.post('/enable-banking/sync', headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['imported_count'], 1)
        accounts = (await self.client.get('/accounts', headers=headers)).json()
        account = accounts[0]
        self.assertIsNotNone(account['banking_connection_id'])
        account_id = account['account_id']
        response = await self.client.put(f'/accounts/{account_id}', headers=headers, json={'balance': '0.00'})
        self.assertEqual(response.status_code, 409, response.text)
        response = await self.client.get('/transactions?source=BANK', headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        entry = response.json()['items'][0]
        self.assertEqual(entry['description'], 'Revolut transaction')
        local = {'account_id': account_id, 'category_id': entry['category_id'], 'amount': '2.00',
                 'currency': 'EUR', 'description': 'Local note'}
        response = await self.client.post('/transactions', headers=headers, json=local)
        self.assertEqual(response.status_code, 201, response.text)
        local_id = response.json()['transaction_id']
        local['amount'] = '3.00'
        self.assertEqual((await self.client.put(f'/transactions/{local_id}', headers=headers, json=local)).status_code, 200)
        self.assertEqual((await self.client.delete(f'/transactions/{local_id}', headers=headers)).status_code, 204)
        self.assertEqual((await self.client.get(f'/accounts/{account_id}', headers=headers)).json()['balance'], '100.00')
        self.assertEqual((await self.client.post('/enable-banking/sync', headers=headers)).json()['imported_count'], 0)

    async def test_imported_financial_fields_and_deletion_are_protected(self):
        from app.models import Account, Category, Transaction
        from app.models.category import CategoryType
        from app.models.transaction import TransactionSourceEnum
        from decimal import Decimal
        bank = EnableBankingConnection(workspace_id=1, connected_by_id=1)
        self.db.add(bank)
        await self.db.flush()
        account = Account(workspace_id=1, name='Bank', currency='EUR', balance=100, banking_connection_id=bank.connection_id)
        manual = Account(workspace_id=1, name='Cash', currency='EUR', balance=10)
        expense = Category(workspace_id=1, name='Groceries', type=CategoryType.expense)
        income = Category(workspace_id=1, name='Salary', type=CategoryType.income)
        self.db.add_all([account, manual, expense, income])
        await self.db.flush()
        tx = Transaction(workspace_id=1, account_id=account.account_id, category_id=expense.category_id,
            amount=5, currency='EUR', description='Bank record', source=TransactionSourceEnum.BANK, external_transaction_id='entry')
        self.db.add(tx)
        await self.db.commit()
        headers = {'Workspace-ID': '1'}
        body = {'account_id': account.account_id, 'category_id': expense.category_id,
                'amount': '5.00', 'currency': 'EUR', 'description': 'User description'}
        for changes in [{'account_id': manual.account_id}, {'amount': '6.00'}, {'currency': 'USD'}, {'category_id': income.category_id}]:
            response = await self.client.put(f'/transactions/{tx.transaction_id}', headers=headers, json={**body, **changes})
            self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual((await self.client.delete(f'/transactions/{tx.transaction_id}', headers=headers)).status_code, 409)
        self.assertEqual((await self.client.put(f'/transactions/{tx.transaction_id}', headers=headers, json=body)).status_code, 200)
        await self.db.refresh(manual)
        await self.db.refresh(account)
        self.assertEqual((account.balance, manual.balance), (Decimal(100), Decimal(10)))
        response = await self.client.put(f'/categories/{expense.category_id}', headers=headers,
            json={'name': 'Groceries', 'type': 'INCOME'})
        self.assertEqual(response.status_code, 409, response.text)
