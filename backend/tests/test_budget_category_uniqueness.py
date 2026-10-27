import unittest
from app.models import Budget, Category
from app.models.category import CategoryType
from tests import test_budgets


class BudgetCategoryUniquenessTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_budgets.BudgetEndpointTests.asyncSetUp
    asyncTearDown = test_budgets.BudgetEndpointTests.asyncTearDown
    budget_input = test_budgets.BudgetEndpointTests.budget_input

    async def test_one_budget_per_category_across_names_currencies_and_periods(self):
        headers = {'Workspace-ID': '1'}
        first = await self.client.post('/budgets', headers=headers, json=self.budget_input())
        self.assertEqual(first.status_code, 201, first.text)
        duplicate = await self.client.post('/budgets', headers=headers, json=self.budget_input(name='Another', currency='USD', period_length='WEEKLY'))
        self.assertEqual(duplicate.status_code, 409, duplicate.text)
        self.assertIn('category already has a budget', duplicate.json()['detail'])
        updated = await self.client.put(f"/budgets/{first.json()['budget_id']}", headers=headers, json=self.budget_input(name='Updated', limit_amount='150'))
        self.assertEqual(updated.status_code, 200, updated.text)
        second = await self.client.post('/budgets', headers=headers, json=self.budget_input(name='Travel', category_id=3))
        self.assertEqual(second.status_code, 201, second.text)
        moved = await self.client.put(f"/budgets/{second.json()['budget_id']}", headers=headers, json=self.budget_input(name='Travel', category_id=1))
        self.assertEqual(moved.status_code, 409, moved.text)
        await self.db.rollback()
        self.assertEqual((await self.client.get(f"/budgets/{second.json()['budget_id']}", headers=headers)).json()['category_id'], 3)
        await self.client.delete(f"/budgets/{first.json()['budget_id']}", headers=headers)
        replacement = await self.client.post('/budgets', headers=headers, json=self.budget_input(name='Replacement'))
        self.assertEqual(replacement.status_code, 201, replacement.text)

    async def test_category_rule_cannot_be_bypassed_using_the_other_budget_api(self):
        self.db.add(Category(category_id=4, workspace_id=2, name='Business travel', type=CategoryType.expense))
        await self.db.commit()
        headers = {'Workspace-ID': '2'}
        first = await self.client.post('/budgets', headers=headers, json=self.budget_input(category_id=4))
        self.assertEqual(first.status_code, 201, first.text)
        duplicate = await self.client.post('/business-budgets', headers=headers, json={'name': 'Duplicate', 'target_type': 'CATEGORY', 'target_id': 4, 'limit_amount': '100', 'currency': 'EUR', 'period_start': '2026-10-01', 'period_length': 'MONTHLY'})
        self.assertEqual(duplicate.status_code, 409, duplicate.text)

    async def test_existing_duplicates_are_preserved_and_can_still_be_edited(self):
        for index in (1, 2):
            self.db.add(Budget(budget_id=index, workspace_id=1, category_id=1, name=f'Legacy {index}', limit_amount=100, currency='EUR', period_length='MONTHLY'))
        await self.db.commit()
        response = await self.client.put('/budgets/1', headers={'Workspace-ID': '1'}, json=self.budget_input(name='Legacy 1', limit_amount='150'))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len((await self.client.get('/budgets', headers={'Workspace-ID': '1'})).json()), 2)


class BudgetCategoryConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_simultaneous_category_claims_create_only_one_budget(self):
        import asyncio
        import tempfile
        from pathlib import Path
        from fastapi import HTTPException
        from sqlalchemy import func, select
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
        from app.database import Base
        from app.models import Workspace
        from app.services.budget_category_uniqueness import check_budget_category

        with tempfile.TemporaryDirectory() as directory:
            engine = create_async_engine(f"sqlite+aiosqlite:///{Path(directory) / 'race.sqlite'}")
            try:
                async with engine.begin() as connection:
                    await connection.run_sync(Base.metadata.create_all)
                sessions = async_sessionmaker(engine, expire_on_commit=False)
                async with sessions() as db:
                    db.add(Workspace(workspace_id=1, name='Concurrency test', type='PERSONAL'))
                    db.add(Category(category_id=1, workspace_id=1, name='Food', type=CategoryType.expense))
                    await db.commit()

                async def claim(name):
                    async with sessions() as db:
                        try:
                            await check_budget_category(1, 1, db)
                            await asyncio.sleep(0.02)
                            db.add(Budget(workspace_id=1, category_id=1, name=name, limit_amount=100, currency='EUR', period_length='MONTHLY'))
                            await db.commit()
                            return 201
                        except HTTPException as error:
                            await db.rollback()
                            return error.status_code

                results = await asyncio.gather(claim('First'), claim('Second'))
                self.assertEqual(sorted(results), [201, 409])
                async with sessions() as db:
                    self.assertEqual(await db.scalar(select(func.count()).select_from(Budget)), 1)
            finally:
                await engine.dispose()
