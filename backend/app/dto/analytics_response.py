from datetime import date
from decimal import Decimal

from pydantic import BaseModel

from app.dto.dashboard_response import SpendingGroup


class AnalyticsResponse(BaseModel):
    workspace_id: int
    currency: str
    date_from: date
    date_to: date


class AnalyticsSummaryResponse(AnalyticsResponse):
    income: Decimal
    expenses: Decimal


class AnalyticsCategoriesResponse(AnalyticsResponse):
    items: list[SpendingGroup]


class DailySpending(BaseModel):
    date: date
    amount: Decimal


class AnalyticsTimeseriesResponse(AnalyticsResponse):
    items: list[DailySpending]
