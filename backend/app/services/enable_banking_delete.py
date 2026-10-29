"""Revoke bank access before purging this connection's local account data."""
import json
from uuid import UUID
from cryptography.fernet import InvalidToken
from fastapi import HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from app.database import AsyncSession
from app.models import Account, EnableBankingConnection as Connection, Transaction, Workspace
from app.services import enable_banking_client as client, enable_banking_service as authorization
from app.services.account_service import lock_main_accounts


async def disconnect(workspace: Workspace, db: AsyncSession):
    authorization.personal(workspace)
    wid=workspace.workspace_id
    row=await db.scalar(select(Connection).where(Connection.workspace_id==wid))
    if row is None:
        return
    cid, encrypted=row.connection_id,row.session_encrypted
    session_id=None
    if encrypted:
        try:
            data=json.loads(authorization.encryption_cipher().decrypt(encrypted.encode()))
            session_id=UUID(data['session_id'])
        except (InvalidToken, ValueError, TypeError, KeyError, AttributeError):
            raise HTTPException(409,'Bank session cannot be read; revoke access in Enable Banking and contact support') from None
    # Commit the tombstone before the provider call so callbacks and sync cannot restore data.
    claimed=await db.execute(update(Connection).where(Connection.connection_id==cid,
        Connection.workspace_id==wid,Connection.session_encrypted==encrypted).values(
            pending_status='deleting',state_hash=None,browser_hash=None,pending_expires_at=None,pending_user_id=None))
    await db.commit()
    if claimed.rowcount != 1:
        raise HTTPException(409,'Bank connection changed; reload and try again')
    if session_id is not None:
        await client.request('DELETE','/sessions/'+str(session_id))
    try:
        # Claim the same tombstone again; never delete a newly established connection.
        claimed=await db.execute(update(Connection).where(Connection.connection_id==cid,
            Connection.workspace_id==wid,Connection.session_encrypted==encrypted,
            Connection.pending_status=='deleting').values(pending_status='deleting'))
        if claimed.rowcount != 1:
            raise HTTPException(409,'Bank connection changed; reload and try again')
        await lock_main_accounts(wid,db)
        accounts=select(Account.account_id).where(Account.workspace_id==wid,Account.banking_connection_id==cid)
        await db.execute(delete(Transaction).where(Transaction.workspace_id==wid,Transaction.account_id.in_(accounts)))
        await db.execute(delete(Account).where(Account.workspace_id==wid,Account.banking_connection_id==cid))
        await db.execute(delete(Connection).where(Connection.connection_id==cid,Connection.workspace_id==wid,
            Connection.pending_status=='deleting',Connection.session_encrypted==encrypted))
        await db.commit()
    except (IntegrityError,HTTPException) as exc:
        await db.rollback()
        if isinstance(exc,HTTPException):
            raise
        raise HTTPException(409,'Linked records changed; reload and retry deletion') from None
