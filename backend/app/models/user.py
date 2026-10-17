from datetime import datetime

from app.database import Base
from typing import TYPE_CHECKING, List

from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, DateTime
from app.models.workspace import WorkspaceRole

if TYPE_CHECKING: # need specify to prevent circular import error
    from app.models import WorkspaceUsers, RevolutConnection, Expense

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

    def is_member_of_workspace(self, workspace_id: int, needs_to_be_owner: bool) -> bool:
        if not needs_to_be_owner:
            return any(
                membership.workspace_id == workspace_id
                for membership in self.workspace_memberships
            )
        return any(
            membership.workspace_id == workspace_id
            and membership.role == WorkspaceRole.OWNER
            for membership in self.workspace_memberships
        )