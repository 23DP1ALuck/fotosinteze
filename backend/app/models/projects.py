from datetime import datetime
from typing import TYPE_CHECKING

from app.database import Base
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import ForeignKey, String, DateTime, UniqueConstraint

if TYPE_CHECKING:
    from app.models import Department, Workspace

class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint('department_id', 'name', name='uq_department_project_name'),
    )

    project_id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.workspace_id"), nullable=False)
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.department_id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=True)
    start_date: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    end_date: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)

    department: Mapped["Department | None"] = relationship(back_populates="projects")
    workspace: Mapped["Workspace"] = relationship(back_populates="projects")
