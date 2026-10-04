from uuid import uuid4

from fastapi import HTTPException, Depends
from sqlalchemy import select, update, Select, or_
import bcrypt
import jwt
from datetime import datetime, timedelta, timezone

from app.database import get_db_session

from app.dto import (CreateUserResponseDTO,
                     LoginUserRequestDTO,
                     CreateUserDTO,
                     LoginUserResponseDTO)

from app.database import AsyncSession
from app.models import User, AuthSession
from app.config import settings

from app.models.workspace import Workspace, WorkspaceTypeEnum, WorkspaceUsers, WorkspaceRole


async def register(create_user_request: CreateUserDTO, db: AsyncSession = Depends(get_db_session)) -> CreateUserResponseDTO:
    stmt:Select = select(User).where( # checks if user with the same credentials already exists
        or_(User.display_name == create_user_request.display_name, User.email == create_user_request.email)
    )
    result = await db.execute(stmt)
    exists = result.scalar()
    if not exists:
        hashed_password = bcrypt.hashpw(create_user_request.password.encode(), bcrypt.gensalt())
        user = User(
            display_name=create_user_request.display_name,
            email=create_user_request.email,
            password=hashed_password.decode('UTF-8')
        )

        db.add(user)
        await db.flush()

        personal_workspace = Workspace( # user has his own personal workspace after successful registration
            name=f"{user.display_name} Personal Workspace",
            type=WorkspaceTypeEnum.PERSONAL,
            )

        db.add(personal_workspace)

        await db.flush()

        workspace_users = WorkspaceUsers(
            user_id=user.user_id,
            workspace_id=personal_workspace.workspace_id,
            role=WorkspaceRole.OWNER, # user is an owner in its personal workspace by default
        )
        db.add(workspace_users)

        await db.commit() # commit the transaction with all 3 inserts

        await db.refresh(user)

        user_response = CreateUserResponseDTO(
            id = user.user_id,
            display_name = user.display_name,
            email = user.email,
            created_at=user.created_at,
        )
        return user_response
    raise HTTPException(status_code=400, detail="User already exists")

async def login(login_user_request: LoginUserRequestDTO, db: AsyncSession = Depends(get_db_session)):
    stmt:Select = select(User).where(User.email == login_user_request.email)
    result = await db.execute(stmt)
    exists = result.scalar()
    if not exists:
        raise HTTPException(status_code=404, detail="User not found")
    # compare passwords only if user was found
    if not bcrypt.checkpw(login_user_request.password.encode(), exists.password.encode()):
        raise HTTPException(status_code=401, detail="Incorrect password")
    refresh_jti = str(uuid4())
    session = await create_session(exists.user_id, refresh_jti, db)
    access_token = jwt.encode({
        "sid": session.session_id,
        "sub": str(exists.user_id),
        "email": login_user_request.email,
        "display_name": exists.display_name,
        "type": "access",
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=15)
    }, settings.jwt_secret, algorithm="HS256")
    refresh_token = jwt.encode({
        "jti": refresh_jti,
        "sid": session.session_id,
        "sub": str(exists.user_id),
        "email": login_user_request.email,
        "type": "refresh",
        "iat": datetime.now(timezone.utc),
        "exp": session.expires_at.replace(tzinfo=timezone.utc)
    }, settings.jwt_secret, algorithm="HS256")
    response = LoginUserResponseDTO(access_token=access_token, refresh_token=refresh_token)
    return response

async def create_session(user_id: int, jti: str, db: AsyncSession = Depends(get_db_session)) -> AuthSession:
    session_id = str(uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    auth_session = AuthSession(
        session_id=session_id,
        user_id=user_id,
        jti=jti,
        expires_at=expires_at
    )
    db.add(auth_session)
    await db.commit()
    await db.refresh(auth_session)
    return auth_session

async def refresh_token(refresh_token: str, db: AsyncSession = Depends(get_db_session)) -> LoginUserResponseDTO:
    # Validate the refresh token and extract the payload
    try:
        payload: dict = jwt.decode(
            refresh_token, 
            settings.jwt_secret, 
            algorithms=["HS256"], 
            options={"require": ["jti", "sub", "sid", "exp", "type"]}
        )
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user_id = int(payload["sub"])
        session_id = payload["sid"]
        jti = payload["jti"]
        if user_id is None or session_id is None or jti is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except (ValueError, jwt.PyJWTError):
        raise HTTPException(status_code=401, detail="Invalid token")

    # Check if the session is valid and not revoked
    stmt = select(AuthSession).where(
        AuthSession.session_id == session_id,
        AuthSession.user_id == user_id,
        AuthSession.jti == jti,
        AuthSession.expires_at > datetime.now(timezone.utc).replace(tzinfo=None),
        AuthSession.revoked_at == None
    )
    result = await db.execute(stmt)
    session = result.scalar()
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    stmt = select(User).where(User.user_id == user_id)
    result = await db.execute(stmt)
    user = result.scalar()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Generate new access tokens
    new_access_token = jwt.encode({
        "sid": session.session_id,
        "sub": str(user.user_id),
        "email": user.email,
        "display_name": user.display_name,
        "type": "access",
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=15)
    }, settings.jwt_secret, algorithm="HS256")

    new_refresh_jti = str(uuid4()) # Generate a new jti for the refresh token

    # Generate a new refresh token with the same session_id and user_id, but a new jti
    new_refresh_token = jwt.encode({
        "jti": new_refresh_jti,
        "sid": session.session_id,
        "sub": str(user.user_id),
        "email": user.email,
        "type": "refresh",
        "iat": datetime.now(timezone.utc),
        "exp": session.expires_at.replace(tzinfo=timezone.utc)
    }, settings.jwt_secret, algorithm="HS256")

    # Only the request presenting the current refresh token may replace it.
    result = await db.execute(
        update(AuthSession).where(
            AuthSession.session_id == session_id,
            AuthSession.user_id == user_id,
            AuthSession.jti == jti,
            AuthSession.expires_at > datetime.now(timezone.utc).replace(tzinfo=None),
            AuthSession.revoked_at.is_(None)
        ).values(jti=new_refresh_jti) # New jti is set for the refresh token, so that the old one is invalidated
    )
    if result.rowcount != 1:
        await db.rollback()
        raise HTTPException(status_code=401, detail="Invalid session")
    await db.commit()
    
    return LoginUserResponseDTO(access_token=new_access_token, refresh_token=new_refresh_token)

async def logout(refresh_token: str, db: AsyncSession = Depends(get_db_session)) -> dict:
    try:
        payload: dict = jwt.decode(
            refresh_token,
            settings.jwt_secret, 
            algorithms=["HS256"], 
            options={"require": ["jti", "sub", "sid", "exp", "type"]}
        )
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user_id = int(payload["sub"])
        session_id = payload["sid"]
        if user_id is None or session_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except (ValueError, jwt.PyJWTError):
        raise HTTPException(status_code=401, detail="Invalid token")

    stmt = select(AuthSession).where(
        AuthSession.session_id == session_id,
        AuthSession.user_id == user_id,
        AuthSession.expires_at > datetime.now(timezone.utc).replace(tzinfo=None)
    )
    result = await db.execute(stmt)
    session = result.scalar()
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    if session.revoked_at is not None:
        return {"detail": "Successfully logged out"}

    # Revoke the session by setting revoked_at to current time
    result = await db.execute(
        update(AuthSession).where(
            AuthSession.session_id == session_id,
            AuthSession.user_id == user_id,
            AuthSession.revoked_at.is_(None)
        ).values(revoked_at=datetime.now(timezone.utc))
    )

    await db.commit()

    return {"detail": "Successfully logged out"}
