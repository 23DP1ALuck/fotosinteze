from decimal import Decimal
from app.models import Account, RevolutConnection
import unittest
from tests import test_transaction_routes


class AccountRouteTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_transaction_routes.TransactionRouteTests.asyncSetUp
    asyncTearDown = test_transaction_routes.TransactionRouteTests.asyncTearDown

    async def test_reads_scope_and_business_access(self):
        response = await self.client.get('/accounts')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([a['account_id'] for a in response.json()], [1])
        self.assertEqual((await self.client.get('/accounts/1')).status_code, 200)
        self.assertEqual((await self.client.get('/accounts/1', headers={'Workspace-ID': '2'})).status_code, 404)
        self.user = {'sub': '2'}
        self.assertEqual((await self.client.get('/accounts')).status_code, 403)
        self.assertEqual((await self.client.get('/accounts', headers={'Workspace-ID': '2'})).status_code, 403)

    async def test_manual_updates_and_protected_fields(self):
        response = await self.client.put('/accounts/1', json={'name': ' Savings ', 'balance': '-12.34'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['name'], 'Savings')
        self.assertEqual(Decimal(response.json()['balance']), Decimal('-12.34'))
        for payload in ({'external_account_id': 'bank'}, {'connection_id': 1}, {'workspace_id': 2},
                        {'currency': 'USD'}, {'name': ' '}, {'name': None}, {'balance': None},
                        {'balance': 'NaN'}, {'balance': '1.001'}, {'balance': '100000000'}):
            response = await self.client.put('/accounts/1', json=payload)
            self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual((await self.client.put('/accounts/1', headers={'Workspace-ID': '2'}, json={'name': 'Other'})).status_code, 404)
        self.user = {'sub': '2'}
        self.assertEqual((await self.client.put('/accounts/1', json={'balance': 0})).status_code, 403)

    async def test_connected_balance_is_bank_managed(self):
        self.db.add(RevolutConnection(revolut_connection_id=1, external_consent_id='consent', status='active', connected_by_id=1))
        account = await self.db.get(Account, 1)
        account.connection_id = 1
        await self.db.commit()
        response = await self.client.put('/accounts/1', json={'name': 'Bank', 'balance': 0})
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(account.name, 'Cash')
        self.assertEqual((await self.client.put('/accounts/1', json={'name': 'Bank'})).status_code, 200)
        response = await self.client.post('/transactions', json=self.payload)
        self.assertEqual(response.status_code, 201, response.text)
        await self.db.refresh(account)
        self.assertEqual(account.balance, Decimal('80'))
        transaction_id = response.json()['transaction_id']
        self.assertEqual((await self.client.put(f'/transactions/{transaction_id}', json={**self.payload, 'amount': 40})).status_code, 200)
        self.assertEqual((await self.client.delete(f'/transactions/{transaction_id}')).status_code, 204)
        await self.db.refresh(account)
        self.assertEqual(account.balance, Decimal('80'))

    async def test_create_manual_account(self):
        payload = {'name': ' Wallet ', 'currency': 'EUR', 'balance': '12.34'}
        response = await self.client.post('/accounts', headers={'Workspace-ID': '2'}, json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        account = response.json()
        self.assertEqual(account['name'], 'Wallet')
        self.assertEqual(account['workspace_id'], 2)
        self.assertIsNone(account['connection_id'])
        self.assertEqual((await self.client.post('/accounts', headers={'Workspace-ID': '2'}, json=payload)).status_code, 409)
        self.assertEqual((await self.client.get(f"/accounts/{account['account_id']}", headers={'Workspace-ID': '2'})).status_code, 200)

    async def test_empty_list_missing_account_and_creation_validation(self):
        response = await self.client.get('/accounts', headers={'Workspace-ID': '2'})
        self.assertEqual(response.json(), [])
        self.assertEqual((await self.client.get('/accounts/999')).status_code, 404)
        payload = {'name': 'Cash', 'currency': 'EUR', 'balance': 0}
        self.assertEqual((await self.client.post('/accounts', json=payload)).status_code, 409)
        for fields in ({'name': ' '}, {'currency': 'eur'}, {'balance': '1.001'},
                       {'connection_id': 1}, {'external_account_id': 'bank'}, {'workspace_id': 2}):
            response = await self.client.post('/accounts', json={**payload, **fields})
            self.assertEqual(response.status_code, 422, response.text)
        self.user = {'sub': '2'}
        self.assertEqual((await self.client.get('/accounts/1')).status_code, 403)
        self.assertEqual((await self.client.post('/accounts', json=payload)).status_code, 403)

    async def test_transfer_between_manual_and_connected_accounts(self):
        self.db.add(RevolutConnection(revolut_connection_id=1, external_consent_id='bank', status='expired', connected_by_id=1))
        self.db.add(Account(account_id=2, name='Bank', currency='EUR', workspace_id=1, balance=100, connection_id=1))
        await self.db.commit()
        response = await self.client.put('/transactions/1', json={**self.payload, 'account_id': 2})
        self.assertEqual(response.status_code, 200, response.text)
        manual = await self.db.get(Account, 1)
        bank = await self.db.get(Account, 2)
        await self.db.refresh(manual)
        await self.db.refresh(bank)
        self.assertEqual(manual.balance, Decimal('100'))
        self.assertEqual(bank.balance, Decimal('100'))
        response = await self.client.put('/transactions/1', json=self.payload)
        self.assertEqual(response.status_code, 200, response.text)
        await self.db.refresh(manual)
        await self.db.refresh(bank)
        self.assertEqual(manual.balance, Decimal('70'))
        self.assertEqual(bank.balance, Decimal('100'))
