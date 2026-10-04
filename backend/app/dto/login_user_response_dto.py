from pydantic import BaseModel, Field
class LoginUserResponseDTO(BaseModel):
    access_token: str = Field(..., description="JWT access token")
    refresh_token: str = Field(..., description="JWT refresh token")
