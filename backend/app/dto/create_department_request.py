from pydantic import BaseModel

class CreateDepartmentRequest(BaseModel):
    name: str
    workspace_id: int