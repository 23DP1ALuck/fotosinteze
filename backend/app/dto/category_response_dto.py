from app.models.category import CategoryType
from pydantic import BaseModel

class CategoryResponseDTO(BaseModel):
    icon: str | None = None
    name: str
    type: CategoryType
    workspace_id: int | None
    category_id: int
