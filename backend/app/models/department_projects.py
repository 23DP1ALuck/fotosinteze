from sqlalchemy import Column, ForeignKeyConstraint, Integer, Table
from app.database import Base

# Workspace-aware keys prevent linking resources from different workspaces.
department_projects = Table(
    'department_projects', Base.metadata,
    Column('department_id', Integer, primary_key=True),
    Column('project_id', Integer, primary_key=True),
    Column('workspace_id', Integer, nullable=False),
    ForeignKeyConstraint(
        ['department_id', 'workspace_id'],
        ['departments.department_id', 'departments.workspace_id'],
        name='fk_department_projects_department', ondelete='CASCADE',
    ),
    ForeignKeyConstraint(
        ['project_id', 'workspace_id'],
        ['projects.project_id', 'projects.workspace_id'],
        name='fk_department_projects_project', ondelete='CASCADE',
    ),
)
