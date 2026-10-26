import asyncio
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

import httpx
from sqlalchemy import event, select, func
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.database import Base, get_db_session
from app.dependencies.auth import get_current_user
from app.main import app
from app.models import User, Workspace, WorkspaceUsers, WorkspaceRole, Department, Project, Category, Account, Expense, Transaction
from app.models.workspace import WorkspaceTypeEnum
from app.models.category import CategoryType
from app.dto import CreateTransactionRequest
from app.services import expense_service, transaction_service
from fastapi import HTTPException


class ExpenseTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.engine = create_async_engine('sqlite+aiosqlite:///' + str(Path(self.temp.name) / 'expenses.sqlite'))
        @event.listens_for(self.engine.sync_engine, 'connect')
        def enable_fk(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.factory = async_sessionmaker(self.engine, expire_on_commit=False)
        self.db = self.factory()
        self.db.add_all([User(user_id=i, email=f'expense{i}@test.com', display_name=f'User {i}', password='unused') for i in (1, 2, 3, 4)])
        self.db.add_all([
            Workspace(workspace_id=1, name='Business', type=WorkspaceTypeEnum.BUSINESS),
            Workspace(workspace_id=2, name='Other business', type=WorkspaceTypeEnum.BUSINESS),
            Workspace(workspace_id=3, name='Personal', type=WorkspaceTypeEnum.PERSONAL),
        ])
        await self.db.flush()
        self.db.add_all([Department(department_id=i, workspace_id=1 if i < 3 else 2, name=f'Department {i}') for i in (1, 2, 3)])
        await self.db.flush()
        self.db.add_all([
            WorkspaceUsers(user_id=1, workspace_id=1, role=WorkspaceRole.OWNER),
            WorkspaceUsers(user_id=2, workspace_id=1, role=WorkspaceRole.EMPLOYEE, department_id=1),
            WorkspaceUsers(user_id=3, workspace_id=1, role=WorkspaceRole.EMPLOYEE, department_id=2),
            WorkspaceUsers(user_id=4, workspace_id=2, role=WorkspaceRole.OWNER),
            WorkspaceUsers(user_id=1, workspace_id=3, role=WorkspaceRole.OWNER),
            Category(category_id=1, name='Travel', type=CategoryType.expense, workspace_id=1),
            Category(category_id=2, name='Foreign', type=CategoryType.expense, workspace_id=2),
            Category(category_id=3, name='Income', type=CategoryType.income, workspace_id=1),
            Account(account_id=1, name='Business cash', currency='EUR', balance=100, workspace_id=1),
            Account(account_id=2, name='Foreign cash', currency='EUR', balance=100, workspace_id=2),
        ])
        departments = {i: await self.db.get(Department, i) for i in (1, 2, 3)}
        self.db.add_all([
            Project(project_id=1, workspace_id=1, name='Shared', departments=[departments[1], departments[2]]),
            Project(project_id=2, workspace_id=1, name='Other department', departments=[departments[2]]),
            Project(project_id=3, workspace_id=2, name='Foreign project', departments=[departments[3]]),
        ])
        await self.db.commit()
        self.identity = {'sub': '2'}
        async def session_override():
            yield self.db
        async def identity_override():
            return self.identity
        self.original_overrides = app.dependency_overrides.copy()
        app.dependency_overrides[get_db_session] = session_override
        app.dependency_overrides[get_current_user] = identity_override
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test', headers={'Workspace-ID': '1'})

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.original_overrides)
        await self.client.aclose()
        await self.db.close()
        await self.engine.dispose()

    def payload(self, **changes):
        data = dict(category_id=1, amount='12.34', currency='EUR', description='Train ticket')
        data.update(changes)
        return data

    async def submit(self, **changes):
        response = await self.client.post('/expenses', json=self.payload(**changes))
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['id']

    async def test_submit_defaults_and_owner_visibility(self):
        expense_id = await self.submit(project_id=1)
        response = await self.client.get(f'/expenses/{expense_id}')
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual((data['submitted_by'], data['department_id'], data['status']), (2, 1, 'PENDING'))
        self.assertIsNone(data['receipt_url'])
        self.assertIsNone(data['reviewed_by'])
        self.identity = {'sub': '1'}
        response = await self.client.get('/expenses')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([row['id'] for row in response.json()], [expense_id])
        self.assertEqual((await self.client.get(f'/expenses/{expense_id}')).status_code, 200)

    async def test_employee_expense_category_catalog_is_workspace_scoped(self):
        response = await self.client.get('/expenses/categories')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([row['category_id'] for row in response.json()], [1])
        foreign = await self.client.get('/expenses/categories', headers={'Workspace-ID': '2'})
        self.assertEqual(foreign.status_code, 403)

    async def test_list_accounts_for_review_in_active_workspace(self):
        self.identity = {'sub': '1'}
        response = await self.client.get('/accounts')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), [{
            'account_id': 1, 'name': 'Business cash', 'currency': 'EUR',
            'balance': '100.00', 'workspace_id': 1, 'connection_id': None, 'banking_connection_id': None, 'is_main': False,
        }])

        self.identity = {'sub': '1'}
        foreign = await self.client.get('/accounts', headers={'Workspace-ID': '2'})
        self.assertEqual(foreign.status_code, 403, foreign.text)
        personal = await self.client.get('/accounts', headers={'Workspace-ID': '3'})
        self.assertEqual(personal.status_code, 200, personal.text)
        self.assertEqual(personal.json(), [])

        self.identity = {'sub': '2'}
        employee = await self.client.get('/accounts')
        self.assertEqual(employee.status_code, 200, employee.text)
        self.assertEqual([row['workspace_id'] for row in employee.json()], [1])

    async def test_employee_cannot_read_change_delete_or_review_another_submission(self):
        expense_id = await self.submit()
        self.identity = {'sub': '3'}
        self.assertEqual((await self.client.get('/expenses')).json(), [])
        self.assertEqual((await self.client.get(f'/expenses/{expense_id}')).status_code, 403)
        self.assertEqual((await self.client.put(f'/expenses/{expense_id}', json=self.payload())).status_code, 403)
        self.assertEqual((await self.client.delete(f'/expenses/{expense_id}')).status_code, 403)
        self.assertEqual((await self.client.post(f'/expenses/{expense_id}/review', json={'approve': True, 'account_id': 1})).status_code, 403)

    async def test_submission_validates_workspace_and_department_links(self):
        for changes, expected in [({'category_id': 2}, 400), ({'category_id': 999}, 404), ({'category_id': 3}, 400),
                                  ({'project_id': 2}, 403), ({'project_id': 3}, 400), ({'project_id': 999}, 404),
                                  ({'department_id': 2}, 403), ({'department_id': 3}, 403)]:
            with self.subTest(changes=changes):
                response = await self.client.post('/expenses', json=self.payload(**changes))
                self.assertEqual(response.status_code, expected, response.text)
        self.identity = {'sub': '1'}
        response = await self.client.post('/expenses', headers={'Workspace-ID': '3'}, json=self.payload())
        self.assertEqual(response.status_code, 400, response.text)

    async def test_input_validation(self):
        for changes in [{'amount': '0'}, {'amount': '-1'}, {'amount': '1.234'}, {'amount': 'NaN'},
                        {'currency': 'EURO'}, {'description': '   '}, {'status': 'APPROVED'},
                        {'category_id': None}, {'submitted_by': 1}, {'amount': '123456789.01'}]:
            with self.subTest(changes=changes):
                response = await self.client.post('/expenses', json=self.payload(**changes))
                self.assertEqual(response.status_code, 422, response.text)

    async def test_pending_update_revalidates_links_and_delete(self):
        expense_id = await self.submit(project_id=1)
        invalid = await self.client.put(f'/expenses/{expense_id}', json=self.payload(project_id=3))
        self.assertEqual(invalid.status_code, 400, invalid.text)
        response = await self.client.put(f'/expenses/{expense_id}', json=self.payload(amount='20.50', description='Updated', project_id=None))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['description'], 'Updated')
        self.assertIsNone(response.json()['project_id'])
        await self.db.refresh(await self.db.get(Account, 1))
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal('100'))
        self.assertEqual(await self.db.scalar(select(func.count()).select_from(Transaction)), 0)
        self.assertEqual((await self.client.delete(f'/expenses/{expense_id}')).status_code, 204)
        await self.db.refresh(await self.db.get(Account, 1))
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal('100'))
        self.assertEqual(await self.db.scalar(select(func.count()).select_from(Transaction)), 0)
        self.assertIsNone(await self.db.get(Expense, expense_id))

    async def test_approval_creates_one_transaction_and_locks_request(self):
        expense_id = await self.submit(project_id=1)
        self.identity = {'sub': '1'}
        response = await self.client.post(f'/expenses/{expense_id}/review', json={'approve': True, 'account_id': 1})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((response.json()['status'], response.json()['reviewed_by']), ('APPROVED', 1))
        self.assertIsNotNone(response.json()['reviewed_at'])
        tx = await self.db.scalar(select(Transaction).where(Transaction.expense_id == expense_id))
        self.assertIsNotNone(tx)
        self.assertEqual((tx.amount, tx.department_id, tx.project_id), (Decimal('12.34'), 1, 1))
        await self.db.refresh(await self.db.get(Account, 1))
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal('87.66'))
        duplicate = await self.client.post(f'/expenses/{expense_id}/review', json={'approve': True, 'account_id': 1})
        self.assertEqual(duplicate.status_code, 409, duplicate.text)
        self.assertEqual(await self.db.scalar(select(func.count()).select_from(Transaction)), 1)
        for identity in ({'sub': '1'}, {'sub': '2'}):
            self.identity = identity
            self.assertEqual((await self.client.put(f'/expenses/{expense_id}', json=self.payload())).status_code, 409)
            self.assertEqual((await self.client.delete(f'/expenses/{expense_id}')).status_code, 409)

    async def test_rejection_needs_no_account_and_changes_no_balance(self):
        expense_id = await self.submit()
        self.identity = {'sub': '1'}
        response = await self.client.post(f'/expenses/{expense_id}/review', json={'approve': False})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['status'], 'REJECTED')
        self.assertEqual((await self.client.put(f'/expenses/{expense_id}', json=self.payload())).status_code, 409)
        self.assertEqual(await self.db.scalar(select(func.count()).select_from(Transaction)), 0)
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal('100'))
        self.assertEqual((await self.client.delete(f'/expenses/{expense_id}')).status_code, 409)

    async def test_failed_approval_leaves_pending_request_and_balance(self):
        expense_id = await self.submit()
        self.identity = {'sub': '1'}
        missing_account = await self.client.post(f'/expenses/{expense_id}/review', json={'approve': True})
        self.assertEqual(missing_account.status_code, 422, missing_account.text)
        invalid = await self.client.post(f'/expenses/{expense_id}/review', json={'approve': True, 'account_id': 2})
        self.assertEqual(invalid.status_code, 404, invalid.text)
        async with self.factory() as db:
            expense = await db.get(Expense, expense_id)
            self.assertEqual(expense.status.value, 'PENDING')
            self.assertIsNone(expense.reviewed_by)
            self.assertEqual((await db.get(Account, 1)).balance, Decimal('100'))
            self.assertEqual(await db.scalar(select(func.count()).select_from(Transaction)), 0)

    async def test_workspace_header_and_nonmember_access(self):
        expense_id = await self.submit()
        self.identity = {'sub': '4'}
        self.assertEqual((await self.client.get('/expenses')).status_code, 403)
        response = await self.client.get(f'/expenses/{expense_id}', headers={'Workspace-ID': '2'})
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual((await self.client.get('/expenses', headers={'Workspace-ID': '999'})).status_code, 403)

    async def test_concurrent_reviews_charge_once(self):
        expense_id = await self.submit()
        async def approve():
            async with self.factory() as db:
                try:
                    await expense_service.review_expense(expense_id, True, 1, 1, {'sub': '1'}, db)
                    return 200
                except HTTPException as error:
                    return error.status_code
        self.assertEqual(sorted(await asyncio.gather(approve(), approve())), [200, 409])
        async with self.factory() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(Transaction)), 1)
            self.assertEqual((await db.get(Account, 1)).balance, Decimal('87.66'))

    async def test_approval_rejects_account_currency_mismatch(self):
        expense_id = await self.submit(currency='USD')
        self.identity = {'sub': '1'}
        response = await self.client.post(f'/expenses/{expense_id}/review', json={'approve': True, 'account_id': 1})
        self.assertEqual(response.status_code, 400, response.text)
        expense = await self.db.get(Expense, expense_id)
        self.assertEqual(expense.status.value, 'PENDING')
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal('100'))

    async def test_public_transactions_cannot_bypass_review_or_charge_twice(self):
        expense_id = await self.submit()
        data = dict(amount='12.34', currency='EUR', description='Bypass', account_id=1, category_id=1,
                    department_id=1, expense_id=expense_id)
        response = await self.client.post('/transactions', json=data)
        self.assertEqual(response.status_code, 400, response.text)
        self.identity = {'sub': '1'}
        self.assertEqual((await self.client.post(f'/expenses/{expense_id}/review', json={'approve': True, 'account_id': 1})).status_code, 200)
        response = await self.client.post('/transactions', json=data)
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(await self.db.scalar(select(func.count()).select_from(Transaction)), 1)
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal('87.66'))

    async def test_approval_transaction_cannot_be_edited_or_deleted_independently(self):
        expense_id = await self.submit()
        self.identity = {'sub': '1'}
        await self.client.post(f'/expenses/{expense_id}/review', json={'approve': True, 'account_id': 1})
        tx = await self.db.scalar(select(Transaction).where(Transaction.expense_id == expense_id))
        workspace = await self.db.get(Workspace, 1)
        request = CreateTransactionRequest(amount=1, currency='EUR', description='Change', account_id=1, category_id=1)
        for operation in ('update', 'delete'):
            with self.subTest(operation=operation):
                with self.assertRaises(HTTPException) as error:
                    if operation == 'update':
                        await transaction_service.update_transaction(tx.transaction_id, request, self.identity, workspace, self.db)
                    else:
                        await transaction_service.delete_transaction(tx.transaction_id, self.identity, workspace, self.db)
                self.assertEqual(error.exception.status_code, 409)
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal('87.66'))
