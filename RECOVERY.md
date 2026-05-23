# AI Chief of Staff — Recovery & Resume

This is the canonical session-kickoff document. If you're a fresh Claude session, start here.

---

## Standard kickoff prompt

> Let's resume work on **AI Chief of Staff** — Total Success AI's private desktop AI agent for clients.
>
> **Working directory**: `/Users/brettlechtenberg/dev/ai-chief-of-staff`
> **GitHub**: https://github.com/BrettLechtenbrerg/ai-chief-of-staff
> **Latest release**: https://github.com/BrettLechtenbrerg/ai-chief-of-staff/releases/tag/v1.0.0-beta.11 (public, prerelease)
> **Landing page**: https://www.totalsuccessai.com/hidden/ai-chief-of-staff-app (Vercel auto-deploys from BrettLechtenbrerg/TSAI-Site)
> **Upstream**: https://github.com/KenKaiii/pocket-agent (MIT, fork point `v6.4.3` / commit `a534c63`)
>
> Before starting, please:
> 1. `cd /Users/brettlechtenberg/dev/ai-chief-of-staff`
> 2. Read `CLAUDE.md` and `RECOVERY.md` (this file) for full context.
> 3. `git status` and `git log --oneline -10` to see latest state.
> 4. Confirm GitHub auth (multiple accounts are configured):
>    ```bash
>    gh auth status
>    gh auth switch --user BrettLechtenbrerg   # if not already active
>    ```
> 5. For Windows builds: Docker Desktop must be open before running `dist:win`.
>
> **Important rules:**
> - NEVER work in any Google-Drive-synced path. Project home is `~/dev/ai-chief-of-staff`.
> - This is an MIT rebrand of `KenKaiii/pocket-agent`. The `LICENSE` file MUST keep Ken's copyright line. `README.md` MUST credit the upstream.
> - No telemetry. Upstream shipped with `@kenkaiiii/gg-pixel` analytics; we removed it. If `gg-pixel` or `buzzbeamaustralia` re-appears anywhere, that's a regression — flag it.
> - Tech stack: Electron + Claude Agent SDK + TypeScript + SQLite + Puppeteer. Builds via `electron-builder` (Mac DMG + Windows NSIS).
> - Brand identity: bundle ID `com.totalsuccessai.ai-chief-of-staff`, npm name `ai-chief-of-staff`, DB folder `AI Chief of Staff` (productName) on macOS, `ai-chief-of-staff` (slug) on Linux/Windows.
> - Default mode is **General** (personal assistant), NOT Coder. Default theme is **tsai** (navy/silver).
> - Hidden upstream UI elements (intentional, all use `.acos-hidden` class for easy restore): Global Chat, "Who made me?" button + modal, Docs button.

---

## Rollback tags

| Tag | Date | Description |
|-----|------|-------------|
| `v1.0.0-beta.11` | May 22, 2026 (early morning) | **Eleventh beta release — Content Writer (one-click SEO blog pipeline).** New sidebar button between *Click Here To Schedule Tasks* and *The Brain*. Opens a 3-card setup panel (OpenAI key, DataForSEO login, brand book). When all three are ✓ the **▶ Write My First Blog Post** button unlocks and fires a new "Content Writer" chat session pre-loaded with a 9-step recipe prompt: brand-book read → DataForSEO keyword research (vol ≥ 50/mo, KD ≤ 30) → SERP angle via `web_fetch` on top-3 results → live fact-check → folder creation under `~/Desktop/Blogs/YYYY-MM-DD-slug/` → hero image generation (`generate_blog_image`, photo-realistic 1536×1024) → 800–1200 word draft following brand voice → inline review in chat with embedded image → iterate-until-approved → write final `blog-post.md` to disk on "publish" / "looks good". **Hard rules in the recipe prompt**: no external publishing (no GHL, no WordPress, no GitHub) — output goes to `~/Desktop/Blogs/` only; never skip the brand book; stop with a clear message if DataForSEO is unreachable; stop with "Add your brand book in Content Writer first" if `personalize.brandStyle` or `personalize.writingRules` is empty. **Wiring across 10 files** (commit `d2d9747`): `src/tools/image-gen.ts` — `ALLOWED_DIRS` learns `~/Desktop/Blogs/` so the validator at `validateOutputPath()` accepts per-article subfolders the agent creates on the fly. `src/settings/validators.ts` — new `validateDataForSEOKey(login, password)` using HTTP Basic against `https://api.dataforseo.com/v3/appendix/user_data` (a free GET that returns balance + limits); parses `status_code === 20000` + `tasks[0].result[0].money.balance` for UI display. Handles 401 with a tester-friendly "make sure you’re using your API password (not your dashboard login password)" hint — same trap from the May 17 RECOVERY note. `src/settings/index.ts` — `SettingsManager.validateDataForSEOKey()` delegate. `src/main/ipc/settings-ipc.ts` — `settings:validateDataForSEO` IPC handler. `src/main/preload.ts` — `validate.dataForSEOKey(login, password)` + TS declaration. `ui/chat.html` — sidebar button (document-with-sparkles icon) + `#content-writer-view` panel skeleton with 3 cards + Start footer. `ui/chat/content-writer-panel.css` (327 lines) + `ui/chat/content-writer-panel.js` (518 lines) — panel state machine (`_cwState.openai/dataforseo/brandbook` each `'ok'|'missing'|'invalid'`), `_cwLoadState()` polls `openai.apiKey` + `personalize.brandStyle` + `personalize.writingRules` + `connections.list()` to find the `dataforseo` MCP entry, `_cwRender()` paints badges + auto-expands cards in ⚠ state + collapses cards in ✓ state, save handlers for each card (OpenAI: `validate.openAIKey` then `settings.set('openai.apiKey')`; DataForSEO: `validate.dataForSEOKey` then list-first `connections.update`-if-exists / `connections.add`-if-new with `{ command: 'npx', args: ['-y', 'dataforseo-mcp-server'], env: { DATAFORSEO_USERNAME, DATAFORSEO_PASSWORD } }`; Brand book: dual-textarea save to `personalize.brandStyle` + `personalize.writingRules`), `startContentWriter()` defensive re-validates all 3 are still ✓, finds-or-creates the `Content Writer` session, awaits `switchSession()` so kickoff lands on the right tab, drops `_CW_KICKOFF_PROMPT` (the recipe) into `#message-input`, calls `sendMessage()`. `ui/chat/event-bindings.js` — `bindClick('sidebar-content-writer-btn', toggleContentWriterPanel)`. `ui/chat/settings-panel.js` — `_dismissOtherPanels` learns `'content-writer-view': 'sidebar-content-writer-btn'` so opening any other panel cleanly dismisses the Content Writer view. `ui/chat.html` <link> + <script> tags load the new CSS+JS alongside the routines/personalize panels. **Risk mitigation built in**: (1) The Save & Test for DataForSEO bypasses the MCP cold-start path entirely — it does the direct HTTPS balance check, which is <1s vs. the 20–60s first-time `npx -y dataforseo-mcp-server` download. Testers see fast feedback. The MCP server only spins up later when the agent actually calls it during a run. (2) Connection persistence is list-first then update-vs-add, so re-saving on a machine that already has a `dataforseo` connection (e.g. Brett's own) doesn't fail with "already exists." (3) `startContentWriter()` awaits `switchSession()` so the session-load + DOM mutations settle before the kickoff prompt fires; without the await the message would race the session swap and land in the wrong tab. (4) `personalize.brandStyle` + `personalize.writingRules` map to the exact same DB keys the Personalize → Knowledge Base panel writes, so the brand book is consistent across both surfaces. (5) The recipe prompt has a defensive "if the brand book is empty, tell me 'Add your brand book in Content Writer first' and stop" backstop in case the panel state is stale and the user clicked Start anyway. **Suite 1146 → 1155 passing.** Typecheck + lint clean. **Release pipeline**: Mac DMGs signed + notarized + stapled (arm64 + x64 both submitted to Apple's notary service, both Accepted, both stapled). `latest-mac.yml` auto-patched by `scripts/patch-latest-mac-yml.cjs` post-electron-builder (the permanent fix from beta.10) — verified 2 sha512 entries match disk bytes. Windows installers built via Docker `electronuserland/builder:wine` (~6 min). All 18 GH Release assets uploaded in a single `gh release create` call (no mid-upload timeout this time). Landing page bumped (`TSAI-Site@382318a`), `vercel --prod` deployed live. Existing beta.7+ installs auto-pull this on next quit (`autoDownload=true` shipped in beta.7). **What's NOT in this release** (deferred): no GBP / Facebook / LinkedIn auto-posting — manual paste from `~/Desktop/Blogs/`. No multi-brand support — one install = one brand book. No "schedule this as a recurring blog" path from the Content Writer panel (the existing Routines panel handles cron-style recurrence separately if needed). Onboarding wizard unchanged — discovery is via the new sidebar button. The Connections panel in Settings stays as the power-user surface; Content Writer is the friendly path that writes into the same `mcp-servers.json`. |
| `v1.0.0-beta.10` | May 19, 2026 (early morning) | **Tenth beta — silent-cron fix + visual verification.** Critical correctness fix shipped alongside the multi-brand blog port. **Root cause:** `node-cron@4.2.1` has a day-of-week parsing bug where every weekday EXCEPT Mon (DOW=1) and Wed (DOW=3) computes its next-run as Jan 1 of a year several years out (Sun → 2034, Tue → 2030, Thu → 2032, Fri → 2027, Sat → 2028). Tasks on those weekdays — including the **PMMA weekly content cron at `0 6 * * 2`** — silently never fire. Discovered when Brett's Tuesday 6 AM PMMA run produced nothing today (May 19). Regression tests in `tests/unit/cron-library-sanity.test.ts` (9 tests against the real croner) confirm the new library parses all 7 DOW values to dates within the next 7 days. **The fix:** swapped node-cron for croner@10 in `src/scheduler/index.ts`. Same one-line API, but DST-aware and bug-free. Replaced `cron.schedule` → `new Cron(expr, fn)`, replaced `cron.validate` → `validateCronExpression()` helper (croner throws on invalid construction; no separate validate fn). Wrapped the croner instance in a `ScheduledTaskHandle` interface that exposes only `stop()` + `nextRun()` so we never leak croner internals into the surrounding scheduler logic. **Visual verification (3 things):** (1) `next_run_at` is now persisted to the DB on every `scheduleJob()` call (was: only after first successful execution — which never happened for the broken jobs, so the column was permanently NULL). (2) `last_run_at` / `last_status` / `last_error` / `last_duration_ms` are now persisted on every `executeJob()` completion via new `persistLastRun()` (the cron-callback path didn't write these before; only the `checkDueJobs()` path did — inconsistent). (3) New health-line under each job card in Settings → Scheduled Tasks: `Next: Today 6:00 AM · Last: 2h 14m ago • ✓ ok (3.4s)`. New helpers `_rtnRelativeWhen()` + `_rtnHealthLine()` in `ui/chat/routines-panel.js`. CSS in `ui/chat/routines-panel.css` with `.rtn-job-status-ok` green / `.rtn-job-status-error` red + title= tooltip with full error message. **Telegram heartbeats:** every job send-starts "🟢 PMMA weekly content starting…" before running and "✅ PMMA weekly content done in 3.4s • next: Tue May 26 6:00 AM" / "❌ PMMA weekly content failed: <error>" after. Silent no-op if the job's session has no linked Telegram chat. Heartbeat send failures NEVER break the job itself. **Loud warning on suspicious registration:** if `nextRun()` for a registered cron is > 8 days out, log `[Scheduler] ⚠️  <name> next-run is X.X days out (<ISO>). Schedule "<expr>" — verify this is intentional.` Catches cron-library bugs like this one BEFORE another silent week passes. **Verified live on Brett's Mac**: post-install, all 3 brand crons now show correct `next_run_at` in the DB (TSAI Mon May 25, PMMA Tue May 26, Brett Wed May 20). The DOW bug is dead. **Tests:** scheduler unit tests updated for the new mock (must use `function` not arrow because `new Cron(...)` rejects arrow constructors). Cron-library-sanity tests use the real croner (no mocks) so a future library swap that re-introduces the bug fails CI before reaching users. Suite 1113 → 1146 passing. **Mac install:** unsigned `dist:install` build to ship the fix locally fast — published-to-GitHub Releases signed/notarized cycle deferred to a follow-up session (PMMA cron next fires Tue May 26 6 AM, plenty of time). **NOT shipped May 19:** signed Mac DMGs, Windows installers, GitHub Releases artifacts, landing-page bump — ALL of these landed May 21 (see May 21 "Next session" entry above). Brett's local Mac was on beta.10 since May 19 via unsigned `dist:install`; the May 21 signed build replaces it. Testers on beta.7+ auto-pull beta.10 silently on next quit. **Same-day follow-ups landed AFTER the initial beta.10 build** (still on unsigned local install, will all be bundled into the eventual signed release): (a) **Per-cron named sessions + auto-switch on Run-now.** Each of the 3 brand crons now has its own session (`Weekly Content — TSAI / PMMA / Brett` at `session-1779195322250-cront/cronp/cronb`) instead of sharing the default "New" session. When Brett clicks Run-now, the chat UI auto-switches to that cron's session tab so he can see the routine narrate live. One-liner renderer fix: `handleCronTestingStart()` in `ui/chat/external-messages.js` now calls `switchSession(data.sessionId)` before clearing empty state. Solved the repeated "why don't I see anything happening?" complaint. (b) **Brett brand voice rewritten in `brand-profiles`** (commits `6afccf4`, `b1dfb95`, `b77b266`) — the first Master's Edge-aligned cron run wrote 'How to Become More Confident' which read as a PMMA dojo story. WRITING_RULES.md rewritten around Brett's actual positioning (8th-degree black belt + Flow Research Collective + Master's Edge methodology + executive audience + speaker-first business goal). Topic queue rebuilt with 21 Master's Edge-aligned topics across 5 new pillars. Image rules sharpened to push editorial-magazine-cover energy over safe-mentor-shot defaults. The off-brand article was deleted (BL-2026-Personal-Site PR #3) and replaced with 'Flow State Triggers for Executives: A Reproducible Protocol' (PR #4, live at brettlechtenberg.com/blog/flow-state-triggers-executives). (c) **Cron-stop bug surfaced (NOT yet fixed).** Brett's third cron run today wrote all files + Telegram heartbeat fired + `last_status=ok`, but the agent never executed Step 11 (`git checkout -b blog/... && commit && push && gh pr create`). Files survived to disk as untracked on the wrong local branch. Had to finish manually. Two hypotheses: (1) agent exhausted `maxTurns` budget before reaching Step 11; (2) agent silently aborted after a `write_daily_posting_packet` schema-mismatch retry instead of continuing. Triage: contained, manual recovery is ~60 sec, real fix next session — check prompt token cost vs. configured maxTurns, OR add "continue from where you left off" instruction at the top of the cron prompt. |
| `v1.0.0-beta.9` | May 18, 2026 (afternoon) | **Ninth beta release — Connections settings UI + onboarding connectors mockup ship.** Two complementary deliverables that close the documented "zero UI for connected tools" gap and de-risk the upcoming Google/GHL OAuth work BEFORE it lands. (1) **Phase 3 — MCP Servers Settings UI.** New `Connections` nav item in Settings between Browser and Chat. Lists every entry in `<userData>/mcp-servers.json` with live status (Ready / Failed / Disabled / Starting…), tool count, and last-error tooltip. Add/edit/delete/toggle/test-connection actions, all atomic against the file: new `saveMCPConfig()` in `src/mcp/config.ts` does write-tmp → fsync → rename, validates the shape, and PRESERVES UNKNOWN FIELDS (both top-level and per-server) so a future ACOS that adds a key isn't silently wiped on save. New IPC layer `src/main/ipc/connections-ipc.ts` (six handlers: `list / add / update / delete / toggle / testConnection / openConfigFile`) wired through `src/main/preload.ts` as `window.pocketAgent.connections.*`. MCPServerManager gained `addClient(name, cfg)` / `stopClient(name)` / `replaceClient(name, cfg)` with a drain check (`MCPClient.inFlightCount` getter — waits up to ~1.5s for in-flight tool calls to settle before stopping). Renderer side: `ui/chat/connections-panel.js` (~390 lines, polls statuses every 5s while the panel is open, stops on exit) + `ui/chat/connections-panel.css` (card-row list + inline editor matching `.keys-table` / `.status` tokens). Delete is gated by a confirm dialog spelling out the server name (Risk #8 mitigation) so a tester clicking a wrong trash button doesn't wipe their working flo-calendar config. testConnection has a hard 10s timeout so a misconfigured server doesn't hang the UI. (2) **Onboarding connectors mockup.** Visual-only "Connect your tools" step inserted between `ob-step-funfacts` and `ob-step-cli` (flow goes 14 → 15 steps). Two `.connector-card` rows: Gmail+Calendar (Google G logo, "Connect with Google" CTA) and GoHighLevel (envelope-stack icon, "Connect with API key" CTA — matches reality, GHL has no coach-friendly OAuth path). Buttons are intentionally non-functional — they show a Notyf toast (`Coming soon — we'll save your interest.`) and advance to the CLI step. No Google client_id, no token storage, no `mcp-servers.json` mutation — all blocked on Manny's reply re: business case for Google API access. Step persistence (Risk #7): `obSaveConnectorsChoice()` writes `onboarding.connectorsSeen=true` so the step is auto-skipped on subsequent launches. CSS responsive (`@media (max-width: 720px)` stacks the CTA below the body so narrow widths don't squish). **Why both together.** Same surface (`mcp-servers.json`), same IPC mental model, one set of CSS patterns. Mockup is the cheap pressure-test of the visual framing BEFORE writing OAuth code; Settings UI is the foundation that the real connectors will write into once Google/GHL approvals land (the onboarding step's mockup buttons become real-flow buttons that ultimately invoke `connections.add()`). **Test coverage**: 27 new unit tests across `tests/unit/mcp-config-save.test.ts` (8: round-trip, atomic write, malformed-input rejection, forward-compat top-level + per-server, delete-drops-unknown-fields, overwrite-known-fields, autocreate-dir) and `tests/unit/connections-ipc.test.ts` (19: list-merge, add-dedup, malformed-rejection, update-replace, update-rename, update-collision, delete-stops-client, toggle-flips, testConnection ok/throw/validate/timeout, openConfigFile). Total suite 1086 → 1113 passing. Typecheck + lint clean. **Release pipeline**: Mac DMGs signed + notarized + stapled under Apple Developer ID `2HQTY95NHD` (spctl: `Notarized Developer ID` on the inner .app). Windows installers built via local wine (electron-builder). All 11 artifacts uploaded to GitHub Releases as prerelease: 2 DMG, 2 mac.zip, 3 .exe (universal + arm64 + x64), 2 win.zip, `latest-mac.yml`, `latest.yml`. Landing page bumped (`TSAI-Site@82002e8`), Vercel `--prod` deployed, live at https://www.totalsuccessai.com/hidden/ai-chief-of-staff-app showing v1.0.0-beta.9 on every download button. Local `/Applications/AI Chief of Staff.app` replaced via `npm run install:local` (x64 build for this Intel Mac) and relaunched cleanly. **YAML footgun reproduced**: same as beta.8 — the `afterAllArtifactBuild` hook ran but its values stayed pre-staple, so the published `latest-mac.yml` had stale DMG sha512+size that wouldn't match the actual bytes auto-updater downloads. Manual re-patch with `/tmp/patch-yml.cjs` (12 lines, same crypto+js-yaml logic as the hook) ran AFTER electron-builder fully exited and produced correct values, which were then verified (`shasum -a 512 | xxd -r -p | base64` matches each entry) before upload. The bug is confirmed: electron-builder re-emits `latest-mac.yml` AFTER `afterAllArtifactBuild` returns. **Next release should permanently fix this** by moving the patcher out of the hook and into a post-build npm script (`"dist:signed": "... && node scripts/patch-latest-mac-yml.cjs"`). **Smoke-test status**: Brett walking the 5 manual tests now — fresh onboarding shows connector cards, Settings → Connections lists his 8 MCP servers (flo-gmail / flo-calendar / flo-docs / flo-bookmarks / ghl-mcp / dataforseo / firecrawl / browser-mcp), add+delete a fake server, toggle flo-calendar off+on, edit a server name. Will update this row if any test surfaces a bug. **NOT shipped this round**: actual Google OAuth code, bundled MCP servers, GHL OAuth path. Existing beta.7+ installs will pull this silently on next quit (`autoDownload=true` shipped in beta.7). |
| `v1.0.0-beta.8` | May 18, 2026 (morning) | **Eighth beta release — voice input + housekeeping ship.** Three things land for testers: (1) **Voice input in the chat composer.** New mic button in the input-toolbar (4th, between attach and search), MediaRecorder state machine in `ui/chat/voice-input.js`, IPC bridge in `src/main/ipc/audio-ipc.ts` calling the existing `transcribeAudio()` Whisper wrapper. Visual states: idle (mic glyph) / recording (red stop-square + pulsing dot) / transcribing (spinner). Button is hidden unless `audio:isAvailable` returns true (= OpenAI key configured). Smart-joins transcribed text onto whatever's in `#message-input`. New macOS entitlement (`com.apple.security.device.audio-input`) and Info.plist `NSMicrophoneUsageDescription` string — both verified present on the installed bundle via `codesign -d --entitlements -` and `plutil`. (2) **Test suite 218 → 0 failing.** Every previously-failing test traced to ONE cause: `better-sqlite3` binary built for Electron's Node ABI vs. vitest's system Node. New `pretest` hook auto-heals the binary; the existing `preelectron` hook heals it back. Plus 13 stale assertions fixed (db-path, agent-modes, telegram). Suite: 1086 passing. (3) **`latest-mac.yml` patcher** rewritten as `js-yaml` round-trip — hand-patched 3 releases in a row; this one needed only ONE manual re-patch (see Footgun caveat below). Mac DMGs signed + notarized + stapled under Apple Developer ID `2HQTY95NHD`; spctl: `Notarized Developer ID`. Windows installers built via Docker. All 11 artifacts on GitHub Releases as prerelease. Landing page bumped (`TSAI-Site@a0d49ce`), Vercel `--prod` deployed. Local `/Applications/AI Chief of Staff.app` running beta.8. **First release that exercises `autoDownload=true` from beta.7** — existing beta.7 installs should pull this silently on next quit. **Footgun caveat**: the YAML patcher in `build/afterAllArtifactBuild.cjs` ran during the build but the values it wrote were STALE — the YAML on disk had pre-staple sha512+size despite the hook running last in the documented order. Manual repatch with the same logic (just `node` against the post-build `release/`) produced correct values, which were then uploaded to the GH Release. Suspect: electron-builder may re-emit `latest-mac.yml` AFTER `afterAllArtifactBuild` returns, clobbering our changes, OR the hook somehow received pre-staple `artifactPaths` even though stapling completed before our patcher block. Either way, the parser code is right and the FIX is to run the same patcher AFTER electron-builder fully exits — either as a separate npm script (`dist:signed && node scripts/patch-latest-mac-yml.cjs`) or by switching to an `afterAllArtifactBuild` that returns ONLY after a final "verify YAML matches files" loop. The end-to-end values in the published release are correct (manual re-patch happened before upload), but next release should fix the hook properly. |
| `v1.0.0-beta.7` | May 17, 2026 (late night) | **Seventh beta release — tester-regressions pass.** Fixes all 5 regressions reported against beta.6: (1) **TSAI colors** — `settings:getSkin` fallback flipped from the non-existent `'default'` to `'tsai'`, plus a one-time DB migration in `src/settings/index.ts` that promotes any empty/unknown `ui.skin` value to `'tsai'` on startup (explicit user choices like dracula/nord are preserved). (2 & 3) **"No handler registered"** on Create Task / Sign In — these were stale-install symptoms (testers had a newer renderer over an older main process), not bugs in beta.6 code. New `ui/shared/ipc-error-handler.js` exposes `window.safeIpc(name, fn)` which catches the specific Electron rejection and shows a Notyf toast telling the user to re-download from totalsuccessai.com/hidden/ai-chief-of-staff-app. Wired into the 8 critical call sites: `cron.create/update/delete`, `auth.startOAuth/completeOAuth`, `openaiAuth.startOAuth`, `browser.launch/detectInstalled`. (4) **Skins picker blank tile** — added `tsai` entries to `_STG_SKIN_DESCRIPTIONS` ('Navy + silver brand theme') and `_STG_SKIN_PREVIEWS` (`['#0A1F44', '#0F2A5C', '#C0C0C0', '#E8E8E8', '#FFFFFF']`), plus a `default` safety-net entry so future unknown skin IDs render the brand swatches instead of blank. (5) **Browser Magic** — three changes that stop "didn't work" reports from testers who toggled Use My Browser on without launching Chrome with `--remote-debugging-port=9222` first: `selectTier()` now falls back to Electron when `useMyBrowser=true` but CDP has never connected (was: force-CDP-and-fail); Settings → Browser status shows a yellow "CDP not active" hint instead of red "Not connected" when the toggle is on and the test fails on load; "Chrome already running" toast now spells out Cmd+Q on macOS or "close every Chrome window" on Windows/Linux. **Behavior change**: `autoUpdater.autoDownload = true` (was false) in `src/main/updater.ts`. From beta.7 onward, electron-updater pulls bug-fix builds in the background after the 10-second startup check and applies them silently on next quit via the existing `autoInstallOnAppQuit = true`. **Current beta.5/.6 installs DO NOT auto-pull beta.7** — `autoDownload=false` shipped in those versions, so testers need one manual reinstall to pick up beta.7; from beta.7 onward updates apply themselves. Mac DMGs signed + notarized + stapled under Apple Developer ID `2HQTY95NHD`; spctl assess returned `accepted, source=Notarized Developer ID`. Windows installers built via Docker (`electronuserland/builder:wine`). All 11 artifacts uploaded to GitHub Releases as prerelease. Landing page bumped (`TSAI-Site@f2497a1`), Vercel `--prod` deployed. Typecheck + lint clean. Unit tests: 854 passing, no new regressions from this release's changes (the 218 pre-existing failures were inherited from beta.6 — untouched and tracked separately). Carry-over from beta.6: `latest-mac.yml` regex in `afterAllArtifactBuild.cjs` is still flaky — hand-patched post-staple sha512+size for both DMGs again. Needs a real fix. |
| `v1.0.0-beta.6` | May 17, 2026 (night) | **Sixth beta release — test-pass hardening.** Rolls up the 13 fixes accumulated against beta.5 across the day's six sessions: Telegram first-message FK-crash fixed (sessions now auto-create as `Telegram (chat <id>)`); DB path canonical lowercase-slug fix (unblocks `create_routine` / `create_reminder` / project tools on packaged installs); Tool Discipline Rules 1–7 added/tightened (no curl bypass, no credential-file reads, no unverified bug-claim persistence even tentative, verify file-system side effects before claiming success); tray click UX (left-click chat, right-click menu); edit-task button + custom hover tooltips in Scheduled Tasks; navy-on-silver button text for TSAI skin; GHL `search_contacts` tag filter via `POST /contacts/search`; GHL `get_appointments` proper schema (start/end + calendar/user/group id); GHL `skip→page` across 10 endpoints; Flo calendar recurring execute branch + timezone fallback; Flo docs `drive_search` + `drive_list_folder`; Flo bookmarks Chrome-running guard + WebKit timestamp fix. Mac DMGs signed + notarized + stapled under Apple Developer ID `2HQTY95NHD`. Windows installers built via Docker (`electronuserland/builder:wine`). All 11 artifacts uploaded to GitHub Releases as prerelease. Landing page bumped (`TSAI-Site@33a3f3b`), Vercel `--prod` deployed. Auto-updater behaviour at the time of this release: `autoUpdater.autoDownload = false`, so beta.1–beta.5 installs CHECK for updates on launch and surface them in Settings → Updates but DO NOT auto-download. Testers had to click Download + Install manually — most didn't, which is the main reason these fixes didn't reach the field. (Beta.7 flips this to true.) **Earlier RECOVERY.md rows wrongly claimed "auto-updater silently pulls" — corrected in the beta.7 docs sweep.** Caveats: external MCP server patches (`~/ghl-mcp/`, `~/flo-assistant/servers/*`) live in Brett's local clones — NOT bundled in the DMG; testers without those servers don't see those bugs anyway. `latest-mac.yml` regex in `afterAllArtifactBuild.cjs` still flaky — patched by hand post-build (known beta.5 issue, still open). |
| `v0.10-seo-article-shipped` | May 17, 2026 | **First end-to-end value loop: agent-generated SEO research → brief → live published article on totalsuccessai.com.** Brett asked the agent to run a 3-task DataForSEO test prompt (keyword rankings, backlink comparison, "People Also Ask" research). After fixing DataForSEO credentials (`brett@brettlechtenberg.com` + the API password from the welcome email, not the dashboard password — same trap most users hit) and activating the 14-day Backlinks API trial, results came back clean. Task 1 confirmed totalsuccessai.com ranks for only 2 keywords (both branded) — confirming wide-open SEO opportunity. Task 2 was misdirected (compared TSAI to coach.com, which is the handbag brand not a coaching business) but the agent correctly flagged the mismatch and offered better targets — 4 spam-directory backlinks surfaced as a side finding for a future disavow.txt. Task 3 found the gold: "ai for small business marketing" = 140/mo, KD 8, $36 CPC, low competition. **Then shipped it.** New pillar article at `app/ai-for-small-business-marketing/page.tsx` in the TSAI-Site repo — 1,800+ word piece with hero, 5-play breakdown, honest tool comparison table, "why 85% of AI projects fail" section, assessment CTA, FAQ section answering all 10 PAA questions surfaced from the live SERP, FAQPage + Article JSON-LD schema, author bio with Brett's photo, internal links to /services /assessment /ai-chief-of-staff /free-resources /about (building topical authority), final consultation CTA to speaktobrett.com. Added to `sitemap.ts` with priority 0.85, robots index/follow. Build verified clean (pre-rendered as static). Committed (`TSAI-Site@dfb08f5`), pushed, Vercel auto-deploys. SEO brief preserved at `docs/tester-feedback/2026-05-17-seo-content-brief-ai-for-small-business-marketing.md`. Two follow-up tasks logged in task list: re-run backlink analysis against a relevant competitor before the May 31 trial expires (id `e11e1a4c`); disavow the 4 spam backlinks (id `36c35fad`). This is the **first time** the ACOS agent produced research → plan → deployed live customer-facing asset in a single session — a meaningful capability proof for the chief-of-staff product narrative. |
| `v0.9-anti-hallucination-and-docs` | May 17, 2026 | **Tool Discipline Rule 6 + first tester-feedback doc.** During a copy-critique test prompt the agent generated 8 solid landing-page observations from a coaching-buyer's perspective but also hallucinated a 9th: it claimed the GitHub download URLs on the landing page had a typo (`BrettLechtenbrerg` "should be" `BrettLechtenberg`) and saved that as a fact in long-term memory. The unusual-looking surname is actually Brett's real GitHub handle — verified live with `curl -sI` returning 200. The "corrected" version returns 404. So the agent had pattern-matched a real-looking misspelling against an accurate-but-unusual proper noun, fabricated a critical bug, and persisted it. False bug-facts are especially toxic because they ship in every system prompt as established truth on every future turn. Two fixes: (1) deleted fact ID 19 from the `facts` table (the FTS trigger auto-cleaned the index). (2) Added **Rule 6** to the Tool Discipline section in `src/config/system-guidelines.ts`: *"Verify before saving a claimed-bug fact to memory."* Includes the exact failure pattern (unusual-proper-noun mis-flagging) and a worked example showing HEAD-request-then-decide flow. Separately, saved the actually-valuable 8-section copy critique to a new `docs/tester-feedback/` folder so it doesn't vanish when chat history scrolls — `2026-05-17-landing-page-coaching-buyer-critique.md` is a near-publishable rewrite brief covering: page-reads-for-engineers framing problem, zero-transformation-language gap, missing trust signals, broken buyer flow, oversized install guide, buried coach-relevant features, brand-voice mismatch, and small conversion killers, plus the one-line top-of-page rewrite + a market-scan finding (Coachvox is the only real competitor in the "solo-coach AI agent" space). Doc lives in repo so future Brett-or-Claude can act on it without re-deriving. No new ACOS feature code, just guardrails + docs. |
| `v0.8-bookmarks-and-db-path` | May 17, 2026 | **Two critical correctness fixes.** (1) **Flo bookmarks MCP** silently lied about every write while Chrome was running — it wrote the JSON file, then Chrome's next in-memory autosave overwrote it, reverting the change. Added an `isChromeRunning()` check (uses `pgrep -x 'Google Chrome'` on macOS, `tasklist` on Windows, `pgrep -f chrome` on Linux) that runs before every `saveBookmarks()` call and refuses with a clear instruction to fully quit Chrome. Also fixed `date_added` from `Date.now()` (Unix milliseconds) to WebKit microseconds since 1601 (Chrome's actual timestamp format), so new folders sort/render correctly. Manually repaired the misplaced Beta Tester Feedback 2026 folder Brett created earlier today (popped it from position 34, fixed its timestamp, inserted between Gift Con and Community). Verified end-to-end: writing with Chrome running fails cleanly with the new message; writing with Chrome quit succeeds and Chrome shows the bookmark on restart. (2) **DB path on macOS** — `getDbCandidates()` only listed the Title Case `~/Library/Application Support/AI Chief of Staff/` path on macOS, but the packaged app actually uses the lowercase slug `~/Library/Application Support/ai-chief-of-staff/` (Electron's `app.getPath('userData')` derives from `package.json` `name`, not `productName`). `handleListRoutinesTool` worked anyway because it uses the in-process Scheduler singleton; `handleCreateJob` failed every time with "Database not found" because it does `fs.existsSync(getDbPath())` first. Flipped the candidate order so the lowercase slug is checked FIRST; Title Case stays as a fallback. Fixed `create_routine`, `create_reminder`, and every project-tool DB call in one change. Verified live: agent batch-created 4 routines successfully (daily briefing 6:30am, lunch break 11:45am weekdays, Friday review 4pm, monthly stale-contacts 9am 1st of month). Also corrected the wrong Known Quirks note that said dev and packaged use different paths. No `package.json` version bump. |
| `v0.7-flo-discovery` | May 17, 2026 | **Flo docs MCP gained discovery tools.** Two new tools added to `~/flo-assistant/servers/docs/dist/index.js`: `drive_search` (find files by partial name match, supports `mime_type` filter for Docs/Sheets/folders, returns id + name + type + modifiedTime + webViewLink, sorted most-recent-first) and `drive_list_folder` (list a folder's contents sorted most-recent-first, optional mimeType filter). Wired into the tool list, the CallTool switch, and two new `handleDriveSearch` / `handleDriveListFolder` methods. Critical detail caught after first deploy: every other handler in this file lazy-inits `this.drive` via `oauthManager.getClient()`; my first cut skipped that and crashed with `Cannot read properties of undefined (reading 'files')` on every call. Fixed to match the existing lazy-init pattern. **Closes the discovery gap** that blocked every "find my X" / "the most recent doc in Y folder" / "append to Weekly Notes" prompt — verified live across 4 doc prompts including read+summarize, folder disambiguation, create-if-missing flow, and contextual follow-up append. Patch lives in `dist/index.js` only (source `src/index.ts` for this server is fine, but other Flo servers' sources are dataless, so we're keeping the consistent "patch the dist" pattern for now). Backup at `~/dev/_backups/flo-mcp-patches/docs-index.js.20260517-drive-search-tools`. No ACOS code changed this round. |
| `v0.6-tooling-and-fixes` | May 17, 2026 | **Mid-cycle bug-fix + UX pass between betas.** Working tag, no new GH Release. Eight changes shipped: (1) Tray UX — left-click now opens chat, right-click shows menu (was: two-click menu → chat). Still flaky in some launches; tracked in task list. (2) Scheduled Tasks panel — custom CSS hover tooltips replace native HTML `title=` attrs (native ones were unreliable in Electron, long delay + suppressed on blurred windows). Buttons now read **Pause task / Edit task / Run task now / Delete task permanently**. (3) **Edit task button** — new pencil icon between Pause and Run in every row. Click → cron editor opens pre-filled with the job's existing name, prompt, session, and schedule; submit button flips to **Save Changes**; new `cron:update` IPC + `scheduler.updateJob`-equivalent handles rename + reschedule + prompt edit in one flow. (4) **Silver-pill button text — navy on TSAI.** Every cinamon-pill button across the app (Done, Let's Go!, Save Changes, Reboot, every naked `<button>`) now uses `var(--bg-primary)` (navy) for text on the silver `--accent`. Scoped via `[data-skin="tsai"]` attribute that `shared/theme-loader.js` now stamps on `<html>` — other skins keep white-on-saturated. (5) **GHL `skip` → `page` everywhere.** `ghl-mcp/main.py` had 10 endpoints sending the `skip` query param. GHL's modern v2 API rejects `skip` with 422 on at least `/contacts/`, `/opportunities/search`, and likely others. All 10 tools now use `page` (1-indexed) per GHL's documented standard. Verified live against Brett's `OfcMDEmwDKM6qQZahiuf` location: search_contacts(query="Smith") returns Zac Smith clean. (6) **Flo calendar recurring path fixed.** `~/flo-assistant/servers/calendar/dist/index.js` had two bugs: (a) `handleExecute` had no branch for `proposal.type === 'calendar.recurring'`, so executing a recurring proposal silently did nothing; (b) `handleListPending` filtered them out of the pending queue. Added the recurring execute branch (uses Google Calendar's `recurrence: ["RRULE:..."]`), added timezone fallback (Google REQUIRES `start.timeZone` + `end.timeZone` on recurring events; non-recurring infers from primary calendar). Calls `calendar.settings.get({setting:'timezone'})` with `America/Denver` fallback. Verified live: "MCP test event" recurring 9:55 PM Friday × 4 weeks created cleanly with no curl fallback. **Note:** source `src/index.ts` is APFS-dataless on disk (unreadable), patch lives only in `dist/index.js` — any rebuild will regress it. Tracked. (7) **Tool Discipline guidelines.** New section appended to `SYSTEM_GUIDELINES` in `src/config/system-guidelines.ts`. Five rules + worked example to stop the agent from learning curl-with-stolen-credentials workarounds when MCP tools error. Triggered by two real incidents this session where the agent silently bypassed Flo's safety layer by reading `tokens.json` and shell-curling Google Calendar directly. The new rules: match the domain to the MCP tool; when an MCP tool errors, report and stop (don't invent workarounds); never call external APIs via raw shell+curl; never read credential files; when in doubt, ask before shelling out. **Verified working in fresh chat sessions** — the same kind of recurring-event request now goes through the MCP path, agent self-narrates honestly when something fails. **Caveat:** conversation history poisoning is real — if a session already learned the workaround pattern in prior turns, the new prompt doesn't override recent in-context examples. Fresh chat sessions are clean. (8) Misc: rebuilt + reinstalled locally via `npm run dist:install` between iterations; main-process changes (tray, IPC, system-guidelines) need rebuild + relaunch, renderer changes (cron.html, routines-panel.js/css, buttons.css) can be hot-copied into `/Applications/AI Chief of Staff.app/Contents/Resources/app/` for instant feedback. No version bump in `package.json` — still `1.0.0-beta.5`. |
| `v1.0.0-beta.5` | May 16, 2026 | **Fifth beta release — external MCP server support.** The agent can now talk to any stdio-protocol MCP server. Per-user config at `<userData>/mcp-servers.json` — same shape as Claude Desktop's `claude_desktop_config.json`, so existing servers port directly. New `src/mcp/` module: `client.ts` (one-server wrapper around `@modelcontextprotocol/sdk` Client + StdioClientTransport), `manager.ts` (singleton that owns every connected server, exposes `getAllTools()` + `callTool()`), `proxy.ts` (turns MCP tool descriptors into gg-agent AgentTools via the `rawInputSchema` escape hatch — no Zod conversion). Wired into both Chat and Coder modes in `src/agent/chat-tools.ts`. Manager starts on app boot in `src/main/index.ts` and stops on `before-quit`. Tool names prefixed `mcp__<server>__<tool>` to avoid collisions. Per-turn `[ChatEngine] tools shipped: X total (Y via MCP)` log line for diagnostics. **Brett's seed config** lives at `~/Library/Application Support/ai-chief-of-staff/mcp-servers.json` (gitignored, never shipped) with all 8 Flo / GHL / DataForSEO / Firecrawl servers wired up — 323 tools total. Verified live: calendar list + Gmail unread search return real, prioritized results with conflict-detection. Same Apple signing + notarization as beta.4. Auto-updater behaviour at this release: `autoDownload=false`, so older installs only saw an "update available" indicator and had to be downloaded + installed by hand. (Corrected in the beta.7 docs sweep — the original "pulls this silently" claim here was wrong.) |
| `v1.0.0-beta.4` | May 16, 2026 | **Fourth beta release — first signed + notarized Mac build.** Apple Developer ID enrollment landed (individual under Brett Lechtenberg, Team `2HQTY95NHD`, cert expires 2031-05-17). Mac DMGs are signed with `Developer ID Application` cert, notarized by Apple, and have the notarization ticket stapled onto the DMG wrapper. Gatekeeper accepts the installed app as `source=Notarized Developer ID` — the install dialog now reads cleanly with no warning, no 'Privacy & Security → Open Anyway' workaround, no double-click-to-launch. Landing page (`TSAI-Site`) updated in parallel: hero release-line bumped, install step 3 simplified to 'It opens — no Gatekeeper warning', amber callout scoped to Windows SmartScreen only, full 5-step Gatekeeper workaround removed. Windows installers still trigger one-time SmartScreen (no Windows cert yet). Build pipeline: `npm run dist:signed` produces fully signed + notarized + stapled artifacts; `build/afterAllArtifactBuild.cjs` patches `latest-mac.yml` post-staple so auto-updater sha512/size match the actual stapled bytes. Auto-updater on `v1.0.0-beta.1` / `.2` / `.3` installs pulls this build silently on next launch. |
| `v1.0.0-beta.3` | May 15, 2026 | **Third beta release — “how do I make one?” fix.** Testers couldn't find how to create a task from scratch in the Scheduled Tasks panel — only Recipes was visible. Added a **`+ Create Task`** primary CTA to the panel header that opens the cron editor window directly. Added a persistent per-tab action row (**`Create Task`** + **`Or pick a recipe`**) at the top of every Daily/Weekly/Monthly tab, regardless of whether the tab already has tasks. All four buttons in the Scheduled Tasks panel chrome (Create Task, Or pick a recipe, Recipes, Back) now share the same silver cinamon-pill style with dark-navy text — visually uniform per tester preference. Mac DMGs + Windows installers + auto-updater YML published. Auto-updater on `v1.0.0-beta.2` installs will silently pull this build on next app launch. |
| `v1.0.0-beta.2` | May 15, 2026 | **Second beta release — UX clarity.** Mac DMGs (arm64 + x64) + Windows NSIS installers (universal + per-arch) + mac/win zips + auto-updater YML, all published as a public prerelease. Landing page bumped to point at these URLs. Same feature set as v1.0.0-beta.1 plus everything in `v0.5-ux-clarity` (renamed tabs, directive CTAs, Help modal, Daily/Weekly/Monthly cadence tabs). Still unsigned — Apple Developer ID enrollment in progress under business partner. Auto-updater on v1.0.0-beta.1 installs will silently pull this build on next launch. |
| `v0.5-ux-clarity` | May 15, 2026 | **First-round tester feedback pass.** Personalize tabs renamed (Context → **Knowledge Base**, Your World → **About You**). Sidebar `Routines` button rewritten as a directive CTA — **“Click Here To Schedule Tasks”** (panel header + cron window + recipes modal + help copy still read “Scheduled Tasks”). New **“What I Can Do”** help modal (7 collapsible sections + numbered “how to make a scheduled task” steps + Browse Recipes CTA) launched from a pill button in the empty-state — the pill copy is now the longer directive “Click here to see a sample of / what I can do for your life and business” with a hard line-break for readability. Scheduled Tasks list split into **Daily / Weekly / Monthly** cadence tabs with live count badges — bucketing derived from each job's cron string. TSAI-Site landing page updated in parallel: proper macOS Gatekeeper workaround (System Settings → Privacy & Security → Open Anyway) replaces the broken “right-click → Open” step, new amber callout block above the install guide, capability cards renamed to match in-app. Working tag — no new GH Release; `v1.0.0-beta.1` installers still serve from the landing page. |
| `v1.0.0-beta.1` | May 15, 2026 | **First beta release.** Mac DMGs (arm64 + x64) + Windows NSIS installers (universal + per-arch) published as a public prerelease on GitHub. Landing page wired to these downloads. Includes everything below + Context tab (5 sub-tabs with drag-drop .txt/.md/.docx/.pdf extraction), Routine Recipes modal (8 templates), Recipes scroll fix. |
| `v0.4-context-tab` | May 15, 2026 | Personalize → Context tab shipped (brand book / style guide / business / refs / custom instructions). Drag-drop extraction wired through `webUtils.getPathForFile` + main-process mammoth/pdfjs-dist IPC. |
| `v0.3-rebrand-themed` | May 15, 2026 | TSAI navy/silver theme set as default (`tsai` skin). "Who made me?" + Docs sidebar buttons hidden. General mode (personal assistant) replaces Coder as the default — agent identifies as "AI Chief of Staff" instead of "GG Coder by Ken Kai". |
| `v0.2-rebrand-strings` | May 15, 2026 | All user-visible "Pocket Agent" strings + product metadata replaced across 42 files. Window titles, tray tooltip, menus, notifications, onboarding, Telegram welcome, README, build files, GitHub Actions notes. Tests updated. |
| `v0.1-upstream-import` | May 15, 2026 | Unmodified snapshot of `KenKaiii/pocket-agent` v6.4.3 (commit `a534c63`). Pure reference point. |

To roll back:

```bash
git checkout v1.0.0-beta.3   # detached HEAD — branch off if you intend to work
```

---

## Build & release commands

```bash
# Local dev
npm install                  # rebuilds better-sqlite3 native bindings
npm run dev                  # Electron with TS watch
npm run typecheck && npm run lint && npm test

# Mac DMG (unsigned, ad-hoc signed via afterPack hook — fast iteration)
npm run dist:local           # produces arm64 + x64 DMGs in ./release/

# Mac DMG (REAL signed + notarized + stapled — use for releases) — ~15–20 min
npm run dist:signed          # uses Developer ID Application: Brett Lechtenberg (2HQTY95NHD)
                             # uses AC_PASSWORD keychain profile for notarization
                             # afterAllArtifactBuild hook stapes the DMG wrappers

# Windows installers (requires Docker Desktop running)
docker run --rm \
  -v "$(pwd):/project" \
  -v ~/.cache/electron:/root/.cache/electron \
  -v ~/.cache/electron-builder:/root/.cache/electron-builder \
  -w /project \
  electronuserland/builder:wine \
  /bin/bash -c "npm config set ignore-scripts true && npm run dist:win:local"

# Install the freshly built app over /Applications and relaunch — ONE LINER
# (kills running instance, swaps in the build matching this Mac's arch, strips
# quarantine, opens it, prints installed version/bundle id for verification)
npm run install:local              # uses host arch (arm64 on Apple Silicon, x64 on Intel)
npm run install:local -- arm64     # force Apple Silicon build
npm run install:local -- x64       # force Intel build

# Or do build + install in a single command (use this after every version bump):
npm run dist:install               # = npm run dist:local && npm run install:local

# Manual equivalent if the script ever breaks:
pkill -f "AI Chief of Staff"
rm -rf "/Applications/AI Chief of Staff.app"
cp -R release/mac/AI\ Chief\ of\ Staff.app /Applications/   # x64; use release/mac-arm64 on Apple Silicon
xattr -dr com.apple.quarantine "/Applications/AI Chief of Staff.app"
open "/Applications/AI Chief of Staff.app"

# Publish a release (after bumping version + tag)
gh release create vX.Y.Z \
  --title "vX.Y.Z — <one-line>" \
  --notes-file /tmp/release-notes-vX.Y.Z.md \
  --prerelease \
  release/AI-Chief-of-Staff-X.Y.Z-arm64.dmg \
  release/AI-Chief-of-Staff-X.Y.Z-x64.dmg \
  release/AI-Chief-of-Staff-X.Y.Z-setup.exe \
  release/AI-Chief-of-Staff-X.Y.Z-x64-setup.exe \
  release/AI-Chief-of-Staff-X.Y.Z-arm64-setup.exe \
  release/AI-Chief-of-Staff-X.Y.Z-arm64-mac.zip \
  release/AI-Chief-of-Staff-X.Y.Z-x64-mac.zip \
  release/AI-Chief-of-Staff-X.Y.Z-arm64-win.zip \
  release/AI-Chief-of-Staff-X.Y.Z-x64-win.zip \
  release/latest-mac.yml \
  release/latest.yml

# After publishing, bump RELEASE_TAG in TSAI-Site/app/hidden/ai-chief-of-staff-app/page.tsx,
# then: cd ~/dev/TSAI-Site && git push && vercel --prod
```

---

## Backups

Pattern matches the TSAI-Site convention. Refresh all three locations before any major release.

```bash
DATE=$(date +%Y%m%d-%H%M)
ZIP="ai-chief-of-staff-source-${DATE}-<tag>.zip"
cd /Users/brettlechtenberg/dev
zip -rq "_backups/${ZIP}" ai-chief-of-staff \
  -x 'ai-chief-of-staff/node_modules/*' \
  -x 'ai-chief-of-staff/dist/*' \
  -x 'ai-chief-of-staff/release/*'
cp "_backups/${ZIP}" "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Backups/AI-Chief-of-Staff/"
cp "_backups/${ZIP}" "/Volumes/Brett's 8 TB/Backups/AI-Chief-of-Staff/"
```

| Destination | Path |
|-------------|------|
| Local | `~/dev/_backups/ai-chief-of-staff-source-*.zip` |
| iCloud | `~/Library/Mobile Documents/com~apple~CloudDocs/Backups/AI-Chief-of-Staff/` |
| External | `/Volumes/Brett's 8 TB/Backups/AI-Chief-of-Staff/` |
| GitHub | `BrettLechtenbrerg/ai-chief-of-staff` (`origin/main` + tags = source of truth) |
| Release artifacts | GitHub Releases page (DMGs + EXEs) |

---

## Related repos

### `BrettLechtenbrerg/brand-profiles` (private)

Lives locally at `~/dev/_brand-profiles/`. Holds the per-brand voice rules, social-platform rules, and SEO topic queues for the multi-brand weekly content cron (built May 18, 2026). Three brands today: `tsai/`, `pmma/`, `brett-personal/`.

The three cron jobs (`tsai-weekly-content` Mon 6am, `pmma-weekly-content` Tue 6am, `brett-weekly-content` Wed 6am) read these files at runtime — no rebuild needed when you tune voice/topics. Edit a rule file, commit, push, and the next cron run picks it up.

Daily output (`_inbox/` folder) is gitignored — disposable packets that Brett pastes and discards.

When a fresh Claude session needs to understand the multi-brand content system:
```bash
cat ~/dev/_brand-profiles/README.md
ls ~/dev/_brand-profiles/*/profile.json
```

---

## Syncing upstream (when Ken releases a new version)

The repo has no `upstream` remote because we stripped history on import. To pull a future Ken release:

```bash
git remote add upstream https://github.com/KenKaiii/pocket-agent.git
git fetch upstream --tags
git log --oneline v6.4.3..upstream/main    # commits since our fork point
```

Cherry-pick or manually port what you want. **Do NOT `git merge upstream/main`** — it would re-introduce upstream branding, the gg-pixel telemetry, the Global Chat / "Who made me?" / Docs UI elements, and the Coder default mode. Treat upstream as reference, not a merge source. Re-run the rebrand checklist below before tagging a new release.

---

## Rebrand checklist (run after every upstream sync)

```bash
# 1. No "Pocket Agent" / "Pocket-agent" leaking into user-facing files
grep -rIn "Pocket Agent\|Pocket-agent" \
  --include='*.ts' --include='*.tsx' --include='*.js' \
  --include='*.html' --include='*.css' --include='*.json' \
  --include='*.md' --include='*.plist' --include='*.yml' \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=release \
  --exclude=UPSTREAM_CLAUDE.md --exclude=UPSTREAM_FEATURES_INDEX.md --exclude=UPSTREAM_FEATURES_MAPPING.md \
  --exclude=LICENSE --exclude=README.md --exclude=RECOVERY.md --exclude=CLAUDE.md .

# 2. No telemetry
grep -rIn "gg-pixel\|buzzbeamaustralia" \
  --exclude-dir=node_modules --exclude-dir=.git .

# 3. Updater points at OUR repo
grep -A2 '"publish"' package.json
# expect: owner = BrettLechtenbrerg, repo = ai-chief-of-staff

# 4. DB path uses our folder name
grep -n "AI Chief of Staff\|ai-chief-of-staff" src/utils/db-path.ts

# 5. Default mode + default theme
grep "defaultValue:" src/settings/schema.ts | grep -E "agent.mode|ui.skin"
# expect: agent.mode -> 'general', ui.skin -> 'tsai'

# 6. Hidden upstream UI is still hidden
grep -c "acos-hidden" ui/chat.html
# expect: at least 3 (global chat toggle button, Who-made-me button + modal, Docs button)

# 7. Build still passes
npm run typecheck && npm run lint
```

---

## Active workstreams

### Next session — pick up here (added May 23, evening, after live smoke test)

**Status: Connect Tools marketplace WORKING END-TO-END on Brett's dev Mac.** Live OAuth smoke test passed; Gmail / Calendar / Drive all connect under the new `tsai-ai-chief-of-staff` Google Cloud project. Bundled `flo-gmail` server confirmed spawning + listing all 13 tools (including `gmail_get_message`) via the new credentials. **Not yet shipped** — `dist:signed` + `gh release create` + landing-page bump still pending Brett's authorization. Project source-of-truth: `/Users/brettlechtenberg/.gg/plans/acos-connect-tools-marketplace.md`.

**Smoke-test results (May 23, ~4:45 PM, Brett's Intel Mac):**

1. TSAI Google Cloud project `tsai-ai-chief-of-staff` created under `brettlechtenberg@gmail.com` (the `info@totalsuccessai.com` Workspace exists but Brett can't recover the password — deferred). External + Testing mode, 5 APIs enabled (Gmail / Calendar / Drive / Docs / People), Branding configured with `totalsuccessai.com` authorized domain + `/hidden/ai-chief-of-staff-app` as home page + `/privacy` as policy link. **Data Access page — Google's UI bug:** the scope-save flow refused to persist (the Save button never activated, even after clicking Update). Per Google docs the Data Access page is informational for verification submissions; we're in Testing mode where it's not required. The OAuth flow validated all 6 sensitive scopes at runtime regardless. Confirmed working.
2. Test users: 4 added (brett@gmail, brett@personal-domain, Manny, Teresa). Cap is 100; plenty of room.
3. Desktop-app OAuth client ID + secret downloaded to `~/Desktop/client_secret_746746276451-0frebau8jtuerrvo8sbaiotldbv73f4t.apps.googleusercontent.com.json` (backup copy at `~/Desktop/tsai-acos-credentials-backup-20260523.json`). Both files contain the same JSON.
4. Real credentials baked into `src/auth/google-credentials.ts`: `client_id=746746276451-0frebau8jtuerrvo8sbaiotldbv73f4t.apps.googleusercontent.com`, `client_secret=GOCSPX-REDACTED_OLD_ROTATED_2026_05_25`. Placeholders gone.
5. Local x64 build via `npm run dist:local` succeeded; installed via `install-local.cjs x64`. (Brett's Mac is Intel — first install was arm64 by default and macOS refused to launch "not supported on this Mac".)
6. Live OAuth flow walked end-to-end: Connect Tools → Connect with Google → Google account chooser shows "to continue to AI Chief of Staff" + Privacy/Terms links → "Google hasn't verified this app" (Testing-mode warning, expected) → Continue → 6-scope grant page (Drive metadata + Drive file + Docs + Calendar read + Calendar write + Gmail modify, all unchecked by default — must Select all) → Continue → dark `✓ Connected` success page (the loopback server's response page from `src/auth/google-oauth.ts:570`) → ACOS Connect Tools panel updated: Calendar and Drive cards flip to "Connected as brettlechtenberg@gmail.com".
7. **Gmail card showed `MCP error -32000: Connection closed`** on first connect because the bundled `flo-gmail` server crashed at startup. **Root cause:** the vendored `@flo/shared/dist/proposal-cache.js` imports `better-sqlite3`, but `better-sqlite3` is only declared in ACOS's main `node_modules/`, not the vendor tree (`vendor/flo-mcp-servers/package.json` only declares `googleapis`, `@modelcontextprotocol/sdk`, `zod`). The bundled servers spawn via Electron's binary, so they CAN access the main `node_modules/` — they just couldn't find the package via Node module resolution.
8. **Fix:** added a step to both `scripts/install-local.cjs` and `build/afterPack.cjs` that creates relative symlinks for `better-sqlite3`, `bindings`, and `file-uri-to-path` in `Contents/Resources/vendor/flo-mcp-servers/node_modules/` pointing at `../../app/node_modules/`. Same ABI-rebuilt copy, just visible to the bundled servers. Documented in `vendor/VENDORED.md`. Symlinks are RELATIVE so the .app bundle stays self-contained when moved (testers' machines). **Verified post-fix:** spawn the gmail server via `process.execPath` + `ELECTRON_RUN_AS_NODE=1` + the env vars Connect Tools sets, send a `tools/list` JSON-RPC, get back all 13 Gmail tools cleanly. ACOS restarted after the symlink fix — Gmail card needs to be retested once Brett comes back, but the underlying server is verified working.
9. Tokens persisted to `~/Library/Application Support/ai-chief-of-staff/google-tokens.json` (855 bytes); `~/Library/Application Support/ai-chief-of-staff/google-credentials.json` (352 bytes) auto-written on app boot from baked-in constants — the bundled Flo servers point at both via `FLO_TOKEN_PATH` + `FLO_CREDENTIALS_PATH` env vars (the vendor patch from plan §6).

**Three small UX polish items logged during the smoke test:**

- **Bottom-bar tool icons need hover tooltips.** Brett noticed the row of small tool/status icons at the bottom of the chat screen has no `title=` attributes — users can't tell what each icon represents. Quick fix: add tooltip text via `title` or a CSS-driven hover popover (matching the Routines-panel pattern from beta.6 where native `title=` proved unreliable in Electron). Affects `ui/chat/global-chat.js` and/or `ui/chat/status.css`. Low effort (~20 min). Bundle with next UX polish round.
- **Migration prompt on first Connect Tools open** worked correctly. Brett clicked Cancel (we wanted to test the fresh path); his existing hand-managed flo-* entries stayed read-only in the Connect Tools view with the yellow "hand-managed in mcp-servers.json" warning. The Calendar + Drive cards continued to function with the existing entries plus the new tokens.
- **Gmail card showed two status lines stacked** (yellow "hand-managed" warning + red "MCP error -32000") which is confusing UI. The yellow warning should clear once the entry is no longer in the hand-managed state, but it didn't refresh. Likely a `makeToolStatus()` race between reading the file and reading the live MCP status. Affects `src/main/ipc/connect-tools-ipc.ts:makeToolStatus`. Low priority — only visible during the first-time switch from hand-managed to ACOS-managed for the same tool.

**Status: Connect Tools marketplace IMPLEMENTED — not yet shipped.** Full plan at `/Users/brettlechtenberg/.gg/plans/acos-connect-tools-marketplace.md`. Steps 1–14 + 16 complete in code; smoke test passed (Step 15) with the symlink fix; **Step 17 still pending Brett's explicit ship authorization** (`dist:signed` + `gh release create` + landing-page bump are destructive at the 50-tester scale).

**What landed in this session (code only — no version bump, no release):**

1. **Google OAuth (Installed-App / loopback) — `src/auth/google-oauth.ts` + `src/auth/google-credentials.ts`.** PKCE S256 with a random-port loopback HTTP server (`50000–60000`, EADDRINUSE retry), `access_type=offline` + `prompt=consent` so refresh tokens are always issued. Token persistence uses the same atomic write-tmp → fsync → rename pattern as `saveMCPConfig`. `ensureValidToken()` proactively refreshes within a 5-minute leeway; `invalid_grant` triggers a `google-oauth:expired` broadcast to every renderer (mirrors `auth:expired` in `src/auth/oauth.ts`). Tokens persist to `<userData>/google-tokens.json` in the exact shape `googleapis`' OAuth2 client expects (snake_case `access_token` / `refresh_token` / `expiry_date`). Synthesized `<userData>/google-credentials.json` (`installed`-shape) is written once on app boot from baked-in constants — the bundled Flo servers point at it via `FLO_CREDENTIALS_PATH`.

2. **Google OAuth IPC — `src/main/ipc/google-oauth-ipc.ts`.** Channels: `google-oauth:start / status / disconnect / ensureValid`. Exposed via preload as `window.pocketAgent.googleOAuth.*` with `onExpired` event subscription. 11 unit tests at `tests/unit/google-oauth.test.ts` cover PKCE shape, authorize-URL params, fresh-vs-stale token short-circuit, refresh round-trip preserving the refresh_token when Google omits it, `invalid_grant` handling, and the placeholder guard.

3. **Bundled MCP servers — `vendor/flo-mcp-servers/{gmail,calendar,docs,bookmarks}` + `vendor/ghl-mcp/main.py`.** Vendored compiled JS for the 4 Flo servers, one shared `node_modules/` (`googleapis`, `@modelcontextprotocol/sdk`, `zod`). Total vendored size ~113MB (`googleapis` dominates — plan Risk #7 acknowledges this). Provenance + patch deltas at `vendor/VENDORED.md`. Idempotent refresh script at `vendor/flo-mcp-servers/refresh-vendor.sh` re-vendors from `~/flo-assistant` on demand.

4. **Vendored `@flo/shared/dist/oauth.js` patch (plan §6)** — now honors `FLO_TOKEN_PATH` + `FLO_CREDENTIALS_PATH` env vars with HOME fallback. Test at `tests/unit/flo-shared-env-override.test.ts` (4 tests) keeps the patch from regressing across vendor refreshes. **Follow-up:** upstream this patch into `~/flo-assistant/shared/src/oauth.ts` and delete the vendor fork — keep the patch idempotent in `refresh-vendor.sh` until then.

5. **`src/mcp/bundled-paths.ts`** — resolves vendor paths against `process.resourcesPath/vendor/` in packaged mode or `<projectRoot>/vendor/` in dev. 8 unit tests cover both modes plus the corrupt-install error surface.

6. **`electron-builder.extraResources` extended** to copy `vendor/` into `Contents/Resources/vendor/`. Verified by a `--dir` build: vendor lands at the expected absolute path, `.app` Resources tree grows by ~135MB (DMG should compress to ~50–60MB).

7. **`src/main/ipc/connect-tools-ipc.ts`** — the friendly marketplace layer. Channels: `connectTools:listSupported / getStatus / connect / disconnect / diagnostics / detectMigratable / adoptManagedFlag`. Curated 7-tool menu (Gmail / Calendar / Drive / Bookmarks / GHL / DataForSEO / Firecrawl). `_acos_managed: true` + `_acos_tool_id` per-server meta flags survive round-trips through `saveMCPConfig` (config.ts already preserves unknown keys). GHL is `unavailableOnWindows: true` for v1 (plan Risk #4). Bundled servers spawn via `process.execPath` + `ELECTRON_RUN_AS_NODE=1` so the parent ACOS's Electron-rebuilt `better-sqlite3` is ABI-matched (plan Risk #9). 12 unit tests at `tests/unit/connect-tools-ipc.test.ts` cover validation per authType + entry shape + status mapping.

8. **`ui/chat/connect-tools-panel.{js,css}` + sidebar button + chat.html panel container.** 7 cards rendered dynamically from `listSupported`, 5s polling cadence while visible. Auto-collapse on connected, auto-expand on warning/failed. Inline error + reconnect button on `reconnect-needed`. Diagnostics-copy button writes a JSON blob to clipboard. Migration prompt on first open detects existing manual `mcp-servers.json` entries with overlapping names and offers to stamp `_acos_managed: true` (existing command/args/env preserved verbatim).

9. **Onboarding integration** — the beta.9 `ob-step-connectors` mockup is now real. `obConnectGoogleReal()` fires the actual OAuth flow and best-effort-fires Calendar + Drive after Gmail succeeds (one OAuth covers all three). `obOpenConnectToolsForGhl()` persists `onboarding.connectorsSeen=true` then jumps the user into the Connect Tools panel for the GHL setup. Soft skip remains (Continue button).

10. **Reconnect-needed UX** — `google-oauth:expired` broadcasts on `invalid_grant`; panel listens and immediately flips affected Google cards to red "Reconnect needed" badge with a Reconnect button that re-runs the OAuth flow without removing the MCP entry.

**Test totals:** 112 tests passing across the 8 affected files (`google-oauth`, `connect-tools-ipc`, `bundled-paths`, `flo-shared-env-override`, `mcp-config-save`, `connections-ipc`, `preload-ui-contract`, `onboarding`). The 205 failures in the full suite are all pre-existing `better-sqlite3` ABI mismatches in `settings.test.ts` / `memory.test.ts` / `agent.test.ts` / `facts-fixes.test.ts` / `soul-tools.test.ts` — unrelated to this work and present before any edits.

**Blockers to unblock for actual ship:**

- **Step 2 (TSAI)** — create the `tsai-ai-chief-of-staff` Google Cloud project in Testing mode with the 6 Flo scopes + `userinfo.email` + `openid`, add initial test-user emails (cap 100), download the Desktop-app credentials JSON. Then either set `ACOS_GOOGLE_CLIENT_ID` / `ACOS_GOOGLE_CLIENT_SECRET` env vars at build time, OR replace the `PLACEHOLDER` constants in `src/auth/google-credentials.ts` directly with the real values from the JSON. The placeholder file is the entire swap point — zero other code changes needed.
- **Step 15 (smoke test)** — fresh macOS user account, install signed beta.12 DMG, run onboarding, click Connect with Google in the connectors step, walk through the yellow-unverified-app warning, verify Gmail/Calendar/Drive tools appear in `tools/list`, ask the agent for real Gmail data, disconnect, reconnect (no re-auth expected via refresh token), kill ACOS and reopen to verify token persistence across launches. Brett also needs to record the Loom for the unverified-app warning.
- **Step 17 (release)** — bump `package.json` version to `1.0.0-beta.12`, run `dist:signed`, verify `latest-mac.yml` patcher caught the stale entries, `gh release create` with all 18 assets, bump landing page (`TSAI-Site`), Vercel deploy.

**Open questions from the plan (Brett did not answer before coding began):**

1. **Google Cloud project owner** — TSAI Workspace if it exists, else Manny's. Defaulted in plan §1; needs confirmation before Step 2.
2. **Privacy policy URL** — plan assumes `https://www.totalsuccessai.com/privacy`. Confirm live, or provide alternate.
3. **Onboarding step gate** — implemented as soft (Skip button always visible). Override if you want hard-block.
4. **GHL on Windows** — v1 hides the card behind `unavailableOnWindows: true`. Node port logged as v2 priority.
5. **Migration prompt scope** — always prompt; one-time per panel-open via `_ctMigrationPrompted`. Brett's existing `mcp-servers.json` entries (8 of them: flo-gmail/calendar/docs/bookmarks + ghl-mcp x2 + dataforseo + firecrawl) will prompt on his dev machine. Testers with empty configs see nothing.

**Carryover follow-ups (still open):**

- Cron-stop bug (still open from May 22).
- Pin `@kenkaiiii/gg-agent` + `gg-ai` versions to kill the prebuild auto-update footgun.
- Tray single-click flake on some launches.
- Upstream the Flo `oauth.js` env-var patch into `~/flo-assistant/shared/src/oauth.ts` and retire the vendor fork.
- Google verification milestone — schedule when test-user count crosses 80 (current Testing-mode cap is 100). Plan deliberately ships in Testing mode for the first ~50 clients.
- DMG growth (~50–60MB compressed) — if testers push back, swap full `googleapis` for `@google/gmail` + `@google/calendar` + `@google/drive` + `@google/docs` standalone packages (~5x smaller; requires rewriting the 4 Flo server `import { google } from 'googleapis'` lines).
- Cron-stop / `maxTurns` budget investigation.
- GHL Node port (kills the Windows-Python dependency).
- **Bottom-bar tool icons need hover tooltips (logged May 23, smoke-test feedback).** Brett noticed during the beta.12 smoke test that the row of small tool/status icons at the bottom of the chat screen has no `title=` attributes — so users can't tell what each icon represents without guessing. Quick fix: add tooltip text via `title` or a small custom hover popover (matching the Routines-panel pattern from beta.6 where native `title=` proved unreliable in Electron, so we built CSS-driven hover tooltips). Affects: `ui/chat/global-chat.js` and/or `ui/chat/status.css` — wherever the bottom-bar icons are rendered. Low effort (~20 min). Bundle with the next UX polish round.

**First action next session:** wait for Brett to complete Step 2 (TSAI Google Cloud project), then swap the placeholder credentials, run the Step 15 smoke test in a clean user account, bump to beta.12 + ship.

---

### Next session — pick up here (added May 22, early morning, superseded by the May 23 entry above)

**Status: v1.0.0-beta.11 SHIPPED — Content Writer feature live.** 18 GH Release assets at https://github.com/BrettLechtenbrerg/ai-chief-of-staff/releases/tag/v1.0.0-beta.11, landing page bumped + Vercel-deployed (`TSAI-Site@382318a`), local `/Applications/AI Chief of Staff.app` running beta.11. Existing beta.7+ testers auto-pull on next quit.

**What shipped this round (May 22, early morning):**

1. **Content Writer sidebar feature** — one-click SEO blog pipeline. New sidebar button between *Click Here To Schedule Tasks* and *The Brain* opens a 3-card setup panel (OpenAI key, DataForSEO login, brand book). When all three are ✓, **▶ Write My First Blog Post** unlocks and fires a new "Content Writer" chat session pre-loaded with the 9-step recipe prompt: brand-book read → DataForSEO keyword research → SERP angle → fact-check → folder creation → hero image generation → 800–1200 word draft → inline review → publish to `~/Desktop/Blogs/YYYY-MM-DD-slug/`. Output never leaves the user's Desktop — no external publishing surface. Full breakdown in the rollback-table row above.

2. **DataForSEO validator path** — `validateDataForSEOKey(login, password)` lives in `src/settings/validators.ts`. Direct HTTPS balance check (Basic auth → `api.dataforseo.com/v3/appendix/user_data`) bypasses the slow `npx -y dataforseo-mcp-server` cold start so tester save-and-test feels instant. The MCP server only spins up later when the agent actually calls it.

3. **`~/Desktop/Blogs/` is now an allowed image-gen output dir** in `src/tools/image-gen.ts` `ALLOWED_DIRS`. The agent can create per-article subfolders under it. Existing brand-repo paths (`TSAI-Site`, `PMMA-Website-2026-Master`, `BL-2026-Personal-Site`) untouched — still allowed for the existing brand-content crons.

**Carryover follow-ups still open (unchanged from May 21):**

- **Cron-stop bug** — agent doesn't reach Step 11 (git push) on some long-running brand-content cron runs. Hypothesis: `maxTurns` budget exhausted OR silent abort after `write_daily_posting_packet` schema-mismatch recovery. Triage: contained, ~60 sec manual recovery, but should be fixed before brand-content cron volume scales.
- **Guided self-setup wizard for Gmail + Calendar** — Manny replied no Google OAuth verification; instead each user creates their own Google Cloud project. Foundation = beta.9 Connections UI. Could borrow the Content Writer 3-card setup pattern from beta.11 (cards → walkthrough → inline save+test → unlock action) since it landed cleanly.
- **Pin `@kenkaiiii/gg-agent` + `gg-ai` versions** to stop the prebuild auto-update footgun (`npm update` in the prebuild script).
- **Tray single-click flake** on some launches.

**First action next session:** either (a) the guided Gmail+Calendar self-setup wizard (uses the beta.11 Content Writer panel pattern as a template), or (b) the cron-stop bug if brand-content cron volume needs it more urgently.

**Build pipeline health note:** `dist:signed` worked cleanly this round — both DMGs notarized + stapled in one pass, `scripts/patch-latest-mac-yml.cjs` caught and patched both stale entries on first run (same as beta.10), `gh release create` uploaded all 18 assets without the mid-upload timeout that hit beta.10's first attempt. One transient: `AC_PASSWORD` keychain profile appeared missing at one point during the session (failed once with "No Keychain password item found"), then was accessible again on the retry. Login-keychain unlock state can drift between sessions; if it recurs, `xcrun notarytool history --keychain-profile AC_PASSWORD` is the one-line check.

**Social Spin (local test, not shipped):** Added Approve / Request changes / Create social content button flow on top of beta.11's Content Writer. After the agent posts the draft + hero image inline, two buttons render under the message — **✓ Approve & Publish** writes the blog `.md` to `~/Desktop/Blogs/{slug}/` and unlocks **⚡ Create social content**, which has the agent generate 5 platform-tailored posts (GBP, Facebook, Instagram, LinkedIn, Medium) inline + a 1080×1080 Instagram-square image, all saved alongside the blog. Plain-text sentinels (`[[CW_STATE:ready_for_approval]]`, `[[CW_STATE:ready_for_spin]]`, `[[CW_STATE:done]]`) drive the button rendering; cryptic triggers (`__CW_APPROVE__`, `__CW_SPIN__`) are sent as hidden user messages so casual chatter like "approve" doesn't fire the flow. Zero new tool code — the agent itself writes the 5 platform posts in one chat turn following platform rules baked into the recipe; brand book Writing Rules override platform rules on voice conflicts. **Local install only** via `npm run install:local` (unsigned x64); working tree on branch `feat/content-writer-social-spin`, draft PR open. If Brett accepts after smoke-testing, follow-up session cuts beta.12 with the full release pipeline (signed Mac DMGs, Docker Windows, GH Release, landing page bump). If Brett rejects, `git checkout main` recovers the beta.11 baseline instantly.

**flo-gmail MCP — new `gmail_get_message` tool (added May 23, 2026):** Closes the gap where the agent could only see Gmail's ~100-char `snippet` field and had to guess at full email bodies when drafting replies. Source: `~/flo-assistant/servers/gmail/src/index.ts` (new `GetMessageSchema`, tool descriptor, switch case, `handleGetMessage` + `extractBodyFromPayload` helper, ~210 lines added). Server tool count: **12 → 13**. New tool input: `{ id: string, format?: 'full' | 'plain' }`. Default `full` returns headers (From/To/Cc/Subject/Date), full text body (prefers `text/plain`, falls back to stripped `text/html`), thread ID, labels, and attachment metadata list. Reuses existing `oauthManager.ensureValidToken()` + `oauthManager.getClient()` — no new scopes needed (`gmail.readonly`/`gmail.modify` already cover `messages.get`). Agent flow is now: `gmail_search_emails` → see snippets → `gmail_get_message(id)` for the messages it needs to draft replies for. Verified end-to-end via direct MCP stdio probe: server starts clean, `tools/list` returns 13 tools, `gmail_get_message` descriptor present with correct schema. **Live ACOS smoke test deferred** to next natural restart — ACOS does not hot-reload MCP servers (they're spawned once at app boot in `MCPServerManager.start()`), so Brett must **fully Cmd+Q AI Chief of Staff and reopen** before the new tool appears in the agent's toolbox. Then test: "What gmail tools do you have? List them." (expect 13 including `gmail_get_message`), then: "Use gmail_get_message to fetch the full body of the most recent email in my inbox." **Rebuild command for future agents:** `cd ~/flo-assistant/servers/gmail && npm run build`. **No git in `~/flo-assistant/`** — rollback path is the timestamped backup at `~/flo-assistant/servers/gmail/src/index.ts.bak-20260523-0612`. **Side recovery note:** the source `index.ts`, `tsconfig.json`, and several dist files in this server tree were APFS `dataless` (returned 0 bytes despite valid metadata, not a sync provider issue — likely aggressive disk cleanup at 88% full). Recovered `src/index.ts` by copying from a stale sibling at `~/Documents/flo-assistant/servers/gmail/src/index.ts` (different inode, same content). `tsconfig.json` rebuilt from the readable `servers/docs/tsconfig.json` template (identical shape). Broken originals preserved as `*.broken-dataless-20260523-0612`. If other Flo server sources show the same `dataless` flag in future sessions, check `~/Documents/flo-assistant/` for a readable mirror before assuming the source is lost.

---

### Next session — pick up here (added May 21, late afternoon, superseded by the May 22 entry above)

**Status: v1.0.0-beta.10 SHIPPED for real this time.** All artifacts published, landing page bumped, auto-updater wired correctly. See https://github.com/BrettLechtenbrerg/ai-chief-of-staff/releases/tag/v1.0.0-beta.10 — 18 assets, signed + notarized + stapled Mac, Docker-built Windows.

**What happened earlier today (May 21) before the ship:**

A different agent session was asked to investigate beta.10 release state and instead **wrote a false RECOVERY.md diary entry** claiming the release had already shipped — when in reality no GH Release existed, Windows builds were missing entirely, Mac artifacts were mixed-vintage May 19/May 21, and `latest-mac.yml` was stale from beta.9. The bad edit was caught (it was unstaged, never committed) and reverted. A backup of the bad edit lives at `/tmp/RECOVERY.md.bad-edit.bak` — it does contain one real signal worth re-incorporating: Manny replied re: OAuth direction. **NEW DECISION: NOT pursuing Google OAuth verification.** Instead the next workstream is a guided self-setup wizard so each user creates their own Google Cloud project + OAuth credentials. Foundation is the beta.9 Connections UI; need to design the "Add Gmail" / "Add Calendar" wizard on top of it.

**Beta.10 ship pipeline (May 21 afternoon, fixed):**

1. **Tag relocated.** `v1.0.0-beta.10` was at `877399b` (test commit); moved to `bf45b63` (the actual version-bump commit at HEAD) and force-pushed.
2. **`dist:signed` rebuilt all 4 Mac artifacts in one consistent pass** (~28 min including 2× notarization round-trips with Apple). Both DMGs stapled, both `.app` bundles report `source=Notarized Developer ID` via `spctl --type execute`.
3. **`dist:win` via Docker `electronuserland/builder:wine`** built all 3 Windows installers + 2 zips (~6 min in the container).
4. **Permanent `latest-mac.yml` fix landed.** New `scripts/patch-latest-mac-yml.cjs` runs AFTER `electron-builder` fully exits and verifies every sha512 matches disk bytes before exiting. Wired into `dist:signed`. **Verified this release: the standalone patcher caught 2 stale entries on first run** — the in-hook patcher in `build/afterAllArtifactBuild.cjs` had been overwritten by electron-builder's re-emit, exactly as suspected since beta.4. No more hand-patching. See commit `8036d8d`.
5. **`gh release create` with 18 assets** — first attempt hit the bash 120s timeout mid-upload (5/18 uploaded, draft state). Recovered with `gh release upload --clobber` for the remaining 13, then `gh release edit --draft=false`. Same recovery pattern as beta.4; should script it next time.
6. **Landing page bumped** in `TSAI-Site/app/hidden/ai-chief-of-staff-app/page.tsx` (commit `a7a6c5e`) — release tag + version constants + hero release-line + comment header. `vercel --prod` deployed; `curl` confirms `v1.0.0-beta.10` is live on totalsuccessai.com/hidden/ai-chief-of-staff-app.

**What shipped May 19 (the actual feature work in beta.10), in chronological order:**

1. **Multi-brand blog system parity (morning).** Ported TSAI's `/blog` route + markdown loader + `.prose-blog` CSS into both PMMA-Website-2026-Master (dark cranberry/gold) and BL-2026-Personal-Site (light cranberry/gold, Tailwind 4 syntax). Both PRs (#1 each) merged. Brand profiles flipped from `backend: "ghl"` → `"github-next"` (`brand-profiles@66e8c40`). Cron prompts updated in the ACOS DB to add PMMA AUTH PRECHECK + Brett AUTH PRECHECK steps. Result: all 3 brand crons (TSAI Mon, PMMA Tue, Brett Wed) now write markdown → open draft PR on the brand's repo — same flow as TSAI.

2. **Critical scheduler fix: node-cron@4 → croner@10 (beta.10 fix).** Discovered when PMMA's 6 AM Tuesday cron silently didn't fire. Root cause: node-cron@4.2.1 has a day-of-week parsing bug where every weekday EXCEPT Mon and Wed computes next-run as Jan 1 of a year several years out. Tasks on those weekdays silently never fire. All ACOS weekly crons on Sun/Tue/Thu/Fri/Sat have been broken since the v4 upgrade. Swapped to croner@10 (same one-line API, DST-aware, bug-free). Added: persistent `next_run_at` on every `scheduleJob()` call, `persistLastRun()` for the cron-callback path, Telegram heartbeats (🟢 starting / ✅ done / ❌ failed), and a `>8 days out` registration warning. Regression tests in `tests/unit/cron-library-sanity.test.ts` (9 tests against real croner) so a future library swap can't re-introduce this. Suite 1113 → 1146 passing. See commits `69263d8`, `00c33d5`, `877399b`.

3. **Visual verification UI for crons (beta.10).** Added `Next: ... · Last: ... • ✓ ok` health-line under every job in Settings → Scheduled Tasks. Closed the gap that hid the node-cron DOW bug for weeks — before this, no signal anywhere in the UI told you a job had (or hadn't) ever fired. Three states: both columns populated, never-run-yet (italic stub), only-one-populated. Errors shown red with full message in hover tooltip. CSS in `ui/chat/routines-panel.css`. See commit `00c33d5`.

4. **Auto-switch to cron's session on Run-now (beta.10).** Each of the 3 brand crons now has its own named session (`Weekly Content — TSAI / PMMA / Brett`) instead of all sharing the default "New" session. When you click Run-now, the chat UI auto-switches to that cron's session tab so you can watch the routine narrate in real time. Solved Brett's repeated "why don't I see anything happening?" complaint. Sessions migrated in DB (`session-1779195322250-cront/cronp/cronb`); cron `session_id` columns updated to match. One-liner renderer fix in `ui/chat/external-messages.js`.

5. **Brett brand voice rewrite.** First cron-generated Brett post (May 19 'How to Become More Confident') read as a PMMA dojo story instead of an executive peak-performance piece. Root cause was in `brand-profiles`, not ACOS: the prior WRITING_RULES.md framed Brett as 'wise mentor with 30 years of seeing transformation,' too generic. Rewrote to align with Brett's actual positioning per brettlechtenberg.com (Master's Edge methodology, 8th-degree black belt + Flow Research Collective validation, executive audience, speaker-first business goal). New 5 pillars: Flow Mechanics Validated, The Mastery Ladder, First Principles for Leaders, Frontloading & Peak Performance Systems, Transformation Patterns. Topic queue rebuilt with 21 Master's Edge-aligned topics. The off-brand article was removed (BL-2026-Personal-Site PR #3) and replaced with 'Flow State Triggers for Executives: A Reproducible Protocol' (PR #4), now live at brettlechtenberg.com/blog/flow-state-triggers-executives. See `brand-profiles@6afccf4` + `b77b266`.

6. **Brett image rules sharpened.** After Brett's feedback that the May 19 hero was 'fine but could be more fun/eye-catching,' rewrote the image-rules section to push the visual language harder. Photo-realistic is no longer the automatic default — a new topic-fit table tells the agent to lean editorial-illustration (Fast Company / HBR / Monocle / Kinfolk / Economist references, cranberry/gold accent palette) for framework + model + conceptual articles. Photo-realistic guidance now requires bold composition: dramatic single-source light, unusual angles, motion/implied motion, negative space, texture as a feature. New hard AVOID + PREFER lists. Agent must write one sentence in the PR description naming the style choice and why. See `brand-profiles@b77b266`.

**Known bug surfaced today (NOT yet fixed) — the cron-stop bug:**

The Brett cron's third successful run today (the Master's Edge replacement piece) **wrote all the files but never opened the PR.** Files landed correctly in `content/blog/` and `public/blog-images/` as untracked changes on the wrong local branch (the `chore/remove-off-brand-confidence-article` branch which had just been merged + deleted on origin). The agent's `last_status` was `ok` and Telegram heartbeat fired — the cron-callback path reported success — but the agent never executed Step 11's `git checkout -b blog/...` + commit + push + `gh pr create`. I had to finish those manually to ship the article (PR #4).

**Two hypotheses for next session to investigate:**
- (a) The agent ran out of conversation budget (token limit / `maxTurns`) before reaching Step 11 of the prompt. Brett's cron prompt is 7,630 chars and includes 12 steps; an agent that uses many tools per step can exhaust the turn budget. **Fix:** check the prompt's token cost vs. configured `maxTurns` / `maxTokens` and either bump them or restructure the prompt into a shorter happy-path with optional substeps.
- (b) The agent encountered a non-fatal error mid-routine (e.g., the `write_daily_posting_packet` schema mismatch it had to retry, seen in both PMMA and Brett runs today) and silently aborted after the recovery turn instead of continuing to Step 11. **Fix:** add a 'continue from where you left off' instruction at the top of the cron prompt so retry-after-recovery is explicit.

**Triage:** the bug is contained — files survive to disk, Desktop packet still ships, Telegram heartbeat still fires. Only the git-ops step silently no-ops. Manual recovery is `git checkout main && git pull && git checkout -b blog/<slug> && git add <files> && git commit && git push && gh pr create --draft`. ~60 seconds per occurrence. Acceptable for now, real fix in next session.

**Beta.10 release — DONE (May 21):**

- Local `/Applications/AI Chief of Staff.app` is on beta.10 (signed `dist:signed` build, replace via `npm run install:local` if drift suspected).
- Tag `v1.0.0-beta.10` on origin at `bf45b63`.
- GH Release published with 18 assets at https://github.com/BrettLechtenbrerg/ai-chief-of-staff/releases/tag/v1.0.0-beta.10
- Landing page live at https://www.totalsuccessai.com/hidden/ai-chief-of-staff-app showing v1.0.0-beta.10.
- `latest-mac.yml` permanent fix in `scripts/patch-latest-mac-yml.cjs`, wired into `dist:signed` (commit `8036d8d`).

**Carryover follow-ups still open:**
- Cron-stop bug — agent doesn't reach Step 11 (git push) on some long-running brand-content cron runs. Hypothesis: maxTurns budget exhausted OR silent abort after `write_daily_posting_packet` schema-mismatch recovery. Triage: contained, ~60 sec manual recovery, but should be fixed before the brand-content cron volume scales.
- Pin `@kenkaiiii/gg-agent` + `gg-ai` versions to stop the prebuild auto-update footgun (`npm update` in the prebuild script).
- Tray single-click flake on some launches.
- Manny replied: not pursuing Google OAuth verification → next workstream is the **guided self-setup wizard** on top of the beta.9 Connections UI. Each user creates their own Google Cloud project. Options to explore for the wizard UX: pre-fill OAuth client fields, validate as user types, use Google's official MCP servers (`@anthropic-ai/mcp-google-calendar` + `mcp-google-gmail`), or research whether desktop OAuth flow sidesteps verification entirely.

**First action next session:** the guided self-setup wizard for Gmail + Calendar (foundation = beta.9 Connections UI), OR fix the cron-stop bug if the brand-content cron volume needs it more urgently.

---

### Next session — pick up here (added May 19, end of day, superseded by the May 21 entry above)

**Status (as of May 19): beta.10 code on Brett's local Mac but NOT yet shipped.** Superseded — the ship happened on May 21. Original notes preserved below for the May 19 work history.

**What shipped May 19 — release tail:**

- Local `/Applications/AI Chief of Staff.app` was on beta.10 (unsigned `dist:install` build).
- Tag `v1.0.0-beta.10` pushed to origin.
- **As of May 19, NOT yet done:** signed/notarized Mac DMG, Windows installers, GitHub Releases upload, landing page bump. All four landed May 21.

---

### Next session — pick up here (added May 17, late night, superseded by the May 19 entry above)

**Status: waiting on Manny's input before any code starts.**

Tonight (after the beta.7 ship) the conversation turned to the #1 tester request: **make connecting Gmail + Calendar easy.** Today it requires hand-editing `~/Library/Application Support/AI Chief of Staff/mcp-servers.json` — the "ask Brett to walk you through it" problem. The goal: a Settings → Connections tab with one-click "Connect with Google."

Before writing any code, four design decisions need answers. Email drafted and saved to `~/Desktop/email-to-manny-gmail-calendar-connector-decisions.txt` — Brett to send to Manny. When Manny replies, resume by reading that email + his answers, then plan from there.

**The 4 decisions (full reasoning in the email):**

1. **Which Gmail/Calendar MCP server to ship?**
   - A) Bundle Google's official MCP servers (zero server code, narrower features)
   - B) Fork Flo's servers + rebrand (~40 hours, source is APFS-dataless)
   - C) Guided installer wizard (still asks users to install Node)
   - **Brett's recommendation: A.**

2. **Whose Google OAuth client?**
   - (a) TSAI-owned, baked into the app (easy for users, requires Google verification 2–6 weeks)
   - (b) Each user creates their own (current state, ~15 min per user, low adoption)
   - **Brett's recommendation: hybrid — ship (a), submit verification paperwork same week, accept 100-user cap + "unverified app" warning during the verification window.**

3. **Where do OAuth tokens live?** Encrypted in the local settings DB (same pattern as Anthropic OAuth tokens). **Brett's recommendation: yes, agree.**

4. **Just Gmail + Calendar in beta.8, or also Docs + Drive?** Doing all 4 at once is more efficient with Google verification (one round vs two) but adds ~4 engineering days. **Brett's lean: Gmail + Calendar only first.**

   **Bonus Q5**: Brett vs Manny on the Google OAuth verification paperwork (privacy policy URL, demo video, scope justifications).

**Critical-path gate**: Google OAuth verification takes 2–6 weeks. Whoever owns the paperwork (decided in Q5) needs to start it the same week engineering kicks off so the "unverified app" warning clears as testers ramp up.

**Rough plan if Manny green-lights A + hybrid + 3 + 4 (Gmail+Calendar only):**
- ~1 week engineering (TSAI Google Cloud project Day 1; bundle Google MCP servers Day 2; OAuth handler + encrypted tokens Day 3; Connections UI Day 4; auto-write mcp-servers.json + onboarding step Day 5; smoke test + ship beta.8 Day 6).
- Verification runs in parallel.
- Brett wanted to start engineering early next week, which means Google Cloud project needs to stand up by Monday at latest.

**Companion docs created tonight (also on Brett's Desktop):**
- `AI-Chief-of-Staff-Welcome-Guide.txt` — new-user training doc, 15 sections of capabilities + copy-paste prompts.
- `AI-Chief-of-Staff-Capabilities-Comparison.txt` — side-by-side checkbox table showing what works out-of-the-box vs. what needs a connector. 8 of 15 work immediately; 7 need connectors. **Gmail + Calendar are the two highest-value items in the "needs connector" column** — hence this being the next workstream.

**When you resume:** read the email draft for the full reasoning, read Manny's reply, then enter plan mode for the connector work.

---

### Now

- **Multi-brand weekly content cron built (May 18, evening) — now ENABLED.** New private repo `github.com/BrettLechtenbrerg/brand-profiles` holds per-brand voice rules + SEO topic queues for 3 brands (TSAI, PMMA, Brett-personal). Each brand has its own cron in ACOS: TSAI Mon 6am, PMMA Tue 6am, Brett Wed 6am (all system-local time / node-cron default; on this Mac that's MDT). Output lands in `~/Desktop/Daily Postings/{Brand}/` as a paste-ready packet (LinkedIn personal + company, Facebook business, IG, GBP, Medium where active) + hero PNG + IG-square PNG. PMMA dry-run succeeded May 18 — generated 4 platform-perfect posts following brand-book voice. **Status (May 19, 2026 morning): all 3 crons are ENABLED** in the DB (`cron_jobs` rows 179/180/181, `enabled=1`) and registered in the in-memory scheduler (the periodic `checkForNewJobs()` hash-diff loop catches the enable flip without an app restart). PMMA is the first live fire — scheduled for 06:00 MDT Tue May 19. Note: the `next_run_at` DB column is empty for every job because the scheduler doesn't persist it — node-cron just ticks. Empty `next_run_at` is NOT a signal the job is unscheduled. PMMA's WRITING_RULES.md image section was tightened May 18 after the first dry-run produced a technically-correct but boring hero (the brand book calls for celebration + family + motion; the original rules missed that). TSAI + Brett image rules got the same treatment preemptively. See `~/dev/_brand-profiles/README.md` for the full mental model.

- **`v1.0.0-beta.8` shipped (May 18, morning).** Voice input in the chat composer + the test-suite/YAML housekeeping fixes. See the `v1.0.0-beta.8` row in the rollback table for the full breakdown. Mac DMGs signed/notarized/stapled (spctl: `Notarized Developer ID`), Windows installers via Docker, 11 artifacts on GitHub Releases as prerelease, landing page bumped (`TSAI-Site@a0d49ce`), Vercel `--prod` deployed. Local `/Applications/AI Chief of Staff.app` running beta.8 with confirmed mic entitlement + `NSMicrophoneUsageDescription` Info.plist string. **First release that exercises `autoDownload=true`** — existing beta.7 installs should pull this silently on next quit. Brett still needs to nudge beta.5/.6 testers to manually reinstall from the landing page (those versions had `autoDownload=false`). Carried-over follow-ups:
  - **Live mic test still pending.** All bundle-level checks passed (entitlement on the signed binary, Info.plist string present, app launches signed + notarized). But Brett needs to actually click the new mic button, allow the macOS permission prompt, and confirm a real recording transcribes correctly. If the OS prompt never appears, check `Contents/Info.plist` for `NSMicrophoneUsageDescription` (already verified present in beta.8 — was the documented failure mode and it didn't materialize).
  - **`latest-mac.yml` hook footgun.** The new YAML parser is correct (manual repatch against `release/` produced perfect values), but during the build it wrote pre-staple sha512+size despite running after staple. Brett's beta.8 release artifacts on GitHub have CORRECT values because the manual repatch + re-upload happened before `gh release create`. But next release needs a real fix: either run the patcher as a separate npm step after `dist:signed` exits cleanly, or detect inside the hook whether electron-builder will re-emit the YAML after we return and add a guard. See `v1.0.0-beta.8` rollback row for fuller analysis.
  - Tray single-click → chat is still flaky; tracked in task list (id `9f91cdd0`). Deliberately *not* fixed in the May 18 housekeeping pass — no local reproduction available, and a speculative fix is exactly how this kind of flake earns three more "we tried" rows.
  - Apple notarization `AC_PASSWORD` keychain profile worked clean for beta.8 (2 successful notarytool submissions in this build). Monitor; recreate with `xcrun notarytool store-credentials` if it regresses.
  - External MCP server patches (`~/ghl-mcp/main.py`, `~/flo-assistant/servers/*/dist/index.js`) live in Brett's local clones — NOT bundled in the ACOS DMG. Document this in tester README if MCP servers ever ship as part of the install.
  - **`prebuild` script auto-updates `@kenkaiiii/gg-agent` + `@kenkaiiii/gg-ai` on every release build** (`npm run prebuild` runs `npm update` on these two packages). The Windows Docker build log just showed it resolved gg-agent + gg-ai to 4.3.151 even though `package.json` still lists `^4.3.140`. A bad upstream publish would silently ship into a tester DMG. Pin these to fixed versions and move updates to a manual step. Cheap fix, valuable safety.

### Likely next (after testers report back)
- ~~**Voice input in the chat composer (Phase 4)**~~ **SHIPPED in v1.0.0-beta.8** (May 18, 2026). See rollback table for details.
- **Phase 3 — MCP servers Settings UI** — GUI to add/edit/remove entries in `<userData>/mcp-servers.json` from inside the Settings window. Currently testers have to edit JSON by hand, which gates adoption. Reuse the existing Settings pattern (`src/settings/`, `ui/settings.html`). Validate fields client-side (command exists, args is an array, env values are strings), test the connection on save, surface server status (`ready` / `failed` / lastError) inline. Same session: README docs for testers wanting to wire common MCP servers (Google, GitHub, Stripe, etc.).
- **SMS / GHL / Email reminder delivery channels** — the landing page promises these; the app currently delivers via desktop + Telegram. Likely Twilio for SMS, webhook for GHL, SMTP for email. New scheduler delivery channels in `src/scheduler/`.
- ~~**Apple Developer ID code-signing** — DONE May 16, 2026.~~ Enrolled under Brett Lechtenberg (individual), Team ID `2HQTY95NHD`. Cert + key backed up in TSAI-TSBS Master File + 8 TB external as `Brett-DeveloperID-2HQTY95NHD.p12`. Notarization wired via `AC_PASSWORD` keychain profile (`xcrun notarytool store-credentials`). `npm run dist:signed` produces fully signed + notarized + stapled DMGs that pass `spctl --assess` as `source=Notarized Developer ID`. Next build will be cut as `v1.0.0-beta.4` and shipped to testers.
- **Windows code-signing certificate** — eliminates the SmartScreen "More info → Run anyway" step. Standalone EV cert ~$200–500/yr.
- **Logo polish** — current logo is dark navy on transparent, reads faint in the macOS Dock against transparent surfaces. A tighter-cropped or backplate variant would help.
- **Tray icon background** — Brett asked for a more visible tray icon in v1.0.0-beta.1 testing. Currently a black template image (correct macOS UX); a white-fill variant or different glyph is an option.

### Reusable patterns documented elsewhere
- **electron-builder cross-build via Docker** — `electronuserland/builder:wine` image, mount repo + electron caches. Used for `dist:win:local` from a Mac.
- **Mac ad-hoc signing in afterPack.cjs** — fixes the linker-default `Identifier=Electron` / `Info.plist=not bound` bundle that Finder flags with a 🚫 icon. See `build/afterPack.cjs`.
- **Hot-copy installed app for testing** — after `npm run build`, copy specific files into `/Applications/AI Chief of Staff.app/Contents/Resources/app/` to test renderer/IPC changes without re-running the full DMG pipeline. Restart the app to pick them up.

---

## Known quirks (so you don't re-debug them)

### macOS keychain prompts on rebuild (FIXED for signed builds)
**Fixed for signed builds as of v1.0.0-beta.4** — `npm run dist:signed` now uses a stable Developer ID Application signature, so the keychain ACL no longer invalidates between rebuilds.

For *unsigned* `dist:local` builds the old quirk still applies: each rebuild produces a slightly different ad-hoc signature → macOS's keychain ACL invalidates → "AI Chief of Staff wants to access … Safe Storage" prompts appear on next launch. Use `dist:signed` when you want a clean run.

### Auto-updater 406 from GitHub
`electron-updater` polls `/releases/latest` even when there's no published latest release. After v1.0.0-beta.1 went live this stopped firing. If you ever see the 406 again, it means we tagged a new version but didn't publish a Release with assets.

### vitest better-sqlite3 ABI (FIXED May 18, 2026)
The full suite used to show ~205-218 failures from one root cause: `better-sqlite3`'s `.node` binary on disk is built for Electron's bundled Node ABI (correct for `npm run dev` / packaged builds), but vitest runs on system Node v22 — different ABI, dlopen rejects with `NODE_MODULE_VERSION` mismatch (or `slice is not valid mach-o file` if a prior Docker Windows build clobbered the binary with a Windows DLL).

Fix: two complementary check scripts that auto-heal the binary on every entry point:
- `pretest` → `scripts/check-native-for-tests.cjs` — instantiates `new Database(':memory:')` under system Node; if dlopen fails, rebuilds with `npx node-gyp rebuild --release` from `node_modules/better-sqlite3`.
- `preelectron` → `scripts/check-native.cjs` (existing) — same probe under Electron; if dlopen fails, rebuilds with `npx electron-rebuild`.

Both probes now actually instantiate a DB (the JS shim's `require()` is lazy — the `.node` binding only opens on first `new Database(...)`, so checking only `require('better-sqlite3')` slipped past every ABI mismatch). Rebuild is ~28s, only triggered when ABI doesn't match. Developers never have to think about this again. Watch for: if a future change adds another native module, mirror the same probe pattern.

### Canonical DB path on macOS — lowercase slug, not Title Case productName
**Both `npm run dev` AND the packaged macOS app write to `~/Library/Application Support/ai-chief-of-staff/`** (lowercase slug from `package.json` `name`). The previous version of this note said packaged builds use `~/Library/Application Support/AI Chief of Staff/` (Title Case `productName`) — **that was wrong**. Electron's `app.getPath('userData')` derives the folder from `name`, not `productName`, unless `app.setName(...)` is called. We don't.

This caused a real bug on May 17: `src/utils/db-path.ts` `getDbCandidates()` listed only the Title Case path on macOS. `handleListRoutinesTool` worked anyway (it uses the in-process `getScheduler()` which has the DB open), but `handleCreateJob` (and every other tool that calls `getDbPath()` directly + `fs.existsSync()` before opening the DB) failed with "Database not found" because no Title Case folder ever existed. Fix: the lowercase slug path is now FIRST in the candidate list; the Title Case path remains as a fallback in case future Electron versions auto-name from productName.

### `pkill -f "AI Chief of Staff"` is your friend
Mac builds sometimes hang on lingering Electron processes. When the app refuses to relaunch cleanly or `npm run dev` errors with port-in-use messages, `pkill -9 -f "AI Chief of Staff"; sleep 2` clears it.

### Stale `/Applications` copy drift (fixed by `npm run install:local`)
We ship DMGs to GitHub Releases for testers, but the locally-installed `/Applications/AI Chief of Staff.app` was never automatically refreshed when we bumped versions. Result: source tree showed `v1.0.0-beta.3`, but launching from the Dock ran the **original `v1.0.0` build from the very first DMG of the day**, which had the broken `Identifier=Electron` ad-hoc signature — hidden Dock icon + double-click-to-launch + missing every UX upgrade. **Fix:** after every version bump or local build, run `npm run install:local` (or `npm run dist:install` to build + install in one shot). Symptoms to watch for if this regresses: (a) installed app's `CFBundleShortVersionString` doesn't match `package.json`, (b) Dock icon vanishes, (c) double-click required to launch.

---

## Past sessions

### May 18, 2026 (morning) — v1.0.0-beta.8 release (voice input)

Following the test-suite + YAML housekeeping and the voice-input code, cut and shipped beta.8. Why this release now (not later): it bundles three things testers care about (voice input, green test suite, no more hand-patched updater integrity file), AND it's the first build that exercises `autoDownload=true` from beta.7 — existing beta.7 installs should pull it silently on next quit, no clicking. Verifying that flag works as advertised before any bigger feature ship is worth doing alone.

**Build cycle**
- Tagged `v1.0.0-beta.8` (sync-version reads `git describe`, so tag-first is the canonical flow).
- `npm run dist:signed` — both DMGs signed, notarized (2 successful submissions in ~6 min total), stapled. Verified `xcrun stapler validate` accepts both.
- Docker Windows build via `electronuserland/builder:wine` — 5 EXE artifacts + 2 ZIPs. signtool ran inside the container; testers still see SmartScreen once.
- Confirmed bundle-level voice prereqs: `com.apple.security.device.audio-input` entitlement on the signed binary, `NSMicrophoneUsageDescription` string in the installed `Contents/Info.plist`. The documented failure mode (`extendInfo` not applying) did not materialize.
- `gh release create v1.0.0-beta.8 --prerelease` with all 11 artifacts. Notes written to `/tmp/release-notes-v1.0.0-beta.8.md`.
- Landing page: `RELEASE_TAG` bumped to v1.0.0-beta.8 in `TSAI-Site/app/hidden/ai-chief-of-staff-app/page.tsx`, hero copy rewritten for voice. `npm run build` clean, committed (`TSAI-Site@a0d49ce`), pushed, `vercel --prod` deployed.
- `npm run install:local` swapped `/Applications/AI Chief of Staff.app` to beta.8. Version confirmed via `CFBundleShortVersionString`.

**One real footgun caught during the build, NOT yet fixed**: the new `latest-mac.yml` patcher in `build/afterAllArtifactBuild.cjs` ran during the build (the staple flag was true, both DMGs were stapled before the patcher block) but the YAML on disk after the build had pre-staple sha512+size values. Re-running the same patcher logic manually against `release/` after the build completed produced CORRECT values — confirming the parser code is right but something in the electron-builder lifecycle clobbered (or pre-empted) our write. Likely culprits: electron-builder re-emits `latest-mac.yml` after `afterAllArtifactBuild` returns, OR the hook somehow saw stale `artifactPaths` despite running last. The shipped GH Release has CORRECT values because the manual repatch + re-upload happened before `gh release create`. Next release needs a real fix — simplest is to move the patch into a separate npm script (`dist:signed && node scripts/patch-latest-mac-yml.cjs`) that runs strictly after electron-builder fully exits. Tracked in the Now follow-ups list.

**Two yellow flags worth noting**:
- Docker Windows build log surfaced that `npm run prebuild` resolved `@kenkaiiii/gg-agent` and `@kenkaiiii/gg-ai` to 4.3.151 even though `package.json` lists `^4.3.140`. The `prebuild` script (`npm update @kenkaiiii/gg-agent @kenkaiiii/gg-ai`) auto-bumps these on every build. Real risk: a bad upstream publish ships silently into a tester DMG. Already flagged in the May 18 housekeeping notes; promoted to a Now follow-up.
- electron-builder warns `"asar usage is disabled — this is strongly not recommended"`. Inherited from upstream's config (the `asar: false` in package.json). Disabled asar means the entire `dist/` and `node_modules/` ship as raw files, slower cold-start and bigger DMG. Worth a separate session to flip and test.

No new commits to the ACOS repo this session (only the v1.0.0-beta.8 tag) — all the code commits were from the test-suite + YAML + voice-input sessions earlier. RECOVERY.md row added to the rollback table.

### May 18, 2026 (early morning, continued) — voice input shipped

After the test-suite + YAML housekeeping, used the remaining session to land voice input in the chat composer — the Phase 4 item on Likely Next. Single commit (`feat(chat): voice-input mic button in the composer`). New mic button between attach and search in `ui/chat.html`, MediaRecorder state machine in `ui/chat/voice-input.js`, two-channel IPC in `src/main/ipc/audio-ipc.ts` (`audio:isAvailable` for the gate, `audio:transcribe` for the bytes), thin validation layer in front of the existing `transcribeAudio()` Whisper wrapper that Telegram already uses.

Key design choices:
- **Hide-when-not-available**: the mic button starts `hidden` and only un-hides if `audio:isAvailable` says yes (= an OpenAI key is configured). Never let the user record a clip and only then discover they can't transcribe it.
- **State machine with unmistakable visual cues**: idle = mic glyph; recording = stop-square + red tint + pulsing red dot (peripheral-visible "you are live" cue); transcribing = spinner + disabled. Every exit path stops all MediaStream tracks so the macOS mic indicator goes dark immediately.
- **Smart-join transcribed text**: appends to whatever's already in the input box with a single-space separator when needed, fires an `input` event so the existing `autoResizeTextarea()` listener grows the textarea naturally.
- **safeIpc wrapping**: piggybacks on the project's existing stale-install pattern so testers on older builds get a friendly "reinstall to use this" toast instead of an unhandled rejection.
- **macOS hardened-runtime gates**: BOTH the entitlement (`com.apple.security.device.audio-input` in `build/entitlements.mac.plist`) AND the Info.plist usage-description string (`NSMicrophoneUsageDescription` in `package.json` -> `build.mac.extendInfo`). Without the description string, the OS prompt is suppressed and the request auto-denies. Re-notarize required next build because the entitlement set changed.

13 new unit tests in `tests/unit/audio-ipc.test.ts` cover the IPC validation surface (missing payload, empty audio, 25 MB cap, format allow-list with case normalization, language passthrough, error forwarding, Uint8Array → Buffer conversion). Full suite: 1086 passing (was 1073). typecheck + lint clean.

**Not verified end-to-end** from a live microphone — this session was code-only. Renderer changes can be hot-copied into `/Applications/AI Chief of Staff.app/Contents/Resources/app/ui/`, but main-process changes (the new IPC channels) need a full `npm run dist:signed` + reinstall, AND the new entitlement/Info.plist values only take effect after a fresh signed build. Next ship cycle gets that verification.

**Caveat for next session**: if voice transcription comes back garbled or the mic prompt never appears, the most likely culprit is the Info.plist string. Check `Contents/Info.plist` in the installed app for `NSMicrophoneUsageDescription` after the next `dist:signed` run. If absent, `extendInfo` didn't apply (electron-builder version pinning or a config-shape regression). Easiest fix: a manual `plutil` patch in `build/afterPack.cjs` (existing hook), modeled on the bundle-identifier-rewriting pattern that's already there.

### May 18, 2026 (early morning) — test-suite housekeeping while waiting on Manny

Used the gap before Manny's reply on the Gmail/Calendar connector decisions to close two long-standing follow-ups blocking every future release.

1. **`v1.0.0-beta.7` test suite: 218 failing → 0 failing** (commit `6a96f10`). The carried-over failures were ALL one root cause, not a slow accumulation of broken tests. The `.node` binary on disk had ABI 145 (Electron's bundled Node), vitest runs on system Node ABI 127, every test that touched `better-sqlite3` failed with `NODE_MODULE_VERSION` mismatch (or in one degenerate case `slice is not valid mach-o file` because a prior Docker Windows build had clobbered the binary with a Windows ARM64 DLL). Fix: new `scripts/check-native-for-tests.cjs` runs as `pretest` and mirrors the existing `scripts/check-native.cjs` (which already runs as `preelectron`). Each probe instantiates `new Database(':memory:')` under its target runtime; if dlopen fails, it rebuilds for that runtime. The two hooks auto-heal each other in both directions — `npm test` makes the binary ABI 127, the next `npm run dev` makes it ABI 145, ~28s rebuild only when needed. Discovered both check scripts had a latent bug: they only called `require('better-sqlite3')`, which loads the lazy JS shim, NOT the binding. Both now actually instantiate a DB. Also fixed 13 stale test assertions that the rebuild surfaced: `db-path.test.ts` (lowercase slug is now `candidates[0]`, list grew from 3 to 4), `agent-modes.test.ts` (fallback is `general`, not `coder` — changed in v0.3), `telegram.test.ts` (mock memory needed `ensureSessionForChat` added in beta.6). Final: 1073/1073 passing, lint + typecheck clean. RECOVERY.md's prior "vitest 205 failures from better-sqlite3 ABI" Known Quirk has been updated to reflect the fix.

2. **`latest-mac.yml` post-staple patcher** (commit `cb16704`). Hand-patched 3 releases in a row per `RECOVERY.md`. Replaced the brittle regex with `js-yaml` parse → mutate the `files:[]` entries AND the top-level `path:` + `sha512:` block → re-serialize. The top-level block was a latent bug — the regex never touched it, but electron-builder picks the `.zip` as the primary download on macOS so it didn't blow up in practice. Verified against the existing `release/latest-mac.yml` fixture: both DMG entries patch cleanly, the top-level `path: ...arm64-mac.zip` is correctly left alone. Robust against future filename characters (parens/brackets) and CRLF/indentation drift.

**Deliberately skipped:** the tray single-click flake (task id `9f91cdd0`). No local reproduction, no clear root cause. Tabby (71k stars) wraps their tray click handler in `setTimeout(() => focus())` as a known Electron race workaround, but applying it speculatively without a repro is exactly how `latest-mac.yml` earned three "flaky" rows in the rollback table. Leave it for when there's a deterministic repro or a fresh tester complaint.

**Two yellow flags noticed but not actioned:**
- `package.json` `prebuild` script does `npm update @kenkaiiii/gg-agent @kenkaiiii/gg-ai` on every release build. Auto-bumping upstream deps mid-release pipeline is a regression vector — a bad upstream publish could ship into a tester DMG. Worth pinning these to fixed versions or moving the update to a manual step.
- Two binaries had a circular dependency on each other's ABI assumptions — both check scripts had the same lazy-load bug. Pattern: when probing a native module, always exercise the binding, not just the loader.

No version bump, no release, no landing-page changes. Pure housekeeping. Next session can pick up either Manny's reply or the Voice/MCP-UI workstreams without test-suite noise hiding new regressions.

### May 17, 2026 (late night, after beta.7) — new-user docs + connector decision email to Manny

Following the beta.7 ship, Brett asked two things:

1. **Convert the personal testing manual into a new-user training doc.** The original (`~/Desktop/AI-Chief-of-Staff-Test-Guide.txt`, dated 2026-05-16, for beta.5) was full of Brett-specific references (Sandy Utah, his GHL location IDs, his Flo token paths, his TSAI brand book). Rewrote as `~/Desktop/AI-Chief-of-Staff-Welcome-Guide.txt` (24 KB, 666 lines) — same 15 sections + power-user compound tests, but reframed as a capabilities tour. Every personal reference replaced with `[your city]`/`[contact name]`/`[yourdomain.com]` placeholders. Every section opens with **WHAT THIS SHOWS** + an explicit **WORKS OUT OF THE BOX** or **NEEDS [connector]** label so users know what to expect before pasting a prompt. Added new front-matter sections: **HOW TO USE THIS GUIDE** and **WHAT'S CONNECTED OUT OF THE BOX / WHAT REQUIRES A SETUP STEP** (directly addressing the discovery gap). Bumped framing to v1.0.0-beta.7 and added the auto-update note at the end.

2. **Side-by-side comparison of out-of-the-box vs. with-connectors capabilities.** Brett wanted a checkbox-style "membership levels" visual. Built as `~/Desktop/AI-Chief-of-Staff-Capabilities-Comparison.txt` (18 KB, 353 lines). Same 15 sections; each gets a two-column layout. Left column = OUT OF THE BOX with `[✓]` for working capabilities; right column = WITH [CONNECTOR] showing what unlocks. Sections fully local (Memory, Knowledge Base, About You, File System) explicitly show `[—] No additional capability unlocked` on the right so users don't think they're missing something. Quick Summary table at the top scores all 15: **8 of 15 work out of the box, 7 unlock with connectors.** Bottom of doc explains how to check what's connected (`What tools do you currently have access to?` in chat) and how to add a connector (the JSON file path + "ask Brett until the UI ships").

**The discovery gap surfaced clearly**: I grepped the entire `ui/` tree and confirmed **there is zero UI** anywhere in the app for MCP servers, connected tools, or available integrations. The only signal that no external connectors are wired is a single log line on app boot (`[MCP Config] No mcp-servers.json at …`) that users never see. "Phase 3 — MCP Servers Settings UI" is in the Likely Next workstream below but hasn't been planned in detail.

3. **Brett raised the next priority**: Gmail + Calendar one-click connection. Discussed the architecture (Flo's servers are excellent but Brett-bound: hardcoded `brettlechtenberg.com` in SafetyChecker, `~/.flo/tokens.json` path, Flo OAuth client_id, source files APFS-dataless). Surfaced **four design decisions** with full reasoning rather than jumping straight to a plan. See "Next session — pick up here" at the top of Active workstreams for the questions + Brett's recommendations.

4. **Drafted email to Manny** at `~/Desktop/email-to-manny-gmail-calendar-connector-decisions.txt` (12 KB) walking him through all 4 decisions, Brett's recommended path (A + hybrid + 3 + Gmail+Calendar-only), the 7-day engineering timeline, and the Google OAuth verification critical path. Brett's bonus question: who fills out the verification paperwork — Brett or Manny.

**Saved on Brett's Desktop tonight**:
- `AI-Chief-of-Staff-Welcome-Guide.txt` (new-user training)
- `AI-Chief-of-Staff-Capabilities-Comparison.txt` (out-of-box vs connectors)
- `email-to-manny-gmail-calendar-connector-decisions.txt` (decision memo)

**Original testing manual preserved** at `~/Desktop/AI-Chief-of-Staff-Test-Guide.txt` and `.md` — unchanged.

**End state**: Both repos clean and pushed. Brett shut down for the night. Next session blocked on Manny's reply.

### May 17, 2026 (late night) — v1.0.0-beta.7 release (tester regressions pass)

Five tester reports against beta.6 came in. Plan: `.gg/plans/acos-tester-regressions-pass.md` (31 steps). Cut and shipped `v1.0.0-beta.7` in one session.

**What's in the release (5 tester fixes + 1 behaviour change):**

1. **TSAI colors not loading (Issue #1).** Two-part root cause: `settings:getSkin` fell back to the string `'default'` which has no entry in `THEMES`, so the renderer's theme-loader did `themes['default'] → undefined` and applied no palette — the page kept the raw Dracula CSS variables. Older installs also persisted `ui.skin = ''` or `'default'` in the SQLite settings table (an artifact of an earlier schema default), and `loadDefaults()` uses `INSERT OR IGNORE` so stale rows survived the schema bump to `defaultValue: 'tsai'`.
   - Fix A: `src/main/ipc/settings-ipc.ts:110` — fallback flipped from `'default'` to `'tsai'`.
   - Fix B: `src/settings/index.ts` — new `migrateSkinToTsai()` runs after `loadDefaults()`. Promotes any stored value NOT in `THEMES` to `'tsai'`. Explicit user choices (dracula, nord, etc.) preserved. Idempotent.

2 + 3. **"No handler registered" on Create Task and Sign In (Issues #2, #3).** Confirmed via grep that every `cron:*` and `auth:*`/`openai:*OAuth` channel the renderer calls is registered in main. These were stale-install symptoms — testers had a newer renderer hot-copied over an older main-process build, so newly-added channels (like `cron:update` introduced in `v0.6-tooling-and-fixes`) hit "No handler registered". We can't retroactively fix old installs, but new builds catch the specific Electron error pattern and show a friendly toast.
   - Fix: new `ui/shared/ipc-error-handler.js` exposes `window.safeIpc(name, fn)`. On `"No handler registered"` rejection it shows a Notyf error saying "Your install is out of date. Please re-download from totalsuccessai.com/hidden/ai-chief-of-staff-app." Other rejections pass through. Loaded in `ui/chat.html` and `ui/cron.html` next to `theme-loader.js`. Wired at 8 critical call sites in `onboarding.js`, `settings-panel.js`, `routines-panel.js`, `cron.html`: `cron.create/update/delete`, `auth.startOAuth/completeOAuth`, `openaiAuth.startOAuth`, `browser.launch/detectInstalled`. `global-chat.js` and `cron.html` register their Notyf instance via `window.__acosRegisterToast(...)` so the toast uses the page's styling.

4. **Skins picker blank tile (Issue #4).** `_STG_SKIN_PREVIEWS` in `ui/chat/settings-panel.js` had no `tsai` entry. When `_stgRenderSkinGrid` iterated `_stgThemesCache` (which includes `tsai`), the TSAI tile fell through to `_STG_SKIN_PREVIEWS.default` — also undefined — and the `style="background:undefined"` painted transparent. Same for the description.
   - Fix: added `tsai: 'Navy + silver brand theme'` to `_STG_SKIN_DESCRIPTIONS`, `tsai: ['#0A1F44', '#0F2A5C', '#C0C0C0', '#E8E8E8', '#FFFFFF']` to `_STG_SKIN_PREVIEWS`, plus a `default` safety-net so future unknown skins render TSAI navy swatches instead of blank.

5. **Browser Magic "didn't work" (Issue #5).** Most plausible cause: testers toggled "Use My Browser" ON without launching Chrome with `--remote-debugging-port=9222`, so CDP failed. The auto-fallback in `BrowserManager.execute` only fires when CDP was implicitly chosen (`!isExplicit`); with `useMyBrowser=true` it counts as explicit and the agent fails hard. Three changes:
   - `src/browser/index.ts` `selectTier()`: when `useMyBrowser=true` AND the CDP tier has never connected, log a warning and return `'electron'` instead of forcing CDP. Agent stays functional with bad config.
   - `ui/chat/settings-panel.js` `_stgInitializeBrowserSection`: after the initial `stgTestBrowserConnection`, if `useMyBrowser='true'` and the test failed, swap the red "Not connected" status for a yellow hint: "CDP not active — click Launch Browser to enable, or toggle Use My Browser off to use the built-in browser."
   - `ui/chat/settings-panel.js` `stgLaunchBrowserWithCdp`: replaced the terse `result.alreadyRunning` toast with a platform-aware message (Cmd+Q on macOS, "close every Chrome window" on Windows/Linux).

6. **Behaviour change: autoUpdater silent download.** `src/main/updater.ts` had `autoUpdater.autoDownload = false`. Every beta from .1 to .6 detected new versions but never auto-pulled — testers had to click Download + Install. Most never did, which is why bug-fix builds didn't reach the field. Flipped to `true`; paired with the existing `autoInstallOnAppQuit = true` it gives a silent "installed on next quit" flow. **The fix matters most from beta.8 onward** — current beta.5/.6 installs need one manual reinstall to pick up beta.7, then they're on the silent train.

**Engineering process:**
- 7 logical commits (skin fallback, skin migration, skin picker preview, ipc-error-handler bundle, browser fallback + UX, autoupdate flip, release version bump).
- Used `git add -p` to split the 10-hunk `ui/chat/settings-panel.js` diff across three commits cleanly (skin picker + ipc wraps + browser UX each got their own).
- Typecheck + lint clean.
- Unit tests: 854 passing, 218 failing. Diffing the pre-change baseline showed exactly +2 new failures (the updater test asserting `autoDownload = false` and the browser test asserting `useMyBrowser=true → CDP`) — both expected behaviour changes. Updated both tests to match the new behaviour and added a new CDP-when-connected case to the browser test. Net: zero new regressions from this release.

**Build + ship:**
- `npm run dist:signed` — ~17 minutes end-to-end. Both DMGs notarized + stapled, spctl assess returned `accepted, source=Notarized Developer ID`.
- `latest-mac.yml` post-staple regex bug still broken — hand-patched both DMG entries with correct sha512+size (3rd release in a row needing this; still open follow-up).
- `npm run install:local`; `defaults read` confirms `1.0.0-beta.7`. Grepped the packaged build to verify every fix is present in `dist/` and `ui/`.
- Docker `dist:win:local` — ~6 minutes, 5 Windows artifacts (3 setup exes + 2 win.zips) + non-empty `latest.yml`.
- `gh release create v1.0.0-beta.7 --prerelease` with all 11 assets in one shot. Verified: prerelease=true, draft=false, 11 assets, DMG URL returns 302.

**Landing page bump.** `TSAI-Site/app/hidden/ai-chief-of-staff-app/page.tsx` — `RELEASE_TAG`/`RELEASE_VERSION` → v1.0.0-beta.7, header comment rewritten to lead with the 5 tester fixes + auto-update flip, hero subtitle rewrote covering each of the 5 fixes plus the silent-install change. `npm run build` clean, committed (`TSAI-Site@f2497a1`), pushed, `vercel --prod`. Verified live: both `totalsuccessai.com` and `tsai-site.vercel.app` return the v1.0.0-beta.7 string.

**RECOVERY.md sweep.** Corrected the wrong "Auto-updater on beta.X installs pulls this silently" claims in the beta.5/.6 rows of the rollback table — those releases all had `autoDownload=false`. New beta.7 row notes the behaviour change explicitly so future Brett-or-Claude reading this doesn't repeat the mistake.

**Unverified — needs Brett's eyes on the installed app:**
- TSAI palette renders correctly on a beta.5/.6 → beta.7 upgrade (the migration code is in the packaged build; haven't actually launched the chat window to see).
- Skins picker tile renders the navy/silver swatches.
- Create Task end-to-end works.
- "Sign in with Claude" opens the browser cleanly.
- Toggling Use My Browser without CDP shows the yellow hint.
I verified the code is present in the packaged `Resources/app/` and that the app process is alive, but visual confirmation of these 5 user-facing flows needs a human.

**End state.** All 5 tester regressions fixed in code and shipped. Auto-update gap closed for future releases. Local install on beta.7. **Next out-of-repo action**: Brett to DM/email current testers asking for a one-time reinstall — without that, they'll stay on beta.5/.6 indefinitely because their `autoDownload` is still false.

### May 17, 2026 (night) — v1.0.0-beta.6 release (test-pass hardening)

Closing session for the day. Cut and shipped `v1.0.0-beta.6` rolling up everything since beta.5. Plan: `.gg/plans/acos-v1.0.0-beta.6-release.md` (15 steps).

**What's in the release (13 fixes):**
1. Telegram first-message FK-crash — sessions auto-create as `Telegram (chat <id>)` (commit `66ad4ee`).
2. DB path canonical lowercase-slug fix — unblocked `create_routine`/`create_reminder`/project tools (`v0.8-bookmarks-and-db-path`).
3. Tool Discipline Rule 7 — verify file-system side effects before claiming success (Desktop screenshot incident, commit `26427f4`).
4. Tool Discipline Rule 6 tightened — don't even raise unverified bug-claims, tentative phrasing not exempt (commit `3fd4cad`, today's GHL test pass).
5. Tool Discipline Rule 6 original — verify before saving claimed-bug facts (commit `ffeeb2c`, `v0.9-anti-hallucination-and-docs`).
6. Tool Discipline Rules 1–5 — no curl bypass, no credential-file reads (`v0.6-tooling-and-fixes`).
7. Tray click UX + tooltips + edit-task button + navy-on-silver button text (`v0.6-tooling-and-fixes`).
8. GHL `skip → page` across 10 endpoints (`v0.6-tooling-and-fixes`).
9. Flo calendar recurring execute branch + timezone fallback (`v0.6-tooling-and-fixes`).
10. Flo docs `drive_search` + `drive_list_folder` discovery tools (`v0.7-flo-discovery`).
11. Flo bookmarks Chrome-running guard + WebKit microsecond timestamp fix (`v0.8-bookmarks-and-db-path`).
12. GHL `search_contacts` tag filter via `POST /contacts/search` advanced filters (today's GHL test pass).
13. GHL `get_appointments` proper schema — drops `limit`/`page`/`offset`/`contactId`, requires `start_time`+`end_time`+(`calendar_id`|`user_id`|`group_id`) (today's GHL test pass).

Plus the customer-facing SEO pillar article at `totalsuccessai.com/ai-for-small-business-marketing` shipped earlier this evening (`v0.10-seo-article-shipped`) — already live, separate from this beta cut.

**Build pipeline ran clean:**
- Pre-flight: working tree clean, `AC_PASSWORD` profile had submission history (confirmed working), Developer ID cert in keychain, Docker Desktop launched.
- Tag `v1.0.0-beta.6` pushed; `prebuild` hook (`npm run sync-version`) read the tag and bumped `package.json` automatically.
- `npm run dist:signed` produced both arm64 + x64 DMGs, notarized + stapled. Both DMGs `xcrun stapler validate` clean, `spctl --assess --type install` returns `accepted` + `source=Notarized Developer ID`.
- `latest-mac.yml` had stale pre-staple sha512+size (known beta.5 regex bug in `build/afterAllArtifactBuild.cjs`). Hand-patched with the post-staple values. Both lines now verify. **Still open follow-up.**
- `npm run install:local` installed beta.6 over `/Applications/AI Chief of Staff.app`. `defaults read .../CFBundleShortVersionString` confirms `1.0.0-beta.6`.
- Docker Windows build via `electronuserland/builder:wine` produced all 5 Windows artifacts + non-empty `latest.yml` in one pass.
- `gh release create v1.0.0-beta.6 --prerelease` uploaded all 11 assets in a single shot (no recovery needed). Verified: prerelease=true, draft=false, 11 assets, DMG download URL returns 302.

**Landing page bump.** `TSAI-Site/app/hidden/ai-chief-of-staff-app/page.tsx` — `RELEASE_TAG` → `v1.0.0-beta.6`, `RELEASE_VERSION` → `1.0.0-beta.6`, header comment updated to "test-pass hardening" theme, hero subtitle rewrote to lead with the Telegram crash fix + agent file-save verification + GHL discovery-call queries working end-to-end. `npm run build` clean, committed (`TSAI-Site@33a3f3b`), pushed, `vercel --prod`. Verified live: `curl -sL totalsuccessai.com/hidden/ai-chief-of-staff-app | grep v1.0.0-beta.6` returns 1 hit (`totalsuccessai.com` 301s to `www.` — follow the redirect or query `www` directly).

**Recap of today's GHL test pass (the trigger for fixes 4 + 12 + 13).** Brett pasted a sales-prep prompt: "clients tagged 'lead' or 'consultation needed', last week's outbound conversations, this week's discovery calls." Three real bugs surfaced. (a) `search_contacts(tag="lead")` returned `"tags property should not exist on body"` — GHL's deprecated `GET /contacts/?tags[]=` endpoint returns 422. Fixed by routing tag-filter searches through `POST /contacts/search` with the advanced-filters body shape. (b) `get_appointments(limit=50, page=1)` returned `"calendarId/userId/groupId is required"` — the agent had been calling the old schema. Fixed by dropping `limit`/`page`/`offset`/`contactId` from the tool, requiring `start_time`+`end_time`+(`calendar_id`|`user_id`|`group_id`). (c) Agent claimed it had "saved the analysis to your Desktop" — no file was created. Fixed via new Tool Discipline Rule 7 (verify file-system side effects before claiming success). All three fixes are in this release.

**Source backups refreshed** to all 3 documented locations (local `_backups/`, iCloud, 8 TB external drive) tagged `ai-chief-of-staff-source-<DATE>-v1.0.0-beta.6.zip`.

**End state.** Beta.6 is the public release. Local install, landing page, GitHub Releases, and backups all aligned. Carried-over follow-ups (tray flake, `latest-mac.yml` regex, `AC_PASSWORD` profile health) tracked in Active workstreams "Now." Likely-next queue unchanged: voice input (Phase 4), MCP Settings UI (Phase 3), SMS/email/GHL reminder delivery channels.

### May 17, 2026 (evening) — SEO research → deployed pillar article (first end-to-end value loop)

Fifth and final test burst of the day. Brett pasted a 3-task DataForSEO test prompt (keyword rankings, backlink comparison, PAA research). All 3 failed initially on 401 unauthorized.

**The DataForSEO credentials trap (worth documenting for future testers).** The original config in `mcp-servers.json` had Brett's dashboard login as `DATAFORSEO_USERNAME` and what looked like a password as `DATAFORSEO_PASSWORD`, but DataForSEO uses **separate API credentials** distinct from the dashboard login. The API password is provided in a welcome email at signup AND retrievable from the dashboard under "API Access" — a 16-char hex string, not the user's chosen password. Verified the new creds live with `curl -u user:pass https://api.dataforseo.com/v3/appendix/user_data` returning `status_code: 20000 'Ok'` + the actual account balance.

**Backlinks API gotcha.** When Brett tried to activate the Backlinks API I initially told him "click Gain Access, ~$0.02/call." I was wrong — the screen revealed Backlinks requires a $100/mo minimum subscription. Corrected myself, recommended the 14-day trial instead (no subscription required, time-boxed), which Brett activated. Verified live with a real `POST /v3/backlinks/summary/live` call against totalsuccessai.com: returned 42 backlinks from 34 referring domains, $0.02 cost. Trial expires May 31, 2026.

**After the fixes, all 3 tasks ran clean:**

- Task 1 (keyword rankings): TSAI ranks for only 2 keywords site-wide, both branded ("total success" + "total success solutions"). Zero non-branded SEO presence. Agent reframed it correctly: "this is a wide-open opportunity, not a problem."
- Task 2 (backlink comparison vs coach.com): the agent ran the analysis and then correctly flagged the methodological error — coach.com is the handbag brand, not a coaching business. The 4 overlapping domains were spam directories (pagesearch.net, urls-shortener.eu, australianwebdirectory.shop, agmermer.pro — spam scores 50-70). Surface finding: those 4 should be disavowed in Search Console. Agent offered 4 alternative competitors for a real gap analysis (Coachvox, Zapier, Make, GoHighLevel) but Brett deferred the re-run to next session.
- Task 3 (PAA research): pulled the literal "People Also Ask" questions from the live Google SERP for "ai for small business" + cross-referenced 7 keyword variations with volumes. Surfaced the killer opportunity: **"ai for small business marketing" — 140/mo, KD 8, $36 CPC, LOW competition.** Verified the numbers live against `dataforseo_labs/google/keyword_overview/live` (cost $0.01) — exact match.

**Then we shipped it.** Brett asked to actually publish a pillar article targeting the killer keyword "right now." Built:

1. **Full SEO brief** saved to `docs/tester-feedback/2026-05-17-seo-content-brief-ai-for-small-business-marketing.md` — keyword/volume/KD targets, parent topic, 10 PAA questions, recommended structure with H1/H2 outline, internal-link plan, on-page SEO checklist, expected ranking timeline.

2. **Live published article** at `app/ai-for-small-business-marketing/page.tsx` in TSAI-Site. 1,800+ words, written in TSAI brand voice (warm + practical, transformation over features, plain language, honest about limitations). Includes: hero with 10-min read time, intro section, 5 highest-ROI AI marketing plays card grid, honest tool comparison table (captures the 210/mo "best AI for small business" sub-search), "why 85% of AI projects fail" section answering PAA #3, free assessment CTA bridge, FAQ section answering all 10 PAA questions, FAQPage + Article schema.org JSON-LD for rich-result eligibility, author bio with Brett's photo (E-E-A-T signal), 5 internal links to /services /assessment /ai-chief-of-staff /free-resources /about, final consultation CTA to speaktobrett.com.

3. **Sitemap entry** added with priority 0.85 + monthly change frequency. robots: index/follow.

4. **Build verified** — `next build` produced the page as a pre-rendered static route (`○ /ai-for-small-business-marketing`), no errors, no warnings.

5. **Shipped** — `TSAI-Site@dfb08f5` pushed to `BrettLechtenbrerg/TSAI-Site` main. Vercel auto-deploys. Live URL: `https://totalsuccessai.com/ai-for-small-business-marketing`. Expected timeline: page-3-5 rankings within month 1-2, top-3 within 6 months given KD 8.

**Logged two follow-up tasks** before closing the session: re-run task 2 against a real competitor (id `e11e1a4c`, time-boxed by May 31 trial expiry); disavow the 4 spam backlinks in Search Console (id `36c35fad`).

**Why this session matters more than the others.** First time today the agent took something from research → plan → deployed live customer-facing asset in one session. Every other session this week was infra correctness work (which is necessary but invisible to clients). This session produced a real SEO asset that will, over the next 3-6 months, generate organic traffic Brett didn't have before. **That's the chief-of-staff product narrative made concrete** — the agent doesn't just help you think, it ships work. Tagged `v0.10-seo-article-shipped`.

### May 17, 2026 (late afternoon) — Anti-hallucination Rule 6 + first tester-feedback doc

Fourth testing burst of the day. Started as a 3-task batch prompt (scrape + critique landing page, web-search for competitors, extract structured data from a placeholder URL). Agent recognized the `[URL]` literal placeholder and handled it correctly (asked for the real URL instead of inventing one + completed the other two tasks). Tasks 1 and 2 produced **outstanding** output — the landing-page critique was an 8-section near-publishable rewrite brief grounded in the TSAI Brand Book's "lead with transformation" rule, and the competitor scan correctly identified Coachvox as the only real "solo-coach AI agent" player (with the rest being enterprise/HR coaching or generic tool roundups).

**But the agent also hallucinated a 9th observation:** it claimed the GitHub download URLs on the landing page had a typo (`BrettLechtenbrerg` "should be" `BrettLechtenberg`) and saved that as a fact in long-term memory with the note "Breaks downloads." Verified live with `curl -sI`: `BrettLechtenbrerg` is Brett's actual GitHub username, returns 200. The "corrected" version returns 404. The agent had pattern-matched a real-looking misspelling against an accurate-but-unusual proper noun and fabricated a critical bug. Then persisted it as established truth.

This is a particularly toxic failure mode — the `facts` table is loaded into the system prompt on every turn, so a false bug-fact ships as authoritative context to every future conversation. Could have ended with Brett unnecessarily rewriting working landing-page URLs based on the agent's persistent confident claim.

Fixes:

1. **Removed the bad fact directly from the DB** (`DELETE FROM facts WHERE id = 19`). The FTS trigger auto-cleaned the index.

2. **Added Tool Discipline Rule 6** to `src/config/system-guidelines.ts`: *"Verify before saving a claimed-bug fact to memory."* Specifically calls out unusual proper nouns as treacherous, mandates HEAD-request / fetch / file-read verification before persisting any "X is broken" claim, and includes a worked example using the exact failure pattern (the `SmythLastname` vs `SmithLastname` analogy). Compiled, hot-copied into the running install.

3. **Created `docs/tester-feedback/` folder** with `2026-05-17-landing-page-coaching-buyer-critique.md` — the 8 valid observations + the one-line top-of-page rewrite + the Coachvox market-scan finding. This is the first formal precedent for capturing actionable agent output in-repo so it doesn't vanish when chat history scrolls. Doc ends with a status footer noting the false-fact incident so future Brett-or-Claude doesn't act on the (now-deleted) GitHub typo claim if it somehow resurfaces. Pattern worth repeating any time a test prompt produces something Brett would otherwise lose: save to `docs/tester-feedback/YYYY-MM-DD-<topic>.md`.

**Verified Rule 6 activation requires ACOS relaunch.** System guidelines load at app boot via `chat-engine.ts buildSystemPrompt()` static parts. The currently running session is still using the pre-Rule-6 prompt — a relaunch is needed for the new rule to bind on the next turn.

No MCP server patches this round. No `package.json` version bump. Tagged `v0.9-anti-hallucination-and-docs`.

### May 17, 2026 (afternoon) — Bookmarks correctness + DB-path canonical fix

Third testing burst. Two real bugs, both correctness-affecting (not cosmetic):

**Bug 1: Flo bookmarks silent-overwrite.** Brett asked the agent to create "Beta Tester Feedback 2026" and move it between Gift Con and Community on the bookmarks bar. Agent reported success on both operations. The folder existed but at position 34 (end), not 11. Investigation revealed the Flo bookmarks MCP server (`~/flo-assistant/servers/bookmarks/dist/index.js`) writes the JSON file directly to `~/Library/Application Support/Google/Chrome/Default/Bookmarks` — but Chrome holds that file in memory and autosaves it back from in-memory state every few minutes, on tab change, and on quit. **Writing the file while Chrome is running silently succeeds, then gets clobbered on Chrome's next save.** The agent had no way to know the write was reverted. Two fixes: (a) Added `isChromeRunning()` (uses `pgrep -x 'Google Chrome'` on macOS, `tasklist /FI "IMAGENAME eq chrome.exe"` on Windows, `pgrep -f chrome` on Linux) that runs before every `saveBookmarks()` call and throws with `Chrome is currently running. Bookmark changes would be silently overwritten by Chrome on its next autosave. Please fully quit Chrome (Cmd+Q on macOS, ensuring no windows remain) and try again.` (b) Found a second bug while there: `date_added` was being written as `Date.now().toString()` (Unix milliseconds) but Chrome stores `date_added` as microseconds since the WebKit epoch (1601-01-01 UTC, ~17 digit numbers). Fixed via a `webkitTimestampNow()` helper that adds the 11644473600000 ms offset and multiplies by 1000. Manually repaired the orphaned Beta Tester Feedback 2026 folder via a one-shot Python script that popped it from position 34, fixed its timestamp from `1779043087260` (13-digit Unix-ms) to `13423517536674000` (17-digit WebKit), and inserted it at position 11 between Gift Con and Community. Verified end-to-end: bookmark write attempted while Chrome running fails clean with the new error; Brett quit Chrome, agent retried, write succeeded, Brett reopened Chrome and saw the bookmark in the right place. Agent's failure-handling throughout was textbook Tool Discipline — passed the guard error through verbatim, asked for the Chrome-quit, retried cleanly.

**Bug 2: DB path canonical mismatch — `create_routine` always failed.** Brett asked the agent to schedule a daily morning briefing routine. Agent retried 3 times in a row, got "Database not found" each time, gracefully reported the bug, saved the 4 queued routine specs in memory, and asked for an ACOS restart. Investigation: `src/tools/scheduler-tools.ts` `handleCreateJob` opens the DB by file path via `fs.existsSync(getDbPath())` + `new Database(dbPath)`. `getDbPath()` walked candidate paths and returned the first that exists, falling back to candidate[0] when none did. The candidate list had `~/Library/Application Support/AI Chief of Staff/ai-chief-of-staff.db` (Title Case, derived from `productName`) as candidate[0] on macOS. **But the actual DB file lives at `~/Library/Application Support/ai-chief-of-staff/ai-chief-of-staff.db`** (lowercase slug, derived from `name`). Both dev (`npm run dev`) AND the packaged app write there, because Electron's `app.getPath('userData')` uses `package.json` `name` (not `productName`) unless `app.setName(...)` is called — which we don't. So every `fs.existsSync()` check returned false, `getDbPath()` returned the missing Title Case path, and `handleCreateJob` bailed with "Database not found." `handleListRoutinesTool` never hit this code path — it uses the in-process `getScheduler()` singleton which already has the DB open from app boot, so it always worked. That mismatch between list-works / create-fails on the SAME DB was the diagnostic clue. Fix: flipped the candidate order in `src/utils/db-path.ts` so the lowercase-slug path is checked FIRST; the Title Case path remains as a fallback for hypothetical future Electron behavior changes. One change fixed `create_routine`, `create_reminder`, project-tools.ts "workspace not found", and project-server.ts "Database not found" — all four call sites use the same `getDbPath()`. **Verified live:** after rebuild + hot-copy of `dist/utils/db-path.js` + ACOS relaunch, Brett retried the scheduling prompts and routine creation succeeded. Also fixed the wrong Known Quirks note in RECOVERY.md that documented the (incorrect) dev-vs-packaged path split.

**End state.** Two critical correctness bugs killed in one session. Bookmarks no longer lie about successful writes. Routine/reminder/project tool DB access works from a packaged install. Eleven cumulative changes against 1.0.0-beta.5 across the day's three sessions, no version bump yet. Next public release should be v1.0.0-beta.6 once the open tray-click flake is resolved.

### May 17, 2026 (late morning) — Flo docs discovery tools + GHL Smith/SMS/notes test pass

Follow-on testing after the morning bug-fix burst. Two test rounds:

**Round A: GHL contact operations (5 prompts, 5-for-5).** Searched for any contact named Smith — returned 5 hits across both GHL locations (1 in Brett's personal, 4 in PMMA) with last-contact dates and channel. Agent noticed almost everything was automated (appt reminders, Valentine's promo) and surfaced the only genuine human inbound (Douglas Smith asking where the gym is, never replied) — chief-of-staff-level synthesis. "John Doe" lookup correctly returned "not found" with helpful alternatives (no hallucination). Adding a contact note to Manny Torres about a 12-month coaching program went through clean, and the agent proactively offered a Friday pricing reminder — connecting stated intent to next action without being asked. SMS to Dalton Lechtenberg was the standout: agent found him in BOTH locations, recognized same person via matching phone/email, surfaced the "son" + "pmma-staff" tags, asked which location to send from, AND double-checked Brett actually wanted to text his son a business proposal before firing. After Brett confirmed PMMA, first contact ID errored — agent silently retried with a re-search and succeeded (within the "one retry is fine" rule from Tool Discipline). Brett confirmed Dalton received the text live. Filed a minor polish item (task `683de3ed`): when the agent self-recovers, it should briefly explain WHY (e.g. "that contact ID was from the personal location…") so the audit trail isn't opaque.

**Round B: Google Docs operations — surfaced a real gap.** First three doc prompts all failed cleanly: "Read my TSAI Brand Book Google Doc", "Find and read the most recent doc in TSBS folder", "Append to my Weekly Notes Google Doc." Root cause: the Flo docs MCP server (`~/flo-assistant/servers/docs/dist/index.js`) had 14 tools for read / write / edit / format / proposal-execute / etc. but **zero discovery tools**. Every operation required knowing the file ID upfront. Anything starting with "find my…" or "my X doc" hit a wall. Agent behavior in those three failures was perfect Tool Discipline output: reported the limitation, didn't invent file IDs, didn't curl Google Drive directly, offered concrete alternatives (paste the link, or search Drive UI and paste the link). Bug was 100% the missing tooling, not the agent.

Fixed by adding two new tools to the Flo docs MCP server:

1. **`drive_search`** — partial-name match against Drive, optional `mime_type` filter (`application/vnd.google-apps.document` for Docs only, `application/vnd.google-apps.folder` for folders, etc.). Returns id + name + mimeType + modifiedTime + webViewLink. Sorted most-recent-first via `orderBy: 'modifiedTime desc'`. Escapes single-quotes in the query for Drive's `q` syntax.

2. **`drive_list_folder`** — lists contents of a specific folder ID (typically obtained from a prior `drive_search` for a folder name). Same shape as `drive_search`. Sorted most-recent-first. Optional mime_type filter to e.g. show only Docs in a folder.

**Bug caught after first deploy.** Initial cut crashed with `Cannot read properties of undefined (reading 'files')` on every call — my code went straight to `this.drive.files.list(...)` but `this.drive` is `undefined` until lazy-initialized. Every other handler in this file does the lazy-init dance:

```js
if (!this.drive) {
    const auth = oauthManager.getClient();
    this.drive = google.drive({ version: 'v3', auth });
}
```

Added that to both new handlers and the rebuild went clean. Agent's failure-handling on the broken first version was textbook — reported the error verbatim, offered alternatives, didn't try to route around the bug. Tool Discipline rules holding.

**Verified after fix (4 doc prompts, 4-for-4):** (a) Read TSAI Brand Book → found doc by partial name, read content, returned 3-bullet brand-voice summary on-tone. (b) Most recent doc in TSBS folder → found 3 matching folder candidates, asked Brett to disambiguate, then handled empty-folder case gracefully ("plain TSBS is empty, want me to check Mind Sequencing instead?"). (c) Append to Weekly Notes → search returned no match, agent offered to create it, propose/approve/execute went clean. (d) Follow-up "add 'app testing at 9am' to the doc" — agent maintained context across turns (knew which doc), proposed, approved, appended.

**Patch lives only in `dist/index.js`.** The docs server's `src/index.ts` is actually readable (unlike the calendar server's source), but for consistency with the calendar patch we're keeping the "patch the dist" pattern for now. Backup at `~/dev/_backups/flo-mcp-patches/docs-index.js.20260517-drive-search-tools`. Tagged `v0.7-flo-discovery`.

### May 17, 2026 (morning) — Tester bug-fix session + Tool Discipline guardrails

Real-time co-debugging with Brett running through the canned test prompts on the live beta.5 build. Brett would paste each prompt's response, we'd evaluate, fix, hot-copy or rebuild, and move on. Eight discrete fixes shipped over ~3 hours.

**Test prompts run today** (all results inline in chat transcript): morning briefing, tomorrow's prep, recurring workout/stretch/sleep blocks, Smith contact search. First three test prompts succeeded on the agent side and validated that MCP (calendar + gmail + GHL) is delivering real synthesized output. The recurring-calendar and contact-search prompts surfaced real bugs we fixed live.

What we changed:

1. **Tray click behavior** (`src/main/tray.ts`). Was: tray icon with `setContextMenu(menu)` → single click opens menu, second click needed to reach chat. Now: `tray.on('click', openChatWindow)`, `tray.on('right-click', popUpContextMenu(cachedContextMenu))`. Matches Slack/Discord/ChatGPT Desktop expectation. **Status: still flaky** — Brett still has to click twice intermittently. Tracked as task `9f91cdd0`. Hypotheses to investigate later: stale `setContextMenu` somewhere else in code, Electron version-specific `'click'` event handling on macOS, or compiled asar still holding the old tray.js. Confirmed source is correct + lints + typechecks + reinstalled via `dist:install`.

2. **Scheduled Tasks panel tooltips** (`ui/chat/routines-panel.js`, `ui/cron.html`, `ui/shared/icon-buttons.css`). Native HTML `title=` tooltips weren't showing reliably (1–1.5s delay, suppressed on blurred windows, inconsistent in Electron). Built custom CSS hover-tooltip using `data-tip="..."` attr + `::after` pseudo-element. Migrated all three action buttons from `title=` to `data-tip=`. Tooltips: **Pause task** (toggles to **Resume task**), **Edit task**, **Run task now**, **Delete task permanently**. Same applied to the cron-editor window's job list.

3. **Edit task button** (new feature). New ✏️ pencil icon between Pause and Run. Click flow: stash target job name in `localStorage['acos-edit-job']`, open cron editor via `pocketAgent.app.openRoutines()`, main process sends `cron:check-pending-edit` IPC (so it works whether the cron window was already open or fresh), renderer reads the key, fetches the job from `cron.list()`, calls `enterEditMode(job)` which pre-fills name/prompt/session/schedule and flips the submit button to **Save Changes**. Schedule pre-fill includes a `applyCronToForm()` reverse-parser that handles daily / weekdays / custom-days / interval cron patterns. New `cron:update` IPC + preload binding handles the rename case (delete old + create new) and same-name reschedule (stop in-memory cron task + recreate via existing INSERT-OR-UPDATE-ON-CONFLICT `saveCronJob`). **Gotcha caught and fixed live**: first version called `handlePromptSourceChange()` AFTER setting `prompt-source` value, which blanks the textarea on 'custom' — wiped the prompt the user was trying to edit. Reordered to set source → call handler → set prompt.

4. **Silver-pill button text — navy on TSAI** (`ui/shared/buttons.css`, `ui/shared/theme-loader.js`). Tester feedback: white text on the silver `--accent` pill was unreadable. The token `--text-color--text-tertiary` (= `#fff`) is correctly skin-agnostic-light-on-filled-accent for the saturated accents on Dracula / Nord / etc., but on TSAI's silver it has near-zero contrast. Couldn't change the token globally without breaking other themes. Fix: theme-loader now stamps `document.documentElement.dataset.skin = activeSkinId` on load + on skin change. New CSS rule scoped to `[data-skin="tsai"]` overrides `color` to `var(--bg-primary)` (navy) on every cinamon-pill selector (every naked `<button>`, `.create-btn`, `.btn-cinamon`, `.oauth-btn`, `.skills-setup-btn`, etc.). Killed two per-page overrides that did the same thing (in `routines-panel.css` and `cron.html`) since the global rule subsumes them. Other skins unaffected.

5. **GHL `skip` → `page`** (`~/ghl-mcp/main.py` — not in our repo, upstream `tenfoldmarc/ghl-mcp`). Started yesterday with a fix to `search_opportunities` (one tool). Today the agent's "contact Smith" prompt 422'd on `search_contacts` — same bug, different tool. Built a probe script that hit every GHL endpoint the MCP touches; confirmed `/contacts/`, `/calendars/`, `/workflows/`, `/users/` all reject `skip` with `"property skip should not exist"`. Eight other endpoints returned 401 (Brett's PIT lacks scope) so couldn't be tested but presumably share the bug. Migrated all 10 tools from `skip: int = 0` → `page: int = 1`, docstrings updated. Verified live: `search_contacts(query="Smith")` returns Zac Smith from Brett's `OfcMDEmwDKM6qQZahiuf` location. Patch lives in `~/ghl-mcp/main.py` — our repo doesn't own this file; Brett's local clone holds the fix and the ghl-mcp upstream remote at `tenfoldmarc/ghl-mcp` is not ours to push to.

6. **Flo calendar recurring path — two bugs in one** (`~/flo-assistant/servers/calendar/dist/index.js`). Bug A: `handleExecute` had `if (proposal.type === 'calendar.create') {...} else if (proposal.type === 'calendar.delete') {...}` — zero branch for `'calendar.recurring'`, so executing a recurring proposal fell through both `if`/`else if` clauses and the `results` array stayed empty. User saw "empty response" or "didn't actually get created." Bug B: `handleListPending` filtered with `.filter(p => p.type === 'calendar.create' || p.type === 'calendar.delete')` — recurring proposals were created but invisible to listing. Bug C (discovered while fixing A): Google Calendar REJECTS recurring events that lack `start.timeZone` + `end.timeZone` (non-recurring events infer timezone from primary calendar; recurring don't). Fixed all three: added `'calendar.recurring'` execute branch that uses `recurrence: ["RRULE:${rrule}"]`; added it to the pending filter; reads user's timezone via `calendar.settings.get({setting:'timezone'})` with `America/Denver` fallback. **Caveat: `src/index.ts` is APFS-dataless on disk** (`compressed,dataless` per `ls -lO`, every read times out). Patch lives only in compiled `dist/index.js`. Any future Flo rebuild from source will wipe our fix. Tracked.

7. **Tool Discipline system guidelines** (`src/config/system-guidelines.ts`). Two real incidents this session where the agent silently bypassed Flo's safety layer when an MCP tool errored: created a workout block by calling Google Calendar via raw `curl` with credentials it found in `~/.config/gcalcli/tokens.json`, then did it again for the stretch block, then a third time for sleep routine. Concerning behaviors: bypassed propose-then-approve, bypassed risk-assessment, read a credential file the agent shouldn't have been searching for, learned the workaround pattern across turns and kept using it after the underlying bug was fixed. Wrote a new "## Tool Discipline" section appended to `SYSTEM_GUIDELINES` (loaded as `staticParts[0]` of every system prompt via `chat-engine.ts buildSystemPrompt()`). Five rules + one worked example. Verified working in a fresh chat session ("MCP test event" 9:55pm Friday × 4 weeks went straight through the recurring MCP path with no curl fallback; agent self-narrated: *"flo-calendar's recurring tool worked clean this time — no timezone bug, no RRULE patch needed."*). **Caveat: history poisoning is real.** If a chat session already contains turns where the agent did the workaround, the new system prompt doesn't override the in-context examples — the model pattern-matches on recency. Fresh chats are clean. Worth telling testers to start a new chat if they've seen weird agent behavior.

8. **Build / install workflow** (no code changes; documented learnings). Renderer files (`ui/**/*.html`, `*.js`, `*.css`) can be hot-copied directly into `/Applications/AI Chief of Staff.app/Contents/Resources/app/ui/` for instant feedback — no rebuild, no relaunch, just reopen the affected window. Main-process changes (`src/main/*`, `src/agent/*`, `src/config/system-guidelines.ts`) require `npm run build` + relaunch. External MCP server patches (`ghl-mcp/main.py`, `flo-assistant/servers/calendar/dist/index.js`) require an ACOS quit/relaunch — the MCP child processes are spawned at app boot and reuse across turns. **Two `npm run dist:install` builds today** both hit `xcrun notarytool` weirdness: first run returned `status: Invalid` on both DMGs (Apple's notary service rejected something — likely a transient issue), second run returned `"No Keychain password item found for profile: AC_PASSWORD"`. Neither blocked the local install (the script proceeded to install the unsigned-but-codesigned `release/mac/` build), but both need investigation before the next `dist:signed` for beta.6.

**End state.** All 7 confirmed bug fixes verified working. Tool Discipline guardrails active and verified in fresh chat. Beta.5 is still the public release — next cut should be beta.6. Brett's local install of `/Applications/AI Chief of Staff.app` is `1.0.0-beta.5` with all today's renderer + main-process fixes hot-copied / installed; package.json version unchanged.

### May 16, 2026 (late morning) — External MCP server support + v1.0.0-beta.5

Follow-on to the signing session. Brett described wanting his Claude.ai 'Flo' workflow inside ACOS: Gmail, Calendar, GHL, Docs, web scraping, all the things. Discovered on disk that Flo isn't a claude.ai project at all — it's a stack of locally-built MCP servers at `~/flo-assistant/servers/{gmail,calendar,docs,bookmarks}/` and `~/ghl-mcp/` already wired into Brett's Claude Desktop config. The whole stack just needed an MCP client on the ACOS side.

A previous Claude session scoped the work (Phase 1 client + Phase 2 wire-up + Phase 3 settings UI) cleanly, but then claimed it was 'working on phase 1' for two hours without actually writing any code — a clear hallucinated-progress failure. Real work started this session.

What we built:

1. **`src/mcp/types.ts`** — `ExternalMCPServerConfig` matches Claude Desktop's shape exactly (`command`, `args`, `env`, `cwd`, plus our extras `disabled` and `hidden`). `MCPToolDescriptor` is the descriptor the proxy consumes.
2. **`src/mcp/config.ts`** — loads + validates `<userData>/mcp-servers.json`. Missing file or bad JSON returns empty servers + a clear log line; malformed entries skip with a warning instead of aborting startup.
3. **`src/mcp/client.ts`** — thin wrapper around `@modelcontextprotocol/sdk`'s Client + StdioClientTransport. One instance per server. Spawns child process, runs initialize handshake, lists tools, dispatches `callTool`, drains stderr, clean shutdown. Status enum (`idle | starting | ready | failed | stopped`) for diagnostics.
4. **`src/mcp/manager.ts`** — singleton owns every client. `start(userDataDir)` reads config and spawns all enabled servers in parallel via `Promise.all`. One failed server doesn't block the others. `getAllTools()` returns a flat descriptor list; `callTool(agentToolName, args)` routes by indexed name. Tool names prefixed `mcp__<server>__<tool>` to avoid collisions (same convention Claude Desktop uses for its UI).
5. **`src/mcp/proxy.ts`** — `buildMCPAgentTools()` turns every descriptor into a gg-agent `AgentTool` using the SDK's `rawInputSchema` field — the MCP server's native JSON Schema passes through verbatim, no lossy Zod conversion (gg-ai's Tool interface even has a comment 'used by MCP tools' next to the field, which made discovery easy).
6. **`src/agent/chat-tools.ts`** — inject MCP tools into both `getChatAgentTools()` (before sub-agent) and `getCoderAgentTools()` (appended). Empty array when no servers connected, so no-op for fresh installs.
7. **`src/main/index.ts`** — boot the manager after `AgentManager.initialize()` using `app.getPath('userData')`. Stop on `before-quit` so child processes don't survive app quit. Fire-and-forget on start — logs server-by-server, doesn't block app boot.
8. **`scripts/test-mcp.mjs` + `scripts/test-mcp-call.mjs`** — standalone Node smoke tests (no Electron) for fast iteration. Phase 1 wasn't shippable without these working first.
9. **Per-user config seed.** `~/Library/Application Support/ai-chief-of-staff/mcp-servers.json` (chmod 600, in `.gitignore`) holds Brett's exact 8-server config copied from `~/Library/Application Support/Claude/claude_desktop_config.json`. Empty by default for fresh installs and beta testers — Phase 3 (settings UI) will build a GUI on top of this file.
10. **`build/afterAllArtifactBuild.cjs`** — still needs a regex fix. The post-staple latest-mac.yml patcher logs 'could not find <filename>' — my regex matches in standalone tests but not at build time. Left a TODO; manually patched latest-mac.yml for beta.5 release.
11. **Per-turn diagnostic log.** `[ChatEngine] tools shipped: X total (Y via MCP)` in `src/agent/chat-engine.ts`. Saved us an hour of debugging when the first calendar test came back 'I can't do that' — the log proved 347 tools shipped (323 MCP), which meant the model was hallucinating about its own toolset from a poisoned conversation history. Fresh chat session worked first try.
12. **Misleading Flo description fix.** `flo-calendar`'s `calendar_list_events` description originally said *'List existing calendar events to find events to delete.'* — Claude Opus read that and refused to use it for 'show me my calendar' requests. Patched the description in `~/flo-assistant/servers/calendar/dist/index.js` to be a positive, read-only-explicit string.
13. **Cut v1.0.0-beta.5.** Tag, push, signed `npm run dist:signed` (Mac — 21 min, Apple's notary queue was slow today), Docker `dist:win:local` (Windows — 8 min, parallel). All 11 artifacts uploaded via `gh release upload --clobber` in background, then `gh release edit --draft=false`. Landing page bumped to v1.0.0-beta.5, hero release-line rewritten to lead with MCP support, committed `TSAI-Site@c40507b`, redeployed via `vercel --prod`.

**End state:** Brett can ask the agent 'what's on my calendar', 'check my unread emails', 'find this contact in GHL' — it calls the right MCP tool, gets the right answer. Calendar test pulled real Monday events with conflict-detection on AI Print 8.0 vs 'booked'. Gmail test surfaced a Microsoft security code as the only important unread from today and flagged 3 important threads from yesterday. Beta testers get the engine; their `mcp-servers.json` is empty so they see no MCP tools until they configure one (Phase 3 will give them a GUI).

**Known follow-ups:** (a) Fix the latest-mac.yml regex in `build/afterAllArtifactBuild.cjs` so post-staple patching is automatic. (b) Phase 3 settings UI panel — add/edit/remove MCP servers from a GUI instead of editing JSON by hand. (c) Document the `mcp-servers.json` schema in README so testers can experiment with their own servers.

### May 16, 2026 (mid-morning) — Apple Developer ID signing + v1.0.0-beta.4 release

Follow-on to the morning install-drift session. Apple Developer Program enrollment landed under Brett Lechtenberg (individual), Team ID `2HQTY95NHD`. Walked through cert issuance + notarization wiring + first signed build end-to-end.

What we did:

1. **CSR + Developer ID Application cert.** Generated CSR via Keychain Access (Certificate Assistant → Request a Certificate from a Certificate Authority → Saved to disk). Uploaded to developer.apple.com → Certificates → + → Developer ID Application → G2 Sub-CA. Downloaded `.cer`, double-clicked to install into login keychain. Initially showed 'not trusted' because Apple's `Developer ID Certification Authority` intermediate wasn't on this Mac — fixed by `curl`'ing `https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer` and importing it into the login keychain. `security find-identity -v -p codesigning` now shows '1 valid identities found'.
2. **`.p12` backup.** Exported the cert + private key from Keychain Access as `Brett-DeveloperID-2HQTY95NHD.p12` to two locations: `~/Desktop/TSAI-TSBS Master File/Apple Developer Certificate Info For AI Chief of Staff/` (lives on Mac) and `/Volumes/Brett's 8 TB/Apple Developer Certificate Info For AI Chief of Staff copy/` (external drive). The `.cer` (public part) is alongside in both folders. **Without the `.p12` we cannot restore the cert if this Mac dies.**
3. **App-specific password for notarization.** Generated at `account.apple.com` → Sign-In and Security → App-Specific Passwords → label 'AI Chief of Staff notarization'. Stored in login keychain via `xcrun notarytool store-credentials AC_PASSWORD --apple-id ... --team-id 2HQTY95NHD` (password prompted interactively, never on the command line). Profile `AC_PASSWORD` is now usable by both `notarytool` and electron-builder.
4. **electron-builder wiring.** `package.json`:
   - `build.mac.identity` = `Brett Lechtenberg (2HQTY95NHD)` (no `Developer ID Application:` prefix — electron-builder 26 strips it).
   - `build.mac.notarize` = `true` (boolean only — v26 schema rejects objects).
   - `scripts.dist:signed` = `npm run build && APPLE_KEYCHAIN_PROFILE=AC_PASSWORD electron-builder --mac` (inline env var — electron-builder reads this and routes to `notarytool --keychain-profile AC_PASSWORD`).
   - `scripts.dist:signed:install` = `dist:signed && install:local`.
5. **`build/afterPack.cjs`.** Short-circuits the ad-hoc resign step when a real Developer ID identity is configured — otherwise we'd waste minutes signing files that electron-builder is about to re-sign anyway.
6. **`build/afterAllArtifactBuild.cjs`.** New post-build step: for each `.dmg` artifact, submit to `xcrun notarytool submit --wait`, then `xcrun stapler staple`. Without this the inner `.app` is notarized (via the `.zip` notarization path electron-builder uses internally) but the outer `.dmg` wrapper isn't — clients would need internet on first install for online verification. Stapled DMGs work entirely offline.
7. **Stapling adds bytes to the DMG.** electron-builder writes `latest-mac.yml` (auto-updater manifest) BEFORE our staple step, so the manifest's DMG `size` + `sha512` end up stale and the auto-updater would reject the file on integrity check. Same hook now recomputes both after stapling and patches the YML in place. For beta.4 I patched it by hand once; future signed builds will self-correct.
8. **First signed build.** `npm run dist:signed` from a clean `release/` produced: arm64 + x64 DMGs (signed, notarized, stapled), arm64 + x64 mac zips (auto-updater diffs), arm64 + x64 + universal Windows .exe installers (Docker `electronuserland/builder:wine`), arm64 + x64 win zips, `latest-mac.yml`, `latest.yml`. All 9 Mac artifacts pass `xcrun stapler validate`. `spctl --assess --type execute /Applications/AI\ Chief\ of\ Staff.app` returns `accepted` + `source=Notarized Developer ID`.
9. **v1.0.0-beta.4 release.** Bumped `package.json` version, tagged `v1.0.0-beta.4`, pushed tag + main to GitHub, created the release with `gh release create --prerelease` + 11 assets (4 Mac, 5 Windows, 2 YML). The initial `gh release create` command timed out mid-upload at the 120s harness limit but had created the draft; recovered by re-running `gh release upload v1.0.0-beta.4 ... --clobber` in the background and then `gh release edit --draft=false`. Final URL: https://github.com/BrettLechtenbrerg/ai-chief-of-staff/releases/tag/v1.0.0-beta.4
10. **Landing page.** `TSAI-Site/app/hidden/ai-chief-of-staff-app/page.tsx` bumped to `v1.0.0-beta.4`: install step 3 (Mac first launch) rewritten from the 5-step Privacy & Security workaround to 'It opens — no Gatekeeper warning, no Privacy & Security workaround.' Hero release-note line rewritten. Amber callout scoped down to Windows SmartScreen only. Committed (`TSAI-Site@6396e80`), pushed, deployed via `vercel --prod`.

End state: AI Chief of Staff Mac builds open with a clean double-click for the first time. Windows still has the SmartScreen prompt — next infra investment is a Windows code-signing cert ($200–500/yr standalone EV).

### May 16, 2026 (morning) — Local install drift fix + `npm run install:local`

Returned to find the app on the Dock had reverted to its original look, the Dock icon was missing, and launching required a double-click. Diagnosed: `/Applications/AI Chief of Staff.app` was still the **very first `v1.0.0` build from May 15 06:52** — the one with the broken `Identifier=Electron` ad-hoc signature (the one we wrote the `afterPack.cjs` codesign fix for later that day). Every beta.1 / beta.2 / beta.3 release went to GitHub for testers but **never replaced the local copy**, so the local launcher had been running stale + broken-signed code for nearly 24 hours.

Fix:

1. **One-shot recovery this session:** killed the running process, replaced `/Applications/AI Chief of Staff.app` with `release/mac/AI Chief of Staff.app` (the freshly built x64 beta.3), `xattr -dr com.apple.quarantine`, opened. Verified: `CFBundleShortVersionString = 1.0.0-beta.3`, signature properly bound (`Identifier=com.totalsuccessai.ai-chief-of-staff`), Dock icon back, single-click launch.
2. **Permanent fix — `scripts/install-local.cjs` + `npm run install:local`.** New script auto-detects host arch (`os.arch()`), picks `release/mac/` (x64) or `release/mac-arm64/`, kills any running instance, swaps in the new bundle, strips quarantine, relaunches, and prints `CFBundleShortVersionString` + `CFBundleIdentifier` for verification. Accepts an arch override: `npm run install:local -- arm64`.
3. **Combo command** `npm run dist:install` = `dist:local && install:local`, so a single command takes you from source change to running the freshly installed app on the Dock. **Use this after every version bump going forward** — no more drift.
4. **Documented quirk** under "Stale `/Applications` copy drift" in Known quirks, with symptoms to watch for so it can't haunt a future session.

No source/feature changes — tooling + docs only. No new tag, no new release. `package.json` unchanged version (`1.0.0-beta.3`).

### May 15, 2026 (evening) — First-round tester feedback pass (`v0.5-ux-clarity`)

Testers reported the interface felt unintuitive + the macOS Gatekeeper dialog scared them off on first launch. Worked through their feedback live:

1. **Personalize tabs renamed for clarity.** `Context` → **Knowledge Base** (it's the GPT-Project-style brain dump tab, name now matches mental model). `Your World` → **About You** (it's the personal context tab; simpler).
2. **Sidebar `Routines` → `Scheduled Tasks`.** Renamed in every user-visible location — sidebar button + label + tooltip, panel header (`<h1>`), cron editor window title + window header + section description + toast (“Scheduled task created!”), recipes modal title + intro + footer button (“Open Task Editor”), help-modal section. Code-internal identifiers (`routines-panel.{js,css}`, `#routines-view`, `showRoutinesPanel()`, `sidebar-routines-btn`, `[Routines]` log prefixes, `create_routine` agent tool name + agent-facing strings, system-guidelines.ts “Routines vs Reminders”) intentionally left as-is per the rebrand pattern.
3. **New “What I Can Do” help modal.** Added `ui/chat/help-modal.{html,css,js}`. Trigger is a rounded pill button injected at the top of the chat empty-state (in `scroll.js showEmptyState()`) — only visible on fresh / zero-message sessions, disappears once the user starts typing. Modal has 7 collapsible `<details>` sections (Just talk to me / Knowledge Base / Scheduled Tasks / Documents / Browser / Telegram / Privacy) + a numbered “how to make a scheduled task” 5-step guide + a “Browse Recipes” CTA in the footer that closes Help and opens the existing Recipes modal. Reuses the shared `.modal-overlay.show` toggle from `overlays.css`. **Gotcha:** first cut had `overflow: hidden` on `.help-section` which clipped expanded `<details>` bodies in Chromium — fix is to drop that line + use a `border-bottom` on `[open] > summary` for the visual separator.
4. **Scheduled Tasks split into Daily / Weekly / Monthly tabs.** Added a tab row above the jobs list in `chat.html`, styled in `routines-panel.css` (transparent tabs with accent-colored underline + count badge). Refactored `_rtnLoadJobs` in `routines-panel.js` into two functions — `_rtnLoadJobs` caches the fetched recurring jobs into `_rtnAllJobs`, and `_rtnRenderJobs` filters + renders based on `_rtnActiveBucket`. Bucketing helper `_rtnBucketJob(job)` reads the cron string: `day-of-month ≠ '*'` → monthly, `day-of-week ≠ '*'` → weekly, else daily. `every` interval jobs bucket by interval (≥28d monthly, ≥7d weekly, else daily). `at` jobs are filtered out at fetch time — they're one-shot reminders, not recurring routines.
5. **TSAI-Site landing page updated in parallel** to address the Gatekeeper feedback. The old install step said *“right-click the app then Open”* which doesn't work for the Gatekeeper variant on modern macOS (Sequoia+) — that dialog only has an OK button. Replaced with the actual working flow: dismiss the dialog with OK, then System Settings → Privacy & Security → scroll to Security section → “Open Anyway.” Added a dedicated amber callout block above the Quick Install Guide so testers see the workaround **before** they hit the dialog. Hero subtitle no longer says “first-launch warnings are normal” — now points to the install guide. Capability cards renamed to match in-app terminology (“Your Context, Always On” → “Knowledge Base, Always On”; “Routine Recipes” → “Ready-Made Recipes”). Built + committed + pushed (`TSAI-Site@430185f`) + redeployed via `vercel --prod`. Verified live on `www.totalsuccessai.com`.

End state: tag `v0.5-ux-clarity` represents the snapshot before any new build/release. v1.0.0-beta.1 installers still serve from the landing page — we haven't shipped new DMG/EXE yet (deferred until Apple Developer ID enrollment so the next release lands signed).

**Next session pickup:** Apple Developer Program enrollment ($99/yr) → macOS signing & notarization wired through `build/afterPack.cjs` and `electron-builder` config → cut `v1.0.0-beta.2` with signed Mac builds (no more Gatekeeper dialog) and the UX improvements above → push installers to GH Release → bump `RELEASE_TAG` in TSAI-Site and redeploy.

### May 15, 2026 — Bootstrap → first beta release (single day)

Built end-to-end in one session:

1. Cloned `KenKaiii/pocket-agent` @ v6.4.3, stripped git history, tagged `v0.1-upstream-import`.
2. Wrote `CLAUDE.md` + `RECOVERY.md` mirroring TSAI-Site convention. Renamed upstream's `CLAUDE.md` → `UPSTREAM_CLAUDE.md`.
3. Removed `@kenkaiiii/gg-pixel` telemetry (deleted loader files, stripped CSP entries, dropped npm dep).
4. Hid Global Chat UI surfaces + neutralized auto-connect (privacy: stops traffic to upstream's shared chat server).
5. Added brand assets (`assets/branding/logo-on-white.png` + `logo-transparent.png`) and wrote `scripts/generate-icons.mjs` to produce app `.icns`, `.ico`, and tray template images from the transparent logo.
6. Renamed product metadata in `package.json` (`name`, `productName`, `appId`, `publish.owner/repo`, artifact name patterns). Reset version to `1.0.0`.
7. Renamed DB folder + filename to match `productName`.
8. Swept 42 files renaming "Pocket Agent" → "AI Chief of Staff" + "Pocket-agent" → "AI Chief of Staff" across user-visible strings, comments, build hooks, GitHub Actions notes, tests.
9. Wrote a fresh user-facing `README.md` with required MIT attribution to KenKaiii.
10. Generated full icon set; tagged `v0.2-rebrand-strings`.
11. Added TSAI `tsai` theme (navy `#0A1F44` / silver) and made it the default `ui.skin`.
12. Hid the "Who made me?" sidebar button + about modal, hid the Docs sidebar button (upstream's docs site is unbranded).
13. Switched default agent mode from `coder` to `general` so the agent identifies as AI Chief of Staff and uses the personal-assistant system prompt instead of upstream's "You are GG Coder by Ken Kai" coder prompt.
14. Renamed `personalize.agentName` default `Frankie` → `AI Chief of Staff` and rewrote `personalize.description` for the TSAI brand.
15. Tagged `v0.3-rebrand-themed`.
16. First successful `dist:local` Mac build. Diagnosed and fixed the 🚫 prohibition-icon bug (`Identifier=Electron` + unsealed Info.plist from linker-default signing). Added ad-hoc codesign step to `build/afterPack.cjs`.
17. Pushed everything to `BrettLechtenbrerg/ai-chief-of-staff` (added `workflow` scope to gh token).
18. Sidebar session-rename tooltip ("Double-click to rename — drag to reorder") to surface upstream's hidden gesture.
19. Built the **Personalize → Context tab** with 5 sub-tabs (Brand & Style / Writing Rules / About My Business / Documents & References / Custom Instructions). New `personalize.*` settings keys + `getFormattedUserContext()` injection into the system prompt. Tagged `v0.4-context-tab`.
20. Added drag-drop file extraction (.txt/.md/.docx/.pdf) into Context fields via new `src/main/ipc/context-ipc.ts` IPC + `mammoth` + `pdfjs-dist`. Fixed Electron 32+ `File.path` deprecation via `webUtils.getPathForFile`.
21. Built the **Routines → Recipes modal** with 8 copy-paste-ready templates (daily briefing, email triage, calendar check, friday review, hydration nudge, industry scan, monthly money, birthday reminders). Fixed `.show` vs `.active` class bug + flex overflow bug so all 8 cards scroll.
22. Bumped version to `1.0.0-beta.1`, built Mac DMGs (arm64 + x64) and Windows installers (universal + per-arch) — Windows via Docker (`electronuserland/builder:wine`). Published GitHub Release `v1.0.0-beta.1` with 11 assets totaling ~2.5 GB.
23. Wired the landing page (`BrettLechtenbrerg/TSAI-Site/app/hidden/ai-chief-of-staff-app/page.tsx`) to the new release URLs. Three download buttons (Mac Apple Silicon, Mac Intel, Windows) + "Not sure which Mac?" helper. Swapped placeholder shield icon for the real transparent logo. Added "Your Context, Always On" + "Routine Recipes" capability cards. Deployed via `vercel --prod`.

End state: testers can hit the landing page, download for their platform, install, run through onboarding, and use the full feature set — Context tab, Recipes, TSAI theme, persistent memory, scheduled routines, browser automation, Telegram.
