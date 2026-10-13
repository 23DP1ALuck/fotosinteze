from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import delete, or_
from sqlalchemy.exc import IntegrityError

from app.dto.update_business_workspace_request import UpdateBusinessWorkspaceRequest
from app.dto.workspace_response import WorkspaceResponse
from app.models import User, Category, Project, Department, Account, Budget, RevolutConnection

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


async def load_workspace_member(workspace_id: int, current_user: dict, db: AsyncSession) -> WorkspaceUsers:
    try:
        user_id = int(current_user['sub'])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail='Unauthorized')
    if await db.get(User, user_id) is None:
        raise HTTPException(status_code=401, detail='Unauthorized')
    workspace = await db.scalar(select(Workspace).where(Workspace.workspace_id == workspace_id)
                                .execution_options(populate_existing=True))
    if workspace is None:
        raise HTTPException(status_code=404, detail='Workspace not found')
    membership = await db.scalar(select(WorkspaceUsers).where(
        WorkspaceUsers.workspace_id == workspace_id, WorkspaceUsers.user_id == user_id,
    ).options(selectinload(WorkspaceUsers.workspace)).execution_options(populate_existing=True))
    if membership is None:
        raise HTTPException(status_code=403, detail='No access to this workspace')
    return membership


def workspace_response(workspace: Workspace, membership: WorkspaceUsers) -> WorkspaceResponse:
    return WorkspaceResponse(id=workspace.workspace_id, name=workspace.name, type=workspace.type,
                             role=membership.role, base_currency=workspace.base_currency)

# business workspace owner check
def assert_business_owner(workspace: Workspace, membership: WorkspaceUsers) -> None:
    if workspace.type != WorkspaceTypeEnum.BUSINESS:
        raise HTTPException(status_code=400, detail='Only business workspaces can be updated or deleted')
    if membership.role != WorkspaceRole.OWNER:
        raise HTTPException(status_code=403, detail='Workspace owner required')


async def get_workspace_by_id(workspace_id: int, current_user: dict, db: AsyncSession) -> WorkspaceResponse:
    membership = await load_workspace_member(workspace_id, current_user, db)
    return workspace_response(membership.workspace, membership)


async def update_business_workspace(workspace_id: int, request: UpdateBusinessWorkspaceRequest,
                                    current_user: dict, db: AsyncSession) -> WorkspaceResponse:
    membership = await load_workspace_member(workspace_id, current_user, db)
    workspace = membership.workspace
    assert_business_owner(workspace, membership)
    name, currency = request.name.strip(), request.base_currency.strip()
    if not name:
        raise HTTPException(status_code=400, detail='Business workspace name is required')
    if not currency:
        raise HTTPException(status_code=400, detail='Business currency is required')
    if len(currency) != 3:
        raise HTTPException(status_code=400, detail='Currency code must be 3 symbols')
    workspace.name = name
    workspace.base_currency = currency
    workspace.updated_at = datetime.now()
    response = workspace_response(workspace, membership)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if await db.scalar(select(Workspace.workspace_id).where(
            Workspace.name == name, Workspace.workspace_id != workspace_id,
        )) is not None:
            raise HTTPException(status_code=409, detail='Workspace name is already taken') from exc
        raise
    return response


async def delete_business_workspace(workspace_id: int, current_user: dict, db: AsyncSession) -> None:
    membership = await load_workspace_member(workspace_id, current_user, db)
    assert_business_owner(membership.workspace, membership)
    category_ids = select(Category.category_id).where(Category.workspace_id == workspace_id)
    project_ids = select(Project.project_id).where(Project.workspace_id == workspace_id)
    department_ids = select(Department.department_id).where(Department.workspace_id == workspace_id)
    connection_ids = list((await db.scalars(select(Account.connection_id).where(
        Account.workspace_id == workspace_id, Account.connection_id.is_not(None),
    ))).all())
    try:
        # Budgets have no workspace_id,so remove them through their workspace-owned links
        await db.execute(delete(Budget).where(or_(Budget.category_id.in_(category_ids),
                                                 Budget.project_id.in_(project_ids),
                                                 Budget.department_id.in_(department_ids))))
        # ORM deletion applies the workspace model's relationship cascades
        await db.delete(membership.workspace)
        await db.flush()
        if connection_ids:
            await db.execute(delete(RevolutConnection).where(
                RevolutConnection.revolut_connection_id.in_(connection_ids)))
        await db.commit()
    except Exception:
        await db.rollback()
        raise
