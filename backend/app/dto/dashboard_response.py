from datetime import date
from decimal import Decimal

from pydantic import BaseModel

from app.dto.transaction_response import TransactionResponseDTO


class DashboardResponse(BaseModel):
    workspace_id: int
    currency: str
    period_start: date
    period_end: date
    balance: Decimal
    income: Decimal
    expenses: Decimal
    savings: Decimal
    recent_transactions: list[TransactionResponseDTO]
