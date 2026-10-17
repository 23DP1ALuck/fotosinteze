from fastapi import HTTPException
from sqlalchemy import select
from app.models import Account, Workspace
from app.models.workspace import WorkspaceTypeEnum
from app.dto import CreateAccountRequest, CreateAccountResponse
from app.dto.update_account_request import UpdateAccountRequest
from app.database import AsyncSession
from app.services.workspace_access import get_workspace_membership


async def authorize_accounts(current_user: dict, workspace: Workspace, db: AsyncSession, owner: bool) -> None:
    if workspace.type == WorkspaceTypeEnum.BUSINESS:
        await get_workspace_membership(current_user, workspace.workspace_id, db, owner_only=owner)


async def get_accounts(current_user: dict, workspace: Workspace, db: AsyncSession) -> list[CreateAccountResponse]:
    await authorize_accounts(current_user, workspace, db, owner=False)
    accounts = (await db.scalars(select(Account).where(
        Account.workspace_id == workspace.workspace_id
    ).order_by(Account.account_id))).all()
    return [CreateAccountResponse.model_validate(account) for account in accounts]


async def get_account(account_id: int, current_user: dict, workspace: Workspace, db: AsyncSession) -> Account:
    await authorize_accounts(current_user, workspace, db, owner=False)
    account = await db.scalar(select(Account).where(
        Account.account_id == account_id, Account.workspace_id == workspace.workspace_id
    ))
    if account is None:
        raise HTTPException(status_code=404, detail='Account not found')
    return account


async def check_name(name: str, workspace_id: int, db: AsyncSession, account_id: int | None = None) -> None:
    duplicate = await db.scalar(select(Account.account_id).where(
        Account.workspace_id == workspace_id, Account.name == name,
        Account.account_id != account_id if account_id is not None else True,
    ).limit(1))
    if duplicate is not None:
        raise HTTPException(status_code=409, detail='Account name is already taken in this workspace')


async def create_account(request: CreateAccountRequest, current_user: dict,
                         active_workspace: Workspace, db: AsyncSession) -> CreateAccountResponse:
    await authorize_accounts(current_user, active_workspace, db, owner=True)
    await check_name(request.name, active_workspace.workspace_id, db)
    account = Account(**request.model_dump(), workspace_id=active_workspace.workspace_id)
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return CreateAccountResponse.model_validate(account)


async def update_account(account_id: int, request: UpdateAccountRequest, current_user: dict,
                         workspace: Workspace, db: AsyncSession) -> CreateAccountResponse:
    account = await get_account(account_id, current_user, workspace, db)
    fields = request.model_dump(exclude_unset=True)
    if 'balance' in fields and account.connection_id is not None:
        raise HTTPException(status_code=409, detail='Connected account balances are managed by bank sync')
    if 'name' in fields:
        await check_name(request.name, workspace.workspace_id, db, account_id)
    for field, value in fields.items():
        setattr(account, field, value)
    await db.commit()
    await db.refresh(account)
    return CreateAccountResponse.model_validate(account)
