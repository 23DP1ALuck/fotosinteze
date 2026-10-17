from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import get_current_user
from app.database import get_db_session
from app.dependencies.workspace import get_current_workspace
from app.dto.dashboard_response import DashboardResponse, BusinessDashboardResponse
from app.models import Workspace
from app.models.workspace import WorkspaceTypeEnum
from app.services import dashboard_service

router = APIRouter(tags=['dashboard'])


@router.get('/dashboard', response_model=DashboardResponse | BusinessDashboardResponse,
            summary='Workspace financial summary for the current month',
            responses={401: {'description': 'Authentication required'},
                       403: {'description': 'No workspace access'},
                       422: {'description': 'Missing or invalid Workspace-ID header'}})
async def get_dashboard(
    workspace: Workspace = Depends(get_current_workspace),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> DashboardResponse | BusinessDashboardResponse:
    if workspace.type == WorkspaceTypeEnum.PERSONAL:
        return await dashboard_service.get_dashboard(workspace, db)
    return await dashboard_service.get_business_dashboard(workspace, current_user, db)
