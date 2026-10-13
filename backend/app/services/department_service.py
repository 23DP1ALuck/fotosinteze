from fastapi import HTTPException
from sqlalchemy import select
from app.database import AsyncSession

from app.models import Department, WorkspaceUsers, WorkspaceRole
from app.dto import DepartmentResponseDTO, EmployeeDepartmentResponseDTO
from app.services.workspace_access import get_workspace_membership, assert_department_access


async def create_department(workspace_id: int, name: str, current_user: dict, db: AsyncSession) -> DepartmentResponseDTO:
    # Check if the user can manage the department
    await can_manage_department(current_user, workspace_id, db)

    # Department names must be unique within this workspace.
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
    membership = await get_workspace_membership(current_user, workspace_id, db)

    # Retrieve visible departments for the specified workspace
    stmt = select(Department).where(Department.workspace_id == workspace_id)
    # Employees see only their assigned department.
    if membership.role != WorkspaceRole.OWNER:
        stmt = stmt.where(Department.department_id == membership.department_id)
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
    membership = await get_workspace_membership(current_user, department.workspace_id, db)
    assert_department_access(membership, department_id)

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

    # Allow keeping the current name, but reject another department's name.
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

    # Require reassignment first so deleting a department does not leave employees unassigned.
    assigned_employee = await db.scalar(select(WorkspaceUsers.user_id).where(
        WorkspaceUsers.department_id == department_id,
        WorkspaceUsers.workspace_id == department.workspace_id,
    ).limit(1))
    if assigned_employee is not None:
        raise HTTPException(status_code=409, detail="Reassign employees before deleting this department")

    # Delete the department; many-to-many links are removed without deleting projects.
    await db.delete(department)
    await db.commit()

async def can_manage_department(current_user: dict, workspace_id: int, db: AsyncSession) -> bool:
    # Creating, renaming and deleting departments requires workspace ownership.
    await get_workspace_membership(current_user, workspace_id, db, owner_only=True)
    return True


async def assign_employee_department(department_id: int, user_id: int, current_user: dict, db: AsyncSession) -> EmployeeDepartmentResponseDTO:
    department = await db.get(Department, department_id)
    if department is None:
        raise HTTPException(status_code=404, detail="Department not found")
    # Only an owner of this department's workspace can assign employees.
    await get_workspace_membership(current_user, department.workspace_id, db, owner_only=True)
    # Assignment updates an existing membership in the same workspace.
    employee = await db.scalar(select(WorkspaceUsers).where(
        WorkspaceUsers.user_id == user_id,
        WorkspaceUsers.workspace_id == department.workspace_id,
    ).execution_options(populate_existing=True))
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee is not a member of this workspace")
    if employee.role != WorkspaceRole.EMPLOYEE:
        raise HTTPException(status_code=400, detail="Only employees can be assigned to a department")
    employee.department_id = department_id
    await db.commit()
    return EmployeeDepartmentResponseDTO(user_id=user_id, workspace_id=department.workspace_id, department_id=department_id)
