from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel
from app.models.expenses import ExpenseStatusEnum

class ExpenseResponseDTO(BaseModel):
    id: int
    amount: Decimal
    currency: str
    workspace_id: int
    department_id: int | None
    project_id: int | None
    category_id: int
    status: ExpenseStatusEnum
    description: str
    receipt_url: str | None
    submitted_by: int
    created_at: datetime
    updated_at: datetime
    reviewed_at: datetime | None = None
    reviewed_by: int | None = None
