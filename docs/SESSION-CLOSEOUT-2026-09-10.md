# Session closeout — September 10, 2026

Source and recovery checkpoint for the private installation; not a public
release. Evidence labels: **CODE** inspected source, **RUNTIME** executed locally.

## Resume exactly here

Say **“Resume AI Chief of Staff from the latest session closeout.”**
Use `/Users/brettlechtenberg/dev/ai-chief-of-staff`, branch
`checkpoint/2026-09-06-session-closeout`. Read `AGENTS.md`, `RESUME-PROMPT.md`,
the top of `RECOVERY.md`, `CLAUDE.md` and `CONTEXT.md`. Desktop pointer:
`~/Desktop/Resume Prompts/AI-CHIEF-OF-STAFF-RESUME.md`.

Two owner-approved upgrades were built, installed and committed this session.
Do not rebuild them. The private app still displays `1.0.0-beta.25`; no release
tags, public updates or beta were published.

## Upgrade 1 — approvals only for actions that leave the machine

Commit `51754b6`. Brett's rule: ask before anything is published to his
calendar, sent as email, or otherwise faces the public; never ask for things
only he uses on this computer.

- **CODE:** `src/agent/tool-policy.ts`. `local-execute` and `set_project` no
  longer require confirmation. Shell commands ask only when the command word can
  leave the machine (`curl`, `wget`, `ssh`, `scp`, `rsync`, mail, `git push`,
  `npm publish`, deploy CLIs, `osascript`); matching is at command position, so
  `ls | grep curl` does not trip it. Browser `scroll`/`hover`/tab actions are
  unattended; `click`/`type`/`evaluate`/upload ask. Unknown tools still ask.
- **CODE:** Flo Google reads and every `propose_*` staging tool are classified as
  reads after inspecting the vendored servers: nothing reaches Google until the
  matching `*_execute`, which still previews and asks. `gmail_send`,
  `gmail_delete_by_search`, label create/delete and all `*_execute` tools ask.
  GoHighLevel `get_/list_/search_` tools run unattended across the `ghl-mcp`,
  `flo-ghl` and `flo-ghl-brett` aliases; every CRM write/send asks.
- **RUNTIME:** targeted policy tests plus full suite passed at commit time.

## Upgrade 2 — Claude via Max subscription through Claude Code

Commit `2cc6d4c`. Brett chose the subscription route, private use only; public
downloads must bring their own API keys. Anthropic's Claude Code policy was
re-read on 2026-09-10; the app's legacy custom OAuth client remains retired.

- **CODE:** `src/agent/claude-code-route.ts` and `src/agent/claude-code-loop.ts`.
  Each turn runs inside the owner's separately installed, unmodified Claude Code
  binary via `@anthropic-ai/claude-agent-sdk` (0.3.267, pinned). The app never
  holds Anthropic credentials: Claude Code is spawned with an allowlisted
  environment (`HOME`, `USER`, `PATH`, `TMPDIR`; no API key, which would override
  the subscription). `USER` is required for Claude Code to find its Keychain
  login when the app is launched from Finder.
- **CODE:** Claude Code's own tools, settings, CLAUDE.md files, hooks and MCP
  servers are disabled (`tools: []`, `settingSources: []`, `strictMcpConfig`).
  Only the app's tools are bridged over an in-process MCP server, so the approval
  policy above still gates every call. Sessions are not persisted to `~/.claude`.
- **CODE:** owner-only gating. `auth.method = 'claude-code'` is rejected by the
  settings IPC outside `isPersonalBuild()` (unpackaged dev, or the personal build
  whose update policy is disabled). The Settings toggle is hidden elsewhere.
  `build/afterPack.cjs` strips the SDK's bundled Claude Code binary from every
  package; the personal package was inspected and contains no
  `claude-agent-sdk-darwin-x64` directory.
- **RUNTIME:** live check through the compiled route module: Claude Sonnet
  answered via the Max login (`apiKeySource=none`), called a bridged app tool
  with the correct `toolu_` id, and returned the expected result over two turns.
- **RUNTIME:** Brett enabled the route in the installed app (Settings › LLM ›
  “Claude Code (Max subscription)” › Use), selected Fable 5.1 and received
  answers. The ChatGPT OAuth route remains connected and untouched.

## Verified closing state

- **RUNTIME:** `npm run typecheck`, `npm run lint` and `npm test` passed before
  packaging: **103 files / 1,844 tests**.
- **RUNTIME:** signed, Apple-notarized private Intel build installed through
  `scripts/install-local.cjs x64 --install --launch` (`installed-ready`).
  Rollback bundles: `/Applications/.acos-install-kzeIks/previous.app` (before
  upgrade 1) and `/Applications/.acos-install-XpT7K9/previous.app` (before
  upgrade 2). `codesign --verify --deep --strict` passed on the installed app.
- **RUNTIME:** the app was quit normally (`osascript` quit); `lsof` showed no
  open handles on the main or finance database before the checkpoint.
- **RUNTIME:** stopped-app checkpoint
  `~/Library/Application Support/acos-local-improvement-backups/checkpoint-step18-Rd1lru`,
  started `2026-09-10T14:24:11.744Z`. Main SQLite: 19 tables / 558 rows;
  restore-and-verify **25 ms**. Finance: identity and restore verified, **17 ms**.
  Persistent files: ten roots / 42 entries, copy/restore/verify **119 ms**.
  Installed-bundle copy/verify **36,310 ms**, manifest
  `d92b22afbc2996e353bba70f76ab23ae07c0de94ec4126095d09e96ebc36a256`.
  Chromium caches, cookies, transient locks and Keychain are excluded; the
  checkpoint is not cross-store atomic. No live restore was applied.

## Approval and credential state (unchanged)

Finance, SEO and Hook Lab one-use approvals remain consumed; never retry them or
treat a missing `.gg/*.consumed` marker as permission. Google authorization and
the newer `flo-docs` entry are preserved. Claude Code sign-in lives in Claude
Code's own Keychain entry, owned by Brett's Terminal login; the app does not
copy, export or refresh it. If Claude Code's session expires, Brett runs
`claude` then `/login` in Terminal; the app's error text says so.

## GitHub and Vercel

GitHub is **public**: `BrettLechtenbrerg/ai-chief-of-staff`. Only reviewed
source, tests and handoff documents go to the checkpoint branch; `.gg/`,
credentials, app data, private bundles and generated reports stay out. Commits
`51754b6` and `2cc6d4c` were pushed earlier this session; the documentation
commit and secret-scan receipt follow below.

The desktop app is not a Vercel deployment. The TSAI landing page had no changes
this session. Vercel was inspected read-only; the result is recorded below. No
deployment, public app release or website modification was performed.

## Private archival and limits

A complete private local recovery copy of the repository (including `.git`,
`.gg/`, dependencies and release files), full stopped app data, this session's
verified checkpoint, shared Flo data, brand profiles and resume routing is
recorded below. Local copies do not survive disk loss. The external encrypted
backup from the September 8 recipe was last observed `awaiting-encryption`; it
was not completed this session and must not be called complete without its own
receipts. Any new external copy must be encrypted first, with the password
entered privately in Terminal, never in chat. No Keychain export is permitted.

## Final receipts

- **RUNTIME:** commits `51754b6`, `2cc6d4c` and documentation commit `a8e3e55`
  pushed to `checkpoint/2026-09-06-session-closeout`; `git ls-remote` matched
  local HEAD `a8e3e553f3f6abef083abff8cdfcfa2d012abd47`. Public `main`, release
  tags and installers were not published. This receipt commit follows on the
  same branch.
- **RUNTIME:** Gitleaks 8.30.1 (official `ghcr.io/gitleaks/gitleaks:v8.30.1`
  image, digest `sha256:c00b6bd0…bbb7f`) scanned all 491 publishable files
  (~6.02 MB, HEAD plus the staged closeout docs) with redaction: **no leaks**.
  This is a current source scan, not a full-history scan or a security certification.
- **RUNTIME:** Vercel read-only inspection of `https://www.totalsuccessai.com`:
  project `tsai-site`, deployment `dpl_CjNkrHixroYLHJGVXscvvBUYQ8Fb`, production,
  status **Ready**, created 2026-09-04. Unchanged since the previous closeout;
  nothing was deployed.
- **RUNTIME:** complete private local copy matched its sources in **364.579 seconds**:
  `~/dev/_backups/acos-private-closeout-20260910T142724Z-rvqyfzmn/payload/`.
  Verified roots: repository 203,723 entries (including `.git`, `.gg`,
  dependencies and release files); full app data 182; this session's checkpoint
  28,508; shared Flo 6; brand profiles 199; home routing 1; Desktop resume 1.
  Symlinks preserved without following. `payload/verification.json` records
  per-root digests. Local copy verification is not external recovery.
- The installed app remained stopped through archival. On resume, use the
  validated guarded launch path; do not relaunch normally from the Dock while
  automatic services are paused.
