import hashlib
from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import Literal

from cryptography.fernet import InvalidToken
from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.database import AsyncSession
from app.models import Account, Category, EnableBankingConnection, Transaction, Workspace
from app.models.category import CategoryType
from app.models.transaction import TransactionSourceEnum
from app.models.workspace import WorkspaceTypeEnum
from app.services import enable_banking_client as client, revolut_authorization_service as authorization
from app.services.account_service import lock_main_accounts
from app.services.enable_banking_service import BankSession


class Amount(BaseModel):
    amount: Decimal = Field(max_digits=10, decimal_places=2, allow_inf_nan=False)
    currency: str = Field(pattern=r'^[A-Z]{3}$')


class Balance(BaseModel):
    balance_type: str
    balance_amount: Amount


class Balances(BaseModel):
    balances: list[Balance]


class BookedTransaction(BaseModel):
    entry_reference: str = Field(min_length=1, max_length=255)
    transaction_amount: Amount
    credit_debit_indicator: Literal['CRDT', 'DBIT']
    booking_date: date
    remittance_information: list[str] = Field(default_factory=list)

    @field_validator('booking_date', mode='before')
    @classmethod
    def calendar_date(cls, value):
        if not isinstance(value, str) or len(value) != 10:
            raise ValueError()
        return date.fromisoformat(value)


class Page(BaseModel):
    transactions: list[dict]
    continuation_key: str | None = Field(default=None, min_length=1, max_length=4096)


async def sync(workspace: Workspace, db: AsyncSession) -> dict:
    if workspace.type != WorkspaceTypeEnum.PERSONAL:
        raise HTTPException(400, 'Bank sync requires a Personal Workspace')
    workspace_id = workspace.workspace_id
    connection = await db.scalar(select(EnableBankingConnection).where(
        EnableBankingConnection.workspace_id == workspace_id))
    now = datetime.now(timezone.utc)
    if (connection is None or not connection.session_encrypted or not connection.expires_at
            or connection.expires_at <= now.replace(tzinfo=None)):
        raise HTTPException(409, 'Reconnect the bank before syncing')
    try:
        session = BankSession.model_validate_json(authorization.encryption_cipher().decrypt(
            connection.session_encrypted.encode()))
        identities = [hashlib.sha256(f'{a.identification_hash}|{a.currency}'.encode()).hexdigest()
                      for a in session.accounts]
        if (session.access.valid_until <= now or len(set(identities)) != len(identities)
                or len({a.uid for a in session.accounts}) != len(session.accounts)):
            raise ValueError()
    except (InvalidToken, ValueError, TypeError, UnicodeError):
        raise HTTPException(409, 'Reconnect the bank before syncing') from None
    connection_id, encrypted, expires, previous_sync = (connection.connection_id,
        connection.session_encrypted, connection.expires_at, connection.last_sync_at)
    await db.commit()
    fetched = []
    try:
        for bank, external_id in zip(session.accounts, identities):
            balances = Balances.model_validate(await client.request('GET', f'/accounts/{bank.uid}/balances'))
            amount = None
            for kind in ('ITAV', 'CLAV', 'ITBD', 'CLBD'):
                matches = [b.balance_amount.amount for b in balances.balances
                           if b.balance_type == kind and b.balance_amount.currency == bank.currency]
                if len(matches) > 1:
                    raise ValueError()
                if matches:
                    amount = matches[0]
                    break
            if amount is None:
                raise ValueError()
            transactions, seen_keys, continuation = {}, set(), None
            # shortcut: cap a sync at 1000 pages per account; add resumable imports if banks exceed this.
            for _ in range(1000):
                params = {'transaction_status': 'BOOK'}
                if continuation is not None:
                    params['continuation_key'] = continuation
                page = Page.model_validate(await client.request('GET', f'/accounts/{bank.uid}/transactions', params=params))
                for item in page.transactions:
                    status = item.get('status')
                    if status in ('CNCL', 'HOLD', 'OTHR', 'PDNG', 'RJCT', 'SCHD'):
                        continue
                    if status != 'BOOK':
                        raise ValueError()
                    tx = BookedTransaction.model_validate(item)
                    if tx.transaction_amount.currency != bank.currency or tx.transaction_amount.amount < 0:
                        raise ValueError()
                    # Zero-value booked records have no financial effect and cannot enter transaction history.
                    if tx.transaction_amount.amount == 0:
                        continue
                    if tx.entry_reference in transactions and transactions[tx.entry_reference] != tx:
                        raise ValueError()
                    transactions[tx.entry_reference] = tx
                continuation = page.continuation_key
                if continuation is None:
                    break
                if continuation in seen_keys:
                    raise ValueError()
                seen_keys.add(continuation)
            else:
                raise ValueError()
            fetched.append((bank, external_id, amount, transactions.values()))
    except (ValueError, KeyError, TypeError, AttributeError):
        raise HTTPException(502, 'Bank data could not be validated; existing data was kept') from None
    synced = datetime.now(timezone.utc)
    stamp = synced.replace(tzinfo=None)
    imported_count = 0
    try:
        claimed = await db.execute(update(EnableBankingConnection).where(
            EnableBankingConnection.connection_id == connection_id,
            EnableBankingConnection.workspace_id == workspace_id,
            EnableBankingConnection.session_encrypted == encrypted,
            EnableBankingConnection.expires_at == expires,
            EnableBankingConnection.expires_at > stamp,
            EnableBankingConnection.last_sync_at == previous_sync,
        ).values(last_sync_at=stamp))
        if claimed.rowcount != 1 or session.access.valid_until <= synced:
            raise HTTPException(409, 'Bank connection changed; reload and try again')
        await lock_main_accounts(workspace_id, db)
        existing = list((await db.scalars(select(Account).where(Account.workspace_id == workspace_id))).all())
        by_external = {a.external_account_id: a for a in existing if a.banking_connection_id == connection_id}
        names = {a.name.casefold() for a in existing}
        categories = {}
        for bank, external_id, amount, transactions in fetched:
            account = by_external.get(external_id)
            if account is None:
                name, suffix = f'Revolut {bank.currency}', 2
                while name.casefold() in names:
                    name = f'Revolut {bank.currency} ({suffix})'
                    suffix += 1
                account = Account(name=name, currency=bank.currency, balance=amount, workspace_id=workspace_id,
                    banking_connection_id=connection_id, external_account_id=external_id, is_main=not existing)
                db.add(account)
                await db.flush()
                existing.append(account)
                names.add(name.casefold())
            else:
                if account.currency != bank.currency:
                    raise HTTPException(502, 'Bank account currency changed; existing data was kept')
                account.balance = amount
            known = set((await db.scalars(select(Transaction.external_transaction_id).where(
                Transaction.account_id == account.account_id, Transaction.external_transaction_id.is_not(None)))).all())
            for tx in transactions:
                if tx.entry_reference in known:
                    continue
                direction = CategoryType.income if tx.credit_debit_indicator == 'CRDT' else CategoryType.expense
                if direction not in categories:
                    name = 'Bank income' if direction == CategoryType.income else 'Bank expense'
                    category = await db.scalar(select(Category).where(Category.workspace_id == workspace_id,
                        Category.name == name, Category.type == direction).order_by(Category.category_id).limit(1))
                    if category is None:
                        category = Category(workspace_id=workspace_id, name=name, type=direction)
                        db.add(category)
                        await db.flush()
                    categories[direction] = category.category_id
                db.add(Transaction(account_id=account.account_id, workspace_id=workspace_id,
                    external_transaction_id=tx.entry_reference, amount=tx.transaction_amount.amount,
                    currency=bank.currency, description=(' '.join(tx.remittance_information).strip() or 'Revolut transaction')[:255],
                    source=TransactionSourceEnum.BANK, category_id=categories[direction],
                    created_at=datetime.combine(tx.booking_date, time.min)))
                imported_count += 1
        await db.commit()
    except (HTTPException, IntegrityError) as exc:
        await db.rollback()
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(409, 'Bank data changed; reload and try again') from None
    return {'accounts_count': len(fetched), 'imported_count': imported_count, 'last_sync_at': synced}
