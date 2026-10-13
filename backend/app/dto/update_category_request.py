from pydantic import BaseModel

from app.models.category import CategoryType


class UpdateCategoryRequest(BaseModel):
    name: str
    type: CategoryType
