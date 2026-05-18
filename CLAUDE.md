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

## Project Structure (high-level)

```
ai-chief-of-staff/
├── src/
│   ├── main/              # Electron main process (tray, IPC, updater)
│   ├── agent/             # Agent loop, safety, modes, chat tools
│   ├── tools/             # Built-in tools (scheduler, macos, subagent, projects)
│   ├── mcp/               # MCP server hosts (browser, project)
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

### May 17, 2026 (night) — v1.0.0-beta.6 release
- Test-pass hardening release: 13 fixes rolled up since beta.5 (Telegram first-message FK-crash, DB path canonical fix, Tool Discipline Rules 1–7, tray UX, GHL `search_contacts`/`get_appointments`/`skip→page`, Flo calendar recurring path, Flo docs discovery, Flo bookmarks Chrome-running guard).
- Mac DMGs signed + notarized + stapled, Windows installers via Docker; all 11 artifacts published to GitHub Releases as prerelease.
- Landing page bumped + Vercel deployed; auto-updater on beta.1–beta.5 installs pulls beta.6 on next launch.

### May 15, 2026 — Project bootstrap
- Cloned from `KenKaiii/pocket-agent` v6.4.3 (commit `a534c63`), MIT.
- Stripped upstream git history; tagged unmodified snapshot as `v0.1-upstream-import`.
- Added project docs (`CLAUDE.md`, `RECOVERY.md`) in the TSAI-Site convention.
- Rebrand in progress: package metadata → DB path → updater target → user-visible strings → docs → icons → smoke test → push.
