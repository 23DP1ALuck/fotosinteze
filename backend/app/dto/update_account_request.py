from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator
from app.dto.create_account_request import CreateAccountRequest


class UpdateAccountRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    is_main: StrictBool | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    balance: Decimal | None = Field(default=None, max_digits=10, decimal_places=2)

    @field_validator('name', 'balance', 'is_main')
    @classmethod
    def reject_null(cls, value):
        if value is None:
            raise ValueError('Editable fields cannot be null')
        return value

    @field_validator('name')
    @classmethod
    def nonempty_name(cls, value: str) -> str:
        return CreateAccountRequest.nonempty_name(value)
