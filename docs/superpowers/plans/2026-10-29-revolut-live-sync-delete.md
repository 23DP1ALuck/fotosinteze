# Revolut recent sync and connection deletion implementation plan

> **For agentic workers:** Use superpowers:executing-plans or focused independent agents. Work directly in artjom/dev; no branches/worktrees.

**Goal:** Minimize supported transaction-display delay and allow deletion of a bank connection with its related local data.

**Architecture:** Reuse authenticated workspace-scoped Enable Banking routes and existing finance-cache invalidation. Keep pending transactions in an encrypted connection snapshot, display them separately from the booked ledger, and replace that snapshot only after a complete successful fetch. Use overlapping recent-history reads after the first import; retain full-history manual reconciliation. Foreground auto-refresh is opt-in, visible/active-user only, configurable, non-overlapping, and backs off on 429. Do not claim provider-approved five-second polling. Delete the provider session before atomically deleting scoped local records; preserve manual accounts/categories/budgets and invalidate all affected cached finance data. In-flight callbacks/syncs must not resurrect deleted data.

**Tech stack:** Existing FastAPI, SQLAlchemy/Alembic, Pydantic/Fernet, React/TypeScript, React Query, i18n. No new dependencies.

## Constraints and review focus
- Preserve pre-existing package-lock and tracked pyc changes; user owns these.
- Correct PSU headers only from actual user interactions and trusted request metadata; never fabricate presence/IP or forward arbitrary proxy headers.
- Pending entries must never enter booked totals or duplicate booked entries. Missing/unstable provider IDs must not create false persistent ledger records.
- Atomic sync/deletion, workspace isolation, post-deletion races and expired credentials must be tested.
- Delete all transactions on the removed linked accounts, including locally added entries; explicitly say this in confirmation. Preserve unrelated categories used by budgets/manual records.
- Backend enforces auto-sync cooldown and retries; browser timer alone is insufficient across tabs.
- Fast polling is configurable and disabled by default until provider allowance is verified; user-triggered incremental sync and on-return refresh still available. Active-user automatic mode must be explicitly enabled.

## Work
- [ ] Implement recent history, encrypted pending snapshot, safe polling/cooldown/PSU headers and tests; map to RSYNC-01 and REV-04.
- [ ] Implement confirmation UI, auto-refresh and pending display with localized text, scoped cancellation/cache invalidation and tests; map to RSYNC-02/REV-05.
- [ ] Implement DELETE connection provider revocation plus atomic local purge, all-data confirmation, stale-sync/callback prevention and tests; map to REV-05/REV-03.
- [ ] Verify full backend/frontend suites, lint/build, migrations and independent review. Separate fix commits with exact matching Trello card names.
- [ ] Open PR artjom/dev -> dev with fix-prefixed matching task name, no GitHub comments; comment only PR URL on related Trello cards. No deployment or real bank data deletion.
