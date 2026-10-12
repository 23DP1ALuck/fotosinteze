from fastapi import APIRouter, Depends
from app.dto import WorkspaceListResponse
from app.dependencies.auth import get_current_user
from app.database import get_db_session, AsyncSession
from app.services import workspace_service

router = APIRouter()

@router.get("/workspaces", status_code=200, response_model=list[WorkspaceListResponse], tags=["workspaces"])
async def get_workspaces(current_user: dict[str,str] = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db_session)
                         ) -> list[WorkspaceListResponse]:
    return await workspace_service.get_workspaces(current_user, db)