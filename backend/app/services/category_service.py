from fastapi import HTTPException
from app.models import Workspace, Category
from app.database import AsyncSession

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
    categories_stmt: Select = (select(Category)
                               .where(
        Category.workspace_id == membership.workspace_id
        if membership else Category.workspace_id == active_workspace.workspace_id)
    )
    categories_result = await db.execute(categories_stmt)
    categories = categories_result.scalars().all()

    return [CategoryResponseDTO(
        name=category.name,
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
            Category.workspace_id == workspace_id,
        )
    )
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")

    return CategoryResponseDTO(
        name=category.name,
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
    update_request_data = request.model_dump(exclude_unset=True)
    for field, value in update_request_data.items():
        setattr(category, field, value)
    await db.commit()
    await db.refresh(category)

    return CategoryResponseDTO(
        name=category.name,
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
        type=category.type,
    )
