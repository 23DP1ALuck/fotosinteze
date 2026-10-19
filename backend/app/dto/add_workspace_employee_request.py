from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class AddWorkspaceEmployeeRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    email: EmailStr = Field(max_length=100)

    @field_validator('email', mode='before')
    @classmethod
    def trim_email(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value
