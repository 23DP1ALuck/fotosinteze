# Fotosinteze backend

This directory contains the Fotosinteze FastAPI backend. It uses async SQLAlchemy, Alembic migrations, JWT authentication, and CORS configuration for the frontend.

## Docker deployment and CD

The backend runs in a Python 3.12 container. The frontend uses a multi-stage
Node build and an Nginx container. `compose.yml` at the repository root runs both,
with restart policies and health checks. Nginx serves React routes and proxies
`/api/*` to the backend, including refresh-cookie path rewriting.

Both CD workflows deploy after a PR into `main` is **merged**, using the MacBook
runner labelled `self-hosted`, `macOS`, and `fotosinteze-production`. They build
the corresponding image locally and run `docker compose up --wait`. Backend CD
stops the old backend and takes a SQLite backup before replacing it. Migrations
run once in CD before the replacement container starts. Neither CD workflow reruns
tests; require the existing backend and frontend CI checks and an up-to-date PR
branch in `main` branch protection. Closing an unmerged PR or pushing directly
to `main` does not deploy.

### One-time MacBook setup

1. Install and start Docker Desktop or Colima with Docker Compose v2. The runner
   user must be able to run `docker info` and `docker compose version`. Keep the
   Docker runtime running, the MacBook plugged in, and automatic sleep disabled.
2. Register a GitHub self-hosted macOS runner with the custom label
   `fotosinteze-production`. Install/start its service with `./svc.sh install`
   and `./svc.sh start` from the runner directory.
3. Create the persistent data and configuration directory as the runner user:

   ```bash
   mkdir -p "$HOME/fotosinteze-backend"
   chmod 700 "$HOME/fotosinteze-backend"
   ```

   Create `$HOME/fotosinteze-backend/.env`:

   ```dotenv
   JWT_SECRET=replace-with-a-long-random-secret
   CLIENT_URL=http://localhost:8080
   ```

   Restrict it with `chmod 600 "$HOME/fotosinteze-backend/.env"`. Set `CLIENT_URL`
   to the actual frontend browser origin when using a public domain. Other
   production settings can also go here. Secrets are injected at runtime and
   excluded from Docker build contexts.
4. SQLite lives at `$HOME/fotosinteze-backend/database.sqlite`, mounted into the
   backend as `/data/database.sqlite`. Compose sets this database URL regardless
   of an older `DATABASE_URL` in `.env`. An existing database at that host path
   is preserved. To move another existing database here, stop its writer and use
   SQLite's backup facility before the first container startup. An empty data
   directory creates a fresh database. Backups are retained in its `backups/`
   subdirectory; keep off-device backups as well.
5. If you used the previous deployment, stop the `com.fotosinteze.backend`
   LaunchAgent and host Caddy server before starting containers, so ports 8000
   and 8080 are available. Keep the persistent database and `.env`.

### Run locally on the deployment host

From the repository root, with the production directory prepared:

```bash
export BACKEND_ENV_FILE="$HOME/fotosinteze-backend/.env"
export BACKEND_DATA_DIR="$HOME/fotosinteze-backend"
docker compose build
docker compose run --rm --no-deps backend alembic upgrade head
docker compose up -d --wait
docker compose ps
docker compose logs --tail=100 backend frontend
```

The frontend is at `http://localhost:8080`, and the API at
`http://localhost:8000`. Ports bind to loopback; use an HTTPS reverse proxy or
tunnel for remote access. No host Node, Python, Nginx, or Caddy service is needed.
Containers survive the CI job and restart with the Docker daemon unless manually
stopped. They still depend on the MacBook and Docker runtime being awake/running.

Backend deployments have brief downtime during backup, migration and restart.
A failed migration leaves the backend stopped; inspect the CD output before
repairing data and rerunning deployment. There is no automatic
database downgrade. Frontend and backend update separately and must tolerate the
brief version mismatch. Old Docker images and SQLite backups are retained for
manual cleanup; do not delete the persistent data directory.

References: [the deployment example](https://medium.com/@williamtijesuni/deploying-a-fastapi-application-with-ci-cd-pipeline-7641f6ce7c16),
[Docker Compose health waiting](https://docs.docker.com/reference/cli/docker/compose/up/),
and [Nginx proxy configuration](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).

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

### Add and remove employees (ROLE-02)

Business Workspace owners can add an existing registered user by email:

```http
POST /workspaces/12/employees
Authorization: Bearer <access_token>
Content-Type: application/json

{"email": "employee@example.com"}
```

The response is `201` with `user_id`, `workspace_id`, `display_name`, `email`,
`role` (`EMPLOYEE`), nullable `department_id`, and `joined_at`. Surrounding email
whitespace is trimmed and lookup is case-insensitive; legacy accounts that
match the same email ambiguously return `409`. The user must already exist.
The request accepts `email` (at most 100 characters) and an optional positive
`department_id`, never a role. The department must belong to the same workspace;
adding the membership and assigning the department commit together.

Without `department_id`, new employees are unassigned. They can discover the
workspace through `GET /workspaces`, but department-scoped operations are denied until an owner
assigns them with `PUT /departments/{department_id}/employees/{user_id}`.

Owners can list current members with `GET /workspaces/12/members`. The response
is an array with the same member fields as the add response, including owners
and each employee's current department. Other workspaces and private user fields
are excluded.

Remove an employee with `DELETE /workspaces/12/employees/42`, using the same
Bearer authentication. Success returns an empty `204`. This deletes only the
employee's membership in that workspace: the user account, other memberships,
expenses and transaction history remain intact. The same token loses access
to the workspace on its next request, without logging the user out globally.
Every OWNER membership is protected from removal, including the last owner.

All three routes use the workspace ID in the path and require no `Workspace-ID`
header. Only owners of that Business Workspace can call them. Personal
Workspaces return `400`; missing authentication returns `401`; unauthorized
callers or OWNER removal return `403`; missing workspace/user/membership
returns `404`; adding an existing member or an ambiguous email returns `409`;
invalid email, extra body fields or nonpositive IDs return `422`. A missing
department returns `404`; a department from another workspace returns `400`.
Repeated removal returns `404`. These routes do not send invitations or create
user accounts.

### Assignments and project access

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
existing accounts and transaction references. Revision `b49d02e71a63` adds
`is_main`, defaulting existing accounts to false, with at most one main account
per workspace enforced by a unique index.

Account routes require a bearer token and `Workspace-ID`. Personal workspace
members can manage their accounts. Business members can read accounts;
creating, updating or deleting accounts requires the owner. IDs are always scoped to the selected
workspace; an account from another workspace returns `404`.

- `GET /accounts` lists accounts in ID order.
- `GET /accounts/{account_id}` reads one account.
- `POST /accounts` creates a manual account with `name`, `currency` (three uppercase
  letters), `balance` (a decimal with at most two decimal places), and optional
  `is_main` (a strict boolean). The first account in a workspace is automatically
  main; later accounts default to false and preserve the current main account.
- `PUT /accounts/{account_id}` updates supplied `name`, `balance`, and/or `is_main` fields;
  omitted fields are preserved. Explicit null and unknown fields are rejected.
- `DELETE /accounts/{account_id}` deletes an unused manual account and returns
  `204` with no body. Accounts with transactions or a bank connection (including
  expired connections) return `409`; transaction history and connections are
  preserved. Deleting the main account does not automatically select a replacement.

Names are trimmed, nonempty, at most 120 characters, and checked for duplicates
in the workspace. Responses use the existing `balance` field for current balance
and serialize money as decimal strings. Negative balances are allowed.
Currency, workspace, connection and bank identifiers cannot be edited.

Account responses include `is_main`. Setting it to true atomically clears the
previous main account in that workspace, including when creating an account.
Setting it to false leaves the workspace without a main account. Main-account
changes are serialized with a workspace row lock on PostgreSQL. Connected
accounts can also be main accounts. The frontend prefills the main account for
new income and expense transactions; users can override it, and editing an
existing transaction preserves its original account.

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

## Analytics aggregation (MET-01)

The following read-only endpoints require a bearer access token, `Workspace-ID`,
and ISO `date_from` and `date_to` query parameters, for example
`GET /statistics/summary?date_from=2026-10-01&date_to=2026-10-31`.
Both dates are inclusive and use transaction `created_at` in the same naive
server-local time convention as transactions and the dashboard.

Every response contains `workspace_id`, `currency`, `date_from`, and `date_to`,
plus these fields:

| Endpoint | Response fields |
| --- | --- |
| `GET /statistics/summary` | `income`, `expenses`: decimal strings, e.g. `"1000.25"`, `"250.10"` |
| `GET /statistics/categories` | `items: [{"id": 11, "name": "Food", "amount": "250.10"}]`; expense categories ordered by amount descending, then ID |
| `GET /statistics/timeseries` | `items: [{"date": "2026-10-01", "amount": "250.10"}]`; daily expense totals in ascending date order, including `"0.00"` for days without spending |

Aggregates use all matching transactions, regardless of transaction-list
pagination. Income/expense classification follows the current category type.
Only the workspace's base currency counts, with no currency conversion;
uncategorized transactions and categories from other workspaces are excluded.
Approved expenses count through their linked transaction exactly once; pending
expense requests do not count. Changes and deletions are reflected on the next
request. Empty periods return zero summary totals, no category groups, and zero
daily points for each selected date.

Personal workspace members and business owners see workspace totals. Business
employees see only their assigned department; shared projects do not widen
access. Missing/invalid employee department assignments and inaccessible
workspaces return `403`; unauthenticated requests return `401`. Missing or
malformed dates/headers return `422`; reversed date ranges return `400`.
Daily series are limited to **3660 inclusive days** to bound response size;
larger daily ranges return `400`. Summary and category ranges have no such limit.

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

## Transaction search and filters

`GET /transactions` accepts optional, combinable query parameters:
`search` (trimmed, case-insensitive literal substring of description, max 255 characters),
`type` (`INCOME` or `EXPENSE`, determined by category),
`source` (`MANUAL`, `BANK`, or `EXPENSE`), `category_id`,
`date_from` and `date_to` (inclusive `YYYY-MM-DD` creation dates),
`department_id`, and `project_id`. Transactions currently have no separate name field.
Blank search behaves like omitted search. Uncategorized transactions do not match a type filter.

All filters apply before `limit`/`offset` pagination within the active `Workspace-ID`.
Department/project filters require a business workspace (400 otherwise).
Unknown or foreign department/project IDs return 404; employees cannot filter another
department or inaccessible project (403). Shared projects still expose only the employee's
assigned department transactions. A reversed date range returns 400; malformed dates,
invalid types, and nonpositive IDs return 422. No matches return an empty `items` page.
Dates use the existing stored creation timestamps without timezone conversion.


## Local demo transactions

To populate an existing local Personal workspace with sample transaction history:

```bash
cd backend
.venv/bin/alembic upgrade head
.venv/bin/python -m app.services.revolut_demo --workspace-id YOUR_PERSONAL_WORKSPACE_ID
```

The command is restricted to this checkout's `backend/database.sqlite` and a
localhost frontend origin. It creates three `[DEMO] Revolut` accounts (GBP, EUR,
USD), with sample salary, grocery and coffee records: nine transactions total.
All descriptions/categories are labelled `[DEMO]`, and records use the `MANUAL`
source. They are local fixtures, not transactions returned by Revolut. Existing
accounts and the selected main account are preserved. Rerunning skips existing
demo transaction IDs. It never sends requests to Revolut or changes its balances.
Use a backup before populating an existing development database.

## Real personal Revolut accounts through Enable Banking

This integration uses Enable Banking's production Account Information API.
An Active/Restricted application can read only
accounts linked in its control panel. Supporting other customers requires the
provider's general availability approval; account linking alone does not grant it.
See the [linked accounts guide](https://enablebanking.com/docs/api/linked-accounts/)
and [API reference](https://enablebanking.com/docs/api/reference/).

Configure the backend environment, keeping the downloaded private key outside Git:

```dotenv
ENABLE_BANKING_APP_ID=your-production-app-uuid
ENABLE_BANKING_PRIVATE_KEY_PATH=/data/enable-banking/private.pem
ENABLE_BANKING_REDIRECT_URI=https://api.fotosinteze.lat/enable-banking/callback
```

The example key path is inside the production container's existing `/data` mount.
Keep its file readable only by the server user (`chmod 600`). Keep the existing
`REVOLUT_TOKEN_ENCRYPTION_KEY`: it encrypts stored Enable Banking sessions.
Changing it makes existing connections unreadable. The retired `/revolut/*` and
`/.well-known/jwks.json` endpoints are no longer exposed. Old sandbox certificate
settings are accepted for existing `.env` files but are unused and can be removed.
Historical connection rows and migrations remain to preserve account data. All new settings are optional
until the real-account integration is used. SQL parameters are hidden even when SQL
query logging is enabled, so bank descriptions and balances stay out of SQL logs.

Deploy migration `e14a86c72d39` with `alembic upgrade head` before this backend starts.
It preserves existing accounts/history, adds a separate encrypted session table,
links imported accounts, and enforces stable provider transaction IDs per account.
The downgrade refuses while accounts remain linked to prevent silent conversion to
manual balances. Back up the database first; the CD workflow already does this.

After deployment, open a Personal workspace → Accounts → **Connect real Revolut**.
Approve in the same browser, return to Fotosinteze, then click **Sync accounts and
transactions**. Linking accounts in Enable Banking's portal activates access; this
separate consent creates the Fotosinteze session. The callback must use the same
backend hostname as the authorize request so its Secure/HttpOnly cookie arrives.
The local Vite `/api` proxy is suitable for mocked tests, not this deployed HTTPS
consent journey. Never point a local app at the production API just to bypass this.

Routes (all except callback require authentication and `Workspace-ID`):

- `GET /enable-banking/connection`: safe connection/expiry/last-sync status.
- `POST /enable-banking/authorize`: consent URL and ten-minute browser binding.
- `GET /enable-banking/callback`: removes provider query parameters from browser
  history and posts the code with no third-party resources; application access logs
  omit the query. Configure any external proxy logs to omit callback query strings too.
- `POST /enable-banking/callback`: atomically consumes state, rechecks workspace
  access, exchanges the one-use code, and encrypts only the session/account metadata
  needed to sync. A failed reconnect keeps the established session.
- `POST /enable-banking/sync`: imports all approved active accounts, balances and
  booked transactions; returns account/import counts and the UTC last-sync time.

Sync validates all pages before writing anything, follows continuation keys even on
empty pages, and fails without partial writes on malformed data or repeated keys.
Only positive BOOK transactions are imported; pending entries wait until booked,
and zero-value entries are skipped. Stable
`identification_hash` plus currency identifies accounts across reconnects;
`entry_reference` identifies transactions per account. Missing stable references
or booking dates fail safely instead of inventing IDs or dates. Repeating sync does
not duplicate entries and preserves user categories, account names and main account.
Imported records use BANK source and workspace-specific income/expense categories.
Bank transaction financial fields and deletion are protected; descriptions and
categories of the same income/expense direction remain editable.
Provider balances are authoritative; importing or editing local entries does not
apply their amounts again to bank balances. Overdrafts are supported.

This first version targets Revolut Latvia personal accounts and manual sync. It
imports the history the bank exposes, without claiming instant updates. Transactions
must fit the application's existing Decimal(10,2) currency model; unsupported
precision/ranges and more than 1000 pages per account fail without partial writes.
Mocked integration checks run with `.venv/bin/python -m pytest tests/test_enable_banking* -q`.
A real end-to-end test requires deployment and the account holder's bank approval.
