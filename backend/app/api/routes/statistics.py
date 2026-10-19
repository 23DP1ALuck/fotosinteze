from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db_session
from app.dependencies.auth import get_current_user
from app.dependencies.workspace import get_current_workspace
from app.dto.analytics_response import (
    AnalyticsCategoriesResponse, AnalyticsSummaryResponse, AnalyticsTimeseriesResponse,
)
from app.models import Workspace
from app.services import analytics_service

router = APIRouter(prefix='/statistics', tags=['statistics'], responses={
    400: {'description': 'Invalid date range'},
    401: {'description': 'Authentication required'},
    403: {'description': 'No workspace access or valid employee department assignment'},
    422: {'description': 'Missing or invalid dates or Workspace-ID header'},
})


@router.get('/summary', response_model=AnalyticsSummaryResponse,
            summary='Income and expense totals for the selected inclusive dates')
async def get_summary(
    date_from: date = Query(description='Inclusive transaction creation date'),
    date_to: date = Query(description='Inclusive transaction creation date'),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AnalyticsSummaryResponse:
    return await analytics_service.get_summary(workspace, current_user, db, date_from, date_to)


@router.get('/categories', response_model=AnalyticsCategoriesResponse,
            summary='Expense totals by category for the selected inclusive dates')
async def get_categories(
    date_from: date = Query(description='Inclusive transaction creation date'),
    date_to: date = Query(description='Inclusive transaction creation date'),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AnalyticsCategoriesResponse:
    return await analytics_service.get_categories(workspace, current_user, db, date_from, date_to)


@router.get('/timeseries', response_model=AnalyticsTimeseriesResponse,
            summary='Daily expense totals including zero days, limited to 3660 inclusive days')
async def get_timeseries(
    date_from: date = Query(description='Inclusive transaction creation date'),
    date_to: date = Query(description='Inclusive transaction creation date'),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AnalyticsTimeseriesResponse:
    return await analytics_service.get_timeseries(workspace, current_user, db, date_from, date_to)
