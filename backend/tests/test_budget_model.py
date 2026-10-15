import unittest

from sqlalchemy import CHAR, Date, DateTime, Numeric

import app.models  # noqa: F401 - imports the application model registry
from app.database import Base
from app.dto.create_budget_request import CreateBudgetRequest


class BudgetModelTests(unittest.TestCase):
    def test_budget_table_matches_budget_schema(self):
        self.assertIn("budgets", Base.metadata.tables)
        table = Base.metadata.tables["budgets"]

        self.assertEqual(
            [column.name for column in table.columns],
            [
                "budget_id",
                "category_id",
                "project_id",
                "department_id",
                "workspace_id",
                "name",
                "limit_amount",
                "currency",
                "period_start",
                "period_length",
                "duration_days",
                "created_at",
                "updated_at",
            ],
        )
        self.assertTrue(table.c.category_id.nullable)
        self.assertTrue(table.c.project_id.nullable)
        self.assertTrue(table.c.department_id.nullable)
        self.assertFalse(table.c.name.nullable)
        self.assertFalse(table.c.limit_amount.nullable)
        self.assertFalse(table.c.currency.nullable)
        self.assertFalse(table.c.period_start.nullable)
        self.assertFalse(table.c.period_length.nullable)
        self.assertTrue(table.c.duration_days.nullable)
        self.assertFalse(table.c.created_at.nullable)
        self.assertFalse(table.c.updated_at.nullable)

        self.assertIsInstance(table.c.limit_amount.type, Numeric)
        self.assertEqual((table.c.limit_amount.type.precision, table.c.limit_amount.type.scale), (10, 2))
        self.assertIsInstance(table.c.currency.type, CHAR)
        self.assertEqual(table.c.currency.type.length, 3)
        self.assertIsInstance(table.c.period_start.type, Date)
        self.assertIsInstance(table.c.created_at.type, DateTime)
        self.assertIsInstance(table.c.updated_at.type, DateTime)

        self.assertEqual(
            {str(foreign_key.target_fullname) for foreign_key in table.c.category_id.foreign_keys},
            {"category.category_id"},
        )
        self.assertEqual(
            {str(foreign_key.target_fullname) for foreign_key in table.c.project_id.foreign_keys},
            {"projects.project_id"},
        )
        self.assertEqual(
            {str(foreign_key.target_fullname) for foreign_key in table.c.department_id.foreign_keys},
            {"departments.department_id"},
        )

    def test_create_budget_request_allows_missing_category(self):
        request = CreateBudgetRequest(
            name="General budget",
            limit_amount=100,
            currency="EUR",
            period_length="MONTHLY",
        )

        self.assertIsNone(request.category_id)


if __name__ == "__main__":
    unittest.main()
