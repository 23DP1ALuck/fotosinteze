from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import AsyncSession
from app.dto import CreateTransactionRequest
from app.models import Workspace, Transaction, Category, Account, Project, Department, WorkspaceUsers
from app.models.transaction import TransactionSourceEnum
from app.models.workspace import WorkspaceTypeEnum
from app.models.category import CategoryType

async def create_transaction(request: CreateTransactionRequest,
                             current_user: dict[str,str],
                             active_workspace: Workspace,
                             db: AsyncSession
                             ):

    current_user_id =  current_user.get("sub")
    if current_user_id: # parse id into a number
        current_user_id = int(current_user_id)

    if request.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")

    category_stmt = select(Category).where(Category.category_id == request.category_id)
    category_result = await db.execute(category_stmt)
    category = category_result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    if len(request.description.strip()) == 0:
        raise HTTPException(status_code=400, detail="Description must not be empty")

    account_stmt = (select(Account)
                    .where(Account.account_id == request.account_id)
                    .where(Account.workspace_id == active_workspace.workspace_id))
    account_result = await db.execute(account_stmt)
    account = account_result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

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

        if category.type == CategoryType.income:
            account.balance += request.amount
        else:
            account.balance -= request.amount

        await db.commit()
        await db.refresh(transaction)
        return transaction
    elif active_workspace.type == WorkspaceTypeEnum.BUSINESS:
        project = None
        department = None
        # if both project and department are provided validate membership
        if request.project_id and request.department_id:
            department = await find_department_by_id(request.department_id,active_workspace, db)
            project = await find_project_by_id(request.project_id,active_workspace, True, db)
            if project.department_id != department.department_id:
                raise HTTPException(status_code=404, detail="Project doesn't belong to this department")
        if request.project_id and not project: # check if project exists
            project = await find_project_by_id(request.project_id,active_workspace, False, db)

        if request.department_id and not department:
            department = await find_department_by_id(request.department_id,active_workspace, db)

        transaction_data = request.model_dump(exclude_unset=True)  # make an object from request data
        transaction = Transaction(**transaction_data,
                                  workspace_id=active_workspace.workspace_id,
                                  source=TransactionSourceEnum.EXPENSE)
        db.add(transaction)
        if category.type == CategoryType.income:
            account.balance += request.amount
        else:
            account.balance -= request.amount
        await db.commit()
        await db.refresh(transaction)
        return transaction

    raise HTTPException(status_code=400, detail="Invalid workspace type")


async def update_transaction(transaction_id: int,
                             request: CreateTransactionRequest,
                             current_user: dict[str, str],
                             active_workspace: Workspace,
                             db: AsyncSession) -> Transaction:

    transaction = await find_transaction_by_id(transaction_id, active_workspace, db)

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

    # business assignments must belong to this workspace and agree with each other
    if active_workspace.type == WorkspaceTypeEnum.BUSINESS:
        project = None
        department = None
        if request.department_id is not None:
            department = await find_department_by_id(request.department_id, active_workspace, db)
        if request.project_id is not None:
            project = await find_project_by_id(request.project_id, active_workspace, False, db)
        if project is not None and department is not None:
            if project.department_id != department.department_id:
                raise HTTPException(status_code=404, detail="Project doesn't belong to this department")

    old_account = await find_account_by_id(transaction.account_id, active_workspace, db)
    old_category = await db.get(Category, transaction.category_id) if transaction.category_id is not None else None
    # income adds to the balance; expenses subtract
    old_effect = transaction.amount if old_category and old_category.type == CategoryType.income else -transaction.amount
    new_effect = request.amount if category.type == CategoryType.income else -request.amount

    # undo the original entry, then apply its replacement, even if the account changed.
    old_account.balance -= old_effect
    account.balance += new_effect
    for field in ("amount", "description", "currency", "account_id", "category_id"):
        setattr(transaction, field, getattr(request, field))
    # Full updates also clear optional business assignments when their value is None.
    if active_workspace.type == WorkspaceTypeEnum.BUSINESS:
        for field in ("project_id", "department_id", "expense_id"):
            setattr(transaction, field, getattr(request, field))
    transaction.updated_at = datetime.now()

    await db.commit()
    await db.refresh(transaction)
    return transaction


async def delete_transaction(transaction_id: int,
                             current_user: dict[str, str],
                             active_workspace: Workspace,
                             db: AsyncSession) -> None:

    transaction = await find_transaction_by_id(transaction_id, active_workspace, db)
    account = await find_account_by_id(transaction.account_id, active_workspace, db)
    category = await db.get(Category, transaction.category_id) if transaction.category_id is not None else None
    effect = transaction.amount if category and category.type == CategoryType.income else -transaction.amount

    # Reverse the entry's balance effect before deleting it in the same commit.
    account.balance -= effect
    await db.delete(transaction)
    await db.commit()


async def find_transaction_by_id(transaction_id: int, workspace: Workspace, db: AsyncSession) -> Transaction:
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


#TODO: validate membership of project and department with active business workspace
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
    if preload_department:
        project_stmt = project_stmt.options(selectinload(Project.department))
    project_result = await db.execute(project_stmt)
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
