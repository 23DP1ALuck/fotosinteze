from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import department_service
from app.database import get_db_session
from app.dependencies.auth import get_current_user
from app.dto import DepartmentResponseDTO
from app.models import Department, Workspace
from app.dependencies.department import get_current_workspace


router = APIRouter()

@router.post("/departments",
          status_code=201,
          responses={
              400:{
                  "description":"Cannot create department in a personal workspace",
                  "content": {
                      "application/json": {
                          "example": {"detail": "Cannot create department in a personal workspace"}
                      }},
              404:{
                  "description":"Workspace not found",
                  "content": {
                      "application/json": {
                          "example": {"detail": "Workspace not found"}
                      }},
              }
          }}
          )
async def create_department(name: str, db: AsyncSession = Depends(get_db_session), current_user: dict = Depends(get_current_user), workspace: Workspace = Depends(get_current_workspace)) -> DepartmentResponseDTO:
    return await department_service.create_department(workspace.workspace_id, name, current_user, db)

@router.get("/departments",
            responses={
                404:{
                    "description":"Workspace not found",
                    "content": {
                        "application/json": {
                            "example": {"detail": "Workspace not found"}
                        }},
                }
            })
async def get_departments(workspace: Workspace = Depends(get_current_workspace), db: AsyncSession = Depends(get_db_session), current_user: dict = Depends(get_current_user)) -> list[DepartmentResponseDTO]:
    return await department_service.get_departments(workspace.workspace_id, current_user, db)

@router.get("/departments/{department_id}",
            responses={
                404:{
                    "description":"Department not found",
                    "content": {
                        "application/json": {
                            "example": {"detail": "Department not found"}
                        }},
                }
            })
async def get_department_by_id(department_id: int, db: AsyncSession = Depends(get_db_session), current_user: dict = Depends(get_current_user)) -> DepartmentResponseDTO:
    return await department_service.get_department_by_id(department_id, current_user, db)

@router.put("/departments/{department_id}",
            responses={
                404:{
                    "description":"Department not found",
                    "content": {
                        "application/json": {
                            "example": {"detail": "Department not found"}
                        }},
                }
            })
async def update_department(department_id: int, name: str, db: AsyncSession = Depends(get_db_session), current_user: dict = Depends(get_current_user)) -> DepartmentResponseDTO:
    return await department_service.update_department(department_id, name, current_user, db)

@router.delete("/departments/{department_id}",
            responses={
                404:{
                    "description":"Department not found",
                    "content": {
                        "application/json": {
                            "example": {"detail": "Department not found"}
                        }},
                }
            })
async def delete_department(department_id: int, db: AsyncSession = Depends(get_db_session), current_user: dict = Depends(get_current_user)) -> None:
    return await department_service.delete_department(department_id, current_user, db)