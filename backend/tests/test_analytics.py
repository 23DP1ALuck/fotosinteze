import unittest
from datetime import datetime
from decimal import Decimal

import httpx
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base, get_db_session
from app.dependencies.auth import get_current_user
from app.main import app
from app.models import Account, Category, Department, Transaction, User, Workspace, WorkspaceRole, WorkspaceUsers
from app.models.category import CategoryType
from app.models.transaction import TransactionSourceEnum
from app.models.workspace import WorkspaceTypeEnum


class AnalyticsTests(unittest.IsolatedAsyncioTestCase):
    endpoints = ('summary', 'categories', 'timeseries')

    async def asyncSetUp(self):
        self.engine = create_async_engine('sqlite+aiosqlite:///:memory:')

        @event.listens_for(self.engine.sync_engine, 'connect')
        def enable_fk(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')

        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.db = async_sessionmaker(self.engine, expire_on_commit=False)()
        self.db.add(User(user_id=1, email='analytics@test.com', display_name='Owner', password='unused'))
        self.db.add_all([
            Workspace(workspace_id=1, name='Personal', type=WorkspaceTypeEnum.PERSONAL, base_currency='EUR'),
            Workspace(workspace_id=2, name='Business', type=WorkspaceTypeEnum.BUSINESS, base_currency='EUR'),
            Workspace(workspace_id=3, name='Foreign', type=WorkspaceTypeEnum.PERSONAL, base_currency='EUR'),
        ])
        await self.db.flush()
        self.db.add_all([
            Department(department_id=1, workspace_id=2, name='Engineering'),
            Department(department_id=2, workspace_id=2, name='Sales'),
            WorkspaceUsers(user_id=1, workspace_id=1, role=WorkspaceRole.OWNER),
            WorkspaceUsers(user_id=1, workspace_id=2, role=WorkspaceRole.OWNER),
        ])
        for wid in (1, 2, 3):
            self.db.add(Account(account_id=wid, workspace_id=wid, name='Cash', currency='EUR', balance=0))
            self.db.add_all([
                Category(category_id=wid * 10, workspace_id=wid, name='Income', type=CategoryType.income),
                Category(category_id=wid * 10 + 1, workspace_id=wid, name='Food', type=CategoryType.expense),
                Category(category_id=wid * 10 + 2, workspace_id=wid, name='Travel', type=CategoryType.expense),
            ])
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

    def transaction(self, amount, category=11, created='2026-10-01T12:00:00', workspace=1, **changes):
        row = Transaction(amount=Decimal(amount), category_id=category,
                          created_at=datetime.fromisoformat(created), account_id=workspace,
                          workspace_id=workspace, currency='EUR', description='Analytics',
                          source=TransactionSourceEnum.MANUAL)
        for key, value in changes.items():
            setattr(row, key, value)
        self.db.add(row)
        return row

    async def get(self, endpoint='summary', workspace=1, start='2026-10-01', end='2026-10-03'):
        return await self.client.get(f'/statistics/{endpoint}', headers={'Workspace-ID': str(workspace)},
                                     params={'date_from': start, 'date_to': end})

    def assert_expenses(self, endpoint, data, expected):
        amount = Decimal(data['expenses']) if endpoint == 'summary' else sum(
            (Decimal(item['amount']) for item in data['items']), Decimal(0))
        self.assertEqual(amount, Decimal(expected))

    async def test_summary_exact_totals_and_inclusive_dates(self):
        self.transaction('1000.25', category=10, created='2026-10-01T00:00:00')
        self.transaction('250.10', created='2026-10-03T23:59:59.999999')
        for created in ('2026-09-30T23:59:59.999999', '2026-10-04T00:00:00'):
            self.transaction('9000', created=created)
        await self.db.commit()
        response = await self.get()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {
            'workspace_id': 1, 'currency': 'EUR', 'date_from': '2026-10-01', 'date_to': '2026-10-03',
            'income': '1000.25', 'expenses': '250.10',
        })

    async def test_currency_category_and_workspace_isolation(self):
        self.transaction('12.34')
        self.transaction('9000', currency='USD')
        self.transaction('9000', category=None)
        self.transaction('9000', category=31, workspace=3)
        self.transaction('9000', category=31)  # Invalid legacy cross-workspace category.
        self.transaction('9000', created='2026-09-30T23:59:59.999999')
        self.transaction('9000', created='2026-10-04T00:00:00')
        await self.db.commit()
        for endpoint in self.endpoints:
            with self.subTest(endpoint=endpoint):
                response = await self.get(endpoint)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()['workspace_id'], 1)
                self.assert_expenses(endpoint, response.json(), '12.34')

    async def test_business_owner_and_employee_scope(self):
        self.transaction('10.10', category=21, workspace=2, department_id=1)
        self.transaction('20.20', category=21, workspace=2, department_id=2)
        self.transaction('5.00', category=21, workspace=2)
        self.transaction('100.00', category=20, workspace=2, department_id=1)
        self.transaction('200.00', category=20, workspace=2, department_id=2)
        await self.db.commit()
        membership = await self.db.get(WorkspaceUsers, (1, 2))
        for role, department, expected in ((WorkspaceRole.OWNER, None, '35.30'),
                                           (WorkspaceRole.EMPLOYEE, 1, '10.10'),
                                           (WorkspaceRole.EMPLOYEE, 2, '20.20')):
            membership.role, membership.department_id = role, department
            await self.db.commit()
            for endpoint in self.endpoints:
                with self.subTest(role=role, department=department, endpoint=endpoint):
                    response = await self.get(endpoint, workspace=2)
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assert_expenses(endpoint, response.json(), expected)
                    if endpoint == 'summary':
                        self.assertEqual(Decimal(response.json()['income']),
                                         {None: Decimal(300), 1: Decimal(100), 2: Decimal(200)}[department])
        membership.department_id = None
        await self.db.commit()
        for endpoint in self.endpoints:
            self.assertEqual((await self.get(endpoint, workspace=2)).status_code, 403)

    async def test_empty_period(self):
        for endpoint in self.endpoints:
            response = await self.get(endpoint)
            self.assertEqual(response.status_code, 200, response.text)
            self.assert_expenses(endpoint, response.json(), '0')
            if endpoint == 'summary':
                self.assertEqual(Decimal(response.json()['income']), 0)
            elif endpoint == 'categories':
                self.assertEqual(response.json()['items'], [])
            else:
                self.assertEqual(response.json()['items'], [
                    {'date': '2026-10-01', 'amount': '0.00'},
                    {'date': '2026-10-02', 'amount': '0.00'},
                    {'date': '2026-10-03', 'amount': '0.00'},
                ])

    async def test_leap_day_and_year_boundaries(self):
        self.transaction('1.10', created='2024-02-28T23:59:59.999999')
        self.transaction('2.20', created='2024-02-29T23:59:59.999999')
        self.transaction('4.40', created='2024-03-01T00:00:00')
        self.transaction('8.80', created='2026-12-31T23:59:59.999999')
        self.transaction('17.60', created='2027-01-01T00:00:00')
        self.transaction('12.34', created='9999-12-31T23:59:59.999999')
        await self.db.commit()
        for start, end, expected in (('2024-02-29', '2024-02-29', '2.20'),
                                     ('2026-12-31', '2027-01-01', '26.40'),
                                     ('9999-12-31', '9999-12-31', '12.34')):
            for endpoint in self.endpoints:
                with self.subTest(start=start, end=end, endpoint=endpoint):
                    response = await self.get(endpoint, start=start, end=end)
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assert_expenses(endpoint, response.json(), expected)

    async def test_validation_and_workspace_access(self):
        for endpoint in self.endpoints:
            url = f'/statistics/{endpoint}'
            with self.subTest(endpoint=endpoint):
                self.assertEqual((await self.get(endpoint, start='2026-10-04')).status_code, 400)
                self.assertEqual((await self.get(endpoint, start='bad-date')).status_code, 422)
                self.assertEqual((await self.get(endpoint, start='2026-02-30')).status_code, 422)
                self.assertEqual((await self.client.get(url, headers={'Workspace-ID': '1'})).status_code, 422)
                self.assertEqual((await self.client.get(url, params={'date_from': '2026-10-01',
                                                                   'date_to': '2026-10-03'})).status_code, 422)
                self.assertEqual((await self.get(endpoint, workspace=3)).status_code, 403)
                self.assertEqual((await self.get(endpoint, workspace=999)).status_code, 403)
        del app.dependency_overrides[get_current_user]
        for endpoint in self.endpoints:
            self.assertEqual((await self.get(endpoint)).status_code, 401)

    async def test_category_groups_and_daily_zero_fill(self):
        self.transaction('10.10', created='2026-10-01T00:00:00')
        self.transaction('20.20', created='2026-10-03T23:59:59.999999')
        self.transaction('5.00', category=12)
        self.transaction('1000.25', category=10)
        await self.db.commit()
        categories = await self.get('categories')
        self.assertEqual(categories.status_code, 200, categories.text)
        self.assertEqual(categories.json(), {
            'workspace_id': 1, 'currency': 'EUR', 'date_from': '2026-10-01', 'date_to': '2026-10-03',
            'items': [{'id': 11, 'name': 'Food', 'amount': '30.30'},
                      {'id': 12, 'name': 'Travel', 'amount': '5.00'}],
        })
        timeseries = await self.get('timeseries')
        self.assertEqual(timeseries.status_code, 200, timeseries.text)
        self.assertEqual(timeseries.json(), {
            'workspace_id': 1, 'currency': 'EUR', 'date_from': '2026-10-01', 'date_to': '2026-10-03',
            'items': [{'date': '2026-10-01', 'amount': '15.10'},
                      {'date': '2026-10-02', 'amount': '0.00'},
                      {'date': '2026-10-03', 'amount': '20.20'}],
        })

    async def test_category_ties_use_ids_and_preserve_duplicate_names(self):
        category = await self.db.get(Category, 12)
        category.name = 'Food'
        self.transaction('5.00', category=12)
        self.transaction('5.00')
        await self.db.commit()
        response = await self.get('categories')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['items'], [
            {'id': 11, 'name': 'Food', 'amount': '5.00'},
            {'id': 12, 'name': 'Food', 'amount': '5.00'},
        ])

    async def test_reconciliation_beyond_one_transaction_page(self):
        for _ in range(120):
            self.transaction('0.10')
        self.transaction('20.20', category=12, created='2026-10-03T23:59:59.999999')
        await self.db.commit()
        for endpoint in self.endpoints:
            response = await self.get(endpoint)
            self.assertEqual(response.status_code, 200, response.text)
            self.assert_expenses(endpoint, response.json(), '32.20')

    async def test_base_currency_follows_workspace(self):
        workspace = await self.db.get(Workspace, 1)
        workspace.base_currency = 'USD'
        self.transaction('12.34', currency='USD')
        self.transaction('9999.99')
        await self.db.commit()
        for endpoint in self.endpoints:
            response = await self.get(endpoint)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['currency'], 'USD')
            self.assert_expenses(endpoint, response.json(), '12.34')

    async def test_transaction_updates_and_deletes_refresh_aggregates(self):
        row = self.transaction('10.10')
        await self.db.commit()
        payload = dict(amount='20.20', category_id=12, account_id=1, currency='EUR', description='Updated')
        response = await self.client.put(f'/transactions/{row.transaction_id}', json=payload,
                                         headers={'Workspace-ID': '1'})
        self.assertEqual(response.status_code, 200, response.text)
        for endpoint in self.endpoints:
            response = await self.get(endpoint)
            self.assertEqual(response.status_code, 200, response.text)
            self.assert_expenses(endpoint, response.json(), '20.20')
        response = await self.client.delete(f'/transactions/{row.transaction_id}', headers={'Workspace-ID': '1'})
        self.assertEqual(response.status_code, 204, response.text)
        for endpoint in self.endpoints:
            response = await self.get(endpoint)
            self.assertEqual(response.status_code, 200, response.text)
            self.assert_expenses(endpoint, response.json(), '0')

    async def test_approved_expenses_count_once_pending_requests_do_not_count(self):
        from app.models import Expense
        from app.models.expenses import ExpenseStatusEnum

        for expense_id, status in ((1, ExpenseStatusEnum.APPROVED), (2, ExpenseStatusEnum.PENDING)):
            self.db.add(Expense(expense_id=expense_id, workspace_id=2, submitted_by=1, department_id=1,
                                category_id=21, amount=Decimal('12.34'), currency='EUR',
                                description='Train', status=status))
        await self.db.flush()
        self.transaction('12.34', category=21, workspace=2, expense_id=1,
                         department_id=1, source=TransactionSourceEnum.EXPENSE)
        await self.db.commit()
        for endpoint in self.endpoints:
            response = await self.get(endpoint, workspace=2)
            self.assertEqual(response.status_code, 200, response.text)
            self.assert_expenses(endpoint, response.json(), '12.34')

    async def test_timeseries_limits_response_size(self):
        response = await self.get('timeseries', start='0001-01-01', end='9999-12-31')
        self.assertEqual(response.status_code, 400, response.text)
        # 3660 inclusive days is the maximum; the next day must be rejected.
        allowed = await self.get('timeseries', start='2016-01-01', end='2026-01-07')
        self.assertEqual(allowed.status_code, 200, allowed.text)
        self.assertEqual(len(allowed.json()['items']), 3660)
        rejected = await self.get('timeseries', start='2016-01-01', end='2026-01-08')
        self.assertEqual(rejected.status_code, 400, rejected.text)
