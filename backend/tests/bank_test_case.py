import unittest
from unittest.mock import patch

import httpx
from cryptography.fernet import Fernet
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import Settings
from app.database import Base, get_db_session
from app.dependencies.auth import get_current_user
from app.main import app
from app.models import User, Workspace, WorkspaceRole, WorkspaceUsers
from app.models.workspace import WorkspaceTypeEnum
from app.services import enable_banking_service


class BankTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.db = async_sessionmaker(self.engine, expire_on_commit=False)()
        self.db.add_all([User(user_id=1, email='owner@test.com', display_name='Owner', password='unused'),
                         Workspace(workspace_id=1, name='Personal', type=WorkspaceTypeEnum.PERSONAL),
                         Workspace(workspace_id=2, name='Business', type=WorkspaceTypeEnum.BUSINESS)])
        await self.db.flush()
        self.db.add_all([WorkspaceUsers(user_id=1, workspace_id=i, role=WorkspaceRole.OWNER) for i in (1, 2)])
        await self.db.commit()
        self.config = Settings(_env_file=None, database_url='sqlite+aiosqlite://', jwt_secret='test',
                               client_url='http://localhost:5173',
                               revolut_token_encryption_key=Fernet.generate_key().decode())
        self.config_patch = patch.object(enable_banking_service, 'settings', self.config)
        self.config_patch.start()
        self.old_overrides = app.dependency_overrides.copy()

        async def session():
            yield self.db

        app.dependency_overrides[get_db_session] = session
        app.dependency_overrides[get_current_user] = lambda: {'sub': '1'}
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='https://backend.test')

    async def asyncTearDown(self):
        self.config_patch.stop()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.old_overrides)
        await self.client.aclose()
        await self.db.close()
        await self.engine.dispose()
