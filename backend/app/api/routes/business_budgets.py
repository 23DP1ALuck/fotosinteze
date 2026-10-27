"""Business budgets are scoped through their required, single target relation."""
from app.services.name_uniqueness import check_unique_name
from app.services.budget_category_uniqueness import check_budget_category
import calendar
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import and_, func, or_, select

from app.database import get_db_session
from app.dependencies.auth import get_current_user
from app.dependencies.workspace import get_current_workspace
from app.models import Budget, BudgetPeriod, Category, Department, Project, Transaction, WorkspaceRole
from app.models.category import CategoryType
from app.services.workspace_access import get_workspace_membership

router = APIRouter(prefix='/business-budgets', tags=['Business budgets'], responses={409: {'description': 'Budget name or category already in use in this workspace'}})
TARGETS = {'CATEGORY': (Category, 'category_id'), 'DEPARTMENT': (Department, 'department_id'), 'PROJECT': (Project, 'project_id')}


class BusinessBudgetInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=100)
    target_type: Literal['CATEGORY', 'DEPARTMENT', 'PROJECT']
    target_id: int = Field(gt=0)
    limit_amount: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    currency: str = Field(pattern=r'^[A-Z]{3}$')
    period_start: date
    period_length: BudgetPeriod
    duration_days: int | None = Field(default=None, gt=0, le=3660)

    @field_validator('name')
    @classmethod
    def trim_name(cls, value):
        if not value.strip():
            raise ValueError('Enter a budget name')
        return value.strip()

    @model_validator(mode='after')
    def custom_duration(self):
        if (self.period_length == BudgetPeriod.CUSTOM) != (self.duration_days is not None):
            raise ValueError('Specify duration days only for a custom period')
        try:
            period_end(self.period_start, self.period_length, self.duration_days)
        except (ValueError, OverflowError):
            raise ValueError('Budget period ends outside the supported date range')
        return self


def period_end(start, length, days):
    if length == BudgetPeriod.MONTHLY:
        month = start.month % 12 + 1
        year = start.year + (start.month == 12)
        return date(year, month, min(start.day, calendar.monthrange(year, month)[1]))
    return start + timedelta(days=7 if length == BudgetPeriod.WEEKLY else days)


async def context(workspace=Depends(get_current_workspace), user=Depends(get_current_user), db=Depends(get_db_session)):
    membership = await get_workspace_membership(user, workspace.workspace_id, db)
    return workspace, membership, db


async def catalog(workspace_id, db):
    result = {}
    for kind, (model, key) in TARGETS.items():
        stmt = select(model).where(model.workspace_id == workspace_id).order_by(model.name)
        if kind == 'CATEGORY':
            stmt = stmt.where(Category.type == CategoryType.expense)
        result[kind] = [{'id': getattr(row, key), 'name': row.name} for row in (await db.scalars(stmt)).all()]
    return result


async def visible_budgets(workspace, membership, db):
    # Require exactly one target, including for legacy rows. This prevents an
    # ambiguous legacy budget from exposing another workspace's progress.
    clauses = []
    for kind, (model, key) in TARGETS.items():
        conditions = [getattr(Budget, key).in_(select(getattr(model, key)).where(model.workspace_id == workspace.workspace_id))]
        conditions.extend(getattr(Budget, other).is_(None) for _, other in TARGETS.values() if other != key)
        if membership.role != WorkspaceRole.OWNER:
            if kind == 'CATEGORY':
                continue  # Company-wide category totals are owner-only.
            if kind == 'DEPARTMENT':
                conditions.append(Budget.department_id == membership.department_id)
            else:
                conditions.append(Budget.project_id.in_(select(Project.project_id).where(Project.departments.any(Department.department_id == membership.department_id))))
        clauses.append(and_(*conditions))
    return (await db.scalars(select(Budget).where(Budget.workspace_id == workspace.workspace_id, or_(*clauses)).order_by(Budget.budget_id))).all()


async def serialize(row, workspace, membership, db):
    kind, key = next((kind, key) for kind, (_, key) in TARGETS.items() if getattr(row, key) is not None)
    model = TARGETS[kind][0]
    target = await db.get(model, getattr(row, key))
    end = period_end(row.period_start, row.period_length, row.duration_days)
    stmt = select(func.coalesce(func.sum(Transaction.amount), 0)).join(Category, Transaction.category_id == Category.category_id).where(
        Transaction.workspace_id == workspace.workspace_id, Transaction.currency == row.currency,
        Category.type == CategoryType.expense, getattr(Transaction, key) == getattr(row, key),
        Transaction.created_at >= datetime.combine(row.period_start, time.min),
        Transaction.created_at < datetime.combine(end, time.min),
    )
    if membership.role != WorkspaceRole.OWNER:
        stmt = stmt.where(Transaction.department_id == membership.department_id)
    spent = Decimal(await db.scalar(stmt))
    return dict(id=row.budget_id, workspace_id=workspace.workspace_id, name=row.name,
                target_type=kind, target_id=getattr(row, key), target_name=target.name,
                limit_amount=str(row.limit_amount), currency=row.currency, period_start=row.period_start,
                period_end=end, period_length=row.period_length, duration_days=row.duration_days,
                spent=str(spent), remaining=str(row.limit_amount - spent),
                status='EXCEEDED' if spent > row.limit_amount else 'WARNING' if spent >= row.limit_amount * Decimal('.8') else 'ON_TRACK')


@router.get('')
async def list_budgets(ctx=Depends(context)):
    workspace, membership, db = ctx
    owner = membership.role == WorkspaceRole.OWNER
    return dict(workspace_id=workspace.workspace_id, can_manage=owner,
                progress_scope='WORKSPACE' if owner else 'ASSIGNED_DEPARTMENT',
                targets=await catalog(workspace.workspace_id, db) if owner else {},
                budgets=[await serialize(row, workspace, membership, db) for row in await visible_budgets(workspace, membership, db)])


async def save_budget(payload, ctx, budget_id=None):
    workspace, membership, db = ctx
    if membership.role != WorkspaceRole.OWNER:
        raise HTTPException(403, 'Workspace owner required')
    row = None
    if budget_id is not None:
        row = next((row for row in await visible_budgets(workspace, membership, db) if row.budget_id == budget_id), None)
        if row is None:
            raise HTTPException(404, 'Budget not found')
    model, key = TARGETS[payload.target_type]
    target = await db.get(model, payload.target_id)
    if target is None or target.workspace_id != workspace.workspace_id or (payload.target_type == 'CATEGORY' and target.type != CategoryType.expense):
        raise HTTPException(400, 'Choose an expense category, department or project from this workspace')
    await check_budget_category(workspace.workspace_id, payload.target_id if payload.target_type == 'CATEGORY' else None, db, budget_id)
    await check_unique_name(db, Budget.name, payload.name,
        Budget.workspace_id == workspace.workspace_id,
        Budget.budget_id != budget_id if budget_id is not None else True,
        detail='Budget name is already taken in this workspace')
    data = payload.model_dump(exclude={'target_type', 'target_id'})
    data.update({field: payload.target_id if field == key else None for _, field in TARGETS.values()})
    if row is None:
        row = Budget(**data, workspace_id=workspace.workspace_id)
        db.add(row)
    else:
        for field, value in data.items():
            setattr(row, field, value)
        row.updated_at = datetime.now()
    await db.commit()
    await db.refresh(row)
    return await serialize(row, workspace, membership, db)


@router.post('', status_code=201)
async def create_budget(payload: BusinessBudgetInput, ctx=Depends(context)):
    return await save_budget(payload, ctx)


@router.put('/{budget_id}')
async def update_budget(budget_id: int, payload: BusinessBudgetInput, ctx=Depends(context)):
    return await save_budget(payload, ctx, budget_id)


@router.delete('/{budget_id}', status_code=204)
async def delete_budget(budget_id: int, ctx=Depends(context)):
    workspace, membership, db = ctx
    if membership.role != WorkspaceRole.OWNER:
        raise HTTPException(403, 'Workspace owner required')
    row = next((row for row in await visible_budgets(workspace, membership, db) if row.budget_id == budget_id), None)
    if row is None:
        raise HTTPException(404, 'Budget not found')
    await db.delete(row)
    await db.commit()
    return Response(status_code=204)
