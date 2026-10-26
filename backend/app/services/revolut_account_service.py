from datetime import datetime, timezone
from decimal import Decimal

from cryptography.fernet import InvalidToken
from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.database import AsyncSession
from app.models import Account, RevolutConnection, Workspace
from app.models.workspace import WorkspaceTypeEnum
from app.services import revolut_authorization_service as authorization, revolut_service
from app.services.account_service import lock_main_accounts


class BankAccount(BaseModel):
    AccountId: str = Field(pattern=r'^[A-Za-z0-9_-]{1,255}$')
    Currency: str = Field(pattern=r'^[A-Z]{3}$')


class BankAmount(BaseModel):
    Amount: Decimal = Field(ge=0, max_digits=10, decimal_places=2, allow_inf_nan=False)
    Currency: str = Field(pattern=r'^[A-Z]{3}$')


class BankBalance(BaseModel):
    AccountId: str
    Amount: BankAmount
    CreditDebitIndicator: str = Field(pattern=r'^(Credit|Debit)$')
    Type: str


async def import_accounts(workspace: Workspace, db: AsyncSession) -> dict:
    if workspace.type != WorkspaceTypeEnum.PERSONAL:
        raise HTTPException(400, 'Revolut accounts require a Personal Workspace')
    connection = await db.scalar(select(RevolutConnection).where(
        RevolutConnection.workspace_id == workspace.workspace_id))
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if (connection is None or connection.status != 'active' or not connection.access_token_encrypted
            or connection.expires_at is None or connection.expires_at <= now):
        raise HTTPException(409, 'Reconnect Revolut before loading accounts')
    try:
        token = authorization.encryption_cipher().decrypt(connection.access_token_encrypted.encode()).decode()
    except (InvalidToken, ValueError, UnicodeError):
        raise HTTPException(409, 'Reconnect Revolut before loading accounts') from None
    connection_id, consent, encrypted_token = (connection.revolut_connection_id,
        connection.external_consent_id, connection.access_token_encrypted)
    previous_sync = connection.last_sync_at
    await db.commit()
    headers = {'Authorization': 'Bearer ' + token, 'x-fapi-financial-id': '001580000103UAvAAM'}
    imported = []
    try:
        payload = await revolut_service.sandbox_request('GET', '/accounts', authorization.settings, headers=headers)
        # shortcut: reject pagination atomically; add page traversal if sandbox accounts become paginated.
        if payload.get('Links', {}).get('Next'):
            raise ValueError()
        items = payload['Data']['Account']
        if not isinstance(items, list):
            raise ValueError()
        accounts = [BankAccount.model_validate(item) for item in items]
        if len({a.AccountId for a in accounts}) != len(accounts):
            raise ValueError()
        for account in accounts:
            payload = await revolut_service.sandbox_request('GET', f'/accounts/{account.AccountId}/balances',
                                                           authorization.settings, headers=headers)
            if payload.get('Links', {}).get('Next'):
                raise ValueError()
            balances = [BankBalance.model_validate(item) for item in payload['Data']['Balance']]
            if any(b.AccountId != account.AccountId or b.Amount.Currency != account.Currency for b in balances):
                raise ValueError()
            available = [b for b in balances if b.Type == 'InterimAvailable']
            if len(available) != 1:
                raise ValueError()
            balance = available[0]
            amount = balance.Amount.Amount * (-1 if balance.CreditDebitIndicator == 'Debit' else 1)
            imported.append((account, amount))
    except (RuntimeError, ValueError, KeyError, TypeError, AttributeError):
        raise HTTPException(502, 'Could not load Revolut accounts and balances; existing data was kept') from None
    synced = datetime.now(timezone.utc).replace(tzinfo=None)
    try:
        # Claim the unchanged connection before writing; concurrent imports/reconnects must not overwrite newer data.
        claimed = await db.execute(update(RevolutConnection).where(
            RevolutConnection.revolut_connection_id == connection_id,
            RevolutConnection.workspace_id == workspace.workspace_id,
            RevolutConnection.status == 'active', RevolutConnection.expires_at > synced,
            RevolutConnection.external_consent_id == consent,
            RevolutConnection.access_token_encrypted == encrypted_token,
            RevolutConnection.last_sync_at == previous_sync,
        ).values(last_sync_at=synced, updated_at=synced))
        if claimed.rowcount != 1:
            raise HTTPException(409, 'Revolut connection changed; reload and try again')
        await lock_main_accounts(workspace.workspace_id, db)
        existing = list((await db.scalars(select(Account).where(Account.workspace_id == workspace.workspace_id))).all())
        by_external = {a.external_account_id: a for a in existing if a.connection_id == connection_id and a.external_account_id}
        names = {a.name.casefold() for a in existing}
        for bank, amount in imported:
            account = by_external.get(bank.AccountId)
            if account:
                if account.currency != bank.Currency:
                    raise HTTPException(502, 'Unexpected Revolut account currency; existing data was kept')
                account.balance = amount
            else:
                name = f'Revolut {bank.Currency}'
                suffix = 2
                while name.casefold() in names:
                    name = f'Revolut {bank.Currency} ({suffix})'
                    suffix += 1
                account = Account(name=name, currency=bank.Currency, balance=amount,
                    workspace_id=workspace.workspace_id, connection_id=connection_id,
                    external_account_id=bank.AccountId, is_main=not existing)
                db.add(account)
                existing.append(account)
                names.add(name.casefold())
        await db.commit()
    except (HTTPException, IntegrityError) as exc:
        await db.rollback()
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(409, 'Accounts changed; reload and try again') from None
    return {'imported_count': len(imported), 'last_sync_at': synced.replace(tzinfo=timezone.utc)}
