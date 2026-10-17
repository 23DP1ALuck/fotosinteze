from pydantic import BaseModel


class EmployeeDepartmentResponseDTO(BaseModel):
    user_id: int
    workspace_id: int
    department_id: int
