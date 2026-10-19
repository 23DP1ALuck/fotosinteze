# Analytics Aggregation Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return accurate, workspace-scoped income/expense totals, category spending, and daily spending for a selected period.

**Architecture:** Add three read-only `/statistics` routes, an analytics service, and typed response DTOs using the existing FastAPI/SQLAlchemy structure. Aggregate transaction rows in SQL; reuse authentication, workspace membership, and employee department checks. Preserve the existing dashboard API.

**Tech Stack:** Existing FastAPI, Pydantic, SQLAlchemy, Decimal, unittest/httpx and SQLite test fixtures; Compose also configures SQLite for deployment. No new dependency.

**Spec:** [MET-01](https://trello.com/c/8UDj6H3p/56-met-01-implement-analytics-aggregation-endpoints). Its parent, [Metrics/Charts](https://trello.com/c/H5sKaT7H), has no further requirements.

## Global Constraints

- Card scope: "Provide workspace-scoped aggregates for income vs expenses, spending by category and spending over time."
- Acceptance: "Aggregates match transaction data for the selected period and return chart-friendly structures."
- Dependency: Transactions, which already has CRUD and date-filtered listing in this checkout.
- Proposed decisions below fill gaps in the card; they are not additional acceptance criteria from Trello.
- Use bearer authentication and `Workspace-ID`; business owners see the workspace, employees see only their assigned department. Missing or invalid employee department returns 403.
- Match dashboard accounting: workspace base currency only, no conversion; classify by category type; exclude uncategorized rows. Count approved expenses through their transaction rows, never by adding expense request amounts separately.
- Use transaction `created_at` and the existing naive server-local date convention. Require ISO `date_from` and `date_to`, both inclusive, matching transaction-list date semantics. Reject reversed ranges with 400; malformed or missing dates return 422.
- Monetary values remain Decimal and serialize as decimal strings. Daily granularity is sufficient for this card; weekly/monthly options are outside this plan.
- Implementation decision: daily series accept at most 3660 inclusive days to bound response size; longer daily requests return 400. Summary and category ranges have no such cap.
- Do not implement UI, caching, persisted aggregates, schema migrations, or unrelated dashboard refactoring.

## Review Focus

- Cross-workspace or cross-department rows must never influence any aggregate; test all three routes.
- The entire end date must count; adjacent dates must not. Include leap-day and year-boundary fixtures.
- Other currencies and uncategorized rows must follow the documented exclusion rule consistently in all three responses.
- Empty periods return zero totals, empty categories, and daily zero points without division by zero.
- All three aggregates must reconcile across more than 100 transactions, without transaction-list pagination truncating results.

## Proposed API Contract

All routes require `?date_from=2026-10-01&date_to=2026-10-31` and return common fields `workspace_id`, `currency`, `date_from`, `date_to`.

| Route | Additional response fields |
| --- | --- |
| `GET /statistics/summary` | `income`, `expenses` as decimal strings |
| `GET /statistics/categories` | `items: [{id, name, amount}]`, reusing the existing `SpendingGroup` DTO; expenses only, descending amount then category ID |
| `GET /statistics/timeseries` | `items: [{date, amount}]`; daily expense sums in ascending date order, including zero days |

## Task 1: Period Totals and Access Contract

**Files:** Create `backend/app/api/routes/statistics.py`, `backend/app/services/analytics_service.py`, `backend/app/dto/analytics_response.py`, `backend/tests/test_analytics.py`; modify `backend/app/main.py` and `backend/README.md`.

**Interfaces:** Service entry point `get_summary(workspace: Workspace, current_user: dict, db: AsyncSession, date_from: date, date_to: date) -> AnalyticsSummaryResponse`. Shared response base carries the four common fields above. Keep date validation and transaction filter construction shared inside the analytics service; use the existing workspace dependency and `get_workspace_membership` for business authorization.

- [ ] Add failing HTTP tests, following `test_dashboard.py`'s isolated database and dependency overrides. Seed EUR income 1000.25 and expenses 250.10 in the selected period. Assert summary `income == '1000.25'` and `expenses == '250.10'`; add excluded foreign workspace, USD, uncategorized, and adjacent-date rows. Assert start midnight and end-day final microsecond count; assert leap day and year transition work.
- [ ] Add auth and validation tests: missing token 401, inaccessible workspace 403, missing header 422, malformed/missing date 422, reversed range 400. Assert an employee sees only their department; an unassigned employee receives 403. An empty workspace returns zero values.
- [ ] Run `cd backend && .venv/bin/python -m pytest tests/test_analytics.py -q`; expect failures because routes do not exist.
- [ ] Implement the DTO, summary route/service and router registration. Use SQL `SUM`/`CASE`/`COALESCE` across all matching transaction rows and workspace-scoped category joins. Apply inclusive dates consistently with transaction listing. Document the contract and accounting exclusions in the README.
- [ ] Run the analytics tests plus `tests/test_dashboard.py` and `tests/test_transaction_routes.py`; expect all to pass. Commit the completed deliverable.

## Task 2: Category and Daily Spending

**Files:** Extend the analytics route/service/DTO/test files and README from Task 1. Reuse `SpendingGroup` from `backend/app/dto/dashboard_response.py` without changing its fields.

**Interfaces:** Add `get_categories(workspace: Workspace, current_user: dict, db: AsyncSession, date_from: date, date_to: date) -> AnalyticsCategoriesResponse` and `get_timeseries(workspace: Workspace, current_user: dict, db: AsyncSession, date_from: date, date_to: date) -> AnalyticsTimeseriesResponse`. Both use the same authorization, currency, category and date filters as summary.

- [ ] Add failing tests with expenses 10.10 and 20.20 in one category and 5.00 in another. Assert category amounts `['30.30', '5.00']`, stable ID ordering for ties, expense-only groups, chronological daily points, and zero-valued missing days. Assert empty categories `items == []`; a three-day empty range has exactly three zero points.
- [ ] Run analytics tests and confirm new endpoint tests fail before implementing them.
- [ ] Implement SQL grouping by category ID/name and calendar date. Fill missing dates from grouped results, without loading individual transactions. Return typed arrays and common metadata; document response examples in README.
- [ ] Exercise all Review Focus cases against both new routes. Seed over 100 transactions and assert `sum(category amounts) == sum(daily amounts) == summary expenses`. Change and delete a permitted transaction and assert subsequent responses reflect the saved rows. Add an approved-expense fixture proving its linked transaction contributes once and pending requests contribute nothing.
- [ ] Run `cd backend && .venv/bin/python -m pytest tests/test_analytics.py tests/test_dashboard.py tests/test_transaction_routes.py tests/test_expenses.py -q`, then the backend test suite. Verify calendar-date grouping with PostgreSQL if a test database is available; otherwise report that gap. Commit the completed deliverable.

## Self-review

All three card outputs, selected-period filtering, access isolation, response shape, and numerical reconciliation are covered. No frontend caller currently consumes `/statistics`, so UI/client changes belong to the later chart integration task. Main limitations to disclose: base-currency-only totals, exclusion of uncategorized transactions, and creation-date/server-local time semantics inherited from the current dashboard.

## Execution results

- Both tasks are implemented; tests were observed failing on missing endpoints before the corresponding implementation.
- Focused analytics/dashboard/transaction/expense checks: 52 tests and 56 subtests passed.
- Full backend suite: 175 tests and 135 subtests passed, with 14 pre-existing warnings.
- Daily response size is bounded and tested at the 3660-day boundary, including rejection of the next day. A single date at year 9999 is supported without overflow.
- Independent review found SQLite's final-microsecond date overflow could omit a populated year-9999 expense from daily totals. A failing regression reproduced it; calendar extraction was corrected and the full backend suite passed again (175 tests, 135 subtests). No findings remain deferred.
- Changes remain uncommitted in the current checkout for review; Git metadata is read-only under this session's supplied permissions. PostgreSQL runtime and frontend integration were not checked.
