import decimal

from pydantic import BaseModel

class CreateAccountRequest(BaseModel):
    name: str
    currency: str
    balance: decimal.Decimal
    workspace_id: int