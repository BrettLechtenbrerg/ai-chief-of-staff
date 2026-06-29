# AI Chief of Staff — Resume Prompt (current)

> Updated June 16, 2026. This is the up-to-date paste-into-chat kickoff.
> `RECOVERY.md` remains the canonical, full-history source of truth — read it
> for the build pipeline, the per-release rollback table, and gotchas. This
> file is the short, current-state bookmark.

---

## Paste this to resume

Let's resume work on **AI Chief of Staff** (ACOS) — Total Success AI's private
desktop AI agent (Electron app, MIT rebrand of KenKaiii/pocket-agent).

**Working directory:** `/Users/brettlechtenberg/dev/ai-chief-of-staff`
**GitHub:** https://github.com/BrettLechtenbrerg/ai-chief-of-staff
  (note: the `Lechtenbrerg` spelling is the REAL handle — not a typo. The
  "corrected" `BrettLechtenberg` 404s. Never auto-fix it.)
**Latest release:** v1.0.0-beta.18 (public prerelease). `git log` head is
  `1ab9c27` (campaign-ops Phase 1 tools — unreleased, not yet tagged/built).
  Newest shipped release tag is still v1.0.0-beta.18 (3814b8c).
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

## Current state (what's live as of beta.18)

- **Hook Lab** (unreleased) — short-form hook strategist. Sidebar
  `sidebar-hook-lab-btn` → `ui/chat/hook-lab-panel.js` (`startHookLab`). Panel:
  idea textarea + optional goal chips + optional brand picker. Boots a "Hook
  Lab" automation session that returns a full hook system (best format + 5
  options for each of the 5 hook elements + /25 score + 15–30s script + CTAs)
  per `assets/skills/hook-lab/SKILL.md`. Conversational (no markers); bridges to
  Video Studio. Built from Brett's Hook Lab™ system instructions.
- **Video Studio** (unreleased) — programmatic branded video via Remotion.
  Sidebar `sidebar-video-studio-btn` → `ui/chat/video-studio-panel.js`
  (`startVideoStudio`). Panel: workspace + brand + **aspect picker** (9:16 /
  16:9 / 1:1) + optional OpenAI. Boots a "Video Studio" automation session that
  designs → builds → renders an MP4 to `~/Desktop/Videos/YYYY-MM-DD-<slug>/`.
  Tools `scaffold_video_project` + `render_video` (`src/tools/video-*.ts`).
  **Remotion is EXTERNAL** — renders in `~/dev/_video-studio`, never bundled
  into the signed app (the renderer pulls a ~150 MB headless Chrome + ffmpeg).
  Skill ships at `assets/skills/remotion/SKILL.md`. See `docs/VIDEO-STUDIO.md`.
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
- **GoHighLevel: 91-tool Node MCP server** (beta.16, `vendor/ghl-mcp-node/`).
  Python-free, runs on Windows, spawned via Electron's bundled Node
  (`ELECTRON_RUN_AS_NODE=1`). Verified live against sub-account
  `OfcMDEmwDKM6qQZahiuf` from inside the signed .app: reads (`get_pipelines`)
  + writes (`create_contact`) work. The old Python `vendor/ghl-mcp/` is
  reference-only — prune later.
- **Content Writer** (beta.11/.12) — one-click SEO blog pipeline → `~/Desktop/Blogs/`.
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

---

## Open items / next candidates

1. Tester feedback on Ad Creator + Ad Analyzer + brand publishing (3 new surfaces).
2. **Autopost activation** (only when Brett asks): add a `metaAds.autopost`
   toggle with an explicit confirm step; re-verify Meta OAuth scope first.
   Prompt plumbing already done.
3. Brand → ad-account mapping for Meta recipes; brand-aware SEO report.
4. Chores (RECOVERY.md): prune reference-only `vendor/ghl-mcp/` Python tree;
   rotate GHL test tokens; `install:local` symlink seal (Goal b6168502); tray
   single-click flake; upstream the Flo `oauth.js` env-var patch; live Windows
   pass when hardware is available.

---

## NEW WORKSTREAM — Campaign Operations (GHL + Meta + Google Ads)

Goal (Brett, June 16): a single agent surface to **set up → test → verify →
run → report** marketing campaigns without logging in/out of GHL, Meta, and
(soon) Google Ads, and without checking five places to confirm wiring.

Key facts that shape the plan:
- **What an agent CAN drive via API:** GHL *data & messaging* (contacts, tags,
  custom fields, conversations, SMS/email sends, opportunities, pipelines,
  appointments) AND *campaigns* (legacy drip sequences — `create_campaign`,
  `send_campaign_now`, `schedule_campaign`, `add_contact_to_campaign`,
  `add_contact_to_workflow` all exist in `vendor/ghl-mcp-node/`, 91 tools).
- **What stays manual:** GHL **workflow/funnel *logic*** (the visual canvas has
  no create/edit API — only enroll/read). Build a workflow once in the UI; the
  agent drives everything around it. There is NO `create_workflow` tool, by
  design of GHL's API.
- **Ad stats do NOT live in GHL.** GHL only sees leads after they arrive. True
  ad→enrollment ROI needs the **Meta Marketing API** (FB/IG spend/CTR/CPL/ROAS)
  + **Google Ads API** (when launched) joined to GHL leads. The join layer is
  the same whether or not GHL is ever replaced — safe to build once.
- **Build-our-own-CRM verdict:** NOT now. ACOS already owns a tested 91-tool GHL
  automation layer; rebuilding would mean re-acquiring Twilio + A2P 10DLC
  registration + email deliverability from scratch. Phased path instead:
  - **Phase 1 (mostly already built):** wire `vendor/ghl-mcp-node/` into the
    agent tool registry (confirm it's callable, not just present) + add a
    verify/smoke-test loop (synthetic test contact → poll GHL → assert
    fields/tags/enrollment/SMS, report in plain English). Kills ~70–80% of the
    pain reusing proven code.
  - **Phase 2:** Google Ads connector (mirror the Meta one) + stats-join layer
    → cost-per-enrollment dashboard / morning digest.
  - **Phase 3 (optional, later, only if GHL limits us):** graduate SMS→Twilio
    (own the 10DLC registration once) / email→Postmark one channel at a time,
    behind the same agent tools, reusing the PMMA Supabase data model. Don't
    pre-build.
- **Companion data model already exists:** the PMMA repo
  (`~/dev/PMMA-Website-2026-Master`) has a working, tested GHL integration
  (`lib/student-create.ts` → `syncIntakeToGhl`, `scripts/ghl-*.mjs` for
  create-fields / verify-contact / cleanup) and a daily digest cron — the proven
  blueprint to generalize for the COS campaign tool layer.

**STATUS (June 16) — Phase 1 tools BUILT & pushed, not yet tested live.**
The research + design step is DONE — see `docs/CAMPAIGN-OPERATIONS.md` (the
canonical Campaign-Ops doc: MCP registration path, three auth-once token
models, the verified CAN/STAYS-MANUAL GHL surface). Key finding: GHL tools are
registered into the agent **automatically** via `rebuildToolIndex` +
`buildMCPAgentTools` — callable, not just spawned. Don't re-investigate.

Built & pushed (in-process custom tools in `src/tools/`, registered in
`getCustomTools`, all self-gating on a connected GHL MCP server, routing only
through `getMCPManager().callTool` — never raw curl):
- `delete_contact` added to `vendor/ghl-mcp-node/index.js` (now 93 tools).
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

**NEXT STEP = TEST LIVE (Brett to drive).** Needs: `npm run rebuild:native`
then relaunch the app (the tools call the running app's MCP manager, so the
new `delete_contact` + tools only take effect after a rebuild/relaunch or next
signed build); GHL connected in Settings → Connections; and a `workflowId` (or
name) from a workflow built in the GHL UI to exercise enrollment. Run
`campaign_smoke_test` first.

After the test passes: Phase 2 — Google Ads connector (mirror the Meta /
Pipeboard `mcp-remote` model) + the ad-spend→GHL-lead stats-join layer. Needs
Brett's input on Google Ads accounts/auth before starting.

---

## Gotchas (quick list — full versions in RECOVERY.md)

- better-sqlite3 ABI conflict (see step 6 above).
- Docker Desktop must be running before `dist:win`.
- `sync-version.cjs` overwrites `package.json` from the latest git tag at build
  time — tag BEFORE `dist:signed` for a new version.
- Never work in any Google-Drive- or iCloud-synced path. Home is `~/dev/`.
- Default mode is **General** (not Coder); default theme is **tsai** (navy/silver).
