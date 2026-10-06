import decimal
from pydantic import BaseModel

class CreateAccountResponse(BaseModel):
    account_id: int
    name: str
    currency: str
    balance: decimal.Decimal
    workspace_id: int
    connection_id: int | None = None