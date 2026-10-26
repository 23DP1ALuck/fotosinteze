# Localization Implementation Plan

**Goal:** Implement the approved localization card https://trello.com/c/VBRSAg4G.
**Architecture:** i18next/react-i18next resources and shared language buttons; translated components subscribe to language changes without remounting. Preserve canonical API data and internal state.
**Tech stack:** React, TypeScript, i18next, Intl, Vitest.

## Global constraints
- Support en, lv, ru; saved choice, browser preference, then English.
- Preserve forms, workspace, authentication, amounts and API formats.
- Translate all app-owned UI, validation and errors with accessible mobile controls.

## Tasks
- [x] Shared i18n initialization, language control, formatting, tests and documentation.
- [x] Public/authentication pages and app shell translations.
- [x] Finance features: accounts, transactions, budgets, dashboards, statistics, expenses, Revolut.
- [x] Workspace administration: workspaces, categories, departments, projects, employees.
- [x] Full tests, lint/build, browser verification and final review.

## Review focus
Storage errors, regional language detection, live validation translation, stable navigation identifiers, and localized formatting without data changes.

## Verification — 26 October 2026
- `npm test -- --maxWorkers=2`: 33 files, 267 tests passed. Worker limit avoids local concurrent-suite timeouts; test timeouts were not increased.
- `npm run lint`: passed.
- `npm run build`: passed; Vite reports a large application chunk warning.
- `git diff --check`: passed.
- Browser: EN/LV/RU public navigation, LV/RU login, live validation switching with retained email, persistence after refresh, desktop layout, 390px LV landing/login and no horizontal overflow.
- Automated transport-backed tests exercise both workspace types and financial/admin flows; no authenticated live-backend browser session was used.
- Independent review found and resolved stale translated detail snapshots, canonical source filters, in-dialog language access, untranslated shortcut fragments and safe API error handling.
- Human fluent-speaker translation review and live authenticated browser acceptance remain before release.
