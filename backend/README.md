# Fotosinteze backend

This directory contains the Fotosinteze FastAPI backend. It uses async SQLAlchemy, Alembic migrations, JWT authentication, and CORS configuration for the frontend.

## Requirements

- Python 3.12 or newer
- SQLite

## First-time setup

Run these commands from this `backend` directory:

### macOS/Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
cp .env.example .env
touch database.sqlite
```

### Windows PowerShell

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
New-Item database.sqlite -ItemType File -Force
```

Edit `.env` before starting the server:

```dotenv
DATABASE_URL=sqlite+aiosqlite:///./database.sqlite
JWT_SECRET=replace-with-a-long-random-secret
CLIENT_URL=http://localhost:5173
```

`CLIENT_URL` must be the exact origin used by the frontend, including the port and without a trailing path. For a Vite frontend, `http://localhost:5173` is the usual value. Never commit `.env` or a real JWT secret.

The SQLite URL is already supported by the installed dependencies. The `touch`/`New-Item` command creates the local database file; SQLite can also create it automatically if needed.

## Create/update the database

With the virtual environment active and `.env` configured, run from `backend`:

```bash
alembic upgrade head
```

The current migration creates the `users` table.

## Run the API

From `backend` with the virtual environment active:

```bash
uvicorn app.main:app --reload
```

The API is available at `http://localhost:8000`. Interactive API documentation is available at:

- Swagger UI: `http://localhost:8000/docs`
- OpenAPI JSON: `http://localhost:8000/openapi.json`

## Backend testing guide

Run commands from `backend` with the virtual environment active and `.env`
configured as described above. Install or update the dependencies first:

```bash
python -m pip install -r requirements.txt
```

The test runner is pytest. Existing tests use Python's `unittest`, including
`IsolatedAsyncioTestCase` for async tests and `unittest.mock` for mocks.
Pytest runs these directly; no async plugin is required for these test classes.
API tests use HTTPX's `AsyncClient` and `ASGITransport` to call FastAPI in process.

```bash
# Run the full backend suite
python -m pytest tests -q

# Run one test file
python -m pytest tests/test_accounts.py -q

# Run tests whose names match an expression
python -m pytest tests -k "manual_updates" -v
```

Keep tests in `tests/test_*.py`. Follow the existing unittest patterns for new
tests. Database tests create in-memory or temporary SQLite databases; a running
API server is not needed.

If collection fails with a settings validation error, check `.env` against
`app/config.py`: unknown keys are rejected. Migration tests also require a
consistent Alembic revision graph; a "Multiple head revisions" error indicates
that migration branches need resolving.

## Current endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Basic health response |
| `POST` | `/auth/register` | Create a user |
| `POST` | `/auth/login` | Get a JWT access token |

The frontend should send the login response token on protected requests as:

```http
Authorization: Bearer <access_token>
```

Registration expects `email`, `display_name`, and `password`. Login expects `email` and `password`. Passwords must be at least 8 characters long.

## Frontend configuration

Point the frontend API client at:

```text
http://localhost:8000
```

For example, the frontend can call `POST http://localhost:8000/auth/login` and `POST http://localhost:8000/auth/register`. The backend currently allows browser requests only from the single origin in `CLIENT_URL`.

## Useful commands

```bash
# Start the development server
uvicorn app.main:app --reload

# Check migration status
alembic current

# Apply pending migrations
alembic upgrade head

# Roll back the latest migration
alembic downgrade -1
```

## Department assignments and shared projects

Run migrations from `backend` before starting the updated API:

```bash
.venv/bin/alembic upgrade head
```

Revision `b72f90c1de64` preserves existing project IDs and department links,
then replaces the single project department with a many-to-many association.
It adds a department foreign key to each workspace membership. Existing
employees remain unassigned until an owner assigns them. Invalid legacy
cross-workspace project links must be repaired before upgrade. Downgrade
refuses shared projects and existing employee assignments to avoid data loss.

An authenticated workspace owner assigns an existing employee with:

```http
PUT /departments/12/employees/42
Authorization: Bearer <access_token>
```

The employee must already have an `EMPLOYEE` membership in the department's
workspace. Assignment is per workspace and takes effect on the next request.
Only owners can assign employees or create, rename and delete departments.
Reassign employees before deleting their department.

Employees can list/read only their assigned department and its linked
projects. Unassigned employees cannot access department/project operations.
Employees can edit shared project details; these edits change the same project
record visible to every linked department. Only owners can change department
links or delete projects globally. Removing a department link or deleting a
department does not delete its projects.

`POST /projects` accepts `department_ids` instead of `department_id`:

```json
{
  "name": "Shared launch",
  "department_ids": [12, 15],
  "status": "Active"
}
```

Owners may link any departments in the selected workspace, or create a project
with no links. Employees may specify only their assigned department, or omit
the list to use that department automatically. POST/list requests require the
`Workspace-ID` header. Direct-ID routes authorize against the resource's own
workspace.

`PUT /projects/{project_id}` replaces name, status and dates; omitted nullable
details become null. Omit `department_ids` to preserve links. Owners may send
an empty list to remove all links. Employees cannot send this field on update.
Explicit null and duplicate department IDs are rejected. Project responses
contain `department_ids`; employees receive only their own department ID,
while owners receive every linked department ID.

Business transactions validate project/department links and apply the same
employee department restrictions. SQLite connections enforce foreign keys,
including workspace-aware assignment and association constraints.

## Business expense requests

Apply revision `c92e6a71bf03` with `.venv/bin/alembic upgrade head` before using
the expense API. The migration preserves expense IDs, receipts, transaction
links and balances, converts legacy statuses to uppercase, requires a category,
and restricts deletion of categories referenced by expenses. It stops before
changing the schema if legacy expense records need categories or reference repairs.

All expense endpoints require `Authorization: Bearer <access_token>` and the
`Workspace-ID` header for a business workspace.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/expenses` | Submit a pending expense |
| `GET` | `/expenses` | List visible requests |
| `GET` | `/expenses/{expense_id}` | Read a request |
| `PUT` | `/expenses/{expense_id}` | Replace a pending request's editable fields |
| `DELETE` | `/expenses/{expense_id}` | Delete a pending request |
| `POST` | `/expenses/{expense_id}/review` | Approve or reject a pending request (owner only) |

Employees see and edit their own submissions. Their assigned department is used
automatically; projects must be linked to that department. Owners see all requests
and may choose a department on submission. Department, project and category
references must belong to the selected workspace, and category must be an expense
category. Category is required; project and receipt are optional.

Example submission:

```json
{
  "category_id": 1,
  "amount": "12.34",
  "currency": "EUR",
  "description": "Train ticket"
}
```

Amounts use Decimal with at most two decimal places and must fit the transaction's
10-digit precision. Currency must contain three uppercase letters. Responses
serialize amounts as strings to preserve decimal precision. PUT replaces editable
fields; omitted optional fields become null, except employees retain their assigned
department. Status, submitter and reviewer fields cannot be supplied in the body.

Approve with `{"approve": true, "account_id": 1}` or reject with
`{"approve": false}`. Approval requires an account in the same workspace and
currency, and saves the review, linked transaction and balance change in one commit.
Rejection creates no transaction. Only `PENDING -> APPROVED` and
`PENDING -> REJECTED` transitions are allowed; repeated review returns `409`.
Reviewed requests cannot be edited or deleted, including by owners. Their linked
transactions are also locked, and the regular transaction endpoint cannot create
expense-linked transactions independently of review.

## Personal dashboard

`GET /dashboard` requires a bearer access token and `Workspace-ID`. Personal
Workspaces return the summary below. Business Workspaces return the business
financial summary described next. Inaccessible workspaces return `403` for
either workspace type.

The response contains `workspace_id`, `currency`, `period_start`, `period_end`,
`balance`, `income`, `expenses`, `savings`, and `recent_transactions`.
`balance` sums current account balances across all time. Income and expenses
sum categorized transactions in the current server-local calendar month;
`savings` is income minus expenses and may be negative. The period end is
exclusive. Money is serialized as decimal strings.

All balances and transactions are filtered to the workspace's `base_currency`;
other currencies are excluded, with no conversion. Recent transactions are the
latest 10 from that month and currency, ordered by creation time and then ID,
newest first, including uncategorized entries. Uncategorized transactions do not
contribute to income or expenses. Empty workspaces return zero amounts and an
empty transaction list. Budgets are not included.

## Accounts

Apply migrations with `.venv/bin/alembic upgrade head` before using account
creation. Revision `9c52e7a1bd30` fixes SQLite account ID generation and preserves
existing accounts and transaction references.

Account routes require a bearer token and `Workspace-ID`. Personal workspace
members can manage their accounts; business account routes require the owner,
matching category management permissions. IDs are always scoped to the selected
workspace; an account from another workspace returns `404`.

- `GET /accounts` lists accounts in ID order.
- `GET /accounts/{account_id}` reads one account.
- `POST /accounts` creates a manual account with `name`, `currency` (three uppercase
  letters), and `balance` (a decimal with at most two decimal places).
- `PUT /accounts/{account_id}` updates supplied `name` and/or `balance` fields;
  omitted fields are preserved. Explicit null and unknown fields are rejected.

Names are trimmed, nonempty, at most 120 characters, and checked for duplicates
in the workspace. Responses use the existing `balance` field for current balance
and serialize money as decimal strings. Negative balances are allowed.
Currency, workspace, connection and bank identifiers cannot be edited.

An account with `connection_id` is bank-managed even if its connection expires.
Only bank synchronization should replace its balance; ordinary account balance
updates return `409`. Creating, editing or deleting local transactions (including
expense approval) changes manual account balances only. Moving a transaction
between accounts adjusts only the manual sides. Renaming connected accounts is
allowed. This API does not implement the bank synchronization job.

### Transaction history

`GET /transactions?limit=50&offset=0` requires authentication and the
`Workspace-ID` header. It returns `{items, limit, offset, has_more}` rather than
a bare array. `limit` accepts 1–100 (default 50); `offset` is nonnegative
(default 0). Items are ordered by `created_at DESC, transaction_id DESC`.
Workspace and employee department access filters apply before pagination.
An empty page returns `items: []` and `has_more: false`.

Offset pagination can shift between requests when new transactions arrive;
refresh from offset 0 to retrieve the latest history.


## Business dashboard

`GET /dashboard` with a Business Workspace returns `workspace_id`, `currency`,
`period_start`, `period_end`, `revenue`, `expenses`, `profit`,
`spending_by_category`, `spending_by_department`, and `spending_by_project`.
Revenue sums income-category transactions; expenses sum expense-category
transactions; profit is revenue minus expenses (and may be negative).
Only current server-local calendar-month transactions in the workspace's
`base_currency` count, with an exclusive period end and no currency conversion.
Uncategorized transactions are excluded. Pending expense requests do not count;
their transactions count after approval.

Each spending breakdown contains `{id, name, amount}` entries, ordered by amount
descending then ID. Missing department/project links appear as `id: null`,
`name: "Unassigned"`. Breakdowns use transaction links directly, so shared projects
do not multiply spending. Amounts are decimal strings; empty workspaces return
zero totals and empty breakdowns.

Owners see the whole active workspace. Employees see only transactions belonging
to their assigned department, including only that department's spending on shared
projects. Employees without a valid department assignment receive `403`.
Budgets and frontend dashboard rendering are outside this endpoint's scope.

## Business budget management (BBUD-03)

`GET /business-budgets` returns saved budgets with target labels, spent/remaining
amounts, period boundaries, warning status, `can_manage`, and permitted targets.
All routes require a business `Workspace-ID` and authentication. Owners can
`POST /business-budgets`, `PUT /business-budgets/{id}` and
`DELETE /business-budgets/{id}`. Bodies use `name`, `target_type`
(`CATEGORY`, `DEPARTMENT`, `PROJECT`), `target_id`, `limit_amount`, `currency`,
`period_start`, `period_length` (`MONTHLY`, `WEEKLY`, `CUSTOM`) and
`duration_days` (required only for custom periods).

Each managed budget has exactly one target from its own workspace; category
targets must be expense categories. Existing schema and migration head are
sufficient. Ambiguous legacy budgets with multiple targets, or without a target,
remain stored but are excluded from this business API until repaired.

Progress sums expense-category transactions in the budget currency from the
inclusive start date to the exclusive end date. Monthly periods end on the same
day next month, clamped to that month's last day; weekly periods last seven days.
Custom periods last the specified number of days. Periods do not roll forward
automatically. At 80% spent, status is `WARNING`; above the limit, `EXCEEDED`.

Employees cannot mutate budgets. Assigned employees see their own department's
budgets and budgets for projects linked to that department. Their spending totals
include only transactions assigned to that department, including for shared
projects; company-wide category budgets are owner-only. Unassigned employees
receive the existing department-assignment error.

In the UI, open a Business workspace, choose Budgets, then select an accessible
Business workspace if one is not already connected. Budget CRUD is persisted;
the workspace switcher uses your accessible backend memberships.
