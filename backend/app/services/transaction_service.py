from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import AsyncSession
from app.dto import CreateTransactionRequest, TransactionResponseDTO, TransactionListResponseDTO
from app.models import Workspace, Transaction, Category, Account, Project, Department, Expense, WorkspaceRole, WorkspaceUsers
from app.models.transaction import TransactionSourceEnum
from app.models.workspace import WorkspaceTypeEnum
from app.models.category import CategoryType
from app.models.expenses import ExpenseStatusEnum
from app.services.workspace_access import get_workspace_membership, assert_department_access
from app.services.project_service import load_project, assert_project_access

async def create_transaction(request: CreateTransactionRequest,
                             current_user: dict[str,str],
                             active_workspace: Workspace,
                             db: AsyncSession,
                             *, commit: bool = True
                             ) -> TransactionResponseDTO:
        

    # Validate the request before creating a transaction or changing the balance.
    if request.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")
    # Expense-linked transactions are created only inside the atomic review workflow.
    if request.expense_id is not None and commit:
        raise HTTPException(status_code=400, detail="Create expense transactions through expense review")

    category_stmt = select(Category).where(Category.category_id == request.category_id)
    category_result = await db.execute(category_stmt)
    category = category_result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    if len(request.description.strip()) == 0:
        raise HTTPException(status_code=400, detail="Description must not be empty")

    # The selected account must belong to the active workspace.
    account_stmt = (select(Account)
                    .where(Account.account_id == request.account_id)
                    .where(Account.workspace_id == active_workspace.workspace_id))
    # Approval holds the account row until its surrounding review transaction commits.
    if not commit:
        account_stmt = account_stmt.with_for_update()
    account_result = await db.execute(account_stmt)
    account = account_result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if not commit and account.currency != request.currency:
        raise HTTPException(status_code=400, detail="Expense and account currencies must match")

    if active_workspace.type == WorkspaceTypeEnum.PERSONAL:
        transaction = Transaction(
            amount=request.amount,
            currency=request.currency,
            description=request.description,
            source=TransactionSourceEnum.MANUAL,
            account_id=request.account_id,
            category_id=request.category_id,
            workspace_id=active_workspace.workspace_id
        )
        db.add(transaction)

        # Bank sync owns connected balances; local entries affect manual accounts only.
        if account.connection_id is None and category.type == CategoryType.income:
            account.balance += request.amount
        elif account.connection_id is None:
            account.balance -= request.amount
        
        await db.commit()
        await db.refresh(transaction)
        return transaction_response(transaction)
    elif active_workspace.type == WorkspaceTypeEnum.BUSINESS:
        # Check business membership and related records before saving or changing the balance.
        membership = await get_workspace_membership(current_user, active_workspace.workspace_id, db)
        if category.workspace_id != active_workspace.workspace_id:
            raise HTTPException(status_code=400, detail="Category must belong to this workspace")
        department_id = await validate_business_assignments(
            request.department_id, request.project_id, request.expense_id,
            active_workspace, membership, db,
        )
        # Use the validated department, including the employee's default assignment.
        transaction_data = request.model_dump(exclude_unset=True)
        transaction_data['department_id'] = department_id
        transaction = Transaction(**transaction_data,
                                  workspace_id=active_workspace.workspace_id,
                                  source=TransactionSourceEnum.EXPENSE)
        db.add(transaction)
        if account.connection_id is None and category.type == CategoryType.income:
            account.balance += request.amount
        elif account.connection_id is None:
            account.balance -= request.amount
        
        if commit:
            await db.commit()
            await db.refresh(transaction)
        else:
            await db.flush()
        return transaction_response(transaction)

    raise HTTPException(status_code=400, detail="Invalid workspace type")


async def update_transaction(transaction_id: int,
                             request: CreateTransactionRequest,
                             current_user: dict[str, str],
                             active_workspace: Workspace,
                             db: AsyncSession) -> TransactionResponseDTO:

    transaction = await find_transaction_by_id(transaction_id, active_workspace, db)
    membership = await authorize_transaction(transaction, current_user, active_workspace, db)
    if transaction.expense_id is not None:
        raise HTTPException(status_code=409, detail="Approved expense transactions cannot be edited")
    if request.expense_id is not None:
        raise HTTPException(status_code=400, detail="Link expense transactions through expense review")

    # Finish validation before changing the transaction or either account balance.
    if request.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")
    if not request.description.strip():
        raise HTTPException(status_code=400, detail="Description must not be empty")
    if active_workspace.type not in (WorkspaceTypeEnum.PERSONAL, WorkspaceTypeEnum.BUSINESS):
        raise HTTPException(status_code=400, detail="Invalid workspace type")

    category = await db.get(Category, request.category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")
    account = await find_account_by_id(request.account_id, active_workspace, db)

    # Finish business access checks before changing either account balance.
    if active_workspace.type == WorkspaceTypeEnum.BUSINESS:
        if category.workspace_id != active_workspace.workspace_id:
            raise HTTPException(status_code=400, detail="Category must belong to this workspace")
        department_id = await validate_business_assignments(
            request.department_id, request.project_id, request.expense_id,
            active_workspace, membership, db,
        )

    old_account = await find_account_by_id(transaction.account_id, active_workspace, db)
    old_category = await db.get(Category, transaction.category_id) if transaction.category_id is not None else None
    # income adds to the balance; expenses subtract
    old_effect = transaction.amount if old_category and old_category.type == CategoryType.income else -transaction.amount
    new_effect = request.amount if category.type == CategoryType.income else -request.amount

    # undo the original entry, then apply its replacement, even if the account changed.
    if old_account.connection_id is None:
        old_account.balance -= old_effect
    if account.connection_id is None:
        account.balance += new_effect
    for field in ("amount", "description", "currency", "account_id", "category_id"):
        setattr(transaction, field, getattr(request, field))
    # Full updates clear optional references; employees retain their assigned department.
    if active_workspace.type == WorkspaceTypeEnum.BUSINESS:
        for field in ("project_id", "expense_id"):
            setattr(transaction, field, getattr(request, field))
        transaction.department_id = department_id
    transaction.updated_at = datetime.now()

    await db.commit()
    await db.refresh(transaction)
    return transaction_response(transaction)


async def delete_transaction(transaction_id: int,
                             current_user: dict[str, str],
                             active_workspace: Workspace,
                             db: AsyncSession) -> None:

    transaction = await find_transaction_by_id(transaction_id, active_workspace, db)
    await authorize_transaction(transaction, current_user, active_workspace, db)
    if transaction.expense_id is not None:
        raise HTTPException(status_code=409, detail="Approved expense transactions cannot be deleted")
    account = await find_account_by_id(transaction.account_id, active_workspace, db)
    category = await db.get(Category, transaction.category_id) if transaction.category_id is not None else None
    effect = transaction.amount if category and category.type == CategoryType.income else -transaction.amount

    # Reverse the entry's balance effect before deleting it in the same commit.
    if account.connection_id is None:
        account.balance -= effect
    await db.delete(transaction)
    await db.commit()


def transaction_response(transaction: Transaction) -> TransactionResponseDTO:
    return TransactionResponseDTO(
        transaction_id=transaction.transaction_id,
        amount=transaction.amount,
        currency=transaction.currency,
        description=transaction.description,
        source=transaction.source,
        account_id=transaction.account_id,
        category_id=transaction.category_id,
        project_id=transaction.project_id,
        department_id=transaction.department_id,
        expense_id=transaction.expense_id,
        workspace_id=transaction.workspace_id,
        created_at=transaction.created_at,
        updated_at=transaction.updated_at,
    )


async def get_transaction_by_id(transaction_id: int, current_user: dict,
                                workspace: Workspace, db: AsyncSession) -> TransactionResponseDTO:
    transaction = await find_transaction_by_id(transaction_id, workspace, db)
    await authorize_transaction(transaction, current_user, workspace, db)
    return transaction_response(transaction)


async def get_transactions(workspace: Workspace, current_user: dict, db: AsyncSession,
                           *, limit: int = 50, offset: int = 0) -> TransactionListResponseDTO:
    stmt = select(Transaction).where(Transaction.workspace_id == workspace.workspace_id)
    if workspace.type == WorkspaceTypeEnum.BUSINESS:
        membership = await get_workspace_membership(current_user, workspace.workspace_id, db)
        if membership.role != WorkspaceRole.OWNER:
            stmt = stmt.where(Transaction.department_id == membership.department_id)
    # shortcut: offsets can shift during concurrent inserts; use cursors if stable traversal is needed.
    result = await db.execute(
        stmt.order_by(Transaction.created_at.desc(), Transaction.transaction_id.desc())
        .offset(offset).limit(limit + 1)
    )
    transactions = result.scalars().all()
    return TransactionListResponseDTO(
        items=[transaction_response(transaction) for transaction in transactions[:limit]],
        limit=limit, offset=offset, has_more=len(transactions) > limit,
    )

async def find_transaction_by_id(transaction_id: int, workspace: Workspace, db: AsyncSession) -> Transaction:
    # Scope the lookup to the active workspace, even when the transaction ID exists elsewhere.
    result = await db.execute(
        select(Transaction).where(
            Transaction.transaction_id == transaction_id,
            Transaction.workspace_id == workspace.workspace_id,
        )
    )
    transaction = result.scalar_one_or_none()
    if transaction is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return transaction


async def find_account_by_id(account_id: int, workspace: Workspace, db: AsyncSession) -> Account:
    # Prevent balance updates to an account in another workspace.
    result = await db.execute(
        select(Account).where(
            Account.account_id == account_id,
            Account.workspace_id == workspace.workspace_id,
        )
    )
    account = result.scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


async def find_department_by_id(department_id: int, workspace: Workspace, db: AsyncSession) -> Department:
    department_stmt = (select(Department)
                       .where(Department.department_id == department_id)
                       .where(Department.workspace_id == workspace.workspace_id)
                       )
    department_result = await db.execute(department_stmt)
    department = department_result.scalar_one_or_none()
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")
    return department

async def find_project_by_id(project_id: int,workspace: Workspace, preload_department: bool, db: AsyncSession) -> Project:
    project_stmt = (select(Project).where(Project.project_id == project_id)
                    .where(Project.workspace_id == workspace.workspace_id))
    # Load department links only when the caller needs them for validation.
    if preload_department:
        project_stmt = project_stmt.options(selectinload(Project.departments))
    project_result = await db.execute(project_stmt)
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def validate_business_assignments(department_id: int | None, project_id: int | None, expense_id: int | None,
                                        workspace: Workspace, membership: WorkspaceUsers, db: AsyncSession) -> int | None:
    # Employees use their assigned department when the request omits it.
    if membership.role != WorkspaceRole.OWNER and department_id is None:
        department_id = membership.department_id
    if department_id is not None:
        assert_department_access(membership, department_id)
        await find_department_by_id(department_id, workspace, db)
    if project_id is not None:
        # A shared project must be accessible and linked to the selected department.
        project = await load_project(project_id, db)
        if project.workspace_id != workspace.workspace_id:
            raise HTTPException(status_code=400, detail="Project does not belong to this workspace")
        assert_project_access(project, membership)
        if department_id is not None and not any(d.department_id == department_id for d in project.departments):
            raise HTTPException(status_code=400, detail="Project is not linked to this department")
    if expense_id is not None:
        # Expenses must belong to this workspace and, for employees, their department.
        expense = await db.get(Expense, expense_id)
        if expense is None:
            raise HTTPException(status_code=404, detail="Expense not found")
        if expense.workspace_id != workspace.workspace_id:
            raise HTTPException(status_code=400, detail="Expense does not belong to this workspace")
        if expense.status != ExpenseStatusEnum.APPROVED:
            raise HTTPException(status_code=400, detail="Only approved expenses can have transactions")
        if membership.role != WorkspaceRole.OWNER and expense.department_id != membership.department_id:
            raise HTTPException(status_code=403, detail="No access to this expense")
    return department_id


async def authorize_transaction(transaction: Transaction, current_user: dict,
                                workspace: Workspace, db: AsyncSession) -> WorkspaceUsers | None:
    # Personal workspace membership is checked by the route dependency.
    if workspace.type != WorkspaceTypeEnum.BUSINESS:
        return None
    membership = await get_workspace_membership(current_user, workspace.workspace_id, db)
    if membership.role != WorkspaceRole.OWNER:
        # A shared project does not grant access to another department's transactions.
        if transaction.department_id != membership.department_id:
            raise HTTPException(status_code=403, detail="No access to this transaction")
        await validate_business_assignments(transaction.department_id, transaction.project_id,
                                            transaction.expense_id, workspace, membership, db)
    return membership
