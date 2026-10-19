from datetime import datetime

from pydantic import BaseModel

from app.models import WorkspaceRole


class WorkspaceMemberResponse(BaseModel):
    user_id: int
    workspace_id: int
    display_name: str
    email: str
    role: WorkspaceRole
    department_id: int | None
    joined_at: datetime
