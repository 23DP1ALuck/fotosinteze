import enum
from datetime import datetime
from typing import List, TYPE_CHECKING

from sqlalchemy import Enum, String, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models import User, Category


class WorkspaceTypeEnum(enum.Enum):
    personal = "PERSONAL"
    business = "BUSINESS"


class WorkspaceRole(enum.Enum):
    owner = "OWNER"
    employee = "EMPLOYEE"

class Workspace(Base):
    __tablename__ = "workspaces"

    workspace_id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(unique=True)
    type: Mapped[WorkspaceTypeEnum] = mapped_column(Enum(WorkspaceTypeEnum), default=WorkspaceTypeEnum.personal)
    base_currency: Mapped[str] = mapped_column(String(3), default="EUR")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)

    memberships: Mapped[List["WorkspaceUsers"]] = relationship(
        back_populates="workspace",
        cascade="all, delete-orphan",
    )
    categories: Mapped[List["Category"]] = relationship(
        back_populates="workspace",
    )


class WorkspaceUsers(Base):
    __tablename__ = "workspace_users"

    user_id: Mapped[int] = mapped_column("user_id", ForeignKey("users.user_id"), primary_key=True)
    workspace_id: Mapped[int] = mapped_column("workspace_id", ForeignKey("workspaces.workspace_id"), primary_key=True)
    role: Mapped[WorkspaceRole] = mapped_column("role", Enum(WorkspaceRole), default=WorkspaceRole.owner, nullable=False)
    joined_at: Mapped[datetime] = mapped_column("joined_at", DateTime, default=datetime.now, nullable=False)

    workspace: Mapped["Workspace"] = relationship(back_populates="memberships")
    user: Mapped["User"] = relationship(back_populates="workspace_memberships")
