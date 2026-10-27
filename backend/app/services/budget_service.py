from datetime import date, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func, select

from app.database import AsyncSession
from app.services.name_uniqueness import check_unique_name
from app.services.budget_category_uniqueness import check_budget_category
from app.dto import BudgetResponseDTO, CreateBudgetRequest
from app.models import Budget, BudgetPeriod, Category, Transaction, Workspace
from app.models.category import CategoryType
from app.models.workspace import WorkspaceTypeEnum
from app.services.transaction_service import validate_business_assignments
from app.services.workspace_access import get_workspace_membership


def calculate_budget_period_bounds(start: date, period_type: BudgetPeriod, length_days: int | None = None) -> date:
    match period_type:
        case BudgetPeriod.CUSTOM:
            if length_days is None or length_days <= 0:
                raise HTTPException(status_code=400, detail="Length days must be a positive integer")
            return start + timedelta(days=length_days)
        case BudgetPeriod.MONTHLY:
            # Day 28 plus four days always reaches the next month, even in February.
            next_month = start.replace(day=28) + timedelta(days=4)
            return next_month.replace(day=1)
        case BudgetPeriod.WEEKLY:
            return start + timedelta(days=7)
        case _:
            raise HTTPException(status_code=400, detail="Unsupported budget period type")


async def assert_budget_access(current_user: dict, workspace: Workspace, db: AsyncSession) -> None:
    # Workspace membership is checked by the route; business budgets also require an owner.
    if workspace.type == WorkspaceTypeEnum.BUSINESS:
        await get_workspace_membership(current_user, workspace.workspace_id, db, owner_only=True)


async def budget_response(budget: Budget, db: AsyncSession) -> BudgetResponseDTO:
    end : date = calculate_budget_period_bounds(budget.period_start, budget.period_length, budget.duration_days)
    stmt = select(func.coalesce(func.sum(Transaction.amount), 0)).join(Category, Transaction.category_id == Category.category_id).where(
        Transaction.workspace_id == budget.workspace_id,
        Transaction.created_at >= budget.period_start,
        Transaction.created_at < end,
        Transaction.currency == budget.currency,
        Category.type == CategoryType.expense,
    )
    # add to select statement filters from budget
    for field in ("category_id", "project_id", "department_id"):
        value = getattr(budget, field)
        if value is not None:
            stmt = stmt.where(getattr(Transaction, field) == value)
    response = BudgetResponseDTO.model_validate(budget)
    response.current_spent = await db.scalar(stmt)
    return response


async def load_budget(budget_id: int, workspace: Workspace, db: AsyncSession) -> Budget:
    # Scope direct-ID requests too, so another workspace's budget is never exposed.
    budget = await db.scalar(select(Budget).where(
        Budget.budget_id == budget_id,
        Budget.workspace_id == workspace.workspace_id,
    ))
    if budget is None:
        raise HTTPException(status_code=404, detail="Budget not found")
    return budget


async def validate_budget_fields(request: CreateBudgetRequest, current_user: dict,
                                 workspace: Workspace, db: AsyncSession) -> None:
    # Reject date overflow before committing a budget that cannot be displayed.
    try:
        calculate_budget_period_bounds(request.period_start, request.period_length, request.duration_days)
    except (OverflowError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid budget period bounds") from exc
    if request.category_id is not None:
        category = await db.get(Category, request.category_id)
        if category is None:
            raise HTTPException(status_code=404, detail="Category not found")
        if category.workspace_id not in (None, workspace.workspace_id):
            raise HTTPException(status_code=400, detail="Category does not belong to this workspace")
        if category.type != CategoryType.expense:
            raise HTTPException(status_code=400, detail="Budgets require an expense category")
    if workspace.type == WorkspaceTypeEnum.PERSONAL:
        if request.project_id is not None or request.department_id is not None:
            raise HTTPException(status_code=400, detail="Departments and projects require a business workspace")
    else:
        membership = await get_workspace_membership(current_user, workspace.workspace_id, db, owner_only=True)
        # Reuse transaction rules to check workspace ownership and project/department links.
        await validate_business_assignments(request.department_id, request.project_id, None,
                                            workspace, membership, db)


async def get_budgets(current_user: dict, workspace: Workspace, db: AsyncSession) -> list[BudgetResponseDTO]:
    await assert_budget_access(current_user, workspace, db)
    budgets = (await db.scalars(select(Budget).where(
        Budget.workspace_id == workspace.workspace_id,
    ).order_by(Budget.budget_id))).all()
    return [await budget_response(budget, db) for budget in budgets]


async def get_budget_by_id(budget_id: int, current_user: dict, workspace: Workspace,
                           db: AsyncSession) -> BudgetResponseDTO:
    await assert_budget_access(current_user, workspace, db)
    return await budget_response(await load_budget(budget_id, workspace, db), db)


async def create_budget(request: CreateBudgetRequest, current_user: dict, workspace: Workspace,
                        db: AsyncSession) -> BudgetResponseDTO:
    await assert_budget_access(current_user, workspace, db)
    await validate_budget_fields(request, current_user, workspace, db)
    await check_budget_category(workspace.workspace_id, request.category_id, db)
    await check_unique_name(db, Budget.name, request.name, Budget.workspace_id == workspace.workspace_id,
        detail='Budget name is already taken in this workspace')
    budget = Budget(**request.model_dump(), workspace_id=workspace.workspace_id)
    db.add(budget)
    await db.commit()
    await db.refresh(budget)
    return await budget_response(budget, db)


async def update_budget(budget_id: int, request: CreateBudgetRequest, current_user: dict,
                        workspace: Workspace, db: AsyncSession) -> BudgetResponseDTO:
    await assert_budget_access(current_user, workspace, db)
    budget = await load_budget(budget_id, workspace, db)
    await validate_budget_fields(request, current_user, workspace, db)
    await check_budget_category(workspace.workspace_id, request.category_id, db, budget_id)
    await check_unique_name(db, Budget.name, request.name,
        Budget.workspace_id == workspace.workspace_id, Budget.budget_id != budget_id,
        detail='Budget name is already taken in this workspace')
    # PUT replaces all editable fields; omitted optional targets are cleared.
    for field, value in request.model_dump().items():
        setattr(budget, field, value)
    budget.updated_at = datetime.now()
    await db.commit()
    await db.refresh(budget)
    return await budget_response(budget, db)


async def delete_budget(budget_id: int, current_user: dict, workspace: Workspace, db: AsyncSession) -> None:
    await assert_budget_access(current_user, workspace, db)
    budget = await load_budget(budget_id, workspace, db)
    await db.delete(budget)
    await db.commit()
