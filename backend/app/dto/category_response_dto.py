from app.models.category import CategoryType
from pydantic import BaseModel

class CategoryResponseDTO(BaseModel):
    name: str
    type: CategoryType
    workspace_id: int | None
    category_id: int