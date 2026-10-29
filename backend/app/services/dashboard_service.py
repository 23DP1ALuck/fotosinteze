from datetime import datetime

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dto.dashboard_response import DashboardResponse, BusinessDashboardResponse, SpendingGroup
from app.dto.transaction_response import TransactionResponseDTO
from app.models import Account, Category, Transaction, Workspace, Department, Project, WorkspaceRole
from app.models.category import CategoryType
from app.services.workspace_access import get_workspace_membership


async def get_dashboard(workspace: Workspace, db: AsyncSession) -> DashboardResponse:
    start, end = current_month_bounds()
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


def current_month_bounds() -> tuple[datetime, datetime]:
    # Match the naive server-local timestamps currently stored on transactions.
    start = datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
    return start, end


async def get_business_dashboard(workspace: Workspace, current_user: dict,
                                 db: AsyncSession) -> BusinessDashboardResponse:
    membership = await get_workspace_membership(current_user, workspace.workspace_id, db)
    start, end = current_month_bounds()
    filters = [
        Transaction.workspace_id == workspace.workspace_id,
        Transaction.currency == workspace.base_currency,
        Transaction.created_at >= start,
        Transaction.created_at < end,
        ((Category.workspace_id.is_(None)) | (Category.workspace_id == workspace.workspace_id)),
    ]
    if membership.role != WorkspaceRole.OWNER:
        filters.append(Transaction.department_id == membership.department_id)
    totals = await db.execute(select(
        func.coalesce(func.sum(case((Category.type == CategoryType.income, Transaction.amount), else_=0)), 0),
        func.coalesce(func.sum(case((Category.type == CategoryType.expense, Transaction.amount), else_=0)), 0),
    ).join(Category, Transaction.category_id == Category.category_id).where(*filters))
    revenue, expenses = totals.one()
    breakdowns = {}
    for key, model, id_column in (
        ('category', Category, Category.category_id),
        ('department', Department, Department.department_id),
        ('project', Project, Project.project_id),
    ):
        stmt = select(id_column, model.name, func.sum(Transaction.amount)).select_from(Transaction).join(
            Category, Transaction.category_id == Category.category_id
        )
        if model != Category:
            transaction_id_column = getattr(Transaction, key + '_id')
            stmt = stmt.outerjoin(model, (transaction_id_column == id_column) &
                                  (model.workspace_id == workspace.workspace_id))
        rows = await db.execute(stmt.where(*filters, Category.type == CategoryType.expense).group_by(
            id_column, model.name
        ).order_by(func.sum(Transaction.amount).desc(), id_column))
        breakdowns['spending_by_' + key] = [
            SpendingGroup(id=group_id, name=name if name is not None else 'Unassigned', amount=amount)
            for group_id, name, amount in rows
        ]
    return BusinessDashboardResponse(
        workspace_id=workspace.workspace_id, currency=workspace.base_currency,
        period_start=start.date(), period_end=end.date(), revenue=revenue,
        expenses=expenses, profit=revenue - expenses, **breakdowns,
    )
