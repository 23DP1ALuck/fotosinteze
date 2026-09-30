from typing import Annotated

import jwt
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi import Depends

from app.config import settings
from app.database import AsyncSession

from sqlalchemy import select, and_

from app.database import get_db_session

from app.models import User,AuthSession

from fastapi import HTTPException

from jwt import PyJWTError

from datetime import datetime, timezone

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
        payload: dict = jwt.decode(
            token, 
            settings.jwt_secret, 
            algorithms=["HS256"], 
            options={"require": ["sub", "sid", "exp", "type"]}
        )  # decode encoded data from bearer token
        if payload.get("type") != "access": # ensure that the token is an access token and not a refresh token
            raise HTTPException(status_code=401, detail="Invalid token type")
        
        user_id = int(payload["sub"])
        session_id = payload["sid"]
        if user_id is None or session_id is None:
            raise credentials_exception
    except (ValueError, PyJWTError):
        raise credentials_exception

    # check if session ist't revoked or expired
    stmt = select(AuthSession).where(
        and_(
            AuthSession.session_id == session_id,
            AuthSession.user_id == user_id,
            AuthSession.expires_at > datetime.now(timezone.utc).replace(tzinfo=None),
            AuthSession.revoked_at == None
        )
    )
    result = await db.execute(stmt)
    session = result.scalar()
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    stmt = select(User).where(User.user_id == user_id) # check if user with this id and email exists
    result = await db.execute(stmt)
    exists = result.scalar()

    if not exists:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return payload