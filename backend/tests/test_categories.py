import unittest

import httpx
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base, get_db_session
from app.dependencies.auth import get_current_user
from app.main import app
from app.models import Category, Workspace, WorkspaceRole, WorkspaceUsers, User
from app.models.category import CategoryType
from app.models.workspace import WorkspaceTypeEnum


class CategoryEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.db = async_sessionmaker(self.engine, expire_on_commit=False)()
        self.db.add_all([
            User(user_id=1, email="owner@test.com", display_name="Owner", password="unused"),
            Workspace(workspace_id=1, name="One", type=WorkspaceTypeEnum.BUSINESS),
            Workspace(workspace_id=2, name="Two", type=WorkspaceTypeEnum.BUSINESS),
        ])
        await self.db.flush()
        self.db.add_all([
            WorkspaceUsers(user_id=1, workspace_id=1, role=WorkspaceRole.OWNER),
            WorkspaceUsers(user_id=1, workspace_id=2, role=WorkspaceRole.OWNER),
            Category(category_id=1, name="Food", type=CategoryType.expense, workspace_id=1),
            Category(category_id=2, name="Salary", type=CategoryType.income, workspace_id=2),
        ])
        await self.db.commit()

        async def session_override():
            yield self.db

        async def user_override():
            return {"sub": "1"}

        self.original_overrides = app.dependency_overrides.copy()
        app.dependency_overrides[get_db_session] = session_override
        app.dependency_overrides[get_current_user] = user_override

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.original_overrides)
        await self.db.close()
        await self.engine.dispose()

    async def test_get_update_and_delete_category_are_workspace_scoped(self):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get(
                "/categories/1", headers={"Workspace-ID": "1"}
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["name"], "Food")

            response = await client.put(
                "/categories/1",
                headers={"Workspace-ID": "1"},
                json={"name": "Groceries", "type": "EXPENSE"},
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["name"], "Groceries")

            response = await client.get(
                "/categories/2", headers={"Workspace-ID": "1"}
            )
            self.assertEqual(response.status_code, 404, response.text)

            response = await client.delete(
                "/categories/1", headers={"Workspace-ID": "1"}
            )
            self.assertEqual(response.status_code, 204, response.text)

            response = await client.get(
                "/categories/1", headers={"Workspace-ID": "1"}
            )
            self.assertEqual(response.status_code, 404, response.text)

    async def test_create_category_uses_active_workspace(self):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/categories",
                headers={"Workspace-ID": "1"},
                json={"name": "Rent", "type": "EXPENSE"},
            )

        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["name"], "Rent")
        self.assertEqual(response.json()["workspace_id"], 1)


if __name__ == "__main__":
    unittest.main()
