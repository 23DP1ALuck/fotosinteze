from fastapi import Depends, HTTPException
from sqlalchemy import and_, select
from app.database import AsyncSession
from app.models import Workspace, Project, User, Department
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.models.workspace import WorkspaceTypeEnum
from app.dto import CreateProjectRequest, ProjectResponseDTO


async def can_manage_project(current_user: dict, workspace_id: int, db: AsyncSession) -> bool:
    user = await db.get(User, int(current_user.get("sub")), options={selectinload(User.workspace_memberships)})
    if user is None:
        raise HTTPException(status_code=401, detail="Unauthorized")
    workspace = await db.get(Workspace, workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    if not user.is_member_of_workspace(workspace_id, needs_to_be_owner=False):
        raise HTTPException(status_code=403, detail="User does not have access to this workspace")

    # Check if the workspace is of type "business"
    if workspace.type != WorkspaceTypeEnum.BUSINESS:
        raise HTTPException(status_code=400, detail="Cannot manage projects in a personal workspace")

    return True

async def create_project(workspace_id: int, project_data: CreateProjectRequest, current_user: dict, db: AsyncSession) -> ProjectResponseDTO:
    # Check if the user can manage the workspace
    await can_manage_project(current_user, workspace_id, db)

    await validate_project_department(project_data.department_id, workspace_id, db)

    # Check if a project with the same name already exists in the workspace
    existing_project = await db.scalar(
        select(Project.project_id).where(
            and_(
                Project.workspace_id == workspace_id,
                Project.name == project_data.name,
            )
        )
    )
    if existing_project is not None:
        raise HTTPException(status_code=409, detail="Project name is already taken in this workspace")

    # Create a new project
    new_project = Project(
        name=project_data.name,
        workspace_id=workspace_id,
        status=project_data.status,
        start_date=project_data.start_date,
        end_date=project_data.end_date,
        department_id=project_data.department_id,
    )

    db.add(new_project)
    await commit_project(db, workspace_id, project_data.name)
    await db.refresh(new_project)

    return ProjectResponseDTO(
        id=new_project.project_id,
        name=new_project.name,
        status=new_project.status,
        start_date=new_project.start_date.isoformat() if new_project.start_date else None,
        end_date=new_project.end_date.isoformat() if new_project.end_date else None,
        department_id=new_project.department_id,
        workspace_id=new_project.workspace_id,
    )

async def get_projects(workspace_id: int, current_user: dict, db: AsyncSession) -> list[ProjectResponseDTO]:
    # Check if the user can manage the workspace
    await can_manage_project(current_user, workspace_id, db)

    # Retrieve all projects in the workspace
    projects = await db.execute(
        select(Project).where(Project.workspace_id == workspace_id)
    )
    project_list = projects.scalars().all()

    return [
        ProjectResponseDTO(
            id=project.project_id,
            name=project.name,
            status=project.status,
            start_date=project.start_date.isoformat() if project.start_date else None,
            end_date=project.end_date.isoformat() if project.end_date else None,
            department_id=project.department_id,
            workspace_id=project.workspace_id,
        )
        for project in project_list
    ]

async def get_project_by_id(project_id: int, current_user: dict, db: AsyncSession) -> ProjectResponseDTO:
    # Retrieve the project by ID
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Check if the user can manage the workspace
    await can_manage_project(current_user, project.workspace_id, db)

    return ProjectResponseDTO(
        id=project.project_id,
        name=project.name,
        status=project.status,
        start_date=project.start_date.isoformat() if project.start_date else None,
        end_date=project.end_date.isoformat() if project.end_date else None,
        department_id=project.department_id,
        workspace_id=project.workspace_id,
    )

async def update_project(project_id: int, project_data: CreateProjectRequest, current_user: dict, db: AsyncSession) -> ProjectResponseDTO:  
    # Retrieve the project by ID
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Check if the user can manage the workspace
    await can_manage_project(current_user, project.workspace_id, db)

    await validate_project_department(project_data.department_id, project.workspace_id, db)

    # Check if a project with the same name already exists in the workspace (excluding the current project)
    existing_project = await db.scalar(
        select(Project.project_id).where(
            and_(
                Project.workspace_id == project.workspace_id,
                Project.name == project_data.name,
                Project.project_id != project_id,
            )
        )
    )
    if existing_project is not None:
        raise HTTPException(status_code=409, detail="Project name is already taken in this workspace")

    # Update the project details
    project.name = project_data.name
    project.status = project_data.status
    project.start_date = project_data.start_date
    project.end_date = project_data.end_date
    project.department_id = project_data.department_id

    db.add(project)
    await commit_project(db, project.workspace_id, project_data.name, project_id)
    await db.refresh(project)

    return ProjectResponseDTO(
        id=project.project_id,
        name=project.name,
        status=project.status,
        start_date=project.start_date.isoformat() if project.start_date else None,
        end_date=project.end_date.isoformat() if project.end_date else None,
        department_id=project.department_id,
        workspace_id=project.workspace_id,
    )

async def delete_project(project_id: int, current_user: dict, db: AsyncSession) -> None:
    # Retrieve the project by ID
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Check if the user can manage the workspace
    await can_manage_project(current_user, project.workspace_id, db)

    # Delete the project
    await db.delete(project)
    await db.commit()

async def validate_project_department(department_id: int | None, workspace_id: int, db: AsyncSession) -> None:
    if department_id is None:
        return
    department = await db.get(Department, department_id)
    if department is None:
        raise HTTPException(status_code=404, detail="Department not found")
    if department.workspace_id != workspace_id:
        raise HTTPException(status_code=400, detail="Department does not belong to this workspace")


async def commit_project(db: AsyncSession, workspace_id: int, name: str, project_id: int | None = None) -> None:
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        # A concurrent request may have claimed the name after the precheck.
        stmt = select(Project.project_id).where(
            Project.workspace_id == workspace_id,
            Project.name == name,
        )
        if project_id is not None:
            stmt = stmt.where(Project.project_id != project_id)
        if await db.scalar(stmt) is not None:
            raise HTTPException(status_code=409, detail="Project name is already taken in this workspace") from exc
        raise
