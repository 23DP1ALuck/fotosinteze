# Department access and shared projects

## Approved intent

Owners assign employees to a single department per workspace. Employees see only that department and projects linked to it, and create projects only there. Projects may be shared across departments; all departments edit the same project record. The user approved owner-only sharing and deletion on 2026-10-08. This specification expands that approved design for review before implementation.

## Scope and defaults

Implement the existing backend API, models, migrations, DTOs and tests. The frontend currently has no department/project management screens; building those is outside this change. Owners retain workspace-wide access. Assignment is attached to workspace membership, not globally to the user, so a user may work in different departments in different workspaces.

Employees without an assignment are inactive for department/project operations until an owner assigns them. This supports migrating existing employees without guessing their departments. Assignment changes take effect on the next request, without requiring a new token. No employee can assign themselves, change their role, share a project, unlink a department or globally delete a project.

## Data model

Add nullable `department_id` to `WorkspaceUsers`, linked to `Department`. Owners need no department. All new employee assignment operations require a valid department in the membership's workspace. Existing unassigned employees remain present but receive no department/project access. Enforce workspace membership and target department compatibility in the service; use a composite foreign key where supported by the existing schema so direct writes cannot assign another workspace's department.

Replace `Project.department_id` and `Project.department` with `Project.departments` and a `department_projects` association table. Use a composite primary key to prevent duplicate links. Each project remains a single row with one name, status, start date and end date. Keep unique project names per workspace. Validate every department link against the project's workspace. Add workspace-aware foreign keys to association rows if necessary to enforce this invariant at the database layer.

Use normal SQLAlchemy many-to-many relationships on Project and Department with explicit eager loading for async operations. Removing a link deletes only the link; it must not delete the shared project. Deleting a project removes its links. Do not configure project deletion cascades from Department.

## Access rules

| Operation | Workspace owner | Assigned employee | Unassigned employee/nonmember |
| --- | --- | --- | --- |
| List/read departments | All workspace departments | Assigned department only | Denied |
| Create/rename/delete departments | Allowed | Denied | Denied |
| Assign/reassign an employee | Allowed in own workspace | Denied | Denied |
| List/read projects | All workspace projects | Linked to assigned department only | Denied |
| Create project | Select departments in own workspace | Assigned department only | Denied |
| Edit shared project details | Allowed | Allowed when linked to assigned department | Denied |
| Change project department links | Allowed | Denied | Denied |
| Delete project globally | Allowed | Denied | Denied |

List queries filter in SQL. Direct-ID queries perform the same access checks; knowing an ID never bypasses restrictions. Return 401 for a missing authenticated user, 403 for forbidden operations, 404 for missing resources, 400 for cross-workspace links, and 409 for conflicting project names. Never return other departments' names or IDs in employee project responses: include only the employee's visible link, while owners receive all department IDs.

## API changes

Add an owner-only endpoint `PUT /departments/{department_id}/employees/{user_id}`. It assigns or reassigns an existing EMPLOYEE workspace membership to that department and returns the employee user ID, workspace ID and department ID. Reject missing membership, OWNER targets, foreign-workspace departments and unauthorized callers. It does not create users or workspace memberships or change roles.

Change project creation input to `department_ids: list[int]` in place of `department_id`. Owners may leave it empty for existing workspace-only projects. Employees with an omitted/empty list automatically create in their assigned department; an explicit list must contain only that department. Reject duplicate IDs and invalid/missing departments.

Add a separate project update DTO whose editable fields are name, status and dates; optional `department_ids` is owner-only. Omission preserves existing links. An employee sending this field is denied, even when values match existing links. Preserve current replacement semantics for project details where possible; document nullable fields explicitly.

Project responses use `department_ids: list[int]`. Owners receive all linked departments; employees receive only their assigned department ID. Update OpenAPI descriptions and tests to match. This is a deliberate API change; there are no existing frontend consumers of project DTOs in this repository.

Use one access helper to load the caller's current workspace membership and business workspace and another to apply department/project visibility. Preserve department management checks as owner-only while separating read access so employees can read their assigned department.

## Transactions and relationship consumers

Replace transaction-service uses of `Project.department_id` and `Project.department` with membership in the association table. Validate that supplied project and department belong to the transaction workspace and that the project is linked to that department when both are supplied. For employee business transactions, department/project references must satisfy the same assigned-department permissions so this route cannot access otherwise restricted resources. Personal workspace behavior stays unchanged.

## Migration and deletion behavior

Create the assignment column and association table in a new Alembic revision after the current head. Copy every existing non-null project department into a link before dropping the old column. Preserve project IDs, shared details, workspace-only projects, expenses and transaction project references. Existing employees start unassigned. Detect invalid cross-workspace legacy links and stop with an actionable error rather than migrate inconsistent data.

Department deletion is owner-only. Reject deleting a department that still has assigned employees with 409; the owner must reassign them first. Remove only that department's project links; leave project records and other department links intact. Existing unrelated expense/transaction deletion semantics remain unchanged unless required for the association migration.

Downgrade cannot represent a project shared across multiple departments: fail explicitly before changing the schema when such links exist. Otherwise restore the single department column from links. Refuse downgrade while employee assignments exist rather than silently losing assignment data.

Test migrations against a temporary database, never the user's working database. Do not run the new migration on the user's data as part of implementation. Provide the upgrade command after verification. Fix runtime environment problems only within the authorized scope; report any unavailable migration tooling.

## Verification

Use real in-memory SQLAlchemy database tests for access and persistence. Cover owner assignment, employee/nonmember rejection, foreign-workspace assignment, reassignment, unassigned employees, department list/direct-ID restrictions, project list/direct-ID restrictions, automatic employee project assignment, foreign/extra department rejection, owner sharing, shared updates visible to employees in both departments, employee link/delete rejection, owner deletion, department unlink behavior, employees blocking department deletion, name conflicts and transaction relationship compatibility.

Migration tests cover preserving old links and IDs, workspace-only projects, upgrade/downgrade round trip, refusing lossy downgrade and rejecting invalid legacy links. Run the existing backend suite and confirm routes/OpenAPI register successfully. Record any remaining environment limitations without claiming unverified tests passed.

## Review checks

This specification keeps one project record and one assignment per employee workspace membership. It distinguishes owner administration from employee reads/edits, specifies unassigned-user behavior, prevents workspace crossing, identifies the DTO breaking change, covers transaction callers, and preserves shared projects when a department link is removed. Owner-only sharing and global deletion are user-approved; migration, response filtering, and department deletion defaults require review with this written specification.
