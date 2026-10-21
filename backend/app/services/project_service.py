from datetime import datetime
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from app.database import AsyncSession
from app.services.name_uniqueness import check_unique_name
from app.models import Project, Department, WorkspaceUsers, WorkspaceRole
from app.dto import CreateProjectRequest, UpdateProjectRequest, ProjectResponseDTO
from app.services.workspace_access import get_workspace_membership


async def can_manage_project(current_user: dict, workspace_id: int, db: AsyncSession) -> WorkspaceUsers:
    return await get_workspace_membership(current_user, workspace_id, db)


def project_response(project: Project, membership: WorkspaceUsers) -> ProjectResponseDTO:
    # Hide other departments' IDs from employees, even for shared projects.
    visible_ids = sorted(department.department_id for department in project.departments
                         if membership.role == WorkspaceRole.OWNER or department.department_id == membership.department_id)
    return ProjectResponseDTO(
        id=project.project_id, name=project.name, status=project.status,
        start_date=project.start_date.isoformat() if project.start_date else None,
        end_date=project.end_date.isoformat() if project.end_date else None,
        department_ids=visible_ids, workspace_id=project.workspace_id,
    )


async def load_project(project_id: int, db: AsyncSession) -> Project:
    # Load current department links up front for async access checks and responses.
    project = await db.scalar(select(Project).where(Project.project_id == project_id)
                              .options(selectinload(Project.departments))
                              .execution_options(populate_existing=True))
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def assert_project_access(project: Project, membership: WorkspaceUsers) -> None:
    # Employees can access a project only while it is linked to their department.
    if membership.role != WorkspaceRole.OWNER and not any(
        department.department_id == membership.department_id for department in project.departments
    ):
        raise HTTPException(status_code=403, detail="No access to this project")


async def validate_project_departments(department_ids: list[int], workspace_id: int, db: AsyncSession) -> list[Department]:
    # Each department must appear once and belong to the project's workspace.
    if len(department_ids) != len(set(department_ids)):
        raise HTTPException(status_code=400, detail="Department IDs must be unique")
    departments = []
    for department_id in department_ids:
        department = await db.get(Department, department_id)
        if department is None:
            raise HTTPException(status_code=404, detail="Department not found")
        if department.workspace_id != workspace_id:
            raise HTTPException(status_code=400, detail="Department does not belong to this workspace")
        departments.append(department)
    return departments


async def check_project_name(workspace_id: int, name: str, db: AsyncSession, project_id: int | None = None) -> None:
    await check_unique_name(db, Project.name, name,
        Project.workspace_id == workspace_id,
        Project.project_id != project_id if project_id is not None else True,
        detail='Project name is already taken in this workspace')


async def create_project(workspace_id: int, project_data: CreateProjectRequest, current_user: dict, db: AsyncSession) -> ProjectResponseDTO:
    membership = await can_manage_project(current_user, workspace_id, db)
    department_ids = project_data.department_ids
    # Employees always create in their assigned department, including when no IDs are sent.
    if membership.role != WorkspaceRole.OWNER:
        if department_ids and department_ids != [membership.department_id]:
            raise HTTPException(status_code=403, detail="Projects can only be created in your assigned department")
        department_ids = [membership.department_id]
    departments = await validate_project_departments(department_ids, workspace_id, db)
    await check_project_name(workspace_id, project_data.name, db)
    # SQLAlchemy saves the department links through the many-to-many relationship.
    project = Project(name=project_data.name, workspace_id=workspace_id,
                      status=project_data.status, start_date=project_data.start_date,
                      end_date=project_data.end_date, departments=departments)
    db.add(project)
    await commit_project(db, workspace_id, project_data.name)
    project = await load_project(project.project_id, db)
    return project_response(project, membership)


async def get_projects(workspace_id: int, current_user: dict, db: AsyncSession) -> list[ProjectResponseDTO]:
    membership = await can_manage_project(current_user, workspace_id, db)
    stmt = select(Project).where(Project.workspace_id == workspace_id).options(selectinload(Project.departments))
    # Filter in SQL so employees receive only projects linked to their department.
    if membership.role != WorkspaceRole.OWNER:
        stmt = stmt.where(Project.departments.any(Department.department_id == membership.department_id))
    projects = (await db.scalars(stmt.execution_options(populate_existing=True))).all()
    return [project_response(project, membership) for project in projects]


async def get_project_by_id(project_id: int, current_user: dict, db: AsyncSession) -> ProjectResponseDTO:
    project = await load_project(project_id, db)
    # Check access against the project's own workspace for direct-ID requests.
    membership = await can_manage_project(current_user, project.workspace_id, db)
    assert_project_access(project, membership)
    return project_response(project, membership)


async def update_project(project_id: int, project_data: UpdateProjectRequest, current_user: dict, db: AsyncSession) -> ProjectResponseDTO:
    project = await load_project(project_id, db)
    membership = await can_manage_project(current_user, project.workspace_id, db)
    assert_project_access(project, membership)
    departments = None
    # Omitted links stay unchanged; only owners may explicitly replace them.
    if 'department_ids' in project_data.model_fields_set:
        if membership.role != WorkspaceRole.OWNER:
            raise HTTPException(status_code=403, detail="Only workspace owners can change project department links")
        departments = await validate_project_departments(project_data.department_ids, project.workspace_id, db)
    await check_project_name(project.workspace_id, project_data.name, db, project_id)
    # Details belong to one shared project row, so edits apply to every linked department.
    project.name = project_data.name
    project.status = project_data.status
    project.start_date = project_data.start_date
    project.end_date = project_data.end_date
    project.updated_at = datetime.now()
    if departments is not None:
        project.departments = departments
    await commit_project(db, project.workspace_id, project_data.name, project_id)
    project = await load_project(project_id, db)
    return project_response(project, membership)


async def delete_project(project_id: int, current_user: dict, db: AsyncSession) -> None:
    project = await load_project(project_id, db)
    # Deletion affects every linked department, so it requires an owner.
    await get_workspace_membership(current_user, project.workspace_id, db, owner_only=True)
    await db.delete(project)
    await db.commit()


async def commit_project(db: AsyncSession, workspace_id: int, name: str, project_id: int | None = None) -> None:
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        await check_unique_name(db, Project.name, name,
            Project.workspace_id == workspace_id,
            Project.project_id != project_id if project_id is not None else True,
            detail='Project name is already taken in this workspace')
        raise
