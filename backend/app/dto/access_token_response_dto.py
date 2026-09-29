from pydantic import BaseModel


class AccessTokenResponseDTO(BaseModel):
    access_token: str
