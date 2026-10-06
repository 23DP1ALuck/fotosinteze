import enum
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, String, DECIMAL, CHAR, Enum, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models import Account, Category, Project, Department, Expense, Workspace

class TransactionSourceEnum(enum.Enum):
    manual = "MANUAL",
    bank = "BANK",
    expense = "EXPENSE"

class Transaction(Base):
    __tablename__ = "transactions"

    transaction_id: Mapped[int] = mapped_column(BigInteger,primary_key=True)
    external_transaction_id: Mapped[str] = mapped_column(String(255), nullable=True)
    amount: Mapped[Decimal] = mapped_column(DECIMAL(10,2), nullable=False)
    currency: Mapped[str] = mapped_column(CHAR(3), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[TransactionSourceEnum] = mapped_column(Enum(TransactionSourceEnum), nullable=False)

    account_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("accounts.account_id"), nullable=False)
    account: Mapped["Account"] = relationship("Account", back_populates="transactions")

    category_id: Mapped[int] = mapped_column(ForeignKey("category.category_id"), nullable=True)
    category: Mapped["Category"] = relationship("Category", back_populates="transactions")

    project_id: Mapped[int] = mapped_column(ForeignKey("projects.project_id"), nullable=False)
    project: Mapped["Project"] = relationship("Project", back_populates="transactions")

    department_id: Mapped[int] = mapped_column(ForeignKey("departments.department_id"), nullable=True)
    department: Mapped["Department"] = relationship("Department", back_populates="transactions")

    expense_id: Mapped[int] = mapped_column(ForeignKey("expenses.expense_id"), nullable=True)
    expense: Mapped["Expense"] = relationship("Expense", back_populates="transactions")

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.workspace_id"), nullable=False)
    workspace: Mapped["Workspace"] = relationship("Workspace", back_populates="transactions")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)
