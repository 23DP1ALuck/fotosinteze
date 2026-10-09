from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db_session
from app.dto import CreateTransactionRequest
from app.dependencies.auth import get_current_user
from app.dependencies.workspace import get_current_workspace

from app.models import Workspace
from app.services import transaction_service

router = APIRouter()


@router.post("/transactions", status_code=201)
async def create_transaction(request: CreateTransactionRequest,
                             db: AsyncSession = Depends(get_db_session),
                             current_user: dict = Depends(get_current_user),
                            workspace: Workspace = Depends(get_current_workspace)
                             ):
    return await transaction_service.create_transaction(request, current_user, workspace, db)
