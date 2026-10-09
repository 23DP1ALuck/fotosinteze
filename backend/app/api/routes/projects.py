from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import project_service
from app.database import get_db_session
from app.dependencies.auth import get_current_user
from app.dto import ProjectResponseDTO, CreateProjectRequest
from app.models import Project, Workspace
from app.dependencies.workspace import get_current_workspace

router = APIRouter()

@router.post("/projects",
          status_code=201,
          responses={
              400:{
                  "description":"Cannot create project in a personal workspace",
                  "content": {
                      "application/json": {
                          "example": {"detail": "Cannot create project in a personal workspace"}
                      }},
              404:{
                  "description":"Workspace not found",
                  "content": {
                      "application/json": {
                          "example": {"detail": "Workspace not found"}
                      }},
              }
          }})
async def create_project(project_data: CreateProjectRequest, db: AsyncSession = Depends(get_db_session), current_user: dict = Depends(get_current_user), workspace: Workspace = Depends(get_current_workspace)) -> ProjectResponseDTO:
    return await project_service.create_project(workspace.workspace_id, project_data, current_user, db)

@router.get("/projects",
            responses={
                404:{
                    "description":"Workspace not found",
                    "content": {
                        "application/json": {
                            "example": {"detail": "Workspace not found"}
                        }},
                }
            })
async def get_projects(workspace: Workspace = Depends(get_current_workspace), db: AsyncSession = Depends(get_db_session), current_user: dict = Depends(get_current_user)) -> list[ProjectResponseDTO]:
    return await project_service.get_projects(workspace.workspace_id, current_user, db)

@router.get("/projects/{project_id}",
            responses={
                404:{
                    "description":"Project not found",
                    "content": {
                        "application/json": {
                            "example": {"detail": "Project not found"}
                        }},
                }
            })
async def get_project_by_id(project_id: int, db: AsyncSession = Depends(get_db_session), current_user: dict = Depends(get_current_user)) -> ProjectResponseDTO:
    return await project_service.get_project_by_id(project_id, current_user, db)

@router.put("/projects/{project_id}",
            responses={
                404:{
                    "description":"Project not found",
                    "content": {
                        "application/json": {
                            "example": {"detail": "Project not found"}
                        }},
                }
            })
async def update_project(project_id: int, project_data: CreateProjectRequest, db: AsyncSession = Depends(get_db_session), current_user: dict = Depends(get_current_user)) -> ProjectResponseDTO:
    return await project_service.update_project(project_id, project_data, current_user, db)

@router.delete("/projects/{project_id}",
            responses={
                404:{
                    "description":"Project not found",
                    "content": {
                        "application/json": {
                            "example": {"detail": "Project not found"}
                        }},
                }
            })
async def delete_project(project_id: int, db: AsyncSession = Depends(get_db_session), current_user: dict = Depends(get_current_user)) -> None:
    return await project_service.delete_project(project_id, current_user, db)