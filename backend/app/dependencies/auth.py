from typing import Annotated

import jwt
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi import Depends

from app.config import settings
from app.database import AsyncSession

from sqlalchemy import select, and_

from app.database import get_db_session
from app.models.user import User

from fastapi import HTTPException

from jwt import PyJWTError

#get the authorization bearer token
bearer_scheme = HTTPBearer()

async def get_current_user(credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer_scheme)], db: AsyncSession = Depends(get_db_session)):
    token = credentials.credentials
    # create an exception here, because it will be thrown in many places
    credentials_exception = HTTPException(status_code=401,
                                detail="Could not validate credentials.",
                                headers={"WWW-Authenticate": "Bearer"}
                              )
    try:
        payload: dict = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])  # decode encoded data from bearer token
        user_id : str | None = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except (ValueError, PyJWTError):
        raise credentials_exception

    stmt = select(User).where(User.user_id == int(payload.get("sub"))) # check if user with this id and email exists
    result = await db.execute(stmt)
    exists = result.scalar()

    if not exists:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return payload