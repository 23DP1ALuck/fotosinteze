from fastapi import HTTPException
from sqlalchemy import select
from app.database import AsyncSession
from app.models import Department, User, Workspace, WorkspaceUsers, WorkspaceRole
from app.models.workspace import WorkspaceTypeEnum


async def get_workspace_membership(current_user: dict, workspace_id: int, db: AsyncSession, owner_only: bool = False) -> WorkspaceUsers:
    try:
        user_id = int(current_user['sub'])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail='Unauthorized')
    if await db.scalar(select(User.user_id).where(User.user_id == user_id)) is None:
        raise HTTPException(status_code=401, detail='Unauthorized')
    workspace = await db.scalar(select(Workspace).where(Workspace.workspace_id == workspace_id))
    if workspace is None:
        raise HTTPException(status_code=404, detail='Workspace not found')
    membership = await db.scalar(
        select(WorkspaceUsers).where(
            WorkspaceUsers.user_id == user_id,
            WorkspaceUsers.workspace_id == workspace_id,
        ).execution_options(populate_existing=True)
    )
    if membership is None:
        raise HTTPException(status_code=403, detail='No access to this workspace')
    if workspace.type != WorkspaceTypeEnum.BUSINESS:
        raise HTTPException(status_code=400, detail='Departments and projects require a business workspace')
    if owner_only and membership.role != WorkspaceRole.OWNER:
        raise HTTPException(status_code=403, detail='Workspace owner required')
    if membership.role != WorkspaceRole.OWNER:
        if membership.role != WorkspaceRole.EMPLOYEE or membership.department_id is None:
            raise HTTPException(status_code=403, detail='An owner must assign you to a department first')
        department = await db.scalar(select(Department.department_id).where(
            Department.department_id == membership.department_id,
            Department.workspace_id == workspace_id,
        ))
        if department is None:
            raise HTTPException(status_code=403, detail='No access to this department')
    return membership


def assert_department_access(membership: WorkspaceUsers, department_id: int) -> None:
    if membership.role != WorkspaceRole.OWNER and membership.department_id != department_id:
        raise HTTPException(status_code=403, detail='No access to this department')
