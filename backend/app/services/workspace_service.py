from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError

from app.dto.update_business_workspace_request import UpdateBusinessWorkspaceRequest
from app.dto.workspace_response import WorkspaceResponse
from app.models import User, Account, Budget, Department, RevolutConnection

from app.database import AsyncSession
from app.services.name_uniqueness import check_unique_name
from app.models import WorkspaceUsers
from sqlalchemy import select, Select
from sqlalchemy.orm import selectinload

from app.dto import AddWorkspaceEmployeeRequest, WorkspaceListResponse, WorkspaceMemberResponse
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
    await check_unique_name(db, Workspace.name, request.name, detail='Workspace name is already taken')
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
        raise HTTPException(status_code=400, detail='This operation requires a business workspace')
    if membership.role != WorkspaceRole.OWNER:
        raise HTTPException(status_code=403, detail='Workspace owner required')


async def get_workspace_members(workspace_id: int, current_user: dict,
                                db: AsyncSession) -> list[WorkspaceMemberResponse]:
    caller = await load_workspace_member(workspace_id, current_user, db)
    assert_business_owner(caller.workspace, caller)
    rows = await db.execute(select(WorkspaceUsers, User.display_name, User.email)
                            .join(User, User.user_id == WorkspaceUsers.user_id)
                            .where(WorkspaceUsers.workspace_id == workspace_id)
                            .order_by(WorkspaceUsers.user_id)
                            .execution_options(populate_existing=True))
    return [WorkspaceMemberResponse(user_id=member.user_id, workspace_id=member.workspace_id,
                                    display_name=name, email=email, role=member.role,
                                    department_id=member.department_id, joined_at=member.joined_at)
            for member, name, email in rows]


async def add_workspace_employee(workspace_id: int, request: AddWorkspaceEmployeeRequest,
                                 current_user: dict, db: AsyncSession) -> WorkspaceMemberResponse:
    caller = await load_workspace_member(workspace_id, current_user, db)
    assert_business_owner(caller.workspace, caller)
    if request.department_id is not None:
        department = await db.get(Department, request.department_id)
        if department is None:
            raise HTTPException(status_code=404, detail='Department not found')
        if department.workspace_id != workspace_id:
            raise HTTPException(status_code=400, detail='Department does not belong to this workspace')
    # shortcut: Unicode matching scans users; add an indexed normalized email if this becomes slow.
    users = [user for user in await db.execute(select(User.user_id, User.display_name, User.email))
             if user.email.casefold() == request.email.casefold()]
    if not users:
        raise HTTPException(status_code=404, detail='User not found')
    if len(users) > 1:
        raise HTTPException(status_code=409, detail='Multiple users match this email')
    user = users[0]
    user_id = user.user_id
    if await db.get(WorkspaceUsers, (user_id, workspace_id)) is not None:
        raise HTTPException(status_code=409, detail='User is already a workspace member')
    membership = WorkspaceUsers(user_id=user_id, workspace_id=workspace_id,
                                role=WorkspaceRole.EMPLOYEE, department_id=request.department_id)
    db.add(membership)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if await db.scalar(select(WorkspaceUsers.user_id).where(
            WorkspaceUsers.user_id == user_id, WorkspaceUsers.workspace_id == workspace_id,
        )) is not None:
            raise HTTPException(status_code=409, detail='User is already a workspace member') from exc
        raise
    except Exception:
        await db.rollback()
        raise
    return WorkspaceMemberResponse(user_id=user_id, workspace_id=workspace_id,
                                    display_name=user.display_name, email=user.email,
                                    role=membership.role, department_id=membership.department_id,
                                    joined_at=membership.joined_at)


async def remove_workspace_employee(workspace_id: int, user_id: int, current_user: dict,
                                    db: AsyncSession) -> None:
    caller = await load_workspace_member(workspace_id, current_user, db)
    assert_business_owner(caller.workspace, caller)
    membership = await db.get(WorkspaceUsers, (user_id, workspace_id), populate_existing=True)
    if membership is None:
        raise HTTPException(status_code=404, detail='Employee membership not found')
    if membership.role != WorkspaceRole.EMPLOYEE:
        raise HTTPException(status_code=403, detail='Only employee memberships can be removed')
    try:
        result = await db.execute(delete(WorkspaceUsers).where(
            WorkspaceUsers.workspace_id == workspace_id,
            WorkspaceUsers.user_id == user_id,
            WorkspaceUsers.role == WorkspaceRole.EMPLOYEE,
        ))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail='Employee membership not found')
        await db.commit()
    except Exception:
        await db.rollback()
        raise


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
    await check_unique_name(db, Workspace.name, name, Workspace.workspace_id != workspace_id,
        detail='Workspace name is already taken')
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
    connection_ids = list((await db.scalars(select(Account.connection_id).where(
        Account.workspace_id == workspace_id, Account.connection_id.is_not(None),
    ))).all())
    try:
        await db.execute(delete(Budget).where(Budget.workspace_id == workspace_id))
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
