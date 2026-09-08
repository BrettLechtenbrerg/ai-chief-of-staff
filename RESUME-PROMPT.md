# Resume AI Chief of Staff

Updated: September 7 local / September 8 UTC — both upgrades installed; app stopped for verified closeout.

Brett can simply say: **“Let’s resume work on the AI Chief of Staff project.”**

## Start here

1. Work only in `/Users/brettlechtenberg/dev/ai-chief-of-staff`.
2. Read `AGENTS.md`, the top of `RECOVERY.md`, then `CLAUDE.md` and `CONTEXT.md`.
3. Check the branch and worktree without resetting or overwriting anything.
   The session checkpoint branch is `checkpoint/2026-09-06-session-closeout`.
   The remote is `BrettLechtenbrerg/ai-chief-of-staff` (spelling intentional).
4. Consult `docs/SESSION-CLOSEOUT-2026-09-07.md` for backup and verification
   receipts. Do not confuse an old release checkpoint with current app data.

## Current product state

- A corrected, signed/notarized private Intel build is installed. It is not a
  newly published public release. Do not hot-patch or replace its signed bundle.
- Both Hook Lab upgrades are installed. The app was stopped normally for the
  closing backup. Automatic services must remain paused. Do not relaunch normally
  from the Dock:
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

## Latest closeout

The closing checkpoint is `checkpoint-step18-HQEWjy` under the existing backup
root. Restore drills and post-suite data/config comparisons passed. Typecheck,
lint and **1,824 tests / 101 files** passed. See the current closeout document for
GitHub and private-archive completion receipts; never infer encrypted external
backup success from a pending recipe or local copy. The Desktop resume pointer
is `~/Desktop/Resume Prompts/AI-CHIEF-OF-STAFF-RESUME.md`.

## Next useful work

**Second upgrade installed with Brett's approval:** Hook Lab now saves exact full
scene scripts with drafts, restores them on load and sends all scenes to Video
Studio review/kickoff data. **49 targeted tests** and browser round-trip checks
passed. Signed/notarized packaging and guarded installation passed; native
accessibility opened the installed save/send section and confirmed both new buttons.
No model generation, render, publication or synthetic draft save in the installed
app was performed. The browser preview server is stopped; use the actual app.

Pre-install backup: `checkpoint-step18-VLLpcv` (closing backup above is newer).
Current prior-app rollback: `/Applications/.acos-install-rbcz2L/previous.app`.
New script-bearing records use v2 inside the existing v1 library envelope; v1
records remain readable without migration. An older app cannot read v2 records,
so preserve newer library data before any rollback. All original non-settings
rows and Google/MCP files were preserved; only valid window geometry changed.
The app is stopped, with automatic services still paused. Continue connector
validation only within existing authorization; no further installation is needed
for this feature. See the recovery handoff for shutdown notes and exact receipts.

The preceding **Check scene timing** upgrade is installed in the actual app after Brett's
explicit approval. It reports per-scene overruns, gaps, overlaps and requested-duration
mismatches, with bounded input and stale-result clearing. **38 feature tests**,
isolated browser checks, **59 installation/build-policy tests**, signed packaging,
Apple notarization and guarded startup passed. Native accessibility opened Hook Lab
and confirmed the new controls. The private build still displays `1.0.0-beta.25`;
there was no public release/version bump. Use the actual app, not the old preview.

Earlier timing-upgrade backup: `checkpoint-step18-XTpzCH` (not the latest backup).
Earlier rollback bundle: `/Applications/.acos-install-ytHQft/previous.app`.
Original non-settings rows and Google/MCP files were preserved; the only changed
setting was valid window geometry (`window.chatBounds`). See the current recovery
handoff for exact receipts and verification limits. Keep Google access and paused
service guards unchanged while continuing connector validation.

1. **Completed:** the synthetic Hook Lab scene-timing correction and local editorial
   handoff are in `.gg/hook-timing-handoff-2026-09-07.md` (private, ignored by Git).
   Five scene estimates fit contiguous slots totaling 30 seconds; all 73 spoken
   words, visuals and five hook elements are unchanged. The original app conversation
   remains unchanged. A timed read-through and any Video Studio import/preview are
   still pending; 0.8 seconds spare is not proof of natural delivery. Do not regenerate
   the consumed request or confuse the local handoff with an installed-app change.
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

The encrypted external-drive backup completed: all six private roots were
verified from a read-only mount in 164.09 seconds. The iCloud-local encrypted copy
also matches; iCloud server upload remains unverified. Keep the backup password
in a password manager, separately from the backup folders.
