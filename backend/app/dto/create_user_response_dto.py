from datetime import datetime
from pydantic import Field
from pydantic import BaseModel
class CreateUserResponseDTO(BaseModel):
    id: int
    display_name: str = Field(example="John Doe")
    email: str = Field(example="user@example.com")
    created_at: datetime = Field(example=datetime.now())
