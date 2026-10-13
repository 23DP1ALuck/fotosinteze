from pydantic import BaseModel, Field


class UpdateBusinessWorkspaceRequest(BaseModel):
    name: str = Field(examples=['Accenture'])
    base_currency: str = Field(examples=['USD'])
