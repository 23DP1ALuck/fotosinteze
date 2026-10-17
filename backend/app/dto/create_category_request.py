from pydantic import BaseModel
from app.models.category import CategoryType

class CreateCategoryRequest(BaseModel):
    name: str
    type: CategoryType
