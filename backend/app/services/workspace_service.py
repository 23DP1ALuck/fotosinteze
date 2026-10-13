from fastapi import HTTPException

from app.database import AsyncSession
from app.models import WorkspaceUsers
from sqlalchemy import select, Select
from sqlalchemy.orm import selectinload

from app.dto import WorkspaceListResponse
from app.models import Workspace
from app.dto.create_business_workspace_request import CreateBusinessWorkspaceRequest
from app.models import WorkspaceRole
from app.models.workspace import WorkspaceTypeEnum


async def get_workspaces(current_user: dict[str,str], db: AsyncSession)-> list[WorkspaceListResponse]:
    workspaces_stmt: Select = (select(WorkspaceUsers)
                               .where(WorkspaceUsers.user_id == int(current_user["sub"]))
                               .options(selectinload(WorkspaceUsers.workspace))
                               )
    workspaces_result = await db.execute(workspaces_stmt)
    workspaces = workspaces_result.scalars().all()
    return [
        WorkspaceListResponse(
            id=wsu.workspace.workspace_id,
            name=wsu.workspace.name,
            type=wsu.workspace.type,
            role=wsu.role
            ) for wsu in workspaces
    ]

async def create_business_workspace(
                                    request: CreateBusinessWorkspaceRequest,
                                    current_user: dict[str,str],
                                    db: AsyncSession):
    if len(request.name.strip()) == 0:
        raise HTTPException(status_code=400, detail="Business workspace name is required")
    if len(request.base_currency.strip()) == 0:
        raise HTTPException(status_code=400, detail="Business currency is required")
    if len(request.base_currency.strip()) != 3:
        raise HTTPException(status_code=400, detail="Currency code must be 3 symbols")
    workspace = Workspace(
        name=request.name.strip(),
        type=WorkspaceTypeEnum.BUSINESS,
        base_currency=request.base_currency.strip(),
    )
    db.add(workspace)
    await db.flush()

    workspace_users = WorkspaceUsers(
        user_id=int(current_user["sub"]),
        workspace_id=workspace.workspace_id,
        role=WorkspaceRole.OWNER
    )
    db.add(workspace_users)
    await db.commit()
    await db.refresh(workspace_users)
    return WorkspaceListResponse(
        id=workspace_users.workspace_id,
        name=workspace.name,
        type=workspace.type,
        role=workspace_users.role
    )

