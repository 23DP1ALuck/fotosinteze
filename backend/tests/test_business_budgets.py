import unittest
from datetime import date, datetime
from unittest.mock import patch
from app.models import Budget, Transaction
from app.models.transaction import TransactionSourceEnum
import test_expenses

class BusinessBudgetTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        clock = patch('app.services.budget_service.date', wraps=date)
        self.today = clock.start()
        self.today.today.return_value = date(2026, 10, 1)
        self.addCleanup(clock.stop)
        await test_expenses.ExpenseTests.asyncSetUp(self)
    asyncTearDown = test_expenses.ExpenseTests.asyncTearDown

    def payload(self, **changes):
        data = dict(name='Travel plan', target_type='CATEGORY', target_id=1, limit_amount='100.00', currency='EUR', period_start='2026-10-01', period_length='MONTHLY', duration_days=None)
        data.update(changes)
        return data

    async def create(self, **changes):
        self.identity = {'sub': '1'}
        response = await self.client.post('/business-budgets', json=self.payload(**changes))
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    async def test_owner_crud_all_targets_and_persistence(self):
        for kind in ('CATEGORY', 'DEPARTMENT', 'PROJECT'):
            row = await self.create(target_type=kind)
            self.assertEqual(row['target_type'], kind)
            self.assertEqual(row['remaining'], '100.00')
            response = await self.client.put(f"/business-budgets/{row['id']}", json=self.payload(target_type='PROJECT', limit_amount='250.50', period_length='CUSTOM', duration_days=10))
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['period_end'], '2026-10-11')
            self.assertEqual(response.json()['target_type'], 'PROJECT')
            self.assertIsNone((await self.db.get(Budget, row['id'])).category_id)
            self.assertEqual((await self.client.delete(f"/business-budgets/{row['id']}")).status_code, 204)
        self.assertEqual((await self.client.get('/business-budgets')).json()['budgets'], [])

    async def test_validation_and_foreign_workspace(self):
        self.identity = {'sub': '1'}
        for changes in [dict(target_id=2), dict(target_id=3), dict(target_type='PROJECT', target_id=3), dict(target_type='DEPARTMENT', target_id=3)]:
            self.assertEqual((await self.client.post('/business-budgets', json=self.payload(**changes))).status_code, 400)
        for changes in [dict(name='  '), dict(limit_amount='0'), dict(limit_amount='1.001'), dict(currency='eur'), dict(period_length='CUSTOM'), dict(duration_days=2), dict(period_start='9999-12-31')]:
            response = await self.client.post('/business-budgets', json=self.payload(**changes))
            self.assertEqual(response.status_code, 422, response.text)
        row = await self.create()
        self.identity = {'sub': '4'}
        response = await self.client.put(f"/business-budgets/{row['id']}", headers={'Workspace-ID': '2'}, json=self.payload(target_id=2))
        self.assertEqual(response.status_code, 404)
        self.assertEqual((await self.client.delete(f"/business-budgets/{row['id']}", headers={'Workspace-ID': '2'})).status_code, 404)

    async def test_employee_read_only_and_visibility(self):
        await self.create()
        dept = await self.create(name='Department plan', target_type='DEPARTMENT')
        shared = await self.create(name='Project plan', target_type='PROJECT')
        await self.create(name='Other project plan', target_type='PROJECT', target_id=2)
        self.identity = {'sub': '2'}
        data = (await self.client.get('/business-budgets')).json()
        self.assertFalse(data['can_manage'])
        self.assertEqual(data['targets'], {})
        self.assertEqual([row['id'] for row in data['budgets']], [dept['id'], shared['id']])
        for method, path in [('post','/business-budgets'), ('put',f"/business-budgets/{dept['id']}"), ('delete',f"/business-budgets/{dept['id']}")]:
            response = await getattr(self.client, method)(path, **({'json': self.payload()} if method != 'delete' else {}))
            self.assertEqual(response.status_code, 403)

    async def test_progress_excludes_other_period_currency_income_and_department(self):
        await self.create(target_type='PROJECT')
        def transaction(amount, when, **changes):
            data = dict(amount=amount, created_at=datetime.fromisoformat(when), currency='EUR', description='Spending', source=TransactionSourceEnum.MANUAL, account_id=1, category_id=1, project_id=1, department_id=1, workspace_id=1)
            data.update(changes)
            return Transaction(**data)
        self.db.add_all([transaction(80, '2026-10-01'), transaction(21, '2026-10-31T23:59:59', department_id=2), transaction(500, '2026-11-01'), transaction(500, '2026-09-30'), transaction(500, '2026-10-10', currency='USD'), transaction(500, '2026-10-10', category_id=3)])
        await self.db.commit()
        result = (await self.client.get('/business-budgets')).json()['budgets'][0]
        self.assertEqual((result['spent'], result['remaining'], result['status']), ('101.00', '-1.00', 'EXCEEDED'))
        self.identity = {'sub': '2'}
        result = (await self.client.get('/business-budgets')).json()['budgets'][0]
        self.assertEqual((result['spent'], result['status']), ('80.00', 'WARNING'))

    async def test_nonmember_personal_and_unassigned_access(self):
        self.identity = {'sub': '1'}
        self.assertEqual((await self.client.get('/business-budgets', headers={'Workspace-ID': '2'})).status_code, 403)
        self.assertEqual((await self.client.get('/business-budgets', headers={'Workspace-ID': '3'})).status_code, 400)
        from app.models import WorkspaceUsers
        membership = await self.db.get(WorkspaceUsers, (2, 1))
        membership.department_id = None
        await self.db.commit()
        self.identity = {'sub': '2'}
        response = await self.client.get('/business-budgets')
        self.assertEqual(response.status_code, 403)
        self.assertIn('assign', response.json()['detail'])

    async def test_period_boundaries(self):
        monthly = await self.create(period_start='2028-01-31')
        self.assertEqual(monthly['period_end'], '2028-02-29')
        await self.client.delete(f"/business-budgets/{monthly['id']}")
        weekly = await self.create(name='Weekly plan', period_start='2026-12-28', period_length='WEEKLY')
        self.assertEqual(weekly['period_end'], '2027-01-04')

    async def test_expired_business_period_advances_and_resets_spending(self):
        row = await self.create(period_start='2026-09-15')
        self.db.add_all([
            Transaction(amount=amount, created_at=datetime.fromisoformat(when), currency='EUR',
                        description='Rollover', source=TransactionSourceEnum.MANUAL,
                        account_id=1, category_id=1, workspace_id=1)
            for amount, when in [(90, '2026-09-15'), (12, '2026-12-15')]
        ])
        await self.db.commit()
        self.today.today.return_value = date(2026, 12, 15)
        result = (await self.client.get('/business-budgets')).json()['budgets'][0]
        self.assertEqual(result['period_start'], '2026-12-15')
        self.assertEqual(result['period_end'], '2027-01-15')
        self.assertEqual((result['spent'], result['remaining']), ('12.00', '88.00'))
        await self.db.rollback()
        saved = await self.db.get(Budget, row['id'])
        await self.db.refresh(saved)
        self.assertEqual(saved.period_start, date(2026, 12, 15))

    async def test_ambiguous_legacy_budget_is_not_exposed(self):
        self.identity = {'sub': '1'}
        self.db.add(Budget(workspace_id=1, name='Mixed', category_id=1, project_id=3, limit_amount=100, currency='EUR', period_start=datetime(2026,10,1).date(), period_length='MONTHLY'))
        await self.db.commit()
        data = (await self.client.get('/business-budgets')).json()
        self.assertEqual(data['budgets'], [])
        self.assertEqual([row['id'] for row in data['targets']['CATEGORY']], [1])
