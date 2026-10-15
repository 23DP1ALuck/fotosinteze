from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field, field_validator


class CreateAccountRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=120)
    currency: str = Field(pattern=r'^[A-Z]{3}$')
    balance: Decimal = Field(max_digits=10, decimal_places=2)

    @field_validator('name')
    @classmethod
    def nonempty_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError('Name must not be empty')
        return value
