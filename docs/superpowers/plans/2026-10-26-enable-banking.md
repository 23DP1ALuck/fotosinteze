# Enable Banking real Personal Revolut integration

User authorized implementation after activating and linking their own production account.

- [x] Add optional Enable Banking app/key/callback configuration and a pinned TLS client. Authenticate with short-lived RS256 JWTs; never log private keys, provider responses or callback codes.
- [x] Persist a separate EnableBankingConnection per Personal workspace, with encrypted session/account metadata and browser-bound one-use pending authorization. Keep sandbox connections intact. Implement `/enable-banking/authorize`, `/connection`, `/callback` GET bridge + POST exchange, and `/sync`.
- [x] Add Account.banking_connection_id and stable external identity mapping; enforce unique per-account external transaction IDs. Protect bank-managed balances in all existing account/transaction writers and show linked state in account UI.
- [x] Fetch and validate all account balances and all transaction pages before atomic upserts; import booked entries only, require immutable entry_reference, preserve categories of existing transactions, use scoped income/expense categories for new records. Do not double-apply transaction amounts to bank balances. Reject stale session/consent snapshots and pagination loops.
- [x] Add Personal-only Connect real Revolut / Sync UI with authenticated workspace requests, status/last-sync/errors and query refresh.
- [x] Test transport, callback replay/cookie/authorization, encrypted persistence, access restrictions, malformed data, rollback, stable account mapping, idempotency, transaction direction/date/category and migration preservation. Run full backend/frontend suites, lint/build and independent review.
- [x] Commit on feat-artem/revolut-conn, PR to dev first. Provision server env without exposing keys; deployment and real bank consent require the normal review/user flow. Do not merge or silently authorize bank access.

Decisions: support Revolut Latvia Personal first, requested access capped at bank maximum/90 days. Use existing Fernet key for encrypted provider sessions. Separate provider state prevents accidental use of sandbox credentials in production. Restricted production remains limited to linked own accounts. No payment initiation or background polling.

Verified locally: 255 backend tests plus 197 subtests; 270 frontend tests, lint and build passed after merging current dev. PR #89 targets dev. Server environment provisioned; deployment and live account-holder consent remain outside this implementation.
