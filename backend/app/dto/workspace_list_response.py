from pydantic import BaseModel
from app.models import WorkspaceRole
from app.models.workspace import WorkspaceTypeEnum

class WorkspaceListResponse(BaseModel):
    id: int
    name: str
    type: WorkspaceTypeEnum
    role: WorkspaceRole