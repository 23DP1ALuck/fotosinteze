import unittest
from datetime import datetime

from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, func, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.main import app
from app.database import Base, get_db_session
from app.dependencies.auth import get_current_user
from app.models import (
    Workspace, WorkspaceUsers, WorkspaceRole, User, Department, Project,
    Category, Budget, Account, Expense, Transaction, RevolutConnection,
)
from app.models.workspace import WorkspaceTypeEnum
from app.models.category import CategoryType
from app.models.budget import BudgetPeriod
from app.models.transaction import TransactionSourceEnum
from app.services.workspace_service import load_workspace_member


class WorkspaceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        @event.listens_for(self.engine.sync_engine, 'connect')
        def foreign_keys(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.db = async_sessionmaker(self.engine, expire_on_commit=False)()
        self.db.add_all([
            User(user_id=i, email=f'{i}@test.com', display_name=f'User {i}', password='unused')
            for i in (1, 2, 3)
        ])
        self.db.add_all([
            Workspace(workspace_id=1, name='Business', type=WorkspaceTypeEnum.BUSINESS),
            Workspace(workspace_id=2, name='Personal', type=WorkspaceTypeEnum.PERSONAL),
            Workspace(workspace_id=3, name='Other', type=WorkspaceTypeEnum.BUSINESS),
        ])
        await self.db.flush()
        self.db.add_all([
            WorkspaceUsers(user_id=1, workspace_id=i, role=WorkspaceRole.OWNER) for i in (1, 2, 3)
        ] + [WorkspaceUsers(user_id=2, workspace_id=1, role=WorkspaceRole.EMPLOYEE)])
        await self.db.commit()
        self.user = {'sub': '1'}
        async def session():
            yield self.db
        app.dependency_overrides[get_db_session] = session
        app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url='http://test')

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        await self.client.aclose()
        await self.db.close()
        await self.engine.dispose()

    async def test_load_workspace_member_returns_membership_with_preloaded_workspace(self):
        self.db.expunge_all()
        membership = await load_workspace_member(1, {'sub': '2'}, self.db)
        self.assertIsInstance(membership, WorkspaceUsers)
        self.db.expunge_all()
        self.assertEqual(membership.workspace.name, 'Business')
        self.assertEqual(membership.workspace.base_currency, 'EUR')
        self.assertEqual(membership.role, WorkspaceRole.EMPLOYEE)

    async def test_read_one_includes_currency_and_member_role(self):
        self.user = {'sub': '2'}
        response = await self.client.get('/workspaces/1')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {
            'id': 1, 'name': 'Business', 'type': 'BUSINESS',
            'role': 'EMPLOYEE', 'base_currency': 'EUR',
        })
        self.user = {'sub': '1'}
        self.assertEqual((await self.client.get('/workspaces/2')).status_code, 200)

    async def test_update_persists_normalized_fields_and_timestamp(self):
        workspace = await self.db.get(Workspace, 1)
        workspace.updated_at = datetime(2000, 1, 1)
        await self.db.commit()
        response = await self.client.put('/workspaces/1', json={'name': ' Renamed ', 'base_currency': ' USD '})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['name'], 'Renamed')
        self.assertEqual(response.json()['base_currency'], 'USD')
        await self.db.refresh(workspace)
        self.assertEqual((workspace.name, workspace.base_currency), ('Renamed', 'USD'))
        self.assertGreater(workspace.updated_at, datetime(2000, 1, 1))

    async def test_access_and_business_only_mutations(self):
        for user, workspace_id, expected in [
            ('2', 1, 403), ('3', 1, 403), ('1', 2, 400), ('1', 99, 404), ('999', 1, 401),
        ]:
            self.user = {'sub': user}
            with self.subTest(user=user, workspace_id=workspace_id):
                update = await self.client.put(f'/workspaces/{workspace_id}', json={'name': 'No', 'base_currency': 'EUR'})
                delete = await self.client.delete(f'/workspaces/{workspace_id}')
                self.assertEqual(update.status_code, expected, update.text)
                self.assertEqual(delete.status_code, expected, delete.text)
        for user, workspace_id, expected in [('3', 1, 403), ('1', 99, 404), ('999', 1, 401)]:
            self.user = {'sub': user}
            self.assertEqual((await self.client.get(f'/workspaces/{workspace_id}')).status_code, expected)
        await self.db.refresh(await self.db.get(Workspace, 1))
        self.assertEqual((await self.db.get(Workspace, 1)).name, 'Business')

    async def test_invalid_update_does_not_change_workspace(self):
        for payload, expected in [
            ({'name': ' ', 'base_currency': 'EUR'}, 400),
            ({'name': 'Changed', 'base_currency': ' '}, 400),
            ({'name': 'Changed', 'base_currency': 'EURO'}, 400),
            ({'name': None, 'base_currency': 'EUR'}, 422),
            ({'name': 'Changed'}, 422),
        ]:
            with self.subTest(payload=payload):
                response = await self.client.put('/workspaces/1', json=payload)
                self.assertEqual(response.status_code, expected, response.text)
                await self.db.refresh(await self.db.get(Workspace, 1))
                self.assertEqual((await self.db.get(Workspace, 1)).name, 'Business')

    async def test_duplicate_update_returns_conflict_and_session_remains_usable(self):
        response = await self.client.put('/workspaces/1', json={'name': ' Other ', 'base_currency': 'USD'})
        self.assertEqual(response.status_code, 409, response.text)
        response = await self.client.get('/workspaces/1')
        self.assertEqual(response.json()['name'], 'Business')
        response = await self.client.put('/workspaces/1', json={'name': 'Business', 'base_currency': 'EUR'})
        self.assertEqual(response.status_code, 200, response.text)

    async def test_expense_cannot_have_two_transactions(self):
        self.db.add(Account(account_id=1, name='Cash', currency='EUR', balance=100, workspace_id=1))
        self.db.add(Expense(expense_id=1, workspace_id=1, submitted_by=1, amount=10,
                            currency='EUR', description='Train'))
        await self.db.flush()
        self.db.add(Transaction(workspace_id=1, account_id=1, expense_id=1, amount=10,
                                currency='EUR', description='Train', source=TransactionSourceEnum.EXPENSE))
        await self.db.commit()
        self.db.add(Transaction(workspace_id=1, account_id=1, expense_id=1, amount=5,
                                currency='EUR', description='Duplicate', source=TransactionSourceEnum.EXPENSE))
        with self.assertRaises(IntegrityError):
            await self.db.commit()
        await self.db.rollback()
        self.db.expunge_all()
        expense = await self.db.scalar(select(Expense).options(selectinload(Expense.transactions)))
        self.assertIsInstance(expense.transactions, Transaction)
        self.assertEqual(expense.transactions.amount, 10)

    async def test_delete_removes_linked_data_and_preserves_other_workspace_and_users(self):
        department = Department(department_id=1, name='Team', workspace_id=1)
        project = Project(project_id=1, name='Launch', workspace_id=1, departments=[department])
        category = Category(category_id=1, name='Travel', type=CategoryType.expense, workspace_id=1)
        connection = RevolutConnection(revolut_connection_id=1, external_consent_id='consent', status='active', connected_by_id=1)
        account = Account(account_id=1, name='Bank', currency='EUR', balance=10, workspace_id=1, connection=connection)
        self.db.add_all([department, project, category, account])
        await self.db.flush()
        membership = await self.db.get(WorkspaceUsers, (2, 1))
        membership.department_id = 1
        expense = Expense(expense_id=1, workspace_id=1, submitted_by=2, department_id=1,
                          project_id=1, category_id=1, amount=10, currency='EUR', description='Train')
        self.db.add(expense)
        await self.db.flush()
        self.db.add_all([
            Budget(name='Travel', category_id=1, project_id=1, department_id=1, limit_amount=100,
                   currency='EUR', period_length=BudgetPeriod.MONTHLY),
            Transaction(workspace_id=1, account_id=1, category_id=1, project_id=1, department_id=1,
                        expense_id=1, amount=10, currency='EUR', description='Train', source=TransactionSourceEnum.EXPENSE),
            Transaction(workspace_id=1, account_id=1, category_id=1, project_id=1, department_id=1,
                        amount=5, currency='EUR', description='Bus', source=TransactionSourceEnum.MANUAL),
        ])
        await self.db.commit()
        response = await self.client.delete('/workspaces/1')
        self.assertEqual(response.status_code, 204, response.text)
        self.assertEqual(response.content, b'')
        for model in [Department, Project, Category, Account, Expense, Transaction, Budget, RevolutConnection]:
            self.assertEqual(await self.db.scalar(select(func.count()).select_from(model)), 0, model.__name__)
        self.assertEqual(await self.db.scalar(select(func.count()).select_from(Workspace)), 2)
        self.assertEqual(await self.db.scalar(select(func.count()).select_from(User)), 3)
        self.assertEqual(await self.db.scalar(select(func.count()).select_from(WorkspaceUsers)), 2)
        self.assertEqual((await self.client.get('/workspaces/1')).status_code, 404)
