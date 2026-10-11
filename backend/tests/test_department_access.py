import unittest
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from fastapi import HTTPException
from app.database import Base
from app.models import User, Workspace, WorkspaceUsers, WorkspaceRole, Department, Project
from app.models.workspace import WorkspaceTypeEnum
from app.dto import CreateProjectRequest
from app.services import department_service, project_service


class DepartmentAccessTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        @event.listens_for(self.engine.sync_engine, 'connect')
        def enable_fk(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.factory = async_sessionmaker(self.engine, expire_on_commit=False)
        self.db = self.factory()
        self.db.add_all([User(user_id=i, email=f'{i}@test.com', display_name=f'User {i}', password='unused') for i in range(1, 7)])
        self.db.add_all([Workspace(workspace_id=i, name=f'Workspace {i}', type=WorkspaceTypeEnum.BUSINESS) for i in (1, 2)])
        await self.db.flush()
        self.db.add_all([Department(department_id=i, workspace_id=1 if i < 3 else 2, name=f'Department {i}') for i in (1, 2, 3)])
        await self.db.flush()
        self.db.add_all([
            WorkspaceUsers(user_id=1, workspace_id=1, role=WorkspaceRole.OWNER),
            WorkspaceUsers(user_id=2, workspace_id=1, role=WorkspaceRole.EMPLOYEE, department_id=1),
            WorkspaceUsers(user_id=3, workspace_id=1, role=WorkspaceRole.EMPLOYEE, department_id=2),
            WorkspaceUsers(user_id=4, workspace_id=1, role=WorkspaceRole.EMPLOYEE),
            WorkspaceUsers(user_id=5, workspace_id=2, role=WorkspaceRole.OWNER),
        ])
        await self.db.commit()
        self.owner = {'sub': '1'}
        self.employee = {'sub': '2'}

    async def asyncTearDown(self):
        await self.db.close()
        await self.engine.dispose()

    async def test_owner_assigns_employee(self):
        result = await department_service.assign_employee_department(2, 2, self.owner, self.db)
        self.assertEqual(result.department_id, 2)
        self.assertEqual((await self.db.get(WorkspaceUsers, (2, 1))).department_id, 2)

    async def test_employee_sees_only_assigned_department(self):
        rows = await department_service.get_departments(1, self.employee, self.db)
        self.assertEqual([row.id for row in rows], [1])
        with self.assertRaises(HTTPException) as error:
            await department_service.get_department_by_id(2, self.employee, self.db)
        self.assertEqual(error.exception.status_code, 403)

    async def test_employee_creation_uses_assigned_department(self):
        result = await project_service.create_project(1, CreateProjectRequest(name='Employee project'), self.employee, self.db)
        self.assertEqual(result.department_ids, [1])

    async def test_owner_shares_single_project_across_departments(self):
        result = await project_service.create_project(1, CreateProjectRequest(name='Shared', department_ids=[1, 2]), self.owner, self.db)
        self.assertEqual(result.department_ids, [1, 2])
        employee_result = await project_service.get_project_by_id(result.id, self.employee, self.db)
        self.assertEqual(employee_result.department_ids, [1])

    async def test_database_rejects_foreign_workspace_assignment(self):
        member = await self.db.get(WorkspaceUsers, (2, 1))
        member.department_id = 3
        with self.assertRaises(IntegrityError):
            await self.db.commit()
        await self.db.rollback()

    async def test_employee_cannot_assign_or_manage_departments(self):
        calls = [
            department_service.assign_employee_department(1, 3, self.employee, self.db),
            department_service.create_department(1, 'Forbidden', self.employee, self.db),
            department_service.update_department(1, 'Forbidden', self.employee, self.db),
            department_service.delete_department(1, self.employee, self.db),
        ]
        for call in calls:
            with self.assertRaises(HTTPException) as error:
                await call
            self.assertEqual(error.exception.status_code, 403)

    async def test_owner_cannot_assign_owner_or_foreign_employee(self):
        for department_id, user_id, expected in [(1, 1, 400), (1, 5, 404), (3, 2, 403)]:
            with self.subTest(department_id=department_id, user_id=user_id):
                with self.assertRaises(HTTPException) as error:
                    await department_service.assign_employee_department(department_id, user_id, self.owner, self.db)
                self.assertEqual(error.exception.status_code, expected)

    async def test_unassigned_and_nonmember_denied(self):
        for user_id in (4, 6):
            for operation in (department_service.get_departments, project_service.get_projects):
                with self.subTest(user_id=user_id, operation=operation.__name__):
                    with self.assertRaises(HTTPException) as error:
                        await operation(1, {'sub': str(user_id)}, self.db)
                    self.assertEqual(error.exception.status_code, 403)

    async def test_missing_authenticated_user_is_unauthorized(self):
        with self.assertRaises(HTTPException) as error:
            await project_service.get_projects(1, {'sub': '99'}, self.db)
        self.assertEqual(error.exception.status_code, 401)

    async def test_project_lists_and_direct_ids_are_scoped(self):
        one = await project_service.create_project(1, CreateProjectRequest(name='One', department_ids=[1]), self.owner, self.db)
        two = await project_service.create_project(1, CreateProjectRequest(name='Two', department_ids=[2]), self.owner, self.db)
        await project_service.create_project(1, CreateProjectRequest(name='Owner only'), self.owner, self.db)
        self.assertEqual([p.id for p in await project_service.get_projects(1, self.employee, self.db)], [one.id])
        with self.assertRaises(HTTPException) as error:
            await project_service.get_project_by_id(two.id, self.employee, self.db)
        self.assertEqual(error.exception.status_code, 403)

    async def test_employee_cannot_create_in_other_or_extra_department(self):
        for ids in ([2], [1, 2], [3]):
            with self.subTest(ids=ids):
                with self.assertRaises(HTTPException) as error:
                    await project_service.create_project(1, CreateProjectRequest(name='Forbidden', department_ids=ids), self.employee, self.db)
                self.assertEqual(error.exception.status_code, 403)

    async def test_shared_edits_are_visible_to_both_departments(self):
        from app.dto import UpdateProjectRequest
        project = await project_service.create_project(1, CreateProjectRequest(name='Shared', department_ids=[1, 2]), self.owner, self.db)
        await project_service.update_project(project.id, UpdateProjectRequest(name='Edited', status='Active'), self.employee, self.db)
        async with self.factory() as other_db:
            result = await project_service.get_project_by_id(project.id, {'sub': '3'}, other_db)
            self.assertEqual((result.name, result.status, result.department_ids), ('Edited', 'Active', [2]))
        owner_result = await project_service.get_project_by_id(project.id, self.owner, self.db)
        self.assertEqual(owner_result.department_ids, [1, 2])

    async def test_employee_cannot_change_links_or_delete_shared_project(self):
        from app.dto import UpdateProjectRequest
        project = await project_service.create_project(1, CreateProjectRequest(name='Shared', department_ids=[1, 2]), self.owner, self.db)
        for ids in ([1], [], [1, 2]):
            with self.subTest(ids=ids):
                with self.assertRaises(HTTPException) as error:
                    await project_service.update_project(project.id, UpdateProjectRequest(name='Changed', department_ids=ids), self.employee, self.db)
                self.assertEqual(error.exception.status_code, 403)
        with self.assertRaises(HTTPException) as error:
            await project_service.delete_project(project.id, self.employee, self.db)
        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual((await project_service.get_project_by_id(project.id, self.owner, self.db)).name, 'Shared')

    async def test_owner_changes_links_and_employee_loses_access(self):
        from app.dto import UpdateProjectRequest
        project = await project_service.create_project(1, CreateProjectRequest(name='Shared', department_ids=[1, 2]), self.owner, self.db)
        await project_service.update_project(project.id, UpdateProjectRequest(name='Shared', department_ids=[2]), self.owner, self.db)
        with self.assertRaises(HTTPException) as error:
            await project_service.get_project_by_id(project.id, self.employee, self.db)
        self.assertEqual(error.exception.status_code, 403)
        await project_service.delete_project(project.id, self.owner, self.db)
        self.assertIsNone(await self.db.scalar(select(Project.project_id).where(Project.project_id == project.id)))

    async def test_reassignment_changes_access_in_existing_session(self):
        await department_service.get_departments(1, self.employee, self.db)
        async with self.factory() as owner_db:
            await department_service.assign_employee_department(2, 2, self.owner, owner_db)
        self.assertEqual([d.id for d in await department_service.get_departments(1, self.employee, self.db)], [2])

    async def test_department_deletion_requires_reassignment_and_preserves_projects(self):
        project = await project_service.create_project(1, CreateProjectRequest(name='Shared', department_ids=[1, 2]), self.owner, self.db)
        with self.assertRaises(HTTPException) as error:
            await department_service.delete_department(1, self.owner, self.db)
        self.assertEqual(error.exception.status_code, 409)
        await department_service.assign_employee_department(2, 2, self.owner, self.db)
        await department_service.delete_department(1, self.owner, self.db)
        result = await project_service.get_project_by_id(project.id, self.owner, self.db)
        self.assertEqual(result.department_ids, [2])

    async def test_duplicate_ids_and_explicit_null_links_rejected(self):
        from pydantic import ValidationError
        from app.dto import UpdateProjectRequest
        for dto, values in [(CreateProjectRequest, [1, 1]), (UpdateProjectRequest, [1, 1]), (UpdateProjectRequest, None)]:
            with self.assertRaises(ValidationError):
                dto(name='Bad', department_ids=values)

    async def test_database_rejects_cross_workspace_project_link(self):
        from app.models.department_projects import department_projects
        project = await project_service.create_project(1, CreateProjectRequest(name='One'), self.owner, self.db)
        with self.assertRaises(IntegrityError):
            await self.db.execute(department_projects.insert().values(project_id=project.id, department_id=3, workspace_id=1))
        await self.db.rollback()

    async def test_transaction_respects_department_links_and_employee_scope(self):
        from app.dto import CreateTransactionRequest
        from app.models import Account, Category
        from app.models.category import CategoryType
        from app.services import transaction_service
        self.db.add(Account(account_id=1, name='Cash', currency='EUR', balance=100, workspace_id=1))
        self.db.add(Category(category_id=1, name='Costs', type=CategoryType.expense, workspace_id=1))
        await self.db.commit()
        shared = await project_service.create_project(1, CreateProjectRequest(name='Shared', department_ids=[1, 2]), self.owner, self.db)
        local = await project_service.create_project(1, CreateProjectRequest(name='Local', department_ids=[2]), self.owner, self.db)
        data = dict(amount=10, currency='EUR', description='Cost', account_id=1, category_id=1)
        transaction = await transaction_service.create_transaction(CreateTransactionRequest(**data, project_id=shared.id, department_id=1), self.employee, await self.db.get(Workspace, 1), self.db)
        self.assertEqual(transaction.project_id, shared.id)
        for values in [dict(project_id=shared.id, department_id=2), dict(project_id=local.id), dict(department_id=3)]:
            with self.subTest(values=values):
                with self.assertRaises(HTTPException) as error:
                    await transaction_service.create_transaction(CreateTransactionRequest(**data, **values), self.employee, await self.db.get(Workspace, 1), self.db)
                self.assertIn(error.exception.status_code, (400, 403))

    async def test_application_enforces_sqlite_foreign_keys(self):
        from app.database import DatabaseSessionManager
        from sqlalchemy import text
        manager = DatabaseSessionManager('sqlite+aiosqlite:///:memory:')
        try:
            async with manager.connect() as conn:
                self.assertEqual(await conn.scalar(text('PRAGMA foreign_keys')), 1)
        finally:
            await manager.close()

    async def test_deleting_shared_project_preserves_multiple_transactions(self):
        from app.models import Account, Transaction
        from app.models.transaction import TransactionSourceEnum
        self.db.add(Account(account_id=1, name='Cash', currency='EUR', balance=100, workspace_id=1))
        await self.db.commit()
        project = await project_service.create_project(1, CreateProjectRequest(name='Shared', department_ids=[1, 2]), self.owner, self.db)
        for i in (1, 2):
            self.db.add(Transaction(transaction_id=i, amount=1, currency='EUR', description='Existing', source=TransactionSourceEnum.MANUAL, account_id=1, workspace_id=1, project_id=project.id))
        await self.db.commit()
        await project_service.delete_project(project.id, self.owner, self.db)
        projects = (await self.db.scalars(select(Transaction.project_id))).all()
        self.assertEqual(projects, [None, None])

    async def test_http_assignment_and_project_endpoints(self):
        import httpx
        from app.main import app
        from app.database import get_db_session
        from app.dependencies.auth import get_current_user
        async def session_override():
            yield self.db
        identity = self.owner
        async def user_override():
            return identity
        original_overrides = app.dependency_overrides.copy()
        app.dependency_overrides[get_db_session] = session_override
        app.dependency_overrides[get_current_user] = user_override
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                assigned = await client.put('/departments/1/employees/4')
                self.assertEqual(assigned.status_code, 200)
                self.assertEqual(assigned.json()['department_id'], 1)
                identity = {'sub': '4'}
                created = await client.post('/projects', headers={'Workspace-ID': '1'}, json={'name': 'HTTP Project'})
                self.assertEqual(created.status_code, 201, created.text)
                self.assertEqual(created.json()['department_ids'], [1])
                departments = await client.get('/departments', headers={'Workspace-ID': '1'})
                self.assertEqual(departments.status_code, 200, departments.text)
                self.assertEqual([d['id'] for d in departments.json()], [1])
                changed = await client.put(f"/projects/{created.json()['id']}", json={'name': 'Changed'})
                self.assertEqual(changed.status_code, 200, changed.text)
                self.assertEqual(changed.json()['department_ids'], [1])
                denied = await client.put('/departments/2/employees/4')
                self.assertEqual(denied.status_code, 403)
                deleted = await client.delete(f"/projects/{created.json()['id']}")
                self.assertEqual(deleted.status_code, 403)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)


    async def test_transaction_update_and_delete_respect_existing_and_new_departments(self):
        from decimal import Decimal
        from app.dto import CreateTransactionRequest
        from app.models import Account, Category, Transaction
        from app.models.category import CategoryType
        from app.services import transaction_service
        workspace = await self.db.get(Workspace, 1)
        self.db.add_all([
            Account(account_id=1, name='Cash', currency='EUR', balance=100, workspace_id=1),
            Category(category_id=1, name='Cost', type=CategoryType.expense, workspace_id=1),
        ])
        await self.db.commit()
        shared = await project_service.create_project(1, CreateProjectRequest(name='Shared costs', department_ids=[1, 2]), self.owner, self.db)
        data = dict(amount=10, currency='EUR', description='Cost', account_id=1, category_id=1, project_id=shared.id)
        own = await transaction_service.create_transaction(CreateTransactionRequest(**data), self.employee, workspace, self.db)
        foreign = await transaction_service.create_transaction(CreateTransactionRequest(**data, department_id=2), self.owner, workspace, self.db)
        self.assertEqual(own.department_id, 1)
        self.assertEqual(own.workspace_id, 1)
        for action in ('update', 'delete'):
            with self.subTest(action=action):
                with self.assertRaises(HTTPException) as error:
                    if action == 'update':
                        await transaction_service.update_transaction(foreign.transaction_id, CreateTransactionRequest(**data), self.employee, workspace, self.db)
                    else:
                        await transaction_service.delete_transaction(foreign.transaction_id, self.employee, workspace, self.db)
                self.assertEqual(error.exception.status_code, 403)
        with self.assertRaises(HTTPException) as error:
            await transaction_service.update_transaction(own.transaction_id, CreateTransactionRequest(**data, department_id=2), self.employee, workspace, self.db)
        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal('80'))
        replacement = dict(data, amount=15)
        updated = await transaction_service.update_transaction(own.transaction_id, CreateTransactionRequest(**replacement), self.employee, workspace, self.db)
        self.assertEqual(updated.department_id, 1)
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal('75'))
        await transaction_service.delete_transaction(own.transaction_id, self.employee, workspace, self.db)
        self.assertEqual((await self.db.get(Account, 1)).balance, Decimal('90'))

    async def test_business_update_validates_shared_links_before_balance_changes(self):
        from decimal import Decimal
        from app.dto import CreateTransactionRequest
        from app.models import Account, Category
        from app.models.category import CategoryType
        from app.services import transaction_service
        workspace = await self.db.get(Workspace, 1)
        self.db.add_all([
            Account(account_id=1, name='Cash', currency='EUR', balance=100, workspace_id=1),
            Category(category_id=1, name='Cost', type=CategoryType.expense, workspace_id=1),
        ])
        await self.db.commit()
        project = await project_service.create_project(1, CreateProjectRequest(name='Local costs', department_ids=[1]), self.owner, self.db)
        data = dict(amount=10, currency='EUR', description='Cost', account_id=1, category_id=1)
        row = await transaction_service.create_transaction(CreateTransactionRequest(**data, project_id=project.id, department_id=1), self.owner, workspace, self.db)
        for values in [dict(project_id=project.id, department_id=2), dict(department_id=3), dict(project_id=999)]:
            with self.subTest(values=values):
                with self.assertRaises(HTTPException):
                    await transaction_service.update_transaction(row.transaction_id, CreateTransactionRequest(**data, **values), self.owner, workspace, self.db)
                self.assertEqual((await self.db.get(Account, 1)).balance, Decimal('90'))
                self.assertEqual(row.department_id, 1)
        updated = await transaction_service.update_transaction(row.transaction_id, CreateTransactionRequest(**data), self.owner, workspace, self.db)
        self.assertIsNone(updated.project_id)
        self.assertIsNone(updated.department_id)
