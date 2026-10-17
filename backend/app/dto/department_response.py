from pydantic import BaseModel

class DepartmentResponseDTO(BaseModel):
    id: int
    name: str
    workspace_id: int