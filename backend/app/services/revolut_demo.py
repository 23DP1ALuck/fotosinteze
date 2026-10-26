"""Local sample data only: python -m app.services.revolut_demo --workspace-id ID."""
import argparse
import asyncio
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.engine import make_url

from app.config import settings
from app.database import AsyncSession, sessionmanager
from app.models import Account, Category, Transaction, Workspace
from app.models.category import CategoryType
from app.models.transaction import TransactionSourceEnum
from app.models.workspace import WorkspaceTypeEnum


def require_local_database(database_url: str, client_url: str) -> None:
    url = make_url(database_url)
    local_file = Path(__file__).resolve().parents[2] / 'database.sqlite'
    if (url.drivername != 'sqlite+aiosqlite' or url.query
            or Path(url.database or '').resolve() != local_file
            or urlsplit(client_url).hostname not in ('localhost', '127.0.0.1', '::1')):
        raise ValueError('Demo data is restricted to the local backend/database.sqlite and local frontend')


async def seed_demo(workspace_id: int, db: AsyncSession) -> dict:
    workspace = await db.get(Workspace, workspace_id)
    if workspace is None or workspace.type != WorkspaceTypeEnum.PERSONAL:
        raise ValueError('Choose an existing Personal workspace')
    existing = list((await db.scalars(select(Account).where(Account.workspace_id == workspace_id))).all())
    categories = {}
    for kind, name in [(CategoryType.income, '[DEMO] Income'), (CategoryType.expense, '[DEMO] Expenses')]:
        category = await db.scalar(select(Category).where(Category.workspace_id == workspace_id, Category.name == name))
        if category is not None and category.type != kind:
            raise ValueError('Existing demo category has a different transaction type')
        if category is None:
            category = Category(name=name, type=kind, workspace_id=workspace_id)
            db.add(category)
            await db.flush()
        categories[kind] = category
    created_accounts = created_transactions = 0
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for currency in ('GBP', 'EUR', 'USD'):
        marker = 'local-demo-revolut-' + currency
        account = next((a for a in existing if a.external_account_id == marker), None)
        if account is not None and (account.connection_id is not None or account.currency != currency):
            raise ValueError('Demo account conflicts with a connected bank account')
        if account is None:
            name = '[DEMO] Revolut ' + currency
            if any(a.name.strip().casefold() == name.casefold() for a in existing):
                raise ValueError('An account already uses the reserved demo name')
            account = Account(name=name, currency=currency, balance=Decimal('0'), workspace_id=workspace_id,
                              external_account_id=marker, is_main=not existing)
            db.add(account)
            await db.flush()
            existing.append(account)
            created_accounts += 1
        for label, amount, kind in [('Salary', '2500.00', CategoryType.income),
                                    ('Groceries', '42.50', CategoryType.expense),
                                    ('Coffee', '1.20', CategoryType.expense)]:
            external_id = marker + '-' + label.lower()
            present = await db.scalar(select(Transaction.transaction_id).where(
                Transaction.account_id == account.account_id, Transaction.external_transaction_id == external_id))
            if present is not None:
                continue
            value = Decimal(amount)
            db.add(Transaction(external_transaction_id=external_id, amount=value, currency=currency,
                description='[DEMO] ' + label, source=TransactionSourceEnum.MANUAL,
                account_id=account.account_id, category_id=categories[kind].category_id,
                workspace_id=workspace_id, created_at=now, updated_at=now))
            account.balance += value if kind == CategoryType.income else -value
            created_transactions += 1
    await db.commit()
    return {'accounts_created': created_accounts, 'transactions_created': created_transactions}


async def main(workspace_id: int) -> None:
    require_local_database(settings.database_url, settings.client_url)
    try:
        async with sessionmanager.session() as db:
            result = await seed_demo(workspace_id, db)
            print(result)
    finally:
        await sessionmanager.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Create labelled demo transactions in the local development database')
    parser.add_argument('--workspace-id', type=int, required=True)
    asyncio.run(main(parser.parse_args().workspace_id))
