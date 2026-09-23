from pydantic import BaseModel, Field
class LoginUserRequestDTO(BaseModel):
    email: str = Field(min_length=5, max_length=100, example="user@example.com")
    password: str = Field(min_length=8, max_length=255, example="w4%sseS#es")