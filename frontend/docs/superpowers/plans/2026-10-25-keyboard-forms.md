# Keyboard form flow

User approved Enter-to-next, final Enter-to-submit, Shift+Tab back, Ctrl/Cmd+Enter submit, multiline notes retain Enter. Starting midway must wrap to the earlier fields before submission. Keep all fields visible with gentle focus/scroll transitions and reduced-motion support.

- [x] Add behavior tests for middle-start wrap/submit, validation, textarea and composition, disabled/hidden fields, pending validation, dynamic controls and disabled submission.
- [x] Build shared KeyboardForm with per-form visited controls, existing RHF trigger support, native validity for other forms, real submit buttons and clear hints. Never intercept Enter on action buttons, file pickers, open custom comboboxes or IME composition. Preserve standard reverse tabbing.
- [x] Adopt across account, transaction, workspace, category, employee, department, project, budget, expense-request, authentication and date-filter forms. Add missing required attributes where business rules already require selections.
- [x] Verify real transaction and account keyboard-only flows, native selects, wrap from second field, validation, smooth scroll/focus, reduced motion, build/lint and existing suites. Baseline has four known failures (three auth-session and one WorkspaceFlow).

## Verification
- 11 focused keyboard-flow tests passed. Full suite: 219 passed; same four known baseline failures (three auth-session, one WorkspaceFlow).
- Build and ESLint passed for the shared component and all adopted forms.
- Browser verified real transaction forms with sample API boundary: begin at Amount (second field), native category typeahead + Enter, textarea newline + Tab, wrap to Account and submit once; income Ctrl+Enter; account creation Currency → Balance → Name → submit; invalid currency remains focused.
- Login and registration keyboard-only entry and final Enter submissions verified with isolated responses. Registration began at email, wrapped to name and submitted once.
- Mobile overflow and reduced-motion field transitions passed.
- Read-only controls preserve copying/focus but Enter moves past them rather than accidentally submitting. Hidden/disabled controls and action buttons are excluded.
- Budget draft changes remount the flow so progress from a different edit is not reused.
- Independent focused review found no important issues. Its suggested select/async-focus/checkbox/radio coverage was added via browser checks and targeted tests.

## Follow-up: explicit save and arrow navigation
User changed the shortcuts: plain Enter confirms/continues but never submits, including on a focused submit button. Ctrl/Command+Enter is the explicit keyboard save action; mouse save buttons remain available. Ctrl/Command+Up/Down navigates between editable controls, wrapping in both directions. Standard browser Tab navigation remains intact; the custom Tab wrap and Shift+Tab hints were removed. Multiline Enter and unmodified select arrows retain their normal behavior.

Verification: 13 focused tests passed; build and changed-source lint passed. Real browser checks passed for transaction/account explicit saving, native selects, bidirectional modifier arrows, validation, multiline notes, mobile and reduced motion; login/registration plain Enter made no save request and Ctrl/Command+Enter submitted once. Full suite: 221 passed, same 4 baseline failures.
