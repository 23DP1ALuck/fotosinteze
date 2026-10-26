# REV-03: import Revolut sandbox accounts and balances

Scope selected by the user: REV-03 first. Source: https://trello.com/c/T3A5vuv6.

## Current state and intent

Authorization, encrypted tokens, workspace ownership and safe connection status already exist. The live sandbox connection returns three approved accounts (GBP, EUR and USD) and an `InterimAvailable` balance for each. No imported accounts are currently stored. The goal is to make those accounts and balances available in the existing Personal Accounts page.

## Approaches

- Complete REV-03 first, then transaction import and full sync: selected by the user; keeps the account persistence change independently reviewable.
- Implement accounts, transactions and manual sync together: deferred because REV-04 and RSYNC depend on account persistence and introduce separate mapping and deduplication rules.

## Proposed implementation

- Keep the current branch, `feat-artem/revolut-conn`, and open the implementation PR against `main` for the existing CI/CD workflows. Do not change production data or deploy a database migration during implementation.
- Add an authenticated, workspace-scoped `POST /revolut/accounts/import`. Reject Business workspaces, missing connections, expired access and undecryptable credentials with safe errors. Token refresh remains outside this card; expired access asks for reconnection.
- Reuse the existing verified mTLS sandbox client. Permit only the required account/balance GET endpoints on the pinned Revolut host. Do not follow provider links to arbitrary origins or log response bodies, tokens or identifiers.
- Fetch and validate every account and its balance before saving. Use Decimal for signed credit/debit balances; require matching account IDs and currencies. The live response's `InterimAvailable` balance is the initial supported balance type. Reject unsupported or ambiguous balances rather than inventing zero values.
- Migrate Account to support multiple accounts per connection. Add a nullable external account ID and a unique constraint on connection ID plus external account ID; remove the existing uniqueness on connection ID. Update the ORM relationship to a collection. Preserve legacy accounts and transactions; do not guess external IDs for legacy rows.
- Upsert imported accounts by connection ID and external account ID. Repeated imports update balances without duplicates. Preserve existing account names, manual accounts and the selected main account; follow existing first-account behavior for an empty workspace. Reject unexpected currency changes on an existing account.
- Apply changes and `last_sync_at` atomically. Recheck the connection/consent before committing so an in-flight import cannot apply to a replaced connection. A malformed response, provider failure or concurrent conflict leaves stored accounts and balances intact. Do not delete accounts absent from a later response.
- Add a Load accounts button with pending/error feedback in the existing Personal Revolut area. Refresh workspace-scoped account queries on success and display the existing last-sync field. Keep the existing Connect/Reconnect flow.

## Validation

- Test three accounts per connection, stable external-ID mapping, repeat import, credit/debit Decimal handling and preservation of manual/main accounts.
- Test authentication, membership and Business-workspace rejection, expired/invalid tokens, mismatched IDs/currencies, malformed balances, provider failures and rollback.
- Test migration upgrade against existing data, foreign-key preservation and uniqueness. A downgrade must fail safely if multiple linked accounts prevent restoring the previous one-account constraint; never delete them to force downgrade.
- Test loading/error/success UI and workspace-scoped query refresh. Run the complete backend and frontend suites, frontend lint and production build.

## Deferred work

REV-04 transaction imports and RSYNC-01/02/03 full sync are separate follow-up cards. This change does not import transactions, schedule jobs, add token refresh or change production configuration.
