from fastapi import HTTPException
from app.models import Workspace, Category
from app.database import AsyncSession

from sqlalchemy import select, Select

from app.dto import CategoryResponseDTO, CreateCategoryRequest, UpdateCategoryRequest
from app.services.workspace_access import get_workspace_membership
from app.models.category import CategoryType


async def get_categories(current_user: dict[str, str], active_workspace: Workspace, db: AsyncSession)-> list[CategoryResponseDTO]:
    membership = await get_workspace_membership(
        current_user, active_workspace.workspace_id,db, False
    )
    categories_stmt: Select = (select(Category)
                               .where(Category.workspace_id == membership.workspace_id))
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
    membership = await get_workspace_membership(
        current_user, active_workspace.workspace_id, db
    )
    category = await db.scalar(
        select(Category).where(
            Category.category_id == category_id,
            Category.workspace_id == membership.workspace_id,
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
    membership = await get_workspace_membership(
        current_user, active_workspace.workspace_id, db, owner_only=True
    )
    category = await db.scalar(
        select(Category).where(
            Category.category_id == category_id,
            Category.workspace_id == membership.workspace_id,
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
    membership = await get_workspace_membership(
        current_user, active_workspace.workspace_id, db, owner_only=True
    )
    category = await db.scalar(
        select(Category).where(
            Category.category_id == category_id,
            Category.workspace_id == membership.workspace_id,
        )
    )
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")

    await db.delete(category)
    await db.commit()


async def create_category(request: CreateCategoryRequest,
                          current_user: dict[str, str],
                          active_workspace: Workspace,
                          db: AsyncSession) -> CategoryResponseDTO:
    membership = await get_workspace_membership(
        current_user, active_workspace.workspace_id, db, True
    ) #in business workspace only owner can create a category, so owner_only = True
    if len(request.name.strip()) == 0:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    if request.type != CategoryType.income or request.type != CategoryType.expense:
        raise HTTPException(status_code=400, detail="Invalid type")
    category = Category(
        name=request.name.strip(),
        type=request.type,
        workspace_id=membership.workspace_id,
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
