from fastapi import APIRouter, Depends, Response

from app.database import AsyncSession, get_db_session
from app.dependencies.auth import get_current_user
from app.dependencies.workspace import get_current_workspace
from app.dto import BudgetResponseDTO, CreateBudgetRequest
from app.models import Workspace
from app.services import budget_service

router = APIRouter(tags=["budgets"], responses={
    409: {"description": "Budget name or category already in use in this workspace"},
    401: {"description": "Missing, invalid or expired access token, invalid session, or user not found"},
    403: {"description": "No workspace access or business workspace owner required"},
    422: {"description": "Missing or invalid Workspace-ID header, path parameter or request fields"},
})
invalid_period = {400: {"description": "Unsupported budget period or invalid custom duration"}}
invalid_budget = {400: {"description": "Invalid period bounds, category must be an expense category in this workspace, and project/department links must belong to a business workspace and match"}}
not_found = {404: {"description": "Workspace or budget not found in the permitted workspace"}}
references_not_found = {404: {"description": "Workspace or referenced category, project or department not found"}}


@router.get("/budgets", response_model=list[BudgetResponseDTO],
            responses={**invalid_period, 404: {"description": "Business workspace not found"}})
async def get_budgets(
    current_user: dict = Depends(get_current_user),
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db_session),
) -> list[BudgetResponseDTO]:
    return await budget_service.get_budgets(current_user, workspace, db)


@router.post("/budgets", status_code=201, response_model=BudgetResponseDTO,
             responses={**invalid_budget, **references_not_found})
async def create_budget(
    request: CreateBudgetRequest,
    current_user: dict = Depends(get_current_user),
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db_session),
) -> BudgetResponseDTO:
    return await budget_service.create_budget(request, current_user, workspace, db)


@router.get("/budgets/{budget_id}", response_model=BudgetResponseDTO,
            responses={**invalid_period, **not_found})
async def get_budget_by_id(
    budget_id: int,
    current_user: dict = Depends(get_current_user),
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db_session),
) -> BudgetResponseDTO:
    return await budget_service.get_budget_by_id(budget_id, current_user, workspace, db)


@router.put("/budgets/{budget_id}", response_model=BudgetResponseDTO,
            responses={**invalid_budget, 404: {"description": "Workspace, budget or referenced category, project or department not found"}})
async def update_budget(
    budget_id: int,
    request: CreateBudgetRequest,
    current_user: dict = Depends(get_current_user),
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db_session),
) -> BudgetResponseDTO:
    return await budget_service.update_budget(budget_id, request, current_user, workspace, db)


@router.delete("/budgets/{budget_id}", status_code=204, responses=not_found)
async def delete_budget(
    budget_id: int,
    current_user: dict = Depends(get_current_user),
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    await budget_service.delete_budget(budget_id, current_user, workspace, db)
    return Response(status_code=204)
