from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Workspace, User, WorkspaceUsers
from app.database import get_db_session
from app.dependencies.auth import get_current_user

async def get_current_workspace( workspace_id: int = Header(alias="Workspace-ID"), current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db_session), ) -> Workspace:
    user = await db.get(User, int(current_user.get("sub")))
    result = await db.execute(
        select(Workspace)
        .join(WorkspaceUsers)
        .where(
            Workspace.workspace_id == workspace_id,
            WorkspaceUsers.user_id == user.user_id,
        )
    )

    workspace = result.scalar_one_or_none()

    if workspace is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No access to this workspace",
        )

    return workspace