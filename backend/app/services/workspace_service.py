
from app.database import AsyncSession
from app.models import WorkspaceUsers
from sqlalchemy import select, Select
from sqlalchemy.orm import selectinload

from app.dto import WorkspaceListResponse


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


