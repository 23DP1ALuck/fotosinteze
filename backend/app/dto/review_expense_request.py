from pydantic import BaseModel, ConfigDict, model_validator


class ReviewExpenseRequestDTO(BaseModel):
    model_config = ConfigDict(extra='forbid')
    approve: bool
    account_id: int | None = None

    @model_validator(mode='after')
    def approval_requires_account(self):
        if self.approve and self.account_id is None:
            raise ValueError('Approval requires an account_id')
        return self
