from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db_session
from app.dependencies.auth import get_current_user
from app.dependencies.workspace import get_current_workspace
from app.dto import CreateAccountResponse
from app.models import Account, Workspace
from app.models.workspace import WorkspaceTypeEnum
from app.services.workspace_access import get_workspace_membership


router = APIRouter(prefix='/accounts', tags=['Accounts'])


@router.get('', response_model=list[CreateAccountResponse])
async def get_accounts(
    workspace: Workspace = Depends(get_current_workspace),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    if workspace.type != WorkspaceTypeEnum.BUSINESS:
        raise HTTPException(status_code=400, detail='Accounts for expense review require a business workspace')
    await get_workspace_membership(current_user, workspace.workspace_id, db, owner_only=True)
    result = await db.scalars(
        select(Account)
        .where(Account.workspace_id == workspace.workspace_id)
        .order_by(Account.account_id)
    )
    return result.all()
