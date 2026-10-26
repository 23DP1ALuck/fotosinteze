from fastapi import APIRouter, Depends, Response
from app.database import AsyncSession, get_db_session
from app.dependencies.auth import get_current_user
from app.dependencies.workspace import get_current_workspace
from app.dto import CreateAccountRequest, CreateAccountResponse
from app.dto.update_account_request import UpdateAccountRequest
from app.models import Workspace
from app.services import account_service

router = APIRouter(tags=['accounts'], responses={401: {'description': 'Unauthorized'}, 403: {'description': 'No access to workspace accounts'}})


@router.get('/accounts', response_model=list[CreateAccountResponse])
async def get_accounts(current_user: dict = Depends(get_current_user),
                       workspace: Workspace = Depends(get_current_workspace),
                       db: AsyncSession = Depends(get_db_session)):
    return await account_service.get_accounts(current_user, workspace, db)


@router.get('/accounts/{account_id}', response_model=CreateAccountResponse, responses={404: {'description': 'Account not found'}})
async def get_account(account_id: int, current_user: dict = Depends(get_current_user),
                      workspace: Workspace = Depends(get_current_workspace),
                      db: AsyncSession = Depends(get_db_session)):
    return await account_service.get_account(account_id, current_user, workspace, db)


@router.post('/accounts', status_code=201, response_model=CreateAccountResponse, responses={409: {'description': 'Duplicate account name'}})
async def create_account(request: CreateAccountRequest, current_user: dict = Depends(get_current_user),
                         workspace: Workspace = Depends(get_current_workspace),
                         db: AsyncSession = Depends(get_db_session)):
    return await account_service.create_account(request, current_user, workspace, db)


@router.put('/accounts/{account_id}', response_model=CreateAccountResponse, responses={404: {'description': 'Account not found'}, 409: {'description': 'Duplicate name or bank-managed balance'}})
async def update_account(account_id: int, request: UpdateAccountRequest,
                         current_user: dict = Depends(get_current_user),
                         workspace: Workspace = Depends(get_current_workspace),
                         db: AsyncSession = Depends(get_db_session)):
    return await account_service.update_account(account_id, request, current_user, workspace, db)


@router.delete('/accounts/{account_id}', status_code=204, responses={404: {'description': 'Account not found'}, 409: {'description': 'Account has transactions or is bank-linked'}})
async def delete_account(account_id: int, current_user: dict = Depends(get_current_user),
                         workspace: Workspace = Depends(get_current_workspace),
                         db: AsyncSession = Depends(get_db_session)):
    await account_service.delete_account(account_id, current_user, workspace, db)
    return Response(status_code=204)
