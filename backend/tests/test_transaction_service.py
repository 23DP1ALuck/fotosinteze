import unittest
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import Enum, Numeric
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.dto import CreateTransactionRequest
from app.models.category import CategoryType
from app.models.workspace import WorkspaceTypeEnum
from app.services import transaction_service


class TestBase(DeclarativeBase):
    pass


class Account(TestBase):
    __tablename__ = "accounts"
    account_id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int]
    balance: Mapped[Decimal] = mapped_column(Numeric(10, 2))


class Category(TestBase):
    __tablename__ = "category"
    category_id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[CategoryType] = mapped_column(Enum(CategoryType))


class Department(TestBase):
    __tablename__ = "departments"
    department_id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int]


class Project(TestBase):
    __tablename__ = "projects"
    project_id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int]
    department_id: Mapped[int | None]


class Transaction(TestBase):
    __tablename__ = "transactions"
    transaction_id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int]
    account_id: Mapped[int]
    category_id: Mapped[int | None]
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    description: Mapped[str]
    currency: Mapped[str]
    project_id: Mapped[int | None]
    department_id: Mapped[int | None]
    expense_id: Mapped[int | None]
    updated_at: Mapped[datetime] = mapped_column(default=datetime.now)


class TransactionServiceTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # Existing application relationship configuration has unrelated errors.
        # Use isolated tables with a real database, as in test_department_names.
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as connection:
            await connection.run_sync(TestBase.metadata.create_all)
        self.db = async_sessionmaker(self.engine, expire_on_commit=False)()
        for name, model in [("Transaction", Transaction), ("Account", Account), ("Category", Category),
                            ("Department", Department), ("Project", Project)]:
            model_patch = patch.object(transaction_service, name, model)
            model_patch.start()
            self.addCleanup(model_patch.stop)
        self.workspace = SimpleNamespace(workspace_id=10, type=WorkspaceTypeEnum.PERSONAL)
        self.db.add_all([
            Department(department_id=1, workspace_id=10),
            Department(department_id=2, workspace_id=20),
            Project(project_id=1, workspace_id=10, department_id=1),
            Project(project_id=2, workspace_id=10, department_id=None),
            Project(project_id=3, workspace_id=20, department_id=2),
            Account(account_id=1, workspace_id=10, balance=80),
            Account(account_id=2, workspace_id=10, balance=100),
            Account(account_id=3, workspace_id=20, balance=100),
            Category(category_id=1, type=CategoryType.expense),
            Category(category_id=2, type=CategoryType.income),
            Transaction(transaction_id=1, workspace_id=10, account_id=1,
                        category_id=1, amount=20, description="Old", currency="EUR"),
        ])
        await self.db.commit()

    async def asyncTearDown(self):
        await self.db.close()
        await self.engine.dispose()

    def request(self, **changes):
        data = dict(amount=30, description="Updated", currency="EUR", account_id=1, category_id=1)
        data.update(changes)
        return CreateTransactionRequest(**data)

    async def test_update_changes_amount_and_balance(self):
        result = await transaction_service.update_transaction(1, self.request(), {}, self.workspace, self.db)
        await self.db.refresh(result)
        self.assertEqual(result.amount, Decimal("30"))
        self.assertEqual(result.description, "Updated")
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal("70"))

    async def test_update_moves_expense_to_income_on_another_account(self):
        await transaction_service.update_transaction(1, self.request(account_id=2, category_id=2), {}, self.workspace, self.db)
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal("100"))
        self.assertEqual((await self.db.get(Account, 2)).balance, Decimal("130"))

    async def test_delete_reverses_expense(self):
        await transaction_service.delete_transaction(1, {}, self.workspace, self.db)
        self.assertIsNone(await self.db.get(Transaction, 1))
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal("100"))

    async def test_delete_reverses_income(self):
        transaction = await self.db.get(Transaction, 1)
        transaction.category_id = 2
        await self.db.commit()
        await transaction_service.delete_transaction(1, {}, self.workspace, self.db)
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal("60"))

    async def test_workspace_isolation_and_missing_transactions(self):
        for workspace_id, transaction_id in [(20, 1), (10, 999)]:
            workspace = SimpleNamespace(workspace_id=workspace_id, type=WorkspaceTypeEnum.PERSONAL)
            for action in ["update", "delete"]:
                with self.subTest(workspace=workspace_id, action=action):
                    with self.assertRaises(HTTPException) as raised:
                        if action == "update":
                            await transaction_service.update_transaction(transaction_id, self.request(), {}, workspace, self.db)
                        else:
                            await transaction_service.delete_transaction(transaction_id, {}, workspace, self.db)
                    self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal("80"))

    async def test_invalid_update_does_not_change_transaction_or_balance(self):
        for changes, status in [({"amount": 0}, 400), ({"amount": -1}, 400),
                                ({"description": "  "}, 400), ({"account_id": 3}, 404),
                                ({"category_id": 999}, 404), ({"account_id": 999}, 404)]:
            with self.subTest(changes=changes):
                with self.assertRaises(HTTPException) as raised:
                    await transaction_service.update_transaction(1, self.request(**changes), {}, self.workspace, self.db)
                self.assertEqual(raised.exception.status_code, status)
                self.assertEqual((await self.db.get(Account, 1)).balance, Decimal("80"))
                self.assertEqual((await self.db.get(Transaction, 1)).amount, Decimal("20"))

    async def test_business_update_validates_project_and_department(self):
        self.workspace.type = WorkspaceTypeEnum.BUSINESS
        for changes in [dict(project_id=3), dict(department_id=2),
                        dict(project_id=2, department_id=1)]:
            with self.subTest(changes=changes):
                with self.assertRaises(HTTPException) as raised:
                    await transaction_service.update_transaction(1, self.request(**changes), {}, self.workspace, self.db)
                self.assertEqual(raised.exception.status_code, 404)
                self.assertEqual((await self.db.get(Account, 1)).balance, Decimal("80"))
        result = await transaction_service.update_transaction(
            1, self.request(project_id=1, department_id=1), {}, self.workspace, self.db)
        self.assertEqual(result.project_id, 1)
        self.assertEqual(result.department_id, 1)
        result = await transaction_service.update_transaction(1, self.request(), {}, self.workspace, self.db)
        self.assertIsNone(result.project_id)
        self.assertIsNone(result.department_id)
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal("70"))
