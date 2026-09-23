from pydantic import BaseModel, Field
class CreateUserDTO(BaseModel):
    email: str = Field(min_length=5, max_length=100, example="user@example.com")
    display_name: str = Field(min_length=2, max_length=100, example="John Doe")
    password: str = Field(min_length=8, max_length=255, example="w4%sseS#es")