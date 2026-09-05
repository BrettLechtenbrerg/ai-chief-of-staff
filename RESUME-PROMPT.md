# AI Chief of Staff — Resume Prompt (current)

> Updated Sep 5, 2026. `RECOVERY.md` remains the canonical, full-history
> source of truth — read it for the build pipeline, the per-release rollback
> table, and gotchas. This file is the short, current-state bookmark.

## Where things stand (Sep 5, 2026, end of session)

- **Public release:** `v1.0.0-beta.25` (Aug 14). Landing page and Vercel
  unchanged — nothing to deploy until beta.26 is cut.
- **`main`:** pushed to GitHub, worktree clean. Code fixes end at `f8a6507`
  (model picker); session docs commit after that. Source zip + all-refs git
  bundle in `_backups/` (copy to iCloud + 8 TB drive
  `Backups/AI-Chief-of-Staff/`).
- **Brett's Intel iMac:** runs an **unsigned** local x64 build of `main`
  (`f8a6507`) via `npm run dist:install`. Still reports beta.25, so the
  updater leaves it alone. Fable 5.1 + GPT-6 Astra confirmed in the picker.
- **Brett's plan:** use it for a few days, then say "go" → cut beta.26.

### Sep 5 — model picker (`f8a6507`)

- Live model discovery now runs **on every launch** (was: only via the
  "Check for new models" click, so the cache had gone stale since Sep 1).
- Curated list adds Fable 5.1, Opus 5, Sonnet 5, GPT-6 Astra, GPT-5.6
  Sol/Terra/Luna; unknown future `claude-*` / `gpt-*` ids get sane names,
  provider routing, and 1M context defaults (`providers.ts`, `chat-engine.ts`).
- Discovered Anthropic names drop the "Claude " prefix to match curated style.
- **Gotcha:** `dist:install` builds unsigned → macOS re-prompts for the
  "Safe Storage" keychain item (enter the Mac login password, *Always Allow*).
  Use `npm run dist:signed:install` next time to avoid it. Also the DMG
  notarize hook reads `package.json` identity, so even `dist:local` spends
  ~10 min in `notarytool` (harmless, fails to staple, install proceeds).

### What changed Sep 4 (all on `main`)

1. **Approval prompts** (`d1d81c0`) — only outbound actions ask: send
   email/SMS/Telegram, calendar/docs `*_execute`, GHL/Meta create/update/
   delete, browser click/type/evaluate/upload, paid `fetch_aeo_visibility`
   batch. Reads, `propose_*`, local files/shell/subagent/memory/routines run
   unattended. Sandbox now covers `$HOME` (credential paths still blocked).
2. **Gatekeeper "damaged"** (`3a33670`) — `install:local` no longer rewrites
   signed symlinks.
3. **Pipeboard login timeout** (`99043c6`) — meta-ads `--auth-timeout` 600s.
   Also patched in the live `mcp-servers.json`.
4. **Launch UX** (`8a2872d`, `474a83f`) — one Dock click opens chat; lands on
   the most recently active session; keeps your tab on reconnects.

### Next session — the beta.26 release checklist

See `RECOVERY.md → Active workstreams → Next session` for the step-by-step
(version bump → tag → Build and Release → publish workflow → rollback table →
`TSAI-Site` landing page → Vercel). Windows stays on the beta.25 mirror until
`docs/WINDOWS-BETA-25-ACCEPTANCE.md` passes on a real PC.

### Paste-in kickoff for next time

> Resume AI Chief of Staff at `~/dev/ai-chief-of-staff`. Read
> `RESUME-PROMPT.md` then `RECOVERY.md` → "Next session". Confirm `main` is
> clean and at/after `f8a6507`. Brett has been using the local build; if he
> reports no problems, run the beta.26 release checklist. If he reports an
> issue, reproduce against the installed app first — do not rebuild until the
> cause is known.

---

## Paste this to resume

Let's resume work on **AI Chief of Staff** (ACOS) — Total Success AI's private
desktop AI agent (Electron app, MIT rebrand of KenKaiii/pocket-agent).

**Working directory:** `/Users/brettlechtenberg/dev/ai-chief-of-staff`
**GitHub:** https://github.com/BrettLechtenbrerg/ai-chief-of-staff
  (note: the `Lechtenbrerg` spelling is the REAL handle — not a typo. The
  "corrected" `BrettLechtenberg` 404s. Never auto-fix it.)
**Latest release:** v1.0.0-beta.25 (public prerelease, Aug 14 2026). `main`
  is ahead of that tag with the Sep 4 approval/launch fixes and the Sep 5
  model-picker fix (see "Where things stand" above) — installed on Brett's
  iMac, not yet released.
  Landing page serving beta.25 (`TSAI-Site@413ea1d`).
  Everything below this line is historical context from beta.21 and earlier.
**Landing page:** https://www.totalsuccessai.com/hidden/ai-chief-of-staff-app
  (Vercel auto-deploys from BrettLechtenbrerg/TSAI-Site)
**Upstream:** https://github.com/KenKaiii/pocket-agent (MIT, fork point
  `v6.4.3` / commit `a534c63`)

Before starting:
1. `cd /Users/brettlechtenberg/dev/ai-chief-of-staff`
2. Read `CLAUDE.md` and `RECOVERY.md` (canonical) for full context.
3. `git status` && `git log --oneline -10` to confirm state.
4. Confirm GitHub auth (multiple accounts configured):
   ```bash
   gh auth status
   gh auth switch --user BrettLechtenbrerg   # ADMIN on the repo; PMMARocks-1
                                             # is READ-only and will block
                                             # gh release create if active
   ```
5. Windows builds: Docker Desktop must be open before `dist:win`.
6. Native modules conflict by ABI — pick one:
   - `npm rebuild better-sqlite3` BEFORE `npm test` (system Node)
   - `npm run rebuild:native` BEFORE launching the app (Electron ABI)
   Leave it on the Electron build when you're done.

---

## Shipped in beta.21 (Jul 7, 2026) — CRITICAL Apple Silicon brick fix

**THE INCIDENT (read RECOVERY.md beta.21 row for the full story):**
beta.20's **arm64 mac assets shipped a Windows PE DLL as
`better_sqlite3.node`** (Docker `dist:win` likely overwrote shared
node_modules before the arm64 pack copied it). `dlopen` failed → main-process
init threw → the old `app.whenReady` catch swallowed it → `setupIPC()` never
ran → **ZERO IPC handlers**. Symptom fingerprint (Manny, patient zero): chat
fails `No handler registered for 'agent:send'`, Updates stuck "Current
Version: Loading…", Claude/OpenAI sign-in stuck "Checking…", misleading
"install out of date" toast — **surviving uninstall/reinstall** (same corrupt
DMG re-downloaded). Brett never saw it: he's Intel x64 (that pack was healthy).
Diagnosed via `tee`'d Terminal launch of Manny's app.

**Fixes shipped:**
- `c9e1340` — **startup hardening**: `setupIPC()`/`setupUpdaterIPC()` now run
  FIRST in `app.whenReady`, before the throwable native-SQLite opens
  (registration only binds channels; handlers read state via self-guarding
  getters). Init failures → `startupError` → new `app:getStartupError` IPC +
  preload bridge + native `dialog.showErrorBox`; `ui/shared/ipc-error-handler.js`
  now shows the REAL error (stale-install toast only when startup succeeded).
- `28cbf9a` + `0866304` — **build-pipeline guard**:
  `scripts/verify-native-modules.cjs` reads magic bytes of every `.node` in
  each packed app (Mach-O cputype vs target arch, PE, ELF; self-labeled
  multi-arch prebuilds like sharp/onnxruntime/canvas checked against their own
  path label; better-sqlite3's test-only `test_extension.node` ignored) and
  THROWS to fail the build. **GOTCHA: it must be chained INSIDE
  `build/afterPack.cjs` (final step)** — adding a second `"afterPack"` key in
  package.json silently loses (JSON dup key + sync-version rewrite dedupes).
  Verified: rejects the actual corrupt beta.20 arm64 pack (names
  better_sqlite3), accepts all healthy shipped packs.
- `43850de` — `scripts/tester-rescue.sh`: tester support script (refuses while
  app runs; chip-vs-app arch check; sqlite integrity check; timestamped DB
  set-aside — never deletes).

**Emergency mitigations used mid-incident (both since superseded):** landing
page Apple Silicon button pinned to beta.19; arm64 entries stripped from
beta.20's live `latest-mac.yml` via `gh release upload --clobber` (verified in
electron-updater 6.8.3 source: arm64 macs fall back to x64/Rosetta by design).

**Release mechanics:** mac-only rebuild. Windows was NOT rebuilt — beta.20's
healthy `latest.yml` + all 3 setup.exe/blockmaps are **mirrored under the
beta.21 tag** so Windows updaters resolve against the newest release (a no-op
update for them). Next Windows rebuild replaces those mirrors.

**Open loop:** confirm Manny (and any other Apple Silicon testers) are live on
beta.21 — his first successful chat message closes the incident.

## Shipped in beta.20 (Jul 3) — NOTE: arm64 assets were the broken ones

- Queued-message spinner fix (`3378a6b`) — indicator survives queued messages;
  session-scoped queue cleanup in `messaging.js`.
- Security hardening: credential files 0600 (`52b33a3`); navigation guards on
  all windows (`21ef090`); upstream chat server out of CSP (`acffa8d`).
- gg-pixel verified inert (documented CLAUDE.md). GHL tool count test 91→92.
- x64 mac + all Windows beta.20 assets were always healthy.

## Shipped in beta.19 (Jun 30) — all live-tested

Silence Trimmer (`trim_video_silence`), Hook Lab, Video Studio (9:16/16:9/1:1
branded MP4 renders), Campaign Ops Phase 1 (GHL campaign_* tools), and full
model selection ('Check for new models' live discovery — surfaced + ran Opus
4.8 on subscription auth, zero API keys). Details in RECOVERY.md beta.19 row.

## Live as of beta.18

- **Meta Ad Creator** (`d6dfff8`) — draft-only ad recipe; HARD RULE: never
  call Meta write tools. Dormant autopost (`metaAds.autopost`).
- **Meta Ad Analyzer** (`f2bb707`) — read-only analysis + Connect Tools card.
- **Brand ↔ publish-profile unify** (`0552c5c`) — brands map to
  `~/dev/_brand-profiles`; `brands.site_url` exists; sessions carry `brand_id`.
- **GoHighLevel Node MCP server** (beta.16, `vendor/ghl-mcp-node/`) —
  Python-free, 92 tools (91 base + `delete_contact`), verified live from the
  signed .app. Old Python `vendor/ghl-mcp/` is reference-only — prune later.
- **Content Writer** (beta.11/.12) — one-click SEO blog pipeline → `~/Desktop/Blogs/`.
- **Connect Tools marketplace + Google OAuth** (beta.12).
- **Scheduler** on `croner@10`.

---

## Build / ship reminders (learned the hard way — full detail in RECOVERY.md)

- **Native-module guard is now in the pipeline** (`build/afterPack.cjs` final
  step). If it fails a build, run `npm run rebuild:native` (or clean `npm ci`)
  and rebuild — do NOT bypass it. Never add a second `afterPack` key.
- **Versioning is tag-driven.** `scripts/sync-version.cjs` overwrites
  `package.json` from the latest git tag at build time. Commit → tag
  `v1.0.0-beta.N` → THEN build.
- **Never hot-copy files into the installed signed `.app`** — invalidates the
  signature; macOS silently denies entitlement-gated features.
- **Run `dist:signed` / `dist:win` as a detached background process**
  (~16–35 min with notarization). Foreground builds get reaped mid-notarize.
- **Before `dist:signed`:** `xcrun notarytool history --keychain-profile AC_PASSWORD`.
- **`gh release create` with huge assets times out** → create draft with small
  manifests first, `gh release upload` big artifacts in batches, then
  `gh release edit --draft=false`.
- **If Windows isn't rebuilt for a release, mirror the previous `latest.yml` +
  setup.exe/blockmaps onto the new tag** so Windows auto-update keeps resolving.
- **Verify the landing page with a browser User-Agent, not bare curl** — the
  edge proxy 404s bare curl.
- **Diagnosing a broken tester install:** `scripts/tester-rescue.sh`, or
  Terminal-launch the app with `2>&1 | tee log.txt` and read
  `[Main] FATAL ERROR`. "Reinstalled, same error" does NOT rule out the
  download itself — the same corrupt DMG reinstalls the same bug.
- **No telemetry.** gg-pixel/buzzbeamaustralia reappearing = regression.
  LICENSE keeps Ken's © line; README credits upstream.
- Never use `window.prompt` in renderer UI — inline inputs only.
- New *panel* surfaces: sidebar button + `#<name>-view` in `chat.html` +
  `ui/chat/<name>-panel.{js,css}` + binding in `event-bindings.js` + entry in
  `_dismissOtherPanels` (settings-panel.js). Session kind is only
  `'chat' | 'automation'` — not the agent tool mode.
- New *tool-only* skills: `assets/skills/<name>/` via `resolveBundledAsset()`,
  thin `src/tools/<name>.ts` in `getCustomTools`, heavy deps EXTERNAL.
- Never commit `__pycache__`/`*.pyc` (gitignored since `7126e95`).

---

## Open items / next candidates

1. **Close the beta.21 incident loop:** confirm Manny + all Apple Silicon
   testers are live on beta.21 (first chat message = healthy).
2. **Agent-performance upgrades (re-queued for beta.22, ~half a day):**
   - Prompt-cache prefix hygiene in `chat-engine.ts` (~2–3 hrs).
   - Per-tool result truncation budgets for GHL/DataForSEO payloads (~2–3 hrs).
   - Compaction threshold tuning per model (~1 hr).
3. **Campaign Ops Phase 2:** Google Ads connector + ad-spend→GHL-lead stats
   join. Needs Brett's Google Ads account/auth input before starting.
4. Tester feedback on Ad Creator + Ad Analyzer + brand publishing.
5. **Autopost activation** (only when Brett asks) — confirm step + Meta OAuth
   scope re-verify first. Prompt plumbing already done.
6. Brand → ad-account mapping for Meta recipes; brand-aware SEO report.
7. Chores (RECOVERY.md): prune `vendor/ghl-mcp/` Python tree; rotate GHL test
   tokens; `install:local` symlink seal (Goal b6168502); tray single-click
   flake; upstream the Flo `oauth.js` env-var patch; live Windows pass when
   hardware is available; next Windows rebuild replaces the beta.20 mirrors.
8. **Flagged, not yet legally checked:** promoting Claude subscription OAuth
   sign-in in a distributed commercial app may run against Anthropic's terms.

---

## WORKSTREAM — Campaign Operations (GHL + Meta + Google Ads)

Goal (Brett, June 16): a single agent surface to **set up → test → verify →
run → report** marketing campaigns without logging in/out of GHL, Meta, and
(soon) Google Ads.

Key facts:
- **Agent CAN drive via API:** GHL data & messaging (contacts, tags, custom
  fields, conversations, SMS/email, opportunities, pipelines, appointments)
  AND campaigns (legacy drips — `create_campaign`, `send_campaign_now`,
  `schedule_campaign`, `add_contact_to_campaign`, `add_contact_to_workflow`).
- **Stays manual:** GHL workflow/funnel *logic* (no create/edit API — only
  enroll/read). Build the workflow once in the UI; agent drives around it.
- **Ad stats do NOT live in GHL.** True ad→enrollment ROI needs Meta Marketing
  API + Google Ads API joined to GHL leads. Join layer is GHL-independent.
- **Build-our-own-CRM verdict: NOT now.** Phased: Phase 1 (SHIPPED beta.19,
  live-tested) → Phase 2 (Google Ads + stats join) → Phase 3 (optional
  channel-by-channel graduation, don't pre-build).
- **Companion data model:** PMMA repo (`~/dev/PMMA-Website-2026-Master`) has
  the proven GHL integration blueprint (`lib/student-create.ts`,
  `scripts/ghl-*.mjs`, daily digest cron).

**STATUS: Phase 1 LIVE-TESTED, PASSED (beta.19).** Tools in `src/tools/`
(`campaign_smoke_test`, `campaign_setup_contact`, `campaign_enroll`,
`campaign_status`, `campaign_send_message` (dry-run default),
`campaign_verify`), all self-gating on a connected GHL MCP server, routing
through `getMCPManager().callTool`. GHL tools register automatically via
`rebuildToolIndex` + `buildMCPAgentTools` — don't re-investigate.
Canonical design doc: `docs/CAMPAIGN-OPERATIONS.md`.

**NEXT = Phase 2** — Google Ads connector (mirror the Meta / Pipeboard
`mcp-remote` model) + stats-join layer. Needs Brett's Google Ads auth input.

---

## Gotchas (quick list — full versions in RECOVERY.md)

- better-sqlite3 ABI conflict (step 6 above).
- **Native-module guard failure = contaminated node_modules** — rebuild, never bypass.
- Docker Desktop must be running before `dist:win`.
- `sync-version.cjs` overwrites `package.json` from the latest git tag — tag
  BEFORE `dist:signed`.
- Never work in any Google-Drive- or iCloud-synced path. Home is `~/dev/`.
- Default mode is **General** (not Coder); default theme is **tsai**.
- `_dismissOtherPanels` (settings-panel.js) must list every panel view.
- Landing-page checks need a browser User-Agent (edge proxy 404s bare curl).
- The "install out of date" toast can mask a dead main process — as of
  beta.21 it shows the real startup error instead; on pre-.21 installs,
  Terminal-launch to diagnose.
