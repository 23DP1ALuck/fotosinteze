import enum

from app.database import Base

from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Enum, ForeignKey
from typing import TYPE_CHECKING, List

if TYPE_CHECKING:
    from app.models.workspace import Workspace
    from app.models.expenses import Expense


class CategoryType(enum.Enum):
    income = "INCOME"
    expense = "EXPENSE"

class Category(Base):
    __tablename__ = "category"

    category_id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[CategoryType] = mapped_column(Enum(CategoryType), nullable=False)

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.workspace_id"))
    workspace: Mapped["Workspace"] = relationship(back_populates="categories")
    expenses: Mapped[List["Expense"]] = relationship(back_populates="category")
