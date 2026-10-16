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
Workspaces return the summary below. Business Workspaces return `200` with `null`
until their dashboard is implemented. Inaccessible workspaces return `403` for
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


## Revolut Open Banking sandbox configuration

This setup authenticates the backend to Revolut's Open Banking sandbox using
mutual TLS (mTLS). It does not enable production access, customer consents,
transaction syncing, or workspace/account linking. No database migration is
needed for this configuration task.

### Portal and local certificates

1. Create an application in the Revolut Developer Portal and enable
   **Account and Transactions (AISP)**.
2. Configure the sandbox redirect URL and generate a CSR using the portal's
   command. Run that command outside the repository, in a private directory
   such as `~/.config/fotosinteze/revolut-sandbox`, with `umask 077`.
3. Upload only `revolut.csr`. Keep the generated `private.key`; it must match
   the downloaded transport certificate. Download the sandbox certificates.
4. Download the sandbox Root CA and Issuing CA from the Open Banking page linked
   by Revolut's authentication documentation. Verify their published hashes.

Official references:

- [Revolut sandbox setup](https://developer.revolut.com/docs/guides/build-banking-apps/get-started/prepare-sandbox-environment)
- [Revolut authentication](https://developer.revolut.com/docs/api/open-banking)
- [Open Banking sandbox CAs](https://openbanking.atlassian.net/wiki/spaces/DZ/pages/252018873/OB+Root+and+Issuing+Certificates+for+Sandbox)

For the DER files currently supplied by the portal and Open Banking:

```bash
cd ~/.config/fotosinteze/revolut-sandbox
chmod 600 private.key
openssl x509 -inform DER -in transport.der -out transport.pem
openssl x509 -inform DER -in 'OB_SandBox_PP_Root CA.cer' -out sandbox-root.pem
openssl x509 -inform DER -in 'OB_SandBox_PP_Issuing CA.cer' -out sandbox-issuing.pem
cat sandbox-root.pem sandbox-issuing.pem > sandbox-ca-bundle.pem
```

If provided, convert `signing.der` to `signing.pem` the same way. Signing/JWKs
configuration is needed for the later customer-consent flow, not this
client-credentials connectivity check. A callback/tunnel is not needed to run
the token check; its registered URL will be used when implementing customer consent.

### Backend environment

Add these settings to the ignored `backend/.env`. Run backend commands from
`backend`, because `.env` and relative file paths are resolved from the current
directory. Certificate paths may be absolute or start with `~`.

```dotenv
REVOLUT_API_CLIENT_ID=your-sandbox-client-id
REVOLUT_TRANSPORT_CERT_PATH=~/.config/fotosinteze/revolut-sandbox/transport.pem
REVOLUT_PRIVATE_KEY_PATH=~/.config/fotosinteze/revolut-sandbox/private.key
REVOLUT_CA_BUNDLE_PATH=~/.config/fotosinteze/revolut-sandbox/sandbox-ca-bundle.pem
```

These settings are optional for normal backend startup. The Revolut helper
requires all four when called and loads the certificate/key at request time.
The sandbox authentication URL is fixed in the helper to prevent accidentally
sending credentials to another environment. Server hostname and certificate
validation remain enabled; no `verify=False` or `--insecure` is needed.
The HTTP client uses a 15-second timeout, does not follow redirects, and does
not inherit proxy settings from the shell.

### Secure backend connectivity check

From `backend`, run:

```bash
.venv/bin/python -m app.services.revolut_service
```

Success prints only the TLS-verification result and token lifetime. Failure
exits with a nonzero status and a sanitized error; tokens and response bodies
are never printed. This command calls the same async helper available to future
backend integration code:

```python
from app.services.revolut_service import get_sandbox_access_token

token = await get_sandbox_access_token()
# Only unwrap the secret when constructing the next authenticated API request.
authorization = f"Bearer {token.access_token.get_secret_value()}"
```

The token is held in memory only; request another after its returned lifetime
expires. Do not log the unwrapped token, authorization headers, or private keys.

Troubleshooting:

- Configuration error: set all four variables in `backend/.env`.
- Certificate/key/CA loading error: check paths, PEM format and matching key.
- TLS/connectivity error: check CA trust, certificate expiry, network and clock;
  do not disable TLS verification.
- HTTP 4xx: check sandbox client ID, certificate registration and AISP scope.

### Keep credentials out of Git

Store credentials outside the repository. `.env`, private keys, CSRs and
certificate formats (`.key`, `.csr`, `.pem`, `.der`, `.cer`) are ignored at the
repository root. `.env.example` contains placeholders only. Ignore rules do
not remove already committed files; rotate any exposed key and re-register its
certificate if necessary. The token helper does not create credential files.

Check tracked credentials and ignore rules without displaying secret contents:

```bash
git ls-files '*.key' '*.csr' '*.pem' '*.der' '*.cer' '.env' 'backend/.env'
git check-ignore backend/.env private.key transport.pem sandbox-ca-bundle.pem
```

Run automated checks from `backend`:

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_revolut_sandbox.py'
```

Tests generate temporary certificates and mock Revolut HTTP responses; live
connectivity is verified separately using the command above.
