# AI Chief of Staff — Recovery & Resume

This is the canonical session-kickoff document. If you're a fresh Claude session, start here.

---

## Standard kickoff prompt

> Let's resume work on **AI Chief of Staff** — Total Success AI's private desktop AI agent for clients.
>
> **Working directory**: `/Users/brettlechtenberg/dev/ai-chief-of-staff`
> **GitHub**: https://github.com/BrettLechtenbrerg/ai-chief-of-staff
> **Latest release**: https://github.com/BrettLechtenbrerg/ai-chief-of-staff/releases/tag/v1.0.0-beta.3 (public, prerelease)
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

# Mac DMG (unsigned, ad-hoc signed via afterPack hook)
npm run dist:local           # produces arm64 + x64 DMGs in ./release/

# Windows installers (requires Docker Desktop running)
docker run --rm \
  -v "$(pwd):/project" \
  -v ~/.cache/electron:/root/.cache/electron \
  -v ~/.cache/electron-builder:/root/.cache/electron-builder \
  -w /project \
  electronuserland/builder:wine \
  /bin/bash -c "npm config set ignore-scripts true && npm run dist:win:local"

# Smoke-test the actual installed app (not dev) on this Mac
pkill -f "AI Chief of Staff"
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
- **First-round beta testing** — testers have v1.0.0-beta.1 via the landing page. Collect their feedback before next release.

### Likely next (after testers report back)
- **SMS / GHL / Email reminder delivery channels** — the landing page promises these; the app currently delivers via desktop + Telegram. Likely Twilio for SMS, webhook for GHL, SMTP for email. New scheduler delivery channels in `src/scheduler/`.
- **Apple Developer ID code-signing** ($99/yr) — eliminates the Gatekeeper right-click step + the macOS keychain re-prompts on rebuilds. Real fix; see "macOS keychain prompts" note below.
- **Windows code-signing certificate** — eliminates the SmartScreen "More info → Run anyway" step. Standalone EV cert ~$200–500/yr.
- **Logo polish** — current logo is dark navy on transparent, reads faint in the macOS Dock against transparent surfaces. A tighter-cropped or backplate variant would help.
- **Tray icon background** — Brett asked for a more visible tray icon in v1.0.0-beta.1 testing. Currently a black template image (correct macOS UX); a white-fill variant or different glyph is an option.

### Reusable patterns documented elsewhere
- **electron-builder cross-build via Docker** — `electronuserland/builder:wine` image, mount repo + electron caches. Used for `dist:win:local` from a Mac.
- **Mac ad-hoc signing in afterPack.cjs** — fixes the linker-default `Identifier=Electron` / `Info.plist=not bound` bundle that Finder flags with a 🚫 icon. See `build/afterPack.cjs`.
- **Hot-copy installed app for testing** — after `npm run build`, copy specific files into `/Applications/AI Chief of Staff.app/Contents/Resources/app/` to test renderer/IPC changes without re-running the full DMG pipeline. Restart the app to pick them up.

---

## Known quirks (so you don't re-debug them)

### macOS keychain prompts on rebuild
Each rebuild produces a slightly different ad-hoc signature → macOS's keychain ACL invalidates → "AI Chief of Staff wants to access … Safe Storage" prompts appear on next launch. "Always Allow" sticks **only until the next rebuild**. The real fix is an Apple Developer ID. For now, a one-time prompt for clients on first install is acceptable (matches the landing page's "first-launch warnings are normal" promise).

### Auto-updater 406 from GitHub
`electron-updater` polls `/releases/latest` even when there's no published latest release. After v1.0.0-beta.1 went live this stopped firing. If you ever see the 406 again, it means we tagged a new version but didn't publish a Release with assets.

### vitest 205 failures from better-sqlite3 ABI
The full test suite shows ~205 failures, all from one root cause: `better-sqlite3` is rebuilt against Electron's bundled Node ABI (right for runtime) but vitest uses system Node v22 (different ABI). The tests we touched (db-path, commands-loader, telegram) all pass individually. Not caused by our changes — pre-existing upstream infra issue. Can be solved by adding an `npm run test:rebuild-system-node` script that rebuilds better-sqlite3 against system Node before running vitest, then rebuilds against Electron after.

### Dev-mode vs packaged DB folder mismatch on macOS
`npm run dev` uses `~/Library/Application Support/ai-chief-of-staff/` (Electron in dev mode uses `name` field). Packaged builds use `~/Library/Application Support/AI Chief of Staff/` (`productName` field). Settings and chat history don't auto-migrate between the two. Not a bug — Electron's standard behavior.

### `pkill -f "AI Chief of Staff"` is your friend
Mac builds sometimes hang on lingering Electron processes. When the app refuses to relaunch cleanly or `npm run dev` errors with port-in-use messages, `pkill -9 -f "AI Chief of Staff"; sleep 2` clears it.

---

## Past sessions

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
