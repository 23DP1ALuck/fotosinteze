import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from httpx import ASGITransport, AsyncClient
import jwt
from sqlalchemy import event, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base, get_db_session
from app.config import settings
from app.dependencies.auth import get_current_user
from app.main import app
from app.models import Account, AuthSession, Category, Department, Expense, Transaction, User, Workspace, WorkspaceRole, WorkspaceUsers
from app.models.category import CategoryType
from app.models.transaction import TransactionSourceEnum
from app.models.workspace import WorkspaceTypeEnum


class WorkspaceMemberTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine('sqlite+aiosqlite:///:memory:')

        @event.listens_for(self.engine.sync_engine, 'connect')
        def foreign_keys(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')

        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.db = async_sessionmaker(self.engine, expire_on_commit=False)()
        self.db.add_all([
            User(user_id=i, email=email, display_name=f'User {i}', password='never-expose')
            for i, email in [(1, 'owner@example.com'), (2, 'employee@example.com'),
                             (3, 'MixedCase@Example.com'), (4, 'outsider@example.com')]
        ])
        self.db.add_all([
            Workspace(workspace_id=i, name=f'Workspace {i}', type=kind)
            for i, kind in [(1, WorkspaceTypeEnum.BUSINESS), (2, WorkspaceTypeEnum.BUSINESS),
                            (3, WorkspaceTypeEnum.PERSONAL), (4, WorkspaceTypeEnum.PERSONAL)]
        ])
        await self.db.flush()
        self.db.add(Department(department_id=1, name='Team', workspace_id=1))
        await self.db.flush()
        self.db.add_all([
            WorkspaceUsers(user_id=1, workspace_id=i, role=WorkspaceRole.OWNER)
            for i in (1, 2, 3)
        ] + [WorkspaceUsers(user_id=2, workspace_id=1, role=WorkspaceRole.EMPLOYEE, department_id=1),
             WorkspaceUsers(user_id=3, workspace_id=4, role=WorkspaceRole.OWNER)])
        await self.db.commit()
        self.identity = {'sub': '1'}

        async def session():
            yield self.db

        app.dependency_overrides[get_db_session] = session
        app.dependency_overrides[get_current_user] = lambda: self.identity
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url='http://test')

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        await self.client.aclose()
        await self.db.close()
        await self.engine.dispose()

    async def test_list_returns_only_this_workspaces_members_without_private_fields(self):
        response = await self.client.get('/workspaces/1/members')
        self.assertEqual(response.status_code, 200, response.text)
        members = {item['user_id']: item for item in response.json()}
        self.assertEqual(set(members), {1, 2})
        self.assertEqual(members[2], {
            'user_id': 2, 'workspace_id': 1, 'display_name': 'User 2',
            'email': 'employee@example.com', 'role': 'EMPLOYEE', 'department_id': 1,
            'joined_at': members[2]['joined_at'],
        })
        self.assertEqual(members[1]['role'], 'OWNER')
        self.assertIsInstance(datetime.fromisoformat(members[2]['joined_at']), datetime)
        response = await self.client.get('/workspaces/2/members')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([item['user_id'] for item in response.json()], [1])

    async def test_list_requires_business_ownership_and_valid_ids(self):
        for user, workspace_id, expected in [
            ('2', 1, 403), ('4', 1, 403), ('999', 1, 401),
            ('1', 3, 400), ('1', 99, 404), ('1', 0, 422), ('1', -1, 422),
        ]:
            self.identity = {'sub': user}
            response = await self.client.get(f'/workspaces/{workspace_id}/members')
            self.assertEqual(response.status_code, expected, response.text)
        del app.dependency_overrides[get_current_user]
        self.assertEqual((await self.client.get('/workspaces/1/members')).status_code, 401)

    async def test_add_assigns_department_and_list_tracks_reassignment_and_removal(self):
        self.db.add(Department(department_id=2, name='Other team', workspace_id=1))
        await self.db.commit()
        response = await self.client.post('/workspaces/1/employees', json={
            'email': 'mixedcase@example.com', 'department_id': 1,
        })
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()['department_id'], 1)
        self.assertEqual((await self.db.get(WorkspaceUsers, (3, 1))).department_id, 1)
        self.identity = {'sub': '3'}
        response = await self.client.get('/departments', headers={'Workspace-ID': '1'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([item['id'] for item in response.json()], [1])
        self.identity = {'sub': '1'}
        self.assertEqual((await self.client.put('/departments/2/employees/3')).status_code, 200)
        response = await self.client.get('/workspaces/1/members')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(next(item for item in response.json() if item['user_id'] == 3)['department_id'], 2)
        self.assertEqual((await self.client.delete('/workspaces/1/employees/3')).status_code, 204)
        response = await self.client.get('/workspaces/1/members')
        self.assertEqual({item['user_id'] for item in response.json()}, {1, 2})

    async def test_add_rejects_invalid_or_foreign_departments_without_creating_membership(self):
        self.db.add(Department(department_id=2, name='Other workspace', workspace_id=2))
        await self.db.commit()
        for department_id, expected in [(0, 422), (-1, 422), (99, 404), (2, 400)]:
            response = await self.client.post('/workspaces/1/employees', json={
                'email': 'mixedcase@example.com', 'department_id': department_id,
            })
            self.assertEqual(response.status_code, expected, response.text)
            self.assertIsNone(await self.db.get(WorkspaceUsers, (3, 1)))

    async def test_add_persists_employee_in_multiple_workspaces(self):
        for workspace_id in (1, 2):
            response = await self.client.post(f'/workspaces/{workspace_id}/employees', json={'email': '  mixedcase@example.COM  '})
            self.assertEqual(response.status_code, 201, response.text)
            data = response.json()
            self.assertEqual({k: v for k, v in data.items() if k != 'joined_at'}, {
                'user_id': 3, 'workspace_id': workspace_id, 'display_name': 'User 3',
                'email': 'MixedCase@Example.com', 'role': 'EMPLOYEE', 'department_id': None,
            })
            self.assertIsInstance(datetime.fromisoformat(data['joined_at']), datetime)
            membership = await self.db.get(WorkspaceUsers, (3, workspace_id))
            self.assertEqual(membership.role, WorkspaceRole.EMPLOYEE)
            self.assertIsNotNone(membership.joined_at)
        self.assertEqual(await self.db.scalar(select(func.count()).select_from(WorkspaceUsers).where(WorkspaceUsers.user_id == 3)), 3)

    async def test_add_rejects_duplicates_and_owner_self_add(self):
        for email in ('employee@example.com', 'owner@example.com'):
            response = await self.client.post('/workspaces/1/employees', json={'email': email})
            self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(await self.db.scalar(select(func.count()).select_from(WorkspaceUsers)), 5)

    async def test_add_rejects_invalid_body_and_ids(self):
        for body in ({'email': 'invalid'}, {'email': 'a' * 64 + '@' + 'b' * 34 + '.com'},
                     {'email': 'mixedcase@example.com', 'role': 'OWNER'}, {}, {'email': None}):
            response = await self.client.post('/workspaces/1/employees', json=body)
            self.assertEqual(response.status_code, 422, response.text)
        for workspace_id in (0, -1):
            response = await self.client.post(f'/workspaces/{workspace_id}/employees', json={'email': 'mixedcase@example.com'})
            self.assertEqual(response.status_code, 422)
        self.assertIsNone(await self.db.get(WorkspaceUsers, (3, 1)))

    async def test_add_authorizes_before_user_lookup(self):
        for user, workspace_id, expected in [('2', 1, 403), ('4', 1, 403), ('1', 3, 400), ('1', 99, 404), ('999', 1, 401)]:
            self.identity = {'sub': user}
            response = await self.client.post(f'/workspaces/{workspace_id}/employees', json={'email': 'missing@example.com'})
            self.assertEqual(response.status_code, expected, response.text)
        self.identity = {'sub': '1'}
        response = await self.client.post('/workspaces/1/employees', json={'email': 'missing@example.com'})
        self.assertEqual(response.status_code, 404)

    async def test_add_requires_authentication(self):
        del app.dependency_overrides[get_current_user]
        response = await self.client.post('/workspaces/1/employees', json={'email': 'mixedcase@example.com'})
        self.assertEqual(response.status_code, 401, response.text)

    async def test_add_rejects_ambiguous_legacy_email(self):
        self.db.add(User(user_id=5, email='mixedcase@example.com', display_name='Different user', password='unused'))
        await self.db.commit()
        response = await self.client.post('/workspaces/1/employees', json={'email': 'mixedcase@example.com'})
        self.assertEqual(response.status_code, 409, response.text)
        for user_id in (3, 5):
            self.assertIsNone(await self.db.get(WorkspaceUsers, (user_id, 1)))

    async def test_add_matches_unicode_email_case_consistently(self):
        (await self.db.get(User, 3)).email = 'JĀNIS@example.com'
        await self.db.commit()
        for workspace_id, email in [(1, 'JĀNIS@example.com'), (2, 'jānis@example.com')]:
            response = await self.client.post(f'/workspaces/{workspace_id}/employees', json={'email': email})
            self.assertEqual(response.status_code, 201, response.text)
            self.assertEqual(response.json()['user_id'], 3)

    async def test_add_rejects_ambiguous_unicode_email_without_adding_either_user(self):
        (await self.db.get(User, 3)).email = 'JĀNIS@example.com'
        self.db.add(User(user_id=5, email='jānis@example.com', display_name='Different user', password='unused'))
        await self.db.commit()
        for email in ('JĀNIS@example.com', 'jānis@example.com'):
            response = await self.client.post('/workspaces/1/employees', json={'email': email})
            self.assertEqual(response.status_code, 409, response.text)
        for user_id in (3, 5):
            self.assertIsNone(await self.db.get(WorkspaceUsers, (user_id, 1)))

    async def test_add_recovers_from_duplicate_insert_after_precheck(self):
        real_get = self.db.get

        async def stale_membership(model, key, **kwargs):
            if model is WorkspaceUsers and key == (2, 1):
                return None
            return await real_get(model, key, **kwargs)

        # Simulate a stale precheck; the database still enforces the real unique key.
        with patch.object(self.db, 'get', side_effect=stale_membership):
            response = await self.client.post('/workspaces/1/employees', json={'email': 'employee@example.com'})
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(await self.db.scalar(select(func.count()).select_from(WorkspaceUsers)), 5)

    async def test_add_does_not_mislabel_other_database_errors(self):
        failure = IntegrityError('insert', {}, Exception('unrelated integrity failure'))
        with patch.object(self.db, 'commit', side_effect=failure):
            with self.assertRaises(IntegrityError):
                await self.client.post('/workspaces/1/employees', json={'email': 'mixedcase@example.com', 'department_id': 1})
        self.assertIsNone(await self.db.get(WorkspaceUsers, (3, 1)))
        self.assertEqual(await self.db.scalar(select(func.count()).select_from(User)), 4)

    async def test_new_employee_requires_owner_department_assignment(self):
        response = await self.client.post('/workspaces/1/employees', json={'email': 'mixedcase@example.com'})
        self.assertEqual(response.status_code, 201, response.text)
        self.identity = {'sub': '3'}
        response = await self.client.get('/workspaces')
        self.assertEqual({item['id'] for item in response.json()}, {1, 4})
        for path in ('/departments', '/projects'):
            self.assertEqual((await self.client.get(path, headers={'Workspace-ID': '1'})).status_code, 403)
        self.identity = {'sub': '1'}
        self.assertEqual((await self.client.put('/departments/1/employees/3')).status_code, 200)
        self.identity = {'sub': '3'}
        for path in ('/departments', '/projects'):
            self.assertEqual((await self.client.get(path, headers={'Workspace-ID': '1'})).status_code, 200)

    async def test_remove_assigned_and_unassigned_employees(self):
        response = await self.client.post('/workspaces/1/employees', json={'email': 'mixedcase@example.com'})
        self.assertEqual(response.status_code, 201)
        for user_id in (2, 3):
            path = f'/workspaces/1/employees/{user_id}'
            response = await self.client.delete(path)
            self.assertEqual(response.status_code, 204, response.text)
            self.assertEqual(response.content, b'')
            self.assertIsNone(await self.db.get(WorkspaceUsers, (user_id, 1)))
            self.assertEqual((await self.client.delete(path)).status_code, 404)

    async def test_remove_denies_nonowners_personal_and_missing_memberships(self):
        for user, workspace_id, target, expected in [
            ('2', 1, 999, 403), ('4', 1, 999, 403), ('999', 1, 2, 401),
            ('1', 3, 1, 400), ('1', 99, 2, 404), ('1', 1, 999, 404),
            ('1', 2, 2, 404),
        ]:
            self.identity = {'sub': user}
            response = await self.client.delete(f'/workspaces/{workspace_id}/employees/{target}')
            self.assertEqual(response.status_code, expected, response.text)
        self.assertIsNotNone(await self.db.get(WorkspaceUsers, (2, 1)))
        for workspace_id, user_id in [(0, 2), (-1, 2), (1, 0), (1, -1)]:
            response = await self.client.delete(f'/workspaces/{workspace_id}/employees/{user_id}')
            self.assertEqual(response.status_code, 422)

    async def test_remove_requires_authentication(self):
        del app.dependency_overrides[get_current_user]
        self.assertEqual((await self.client.delete('/workspaces/1/employees/2')).status_code, 401)

    async def test_remove_never_removes_any_owner(self):
        self.assertEqual((await self.client.delete('/workspaces/1/employees/1')).status_code, 403)
        self.db.add(WorkspaceUsers(user_id=4, workspace_id=1, role=WorkspaceRole.OWNER))
        await self.db.commit()
        for user_id in (1, 4):
            response = await self.client.delete(f'/workspaces/1/employees/{user_id}')
            self.assertEqual(response.status_code, 403, response.text)
            self.assertEqual((await self.db.get(WorkspaceUsers, (user_id, 1))).role, WorkspaceRole.OWNER)

    async def test_remove_role_guard_applies_at_the_actual_delete(self):
        await self.client.post('/workspaces/1/employees', json={'email': 'mixedcase@example.com'})
        self.assertEqual((await self.client.delete('/workspaces/1/employees/3')).status_code, 204)
        real_execute = self.db.execute

        async def change_role_before_delete(statement, *args, **kwargs):
            if getattr(statement, 'is_delete', False):
                await real_execute(update(WorkspaceUsers).where(
                    WorkspaceUsers.user_id == 2, WorkspaceUsers.workspace_id == 1,
                ).values(role=WorkspaceRole.OWNER))
            return await real_execute(statement, *args, **kwargs)

        with patch.object(self.db, 'execute', side_effect=change_role_before_delete):
            response = await self.client.delete('/workspaces/1/employees/2')
        self.assertEqual(response.status_code, 404, response.text)
        self.assertIsNotNone(await self.db.get(WorkspaceUsers, (2, 1)))

    async def test_remove_preserves_user_memberships_and_financial_history(self):
        for workspace_id in (1, 2):
            response = await self.client.post(f'/workspaces/{workspace_id}/employees', json={'email': 'mixedcase@example.com'})
            self.assertEqual(response.status_code, 201)
        self.db.add_all([
            Account(account_id=1, name='Cash', currency='EUR', balance=90, workspace_id=1),
            Category(category_id=1, name='Travel', type=CategoryType.expense, workspace_id=1),
        ])
        await self.db.flush()
        self.db.add(Expense(expense_id=1, workspace_id=1, submitted_by=3, category_id=1,
                            amount=10, currency='EUR', description='Train'))
        await self.db.flush()
        self.db.add(Transaction(transaction_id=1, workspace_id=1, account_id=1, category_id=1,
                                expense_id=1, amount=10, currency='EUR', description='Train',
                                source=TransactionSourceEnum.EXPENSE))
        await self.db.commit()
        response = await self.client.delete('/workspaces/1/employees/3')
        self.assertEqual(response.status_code, 204, response.text)
        self.assertIsNotNone(await self.db.get(User, 3))
        for workspace_id in (2, 4):
            self.assertIsNotNone(await self.db.get(WorkspaceUsers, (3, workspace_id)))
        self.assertEqual((await self.db.get(Expense, 1)).submitted_by, 3)
        self.assertEqual((await self.db.get(Transaction, 1)).expense_id, 1)
        self.assertEqual((await self.db.get(Account, 1)).balance, 90)
        response = await self.client.post('/workspaces/1/employees', json={'email': 'mixedcase@example.com'})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertIsNone(response.json()['department_id'])

    async def test_removed_employee_token_loses_only_that_workspace(self):
        self.db.add(Department(department_id=2, name='Other team', workspace_id=2))
        await self.db.flush()
        self.db.add(WorkspaceUsers(user_id=2, workspace_id=2, role=WorkspaceRole.EMPLOYEE, department_id=2))
        self.db.add(AuthSession(session_id='employee-session', user_id=2, jti='employee-jti',
                                expires_at=datetime.now() + timedelta(days=1)))
        await self.db.commit()
        token = jwt.encode({'sub': '2', 'sid': 'employee-session', 'type': 'access',
                            'exp': datetime.now(timezone.utc) + timedelta(minutes=15)},
                           settings.jwt_secret, algorithm='HS256')
        headers = {'Authorization': f'Bearer {token}', 'Workspace-ID': '1'}
        del app.dependency_overrides[get_current_user]
        self.assertEqual((await self.client.get('/departments', headers=headers)).status_code, 200)
        app.dependency_overrides[get_current_user] = lambda: {'sub': '1'}
        response = await self.client.delete('/workspaces/1/employees/2')
        self.assertEqual(response.status_code, 204, response.text)
        del app.dependency_overrides[get_current_user]
        response = await self.client.get('/workspaces', headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item['id'] for item in response.json()], [2])
        for path in ('/workspaces/1', '/departments', '/projects', '/transactions'):
            self.assertEqual((await self.client.get(path, headers=headers)).status_code, 403, path)
        self.assertEqual((await self.client.get('/departments', headers={**headers, 'Workspace-ID': '2'})).status_code, 200)

    async def test_remove_rolls_back_failed_commit(self):
        with patch.object(self.db, 'commit', side_effect=RuntimeError('commit failed')):
            with self.assertRaises(RuntimeError):
                await self.client.delete('/workspaces/1/employees/2')
        self.assertIsNotNone(await self.db.get(WorkspaceUsers, (2, 1)))
