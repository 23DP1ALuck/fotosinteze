from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Response, Cookie, HTTPException
import jwt

from app.config import settings

from app.services import auth_service
from app.database import AsyncSession, get_db_session

from app.dto import (LoginUserRequestDTO,
                     AccessTokenResponseDTO,
                     CreateUserDTO,
                     CreateUserResponseDTO)

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
          response_model=AccessTokenResponseDTO,
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
async def login(user:LoginUserRequestDTO, response: Response, db: AsyncSession = Depends(get_db_session)):

    tokens = await auth_service.login(user, db)

    response.set_cookie(
        key="refresh_token",
        value=tokens.refresh_token,
        httponly=True,
        secure=False,  # Set to True in production
        samesite="lax",
        path = "/auth",
        max_age=7*24*60*60,  # 7 days
    )
    return AccessTokenResponseDTO(access_token=tokens.access_token)

@router.post("/auth/refresh",
          response_model=AccessTokenResponseDTO,
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
async def refresh_token(response: Response, refresh_token: Annotated[str | None, Cookie()] = None, db: AsyncSession = Depends(get_db_session)):
    if refresh_token is None:
        raise HTTPException(status_code=401, detail="Refresh token missing")
    
    tokens = await auth_service.refresh_token(refresh_token, db)

    payload = jwt.decode(
        tokens.refresh_token,
        settings.jwt_secret,
        algorithms=["HS256"],
    )
    remaining_seconds = max(
        0,
        int(payload["exp"] - datetime.now(timezone.utc).timestamp()),
    )

    response.set_cookie(
        key="refresh_token",
        value=tokens.refresh_token,
        httponly=True,
        secure=False,  # Set to True in production
        samesite="lax",
        path = "/auth",
        max_age=remaining_seconds, 
    )
    return AccessTokenResponseDTO(access_token=tokens.access_token)

@router.post("/auth/logout",
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
async def logout(response: Response, refresh_token: Annotated[str | None, Cookie()] = None, db: AsyncSession = Depends(get_db_session)) -> dict:
    response.delete_cookie(key="refresh_token", path="/auth", samesite="lax")
    if refresh_token is None:
        return {"detail": "Successfully logged out"}
    return await auth_service.logout(refresh_token, db)
