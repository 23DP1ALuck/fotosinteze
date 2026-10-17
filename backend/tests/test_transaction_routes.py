import unittest
from decimal import Decimal
from datetime import datetime

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.main import app
from app.database import Base, get_db_session
from app.dependencies.auth import get_current_user
from app.models import Account, Category, Department, Transaction, User, Workspace, WorkspaceUsers, WorkspaceRole
from app.models.category import CategoryType
from app.models.transaction import TransactionSourceEnum
from app.models.workspace import WorkspaceTypeEnum
from app.dto import CreateTransactionRequest, TransactionResponseDTO
from app.services import transaction_service


class TransactionRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.db = async_sessionmaker(self.engine, expire_on_commit=False)()
        self.db.add_all([
            User(user_id=1, email='owner@test.com', display_name='Owner', password='unused'),
            User(user_id=2, email='employee@test.com', display_name='Employee', password='unused'),
            Workspace(workspace_id=1, name='Business', type=WorkspaceTypeEnum.BUSINESS),
            Workspace(workspace_id=2, name='Personal', type=WorkspaceTypeEnum.PERSONAL),
        ])
        await self.db.flush()
        self.db.add_all([
            WorkspaceUsers(user_id=1, workspace_id=1, role=WorkspaceRole.OWNER),
            WorkspaceUsers(user_id=1, workspace_id=2, role=WorkspaceRole.OWNER),
            Department(department_id=1, name='First', workspace_id=1),
            Department(department_id=2, name='Second', workspace_id=1),
            Category(category_id=1, name='Travel', workspace_id=1, type=CategoryType.expense),
            Account(account_id=1, name='Cash', currency='EUR', workspace_id=1, balance=80),
        ])
        await self.db.flush()
        self.db.add_all([
            WorkspaceUsers(user_id=2, workspace_id=1, role=WorkspaceRole.EMPLOYEE, department_id=2),
            Transaction(transaction_id=1, workspace_id=1, account_id=1, category_id=1,
                        department_id=1, amount=20, currency='EUR', description='Old', source=TransactionSourceEnum.MANUAL),
        ])
        await self.db.commit()
        self.user = {'sub': '1'}
        async def session():
            yield self.db
        app.dependency_overrides[get_db_session] = session
        app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url='http://test', headers={'Workspace-ID': '1'})
        self.payload = dict(amount=30, currency='EUR', description='Updated', account_id=1, category_id=1, department_id=1)

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        await self.client.aclose()
        await self.db.close()
        await self.engine.dispose()

    async def test_transaction_service_returns_dtos_without_external_id(self):
        workspace = await self.db.get(Workspace, 1)
        created = await transaction_service.create_transaction(
            CreateTransactionRequest(**self.payload), self.user, workspace, self.db)
        self.assertIsInstance(created, TransactionResponseDTO)
        updated = await transaction_service.update_transaction(
            created.transaction_id, CreateTransactionRequest(**{**self.payload, 'description': 'Changed'}),
            self.user, workspace, self.db)
        self.assertIsInstance(updated, TransactionResponseDTO)
        self.assertEqual(updated.description, 'Changed')
        items = await transaction_service.get_transactions(workspace, self.user, self.db)
        self.assertTrue(all(isinstance(item, TransactionResponseDTO) for item in items.items))
        read = await transaction_service.get_transaction_by_id(created.transaction_id, self.user, workspace, self.db)
        self.assertIsInstance(read, TransactionResponseDTO)
        self.assertNotIn('external_transaction_id', read.model_dump())

    async def test_openapi_documents_transaction_response_and_errors(self):
        app.openapi_schema = None
        paths = app.openapi()['paths']
        for path, method, status in [
            ('/transactions', 'post', '201'), ('/transactions', 'get', '200'),
            ('/transactions/{transaction_id}', 'get', '200'),
            ('/transactions/{transaction_id}', 'put', '200'),
        ]:
            operation = paths[path][method]
            schema = operation['responses'][status]['content']['application/json']['schema']
            if path == '/transactions' and method == 'get':
                self.assertEqual(schema['$ref'], '#/components/schemas/TransactionListResponseDTO')
                schema = app.openapi()['components']['schemas']['TransactionListResponseDTO']['properties']['items']['items']
            self.assertEqual(schema['$ref'], '#/components/schemas/TransactionResponseDTO')
            for code in ('401', '403', '422'):
                self.assertIn(code, operation['responses'])
        for method in ('get', 'put', 'delete'):
            self.assertIn('404', paths['/transactions/{transaction_id}'][method]['responses'])
        for path, method in [('/transactions', 'post'), ('/transactions/{transaction_id}', 'put')]:
            self.assertIn('400', paths[path][method]['responses'])
        delete = paths['/transactions/{transaction_id}']['delete']
        self.assertNotIn('content', delete['responses']['204'])

    async def test_list_scopes_transactions_to_workspace_and_employee_department(self):
        self.db.add(Account(account_id=2, name='Personal', currency='EUR', workspace_id=2, balance=100))
        await self.db.flush()
        self.db.add_all([
            Transaction(transaction_id=2, workspace_id=1, account_id=1, category_id=1,
                        department_id=2, amount=5, currency='EUR', description='Second team', source=TransactionSourceEnum.MANUAL),
            Transaction(transaction_id=3, workspace_id=1, account_id=1, category_id=1,
                        amount=5, currency='EUR', description='Unassigned', source=TransactionSourceEnum.MANUAL),
            Transaction(transaction_id=4, workspace_id=2, account_id=2,
                        amount=5, currency='EUR', description='Personal', source=TransactionSourceEnum.MANUAL),
        ])
        await self.db.commit()
        for user, workspace, expected in [('1', '1', [1, 2, 3]), ('1', '2', [4]), ('2', '1', [2])]:
            self.user = {'sub': user}
            response = await self.client.get('/transactions', headers={'Workspace-ID': workspace})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(sorted(row['transaction_id'] for row in response.json()["items"]), expected)

    async def test_list_returns_empty_page_for_empty_workspace(self):
        response = await self.client.get('/transactions', headers={'Workspace-ID': '2'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"items": [], "limit": 50, "offset": 0, "has_more": False})

    async def test_history_order_and_page_boundaries(self):
        # IDs deliberately disagree with creation order; equal dates use descending IDs.
        for transaction_id, created_at in [(2, datetime(2025, 1, 1)), (3, datetime(2024, 1, 1)),
                                           (4, datetime(2025, 1, 1))]:
            self.db.add(Transaction(transaction_id=transaction_id, workspace_id=1, account_id=1,
                                    department_id=2, amount=5, currency='EUR', description='History',
                                    source=TransactionSourceEnum.MANUAL, created_at=created_at))
        original = await self.db.get(Transaction, 1)
        original.created_at = datetime(2023, 1, 1)
        await self.db.commit()
        for offset, expected, has_more in [(0, [4, 2], True), (2, [3, 1], False), (4, [], False)]:
            response = await self.client.get('/transactions', params={'limit': 2, 'offset': offset})
            self.assertEqual(response.status_code, 200, response.text)
            page = response.json()
            self.assertEqual([row['transaction_id'] for row in page['items']], expected)
            self.assertEqual((page['limit'], page['offset'], page['has_more']), (2, offset, has_more))
        self.user = {'sub': '2'}
        response = await self.client.get('/transactions', params={'limit': 2, 'offset': 2})
        self.assertEqual([row['transaction_id'] for row in response.json()['items']], [3])
        self.assertFalse(response.json()['has_more'])

    async def test_history_requires_authentication(self):
        app.dependency_overrides.pop(get_current_user)
        response = await self.client.get('/transactions')
        self.assertEqual(response.status_code, 401, response.text)

    async def test_history_rejects_invalid_pagination(self):
        for params in [{'limit': 0}, {'limit': 101}, {'limit': 'invalid'}, {'offset': -1}, {'offset': 'invalid'}]:
            with self.subTest(params=params):
                response = await self.client.get('/transactions', params=params)
                self.assertEqual(response.status_code, 422, response.text)

    async def test_list_denies_nonmember_and_unassigned_employee(self):
        self.user = {'sub': '2'}
        response = await self.client.get('/transactions', headers={'Workspace-ID': '2'})
        self.assertEqual(response.status_code, 403, response.text)
        membership = await self.db.get(WorkspaceUsers, (2, 1))
        membership.department_id = None
        await self.db.commit()
        response = await self.client.get('/transactions')
        self.assertEqual(response.status_code, 403, response.text)

    async def test_get_returns_transaction_for_owner_and_assigned_employee(self):
        for user in ('1', '2'):
            if user == '2':
                membership = await self.db.get(WorkspaceUsers, (2, 1))
                membership.department_id = 1
                await self.db.commit()
            self.user = {'sub': user}
            response = await self.client.get('/transactions/1')
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['transaction_id'], 1)
            self.assertEqual(response.json()['description'], 'Old')
            self.assertEqual(Decimal(str(response.json()['amount'])), Decimal('20'))
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal('80'))

    async def test_get_rejects_missing_foreign_and_unauthorized_transactions(self):
        for user, workspace_id, transaction_id, expected in [
            ('1', '1', 999, 404), ('1', '2', 1, 404),
            ('2', '1', 1, 403), ('2', '2', 1, 403),
        ]:
            self.user = {'sub': user}
            with self.subTest(user=user, workspace=workspace_id, transaction=transaction_id):
                response = await self.client.get(f'/transactions/{transaction_id}', headers={'Workspace-ID': workspace_id})
                self.assertEqual(response.status_code, expected, response.text)

    async def test_put_updates_transaction_and_balance(self):
        response = await self.client.put('/transactions/1', json=self.payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['description'], 'Updated')
        self.assertEqual(Decimal(str(response.json()['amount'])), Decimal('30'))
        await self.db.refresh(await self.db.get(Account, 1))
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal('70'))

    async def test_delete_reverses_balance_and_returns_no_content(self):
        response = await self.client.delete('/transactions/1')
        self.assertEqual(response.status_code, 204, response.text)
        self.assertEqual(response.content, b'')
        self.assertIsNone(await self.db.get(Transaction, 1))
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal('100'))

    async def test_routes_enforce_workspace_and_department_access(self):
        for user, workspace_id, expected in [('1', '2', 404), ('2', '1', 403), ('2', '2', 403)]:
            self.user = {'sub': user}
            with self.subTest(user=user, workspace=workspace_id):
                update = await self.client.put('/transactions/1', json=self.payload, headers={'Workspace-ID': workspace_id})
                delete = await self.client.delete('/transactions/1', headers={'Workspace-ID': workspace_id})
                self.assertEqual(update.status_code, expected, update.text)
                self.assertEqual(delete.status_code, expected, delete.text)
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal('80'))
        self.assertEqual((await self.db.get(Transaction, 1)).description, 'Old')

    async def test_invalid_update_and_missing_transaction(self):
        response = await self.client.put('/transactions/1', json={**self.payload, 'amount': 0})
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal('80'))
        self.assertEqual((await self.client.put('/transactions/999', json=self.payload)).status_code, 404)
        self.assertEqual((await self.client.delete('/transactions/999')).status_code, 404)
