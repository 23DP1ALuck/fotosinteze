from fastapi import APIRouter, Depends

from app.dto.create_user_response_dto import CreateUserResponseDTO
from app.dto.create_user_dto import CreateUserDTO
from app.dto.login_user_response_dto import LoginUserResponseDTO
from app.services import auth_service
from app.database import AsyncSession, get_db_session
from app.dto.login_user_request_dto import LoginUserRequestDTO

router = APIRouter()

@router.post("/auth/register",
          response_model=CreateUserResponseDTO,
          status_code=201,
          responses={
              400:{
                  "description":"User already exists",
                  "content": {
                      "application/json": {
                          "example": {"detail": "User already exists"}
                      }},
              }
          })
async def register(user: CreateUserDTO, db: AsyncSession = Depends(get_db_session)) -> CreateUserResponseDTO:
    return await auth_service.register(user, db)


@router.post("/auth/login",
          response_model=LoginUserResponseDTO,
          status_code=200,
          responses={
            401:{
                  "description":"Invalid credentials",
                  "content": {
                      "application/json": {
                          "example": {"detail": "Invalid credentials"}
                      }
                  }
              },
              404:{
                  "description":"User not found",
                  "content": {
                      "application/json": {
                          "example": {"detail": "User not found"}
                      }},
              }
          })
async def login(user:LoginUserRequestDTO, db: AsyncSession = Depends(get_db_session)) -> LoginUserResponseDTO:
    return await auth_service.login(user, db)