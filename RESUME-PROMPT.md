# Resume AI Chief of Staff

Updated: September 10, 2026 — approval policy and Claude-via-Max route installed; app stopped for verified closeout.

Brett can simply say: **“Let’s resume work on the AI Chief of Staff project.”**

> **Sept 29, 2026: fixes from the PMMA blog run are committed (`b276301`), pushed at closeout
> and installed** (signed + notarized private Intel build, `install-local.cjs` → `installed-ready`,
> first rollback `/Applications/.acos-install-8KMIfC/previous.app`; then quit and reopened normally so
> MCP servers run; routines still manual-only). No beta, release or website change.
> The run kept stopping at 20 steps, asked approval for every DataForSEO/Firecrawl call, and
> its shell could not reach `~/dev` or `~/Desktop` (a text filter treated `~/dev/...` as `/dev/`,
> `HOME` pointed at the workspace, and git/gh could not read their login). Changes: 150-step cap
> with a "say keep going" note and partial work kept; DataForSEO/Firecrawl search run unattended;
> "Allow web for this chat" button on web-read approvals; shell `HOME` is the real home; approved
> commands made only of `cd`/`gh`/`git push|fetch|ls-remote` can use the saved GitHub login, with
> repo-level hooks, fsmonitor and credential helpers overridden and any non-plain `.git/config`
> key refused (commit first, offline); Brett's rule in `system-guidelines.ts`: nothing goes public
> without his yes, everything else runs unattended, publishing is one final question + one popup.
> **Posting fix (`6e48b55`, installed; rollback `/Applications/.acos-install-XmCYrZ/previous.app`):**
> in approved publish commands `gh` acts as the repo owner's account (PMMARocks-1 for the PMMA
> site) via `gh auth token -u <owner>`; the Mac-wide gh account is not touched by the app.
> (Since Sept 29 closeout the Mac-wide account is `BrettLechtenbrerg`; BoardChairIs1 is pinned
> per repo to the Murray Chamber repos only.) `gh auth token`/`--show-token`/login/switch and
> `gh config` never get the login. Verified in the sandbox: gh acts as PMMARocks-1, sees PR #3,
> and `git push --dry-run` is accepted (nothing pushed). Typecheck, lint, 1869/1869 tests pass.
> Next: rerun the blog routine in a NEW chat and confirm it only asks for the topic and the
> final "post it?". June post PR #3 is still open and unmerged.
> **Closeout:** all four commits pushed to `checkpoint/2026-09-06-session-closeout`. The belt-order
> post is saved on PMMA branch `blog/2026-09-28-taekwondo-belt-order` (`de4925a`), not merged,
> not live. Full handoff: top of `RECOVERY.md`.

## Start here

1. Work only in `/Users/brettlechtenberg/dev/ai-chief-of-staff`.
2. Read `AGENTS.md`, the top of `RECOVERY.md`, then `CLAUDE.md` and `CONTEXT.md`.
3. Check the branch and worktree without resetting or overwriting anything.
   The session checkpoint branch is `checkpoint/2026-09-06-session-closeout`.
   The remote is `BrettLechtenbrerg/ai-chief-of-staff` (spelling intentional).
4. Consult `docs/SESSION-CLOSEOUT-2026-09-10.md` for backup and verification
   receipts (September 7 receipts remain in their own document). Do not confuse
   an old release checkpoint with current app data.

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
- Two working providers: ChatGPT OAuth (GPT-5.6 Sol) and **Claude via Brett's
  Max subscription** through his installed Claude Code binary (Settings › LLM ›
  “Claude Code (Max subscription)”). No paid API fallback. The Claude route is
  personal-build only; public downloads need their own keys. If Claude Code's
  sign-in expires, Brett runs `claude` then `/login` in Terminal.
- Approvals fire only for actions that leave the machine (send/execute/publish,
  CRM writes, browser acting, outbound shell). Local work runs unattended.
  **September 27 hardening (commit `a5e23aa`, signed/notarized private Intel
  build installed via `install-local.cjs` → `installed-ready`; rollback bundle
  `/Applications/.acos-install-gzdlLx/previous.app`; pushed to the checkpoint
  branch as a backup, no tag and no release):** agent
  shell commands run inside a macOS sandbox (`src/agent/shell-sandbox.ts`) with
  no network, no hidden home folders and no `~/Library` (except Caches, iCloud
  Drive and the app's workspace/attachments); network commands
  (curl, git pull/push, npm install, open…) ask and only then get network.
  File tools also refuse hidden home entries, `~/Library` (except iCloud Drive
  and the app's workspace/attachments) and `.git/hooks`/`.git/config`. Once a
  session has read untrusted content *and* private data (e.g. an email), new
  URLs via `web_fetch` or browser navigate ask.
- **Manual-only routines (Sept 27, commit `d1af714`, installed; rollback
  `/Applications/.acos-install-ISlEXi/previous.app`):** Brett chose to run
  routines by hand. `scheduler.enabled` is set to `false` (was `true`), which
  now means manual-only: routines are listed and "Run now" works, but no
  routine, due job or calendar/task reminder fires by itself. The app now runs
  in a normal launch (not validation mode), so Telegram and MCP servers are on.
  A routine's `send_telegram_message` shows one desktop popup with the exact
  text; nothing reaches the phone without that click. To restore automatic
  runs, set `scheduler.enabled` back to `true` and relaunch.
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

The closing checkpoint is `checkpoint-step18-Rd1lru` under the existing backup
root; restore drills passed. Typecheck, lint and **1,844 tests / 103 files**
passed. Commits `51754b6` (approval policy) and `2cc6d4c` (Claude Code route)
plus the closeout documentation are on the checkpoint branch; see the current
closeout document for push, secret-scan and private-copy receipts. The older
external encrypted backup was last observed `awaiting-encryption`; never infer
success from a pending recipe or local copy. The Desktop resume pointer is
`~/Desktop/Resume Prompts/AI-CHIEF-OF-STAFF-RESUME.md`.

## Next useful work

Connector validation within existing authorization. Rollback bundles for this
session's installs: `/Applications/.acos-install-kzeIks/previous.app` and
`/Applications/.acos-install-XpT7K9/previous.app`.

**Earlier Hook Lab upgrade (September 7):** Hook Lab now saves exact full
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
