from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response
from app.dto.update_business_workspace_request import UpdateBusinessWorkspaceRequest
from app.dto.workspace_response import WorkspaceResponse
from app.dto import AddWorkspaceEmployeeRequest, WorkspaceListResponse, WorkspaceMemberResponse
from app.dependencies.auth import get_current_user
from app.database import get_db_session, AsyncSession
from app.services import workspace_service
from app.dto.create_business_workspace_request import CreateBusinessWorkspaceRequest

router = APIRouter()

@router.get("/workspaces", status_code=200, response_model=list[WorkspaceListResponse], tags=["workspaces"])
async def get_workspaces(current_user: dict[str,str] = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db_session)
                         ) -> list[WorkspaceListResponse]:
    return await workspace_service.get_workspaces(current_user, db)

@router.post("/workspaces/business",
             status_code=201,
             response_model=WorkspaceListResponse,
             tags=["workspaces"],
             description="Create a business workspace")
async def create_workspace(request: CreateBusinessWorkspaceRequest,
                           current_user: dict[str,str] = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db_session)
                           ) -> WorkspaceListResponse:
    return await workspace_service.create_business_workspace(request,current_user, db)


@router.get('/workspaces/{workspace_id}', response_model=WorkspaceResponse, tags=['workspaces'],
            summary='Read a workspace (members only)',
            responses={403: {'description': 'No access to this workspace'}, 404: {'description': 'Workspace not found'}})
async def get_workspace_by_id(workspace_id: int, current_user: dict = Depends(get_current_user),
                              db: AsyncSession = Depends(get_db_session)) -> WorkspaceResponse:
    return await workspace_service.get_workspace_by_id(workspace_id, current_user, db)


@router.put('/workspaces/{workspace_id}', response_model=WorkspaceResponse, tags=['workspaces'],
            summary='Update a business workspace (owner only)',
            responses={400: {'description': 'Invalid fields or personal workspace'},
                       403: {'description': 'Workspace owner required'},
                       404: {'description': 'Workspace not found'},
                       409: {'description': 'Workspace name is already taken'}})
async def update_business_workspace(workspace_id: int, request: UpdateBusinessWorkspaceRequest,
                                    current_user: dict = Depends(get_current_user),
                                    db: AsyncSession = Depends(get_db_session)) -> WorkspaceResponse:
    return await workspace_service.update_business_workspace(workspace_id, request, current_user, db)


@router.delete('/workspaces/{workspace_id}', status_code=204, tags=['workspaces'],
               summary='Delete a business workspace and its data (owner only)',
               responses={400: {'description': 'Personal workspace cannot be deleted'},
                          403: {'description': 'Workspace owner required'},
                          404: {'description': 'Workspace not found'}})
async def delete_business_workspace(workspace_id: int, current_user: dict = Depends(get_current_user),
                                    db: AsyncSession = Depends(get_db_session)) -> Response:
    await workspace_service.delete_business_workspace(workspace_id, current_user, db)
    return Response(status_code=204)


@router.post('/workspaces/{workspace_id}/employees', status_code=201,
             response_model=WorkspaceMemberResponse, tags=['workspaces'],
             summary='Add a registered user as an employee (business owner only)',
             responses={400: {'description': 'Business workspace required'},
                        401: {'description': 'Authentication required'},
                        403: {'description': 'Workspace owner required'},
                        404: {'description': 'Workspace or user not found'},
                        409: {'description': 'Existing membership or ambiguous email'}})
async def add_workspace_employee(workspace_id: Annotated[int, Path(gt=0)], request: AddWorkspaceEmployeeRequest,
                                 current_user: dict = Depends(get_current_user),
                                 db: AsyncSession = Depends(get_db_session)) -> WorkspaceMemberResponse:
    return await workspace_service.add_workspace_employee(workspace_id, request, current_user, db)


@router.delete('/workspaces/{workspace_id}/employees/{user_id}', status_code=204, tags=['workspaces'],
               summary='Remove an employee membership (business owner only)',
               responses={400: {'description': 'Business workspace required'},
                          401: {'description': 'Authentication required'},
                          403: {'description': 'Workspace owner required or target is an owner'},
                          404: {'description': 'Workspace or employee membership not found'}})
async def remove_workspace_employee(workspace_id: Annotated[int, Path(gt=0)], user_id: Annotated[int, Path(gt=0)],
                                    current_user: dict = Depends(get_current_user),
                                    db: AsyncSession = Depends(get_db_session)) -> Response:
    await workspace_service.remove_workspace_employee(workspace_id, user_id, current_user, db)
    return Response(status_code=204)
