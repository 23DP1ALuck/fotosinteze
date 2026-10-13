from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field, field_validator

class CreateExpenseRequestDTO(BaseModel):
    model_config = ConfigDict(extra='forbid')
    department_id: int | None = None
    project_id: int | None = None
    category_id: int
    # Approval creates a transaction, whose amount has 10-digit precision.
    amount: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    currency: str = Field(pattern=r'^[A-Z]{3}$')
    description: str = Field(min_length=1, max_length=255)
    receipt_url: str | None = Field(default=None, max_length=255)

    @field_validator('description')
    @classmethod
    def nonempty_description(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError('Description must not be empty')
        return value
