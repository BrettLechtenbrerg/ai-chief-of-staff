# AI Chief of Staff — Recovery & Resume

This is the canonical session-kickoff document. If you're a fresh Claude session, start here.

---

## Standard kickoff prompt

> Let's resume work on **AI Chief of Staff** — Total Success AI's private desktop AI agent for clients.
>
> **Working directory**: `/Users/brettlechtenberg/dev/ai-chief-of-staff`
> **GitHub**: https://github.com/BrettLechtenbrerg/ai-chief-of-staff
> **Latest release**: https://github.com/BrettLechtenbrerg/ai-chief-of-staff/releases/tag/v1.0.0-beta.5 (public, prerelease)
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
| `v0.10-seo-article-shipped` | May 17, 2026 | **First end-to-end value loop: agent-generated SEO research → brief → live published article on totalsuccessai.com.** Brett asked the agent to run a 3-task DataForSEO test prompt (keyword rankings, backlink comparison, "People Also Ask" research). After fixing DataForSEO credentials (`brett@brettlechtenberg.com` + the API password from the welcome email, not the dashboard password — same trap most users hit) and activating the 14-day Backlinks API trial, results came back clean. Task 1 confirmed totalsuccessai.com ranks for only 2 keywords (both branded) — confirming wide-open SEO opportunity. Task 2 was misdirected (compared TSAI to coach.com, which is the handbag brand not a coaching business) but the agent correctly flagged the mismatch and offered better targets — 4 spam-directory backlinks surfaced as a side finding for a future disavow.txt. Task 3 found the gold: "ai for small business marketing" = 140/mo, KD 8, $36 CPC, low competition. **Then shipped it.** New pillar article at `app/ai-for-small-business-marketing/page.tsx` in the TSAI-Site repo — 1,800+ word piece with hero, 5-play breakdown, honest tool comparison table, "why 85% of AI projects fail" section, assessment CTA, FAQ section answering all 10 PAA questions surfaced from the live SERP, FAQPage + Article JSON-LD schema, author bio with Brett's photo, internal links to /services /assessment /ai-chief-of-staff /free-resources /about (building topical authority), final consultation CTA to speaktobrett.com. Added to `sitemap.ts` with priority 0.85, robots index/follow. Build verified clean (pre-rendered as static). Committed (`TSAI-Site@dfb08f5`), pushed, Vercel auto-deploys. SEO brief preserved at `docs/tester-feedback/2026-05-17-seo-content-brief-ai-for-small-business-marketing.md`. Two follow-up tasks logged in task list: re-run backlink analysis against a relevant competitor before the May 31 trial expires (id `e11e1a4c`); disavow the 4 spam backlinks (id `36c35fad`). This is the **first time** the ACOS agent produced research → plan → deployed live customer-facing asset in a single session — a meaningful capability proof for the chief-of-staff product narrative. |
| `v0.9-anti-hallucination-and-docs` | May 17, 2026 | **Tool Discipline Rule 6 + first tester-feedback doc.** During a copy-critique test prompt the agent generated 8 solid landing-page observations from a coaching-buyer's perspective but also hallucinated a 9th: it claimed the GitHub download URLs on the landing page had a typo (`BrettLechtenbrerg` "should be" `BrettLechtenberg`) and saved that as a fact in long-term memory. The unusual-looking surname is actually Brett's real GitHub handle — verified live with `curl -sI` returning 200. The "corrected" version returns 404. So the agent had pattern-matched a real-looking misspelling against an accurate-but-unusual proper noun, fabricated a critical bug, and persisted it. False bug-facts are especially toxic because they ship in every system prompt as established truth on every future turn. Two fixes: (1) deleted fact ID 19 from the `facts` table (the FTS trigger auto-cleaned the index). (2) Added **Rule 6** to the Tool Discipline section in `src/config/system-guidelines.ts`: *"Verify before saving a claimed-bug fact to memory."* Includes the exact failure pattern (unusual-proper-noun mis-flagging) and a worked example showing HEAD-request-then-decide flow. Separately, saved the actually-valuable 8-section copy critique to a new `docs/tester-feedback/` folder so it doesn't vanish when chat history scrolls — `2026-05-17-landing-page-coaching-buyer-critique.md` is a near-publishable rewrite brief covering: page-reads-for-engineers framing problem, zero-transformation-language gap, missing trust signals, broken buyer flow, oversized install guide, buried coach-relevant features, brand-voice mismatch, and small conversion killers, plus the one-line top-of-page rewrite + a market-scan finding (Coachvox is the only real competitor in the "solo-coach AI agent" space). Doc lives in repo so future Brett-or-Claude can act on it without re-deriving. No new ACOS feature code, just guardrails + docs. |
| `v0.8-bookmarks-and-db-path` | May 17, 2026 | **Two critical correctness fixes.** (1) **Flo bookmarks MCP** silently lied about every write while Chrome was running — it wrote the JSON file, then Chrome's next in-memory autosave overwrote it, reverting the change. Added an `isChromeRunning()` check (uses `pgrep -x 'Google Chrome'` on macOS, `tasklist` on Windows, `pgrep -f chrome` on Linux) that runs before every `saveBookmarks()` call and refuses with a clear instruction to fully quit Chrome. Also fixed `date_added` from `Date.now()` (Unix milliseconds) to WebKit microseconds since 1601 (Chrome's actual timestamp format), so new folders sort/render correctly. Manually repaired the misplaced Beta Tester Feedback 2026 folder Brett created earlier today (popped it from position 34, fixed its timestamp, inserted between Gift Con and Community). Verified end-to-end: writing with Chrome running fails cleanly with the new message; writing with Chrome quit succeeds and Chrome shows the bookmark on restart. (2) **DB path on macOS** — `getDbCandidates()` only listed the Title Case `~/Library/Application Support/AI Chief of Staff/` path on macOS, but the packaged app actually uses the lowercase slug `~/Library/Application Support/ai-chief-of-staff/` (Electron's `app.getPath('userData')` derives from `package.json` `name`, not `productName`). `handleListRoutinesTool` worked anyway because it uses the in-process Scheduler singleton; `handleCreateJob` failed every time with "Database not found" because it does `fs.existsSync(getDbPath())` first. Flipped the candidate order so the lowercase slug is checked FIRST; Title Case stays as a fallback. Fixed `create_routine`, `create_reminder`, and every project-tool DB call in one change. Verified live: agent batch-created 4 routines successfully (daily briefing 6:30am, lunch break 11:45am weekdays, Friday review 4pm, monthly stale-contacts 9am 1st of month). Also corrected the wrong Known Quirks note that said dev and packaged use different paths. No `package.json` version bump. |
| `v0.7-flo-discovery` | May 17, 2026 | **Flo docs MCP gained discovery tools.** Two new tools added to `~/flo-assistant/servers/docs/dist/index.js`: `drive_search` (find files by partial name match, supports `mime_type` filter for Docs/Sheets/folders, returns id + name + type + modifiedTime + webViewLink, sorted most-recent-first) and `drive_list_folder` (list a folder's contents sorted most-recent-first, optional mimeType filter). Wired into the tool list, the CallTool switch, and two new `handleDriveSearch` / `handleDriveListFolder` methods. Critical detail caught after first deploy: every other handler in this file lazy-inits `this.drive` via `oauthManager.getClient()`; my first cut skipped that and crashed with `Cannot read properties of undefined (reading 'files')` on every call. Fixed to match the existing lazy-init pattern. **Closes the discovery gap** that blocked every "find my X" / "the most recent doc in Y folder" / "append to Weekly Notes" prompt — verified live across 4 doc prompts including read+summarize, folder disambiguation, create-if-missing flow, and contextual follow-up append. Patch lives in `dist/index.js` only (source `src/index.ts` for this server is fine, but other Flo servers' sources are dataless, so we're keeping the consistent "patch the dist" pattern for now). Backup at `~/dev/_backups/flo-mcp-patches/docs-index.js.20260517-drive-search-tools`. No ACOS code changed this round. |
| `v0.6-tooling-and-fixes` | May 17, 2026 | **Mid-cycle bug-fix + UX pass between betas.** Working tag, no new GH Release. Eight changes shipped: (1) Tray UX — left-click now opens chat, right-click shows menu (was: two-click menu → chat). Still flaky in some launches; tracked in task list. (2) Scheduled Tasks panel — custom CSS hover tooltips replace native HTML `title=` attrs (native ones were unreliable in Electron, long delay + suppressed on blurred windows). Buttons now read **Pause task / Edit task / Run task now / Delete task permanently**. (3) **Edit task button** — new pencil icon between Pause and Run in every row. Click → cron editor opens pre-filled with the job's existing name, prompt, session, and schedule; submit button flips to **Save Changes**; new `cron:update` IPC + `scheduler.updateJob`-equivalent handles rename + reschedule + prompt edit in one flow. (4) **Silver-pill button text — navy on TSAI.** Every cinamon-pill button across the app (Done, Let's Go!, Save Changes, Reboot, every naked `<button>`) now uses `var(--bg-primary)` (navy) for text on the silver `--accent`. Scoped via `[data-skin="tsai"]` attribute that `shared/theme-loader.js` now stamps on `<html>` — other skins keep white-on-saturated. (5) **GHL `skip` → `page` everywhere.** `ghl-mcp/main.py` had 10 endpoints sending the `skip` query param. GHL's modern v2 API rejects `skip` with 422 on at least `/contacts/`, `/opportunities/search`, and likely others. All 10 tools now use `page` (1-indexed) per GHL's documented standard. Verified live against Brett's `OfcMDEmwDKM6qQZahiuf` location: search_contacts(query="Smith") returns Zac Smith clean. (6) **Flo calendar recurring path fixed.** `~/flo-assistant/servers/calendar/dist/index.js` had two bugs: (a) `handleExecute` had no branch for `proposal.type === 'calendar.recurring'`, so executing a recurring proposal silently did nothing; (b) `handleListPending` filtered them out of the pending queue. Added the recurring execute branch (uses Google Calendar's `recurrence: ["RRULE:..."]`), added timezone fallback (Google REQUIRES `start.timeZone` + `end.timeZone` on recurring events; non-recurring infers from primary calendar). Calls `calendar.settings.get({setting:'timezone'})` with `America/Denver` fallback. Verified live: "MCP test event" recurring 9:55 PM Friday × 4 weeks created cleanly with no curl fallback. **Note:** source `src/index.ts` is APFS-dataless on disk (unreadable), patch lives only in `dist/index.js` — any rebuild will regress it. Tracked. (7) **Tool Discipline guidelines.** New section appended to `SYSTEM_GUIDELINES` in `src/config/system-guidelines.ts`. Five rules + worked example to stop the agent from learning curl-with-stolen-credentials workarounds when MCP tools error. Triggered by two real incidents this session where the agent silently bypassed Flo's safety layer by reading `tokens.json` and shell-curling Google Calendar directly. The new rules: match the domain to the MCP tool; when an MCP tool errors, report and stop (don't invent workarounds); never call external APIs via raw shell+curl; never read credential files; when in doubt, ask before shelling out. **Verified working in fresh chat sessions** — the same kind of recurring-event request now goes through the MCP path, agent self-narrates honestly when something fails. **Caveat:** conversation history poisoning is real — if a session already learned the workaround pattern in prior turns, the new prompt doesn't override recent in-context examples. Fresh chat sessions are clean. (8) Misc: rebuilt + reinstalled locally via `npm run dist:install` between iterations; main-process changes (tray, IPC, system-guidelines) need rebuild + relaunch, renderer changes (cron.html, routines-panel.js/css, buttons.css) can be hot-copied into `/Applications/AI Chief of Staff.app/Contents/Resources/app/` for instant feedback. No version bump in `package.json` — still `1.0.0-beta.5`. |
| `v1.0.0-beta.5` | May 16, 2026 | **Fifth beta release — external MCP server support.** The agent can now talk to any stdio-protocol MCP server. Per-user config at `<userData>/mcp-servers.json` — same shape as Claude Desktop's `claude_desktop_config.json`, so existing servers port directly. New `src/mcp/` module: `client.ts` (one-server wrapper around `@modelcontextprotocol/sdk` Client + StdioClientTransport), `manager.ts` (singleton that owns every connected server, exposes `getAllTools()` + `callTool()`), `proxy.ts` (turns MCP tool descriptors into gg-agent AgentTools via the `rawInputSchema` escape hatch — no Zod conversion). Wired into both Chat and Coder modes in `src/agent/chat-tools.ts`. Manager starts on app boot in `src/main/index.ts` and stops on `before-quit`. Tool names prefixed `mcp__<server>__<tool>` to avoid collisions. Per-turn `[ChatEngine] tools shipped: X total (Y via MCP)` log line for diagnostics. **Brett's seed config** lives at `~/Library/Application Support/ai-chief-of-staff/mcp-servers.json` (gitignored, never shipped) with all 8 Flo / GHL / DataForSEO / Firecrawl servers wired up — 323 tools total. Verified live: calendar list + Gmail unread search return real, prioritized results with conflict-detection. Same Apple signing + notarization as beta.4. Auto-updater on beta.1/.2/.3/.4 installs pulls this silently. |
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

### Now
- **Mid-cycle bug-fix pass complete (May 17)** — see `v0.6-tooling-and-fixes` + `v0.7-flo-discovery` + `v0.8-bookmarks-and-db-path` + `v0.9-anti-hallucination-and-docs` + `v0.10-seo-article-shipped` rows in the rollback table. Twelve infra/UX changes shipped against `1.0.0-beta.5` without a version bump, plus the first agent-generated-and-deployed customer-facing asset (the SEO pillar article at totalsuccessai.com/ai-for-small-business-marketing): tray UX, panel tooltips, edit-task button, navy-on-silver button text, GHL `skip→page` across 10 endpoints, Flo calendar recurring path (execute branch + timezone), Flo docs discovery tools (`drive_search` + `drive_list_folder`), Flo bookmarks Chrome-running guard + WebKit timestamp fix, **DB path canonical lowercase-slug fix** (unblocked routine/reminder creation), system-prompt Tool Discipline rules to stop curl-workaround behavior, **Tool Discipline Rule 6** to stop the agent from saving unverified bug-claims to memory, and the install/hot-copy workflow refined. New `docs/tester-feedback/` folder captures actionable tester output (e.g. the landing-page rewrite brief) that would otherwise be lost when chat history scrolls. **Next public release should be `v1.0.0-beta.6`** — bump `package.json` + tag + signed build + publish DMGs/EXEs + bump landing page `RELEASE_TAG`. Open follow-ups before cutting beta.6:
  - Tray single-click → chat is still flaky; tracked in task list (id `9f91cdd0`).
  - Agent occasionally double-narrates ("I haven't actually created the proposal yet — let me do that now" when the proposal already exists). Minor.
  - `build/afterAllArtifactBuild.cjs` `latest-mac.yml` regex still needs fixing so post-staple patching is automatic (carried over from beta.5 known follow-ups).
  - Apple notarization keychain profile (`AC_PASSWORD`) had "No Keychain password item found" once today during `dist:install` — unclear if it's a transient issue or the profile was wiped. Verify before next `dist:signed` build with `xcrun notarytool history --keychain-profile AC_PASSWORD`.
- **First-round beta testing continues** — testers still have v1.0.0-beta.5 via the landing page. Auto-updater on beta.1/.2/.3/.4 installs silently pulls beta.5 on launch. Once beta.6 ships, today's fixes propagate automatically.

### Likely next (after testers report back)
- **Voice input in the chat composer (Phase 4)** — click a mic button, talk, click again to stop, text appears in the input box, press Enter to send. Brett's daily-driver pattern from Claude.ai. **The engine is already built**: `src/utils/transcribe.ts` is an OpenAI Whisper wrapper that takes a buffer + format and returns text, with tests passing. What's missing is purely UI: a mic button in `ui/chat.html` (the input-toolbar already has attach/search/workflows buttons — add a 4th), a renderer-side `MediaRecorder` to capture audio, an IPC call into `transcribeAudio()`, and visual feedback (red dot while recording, spinner while transcribing). Also: add `com.apple.security.device.audio-input` to `build/entitlements.mac.plist` so the next signed build can access the mic (one-line change, triggers a re-notarize). Cost: ~$0.006/min of audio via Whisper, negligible. Scope: ~3–4 hours single session.
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

### vitest 205 failures from better-sqlite3 ABI
The full test suite shows ~205 failures, all from one root cause: `better-sqlite3` is rebuilt against Electron's bundled Node ABI (right for runtime) but vitest uses system Node v22 (different ABI). The tests we touched (db-path, commands-loader, telegram) all pass individually. Not caused by our changes — pre-existing upstream infra issue. Can be solved by adding an `npm run test:rebuild-system-node` script that rebuilds better-sqlite3 against system Node before running vitest, then rebuilds against Electron after.

### Canonical DB path on macOS — lowercase slug, not Title Case productName
**Both `npm run dev` AND the packaged macOS app write to `~/Library/Application Support/ai-chief-of-staff/`** (lowercase slug from `package.json` `name`). The previous version of this note said packaged builds use `~/Library/Application Support/AI Chief of Staff/` (Title Case `productName`) — **that was wrong**. Electron's `app.getPath('userData')` derives the folder from `name`, not `productName`, unless `app.setName(...)` is called. We don't.

This caused a real bug on May 17: `src/utils/db-path.ts` `getDbCandidates()` listed only the Title Case path on macOS. `handleListRoutinesTool` worked anyway (it uses the in-process `getScheduler()` which has the DB open), but `handleCreateJob` (and every other tool that calls `getDbPath()` directly + `fs.existsSync()` before opening the DB) failed with "Database not found" because no Title Case folder ever existed. Fix: the lowercase slug path is now FIRST in the candidate list; the Title Case path remains as a fallback in case future Electron versions auto-name from productName.

### `pkill -f "AI Chief of Staff"` is your friend
Mac builds sometimes hang on lingering Electron processes. When the app refuses to relaunch cleanly or `npm run dev` errors with port-in-use messages, `pkill -9 -f "AI Chief of Staff"; sleep 2` clears it.

### Stale `/Applications` copy drift (fixed by `npm run install:local`)
We ship DMGs to GitHub Releases for testers, but the locally-installed `/Applications/AI Chief of Staff.app` was never automatically refreshed when we bumped versions. Result: source tree showed `v1.0.0-beta.3`, but launching from the Dock ran the **original `v1.0.0` build from the very first DMG of the day**, which had the broken `Identifier=Electron` ad-hoc signature — hidden Dock icon + double-click-to-launch + missing every UX upgrade. **Fix:** after every version bump or local build, run `npm run install:local` (or `npm run dist:install` to build + install in one shot). Symptoms to watch for if this regresses: (a) installed app's `CFBundleShortVersionString` doesn't match `package.json`, (b) Dock icon vanishes, (c) double-click required to launch.

---

## Past sessions

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
