from fastapi import HTTPException
from fastapi import Depends
from sqlalchemy import select, Select, or_
import bcrypt

from app.database import get_db_session
from app.dto.create_user_dto import CreateUserDTO
from app.database import AsyncSession
from app.models import User

from app.dto.create_user_response_dto import CreateUserResponseDTO


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
        await db.commit()
        await db.refresh(user)
        user_response = CreateUserResponseDTO(
            id = user.user_id,
            display_name = user.display_name,
            email = user.email,
            created_at=user.created_at,
        )
        return user_response
    raise HTTPException(status_code=400, detail="User already exists")