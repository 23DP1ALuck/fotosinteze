import hashlib
import json
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Literal

from cryptography.fernet import InvalidToken
from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError

from app.database import AsyncSession
from app.models import Account, Category, EnableBankingConnection, Transaction, Workspace
from app.models.category import CategoryType
from app.models.transaction import TransactionSourceEnum
from app.models.workspace import WorkspaceTypeEnum
from app.services import enable_banking_client as client, enable_banking_service as authorization
from app.services.account_service import lock_main_accounts
from app.services.bank_categories import MCC_CATEGORIES
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
    merchant_category_code: str | None = None

    @field_validator('merchant_category_code', mode='before')
    @classmethod
    def optional_mcc(cls, value):
        # Optional categorization metadata must not prevent importing valid financial data.
        return value if isinstance(value, str) and len(value) == 4 and value.isascii() and value.isdecimal() else None

    @field_validator('booking_date', mode='before')
    @classmethod
    def calendar_date(cls, value):
        if not isinstance(value, str) or len(value) != 10:
            raise ValueError()
        return date.fromisoformat(value)


class PendingTransaction(BaseModel):
    entry_reference: str | None = Field(default=None, min_length=1, max_length=255)
    transaction_id: str | None = Field(default=None, min_length=1, max_length=255)
    transaction_amount: Amount
    credit_debit_indicator: Literal['CRDT', 'DBIT']
    transaction_date: date | None = None
    booking_date: date | None = None
    remittance_information: list[str] = Field(default_factory=list, max_length=100)

    @field_validator('transaction_date', 'booking_date', mode='before')
    @classmethod
    def calendar_date(cls, value):
        return None if value is None else BookedTransaction.calendar_date(value)

    @field_validator('remittance_information')
    @classmethod
    def bounded_remittance(cls, value):
        if any(len(item) > 4096 for item in value):
            raise ValueError()
        return value


class Page(BaseModel):
    transactions: list[dict]
    continuation_key: str | None = Field(default=None, min_length=1, max_length=4096)


async def transaction_pages(uid, status, headers, date_from=None):
    seen_keys, continuation = set(), None
    # shortcut: cap each status at 1000 pages; add resumable imports if banks exceed this.
    for _ in range(1000):
        params = {'transaction_status': status}
        if date_from is not None:
            params['date_from'] = date_from
        if continuation is not None:
            params['continuation_key'] = continuation
        page = Page.model_validate(await client.request('GET', f'/accounts/{uid}/transactions',
                                                       params=params, **headers))
        yield page.transactions
        continuation = page.continuation_key
        if continuation is None:
            return
        if continuation in seen_keys:
            raise ValueError()
        seen_keys.add(continuation)
    raise ValueError()


async def sync(workspace: Workspace, db: AsyncSession, *, psu_headers: dict | None = None,
               recent: bool = False, automatic: bool = False,
               claim_started_at: datetime | None = None) -> dict:
    if workspace.type != WorkspaceTypeEnum.PERSONAL:
        raise HTTPException(400, 'Bank sync requires a Personal Workspace')
    workspace_id = workspace.workspace_id
    connection = await db.scalar(select(EnableBankingConnection).where(
        EnableBankingConnection.workspace_id == workspace_id))
    now = datetime.now(timezone.utc)
    if (connection is None or connection.pending_status == 'deleting' or not connection.session_encrypted or not connection.expires_at
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
    headers = {'headers': psu_headers} if psu_headers is not None else {}
    date_from = ((previous_sync.replace(tzinfo=timezone.utc).date() - timedelta(days=7)).isoformat()
                 if recent and previous_sync is not None else None)
    try:
        for bank, external_id in zip(session.accounts, identities):
            balances = Balances.model_validate(await client.request('GET', f'/accounts/{bank.uid}/balances', **headers))
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
            transactions = {}
            async for items in transaction_pages(bank.uid, 'BOOK', headers, date_from):
                for item in items:
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
            pending, pending_ids = [], {}
            async for items in transaction_pages(bank.uid, 'PDNG', headers):
                for item in items:
                    status = item.get('status')
                    if status in ('BOOK', 'CNCL', 'HOLD', 'OTHR', 'RJCT', 'SCHD'):
                        continue
                    if status != 'PDNG':
                        raise ValueError()
                    tx = PendingTransaction.model_validate(item)
                    if tx.transaction_amount.currency != bank.currency or tx.transaction_amount.amount <= 0:
                        raise ValueError()
                    if tx.entry_reference in transactions:
                        continue
                    keys = [(kind, value) for kind, value in (
                        ('reference', tx.entry_reference), ('id', tx.transaction_id)) if value is not None]
                    duplicate = False
                    for key in keys:
                        if key in pending_ids:
                            if pending_ids[key] != tx:
                                raise ValueError()
                            duplicate = True
                    if not duplicate:
                        pending.append(tx)
                    for key in keys:
                        pending_ids[key] = tx
            fetched.append((bank, external_id, amount, transactions.values(), pending))
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
            *([EnableBankingConnection.sync_started_at == claim_started_at]
              if claim_started_at is not None else []),
            or_(EnableBankingConnection.pending_status.is_(None),
                EnableBankingConnection.pending_status != 'deleting'),
        ).values(last_sync_at=stamp))
        if claimed.rowcount != 1 or session.access.valid_until <= synced:
            raise HTTPException(409, 'Bank connection changed; reload and try again')
        await lock_main_accounts(workspace_id, db)
        existing = list((await db.scalars(select(Account).where(Account.workspace_id == workspace_id))).all())
        by_external = {a.external_account_id: a for a in existing if a.banking_connection_id == connection_id}
        names = {a.name.casefold() for a in existing}
        available_categories = list((await db.scalars(select(Category).where(or_(
            Category.workspace_id.is_(None), Category.workspace_id == workspace_id
        )).order_by(Category.category_id))).all())
        categories = {}
        pending_snapshot = []
        for bank, external_id, amount, transactions, pending in fetched:
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
            pending_snapshot.extend({'account_id': account.account_id,
                'amount': str(tx.transaction_amount.amount), 'currency': bank.currency,
                'description': (' '.join(tx.remittance_information).strip() or 'Revolut transaction')[:255],
                'direction': 'income' if tx.credit_debit_indicator == 'CRDT' else 'expense',
                'date': (tx.transaction_date or tx.booking_date).isoformat()
                    if tx.transaction_date or tx.booking_date else None} for tx in pending)
            known = {tx.external_transaction_id: tx for tx in (await db.scalars(select(Transaction).where(
                Transaction.account_id == account.account_id, Transaction.workspace_id == workspace_id,
                Transaction.external_transaction_id.is_not(None)))).all()}
            for tx in transactions:
                direction = CategoryType.income if tx.credit_debit_indicator == 'CRDT' else CategoryType.expense
                mapped_name = MCC_CATEGORIES.get(tx.merchant_category_code) if direction == CategoryType.expense else None
                fallback = 'Bank income' if direction == CategoryType.income else 'Bank expense'
                previous = known.get(tx.entry_reference)
                if previous is not None:
                    old_category = next((c for c in available_categories if c.category_id == previous.category_id), None)
                    if (not mapped_name or previous.source != TransactionSourceEnum.BANK or old_category is None
                            or old_category.name != fallback or old_category.type != direction
                            or old_category.workspace_id != workspace_id):
                        continue
                name = mapped_name or fallback
                key = (name, direction)
                if key not in categories:
                    matches = [c for c in available_categories if c.name == name and c.type == direction]
                    category = next((c for c in matches if c.workspace_id is None), None)
                    category = category or next(iter(matches), None)
                    if category is None:
                        category = Category(workspace_id=workspace_id, name=name, type=direction)
                        db.add(category)
                        await db.flush()
                        available_categories.append(category)
                    categories[key] = category.category_id
                if previous is not None:
                    previous.category_id = categories[key]
                    previous.updated_at = stamp
                    continue
                db.add(Transaction(account_id=account.account_id, workspace_id=workspace_id,
                    external_transaction_id=tx.entry_reference, amount=tx.transaction_amount.amount,
                    currency=bank.currency, description=(' '.join(tx.remittance_information).strip() or 'Revolut transaction')[:255],
                    source=TransactionSourceEnum.BANK, category_id=categories[key],
                    created_at=datetime.combine(tx.booking_date, time.min)))
                imported_count += 1
        connection.pending_transactions_encrypted = authorization.encryption_cipher().encrypt(
            json.dumps(pending_snapshot).encode()).decode()
        await db.commit()
    except (HTTPException, IntegrityError) as exc:
        await db.rollback()
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(409, 'Bank data changed; reload and try again') from None
    return {'accounts_count': len(fetched), 'imported_count': imported_count, 'last_sync_at': synced}
