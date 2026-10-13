from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import select, update
from app.database import AsyncSession
from app.models import Expense, Workspace, WorkspaceUsers, WorkspaceRole, Category
from app.models.category import CategoryType
from app.models.expenses import ExpenseStatusEnum
from app.dto import ExpenseResponseDTO, CreateExpenseRequestDTO, CreateTransactionRequest
from app.services.workspace_access import get_workspace_membership, assert_department_access
from app.services.project_service import assert_project_access, load_project
from app.services import transaction_service


def expense_response(expense: Expense) -> ExpenseResponseDTO:
    return ExpenseResponseDTO(
        id=expense.expense_id, amount=expense.amount, currency=expense.currency,
        workspace_id=expense.workspace_id, department_id=expense.department_id,
        project_id=expense.project_id, category_id=expense.category_id,
        status=expense.status, description=expense.description,
        receipt_url=expense.receipt_url, submitted_by=expense.submitted_by,
        created_at=expense.created_at, updated_at=expense.updated_at,
        reviewed_at=expense.reviewed_at, reviewed_by=expense.reviewed_by,
    )


async def validate_expense_fields(request: CreateExpenseRequestDTO, workspace_id: int,
                                  membership: WorkspaceUsers, db: AsyncSession) -> dict:
    # Employees submit in their assigned department; owners may choose a department.
    department_id = request.department_id
    if membership.role != WorkspaceRole.OWNER:
        if department_id is not None:
            assert_department_access(membership, department_id)
        department_id = membership.department_id
    if department_id is not None:
        await transaction_service.find_department_by_id(department_id, await db.get(Workspace, workspace_id), db)
    if request.project_id is not None:
        project = await load_project(request.project_id, db)
        if project.workspace_id != workspace_id:
            raise HTTPException(status_code=400, detail='Project must belong to this workspace')
        assert_project_access(project, membership)
        if department_id is not None and not any(d.department_id == department_id for d in project.departments):
            raise HTTPException(status_code=400, detail='Project is not linked to this department')
    category = await db.get(Category, request.category_id)
    if category is None:
        raise HTTPException(status_code=404, detail='Category not found')
    if category.workspace_id != workspace_id:
        raise HTTPException(status_code=400, detail='Category must belong to this workspace')
    if category.type != CategoryType.expense:
        raise HTTPException(status_code=400, detail='An expense category is required')
    data = request.model_dump()
    data['department_id'] = department_id
    return data


async def create_expense(request: CreateExpenseRequestDTO, workspace_id: int, current_user: dict, db: AsyncSession) -> ExpenseResponseDTO:
    membership = await get_workspace_membership(current_user, workspace_id, db)
    expense_data = await validate_expense_fields(request, workspace_id, membership, db)
    # The submitter and initial status come from the server, never from the request body.
    expense = Expense(**expense_data, workspace_id=workspace_id, submitted_by=membership.user_id)
    db.add(expense)
    await db.commit()
    await db.refresh(expense)
    return expense_response(expense)


def assert_expense_access(expense: Expense, membership: WorkspaceUsers) -> None:
    # Owners see all workspace requests; employees see only their own submissions.
    if membership.role != WorkspaceRole.OWNER and expense.submitted_by != membership.user_id:
        raise HTTPException(status_code=403, detail='No access to this expense')


async def load_expense(expense_id: int, workspace_id: int, db: AsyncSession) -> Expense:
    expense = await db.scalar(select(Expense).where(
        Expense.expense_id == expense_id, Expense.workspace_id == workspace_id,
    ).execution_options(populate_existing=True))
    if expense is None:
        raise HTTPException(status_code=404, detail='Expense not found')
    return expense


def assert_pending(expense: Expense) -> None:
    # Reviewed requests keep their original details and financial history.
    if expense.status != ExpenseStatusEnum.PENDING:
        raise HTTPException(status_code=409, detail='Only pending expenses can be changed or reviewed')


async def get_expense_by_id(expense_id: int, workspace_id: int, current_user: dict, db: AsyncSession) -> ExpenseResponseDTO:
    membership = await get_workspace_membership(current_user, workspace_id, db)
    expense = await load_expense(expense_id, workspace_id, db)
    assert_expense_access(expense, membership)
    return expense_response(expense)


async def get_expenses(workspace_id: int, current_user: dict, db: AsyncSession) -> list[ExpenseResponseDTO]:
    membership = await get_workspace_membership(current_user, workspace_id, db)
    stmt = select(Expense).where(Expense.workspace_id == workspace_id).order_by(Expense.expense_id)
    if membership.role != WorkspaceRole.OWNER:
        stmt = stmt.where(Expense.submitted_by == membership.user_id)
    expenses = (await db.scalars(stmt.execution_options(populate_existing=True))).all()
    return [expense_response(expense) for expense in expenses]


async def update_expense(expense_id: int, request: CreateExpenseRequestDTO, workspace_id: int, current_user: dict, db: AsyncSession) -> ExpenseResponseDTO:
    membership = await get_workspace_membership(current_user, workspace_id, db)
    expense = await load_expense(expense_id, workspace_id, db)
    assert_expense_access(expense, membership)
    assert_pending(expense)
    expense_data = await validate_expense_fields(request, workspace_id, membership, db)
    # Only update a still-pending row, even if a reviewer acted during validation.
    result = await db.execute(update(Expense).where(
        Expense.expense_id == expense_id, Expense.workspace_id == workspace_id,
        Expense.status == ExpenseStatusEnum.PENDING,
    ).values(**expense_data, updated_at=datetime.now()).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        await db.rollback()
        raise HTTPException(status_code=409, detail='Expense was already reviewed')
    await db.commit()
    await db.refresh(expense)
    return expense_response(expense)


async def delete_expense(expense_id: int, workspace_id: int, current_user: dict, db: AsyncSession) -> None:
    membership = await get_workspace_membership(current_user, workspace_id, db)
    expense = await load_expense(expense_id, workspace_id, db)
    assert_expense_access(expense, membership)
    assert_pending(expense)
    # Lock the pending row against concurrent review before removing it through the ORM.
    result = await db.execute(update(Expense).where(
        Expense.expense_id == expense_id, Expense.workspace_id == workspace_id,
        Expense.status == ExpenseStatusEnum.PENDING,
    ).values(updated_at=datetime.now()).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        await db.rollback()
        raise HTTPException(status_code=409, detail='Expense was already reviewed')
    await db.delete(expense)
    await db.commit()


async def review_expense(expense_id: int, approve: bool, account_id: int | None, workspace_id: int, current_user: dict, db: AsyncSession) -> ExpenseResponseDTO:
    membership = await get_workspace_membership(current_user, workspace_id, db, owner_only=True)
    expense = await load_expense(expense_id, workspace_id, db)
    assert_pending(expense)
    if approve and account_id is None:
        raise HTTPException(status_code=400, detail='Approval requires an account')
    now = datetime.now()
    status = ExpenseStatusEnum.APPROVED if approve else ExpenseStatusEnum.REJECTED
    try:
        # Claim the pending request once so concurrent reviews cannot create two transactions.
        result = await db.execute(update(Expense).where(
            Expense.expense_id == expense_id, Expense.workspace_id == workspace_id,
            Expense.status == ExpenseStatusEnum.PENDING,
        ).values(status=status, reviewed_by=membership.user_id, reviewed_at=now, updated_at=now)
          .execution_options(synchronize_session=False))
        if result.rowcount != 1:
            raise HTTPException(status_code=409, detail='Expense was already reviewed')
        await db.refresh(expense)
        if approve:
            # Recheck links in case a department, project or category changed after submission.
            await validate_expense_fields(CreateExpenseRequestDTO(
                department_id=expense.department_id, project_id=expense.project_id,
                category_id=expense.category_id, amount=expense.amount,
                currency=expense.currency, description=expense.description, receipt_url=expense.receipt_url,
            ), workspace_id, membership, db)
            transaction_request = CreateTransactionRequest(
                amount=expense.amount, description=expense.description, currency=expense.currency,
                category_id=expense.category_id, project_id=expense.project_id,
                expense_id=expense.expense_id, department_id=expense.department_id, account_id=account_id,
            )
            # One commit saves the review, transaction and account balance together.
            await transaction_service.create_transaction(
                transaction_request, current_user, await db.get(Workspace, workspace_id), db, commit=False,
            )
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    await db.refresh(expense)
    return expense_response(expense)
