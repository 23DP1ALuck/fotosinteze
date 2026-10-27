# Localization

The frontend uses i18next and react-i18next for English (`en`), Latvian (`lv`) and Russian (`ru`). The implementation follows [the localization card](https://trello.com/c/VBRSAg4G).

Language selection is initialized synchronously before rendering: a saved explicit choice in `fotosinteze.language`, then the first supported browser language, then English. Regional variants such as `lv-LV` resolve to `lv`. Storage failures affect persistence only. A shared EN/LV/RU button group appears on public, authentication and app screens, and inside modal dialogs so it remains reachable while editing. Switching updates React translations without remounting the app, so authentication, workspace, route and unsaved forms stay intact. The document language, direction and title update as well.

## Editing translations

Resources live in `frontend/my-app/src/i18n/`: `pages.ts` (public/auth/app shell), `finance.ts`, `admin.ts`, `insights.ts` and `common.ts` (shared calendars and form hints). Each namespace has matching semantic keys for all three languages. Some resources use rows containing English, Latvian and Russian together; others export one object per language. Missing keys fall back to English.

Use `useTranslation(namespace)` in every translated component so it subscribes to language changes. Use `t('semanticKey', { value })` for full sentences and interpolation. Do not concatenate translated fragments or use translated labels as route identifiers, enum values, query keys or business rules. Use i18next plural suffixes (`_zero`, `_one`, `_few`, `_many`, `_other`) appropriate to each language; shared item-count examples and tests cover Latvian/Russian forms.

Validation and API errors remain canonical in form/query state. The display helpers map known messages to semantic translation keys when rendering, so visible errors update without revalidation or losing drafts. Unknown server/network messages use a localized safe fallback. When adding a backend error, add its known canonical message mapping and translations; never render arbitrary server detail directly.

Use `getLocale()` with `Intl.NumberFormat`/`Intl.DateTimeFormat` for display. Keep actual currencies, amounts, ISO dates and API enums unchanged. ISO-valued calendar fields intentionally retain their canonical value while calendar names and controls translate. Text money fields accept an ungrouped decimal comma with up to two decimal places through `normalizeDecimal`, then validate the canonical dot decimal. Ambiguous grouped numbers are rejected. Native numeric inputs retain browser numeric input behavior.

User-entered names/descriptions, imported text and user categories are not translated. Generated fallback labels are translated separately from user-entered values. The installed Geist font includes Latin extended and Cyrillic glyphs; system fallbacks also remain available.

## Adding a language

Add the language to `Language`, `supported`, `getLocale()` and the language-button list; provide all namespaces and matching semantic keys. Update preference and resource-parity tests, verify plural rules, and check the document language/title and persistence. Update the resource types alongside the new language.

## Verification and release review

Run `npm test`, `npm run lint`, and `npm run build` from `frontend/my-app`. Localization tests cover detection precedence, regional variants, storage failure, resource parity, plural forms, document metadata, live validation/error translation, preserving draft inputs and open calendars, canonical decimal submission and translated export labels.

Before release, have fluent Latvian and Russian speakers review terminology, grammatical forms and the complete app. Check all three languages on desktop/mobile, both workspace types/roles, dialogs, long labels, validation and empty/error states. Check chart tooltips and export preview/PNG/print output. Browser-local preference does not synchronize across devices.

### Implementation verification (26 October 2026)

All 267 tests across 33 files pass using `npm test -- --maxWorkers=2`; lint and production build pass. Vite retains a large application chunk warning. Browser checks confirmed public EN/LV/RU switching, LV/RU login text and live validation, saved preference after refresh, and desktop/390px mobile layouts without horizontal overflow. Authenticated workspace flows were verified by the automated transport-backed tests rather than a live backend browser session. Fluent-speaker review remains pending.

Follow-up review: reserved space for absolute close buttons in account details, business workspace creation and workspace settings dialogs. Browser verification confirmed the RU control is not overlapped and switching preserves a draft. The fresh full suite remains 267/267 passing, with lint and build passing.

Conflict integration against current dev: preserved shared backdrop dismissal, bank-managed balance restrictions, bank transaction edit/delete guards and the Enable Banking panel. Added live Enable Banking result translation coverage. The combined suite passes 296 tests across 35 files; lint, production build and whitespace checks pass.
