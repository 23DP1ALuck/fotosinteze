import unittest

import httpx

from tests import test_categories
from app.main import app
from app.models import Account, Budget, Category, Department, Project, Workspace


class NameUniquenessTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_categories.CategoryEndpointTests.asyncSetUp
    asyncTearDown = test_categories.CategoryEndpointTests.asyncTearDown

    async def named_request(self, client, method, kind, name, workspace_id=1, record_id=None):
        path = f'/{kind}' + (f'/{record_id}' if record_id is not None else '')
        payload = {'name': name}
        if kind == 'departments':
            return await client.request(method, path, params=payload, headers={'Workspace-ID': str(workspace_id)})
        if kind == 'categories':
            payload['type'] = 'EXPENSE'
        elif kind == 'accounts':
            if method == 'POST':
                payload.update(currency='EUR', balance=0)
        elif kind in ('budgets', 'business-budgets'):
            payload.update(currency='EUR', limit_amount='100', period_start='2026-10-01', period_length='MONTHLY')
            if kind == 'budgets':
                payload['category_id'] = 1 if workspace_id == 1 else 4
            else:
                payload.update(target_type='DEPARTMENT', target_id=workspace_id)
        elif kind == 'workspaces':
            payload['base_currency'] = 'EUR'
            if method == 'POST':
                path += '/business'
        return await client.request(method, path, json=payload, headers={'Workspace-ID': str(workspace_id)})

    @staticmethod
    def record_id(response):
        row = response.json()
        return next(row[key] for key in ('id', 'budget_id', 'account_id', 'category_id') if key in row)

    async def test_create_and_rename_reject_case_variants_but_allow_own_case_change(self):
        from app.models.category import CategoryType
        self.db.add_all([Department(department_id=i, workspace_id=i, name=f'Department {i}') for i in (1, 2)])
        self.db.add(Category(category_id=4, workspace_id=2, name='Expenses', type=CategoryType.expense))
        await self.db.commit()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            for kind in ('categories', 'departments', 'projects', 'accounts', 'budgets', 'business-budgets', 'workspaces'):
                for text in ('Travel', 'Ceļojums'):
                    with self.subTest(kind=kind, text=text):
                        name = f'{text} {kind}'
                        first = await self.named_request(client, 'POST', kind, name)
                        self.assertEqual(first.status_code, 201, first.text)
                        first_id = self.record_id(first)
                        duplicate = await self.named_request(client, 'POST', kind, f' {name.upper()} ')
                        self.assertEqual(duplicate.status_code, 409, duplicate.text)
                        self.assertIn('name is already taken', duplicate.json()['detail'])
                        other = await self.named_request(client, 'POST', kind, f'Other {name}')
                        self.assertEqual(other.status_code, 201, other.text)
                        other_id = self.record_id(other)
                        duplicate = await self.named_request(client, 'PUT', kind, name.upper(), record_id=other_id)
                        self.assertEqual(duplicate.status_code, 409, duplicate.text)
                        model = {'categories': Category, 'departments': Department, 'projects': Project, 'accounts': Account,
                                 'budgets': Budget, 'business-budgets': Budget, 'workspaces': Workspace}[kind]
                        unchanged = await self.db.get(model, other_id)
                        await self.db.refresh(unchanged)
                        self.assertEqual(unchanged.name, f'Other {name}')
                        own = await self.named_request(client, 'PUT', kind, name.upper(), record_id=first_id)
                        self.assertEqual(own.status_code, 200, own.text)
                        self.assertEqual(own.json()['name'], name.upper())
                        if kind != 'workspaces':
                            separate = await self.named_request(client, 'POST', kind, name.upper(), workspace_id=2)
                            self.assertEqual(separate.status_code, 201, separate.text)
