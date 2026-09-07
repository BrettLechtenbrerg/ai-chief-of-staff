# Local finance renderer verification

Run from the repository, with the already-installed dependencies:

```sh
node node_modules/vitest/vitest.mjs run --config tests/manual/finance-ui.config.ts
FINANCE_ELECTRON_FIXTURE=1 node node_modules/vitest/vitest.mjs run --config tests/manual/finance-ui.config.ts
```

These are explicit manual-suite entrypoints, not part of the default unit-test
file glob. They use real panel/sidebar code, validation and temporary SQLite
records. Dialog/provider answers and the financial renderer bridge are inert.
Native confirmation routing is covered separately by `finance-ipc.test.ts`.

The Electron command starts only `finance-electron.cjs`, never the application's
main process. Its profile is under the uniquely created `.gg/finance-ui-*` folder;
there is no live userData, scheduler, connector, provider or installed-app access.
The native window is hidden, sandboxed and context-isolated. Its test-only preload
exposes bounded zoom control, not application IPC. Network requests are denied by
a local rejection proxy and page/session handlers. No dependency download or
sandbox relaxation is used. Owned browsers/processes are closed after the run.
This isolation is not an OS-level network or data-loss-prevention certification.

Screenshots, contrast samples, accessibility-tree snapshots and synthetic records
remain in that ignored evidence folder. The suite prints its location. Do not
replace older evidence with a rerun. All amounts/names in the fixture are invented
and explicitly synthetic. Never paste actual credentials into the connector card.

Coverage includes setup/import/manual flows, refusal and retry, retained drafts,
failed scope switches, keyboard focus, named controls/regions, contrast, panel
cleanup, RTL, forced colors and reduced motion. Native mode additionally checks
real Electron 200% zoom. Browser local-document guards are exercised without
sending fixture content to any model.

## Completed scoped human checkpoint

Brett reports that clicking boxes and other controls caused VoiceOver to explain
what they were, consistently across the controls he tried. This is positive
human evidence for spoken identification during pointer navigation, not a
per-control audit. Brett subsequently reported keyboard access almost everywhere,
except Export and Analyze with AI. Inspection of the still-open synthetic fixture
found two entities, one account, and zero accounts in the selected entity: there
was no report and both actions were correctly disabled. Selecting the existing
populated synthetic entity restored both actions; real keyboard Tab from Backup
reached Export, then Analyze. No finance data or production code was changed.
After reopening the synthetic fixture with its populated ledger, Brett confirmed
VoiceOver announced both Export and Analyze during the instructed keyboard check.
Brett then confirmed both button announcements and the synthetic denial were
spoken correctly. Brett subsequently reported that the original three requested
checks worked, but he could reach Category/month actuals without reaching its
individual items or hearing amounts. That report prompted a separate native AX
inspection and listening check rather than speculative table changes.
Inspection of his still-open synthetic fixture
found the category section expanded, visible and not inert. Chromium exposed its
table, four column headers and eight cells. A read-only native macOS AX inspection
also found the category AXTable, rows, cells, and currency-valued static text
(occurrences include both native row and column traversal, not unique amounts).
Thus missing table data in the accessibility tree has not been reproduced.
Scripted VoiceOver interaction was unavailable; the brief attempt's VoiceOver
process was stopped, and no permissions were changed. Brett then confirmed that
actual amounts were spoken on the final reading pass. He clarified that apparent
self-checking boxes were a moving outline accompanied by speech, not checkbox
values changing; this was VoiceOver continuous reading. Button/denial speech,
approval focus/return, and table read-aloud are confirmed by his reports. This is
representative human evidence, not exhaustive per-cell navigation testing or a
conformance claim. Step 16's scoped checkpoint is complete. VoiceOver was stopped
and the synthetic window closed; the human-session harness completed 15 cases
(evidence: `.gg/finance-ui-6ShuDB`). Read-only native probe:
`.gg/step16-native-table-check.swift`.

With Brett present and ready, this opt-in command runs the checks, then opens the
synthetic Electron window for up to 60 minutes. Closing that window cleans up the
owned session. The installed app remains untouched; VoiceOver is not toggled by
the harness. A successful harness run is not a human accessibility verdict.
The window lifetime was extended because 15-minute closure repeatedly interrupted
Brett's checks. After this harness change, all 14 isolated Electron tests passed
(evidence: `.gg/finance-ui-islShl`). Synthetic approval requests still expire after
15 minutes; extending the review window does not extend production approvals.

```sh
FINANCE_ELECTRON_FIXTURE=1 FINANCE_VOICEOVER_CHECK=1 node node_modules/vitest/vitest.mjs run --config tests/manual/finance-ui.config.ts
```

Add `FINANCE_APPROVAL_REVIEW=1` to start the human session at the real tool-approval
renderer with an inert synthetic request. The bridge only records the decision;
there is no message sender. Initial focus is Deny; Escape denies and restores
focus to the overview's actuals table region. Check spoken dialog context, Tab
and Shift-Tab containment, denial, and table caption/header/value navigation.
The initial keyboard assertion incorrectly treated focus on the scrollable
argument preview as escaping the dialog. Code review caught this; the focus loop
and regression now include the preview and both buttons, with wrapping in both
directions. Background content is inert during approval, and pre-existing inert
state is preserved on dismissal. Verification after the correction passed all
13 Chrome tests and all 14 isolated Electron tests, including the corrected
approval regression. Evidence: `.gg/finance-ui-2YqJLT` (Chrome) and
`.gg/finance-ui-b0lQmn` (Electron). See the human observations above for the
separate spoken-output confirmation and its scope.

AX-tree assertions are not a VoiceOver listening test. Coordinate with Brett before
showing a visible isolated demo or enabling the Mac's screen reader. Check spoken
labels, entity/currency/year context, table navigation, validation announcements,
disclosures, approval attention/default Cancel, and focus after cancel/save/close.
Use only synthetic records and inert approval answers. Record the actual result;
do not mark step16 complete or proceed to packaging on the strength of automated
checks alone. Real provider/account checks remain unverified and must not incur
charges or use live records without the applicable operational gate.

## Synthetic renderer lifecycle check (step17)

```sh
FINANCE_PERFORMANCE_CHECK=1 node node_modules/vitest/vitest.mjs run --config tests/manual/finance-ui.config.ts
FINANCE_PERFORMANCE_CHECK=1 FINANCE_ELECTRON_FIXTURE=1 node node_modules/vitest/vitest.mjs run --config tests/manual/finance-ui.config.ts
```

These do not enable VoiceOver or show the hidden Electron window. Forty cycles
open Budget & Books, change tabs, visit Connect Tools, and return to chat. After
forced renderer GC, node/listener counts must not exceed the warmed first sample;
heap growth must remain below a locally chosen 1 MiB regression ceiling. This is
not a workday or whole-app leak-freedom claim. Startup measures the isolated
fixture through ledger readiness, including automation setup, not installed-app
startup or first streamed response. Renderer actions use the inert bridge, not
production native IPC timing. See each evidence folder's `renderer-performance.json`.

Passed: 14 Chrome cases (`.gg/finance-ui-YWyV9i`) and 15 Electron cases
(`.gg/finance-ui-SvRBZM`). Across 40 cycles, nodes/listeners stayed 5556/213 in
Chrome and 5532/213 in Electron. Initial apparent growth was caused by the probe
retaining a Puppeteer ElementHandle per connector visit; disposing those handles
removed the growth without changing production UI code or relaxing assertions.
Earlier harness errors used nonexistent tab/container/timer names and the wrong
panel visibility class; those were corrected to the existing UI contract.
