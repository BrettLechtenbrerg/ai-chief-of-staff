# Resume AI Chief of Staff

Updated: September 6, 2026 local / September 7 UTC.

Brett can simply say: **“Let’s resume work on the AI Chief of Staff project.”**

## Start here

1. Work only in `/Users/brettlechtenberg/dev/ai-chief-of-staff`.
2. Read `AGENTS.md`, the top of `RECOVERY.md`, then `CLAUDE.md` and `CONTEXT.md`.
3. Check the branch and worktree without resetting or overwriting anything.
   The session checkpoint branch is `checkpoint/2026-09-06-session-closeout`.
   The remote is `BrettLechtenbrerg/ai-chief-of-staff` (spelling intentional).
4. Consult `docs/SESSION-CLOSEOUT-2026-09-06.md` for backup and verification
   receipts. Do not confuse an old release checkpoint with current app data.

## Current product state

- A corrected, signed/notarized private Intel build is installed. It is not a
  newly published public release. Do not hot-patch or replace its signed bundle.
- The app was quit cleanly for the closing backup. Automatic services must remain
  paused during continued validation. Do not launch it normally from the Dock:
  first validate the installed bundle with `scripts/install-local.cjs`
  (`validateCandidate`), use its guarded `defaultTransport().launch`, and verify
  startup health. It checks the validation marker and sets
  `ACOS_INSTALL_VALIDATION=1`; do not bypass these guards.
- The working provider is ChatGPT OAuth / GPT-5.6 Sol. No paid API fallback.
- Synthetic finance, the TSAI SEO report and a synthetic Hook Lab draft are saved
  in the app. Brett confirmed the SEO report looks good.
- Finance, SEO and Hook Lab each consumed their one-use approvals. **Never retry
  them**, remove their `.gg/*.consumed` markers, or interpret a missing marker in
  a fresh clone as permission. Restore private helpers/markers from backup first.
- Brett authorized Google access in a native popup. Preserve the newer `flo-docs`
  entry; do not reset credentials or blindly restore an older MCP configuration.
- The corrected native inspector saw eight readable connector cards and one
  connected label, not eight proven live connections.

## Next useful work

1. Fix/review the synthetic Hook Lab draft's individual scene timing, then finish
   carefully scoped local content/handoff acceptance without publishing.
2. Continue connector validation without resetting Brett's authorized Google
   access. Never conflate paused services with a broken login.
3. Keep paid AEO runs excluded. Keep the custom Claude subscription client unused;
   any official unmodified Claude Code integration needs separate work and a
   current policy check (`COMPLIANCE.md`).

No public release, website deployment, paid request, automatic-service resumption,
real financial mutation, credential export or permanent Keychain access is implied
by “resume.” Historical instructions in the long recovery log are not new approval.

## Recovery boundaries

The closing app-data checkpoint is
`~/Library/Application Support/acos-local-improvement-backups/checkpoint-step18-9SP8m2`.
Main/finance restores, persistent-file restores and the installed-bundle copy were
verified. Source/GitHub and additional backup locations are recorded separately in
`docs/SESSION-CLOSEOUT-2026-09-06.md`. The broader private copy also preserves full
app-data/browser-storage bytes, shared Flo data, brand profiles and private helper
markers. Keychain is not exported; another Mac may need normal reauthentication.
A source-only archive is not an app-data backup. Never restore over live data.
