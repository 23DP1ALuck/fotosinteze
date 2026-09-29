from fastapi import HTTPException
from fastapi import Depends
from sqlalchemy import select, Select, or_
import bcrypt
import jwt
from datetime import datetime, timedelta, timezone

from app.database import get_db_session
from app.dto.create_user_dto import CreateUserDTO
from app.dto.create_user_response_dto import CreateUserResponseDTO
from app.dto.login_user_request_dto import LoginUserRequestDTO
from app.dto.login_user_response_dto import LoginUserResponseDTO

from app.database import AsyncSession
from app.models.user import User
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
            type=WorkspaceTypeEnum.personal,
            )

        db.add(personal_workspace)

        await db.flush()

        workspace_users = WorkspaceUsers(
            user_id=user.user_id,
            workspace_id=personal_workspace.workspace_id,
            role=WorkspaceRole.owner, # user is an owner in its personal workspace by default
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
        raise HTTPException(status_code=401, detail="Unauthorized")
    # compare passwords only if user was found
    if not bcrypt.checkpw(login_user_request.password.encode(), exists.password.encode()):
        raise HTTPException(status_code=401, detail="Incorrect password")
    encoded = jwt.encode({
        "sub": str(exists.user_id),
        "email": login_user_request.email,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=60)
    }, settings.jwt_secret, algorithm="HS256")
    response = LoginUserResponseDTO(access_token=encoded)
    return response