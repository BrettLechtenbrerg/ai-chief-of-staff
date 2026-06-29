# AI Chief of Staff — Resume Prompt (current)

> Updated June 29, 2026. This is the up-to-date paste-into-chat kickoff.
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
**Latest release:** v1.0.0-beta.18 (public prerelease, tag `3814b8c`). `git log`
  head is `0fb3ee7` (**Hook Lab** + **Video Studio** — both unreleased, not yet
  tagged/built). Campaign-ops Phase 1 tools also unreleased (still need a live
  test). Nothing past beta.18 is tagged.
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

## Unreleased on `main` (built since beta.18, NOT yet tagged/built)

Several workstreams sit on `main` past the beta.18 tag. All need a live test
before the next release tag.

- **Silence Trimmer** (unreleased) — `trim_video_silence` tool removes filler
  words ("um/uh/ah/hmm") + dead air from any video/audio file, exporting a
  clean in-sync file to `~/Desktop/Trimmed/`. Shells out to the bundled
  `assets/skills/video-silence-trimmer/trimmer.py` (faster-whisper on-device by
  default; optional openai/elevenlabs engines). `src/tools/video-trim.ts`,
  registered in `getCustomTools`. No panel — the agent calls it on request
  ("trim the silence out of this video"), pairs with Video Studio output.
  EXTERNAL deps (ffmpeg + faster-whisper) live on the user's machine — the tool
  self-gates with install guidance; nothing heavy is bundled. **LIVE-TESTED
  Jun 29** on this Mac (ffmpeg 8.1.2 + faster-whisper 1.2.1): trimmed a real
  video AND audio clip — fillers + silences removed, output in-sync (0.03s
  drift), original untouched, explicit same-path overwrite honored. Note:
  filler-word accuracy depends on the Whisper model (the `base` default can
  miss synthetic-TTS "um/uh"; `small`+ is tighter) — documented in SKILL.md.
- **Hook Lab** (`0fb3ee7`) — short-form hook strategist. Sidebar
  `sidebar-hook-lab-btn` → `ui/chat/hook-lab-panel.js` (`startHookLab`). Panel:
  idea textarea + optional goal chips + optional brand picker. Boots a "Hook
  Lab" automation session that returns a full hook system (best main format +
  specific type, 5 options for each of the 5 hook elements, /25 score, 15–30s
  script, CTAs) per `assets/skills/hook-lab/SKILL.md`. Auto Lead-Gen + Rewrite
  modes; conversational (no approval markers); bridges to Video Studio. Built
  from Brett's Hook Lab™ system instructions. Pure renderer UI + injected
  prompt — no `src/`/IPC changes.
- **Video Studio** (`72fc7ad`) — programmatic branded video via Remotion.
  Sidebar `sidebar-video-studio-btn` → `ui/chat/video-studio-panel.js`
  (`startVideoStudio`). Panel: workspace + brand + **aspect picker** (9:16 /
  16:9 / 1:1) + optional OpenAI. Boots a "Video Studio" automation session that
  designs → builds → renders an MP4 to `~/Desktop/Videos/YYYY-MM-DD-<slug>/`.
  Tools `scaffold_video_project` + `render_video` (`src/tools/video-*.ts`,
  registered in `getCustomTools`). **Remotion is EXTERNAL** — renders in
  `~/dev/_video-studio` driven by the agent's shell, NEVER bundled into the
  signed app (the renderer pulls a ~150 MB headless Chrome + ffmpeg). Only the
  skill ships, at `assets/skills/remotion/SKILL.md`. First run does `npm
  install` + lazily downloads the Chrome shell (one-time). See
  `docs/VIDEO-STUDIO.md`. **Never add the renderer/headless Chromium to
  `build.files` / `extraResources`.**
- **Campaign Operations Phase 1** (`1ab9c27` and earlier) — GHL setup→test→
  verify→enroll→status→message tools. See the workstream section below. Status:
  built & pushed, **never tested live.**

Verification done so far: typecheck + lint clean; Video Studio proven with a
real dual-aspect Remotion render (1080×1920 + 1920×1080) consuming brand.json;
Hook Lab panel layout confirmed via a CSS harness. The in-app GUI click-through
(real agent turns with an API key) is the remaining manual step for both.

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
  campaign-ops cleanup (now 93). Verified live against sub-account
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
- New surfaces follow one pattern (Content Writer → Video Studio → Hook Lab):
  sidebar button + `#<name>-view` in `chat.html` + `ui/chat/<name>-panel.{js,css}`
  + a binding in `event-bindings.js` + an entry in `_dismissOtherPanels`
  (settings-panel.js) so panels don't double-stack. Session kind is only
  `'chat' | 'automation'` — it is NOT the agent tool mode (that's global via
  `AgentManager.getMode()`).

---

## Open items / next candidates

1. **Live-test the three unreleased workstreams**, then tag a beta:
   - Hook Lab: open it, try a lead-gen idea (confirm Lead-Gen Mode fires), check
     the full 12-section output + /25 score; paste a weak hook for Rewrite Mode.
   - Video Studio: pick a brand, render a 9:16 (~10s) and a 16:9; confirm the
     skill lands at `~/dev/_video-studio/.agents/skills/remotion/SKILL.md` and
     the Approve / Request-changes buttons appear/clear.
   - Campaign Ops Phase 1: see the workstream section — `campaign_smoke_test`
     first, after `rebuild:native` + relaunch + GHL connected.
2. Tester feedback on Ad Creator + Ad Analyzer + brand publishing.
3. **Autopost activation** (only when Brett asks): add a `metaAds.autopost`
   toggle with an explicit confirm step; re-verify Meta OAuth scope first.
   Prompt plumbing already done.
4. Brand → ad-account mapping for Meta recipes; brand-aware SEO report.
5. Chores (RECOVERY.md): prune reference-only `vendor/ghl-mcp/` Python tree;
   rotate GHL test tokens; `install:local` symlink seal (Goal b6168502); tray
   single-click flake; upstream the Flo `oauth.js` env-var patch; live Windows
   pass when hardware is available.

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

**NEXT STEP = TEST LIVE (Brett to drive).** Needs: `npm run rebuild:native` then
relaunch the app (the tools call the running app's MCP manager, so the new
`delete_contact` + tools only take effect after a rebuild/relaunch or next signed
build); GHL connected in Settings → Connections; and a `workflowId` (or name)
from a workflow built in the GHL UI to exercise enrollment. Run
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
- `_dismissOtherPanels` (settings-panel.js) must list every panel view, or two
  panels can show at once (this bit Video Studio — now includes it + Hook Lab).
