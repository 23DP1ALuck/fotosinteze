from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db_session
from app.models import Workspace, Department
from app.models.workspace import WorkspaceTypeEnum
from app.dto import CreateDepartmentRequest


async def create_department(create_department_request: CreateDepartmentRequest, db: AsyncSession = Depends(get_db_session)) -> dict:
    # Check if the workspace exists
    workspace = await db.get(Workspace, create_department_request.workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    # Check if the workspace is of type "business"
    if workspace.type != WorkspaceTypeEnum.BUSINESS:
        raise HTTPException(status_code=400, detail="Cannot create department in a personal workspace")

    # Create a new department
    new_department = Department(
        name=create_department_request.name,
        workspace_id=create_department_request.workspace_id
    )
    db.add(new_department)
    await db.commit()
    await db.refresh(new_department)

    return {"department_id": new_department.department_id, "name": new_department.name}
