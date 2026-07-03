# AI Chief of Staff

> **Starting a fresh session?** Use [`RECOVERY.md`](RECOVERY.md) — it's the canonical kickoff prompt with current tags, upstream pointer, and active workstreams.
>
> **Upstream's developer notes** (file/dir layout, lint rules) are preserved in [`UPSTREAM_CLAUDE.md`](UPSTREAM_CLAUDE.md).

## ⚠️ CRITICAL: Working Directory

**This project MUST live at `/Users/brettlechtenberg/dev/ai-chief-of-staff` — never on Google Drive.** Same rule as the TSAI-Site project: Drive's virtual filesystem holds `index.lock` / `HEAD.lock` and freezes git mid-session. If you ever find yourself in a Google-Drive-synced path, stop and switch to `~/dev/ai-chief-of-staff`.

## Project Overview

**AI Chief of Staff** is a private desktop AI agent distributed by Total Success AI to coaching clients. It runs in the menu bar 24/7 with persistent memory, scheduled routines, browser automation, and 40+ skill integrations.

- **Landing page**: https://www.totalsuccessai.com/hidden/ai-chief-of-staff-app
- **GitHub Repo**: `BrettLechtenbrerg/ai-chief-of-staff` (public)
- **Distribution**: Mac DMG + Windows installer hosted on landing page
- **License**: MIT (inherited from upstream)

## Upstream Source — IMPORTANT

This project is an MIT-licensed rebrand of **KenKaiii/pocket-agent**.

- **Upstream repo**: https://github.com/KenKaiii/pocket-agent
- **Upstream license**: MIT (Copyright © 2025 KenKaiii) — preserved in `LICENSE` and credited in `README.md`
- **Fork point**: tag `v6.4.3`, commit `a534c63a6b2a76ad71b55ae513cbff2c1adfc3a7`
- **Git history**: stripped on import; first commit (`v0.1-upstream-import`) is the unmodified upstream snapshot
- **Pulling upstream updates**: see `RECOVERY.md` → "Syncing upstream"

## Tech Stack

- **Framework**: Electron (menu-bar app, not window-based)
- **Language**: TypeScript (strict mode)
- **AI runtime**: Claude Agent SDK (`@anthropic-ai/sdk`) — users supply their own Anthropic API key
- **Storage**: SQLite via `better-sqlite3` (local-only, system Application Support dir)
- **Browser automation**: `puppeteer-core` (hidden Electron window OR attach to user's Chrome via remote debugging)
- **Messaging**: `grammy` (Telegram bot)
- **Scheduler**: `node-cron`
- **Updater**: `electron-updater` → points at our GitHub Releases
- **Build**: `electron-builder` (DMG for Mac, NSIS for Windows)
- **Tests**: `vitest`
- **Lint/format**: `eslint`, `prettier`

## Brand Identity

| Token | Value |
|------|-------|
| Product name | AI Chief of Staff |
| Bundle ID | `com.totalsuccessai.ai-chief-of-staff` |
| npm name | `ai-chief-of-staff` |
| DB folder | `ai-chief-of-staff` (in Application Support / AppData / .config) |
| Publisher | Total Success AI |
| Tagline | Strategic. Intelligent. Always In Support. |
| Support contact | Brett — see landing page "Need Help?" section |

Brand colors will be applied to the in-app UI in a later pass (matching navy/silver from TSAI-Site).

## Privacy Posture

The upstream README claims "no analytics, no telemetry." Upstream actually shipped with `@kenkaiiii/gg-pixel` (HTTP analytics) wired in via `gg-pixel.main.mjs`. **We removed it.** Verify it stays removed before every release:

```bash
grep -ri "gg-pixel\|buzzbeamaustralia" . --exclude-dir=node_modules --exclude-dir=.git
# expected: no matches
```

**Known-safe transitive dep (audited Jul 3, 2026):** `@kenkaiiii/gg-pixel` still exists in `node_modules` as a transitive dependency of `@kenkaiiii/ggcoder@4.3.151` (pinned). It is inert in ACOS: the only static import reachable from our code is the constant `DEFAULT_INGEST_URL` (via ggcoder's `PixelOverlay`, a TUI component ACOS never renders); its error-reporting handlers and network emission only activate via an explicit `install({ projectKey })` call, which nothing in ACOS makes; the remaining pixel code paths are dynamic imports inside ggcoder's own CLI (`cli.js` / `ui/App.js`), which ACOS never runs. If a future ggcoder bump changes this (e.g. `install(` called from its `index.js` module graph), that's a regression — re-audit before shipping.

## Project Structure (high-level)

```
ai-chief-of-staff/
├── src/
│   ├── main/              # Electron main process (tray, IPC, updater)
│   ├── agent/             # Agent loop, safety, modes, chat tools
│   ├── tools/             # Built-in tools (scheduler, macos, subagent, projects)
│   ├── mcp/               # MCP client + manager + Settings IPC for external MCP servers
│   ├── browser/           # Puppeteer-based browser automation
│   ├── channels/telegram/ # Telegram bot handlers
│   ├── scheduler/         # node-cron job runner + notifications
│   ├── config/            # Slash-commands loader/registry
│   ├── settings/          # Settings schema
│   ├── auth/              # OAuth (OpenAI auxiliary models)
│   └── utils/             # db-path, helpers
├── ui/                    # Renderer HTML/JS/CSS
├── assets/                # Icons, tray icons, sounds
├── build/                 # electron-builder hooks, entitlements, DMG bg, app icons
├── scripts/               # Build helpers
├── tests/                 # vitest unit + manual tests
├── .github/workflows/     # CI build matrix
├── package.json
├── tsconfig.json
├── README.md              # User-facing — includes MIT attribution to KenKaiii
├── CLAUDE.md              # This file
├── UPSTREAM_CLAUDE.md     # Upstream's original dev notes (preserved)
├── RECOVERY.md            # Session-resume prompt + rollback log
└── LICENSE                # MIT — DO NOT remove KenKaiii copyright line
```

## Build & Release Workflow

```bash
npm install            # Postinstall rebuilds better-sqlite3 native bindings
npm run dev            # Launches Electron with TS watch
npm run typecheck      # Strict mode
npm run lint
npm test               # vitest
npm run dist           # Mac DMG (signed if env has codesign identity)
npm run dist:local     # Mac DMG, unsigned (fast local builds)
npm run dist:win       # Windows NSIS installer
```

### Releasing a new version

1. Bump `version` in `package.json` (run `npm run sync-version` to propagate to UI).
2. Commit, tag `vX.Y.Z`, push tag.
3. GitHub Actions builds artifacts (Mac DMG + Windows installer) and uploads to a draft release.
4. Manually promote the draft to a published release on `BrettLechtenbrerg/ai-chief-of-staff`.
5. `electron-updater` clients will see the new release on next launch.

## GitHub Auth Note

Multiple GitHub accounts are configured. Before pushing:

```bash
gh auth status
gh auth switch --user BrettLechtenbrerg
```

## Key Files to Know

| File | Purpose |
|------|---------|
| `package.json` | Product name, appId, artifact names, electron-builder config, updater target |
| `src/main/index.ts` | Electron main entry — app lifecycle |
| `src/main/tray.ts` | Menu bar icon + menu |
| `src/main/updater.ts` | electron-updater wiring (points at our GitHub repo) |
| `src/utils/db-path.ts` | Per-OS SQLite location — folder name = `ai-chief-of-staff` |
| `src/agent/index.ts` | Core agent loop |
| `src/scheduler/index.ts` | node-cron job runner |
| `src/channels/telegram/` | Telegram bot |
| `src/browser/index.ts` | Puppeteer browser automation |
| `ui/chat.html` + `ui/chat/*.js` | Main chat window |
| `ui/shared/variables.css` | UI theme tokens |
| `build/entitlements.mac.plist` | macOS entitlements (notarization) |
| `build/icon.icns` / `build/icon.ico` | App icons |
| `README.md` | User-facing docs + upstream attribution |

## Development Conventions

- **TypeScript strict mode** — no `any` unless justified inline.
- **No dead code, no commented-out code, no placeholder stubs.**
- **Don't refactor unprompted.** Match neighboring patterns.
- **No telemetry.** If a future dependency adds analytics, it must be opt-in and documented in README.
- **User data is local-only.** Conversations go to Anthropic's API (that's how Claude works). Nothing else leaves the machine.
- **API keys** live in the OS keychain via Electron `safeStorage`. Never log, never store in JSON.

## Work History

### Jul 3, 2026 — Queued-message spinner bug (partner report) + queue tracking made session-scoped
- Brett's partner reported the chat sometimes stops showing the "thinking" indicator while the agent is still working, and supplied a proposed patch in `COS Bug.docx`. Verified the diagnosis against the backend before applying: `chat-engine.ts` emits `done` after EVERY message (then `processQueue()` starts the next queued one), but the renderer's `done` handler tore the status indicator down unconditionally — so all subsequent `queue_processing`/`thinking`/`tool_start` events for queued messages hit `if (!statusEl) return;` and were silently dropped. Result: agent working with no spinner, no stop button, tab showing idle.
- Fixes in `ui/chat/message-renderer.js`: (1) `done` cleanup now skips teardown while the session still has queued messages; (2) if a non-`done` status arrives with no indicator on screen (out-of-order events, external triggers), the indicator is recreated instead of dropping the event — safe because the currentSession guard runs first and the per-session listener is removed on final cleanup.
- Fixes in `ui/chat/messaging.js`: both send-cleanup paths checked the GLOBAL `queuedMessageElements.size` — a queued message in another tab blocked this session's cleanup (stuck-spinner variant). Now checks `queuedMessageIdsBySession` for the specific session. Same class of bug in `stopQuery()`: it called `queuedMessageElements.clear()` globally, orphaning other sessions' queued tracking — now clears only the stopped session's ids.
- Also fixed a stale test found during full-suite run: `ghl-node-server.test.ts` still asserted 91 tools, but beta.19's `d8e02e4` added `delete_contact` (→ 92). Suite now 1248/1248 passing, typecheck + lint clean.
- Telemetry audit: traced why `gg-pixel` appears in `package-lock.json` — transitive dep of pinned ggcoder, verified inert (see Privacy Posture note above).

### May 18, 2026 (afternoon) — Connections settings UI + onboarding connectors mockup (beta.9)
- Closed the "zero UI for connected tools" gap. New **Settings → Connections** section (nav item between Browser and Chat) lists every entry in `<userData>/mcp-servers.json` with live status from `MCPServerManager`, tool counts, and last-error tooltips. Add / edit / delete / toggle / Test-Connection / Open-config-file actions all work end-to-end.
- Backend: `src/mcp/config.ts` gained `saveMCPConfig()` (write-tmp → fsync → rename atomic writer, validates shape, preserves unknown top-level + per-server fields so future ACOS keys aren't wiped by an older Settings UI). `src/mcp/manager.ts` gained `addClient` / `stopClient` / `replaceClient` with a drain check (`MCPClient.inFlightCount` waits up to ~1.5s for in-flight tool calls before stopping). New IPC layer `src/main/ipc/connections-ipc.ts` (six handlers) wired through `src/main/preload.ts` as `window.pocketAgent.connections.*`.
- Renderer: `ui/chat/connections-panel.js` (card-row list, 5s status poll, inline editor, delete-confirm spells out the server name) + `ui/chat/connections-panel.css` (card layout reusing `.status` / `.keys-table` tokens).
- Onboarding visual-only mockup: new "Connect your tools" step between funfacts and CLI install. Two `.connector-card` rows (Gmail+Calendar with Google G, GoHighLevel with envelope icon). Buttons surface a Notyf toast and advance — no OAuth code yet, blocked on Manny's Google business-case reply. Step auto-skips on subsequent launches via `onboarding.connectorsSeen=true`.
- 27 new unit tests across `tests/unit/mcp-config-save.test.ts` (8: round-trip, atomic write, malformed-input rejection, forward-compat, autocreate-dir) and `tests/unit/connections-ipc.test.ts` (19: list-merge, add-dedup, update/rename/collision, delete-stops-client, toggle-flips, testConnection ok/throw/validate/timeout, openConfigFile). Suite 1086 → 1113 passing.
- Released as **v1.0.0-beta.9** (commits `5b3a8a5` Settings UI + `7912a2f` onboarding mockup). Mac signed + notarized, Windows via Docker, landing page bumped + Vercel `--prod` deployed.

### May 17, 2026 (late night, after beta.7) — new-user docs + Gmail/Calendar connector decisions to Manny
- Converted Brett's personal testing manual into a general new-user training doc: `~/Desktop/AI-Chief-of-Staff-Welcome-Guide.txt` (15 sections, copy-paste prompts, each section labels OUT OF THE BOX vs NEEDS-CONNECTOR).
- Built a side-by-side capabilities comparison doc: `~/Desktop/AI-Chief-of-Staff-Capabilities-Comparison.txt` (checkbox table per section, Quick Summary scores **8 of 15 capabilities work out of the box, 7 unlock with connectors**).
- Surfaced the discovery gap: there is **zero UI** anywhere in the app for MCP servers/connected tools. Users have no way to see what's connected. Roadmap fix ("Phase 3 — MCP Servers Settings UI") was in Active workstreams but not yet planned in detail. **Shipped May 18 (beta.9)** — see Connections row in `RECOVERY.md`.
- Brett identified next priority: one-click Gmail + Calendar connection (the #1 tester request). Rather than jumping to a plan, surfaced **4 design decisions** that materially change scope (which MCP server to ship, whose Google OAuth client, where tokens live, scope of first release). Drafted email to Manny at `~/Desktop/email-to-manny-gmail-calendar-connector-decisions.txt` walking through all 4 + Brett's recommendations + 7-day timeline + Google verification critical path.
- **Next session blocked on Manny's reply.** See "Next session — pick up here" at the top of Active workstreams in `RECOVERY.md` for full context.

### May 17, 2026 (late night) — v1.0.0-beta.7 release (tester regressions pass)
- Fixed all 5 tester reports against beta.6: TSAI colors not loading (skin fallback + DB migration), "no handler registered" on Create Task + Sign In (new `window.safeIpc` helper showing a reinstall toast at 8 critical call sites), Skins picker blank tile (missing `tsai` entries in `_STG_SKIN_DESCRIPTIONS` / `_STG_SKIN_PREVIEWS`), Browser Magic breaking when CDP isn't set up (Electron-tier fallback + yellow CDP-not-active hint + clearer "Chrome already running" message).
- Behaviour change: flipped `autoUpdater.autoDownload` from false to true so future bug-fix builds install silently on next quit — the main reason beta.5/.6 fixes never reached the field. **Critical caveat**: current beta.5/.6 installs do NOT auto-pull beta.7 (their `autoDownload` is still false); testers need one manual reinstall.
- Mac DMGs signed + notarized + stapled (spctl: Notarized Developer ID), Windows installers via Docker; all 11 artifacts published to GitHub Releases as prerelease.
- Landing page bumped + Vercel `--prod` deployed (`TSAI-Site@f2497a1`).
- Typecheck + lint clean. Tests: 854 passing, 218 carrying over from beta.6 (no new regressions from this release's changes).
- 7 logical commits using `git add -p` to split the multi-concern `settings-panel.js` diff cleanly.
- Corrected RECOVERY.md's wrong "auto-updater silently pulls" claims in beta.5/.6 rows of the rollback table — those releases all had `autoDownload=false`.

### May 17, 2026 (night) — v1.0.0-beta.6 release
- Test-pass hardening release: 13 fixes rolled up since beta.5 (Telegram first-message FK-crash, DB path canonical fix, Tool Discipline Rules 1–7, tray UX, GHL `search_contacts`/`get_appointments`/`skip→page`, Flo calendar recurring path, Flo docs discovery, Flo bookmarks Chrome-running guard).
- Mac DMGs signed + notarized + stapled, Windows installers via Docker; all 11 artifacts published to GitHub Releases as prerelease.
- Landing page bumped + Vercel deployed. Note: `autoUpdater.autoDownload` was still false at this release, so beta.1–beta.5 installs saw the update in Settings but did NOT auto-pull — corrected in beta.7.

### May 15, 2026 — Project bootstrap
- Cloned from `KenKaiii/pocket-agent` v6.4.3 (commit `a534c63`), MIT.
- Stripped upstream git history; tagged unmodified snapshot as `v0.1-upstream-import`.
- Added project docs (`CLAUDE.md`, `RECOVERY.md`) in the TSAI-Site convention.
- Rebrand in progress: package metadata → DB path → updater target → user-visible strings → docs → icons → smoke test → push.
