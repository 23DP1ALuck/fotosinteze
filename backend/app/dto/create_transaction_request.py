from pydantic import BaseModel

class CreateTransactionRequest(BaseModel):
    amount: float
    description: str
    currency: str
    status: str
    account_id: int | None
    category_id: int | None
    project_id: int | None
    department_id: int | None
    workspace_id: int
