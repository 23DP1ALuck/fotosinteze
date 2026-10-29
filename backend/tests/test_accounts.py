from decimal import Decimal
from app.models import Account, Category, Department, Expense, RevolutConnection, Transaction
from app.models.expenses import ExpenseStatusEnum
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
import unittest
from tests import test_transaction_routes


class AccountRouteTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_transaction_routes.TransactionRouteTests.asyncSetUp
    asyncTearDown = test_transaction_routes.TransactionRouteTests.asyncTearDown

    async def test_delete_unused_accounts_in_personal_and_business_workspaces(self):
        for workspace_id in (1, 2):
            headers = {'Workspace-ID': str(workspace_id)}
            created = await self.client.post('/accounts', headers=headers,
                json={'name': 'Disposable', 'currency': 'EUR', 'balance': 0, 'is_main': True})
            self.assertEqual(created.status_code, 201, created.text)
            account_id = created.json()['account_id']
            response = await self.client.delete(f'/accounts/{account_id}', headers=headers)
            self.assertEqual(response.status_code, 204, response.text)
            self.assertEqual(response.content, b'')
            self.assertEqual((await self.client.get(f'/accounts/{account_id}', headers=headers)).status_code, 404)
            self.assertNotIn(account_id, [a['account_id'] for a in (await self.client.get('/accounts', headers=headers)).json()])
            self.assertEqual((await self.client.delete(f'/accounts/{account_id}', headers=headers)).status_code, 404)

    async def test_delete_enforces_workspace_scope_and_owner_access(self):
        self.assertEqual((await self.client.delete('/accounts/999')).status_code, 404)
        self.assertEqual((await self.client.delete('/accounts/1', headers={'Workspace-ID': '2'})).status_code, 404)
        self.user = {'sub': '2'}
        self.assertEqual((await self.client.delete('/accounts/1')).status_code, 403)
        self.assertEqual((await self.client.delete('/accounts/1', headers={'Workspace-ID': '2'})).status_code, 403)
        self.user = {'sub': '999'}
        self.assertEqual((await self.client.delete('/accounts/1')).status_code, 401)
        self.assertIsNotNone(await self.db.get(Account, 1))

    async def test_delete_removes_transactions_and_linked_expenses_only(self):
        await self.db.execute(text('PRAGMA foreign_keys=ON'))
        for expense_id in (1, 2):
            self.db.add(Expense(expense_id=expense_id, workspace_id=1, submitted_by=1,
                category_id=1, amount=20, currency='EUR', description='Expense',
                status=ExpenseStatusEnum.APPROVED if expense_id == 1 else ExpenseStatusEnum.PENDING))
        self.db.add(Account(account_id=2, name='Other', workspace_id=1, currency='EUR', balance=50))
        await self.db.flush()
        transaction = await self.db.get(Transaction, 1)
        transaction.expense_id = 1
        self.db.add(Transaction(transaction_id=2, workspace_id=1, account_id=2,
            amount=10, currency='EUR', description='Keep', source=transaction.source))
        await self.db.commit()

        response = await self.client.delete('/accounts/1')
        self.assertEqual(response.status_code, 204, response.text)
        self.assertIsNone(await self.db.get(Account, 1))
        self.assertIsNone(await self.db.get(Transaction, 1))
        self.assertIsNone(await self.db.get(Expense, 1))
        self.assertIsNotNone(await self.db.get(Expense, 2))
        self.assertIsNotNone(await self.db.get(Transaction, 2))
        self.assertEqual((await self.db.get(Account, 2)).balance, Decimal('50'))
        self.assertIsNotNone(await self.db.get(Category, 1))
        self.assertIsNotNone(await self.db.get(Department, 1))

    async def test_delete_personal_account_with_transactions(self):
        self.db.add(Account(account_id=2, name='Personal', workspace_id=2, currency='EUR', balance=50))
        await self.db.flush()
        original = await self.db.get(Transaction, 1)
        self.db.add(Transaction(transaction_id=2, workspace_id=2, account_id=2,
            amount=10, currency='EUR', description='Personal', source=original.source))
        await self.db.commit()
        response = await self.client.delete('/accounts/2', headers={'Workspace-ID': '2'})
        self.assertEqual(response.status_code, 204, response.text)
        self.assertIsNone(await self.db.get(Account, 2))
        self.assertIsNone(await self.db.get(Transaction, 2))
        self.assertIsNotNone(await self.db.get(Transaction, 1))

    async def test_failed_account_deletion_rolls_back_transaction_removal(self):
        await self.db.execute(text("CREATE TRIGGER prevent_account_delete BEFORE DELETE ON accounts "
                                   "BEGIN SELECT RAISE(ABORT, 'Deletion failed'); END"))
        await self.db.commit()
        with self.assertRaises(IntegrityError):
            await self.client.delete('/accounts/1')
        await self.db.rollback()
        self.assertIsNotNone(await self.db.get(Account, 1))
        self.assertIsNotNone(await self.db.get(Transaction, 1))

    async def test_delete_rejects_bank_linked_accounts_without_deleting_connection(self):
        self.db.add(RevolutConnection(revolut_connection_id=1, external_consent_id='consent', status='active', connected_by_id=1))
        self.db.add(Account(account_id=2, name='Bank', currency='EUR', workspace_id=1, balance=0, connection_id=1))
        await self.db.commit()
        response = await self.client.delete('/accounts/2')
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIsNotNone(await self.db.get(Account, 2))
        self.assertIsNotNone(await self.db.get(RevolutConnection, 1))

    async def test_reads_scope_and_business_access(self):
        response = await self.client.get('/accounts')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([a['account_id'] for a in response.json()], [1])
        self.assertEqual((await self.client.get('/accounts/1')).status_code, 200)
        self.assertEqual((await self.client.get('/accounts/1', headers={'Workspace-ID': '2'})).status_code, 404)
        self.user = {'sub': '2'}
        response = await self.client.get('/accounts')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([a['account_id'] for a in response.json()], [1])
        self.assertEqual((await self.client.get('/accounts/1')).status_code, 200)
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
        response = await self.client.put('/accounts/1', json={'balance': 0})
        self.assertEqual(response.status_code, 403, response.text)
        await self.db.refresh(await self.db.get(Account, 1))
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal('-12.34'))
        self.assertEqual((await self.client.put('/accounts/1', headers={'Workspace-ID': '2'},
                                                json={'balance': 0})).status_code, 403)

    async def test_employee_can_select_account_for_transaction_but_cannot_manage_it(self):
        self.user = {'sub': '2'}
        response = await self.client.get('/accounts')
        self.assertEqual(response.status_code, 200, response.text)
        account_id = response.json()[0]['account_id']
        response = await self.client.post('/accounts', json={'name': 'New', 'currency': 'EUR', 'balance': 0})
        self.assertEqual(response.status_code, 403, response.text)
        for fields in ({'name': 'Renamed'}, {'balance': 0}):
            response = await self.client.put(f'/accounts/{account_id}', json=fields)
            self.assertEqual(response.status_code, 403, response.text)
        account = await self.db.get(Account, account_id)
        await self.db.refresh(account)
        self.assertEqual(account.name, 'Cash')
        self.assertEqual(account.balance, Decimal('80'))
        response = await self.client.post('/transactions', json={**self.payload, 'account_id': account_id, 'department_id': 2})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()['account_id'], account_id)

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
        self.assertEqual((await self.client.get('/accounts/1')).status_code, 200)
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

    async def test_main_account_is_persisted_unique_and_scoped_to_workspace(self):
        created = await self.client.post('/accounts', json={'name': 'Savings', 'currency': 'EUR', 'balance': 0})
        second_id = created.json()['account_id']
        self.assertFalse(created.json()['is_main'])
        personal = await self.client.post('/accounts', headers={'Workspace-ID': '2'}, json={'name': 'Personal', 'currency': 'EUR', 'balance': 0, 'is_main': True})
        self.assertEqual(personal.status_code, 201, personal.text)
        self.assertTrue(personal.json()['is_main'])
        first = await self.client.put('/accounts/1', json={'is_main': True})
        self.assertEqual(first.status_code, 200, first.text)
        self.assertTrue(first.json()['is_main'])
        second = await self.client.put(f'/accounts/{second_id}', json={'is_main': True})
        self.assertEqual(second.status_code, 200, second.text)
        rows = (await self.client.get('/accounts')).json()
        self.assertEqual([row['account_id'] for row in rows if row['is_main']], [second_id])
        self.assertTrue((await self.client.get(f"/accounts/{personal.json()['account_id']}", headers={'Workspace-ID': '2'})).json()['is_main'])
        await self.client.put(f'/accounts/{second_id}', json={'name': 'Renamed'})
        self.assertTrue((await self.client.get(f'/accounts/{second_id}')).json()['is_main'])

    async def test_main_account_requires_owner_and_valid_boolean(self):
        for value in (None, 'yes', 1):
            response = await self.client.put('/accounts/1', json={'is_main': value})
            self.assertEqual(response.status_code, 422, response.text)
        self.user = {'sub': '2'}
        response = await self.client.put('/accounts/1', json={'is_main': True})
        self.assertEqual(response.status_code, 403, response.text)
        self.assertFalse((await self.client.get('/accounts/1')).json()['is_main'])

    async def test_first_created_account_is_main_and_later_accounts_preserve_selection(self):
        headers = {'Workspace-ID': '2'}
        payload = {'name': 'First', 'currency': 'EUR', 'balance': 0}
        first = await self.client.post('/accounts', headers=headers, json=payload)
        self.assertEqual(first.status_code, 201, first.text)
        self.assertTrue(first.json()['is_main'])
        first_id = first.json()['account_id']
        second = await self.client.post('/accounts', headers=headers, json={**payload, 'name': 'Second'})
        self.assertEqual(second.status_code, 201, second.text)
        self.assertFalse(second.json()['is_main'])
        second_id = second.json()['account_id']
        rows = (await self.client.get('/accounts', headers=headers)).json()
        self.assertEqual([row['account_id'] for row in rows if row['is_main']], [first_id])
        changed = await self.client.put(f'/accounts/{second_id}', headers=headers, json={'is_main': True})
        self.assertEqual(changed.status_code, 200, changed.text)
        third = await self.client.post('/accounts', headers=headers, json={**payload, 'name': 'Third'})
        self.assertEqual(third.status_code, 201, third.text)
        self.assertFalse(third.json()['is_main'])
        rows = (await self.client.get('/accounts', headers=headers)).json()
        self.assertEqual([row['account_id'] for row in rows if row['is_main']], [second_id])
