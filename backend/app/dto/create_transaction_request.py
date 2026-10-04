from decimal import Decimal

from pydantic import BaseModel

class CreateTransactionRequest(BaseModel):
    amount: Decimal
    description: str
    currency: str
    account_id: int
    category_id: int
    project_id: int | None = None
    department_id: int | None = None
    workspace_id: int
