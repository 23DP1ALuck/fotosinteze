import asyncio
import unittest

import bcrypt
import jwt
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.database import Base
from app.dto.login_user_request_dto import LoginUserRequestDTO
from app.models import User
from app.services.auth_service import login, refresh_token


class AuthDisplayNameTest(unittest.TestCase):
    def test_access_tokens_use_display_name_from_user_row(self):
        asyncio.run(self._check_access_tokens())

    async def _check_access_tokens(self):
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        try:
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)

            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                db.add(User(
                    email="math@example.com",
                    display_name="Ada Lovelace",
                    password=bcrypt.hashpw(b"password123", bcrypt.gensalt()).decode(),
                ))
                await db.commit()

                tokens = await login(
                    LoginUserRequestDTO(email="math@example.com", password="password123"),
                    db,
                )
                login_payload = jwt.decode(
                    tokens.access_token, settings.jwt_secret, algorithms=["HS256"]
                )
                self.assertEqual(login_payload["display_name"], "Ada Lovelace")

                user = await db.get(User, int(login_payload["sub"]))
                user.display_name = "Ada Byron"
                await db.commit()

                rotated = await refresh_token(tokens.refresh_token, db)
                refreshed_payload = jwt.decode(
                    rotated.access_token, settings.jwt_secret, algorithms=["HS256"]
                )
                self.assertEqual(refreshed_payload["display_name"], "Ada Byron")
        finally:
            await engine.dispose()


if __name__ == "__main__":
    unittest.main()
