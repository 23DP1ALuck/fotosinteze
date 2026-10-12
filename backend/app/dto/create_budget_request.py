from datetime import date

from pydantic import BaseModel
from pydantic import Field
from decimal import Decimal

from app.models import BudgetPeriod


class CreateBudgetRequest(BaseModel):
    category_id: int
    project_id: int | None = None
    department_id: int | None = None
    name: str = Field(..., max_length=100, description="Name of the budget")
    limit_amount: Decimal = Field(..., gt=0, description="Maximum spending limit")
    currency: str = Field(..., min_length=3, max_length=3, description="3-letter ISO currency code (e.g., USD)")
    period_start: date|None = Field(default_factory=date.today, description="Start date of the budget period")
    period_length: BudgetPeriod
    duration_days: int | None = Field(None, gt=0, description="Required only if period_length is CUSTOM")
