import unittest
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.database import Base
from app.models import Workspace, Department, Project, User, WorkspaceUsers, WorkspaceRole
from app.models.workspace import WorkspaceTypeEnum
from app.dto import CreateProjectRequest, UpdateProjectRequest
from app.services import project_service


class ProjectTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.db = async_sessionmaker(self.engine, expire_on_commit=False)()
        self.db.add_all([Workspace(workspace_id=1, name='One', type=WorkspaceTypeEnum.BUSINESS), Workspace(workspace_id=2, name='Two', type=WorkspaceTypeEnum.BUSINESS)])
        await self.db.flush()
        self.db.add_all([Department(department_id=1, workspace_id=1, name='Local'), Department(department_id=2, workspace_id=2, name='Other')])
        await self.db.commit()
        self.db.add(User(user_id=1, email='owner@test.com', display_name='Owner', password='unused'))
        await self.db.flush()
        self.db.add_all([WorkspaceUsers(user_id=1, workspace_id=i, role=WorkspaceRole.OWNER) for i in (1, 2)])
        await self.db.commit()
        self.current_user = {'sub': '1'}

    async def asyncTearDown(self):
        await self.db.close()
        await self.engine.dispose()

    async def test_rejects_foreign_department_on_create_and_update(self):
        created = await project_service.create_project(1, CreateProjectRequest(name='Original', department_ids=[1]), self.current_user, self.db)
        for update in [False, True]:
            with self.subTest(update=update):
                with self.assertRaises(HTTPException) as error:
                    data = UpdateProjectRequest(name='Changed', department_ids=[2]) if update else CreateProjectRequest(name='Changed', department_ids=[2])
                    if update:
                        await project_service.update_project(created.id, data, self.current_user, self.db)
                    else:
                        await project_service.create_project(1, data, self.current_user, self.db)
                self.assertEqual(error.exception.status_code, 400)
        row = await project_service.load_project(created.id, self.db)
        self.assertEqual((row.name, [d.department_id for d in row.departments]), ('Original', [1]))

    async def test_rejects_missing_department(self):
        with self.assertRaises(HTTPException) as error:
            await project_service.create_project(1, CreateProjectRequest(name='Missing', department_ids=[99]), self.current_user, self.db)
        self.assertEqual(error.exception.status_code, 404)

    async def test_owner_check(self):
        user = User(workspace_memberships=[WorkspaceUsers(workspace_id=1, role=WorkspaceRole.OWNER), WorkspaceUsers(workspace_id=2, role=WorkspaceRole.EMPLOYEE)])
        self.assertTrue(user.is_member_of_workspace(1, True))
        self.assertFalse(user.is_member_of_workspace(2, True))
        self.assertTrue(user.is_member_of_workspace(2, False))

    async def test_concurrent_create_conflict_rolls_back(self):
        await project_service.create_project(1, CreateProjectRequest(name='Taken'), self.current_user, self.db)
        # Simulate a request that passed the precheck before another committed.
        with patch.object(project_service, 'check_project_name', AsyncMock()):
            with self.assertRaises(HTTPException) as error:
                await project_service.create_project(1, CreateProjectRequest(name='Taken'), self.current_user, self.db)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(len((await self.db.scalars(select(Project))).all()), 1)

    async def test_crud_and_workspace_name_scope(self):
        created = await project_service.create_project(1, CreateProjectRequest(name='Launch', department_ids=[1]), self.current_user, self.db)
        await project_service.create_project(2, CreateProjectRequest(name='Launch', department_ids=[2]), self.current_user, self.db)
        self.assertEqual((await project_service.get_project_by_id(created.id, self.current_user, self.db)).name, 'Launch')
        self.assertEqual(len(await project_service.get_projects(1, self.current_user, self.db)), 1)
        updated = await project_service.update_project(created.id, UpdateProjectRequest(name='Launch', department_ids=[]), self.current_user, self.db)
        self.assertEqual(updated.department_ids, [])
        await project_service.delete_project(created.id, self.current_user, self.db)
        self.assertEqual(await project_service.get_projects(1, self.current_user, self.db), [])

    async def test_routes_registered(self):
        from app.main import app
        paths = app.openapi()['paths']
        self.assertIn('/projects', paths)
        self.assertIn('/projects/{project_id}', paths)
