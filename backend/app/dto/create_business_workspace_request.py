from pydantic import BaseModel, Field

class CreateBusinessWorkspaceRequest(BaseModel):
    name: str = Field(str, example="Accenture")
    base_currency: str = Field(str,examples=["USD"])