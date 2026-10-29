from datetime import date as CalendarDate
from decimal import Decimal
from typing import Literal
from cryptography.fernet import InvalidToken
from fastapi import HTTPException
from pydantic import BaseModel,Field,TypeAdapter
from sqlalchemy import select
from app.models import Account,EnableBankingConnection as Connection
from app.services import enable_banking_service as authorization


class PendingItem(BaseModel):
    account_id:int=Field(gt=0)
    amount:Decimal=Field(gt=0,max_digits=10,decimal_places=2,allow_inf_nan=False)
    currency:str=Field(pattern=r'^[A-Z]{3}$')
    description:str=Field(max_length=255)
    direction:Literal['income','expense']
    date:CalendarDate|None=None


async def pending(workspace,db):
    authorization.personal(workspace)
    row=await db.scalar(select(Connection).where(Connection.workspace_id==workspace.workspace_id))
    if not row or not row.pending_transactions_encrypted or row.pending_status=='deleting':
        return {'items':[]}
    try:
        items=TypeAdapter(list[PendingItem]).validate_json(authorization.encryption_cipher().decrypt(
            row.pending_transactions_encrypted.encode()))
    except (InvalidToken,ValueError,TypeError):
        raise HTTPException(409,'Pending bank data could not be read; sync again') from None
    accounts=set((await db.scalars(select(Account.account_id).where(
        Account.workspace_id==workspace.workspace_id,Account.banking_connection_id==row.connection_id))).all())
    if any(item.account_id not in accounts for item in items):
        raise HTTPException(409,'Pending bank data changed; sync again')
    return {'items':[item.model_dump(mode='json') for item in items]}
