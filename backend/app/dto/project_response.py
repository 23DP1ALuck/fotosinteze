from pydantic import BaseModel, Field

class ProjectResponseDTO(BaseModel):
    id: int
    name: str
    status: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    department_ids: list[int] = Field(default_factory=list)
    workspace_id: int