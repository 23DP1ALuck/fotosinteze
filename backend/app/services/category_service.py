from fastapi import HTTPException
from app.models import Workspace, Category, Transaction
from app.models.transaction import TransactionSourceEnum
from app.database import AsyncSession
from app.services.name_uniqueness import check_unique_name

from sqlalchemy import select, Select, or_

from app.dto import CategoryResponseDTO, CreateCategoryRequest, UpdateCategoryRequest
from app.services.workspace_access import get_workspace_membership
from app.models.category import CategoryType
from app.models.workspace import WorkspaceTypeEnum


async def get_categories(current_user: dict[str, str], active_workspace: Workspace, db: AsyncSession)-> list[CategoryResponseDTO]:
    membership = {}
    if active_workspace.type == WorkspaceTypeEnum.BUSINESS:
        membership = await get_workspace_membership(
            current_user, active_workspace.workspace_id, db
        )
    workspace_id = membership.workspace_id if membership else active_workspace.workspace_id
    categories_stmt: Select = select(Category).where(
        or_(Category.workspace_id.is_(None), Category.workspace_id == workspace_id)
    )
    categories_result = await db.execute(categories_stmt)
    categories = categories_result.scalars().all()

    return [CategoryResponseDTO(
        name=category.name,
        icon=category.icon,
        type=category.type,
        workspace_id=category.workspace_id,
        category_id= category.category_id)
        for category in categories]


async def get_category_by_id(
    category_id: int,
    current_user: dict[str, str],
    active_workspace: Workspace,
    db: AsyncSession,
) -> CategoryResponseDTO:
    membership = {}
    if active_workspace.type == WorkspaceTypeEnum.BUSINESS:
        membership = await get_workspace_membership(
            current_user, active_workspace.workspace_id, db
        )
    workspace_id = membership.workspace_id if membership else active_workspace.workspace_id
    category = await db.scalar(
        select(Category).where(
            Category.category_id == category_id,
            or_(Category.workspace_id.is_(None), Category.workspace_id == workspace_id),
        )
    )
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")

    return CategoryResponseDTO(
        name=category.name,
        icon=category.icon,
        type=category.type,
        workspace_id=category.workspace_id,
        category_id=category.category_id,
    )


async def update_category(
    category_id: int,
    request: UpdateCategoryRequest,
    current_user: dict[str, str],
    active_workspace: Workspace,
    db: AsyncSession,
) -> CategoryResponseDTO:
    membership = {}
    if active_workspace.type == WorkspaceTypeEnum.BUSINESS:
        membership = await get_workspace_membership(
            current_user, active_workspace.workspace_id, db, True
        )  # in business workspace only owner can create a category, so owner_only = True
    workspace_id = membership.workspace_id if membership else active_workspace.workspace_id
    category = await db.scalar(
        select(Category).where(
            Category.category_id == category_id,
            Category.workspace_id == workspace_id,
        )
    )
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")
    if not request.name.strip():
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    await check_unique_name(db, Category.name, request.name,
        Category.workspace_id == workspace_id, Category.category_id != category_id,
        detail='Category name is already taken in this workspace')
    if request.type != category.type and await db.scalar(select(Transaction.transaction_id).where(
            Transaction.category_id == category_id, Transaction.source == TransactionSourceEnum.BANK).limit(1)):
        raise HTTPException(409, 'The income/expense type of a category used by bank transactions cannot be changed')
    update_request_data = request.model_dump(exclude_unset=True)
    update_request_data['name'] = request.name.strip()
    for field, value in update_request_data.items():
        setattr(category, field, value)
    await db.commit()
    await db.refresh(category)

    return CategoryResponseDTO(
        name=category.name,
        icon=category.icon,
        type=category.type,
        workspace_id=category.workspace_id,
        category_id=category.category_id,
    )


async def delete_category(
    category_id: int,
    current_user: dict[str, str],
    active_workspace: Workspace,
    db: AsyncSession,
) -> None:
    membership = {}
    if active_workspace.type == WorkspaceTypeEnum.BUSINESS:
        membership = await get_workspace_membership(
            current_user, active_workspace.workspace_id, db, True
        )  # in business workspace only owner can delete a category
    workspace_id = membership.workspace_id if membership else active_workspace.workspace_id
    category = await db.scalar(
        select(Category).where(
            Category.category_id == category_id,
            Category.workspace_id == workspace_id,
        )
    )
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")

    in_use = await db.scalar(select(or_(
        Category.expenses.any(),
        Category.transactions.any(),
        Category.budgets.any(),
    )).where(Category.category_id == category_id))
    if in_use:
        raise HTTPException(status_code=409, detail="Category is used by expense requests, transactions or budgets and cannot be deleted")

    await db.delete(category)
    await db.commit()


async def create_category(request: CreateCategoryRequest,
                          current_user: dict[str, str],
                          active_workspace: Workspace,
                          db: AsyncSession) -> CategoryResponseDTO:
    membership = {}
    if active_workspace.type == WorkspaceTypeEnum.BUSINESS:
        membership = await get_workspace_membership(
            current_user, active_workspace.workspace_id, db, True
        ) #in business workspace only owner can create a category, so owner_only = True
    workspace_id = membership.workspace_id if membership else active_workspace.workspace_id

    if len(request.name.strip()) == 0:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    if request.type not in (CategoryType.income, CategoryType.expense):
        raise HTTPException(status_code=400, detail="Invalid type")
    await check_unique_name(db, Category.name, request.name, Category.workspace_id == workspace_id,
        detail='Category name is already taken in this workspace')
    category = Category(
        name=request.name.strip(),
        type=request.type,
        workspace_id=workspace_id,
    )
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return CategoryResponseDTO(
        category_id=category.category_id,
        workspace_id=category.workspace_id,
        name=category.name,
        icon=category.icon,
        type=category.type,
    )
