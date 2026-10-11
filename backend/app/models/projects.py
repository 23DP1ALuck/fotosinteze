from datetime import datetime
from typing import TYPE_CHECKING, List

from app.database import Base
from app.models.department_projects import department_projects
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import ForeignKey, String, DateTime, UniqueConstraint

if TYPE_CHECKING:
    from app.models import Department, Workspace, Expense, Transaction

class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint('workspace_id', 'name', name='uq_workspace_project_name'),
        UniqueConstraint('project_id', 'workspace_id', name='uq_project_workspace'),
    )

    project_id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.workspace_id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=True)
    start_date: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    end_date: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)

    departments: Mapped[List["Department"]] = relationship(
        secondary=department_projects, back_populates="projects",
        primaryjoin="and_(Project.project_id == department_projects.c.project_id, Project.workspace_id == department_projects.c.workspace_id)",
        secondaryjoin="and_(Department.department_id == department_projects.c.department_id, Department.workspace_id == department_projects.c.workspace_id)",
    )
    workspace: Mapped["Workspace"] = relationship(back_populates="projects")
    expenses: Mapped[List["Expense"]] = relationship(back_populates="project")
    transactions: Mapped[List["Transaction"]] = relationship(back_populates="project")
