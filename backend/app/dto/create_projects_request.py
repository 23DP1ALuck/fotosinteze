from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator


class CreateProjectRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    department_ids: list[int] = Field(default_factory=list)
    name: str
    status: str | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None

    @field_validator('department_ids')
    @classmethod
    def unique_departments(cls, value: list[int]) -> list[int]:
        if len(value) != len(set(value)):
            raise ValueError('Department IDs must be unique')
        return value
