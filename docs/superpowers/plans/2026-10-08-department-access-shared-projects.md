# Department access and shared projects Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Track the steps below.

**Goal:** Restrict employees to their assigned department while allowing shared project edits.

**Architecture:** Department assignment lives on workspace membership. A workspace-aware many-to-many association links departments to one project record. A shared access service loads current memberships for each operation and filters reads before serialization.

**Tech Stack:** FastAPI, Pydantic, async SQLAlchemy, Alembic, SQLite, unittest.

**Spec:** ../specs/2026-10-08-department-access-shared-projects-design.md

## Global Constraints

- Owners alone assign employees, change project links and delete projects.
- Employees have one assigned department per workspace; unassigned employees have no access.
- Shared edits update one project row; employee responses expose no other department IDs.
- Preserve existing IDs and links in migration; never migrate the working database during testing.
- Backend only; no unrelated frontend work.

## Review Focus

- Reassignment and stale session objects must not preserve previous department access.
- Empty versus omitted department_ids on create/update have different meanings.
- Deleting a department must not delete a shared project.
- Transactions must not bypass department/project restrictions.
- Migration downgrade must reject shared links and existing assignments without data loss.

## Task 1: Schema and assignment

Files: models/workspace.py, models/departments.py, models/projects.py, models/department_projects.py; tests/test_department_access.py.

Interfaces: WorkspaceUsers.department_id/department; Project.departments; Department.projects; department_projects table.

- [x] Write failing real database tests for assignment, sharing and cross-workspace foreign keys.
- [x] Run tests and confirm missing schema failures.
- [x] Add composite unique parent keys and workspace-aware foreign keys; map async relationships without delete cascades.
- [x] Run schema tests and verify no SQLAlchemy warnings.

## Task 2: Permissions and CRUD

Files: services/workspace_access.py, services/department_service.py, services/project_service.py, dto/create_projects_request.py, dto/update_project_request.py, dto/project_response.py, dto/employee_department_response.py, dto/__init__.py, api/routes/departments.py, api/routes/projects.py, dependencies/workspace.py.

Interfaces: get_workspace_membership(current_user, workspace_id, db, owner_only=False) -> WorkspaceUsers; assert_department_access(membership, department_id); project response department_ids; assign_employee_department(department_id, user_id, current_user, db).

- [x] Write failing tests for owner assignment, employee reads/creation/shared edits, owner-only link changes/deletion and unassigned/nonmember denial.
- [x] Implement fresh membership loading, SQL list filters, project visibility checks and filtered DTOs.
- [x] Create owner assignment endpoint and separate update DTO preserving links on omission.
- [x] Block deleting assigned departments; unlink projects without deleting them.
- [x] Adapt existing regression tests to plural department IDs and real auth fixtures.
- [x] Run the backend suite and OpenAPI checks.

## Task 3: Transactions

Files: services/transaction_service.py; tests/test_department_access.py.

- [x] Write failing tests for project/department mismatch, foreign workspace references and employee restrictions.
- [x] Replace obsolete single-department relationship accesses and authorize referenced resources before mutation.
- [x] Run transaction tests and the full backend suite.

## Task 4: Migration and documentation

Files: alembic/versions/<new_revision>_department_access_shared_projects.py, tests/test_department_project_migration.py, README.md.

- [x] Write failing migration tests using temporary databases for legacy links, unassigned employees, invalid data and downgrade guards.
- [x] Add reversible migration after a18c72e40b91; backfill links before removing legacy column.
- [x] Verify upgrade/downgrade round trip and foreign-key checks with existing transaction references.
- [x] Document new assignment endpoint, plural DTOs, permissions and upgrade command.
- [x] Run all tests, inspect final diff and obtain one independent review; fix actionable findings.

## Execution notes

User explicitly requested implementation in this chat after approving the design and discussing the membership foreign key. Execute inline without another approval handoff. Keep changes reviewable in the current checkout; no push or working-database migration.


## Verification record

- Schema and membership tests use actual SQLAlchemy sessions with SQLite foreign keys enabled.
- Scoped reads, creation, shared updates, link management, owner assignment and reassignment verified in service and HTTP tests.
- Existing project-name regression tests adapted to plural department IDs and real membership fixtures.
- Transactions validate many-to-many links, workspace compatibility and employee assignments.
- Upgrade/downgrade tested on temporary databases with legacy expenses and transactions; IDs and links preserved.
- Independent reviewer found one migration preflight issue. A regression reproduced the leftover temporary table; moving the FK check before DDL fixes it and permits repair/retry.
- An empty local alembic/__init__.py shadowed the installed Alembic package. Removed it so documented migration commands work from backend.
- No working-database migrations, commits or external publication performed.
