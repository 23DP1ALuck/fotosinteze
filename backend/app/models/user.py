from datetime import datetime

from app.database import Base
from typing import TYPE_CHECKING, List

from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, DateTime

if TYPE_CHECKING: # need specify to prevent circular import error
    from app.models import WorkspaceUsers, RevolutConnection, Expense, WorkspaceRole

class User(Base):
    __tablename__ = "users"

    user_id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255),unique=True, index=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(255),index=True, nullable=False)
    password: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)

    workspace_memberships: Mapped[List["WorkspaceUsers"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )

    revolut_connections: Mapped[List["RevolutConnection"]] = relationship(
        back_populates="connected_by",
        cascade="all, delete-orphan",
    )
    submitted_expenses: Mapped[List["Expense"]] = relationship(
        foreign_keys="Expense.submitted_by",
        back_populates="submitted_by_user",
    )
    reviewed_expenses: Mapped[List["Expense"]] = relationship(
        foreign_keys="Expense.reviewed_by",
        back_populates="reviewed_by_user",
    )

    def owns_workspace(self, workspace_id: int) -> bool:
        return any(
            membership.workspace_id == workspace_id
            and membership.role == WorkspaceRole.owner
            for membership in self.workspace_memberships
        )