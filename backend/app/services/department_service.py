from fastapi import Depends, HTTPException
from sqlalchemy import and_, select
from app.database import AsyncSession

from app.database import get_db_session
from app.models import Workspace, Department, User
from app.models.workspace import WorkspaceTypeEnum
from app.dto import DepartmentResponseDTO
from sqlalchemy.orm import selectinload


async def create_department(workspace_id: int, name: str, current_user: dict, db: AsyncSession) -> DepartmentResponseDTO:
    # Check if the user can manage the department
    await can_manage_department(current_user, workspace_id, db)

    existing_department = await db.scalar(
        select(Department.department_id).where(
            Department.workspace_id == workspace_id,
            Department.name == name,
        )
    )
    if existing_department is not None:
        raise HTTPException(status_code=409, detail="Department name is already taken in this workspace")

    # Create a new department
    new_department = Department(
        name=name,
        workspace_id=workspace_id
    )
    db.add(new_department)
    await db.commit()
    await db.refresh(new_department)

    return DepartmentResponseDTO(
        id=new_department.department_id,
        name=new_department.name,
        workspace_id=new_department.workspace_id
    )

async def get_departments(workspace_id: int, current_user: dict, db: AsyncSession) -> list[DepartmentResponseDTO]:
    # Check if the user can manage the department
    await can_manage_department(current_user, workspace_id, db)

    # Retrieve all departments for the specified workspace
    stmt = select(Department).where(Department.workspace_id == workspace_id)
    result = await db.execute(stmt)
    departments = result.scalars().all()

    return [DepartmentResponseDTO(
        id=dept.department_id,
        name=dept.name,
        workspace_id=dept.workspace_id
    ) for dept in departments]

async def get_department_by_id(department_id: int, current_user: dict, db: AsyncSession) -> DepartmentResponseDTO:
    # Retrieve the department by ID
    department = await db.get(Department, department_id)
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")

    # Check if the user can manage the department
    await can_manage_department(current_user, department.workspace_id, db)

    return DepartmentResponseDTO(
        id=department.department_id,
        name=department.name,
        workspace_id=department.workspace_id
    )

async def update_department(department_id: int, name: str, current_user: dict, db: AsyncSession) -> DepartmentResponseDTO:
    # Retrieve the department by ID
    department = await db.get(Department, department_id)
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")

    # Check if the user can manage the department
    await can_manage_department(current_user, department.workspace_id, db)

    existing_department = await db.scalar(
        select(Department.department_id).where(
            Department.workspace_id == department.workspace_id,
            Department.name == name,
            Department.department_id != department_id,
        )
    )
    if existing_department is not None:
        raise HTTPException(status_code=409, detail="Department name is already taken in this workspace")

    # Update the department with the provided data
    department.name = name

    await db.commit()
    await db.refresh(department)

    return DepartmentResponseDTO(
        id=department.department_id,
        name=department.name,
        workspace_id=department.workspace_id
    )

async def delete_department(department_id: int, current_user: dict, db: AsyncSession) -> None:
    # Retrieve the department by ID
    department = await db.get(Department, department_id)
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")

    # Check if the user can manage the department
    await can_manage_department(current_user, department.workspace_id, db)

    # Delete the department
    await db.delete(department)
    await db.commit()

async def can_manage_department(current_user: dict, workspace_id: int, db: AsyncSession) -> bool:
    user = await db.get(User, int(current_user.get("sub")), options={selectinload(User.workspace_memberships)})
    if user is None:
        raise HTTPException(status_code=401, detail="Unauthorized")
    # Check if the workspace exists
    workspace = await db.get(Workspace, workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Check if the user is a member and owner of the workspace
    if not user.is_member_of_workspace(workspace_id, needs_to_be_owner=True):
        raise HTTPException(status_code=403, detail="User does not have access to this workspace or is not an owner")

    # Check if the workspace is of type "business"
    if workspace.type != WorkspaceTypeEnum.BUSINESS:
        raise HTTPException(status_code=400, detail="Cannot create department in a personal workspace")

    return True
