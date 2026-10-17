from datetime import datetime

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dto.dashboard_response import DashboardResponse
from app.dto.transaction_response import TransactionResponseDTO
from app.models import Account, Category, Transaction, Workspace
from app.models.category import CategoryType


async def get_dashboard(workspace: Workspace, db: AsyncSession) -> DashboardResponse:
    # Match the naive server-local timestamps currently stored on transactions.
    start = datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
    balance = await db.scalar(select(func.coalesce(func.sum(Account.balance), 0)).where(
        Account.workspace_id == workspace.workspace_id,
        Account.currency == workspace.base_currency,
    ))
    month_filters = (
        Transaction.workspace_id == workspace.workspace_id,
        Transaction.currency == workspace.base_currency,
        Transaction.created_at >= start,
        Transaction.created_at < end,
    )
    totals = await db.execute(select(
        func.coalesce(func.sum(case((Category.type == CategoryType.income, Transaction.amount), else_=0)), 0),
        func.coalesce(func.sum(case((Category.type == CategoryType.expense, Transaction.amount), else_=0)), 0),
    ).join(Category, Transaction.category_id == Category.category_id).where(*month_filters))
    income, expenses = totals.one()
    recent = await db.scalars(select(Transaction).where(*month_filters).order_by(
        Transaction.created_at.desc(), Transaction.transaction_id.desc()
    ).limit(10))
    return DashboardResponse(
        workspace_id=workspace.workspace_id, currency=workspace.base_currency,
        period_start=start.date(), period_end=end.date(), balance=balance,
        income=income, expenses=expenses, savings=income - expenses,
        recent_transactions=[TransactionResponseDTO.model_validate(t, from_attributes=True) for t in recent],
    )
