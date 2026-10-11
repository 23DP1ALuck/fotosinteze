from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.services import project_service
from app.database import get_db_session
from app.dependencies.auth import get_current_user
from app.dependencies.workspace import get_current_workspace
from app.dto import ProjectResponseDTO, CreateProjectRequest, UpdateProjectRequest
from app.models import Workspace

router = APIRouter()
forbidden = {403: {'description': 'No access to this project or operation'}}
not_found = {404: {'description': 'Project, workspace or department not found'}}
conflict = {409: {'description': 'Project name is already taken in this workspace'}}


@router.post('/projects', status_code=201, response_model=ProjectResponseDTO,
             summary='Create a project; employees create only in their assigned department',
             responses={**forbidden, **not_found, **conflict,
                        400: {'description': 'Invalid workspace or department links'}})
async def create_project(project_data: CreateProjectRequest, db: AsyncSession = Depends(get_db_session), current_user: dict = Depends(get_current_user), workspace: Workspace = Depends(get_current_workspace)) -> ProjectResponseDTO:
    return await project_service.create_project(workspace.workspace_id, project_data, current_user, db)


@router.get('/projects', response_model=list[ProjectResponseDTO],
            summary='List projects visible to the current workspace member',
            responses={**forbidden, **not_found})
async def get_projects(workspace: Workspace = Depends(get_current_workspace), db: AsyncSession = Depends(get_db_session), current_user: dict = Depends(get_current_user)) -> list[ProjectResponseDTO]:
    return await project_service.get_projects(workspace.workspace_id, current_user, db)


@router.get('/projects/{project_id}', response_model=ProjectResponseDTO,
            responses={**forbidden, **not_found})
async def get_project_by_id(project_id: int, db: AsyncSession = Depends(get_db_session), current_user: dict = Depends(get_current_user)) -> ProjectResponseDTO:
    return await project_service.get_project_by_id(project_id, current_user, db)


@router.put('/projects/{project_id}', response_model=ProjectResponseDTO,
            summary='Edit shared project details; only owners may change department links',
            responses={**forbidden, **not_found, **conflict,
                       400: {'description': 'Invalid department links'}})
async def update_project(project_id: int, project_data: UpdateProjectRequest, db: AsyncSession = Depends(get_db_session), current_user: dict = Depends(get_current_user)) -> ProjectResponseDTO:
    return await project_service.update_project(project_id, project_data, current_user, db)


@router.delete('/projects/{project_id}', summary='Delete a project (workspace owner only)',
               responses={**forbidden, **not_found})
async def delete_project(project_id: int, db: AsyncSession = Depends(get_db_session), current_user: dict = Depends(get_current_user)) -> None:
    return await project_service.delete_project(project_id, current_user, db)
