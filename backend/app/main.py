from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends

from app.config import settings
from app.database import sessionmanager

from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db_session
from app.dto.create_user_dto import CreateUserDTO
from app.dto.create_user_response_dto import CreateUserResponseDTO

from app.dto.login_user_request_dto import LoginUserRequestDTO
from app.dto.login_user_response_dto import LoginUserResponseDTO


# inspired from
# https://medium.com/@tclaitken/setting-up-a-fastapi-app-with-async-sqlalchemy-2-0-pydantic-v2-e6c540be4308
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Function that handles startup and shutdown events.
    To understand more, read https://fastapi.tiangolo.com/advanced/events/
    """
    yield
    if sessionmanager._engine is not None:
        # Close the DB connection
        await sessionmanager.close()

app = FastAPI(lifespan=lifespan, title=settings.project_name)

@app.get("/")
def read_root():
    return {"message": "Hello World"}

@app.post("/auth/register",
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
async def register_user(user: CreateUserDTO, db: AsyncSession = Depends(get_db_session)) -> CreateUserResponseDTO:
    pass


@app.post("/auth/login",
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
async def login_user(user:LoginUserRequestDTO, db: AsyncSession = Depends(get_db_session)) -> LoginUserResponseDTO:
    pass
