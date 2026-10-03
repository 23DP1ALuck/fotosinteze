from app.database import Base
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import ForeignKey, String, DateTime, Enum, Numeric

from datetime import datetime
from decimal import Decimal
import enum
from typing import TYPE_CHECKING



if TYPE_CHECKING:
    from app.models import Workspace, User, Department, Project, Category

class ExpenseStatusEnum(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"

class Expense(Base):
    __tablename__ = "expenses"

    expense_id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.workspace_id"), nullable=False)
    submitted_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"), nullable=True)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.department_id", ondelete="SET NULL"), nullable=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.project_id", ondelete="SET NULL"), nullable=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("category.category_id", ondelete="SET NULL"), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    receipt_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[ExpenseStatusEnum] = mapped_column(Enum(ExpenseStatusEnum), default=ExpenseStatusEnum.pending, nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, default=None, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)

    workspace: Mapped["Workspace"] = relationship(back_populates="expenses")
    department: Mapped["Department | None"] = relationship(back_populates="expenses")
    project: Mapped["Project | None"] = relationship(back_populates="expenses")
    category: Mapped["Category | None"] = relationship(back_populates="expenses")
    submitted_by_user: Mapped["User"] = relationship(
        foreign_keys=[submitted_by],
        back_populates="submitted_expenses",
    )
    reviewed_by_user: Mapped["User | None"] = relationship(
        foreign_keys=[reviewed_by],
        back_populates="reviewed_expenses",
    )
