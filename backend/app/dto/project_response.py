from pydantic import BaseModel

class ProjectResponseDTO(BaseModel):
    id: int
    name: str
    status: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    department_id: int | None = None
    workspace_id: int