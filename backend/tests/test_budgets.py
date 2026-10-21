import unittest
from datetime import date, datetime
from decimal import Decimal

import httpx
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base, get_db_session
from app.dependencies.auth import get_current_user
from app.main import app
from app.models import Account, Budget, Category, Department, Project, User, Workspace, WorkspaceRole, WorkspaceUsers
from app.models.category import CategoryType
from app.models.transaction import Transaction, TransactionSourceEnum
from app.models.workspace import WorkspaceTypeEnum
from app.services.budget_service import calculate_budget_period_bounds


class BudgetEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.db = async_sessionmaker(self.engine, expire_on_commit=False)()
        self.db.add_all([
            User(user_id=1, email="owner@test.com", display_name="Owner", password="unused"),
            Workspace(workspace_id=1, name="Personal", type=WorkspaceTypeEnum.PERSONAL),
            Workspace(workspace_id=2, name="Business", type=WorkspaceTypeEnum.BUSINESS),
            WorkspaceUsers(user_id=1, workspace_id=1, role=WorkspaceRole.OWNER),
            WorkspaceUsers(user_id=1, workspace_id=2, role=WorkspaceRole.OWNER),
            Account(account_id=1, name="Cash", currency="EUR", balance=0, workspace_id=1),
            Category(category_id=1, name="Food", type=CategoryType.expense, workspace_id=1),
            Category(category_id=2, name="Income", type=CategoryType.income, workspace_id=1),
            Category(category_id=3, name="Travel", type=CategoryType.expense, workspace_id=1),
        ])
        await self.db.commit()
        self.original_overrides = app.dependency_overrides.copy()

        async def session_override():
            yield self.db

        async def user_override():
            return {"sub": "1"}

        app.dependency_overrides[get_db_session] = session_override
        app.dependency_overrides[get_current_user] = user_override
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.original_overrides)
        await self.db.close()
        await self.engine.dispose()

    async def test_spending_uses_saved_period_currency_and_optional_scope_filters(self):
        self.db.add_all([
            Budget(budget_id=1, workspace_id=1, category_id=1, project_id=10,
                   department_id=20, name="Food", limit_amount=100, currency="EUR",
                   period_start=date(2024, 1, 31), period_length="MONTHLY"),
            Budget(budget_id=2, workspace_id=1, name="Empty", limit_amount=50,
                   currency="USD", period_start=date(2030, 1, 31), period_length="WEEKLY"),
            Budget(budget_id=3, workspace_id=2, name="Other workspace", limit_amount=50,
                   currency="EUR", period_start=date(2024, 1, 31), period_length="WEEKLY"),
        ])
        cases = [
            ("10.10", "EUR", 1, 1, 10, 20, datetime(2024, 1, 31)),
            ("2.20", "EUR", 1, 1, 10, 20, datetime(2024, 1, 31, 23, 59)),
            ("100", "EUR", 1, 1, 10, 20, datetime(2024, 1, 30)),
            ("100", "EUR", 1, 1, 10, 20, datetime(2024, 2, 1, 12)),
            ("100", "USD", 1, 1, 10, 20, datetime(2024, 1, 31, 12)),
            ("100", "EUR", 2, 1, 10, 20, datetime(2024, 1, 31, 12)),
            ("100", "EUR", 1, 2, 10, 20, datetime(2024, 1, 31, 12)),
            ("100", "EUR", 1, 3, 10, 20, datetime(2024, 1, 31, 12)),
            ("100", "EUR", 1, 1, 11, 20, datetime(2024, 1, 31, 12)),
            ("100", "EUR", 1, 1, 10, 21, datetime(2024, 1, 31, 12)),
        ]
        for amount, currency, workspace, category, project, department, created in cases:
            self.db.add(Transaction(amount=Decimal(amount), currency=currency,
                                    description="Test", source=TransactionSourceEnum.MANUAL,
                                    account_id=1, workspace_id=workspace, category_id=category,
                                    project_id=project, department_id=department, created_at=created))
        await self.db.commit()

        response = await self.client.get("/budgets", headers={"Workspace-ID": "1"})
        self.assertEqual(response.status_code, 200, response.text)
        budgets = response.json()
        self.assertEqual([b["budget_id"] for b in budgets], [1, 2])
        self.assertEqual(Decimal(budgets[0]["current_spent"]), Decimal("12.30"))
        self.assertEqual(Decimal(budgets[1]["current_spent"]), 0)
        self.assertEqual(set(budgets[0]), {
            "budget_id", "workspace_id", "category_id", "project_id", "department_id",
            "name", "limit_amount", "currency", "period_start", "period_length",
            "duration_days", "created_at", "updated_at", "current_spent",
        })

    async def test_empty_list_and_workspace_access(self):
        response = await self.client.get("/budgets", headers={"Workspace-ID": "1"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), [])
        response = await self.client.get("/budgets", headers={"Workspace-ID": "999"})
        self.assertEqual(response.status_code, 403)

    async def test_unfiltered_budget_counts_only_expense_categories(self):
        self.db.add(Budget(workspace_id=1, name="General", limit_amount=100,
                           currency="EUR", period_start=date(2024, 1, 1),
                           period_length="WEEKLY"))
        for category, amount, created in [
            (1, "10.10", datetime(2024, 1, 2)),
            (3, "2.20", datetime(2024, 1, 7)),
            (2, "100", datetime(2024, 1, 7)),
            (None, "5", datetime(2024, 1, 7)),
            (1, "100", datetime(2024, 1, 8, 12)),
        ]:
            self.db.add(Transaction(amount=Decimal(amount), currency="EUR",
                                    description="Test", source=TransactionSourceEnum.MANUAL,
                                    account_id=1, workspace_id=1, category_id=category,
                                    created_at=created))
        await self.db.commit()
        response = await self.client.get("/budgets", headers={"Workspace-ID": "1"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(Decimal(response.json()[0]["current_spent"]), Decimal("12.30"))

    async def test_weekly_and_custom_spending_exclude_period_end_and_other_scopes(self):
        for period, duration, end_day in [("WEEKLY", None, 8), ("CUSTOM", 3, 4)]:
            with self.subTest(period=period):
                response = await self.client.post("/budgets", headers={"Workspace-ID": "1"},
                    json=self.budget_input(name=f"{period} budget", period_length=period, duration_days=duration))
                self.assertEqual(response.status_code, 201, response.text)
                budget_id = response.json()["budget_id"]
                transactions = []
                for day, hour, currency, category, workspace, amount in [
                    (1, 0, "EUR", 1, 1, 10), (end_day - 1, 23, "EUR", 1, 1, 20),
                    (end_day, 0, "EUR", 1, 1, 100), (end_day, 12, "EUR", 1, 1, 100),
                    (2, 12, "USD", 1, 1, 100), (2, 12, "EUR", 3, 1, 100),
                    (2, 12, "EUR", 1, 2, 100),
                ]:
                    transactions.append(Transaction(amount=amount, currency=currency, description="Test",
                        source=TransactionSourceEnum.MANUAL, account_id=1, workspace_id=workspace,
                        category_id=category, created_at=datetime(2025, 1, day, hour)))
                self.db.add_all(transactions)
                await self.db.commit()
                response = await self.client.get(f"/budgets/{budget_id}", headers={"Workspace-ID": "1"})
                self.assertEqual(Decimal(response.json()["current_spent"]), Decimal("30"))
                for transaction in transactions:
                    await self.db.delete(transaction)
                await self.db.commit()

    async def test_business_budgets_require_owner(self):
        membership = await self.db.get(WorkspaceUsers, (1, 2))
        membership.role = WorkspaceRole.EMPLOYEE
        await self.db.commit()
        response = await self.client.get("/budgets", headers={"Workspace-ID": "2"})
        self.assertEqual(response.status_code, 403, response.text)

    def budget_input(self, **changes):
        return {"name": "Food budget", "limit_amount": "100.25", "currency": "EUR",
                "period_start": "2025-01-01", "period_length": "MONTHLY",
                "category_id": 1, **changes}

    async def test_crud_persists_and_clears_optional_targets(self):
        response = await self.client.post("/budgets", headers={"Workspace-ID": "1"},
                                          json=self.budget_input())
        self.assertEqual(response.status_code, 201, response.text)
        budget_id = response.json()["budget_id"]
        self.assertEqual(response.json()["workspace_id"], 1)
        response = await self.client.get(f"/budgets/{budget_id}", headers={"Workspace-ID": "1"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(Decimal(response.json()["limit_amount"]), Decimal("100.25"))
        response = await self.client.put(f"/budgets/{budget_id}", headers={"Workspace-ID": "1"},
                                         json=self.budget_input(name="General", category_id=None,
                                                                period_length="CUSTOM", duration_days=10))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["name"], "General")
        self.assertIsNone(response.json()["category_id"])
        self.assertEqual(response.json()["duration_days"], 10)
        response = await self.client.delete(f"/budgets/{budget_id}", headers={"Workspace-ID": "1"})
        self.assertEqual(response.status_code, 204, response.text)
        self.assertIsNone(await self.db.get(Budget, budget_id))
        response = await self.client.get(f"/budgets/{budget_id}", headers={"Workspace-ID": "1"})
        self.assertEqual(response.status_code, 404)

    async def test_invalid_requests_do_not_create_budgets(self):
        cases = [({"name": " "}, 422), ({"limit_amount": "0"}, 422),
                 ({"limit_amount": "100000000"}, 422), ({"limit_amount": "1.001"}, 422),
                 ({"currency": "123"}, 422), ({"period_start": None}, 422),
                 ({"period_length": "CUSTOM"}, 422), ({"duration_days": 5}, 422),
                 ({"category_id": 999}, 404), ({"category_id": 2}, 400),
                 ({"project_id": 1}, 400), ({"department_id": 1}, 400)]
        for changes, status in cases:
            with self.subTest(changes=changes):
                response = await self.client.post("/budgets", headers={"Workspace-ID": "1"},
                                                  json=self.budget_input(**changes))
                self.assertEqual(response.status_code, status, response.text)
        response = await self.client.get("/budgets", headers={"Workspace-ID": "1"})
        self.assertEqual(response.json(), [])

    async def test_direct_ids_cannot_cross_active_workspace(self):
        self.db.add(Budget(budget_id=50, workspace_id=2, name="Private", limit_amount=10,
                           currency="EUR", period_start=date(2025, 1, 1), period_length="MONTHLY"))
        self.db.add(Category(category_id=4, workspace_id=2, name="Business", type=CategoryType.expense))
        await self.db.commit()
        for method in ("GET", "PUT", "DELETE"):
            kwargs = {"json": self.budget_input()} if method == "PUT" else {}
            response = await self.client.request(method, "/budgets/50", headers={"Workspace-ID": "1"}, **kwargs)
            self.assertEqual(response.status_code, 404, response.text)
        response = await self.client.post("/budgets", headers={"Workspace-ID": "1"},
                                          json=self.budget_input(category_id=4))
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIsNotNone(await self.db.get(Budget, 50))

    async def test_business_targets_must_belong_to_workspace_and_match(self):
        department = Department(department_id=20, workspace_id=2, name="Marketing")
        self.db.add_all([department,
                         Department(department_id=21, workspace_id=2, name="Sales"),
                         Department(department_id=22, workspace_id=1, name="Foreign"),
                         Project(project_id=10, workspace_id=2, name="Launch", departments=[department]),
                         Project(project_id=11, workspace_id=1, name="Foreign")])
        await self.db.commit()
        payload = self.budget_input(category_id=None, department_id=20, project_id=10)
        response = await self.client.post("/budgets", headers={"Workspace-ID": "2"}, json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        budget_id = response.json()["budget_id"]
        self.assertEqual(response.json()["project_id"], 10)
        for changes, status in [({"department_id": 21}, 400), ({"department_id": 22}, 404),
                                ({"project_id": 11}, 400), ({"project_id": 999}, 404)]:
            response = await self.client.put(f"/budgets/{budget_id}", headers={"Workspace-ID": "2"},
                                             json={**payload, **changes})
            self.assertEqual(response.status_code, status, response.text)
        response = await self.client.get(f"/budgets/{budget_id}", headers={"Workspace-ID": "2"})
        self.assertEqual(response.json()["department_id"], 20)
        self.assertEqual(response.json()["project_id"], 10)

    async def test_business_employee_cannot_mutate_or_read_budget(self):
        self.db.add(Budget(budget_id=50, workspace_id=2, name="Private", limit_amount=10,
                           currency="EUR", period_start=date(2025, 1, 1), period_length="MONTHLY"))
        membership = await self.db.get(WorkspaceUsers, (1, 2))
        membership.role = WorkspaceRole.EMPLOYEE
        await self.db.commit()
        for method, path in [("POST", "/budgets"), ("GET", "/budgets/50"),
                             ("PUT", "/budgets/50"), ("DELETE", "/budgets/50")]:
            kwargs = {"json": self.budget_input(category_id=None)} if method in ("POST", "PUT") else {}
            response = await self.client.request(method, path, headers={"Workspace-ID": "2"}, **kwargs)
            self.assertEqual(response.status_code, 403, response.text)



class BudgetPeriodTests(unittest.TestCase):
    def test_original_period_end_calculation(self):
        cases = [
            (date(2024, 1, 31), "MONTHLY", None, date(2024, 2, 1)),
            (date(2024, 2, 15), "MONTHLY", None, date(2024, 3, 1)),
            (date(2024, 12, 15), "MONTHLY", None, date(2025, 1, 1)),
            (date(2024, 1, 31), "WEEKLY", None, date(2024, 2, 7)),
            (date(2024, 1, 31), "CUSTOM", 10, date(2024, 2, 10)),
        ]
        for start, period, duration, expected in cases:
            with self.subTest(start=start, period=period):
                self.assertEqual(calculate_budget_period_bounds(start, period, duration), expected)
