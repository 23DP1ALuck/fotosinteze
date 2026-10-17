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


class SpendingGroup(BaseModel):
    id: int | None
    name: str
    amount: Decimal


class BusinessDashboardResponse(BaseModel):
    workspace_id: int
    currency: str
    period_start: date
    period_end: date
    revenue: Decimal
    expenses: Decimal
    profit: Decimal
    spending_by_category: list[SpendingGroup]
    spending_by_department: list[SpendingGroup]
    spending_by_project: list[SpendingGroup]
