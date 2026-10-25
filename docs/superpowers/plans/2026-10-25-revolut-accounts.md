# REV-03 Implementation Plan

> Use superpowers:executing-plans to implement task by task in the current checkout.

**Goal:** Import approved Revolut sandbox accounts and available balances into the Personal Accounts page.
**Architecture:** Reuse mTLS transport and encrypted connection credentials; validate remote data before a single atomic database upsert. Add a workspace-scoped endpoint and existing-page action.
**Tech stack:** FastAPI, SQLAlchemy, Alembic, Pydantic, React, React Query, Vitest.
**Spec:** ../specs/2026-10-25-revolut-accounts-design.md (approved).

## Constraints and review focus

Keep `feat-artem/revolut-conn`; target `main`; preserve user IDE edits. No production migration or deployment. Never log bank responses or credentials. Verify malformed balances, foreign account IDs, concurrent consent replacement, preserved manual/main accounts and safe migration rollback.

## Task 1: Account persistence and import

Files: Account and RevolutConnection models, new Alembic revision, revolut_service.py transport allowlist, new revolut_account_service.py, revolut.py route; tests/test_revolut_accounts.py and migration test.

- [x] Write route tests for importing three accounts, repeated updates, access restrictions, expired/invalid credentials, Decimal debit balances, invalid provider data and unchanged data on errors. Run to observe failure.
- [x] Add nullable `external_account_id`, unique `(connection_id, external_account_id)` and one-to-many relationship; preserve legacy account links. Migration downgrade refuses incompatible multiple accounts.
- [x] Implement `import_accounts(workspace, db)` and `POST /revolut/accounts/import`; allow only account/balance GET paths in sandbox_request. Fetch all payloads before mutation, verify consent unchanged before commit, preserve names/manual/main accounts, return count and UTC last-sync time without credentials.
- [x] Verify migration data/foreign keys and account import tests, then full backend suite.

## Task 2: Accounts-page action

Files: RevolutConnect.tsx and its tests.

- [x] Add failing tests for successful workspace-scoped Load accounts, loading/errors, last-sync display and account cache refresh.
- [x] Add connected-only Load accounts action; invalidate workspace account/detail queries only for the still-active auth/workspace context. Preserve Connect/Reconnect and safe errors.
- [x] Run frontend suite, lint and build.

## Task 3: Review and delivery

- [x] Review final diff for trust boundaries, migration preservation and races. Fix issues and rerun affected checks.
- [x] Commit and push on existing branch; create and attach PR targeting main. Report local verification and deferred transaction/sync work. No automatic merge.


## Execution record

- Inline execution on the existing branch; design approved by the user. Reused installed libraries and account query keys; no production mutation.
- Red/green: import route tests initially failed with 404; UI import tests initially failed because the action was absent.
- Migration supports SQLite anonymous constraints and reflected PostgreSQL constraint names. Downgrade refuses multiple accounts before changing schema.
- Ruling: reject paginated snapshots with a safe error until traversal is implemented, rather than persist partial data. The verified sandbox returns a single page.
- Independent review: no actionable findings; migration, token secrecy, trust boundaries and failure rollback checked. PostgreSQL execution and true simultaneous DB-session stress were not exercised.
