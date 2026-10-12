from datetime import datetime
from typing import TYPE_CHECKING, List

from app.database import Base
from app.models.department_projects import department_projects
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import ForeignKey, String, DateTime, UniqueConstraint

if TYPE_CHECKING:
    from app.models import Budget, Workspace, Project, Expense, Transaction

class Department(Base):
    __tablename__ = "departments"
    __table_args__ = (
        UniqueConstraint('workspace_id', 'name', name='uq_workspace_department_name'),
        UniqueConstraint('department_id', 'workspace_id', name='uq_department_workspace'),
    )

    department_id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.workspace_id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)

    workspace: Mapped["Workspace"] = relationship(back_populates="departments")
    projects: Mapped[List["Project"]] = relationship(
        secondary=department_projects, back_populates="departments",
        primaryjoin="and_(Department.department_id == department_projects.c.department_id, Department.workspace_id == department_projects.c.workspace_id)",
        secondaryjoin="and_(Project.project_id == department_projects.c.project_id, Project.workspace_id == department_projects.c.workspace_id)",
    )
    expenses: Mapped[List["Expense"]] = relationship(back_populates="department")
    transactions: Mapped[List["Transaction"]] = relationship(back_populates="department")
    budgets: Mapped[List["Budget"]] = relationship(back_populates="department")
