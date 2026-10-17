from datetime import date
from decimal import Decimal
from typing import Self

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models import BudgetPeriod


class CreateBudgetRequest(BaseModel):
    category_id: int | None = Field(None, gt=0)
    project_id: int | None = Field(None, gt=0)
    department_id: int | None = Field(None, gt=0)
    name: str = Field(..., min_length=1, max_length=100)
    limit_amount: Decimal = Field(..., gt=0, max_digits=10, decimal_places=2)
    currency: str = Field(..., pattern=r"^[A-Z]{3}$")
    period_start: date = Field(default_factory=date.today)
    period_length: BudgetPeriod
    duration_days: int | None = Field(None, gt=0)

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("currency", mode="before")
    @classmethod
    def normalize_currency(cls, value):
        return value.strip().upper() if isinstance(value, str) else value

    @model_validator(mode="after")
    def validate_duration(self) -> Self:
        if self.period_length == BudgetPeriod.CUSTOM:
            if self.duration_days is None:
                raise ValueError("Custom budgets require duration_days")
        elif self.duration_days is not None:
            raise ValueError("duration_days is only allowed for custom budgets")
        return self
