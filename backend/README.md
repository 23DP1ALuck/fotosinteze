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
