from datetime import date, datetime, time, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import Date, String, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from app.dto.analytics_response import (
    AnalyticsCategoriesResponse, AnalyticsSummaryResponse, AnalyticsTimeseriesResponse, DailySpending,
)
from app.dto.dashboard_response import SpendingGroup
from app.models import Category, Transaction, Workspace, WorkspaceRole
from app.models.category import CategoryType
from app.models.workspace import WorkspaceTypeEnum
from app.services.workspace_access import get_workspace_membership


async def _transaction_query(workspace: Workspace, current_user: dict, db: AsyncSession,
                             date_from: date, date_to: date) -> Select:
    if date_from > date_to:
        raise HTTPException(status_code=400, detail='date_from must be on or before date_to')
    query = select().select_from(Transaction).join(
        Category, Transaction.category_id == Category.category_id
    ).where(
        Transaction.workspace_id == workspace.workspace_id,
        ((Category.workspace_id.is_(None)) | (Category.workspace_id == workspace.workspace_id)),
        Transaction.currency == workspace.base_currency,
        Transaction.created_at >= datetime.combine(date_from, time.min),
        Transaction.created_at <= datetime.combine(date_to, time.max),
    )
    if workspace.type == WorkspaceTypeEnum.BUSINESS:
        membership = await get_workspace_membership(current_user, workspace.workspace_id, db)
        if membership.role != WorkspaceRole.OWNER:
            query = query.where(Transaction.department_id == membership.department_id)
    return query


async def get_summary(workspace: Workspace, current_user: dict, db: AsyncSession,
                      date_from: date, date_to: date) -> AnalyticsSummaryResponse:
    query = await _transaction_query(workspace, current_user, db, date_from, date_to)
    totals = await db.execute(query.add_columns(
        func.coalesce(func.sum(case((Category.type == CategoryType.income, Transaction.amount), else_=0)), 0),
        func.coalesce(func.sum(case((Category.type == CategoryType.expense, Transaction.amount), else_=0)), 0),
    ))
    income, expenses = totals.one()
    return AnalyticsSummaryResponse(
        workspace_id=workspace.workspace_id, currency=workspace.base_currency,
        date_from=date_from, date_to=date_to, income=income, expenses=expenses,
    )


async def get_categories(workspace: Workspace, current_user: dict, db: AsyncSession,
                         date_from: date, date_to: date) -> AnalyticsCategoriesResponse:
    query = await _transaction_query(workspace, current_user, db, date_from, date_to)
    amount = func.sum(Transaction.amount)
    rows = await db.execute(query.add_columns(Category.category_id, Category.name, amount).where(
        Category.type == CategoryType.expense
    ).group_by(Category.category_id, Category.name).order_by(amount.desc(), Category.category_id))
    return AnalyticsCategoriesResponse(
        workspace_id=workspace.workspace_id, currency=workspace.base_currency,
        date_from=date_from, date_to=date_to,
        items=[SpendingGroup(id=category_id, name=name, amount=total) for category_id, name, total in rows],
    )


async def get_timeseries(workspace: Workspace, current_user: dict, db: AsyncSession,
                         date_from: date, date_to: date) -> AnalyticsTimeseriesResponse:
    day_count = (date_to - date_from).days + 1
    if day_count > 3660:
        raise HTTPException(status_code=400, detail='Daily spending is limited to 3660 inclusive days')
    query = await _transaction_query(workspace, current_user, db, date_from, date_to)
    # Strip the time first: SQLite date() overflows at date.max's final microsecond.
    day = func.date(func.substr(cast(Transaction.created_at, String), 1, 10), type_=Date)
    rows = await db.execute(query.add_columns(day, func.sum(Transaction.amount)).where(
        Category.type == CategoryType.expense
    ).group_by(day))
    spending = dict(rows.all())
    days = (date_from + timedelta(days=offset) for offset in range(day_count))
    return AnalyticsTimeseriesResponse(
        workspace_id=workspace.workspace_id, currency=workspace.base_currency,
        date_from=date_from, date_to=date_to,
        items=[DailySpending(date=day, amount=spending.get(day, Decimal('0.00'))) for day in days],
    )
