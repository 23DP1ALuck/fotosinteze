import unittest
from datetime import datetime
from decimal import Decimal
from unittest.mock import patch
import httpx
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.database import Base, get_db_session
from app.dependencies.auth import get_current_user
from app.main import app
from app.models import Account, Category, Transaction, User, Workspace, WorkspaceUsers
from app.models.category import CategoryType
from app.models.transaction import TransactionSourceEnum
from app.models.workspace import WorkspaceTypeEnum

class DashboardTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.db = async_sessionmaker(self.engine, expire_on_commit=False)()
        self.db.add(User(user_id=1, email='dashboard@test.com', display_name='Owner', password='unused'))
        for wid, kind in [(1, WorkspaceTypeEnum.PERSONAL), (2, WorkspaceTypeEnum.PERSONAL), (3, WorkspaceTypeEnum.BUSINESS)]:
            self.db.add(Workspace(workspace_id=wid, name=str(wid), type=kind, base_currency='EUR'))
        await self.db.flush()
        self.db.add_all([WorkspaceUsers(user_id=1, workspace_id=wid) for wid in (1, 2, 3)])
        self.db.add_all([
            Account(account_id=1, name='Main', currency='EUR', balance=700, workspace_id=1),
            Account(account_id=2, name='USD', currency='USD', balance=999, workspace_id=1),
            Account(account_id=3, name='Other', currency='EUR', balance=999, workspace_id=3),
            Category(category_id=1, name='Salary', type=CategoryType.income, workspace_id=1),
            Category(category_id=2, name='Food', type=CategoryType.expense, workspace_id=1)])
        await self.db.commit()
        self.overrides = app.dependency_overrides.copy()
        async def session():
            yield self.db
        async def user():
            return {'sub': '1'}
        app.dependency_overrides[get_db_session] = session
        app.dependency_overrides[get_current_user] = user
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test')

    async def asyncTearDown(self):
        await self.client.aclose()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.overrides)
        await self.db.close()
        await self.engine.dispose()

    def transaction(self, tid, amount, category, date, workspace=1, currency='EUR'):
        self.db.add(Transaction(transaction_id=tid, amount=amount, category_id=category,
            created_at=date, updated_at=date, workspace_id=workspace, currency=currency,
            account_id=1 if workspace == 1 else 3, description=str(tid), source=TransactionSourceEnum.MANUAL))

    async def test_month_totals_and_isolation(self):
        self.transaction(1, 1000, 1, datetime(2026, 10, 1))
        self.transaction(2, 250, 2, datetime(2026, 10, 14))
        self.transaction(3, 9000, 1, datetime(2026, 9, 30, 23, 59))
        self.transaction(4, 9000, 1, datetime(2026, 11, 1))
        self.transaction(5, 9000, None, datetime(2026, 10, 14))
        self.transaction(6, 9000, 1, datetime(2026, 10, 14), currency='USD')
        self.transaction(7, 9000, 1, datetime(2026, 10, 14), workspace=3)
        await self.db.commit()
        with patch('app.services.dashboard_service.datetime') as clock:
            clock.now.return_value = datetime(2026, 10, 14)
            response = await self.client.get('/dashboard', headers={'Workspace-ID': '1'})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        for field, value in [('balance', 700), ('income', 1000), ('expenses', 250), ('savings', 750)]:
            self.assertEqual(Decimal(data[field]), value)
        self.assertEqual(data['currency'], 'EUR')
        self.assertEqual([t['transaction_id'] for t in data['recent_transactions']], [5, 2, 1])

    async def test_empty_workspace_and_access(self):
        response = await self.client.get('/dashboard', headers={'Workspace-ID': '2'})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data['recent_transactions'], [])
        self.assertTrue(all(Decimal(data[key]) == 0 for key in ('balance', 'income', 'expenses', 'savings')))
        for headers, status in [({}, 422), ({'Workspace-ID': '99'}, 403)]:
            response = await self.client.get('/dashboard', headers=headers)
            self.assertEqual(response.status_code, status, response.text)

    async def test_recent_limit_and_negative_savings(self):
        date = datetime.now().replace(day=1)
        for tid in range(1, 13):
            self.transaction(tid, 10, 2, date)
        await self.db.commit()
        response = await self.client.get('/dashboard', headers={'Workspace-ID': '1'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(Decimal(response.json()['savings']), -120)
        self.assertEqual([t['transaction_id'] for t in response.json()['recent_transactions']], list(range(12, 2, -1)))

    async def test_december_boundary_and_authentication(self):
        self.transaction(1, 20, 1, datetime(2026, 12, 1))
        self.transaction(2, 50, 2, datetime(2026, 12, 31, 23, 59))
        self.transaction(3, 100, 1, datetime(2027, 1, 1))
        await self.db.commit()
        with patch('app.services.dashboard_service.datetime') as clock:
            clock.now.return_value = datetime(2026, 12, 14)
            response = await self.client.get('/dashboard', headers={'Workspace-ID': '1'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['period_end'], '2027-01-01')
        self.assertEqual(Decimal(response.json()['savings']), -30)
        del app.dependency_overrides[get_current_user]
        response = await self.client.get('/dashboard', headers={'Workspace-ID': '1'})
        self.assertEqual(response.status_code, 401, response.text)

    async def test_business_dashboard_placeholder_and_membership(self):
        response = await self.client.get('/dashboard', headers={'Workspace-ID': '3'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json())
        membership = await self.db.get(WorkspaceUsers, (1, 3))
        await self.db.delete(membership)
        await self.db.commit()
        response = await self.client.get('/dashboard', headers={'Workspace-ID': '3'})
        self.assertEqual(response.status_code, 403, response.text)
