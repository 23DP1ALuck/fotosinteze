from fastapi import APIRouter, Depends

from app.dependencies.auth import get_current_user
from app.dependencies.workspace import get_current_workspace

from app.services import category_service
from app.database import get_db_session, AsyncSession
from app.dto import CategoryResponseDTO, CreateCategoryRequest, UpdateCategoryRequest
from app.models import Workspace

router = APIRouter()

@router.get("/categories",status_code=200, response_model=list[CategoryResponseDTO], tags=["categories"])
async def get_categories(current_user: dict = Depends(get_current_user),
                         workspace: Workspace = Depends(get_current_workspace),
                         db: AsyncSession = Depends(get_db_session)):
    return await category_service.get_categories(current_user, workspace, db)


@router.get("/categories/{category_id}", response_model=CategoryResponseDTO, tags=["categories"])
async def get_category_by_id(
    category_id: int,
    current_user: dict = Depends(get_current_user),
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db_session),
):
    return await category_service.get_category_by_id(
        category_id, current_user, workspace, db
    )


@router.put("/categories/{category_id}", response_model=CategoryResponseDTO, tags=["categories"])
async def update_category(
    category_id: int,
    request: UpdateCategoryRequest,
    current_user: dict = Depends(get_current_user),
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db_session),
):
    return await category_service.update_category(
        category_id, request, current_user, workspace, db
    )
@router.post(
    "/categories",
    status_code=201,
    response_model=CategoryResponseDTO,
    tags=["categories"],
)
async def create_category(
    request: CreateCategoryRequest,
    current_user: dict = Depends(get_current_user),
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db_session),
):
    return await category_service.create_category(
        request, current_user, workspace, db
    )


@router.delete("/categories/{category_id}", status_code=204, tags=["categories"])
async def delete_category(
    category_id: int,
    current_user: dict = Depends(get_current_user),
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db_session),
) -> None:
    await category_service.delete_category(
        category_id, current_user, workspace, db
    )
