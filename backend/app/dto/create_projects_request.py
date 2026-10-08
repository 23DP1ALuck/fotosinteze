from datetime import datetime
from pydantic import BaseModel

class CreateProjectRequest(BaseModel):
    department_id: int | None = None
    name: str
    status: str | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None