from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db_session
from app.dependencies.auth import get_current_user
from app.dependencies.workspace import get_current_workspace
from app.dto import CreateExpenseRequestDTO, ExpenseResponseDTO, ReviewExpenseRequestDTO
from app.models import Workspace, Category
from app.models.category import CategoryType
from app.dto import CategoryResponseDTO
from app.services.workspace_access import get_workspace_membership
from sqlalchemy import select
from app.services import expense_service


router = APIRouter(prefix='/expenses', tags=['Expenses'])


@router.post('', status_code=201, response_model=ExpenseResponseDTO)
async def create_expense(request: CreateExpenseRequestDTO, workspace: Workspace = Depends(get_current_workspace), current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db_session)):
    return await expense_service.create_expense(request, workspace.workspace_id, current_user, db)


@router.get('', response_model=list[ExpenseResponseDTO])
async def get_expenses(workspace: Workspace = Depends(get_current_workspace), current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db_session)):
    return await expense_service.get_expenses(workspace.workspace_id, current_user, db)


@router.get('/categories', response_model=list[CategoryResponseDTO])
async def get_expense_categories(workspace: Workspace = Depends(get_current_workspace), current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db_session)):
    # Expense submission needs a read-only category catalog for employees too.
    await get_workspace_membership(current_user, workspace.workspace_id, db)
    rows = await db.scalars(select(Category).where(
        Category.workspace_id == workspace.workspace_id,
        Category.type == CategoryType.expense,
    ).order_by(Category.name))
    return [CategoryResponseDTO(category_id=row.category_id, workspace_id=row.workspace_id, name=row.name, type=row.type) for row in rows]


@router.get('/{expense_id}', response_model=ExpenseResponseDTO)
async def get_expense(expense_id: int, workspace: Workspace = Depends(get_current_workspace), current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db_session)):
    return await expense_service.get_expense_by_id(expense_id, workspace.workspace_id, current_user, db)


@router.put('/{expense_id}', response_model=ExpenseResponseDTO)
async def update_expense(expense_id: int, request: CreateExpenseRequestDTO, workspace: Workspace = Depends(get_current_workspace), current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db_session)):
    return await expense_service.update_expense(expense_id, request, workspace.workspace_id, current_user, db)


@router.delete('/{expense_id}', status_code=204)
async def delete_expense(expense_id: int, workspace: Workspace = Depends(get_current_workspace), current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db_session)) -> None:
    await expense_service.delete_expense(expense_id, workspace.workspace_id, current_user, db)


@router.post('/{expense_id}/review', response_model=ExpenseResponseDTO, summary='Approve or reject a pending expense (owner only)')
async def review_expense(expense_id: int, request: ReviewExpenseRequestDTO, workspace: Workspace = Depends(get_current_workspace), current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db_session)):
    return await expense_service.review_expense(expense_id, request.approve, request.account_id, workspace.workspace_id, current_user, db)
