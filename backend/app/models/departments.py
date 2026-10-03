from datetime import datetime
from typing import TYPE_CHECKING, List

from app.database import Base
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import ForeignKey, String, DateTime, UniqueConstraint

if TYPE_CHECKING:
    from app.models import Workspace, Project, Expense

class Department(Base):
    __tablename__ = "departments"
    __table_args__ = (
        UniqueConstraint('workspace_id', 'name', name='uq_workspace_department_name'),
    )

    department_id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.workspace_id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)

    workspace: Mapped["Workspace"] = relationship(back_populates="departments")
    projects: Mapped[List["Project"]] = relationship(back_populates="department")
    expenses: Mapped[List["Expense"]] = relationship(back_populates="department")
