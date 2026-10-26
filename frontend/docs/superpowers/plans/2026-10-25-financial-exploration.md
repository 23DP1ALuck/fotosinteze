# Financial exploration implementation plan

Goal: implement the four user-approved concepts in the current checkout, keeping the running preview and prior approved styling intact.
Spec: conversation approval of living mark, expense drilldown, monthly review/export, interactive landing preview; gentle Apple-inspired motion, reduced-motion support; preserve spacing and workspace colours.
Architecture: use existing workspace-scoped statistics and transaction queries, native modal dialogs, Web Animations API and CSS. No additional runtime dependencies. Implement inline.

- [x] Motion: test reduced-motion and interruption behavior; animate the existing mark on workspace switches and successful transaction actions. Use transform/opacity only; no endless decorative animations.
- [x] Expense exploration: test scoped category/date queries, paging, errors and workspace changes. Open an accessible drawer from personal/business expense totals. Category selection shows actual transactions in their original currencies. Keep the same period; never treat a partial page as a full total. Uncategorised entries require client filtering of paged expenses because the API only accepts numeric category IDs.
- [x] Monthly review: test month ranges, net results, empty/error handling and export privacy defaults. Load summary and category statistics for selected month; comparison uses previous month only when currency matches. Export PNG directly; print/save PDF through browser print with only the previewed information. No invented historical data or automatic sharing.
- [x] Landing demo: test personal/business switching and Overview/Transactions/Budgets tabs without API writes. Keep the existing hero layout and spacing.
- [x] Verify: build, tests, lint changed sources, browser keyboard/mobile/reduced-motion checks and export download. Compare existing failures with recorded baseline (4 existing failures: 3 auth-session, 1 WorkspaceFlow).

Review focus: workspace/role separation; stale data after scope changes; absent/zero income and currency mismatch; missing category IDs and paginated results; cancellation/focus restoration/reduced motion; export escaping and amount visibility.

## Verification and decisions
- Implemented in the current checkout to preserve the user’s running preview and earlier approved styling; no commits or publishing.
- Brand movement: 540ms tilt/settle and 420ms success pulse, cancel-before-replay; reduced-motion stays static. Demo selector glides over 420ms; drawers enter over 420ms and exit over 160ms.
- Drawer owns category-to-transaction exploration; transaction details expand inline instead of navigating away and losing period/category context.
- PNG is generated locally; PDF uses the browser print/save PDF UI. Default exports omit exact amounts and workspace identity.
- Monthly review uses actual summary/category APIs and previous-month comparison; no invented historical chart.
- Build passed, changed-source ESLint passed, 11 new tests passed. Full suite before the final export-escaping test: 208 passed, same four baseline failures (three auth-session and one WorkspaceFlow).
- Browser checks: personal/business drilldown, Escape and focus restoration, privacy toggles, real PNG downloads, demo keyboard tabs, mobile widths 375/768, reduced motion and no JS errors.
- Independent review found cache invalidation gaps, fixed with a delete → refreshed rows/category/review regression. Follow-up review confirmed the fixes.

## Follow-up: logo motion removed
User requested removal of the logo animation. Restored the static BrandMark and removed the motion event utility, all triggers, and its obsolete test. Drawer, demo selector, toggle, and button transitions remain.
