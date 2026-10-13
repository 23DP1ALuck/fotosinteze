from app.dto.workspace_list_response import WorkspaceListResponse


class WorkspaceResponse(WorkspaceListResponse):
    base_currency: str
