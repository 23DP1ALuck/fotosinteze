import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy import UniqueConstraint
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.services import department_service


class TestBase(DeclarativeBase):
    pass


class TestDepartment(TestBase):
    # Isolate these checks from unrelated errors configuring app relationships.
    __tablename__ = "departments"
    __table_args__ = (UniqueConstraint("workspace_id", "name"),)
    department_id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int]
    name: Mapped[str]


class DepartmentNameTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as connection:
            await connection.run_sync(TestBase.metadata.create_all)
        self.db = async_sessionmaker(self.engine, expire_on_commit=False)()
        self.model_patch = patch.object(department_service, "Department", TestDepartment)
        self.auth_patch = patch.object(department_service, "can_manage_department", AsyncMock())
        self.model_patch.start()
        self.auth_patch.start()
        self.db.add_all([
            TestDepartment(department_id=1, workspace_id=10, name="Sales"),
            TestDepartment(department_id=2, workspace_id=10, name="Engineering"),
        ])
        await self.db.commit()

    async def asyncTearDown(self):
        self.auth_patch.stop()
        self.model_patch.stop()
        await self.db.close()
        await self.engine.dispose()

    async def test_create_rejects_taken_name_in_same_workspace(self):
        with self.assertRaises(HTTPException) as raised:
            await department_service.create_department(10, "Sales", {}, self.db)
        self.assertEqual(raised.exception.status_code, 409)

    async def test_update_rejects_another_departments_name(self):
        with self.assertRaises(HTTPException) as raised:
            await department_service.update_department(2, "Sales", {}, self.db)
        self.assertEqual(raised.exception.status_code, 409)
        await self.db.refresh(await self.db.get(TestDepartment, 2))
        self.assertEqual((await self.db.get(TestDepartment, 2)).name, "Engineering")

    async def test_update_allows_current_name(self):
        response = await department_service.update_department(1, "Sales", {}, self.db)
        self.assertEqual(response.name, "Sales")

    async def test_create_allows_same_name_in_different_workspace(self):
        response = await department_service.create_department(20, "Sales", {}, self.db)
        self.assertEqual(response.workspace_id, 20)

    async def test_update_allows_unused_name(self):
        response = await department_service.update_department(2, "Support", {}, self.db)
        self.assertEqual(response.name, "Support")
