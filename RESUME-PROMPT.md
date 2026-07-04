# AI Chief of Staff — Resume Prompt (current)

> Updated July 3, 2026 (post-beta.20 ship). This is the up-to-date
> paste-into-chat kickoff. `RECOVERY.md` remains the canonical, full-history
> source of truth — read it for the build pipeline, the per-release rollback
> table, and gotchas. This file is the short, current-state bookmark.

---

## Paste this to resume

Let's resume work on **AI Chief of Staff** (ACOS) — Total Success AI's private
desktop AI agent (Electron app, MIT rebrand of KenKaiii/pocket-agent).

**Working directory:** `/Users/brettlechtenberg/dev/ai-chief-of-staff`
**GitHub:** https://github.com/BrettLechtenbrerg/ai-chief-of-staff
  (note: the `Lechtenbrerg` spelling is the REAL handle — not a typo. The
  "corrected" `BrettLechtenberg` 404s. Never auto-fix it.)
**Latest release:** v1.0.0-beta.20 (public prerelease, Jul 3 2026). `git log`
  head is `a9d3080`. Repo clean — everything on `main` is shipped. 18 release
  assets live, download links verified HTTP 200, landing page serving beta.20
  (`TSAI-Site@a44e1c8`). Installed beta.7+ apps (Brett's + Manny's) auto-update
  to beta.20 on next quit/reopen.
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

## Shipped in beta.20 (Jul 3, 2026)

- **Queued-message spinner fix** (Manny's `COS Bug.docx` report, `3378a6b`) —
  the thinking indicator vanished while the agent was still working: backend
  emits `done` per message before `processQueue()` starts the next, but the
  renderer tore the indicator down unconditionally, dropping all status events
  for queued messages. Fixed in `message-renderer.js` (skip teardown while
  queued messages remain; recreate indicator for non-`done` events) +
  `messaging.js` (cleanup checks session-scoped `queuedMessageIdsBySession`,
  not the global map; `stopQuery()` clears only its own session's queue).
- **Security hardening** (from a full audit — Electron config, credential
  storage, IPC, XSS paths): credential files 0600 + chmod-down of old installs
  (`52b33a3`); `will-navigate`/`setWindowOpenHandler` guards on all
  `createWindow()` windows (`21ef090`); upstream chat server removed from
  `chat.html` CSP connect-src (`acffa8d`). Audit also confirmed solid:
  contextIsolation, safeStorage, DOMPurify, openExternal gating, bash safety
  patterns. gg-pixel verified inert (transitive dep, never activated —
  documented in CLAUDE.md Privacy Posture).
- Stale test fix: GHL tool count 91 → 92 (`1004cc0`). Suite 1248/1248.
- **Gotcha found:** TSAI-Site's bot-protection edge proxy 404s bare curl —
  verify the landing page with a browser User-Agent, not plain curl.

## Shipped in beta.19 (Jun 30) — all live-tested

Silence Trimmer (`trim_video_silence`), Hook Lab, Video Studio (9:16/16:9/1:1
branded MP4 renders), Campaign Ops Phase 1 (GHL campaign_* tools), and full
model selection ('Check for new models' live discovery — surfaced + ran Opus
4.8 on subscription auth, zero API keys). Details in RECOVERY.md beta.19 row.

---

## Live as of beta.18

- **Meta Ad Creator** (beta.18, `d6dfff8`) — draft-only ad recipe.
  `ui/chat/meta-ad-creator-panel.js` (`startMetaAdCreator`); sidebar button
  `sidebar-ad-creator-btn`. Flow: brand voice → brief → optional READ-ONLY
  Meta perf snapshot → 3 concepts → landscape+square images to
  `~/Desktop/Ads/YYYY-MM-DD-<slug>/` → approval → `ad.md` + Ads Manager paste
  checklist. HARD RULE in prompt: never call Meta write tools. Dormant
  autopost (`metaAds.autopost`, nothing sets it yet) — see RECOVERY workstream D.
- **Meta Ad Analyzer** (beta.18, `f2bb707`) — read-only Meta Ads analysis +
  Connect Tools card.
- **Brand ↔ publish-profile unify** (beta.18, `0552c5c`) — in-app brands map to
  `~/dev/_brand-profiles`. `brands.site_url` exists (enables brand-aware SEO).
  Brands table: id/name/slug/brand_style/writing_rules/business/site_url/
  profile_slug/is_default; sessions carry a nullable `brand_id`.
- **GoHighLevel: Node MCP server** (beta.16, `vendor/ghl-mcp-node/`).
  Python-free, runs on Windows, spawned via Electron's bundled Node
  (`ELECTRON_RUN_AS_NODE=1`). 91 base tools + `delete_contact` added for
  campaign-ops cleanup (now 92). Verified live against sub-account
  `OfcMDEmwDKM6qQZahiuf` from inside the signed .app: reads (`get_pipelines`)
  + writes (`create_contact`) work. The old Python `vendor/ghl-mcp/` is
  reference-only — prune later.
- **Content Writer** (beta.11/.12) — one-click SEO blog pipeline →
  `~/Desktop/Blogs/`. The pattern Video Studio + Hook Lab were modeled on.
- **Connect Tools marketplace + Google OAuth** (beta.12) — Gmail/Calendar/Drive/
  Bookmarks/GHL/DataForSEO/Firecrawl. Google tokens at `<userData>/google-tokens.json`.
- **Scheduler** on `croner@10` (beta.10 fixed the node-cron DOW bug).

---

## Build / ship reminders (learned the hard way — full detail in RECOVERY.md)

- **Versioning is tag-driven.** `scripts/sync-version.cjs` overwrites
  `package.json` version from the latest git tag at build time. Cut a release:
  commit code → `git tag -a v1.0.0-beta.N` → THEN build. Hand-editing the
  version gets reverted.
- **Never hot-copy files into the installed signed `.app`** — it invalidates the
  code signature and macOS silently denies entitlement-gated features (the
  phantom-"you" mic bug). Ship a signed build or use the auto-updater.
- **Run `dist:signed` / `dist:win` as a managed/detached background process**
  (~16–20 min Mac notarization). A foreground build gets reaped mid-notarization,
  leaving DMGs unstapled + `latest-mac.yml` unpatched.
- **Before `dist:signed`:** confirm the notary profile resolves —
  `xcrun notarytool history --keychain-profile AC_PASSWORD` (beta.16 lesson).
- **`gh release create` with ~3.5GB assets times out** and leaves a DRAFT.
  Create with the small manifests first, `gh release upload` big artifacts in
  batches, then `gh release edit --draft=false`.
- **No telemetry.** If `@kenkaiiii/gg-pixel` or `buzzbeamaustralia` reappears,
  that's a regression — flag it. LICENSE must keep Ken's © line; README must
  credit upstream.
- Never use `window.prompt` in renderer UI (silent no-op) — inline inputs only.
- New *panel* surfaces follow one pattern (Content Writer → Video Studio → Hook
  Lab): sidebar button + `#<name>-view` in `chat.html` +
  `ui/chat/<name>-panel.{js,css}` + a binding in `event-bindings.js` + an entry
  in `_dismissOtherPanels` (settings-panel.js) so panels don't double-stack.
  Session kind is only `'chat' | 'automation'` — it is NOT the agent tool mode
  (that's global via `AgentManager.getMode()`).
- New *tool-only* skills (Silence Trimmer) follow the bundled-skill pattern:
  `assets/skills/<name>/` (SKILL.md + script) resolved via
  `resolveBundledAsset()` in `video-shared.ts`, a thin `src/tools/<name>.ts`
  registered in `getCustomTools`, heavy/native deps kept EXTERNAL on the user's
  machine (self-gate with install guidance — never bundle them). Loads after
  `rebuild:native` + JS build + relaunch.
- **Never commit Python `__pycache__`/`*.pyc`** — running the bundled skill's
  `py_compile` once leaked one into git + the `assets/**` ship glob; now
  gitignored (fixed `7126e95`).

---

## Open items / next candidates

1. **Agent-performance upgrades (scoped for beta.21, ~half a day total):**
   - Prompt-cache prefix hygiene: audit per-turn system-prompt/context
     rebuilding in `chat-engine.ts` for stable ordering so Anthropic prompt
     caching actually hits (~2–3 hrs; cost + latency win on every message).
   - Per-tool result truncation budgets so huge GHL/DataForSEO payloads don't
     flood context (~2–3 hrs).
   - Compaction threshold tuning (currently ggcoder's 80% default) per model
     (~1 hr; needs a long-conversation test).
2. **Campaign Ops Phase 2:** Google Ads connector + ad-spend→GHL-lead stats
   join. Needs Brett's Google Ads account/auth input before starting.
3. Tester feedback on Ad Creator + Ad Analyzer + brand publishing.
4. **Autopost activation** (only when Brett asks): add a `metaAds.autopost`
   toggle with an explicit confirm step; re-verify Meta OAuth scope first.
   Prompt plumbing already done.
5. Brand → ad-account mapping for Meta recipes; brand-aware SEO report.
6. Chores (RECOVERY.md): prune reference-only `vendor/ghl-mcp/` Python tree;
   rotate GHL test tokens; `install:local` symlink seal (Goal b6168502); tray
   single-click flake; upstream the Flo `oauth.js` env-var patch; live Windows
   pass when hardware is available.
7. **Flagged, not yet legally checked:** promoting Claude subscription OAuth
   sign-in in a distributed commercial app may run against Anthropic's terms.

---

## WORKSTREAM — Campaign Operations (GHL + Meta + Google Ads)

Goal (Brett, June 16): a single agent surface to **set up → test → verify →
run → report** marketing campaigns without logging in/out of GHL, Meta, and
(soon) Google Ads, and without checking five places to confirm wiring.

Key facts that shape the plan:
- **What an agent CAN drive via API:** GHL *data & messaging* (contacts, tags,
  custom fields, conversations, SMS/email sends, opportunities, pipelines,
  appointments) AND *campaigns* (legacy drip sequences — `create_campaign`,
  `send_campaign_now`, `schedule_campaign`, `add_contact_to_campaign`,
  `add_contact_to_workflow` all exist in `vendor/ghl-mcp-node/`).
- **What stays manual:** GHL **workflow/funnel *logic*** (the visual canvas has
  no create/edit API — only enroll/read). Build a workflow once in the UI; the
  agent drives everything around it. There is NO `create_workflow` tool, by
  design of GHL's API.
- **Ad stats do NOT live in GHL.** GHL only sees leads after they arrive. True
  ad→enrollment ROI needs the **Meta Marketing API** (FB/IG spend/CTR/CPL/ROAS)
  + **Google Ads API** (when launched) joined to GHL leads. The join layer is
  the same whether or not GHL is ever replaced — safe to build once.
- **Build-our-own-CRM verdict:** NOT now. ACOS already owns a tested GHL
  automation layer; rebuilding would mean re-acquiring Twilio + A2P 10DLC
  registration + email deliverability from scratch. Phased path instead:
  - **Phase 1 (built, untested):** wire `vendor/ghl-mcp-node/` into the agent
    tool registry + add a verify/smoke-test loop. Kills ~70–80% of the pain
    reusing proven code.
  - **Phase 2:** Google Ads connector (mirror the Meta one) + stats-join layer
    → cost-per-enrollment dashboard / morning digest.
  - **Phase 3 (optional, later, only if GHL limits us):** graduate SMS→Twilio /
    email→Postmark one channel at a time, behind the same agent tools, reusing
    the PMMA Supabase data model. Don't pre-build.
- **Companion data model already exists:** the PMMA repo
  (`~/dev/PMMA-Website-2026-Master`) has a working, tested GHL integration
  (`lib/student-create.ts` → `syncIntakeToGhl`, `scripts/ghl-*.mjs`) and a daily
  digest cron — the proven blueprint to generalize for the COS tool layer.

**STATUS (June 16) — Phase 1 tools BUILT & pushed, not yet tested live.**
Research + design DONE — see `docs/CAMPAIGN-OPERATIONS.md` (canonical: MCP
registration path, three auth-once token models, the verified CAN/STAYS-MANUAL
GHL surface). Key finding: GHL tools register into the agent **automatically**
via `rebuildToolIndex` + `buildMCPAgentTools` — callable, not just spawned.
Don't re-investigate.

Built & pushed (in-process custom tools in `src/tools/`, registered in
`getCustomTools`, all self-gating on a connected GHL MCP server, routing only
through `getMCPManager().callTool` — never raw curl):
- `delete_contact` added to `vendor/ghl-mcp-node/index.js`.
- `src/tools/ghl-shared.ts` — `resolveGhlServer` (capability-based: matches
  `ghl-mcp` / `flo-ghl` / `flo-ghl-brett`), `callGhl`, parsers, `resolveNameToId`.
- `campaign_smoke_test` — synthetic contact → tag → optional enroll → assert →
  `delete_contact` cleanup (always, via `finally`).
- `campaign_setup_contact` — idempotent upsert by email/phone; tags additive.
- `campaign_enroll` — workflow OR drip campaign; name→id; one-target enforced.
- `campaign_status` — read-only snapshot (tags/conversations/opportunities).
- `campaign_send_message` — SMS/Email, **dry-run default** (real send only on
  explicit `dryRun:false` after human approval).
- `campaign_verify` — read-only assertions (expected tags, conversation activity).

**STATUS UPDATE (Jun 30, beta.19): Phase 1 LIVE-TESTED — PASSED.**
`campaign_smoke_test` passed all steps (create_contact, verify_tag) on Brett's
real GHL sub-account `Uj6CJxWXVU8HyNgI39xb`; enroll skipped (no workflowId),
cleanup skipped (Brett's hand-managed Python `flo-ghl` lacks `delete_contact`;
the vendored Node server subscribers use has it). Leftover synthetic contact
deleted out-of-band + verified gone. Shipped in beta.19.

**NEXT = Phase 2** — Google Ads connector (mirror the Meta / Pipeboard
`mcp-remote` model) + the ad-spend→GHL-lead stats-join layer. Needs Brett's
input on Google Ads accounts/auth before starting.

---

## Gotchas (quick list — full versions in RECOVERY.md)

- better-sqlite3 ABI conflict (see step 6 above).
- Docker Desktop must be running before `dist:win`.
- `sync-version.cjs` overwrites `package.json` from the latest git tag at build
  time — tag BEFORE `dist:signed` for a new version.
- Never work in any Google-Drive- or iCloud-synced path. Home is `~/dev/`.
- Default mode is **General** (not Coder); default theme is **tsai** (navy/silver).
- `_dismissOtherPanels` (settings-panel.js) must list every panel view, or two
  panels can show at once (this bit Video Studio — now includes it + Hook Lab).
