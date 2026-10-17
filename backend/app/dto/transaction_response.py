from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel

from app.models.transaction import TransactionSourceEnum


class TransactionResponseDTO(BaseModel):
    transaction_id: int
    amount: Decimal
    currency: str
    description: str
    source: TransactionSourceEnum
    account_id: int
    category_id: int | None
    project_id: int | None
    department_id: int | None
    expense_id: int | None
    workspace_id: int
    created_at: datetime
    updated_at: datetime


class TransactionListResponseDTO(BaseModel):
    items: list[TransactionResponseDTO]
    limit: int
    offset: int
    has_more: bool
