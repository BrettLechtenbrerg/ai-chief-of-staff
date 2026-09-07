# AI Chief of Staff — agent entry point

For “resume AI Chief of Staff”, use this repository:
`/Users/brettlechtenberg/dev/ai-chief-of-staff`.

Read `RESUME-PROMPT.md`, the current handoff at the top of `RECOVERY.md`,
`CLAUDE.md`, and `CONTEXT.md` before changing anything. The long recovery log
contains historical instructions; current handoff constraints take precedence.

- Preserve the current checkpoint branch and all user work. Inspect Git status;
  never reset, discard, or overwrite unfamiliar changes.
- `.gg/` holds private acceptance helpers and consumed approval markers. It is
  deliberately not published. Missing files in a clone are not unused approvals.
- No real financial test data, API billing, publishing, or automatic-service
  resumption without specific authorization. Keep the known ChatGPT OAuth route.
- Preserve Brett's authorized Google access. Never reset Keychain, export tokens,
  grant permanent access, or hot-patch the installed signed app.
- Back up and verify a separate restore before data-affecting recovery. Code
  archives do not replace app-data or credential recovery.
- `docs/SESSION-CLOSEOUT-2026-09-06.md` records closing checks and backup receipts;
  unfinished acceptance is not a finished release.

Follow `CLAUDE.md` for project/build conventions. During an Ideal review, do not
run builds, typechecks, linters, or suites; reserve those for explicit verification
or commit work. Use absolute paths and keep unrelated repositories untouched.
