from fastapi import HTTPException
from sqlalchemy import select, update

from app.database import AsyncSession
from app.models import Budget, Workspace


async def check_budget_category(workspace_id: int, category_id: int | None,
                                db: AsyncSession, budget_id: int | None = None) -> None:
    if category_id is None:
        return
    # Serialize category assignments across both budget APIs until commit/rollback.
    # A no-op UPDATE also locks on SQLite, where SELECT FOR UPDATE is ignored.
    await db.execute(update(Workspace).where(Workspace.workspace_id == workspace_id)
                     .values(updated_at=Workspace.updated_at).execution_options(synchronize_session=False))
    if budget_id is not None:
        original_category = await db.scalar(select(Budget.category_id).where(
            Budget.workspace_id == workspace_id, Budget.budget_id == budget_id))
        # Preserve legacy duplicate budgets without preventing unrelated edits.
        if original_category == category_id:
            return
    duplicate = await db.scalar(select(Budget.budget_id).where(
        Budget.workspace_id == workspace_id,
        Budget.category_id == category_id,
        Budget.budget_id != budget_id if budget_id is not None else True,
    ).limit(1))
    if duplicate is not None:
        raise HTTPException(status_code=409, detail='This category already has a budget. Edit the existing budget or choose another category.')
