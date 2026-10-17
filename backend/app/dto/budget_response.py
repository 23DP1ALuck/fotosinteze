from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models import BudgetPeriod
from pydantic import Field

class BudgetResponseDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    budget_id: int
    workspace_id: int
    category_id: int | None
    department_id: int | None
    project_id: int | None
    name: str
    currency: str
    limit_amount: Decimal = Field(..., gt=0, max_digits=10, decimal_places=2)
    current_spent: Decimal = Decimal("0")
    period_start: date
    period_length: BudgetPeriod
    duration_days: int | None
    created_at: datetime
    updated_at: datetime
