# ROLE-02 Employee Memberships Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let Business Workspace owners add registered users by email and remove employee memberships safely.

**Architecture:** Extend the existing workspace router and service. Reuse `WorkspaceUsers`, `load_workspace_member` and `assert_business_owner`; keep Personal ownership and the current project permissions unchanged. Additions create EMPLOYEE memberships with no department; the existing department-assignment endpoint handles assignment afterward.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy async, unittest/pytest, HTTPX, SQLite test databases.

**Spec:** [ROLE-02](https://trello.com/c/8CrUYOn7), [updated ROLE-01](https://trello.com/c/Gd9Rpg86), [updated ROLE-03](https://trello.com/c/vrBHi9kO), and `docs/superpowers/specs/2026-10-08-department-access-shared-projects-design.md`.

## Global Constraints

- Only OWNER can manage members, and only in their Business Workspace.
- Add existing users only, always as EMPLOYEE; do not accept a client-provided role.
- Remove EMPLOYEE memberships only. Reject every OWNER removal, which also protects the last owner without owner-count races.
- Keep Personal Workspace ownership in the shared membership model.
- Preserve the current department-scoped employee project permissions.
- No new dependencies or schema migration. SQLite role constraints and PostgreSQL migration verification remain ROLE-01 work.
- No invitation emails, account creation, role promotion/transfer, member-list endpoint or frontend integration; the UI belongs to ROLE-04.

## Review Focus

- Concurrent duplicate additions return a conflict and leave the session usable (Task 1).
- Legacy mixed-case emails resolve predictably; ambiguous case-insensitive matches never select an arbitrary account (Task 1).
- New unassigned employees can discover their workspace but receive department access only after owner assignment (Task 1).
- Removal preserves the user, other memberships and expense/financial history (Task 2).
- A removed employee's existing token cannot access the workspace on its next request (Task 2).

## Files and API Contract

Create:
- `backend/app/dto/add_workspace_employee_request.py`: `AddWorkspaceEmployeeRequest`, with `email: EmailStr`, trimmed before validation, maximum 100 characters to match current registration, and extra fields forbidden.
- `backend/app/dto/workspace_member_response.py`: `WorkspaceMemberResponse` with `user_id: int`, `workspace_id: int`, `display_name: str`, `email: str`, `role: WorkspaceRole`, `department_id: int | None`, `joined_at: datetime`. Never expose password/auth fields.
- `backend/tests/test_workspace_members.py`: HTTP and persistence tests using the existing in-memory database/ASGI patterns, with foreign keys enabled.

Modify:
- `backend/app/dto/__init__.py`: export the two new DTOs, following existing conventions.
- `backend/app/services/workspace_service.py`: employee add/remove functions beside current workspace operations.
- `backend/app/api/routes/workspaces.py`: two authenticated routes; already registered in `app/main.py`.
- `backend/README.md`: document request, responses, authorization and separate department-assignment step.

| Method | Endpoint | Success |
| --- | --- | --- |
| POST | `/workspaces/{workspace_id}/employees` with `{"email":"user@example.com"}` | 201, `WorkspaceMemberResponse` |
| DELETE | `/workspaces/{workspace_id}/employees/{user_id}` | 204, empty body |

Errors: 401 unauthenticated/deleted caller; 403 employee/nonmember caller or OWNER removal; 400 Personal Workspace; 404 missing workspace/user/membership; 409 existing membership or ambiguous email match; 422 malformed email/body/path ID. Validate positive path IDs. Authorize the caller before looking up a target user or membership.

### Task 1: Add an existing employee

**Interfaces:** `add_workspace_employee(workspace_id: int, request: AddWorkspaceEmployeeRequest, current_user: dict, db: AsyncSession) -> WorkspaceMemberResponse`; route uses `get_current_user` and `get_db_session`, with workspace ID from the URL and no active-workspace header requirement.

- [x] Add failing HTTP tests: owner adds a registered nonmember (201); assert EMPLOYEE, null department, populated joined_at, exact user/workspace IDs, no password, and one persisted row. Adding the same user to a second business succeeds and preserves both memberships.
- [x] Add failing validation/permission tests: malformed email, excessive length, extra role field and nonpositive IDs (422); unknown user (404); duplicate EMPLOYEE or existing OWNER including self-add (409); employee/nonmember (403); missing workspace (404); Personal Workspace (400); anonymous request (401). Assert no mutation on failures.
- [x] Add email tests: trim surrounding whitespace, match stored email case-insensitively, return stored email in the response; if multiple stored users match case-insensitively, return 409 without adding either. Do not change registration/login or stored email values.
- [x] Add duplicate-race coverage: force the insert/commit unique-key failure after the precheck; assert rollback and 409 only when the membership exists, then prove the session can still execute a query. Unrelated database failures must propagate rather than being mislabeled as duplicates.
- [x] Run `cd backend && .venv/bin/python -m pytest tests/test_workspace_members.py -q`; confirm tests fail because the feature is absent.
- [x] Implement the DTOs, exports, service and POST route. Load the caller through `load_workspace_member`, then call `assert_business_owner`; resolve the target using consistent Python casefold comparison of the stored and requested email, reject existing membership, insert with explicit EMPLOYEE and null department, commit, and return persisted fields. Roll back failed writes.
- [x] Add an integration test: the new employee discovers the workspace through GET `/workspaces`, department/project requests return 403 while unassigned, owner assignment through PUT `/departments/{department_id}/employees/{user_id}` succeeds, and allowed department/project reads then succeed with the same identity. Do not change those existing access checks.
- [x] Run the targeted tests again; require all to pass. Review the diff; leave the changes uncommitted because no commit was requested.

### Task 2: Remove an employee and verify access revocation

**Interfaces:** `remove_workspace_employee(workspace_id: int, user_id: int, current_user: dict, db: AsyncSession) -> None`; DELETE route returns an explicit empty 204 response.

- [x] Add failing tests: owner removes an assigned or unassigned EMPLOYEE (204), only the matching membership disappears, and repeated removal returns 404.
- [x] Add failure tests: employee/nonmember caller (403), anonymous caller (401), missing workspace/target membership (404), Personal Workspace (400), sole OWNER removal and OWNER removal when other owners exist (403). Attempting to remove a member from another workspace must not affect that membership.
- [x] Add persistence tests: the removed user's account, Personal membership, other Business memberships, submitted expenses and related transactions remain intact. Re-adding the user works and creates an unassigned EMPLOYEE membership.
- [x] Add next-request tests using the same authenticated identity: after removal, GET `/workspaces` excludes the workspace, direct GET `/workspaces/{id}` returns 403, and department/project/transaction requests for that workspace return 403; access to another membership remains available.
- [x] Run `cd backend && .venv/bin/python -m pytest tests/test_workspace_members.py -q`; confirm the removal tests fail before implementation.
- [x] Implement the service and DELETE route. Authorize the caller first; load the target by composite key and reject OWNER targets. Delete with all three predicates (`workspace_id`, `user_id`, `role == EMPLOYEE`) and check affected rows, so the actual deletion cannot remove an OWNER. Commit with rollback on failure. Delete no user, workspace or historical records.
- [x] Document both endpoints and the add-then-assign workflow in `backend/README.md`; document the error contract and that removing membership revokes workspace access without globally logging the user out.
- [x] Run `cd backend && .venv/bin/python -m pytest tests/test_workspace_members.py tests/test_workspaces.py tests/test_department_access.py tests/test_business_budgets.py tests/test_expenses.py -q`, then `.venv/bin/python -m pytest tests -q` from `backend`. Require passing results; report environment limitations rather than claiming unrun checks passed.
- [x] Verify generated OpenAPI includes both routes, body/response schemas, authentication, error responses and no Workspace-ID header requirement. Confirm `git diff --check` passes and the final diff contains only the planned backend/tests/docs changes. Leave changes uncommitted for review.

## Self-review

- ROLE-02 scope is covered by Tasks 1 and 2; owner-only membership authorization also completes that part of ROLE-03.
- The plan preserves shared Personal/Business membership storage and current project policy.
- Existing composite keys enforce duplicate protection, and conditional EMPLOYEE deletion protects every OWNER without schema changes.
- Each review-focus condition has explicit tests in its owning task.
- Implementation complete: both endpoints and documentation added. Initial targeted suite: 71 passed; final membership suite: 19 passed, including two Unicode regression tests. Final full backend suite: 195 passed, 135 subtests passed, 14 pre-existing warnings. OpenAPI and whitespace checks passed. OpenAPI checks passed. Changes remain uncommitted.

## Review adjustment

The independent review found SQLite `lower()` does not handle Unicode case consistently with Python. Both sides now use Python `casefold()`; tests cover a mixed-case Unicode address and ambiguous Unicode variants. Lookup reads user ID/name/email rows rather than passwords. This scans users; add an indexed normalized email if account volume makes lookup slow.
