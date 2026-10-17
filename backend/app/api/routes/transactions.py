from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db_session
from app.dto import CreateTransactionRequest, TransactionResponseDTO, TransactionListResponseDTO
from app.dependencies.auth import get_current_user
from app.dependencies.workspace import get_current_workspace

from app.models import Workspace
from app.models.category import CategoryType
from app.services import transaction_service

router = APIRouter(tags=['transactions'])
unauthorized = {401: {'description': 'Missing, invalid or expired access token, invalid session, or user not found'}}
forbidden = {403: {'description': 'No workspace access, employee has no assigned department, or transaction/project/expense belongs to another department'}}
invalid_request = {422: {'description': 'Missing or invalid Workspace-ID header, path parameter or request fields'}}
not_found = {404: {'description': 'Transaction or referenced account, category, project, department or expense not found in the permitted workspace'}}
bad_request = {400: {'description': 'Amount must be positive, description must not be empty, workspace type must be valid, and business resource links must belong to the workspace and match the department'}}


@router.post('/transactions', status_code=201, response_model=TransactionResponseDTO,
             summary='Create a transaction and apply its account balance effect',
             responses={**unauthorized, **forbidden, **invalid_request, **not_found, **bad_request})
async def create_transaction(request: CreateTransactionRequest,
                             db: AsyncSession = Depends(get_db_session),
                             current_user: dict = Depends(get_current_user),
                            workspace: Workspace = Depends(get_current_workspace)
                             ) -> TransactionResponseDTO:
    return await transaction_service.create_transaction(request, current_user, workspace, db)


@router.get('/transactions', status_code=200, response_model=TransactionListResponseDTO,
            summary='List newest workspace transactions first; employees see their assigned department only',
            responses={**unauthorized, **forbidden, **invalid_request,
                       404: {'description': 'Workspace, department or project not found'},
                       400: {'description': 'Invalid date range or business-only filters in personal workspace'}})
async def get_transactions(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None, max_length=255, description='Case-insensitive literal description search'),
    transaction_type: CategoryType | None = Query(default=None, alias='type'),
    category_id: int | None = Query(default=None, gt=0),
    date_from: date | None = Query(default=None, description='Inclusive creation date'),
    date_to: date | None = Query(default=None, description='Inclusive creation date'),
    department_id: int | None = Query(default=None, gt=0),
    project_id: int | None = Query(default=None, gt=0),
    db: AsyncSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
    workspace: Workspace = Depends(get_current_workspace),
) -> TransactionListResponseDTO:
    return await transaction_service.get_transactions(
        workspace, current_user, db, limit=limit, offset=offset, search=search,
        transaction_type=transaction_type, category_id=category_id, date_from=date_from,
        date_to=date_to, department_id=department_id, project_id=project_id,
    )


@router.get('/transactions/{transaction_id}', status_code=200, response_model=TransactionResponseDTO,
            summary='Read a transaction visible to the current workspace member',
            responses={**unauthorized, **forbidden, **invalid_request, **not_found,
                       400: {'description': 'Business transaction has invalid workspace or department links'}})
async def get_transaction_by_id(
    transaction_id: int,
    db: AsyncSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
    workspace: Workspace = Depends(get_current_workspace),
) -> TransactionResponseDTO:
    return await transaction_service.get_transaction_by_id(transaction_id, current_user, workspace, db)


@router.put('/transactions/{transaction_id}', status_code=200, response_model=TransactionResponseDTO,
            summary='Update a transaction and adjust the affected account balances',
            responses={**unauthorized, **forbidden, **invalid_request, **not_found, **bad_request})
async def update_transaction(
    transaction_id: int,
    request: CreateTransactionRequest,
    db: AsyncSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
    workspace: Workspace = Depends(get_current_workspace),
) -> TransactionResponseDTO:
    return await transaction_service.update_transaction(
        transaction_id, request, current_user, workspace, db
    )


@router.delete('/transactions/{transaction_id}', status_code=204, response_model=None,
               summary='Delete a transaction and reverse its account balance effect',
               responses={**unauthorized, **forbidden, **invalid_request, **not_found,
                          400: {'description': 'Business transaction has invalid workspace or department links'}})
async def delete_transaction(
    transaction_id: int,
    db: AsyncSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
    workspace: Workspace = Depends(get_current_workspace),
) -> None:
    await transaction_service.delete_transaction(
        transaction_id, current_user, workspace, db
    )
