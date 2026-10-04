from fastapi import Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.database import AsyncSession
from app.dto import CreateTransactionRequest
from app.models import Workspace, Transaction, Category, Account
from app.models.transaction import TransactionSourceEnum
from app.models.workspace import WorkspaceTypeEnum
from app.models.category import CategoryType

async def create_transaction(request: CreateTransactionRequest,
                             current_user: dict[str,str],
                             db: AsyncSession
                             ):

    current_user_id =  current_user.get("sub")
    if current_user_id: # parse id into a number
        current_user_id = int(current_user_id)
    workspace_stmt = (select(Workspace)
                      .options(selectinload(Workspace.memberships)) # preload
                      .where(Workspace.workspace_id == request.workspace_id)
                      )
    print(workspace_stmt)
    workspace_result = await db.execute(workspace_stmt)
    # based on a workspace type we create transaction with different fields
    workspace = workspace_result.scalar_one_or_none()

    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # check if user is a member of the workspace
    if not any(m.user_id == current_user_id for m in workspace.memberships):
        raise HTTPException(status_code=403, detail="User is not a member of the workspace")

    if request.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")

    category_stmt = select(Category).where(Category.category_id == request.category_id)
    category_result = await db.execute(category_stmt)
    category = category_result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    if len(request.description.strip()) == 0:
        raise HTTPException(status_code=400, detail="Description must not be empty")

    account_stmt = select(Account).where(Account.account_id == request.account_id)
    account_result = await db.execute(account_stmt)
    account = account_result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    if workspace.type == WorkspaceTypeEnum.PERSONAL:
        transaction = Transaction(
            amount=request.amount,
            currency=request.currency,
            description=request.description,
            source=TransactionSourceEnum.MANUAL,
            account_id=request.account_id,
            category_id=request.category_id,
            workspace_id=workspace.workspace_id
        )
        db.add(transaction)

        if category.type == CategoryType.income:
            account.balance += request.amount
        else:
            account.balance -= request.amount

        await db.commit()
        await db.refresh(transaction)
        return transaction
    raise HTTPException(status_code=400, detail="Invalid workspace type")

