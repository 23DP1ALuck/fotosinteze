from fastapi import HTTPException
from sqlalchemy import delete, select, update
from app.models import Account, Workspace
from app.models.workspace import WorkspaceTypeEnum
from app.dto import CreateAccountRequest, CreateAccountResponse
from app.dto.update_account_request import UpdateAccountRequest
from app.database import AsyncSession
from app.services.name_uniqueness import check_unique_name
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
    await check_unique_name(db, Account.name, name,
        Account.workspace_id == workspace_id,
        Account.account_id != account_id if account_id is not None else True,
        detail='Account name is already taken in this workspace')


async def create_account(request: CreateAccountRequest, current_user: dict,
                         active_workspace: Workspace, db: AsyncSession) -> CreateAccountResponse:
    await authorize_accounts(current_user, active_workspace, db, owner=True)
    await lock_main_accounts(active_workspace.workspace_id, db)
    await check_name(request.name, active_workspace.workspace_id, db)
    existing_account_id = await db.scalar(select(Account.account_id).where(
        Account.workspace_id == active_workspace.workspace_id
    ).limit(1))
    fields = request.model_dump()
    fields['is_main'] = request.is_main or existing_account_id is None
    if fields['is_main']:
        await clear_main_account(active_workspace.workspace_id, db)
    account = Account(**fields, workspace_id=active_workspace.workspace_id)
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return CreateAccountResponse.model_validate(account)


async def update_account(account_id: int, request: UpdateAccountRequest, current_user: dict,
                         workspace: Workspace, db: AsyncSession) -> CreateAccountResponse:
    await authorize_accounts(current_user, workspace, db, owner=True)
    fields = request.model_dump(exclude_unset=True)
    if 'is_main' in fields:
        await lock_main_accounts(workspace.workspace_id, db)
    account = await get_account(account_id, current_user, workspace, db)
    if 'balance' in fields and account.bank_managed:
        raise HTTPException(status_code=409, detail='Connected account balances are managed by bank sync')
    if 'name' in fields:
        await check_name(request.name, workspace.workspace_id, db, account_id)
    if fields.get('is_main'):
        await clear_main_account(workspace.workspace_id, db)
    for field, value in fields.items():
        setattr(account, field, value)
    await db.commit()
    await db.refresh(account)
    return CreateAccountResponse.model_validate(account)


async def delete_account(account_id: int, current_user: dict, workspace: Workspace, db: AsyncSession) -> None:
    await authorize_accounts(current_user, workspace, db, owner=True)
    await get_account(account_id, current_user, workspace, db)
    # Delete conditionally without the ORM's transaction delete-orphan cascade.
    result = await db.execute(delete(Account).where(
        Account.account_id == account_id,
        Account.workspace_id == workspace.workspace_id,
        Account.connection_id.is_(None),
        ~Account.transactions.any(),
    ))
    if result.rowcount == 0:
        raise HTTPException(status_code=409, detail='Account has transactions or is bank-linked and cannot be deleted')
    await db.commit()


async def lock_main_accounts(workspace_id: int, db: AsyncSession) -> None:
    await db.execute(select(Workspace.workspace_id).where(
        Workspace.workspace_id == workspace_id
    ).with_for_update())


async def clear_main_account(workspace_id: int, db: AsyncSession) -> None:
    await db.execute(update(Account).where(
        Account.workspace_id == workspace_id, Account.is_main.is_(True)
    ).values(is_main=False))
