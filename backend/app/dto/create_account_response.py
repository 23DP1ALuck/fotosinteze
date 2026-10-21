import decimal
from pydantic import BaseModel, ConfigDict

class CreateAccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    account_id: int
    name: str
    currency: str
    balance: decimal.Decimal
    workspace_id: int
    connection_id: int | None = None

    is_main: bool = False
