# Next session — handoff (resume here)

_Written 2026-06-02 evening. Brett is tired; this is the resume point._

## ✅ DONE THIS SESSION — Voice mode SHIPPED (beta.15, Mac)

**v1.0.0-beta.15 is LIVE and published on GitHub.** Apple/Mac fully done:
- Merged `feat/voice-mode` → `main`, pushed; tag `v1.0.0-beta.15` pushed.
- Built, **signed + Apple-notarized + stapled** (arm64 + x64).
- All 9 assets uploaded; `latest-mac.yml` verified (points at files that exist).
- Release published (`draft: false`, marked **Latest**).
- Release: https://github.com/BrettLechtenbrerg/ai-chief-of-staff/releases/tag/v1.0.0-beta.15

**What testers get:** anyone on beta.7+ auto-updates to beta.15 on next app quit.
Voice mode is **OFF by default** — opt in via **Settings → LLM → Voice mode (beta)**
(needs an OpenAI API key + mic). Existing chat/voice-note flow is unaffected.

### Release-process lesson (so next time is smooth)
- `npm run dist:signed` only BUILDS + notarizes; it does NOT publish.
- Publishing = `gh release create` / `gh release upload` (uses `gh` CLI keyring auth,
  not GH_TOKEN). The big DMG/zip uploads (~1.4 GB total) take 3–8 min.
- **Run large uploads in Brett's own Terminal**, not via the agent — the agent's
  2-min command limit kills a 1.4 GB upload mid-flight. (That was the only friction
  this release; everything else was first-try clean.)

## ▶️ FIRST TASK NEXT SESSION (Brett's explicit ask)
**Ensure testers can connect THEIR GoHighLevel (GHL) accounts to AI CoS.**

Current state (verified in code):
- GHL is already a **Connect Tools** card: `src/main/ipc/connect-tools-ipc.ts`
  (`id: 'ghl'`, name "GoHighLevel", category crm). Auth = two fields:
  **Private Integration Token** (`pit-...`) + **Location ID**. MCP server: `ghl-mcp`.
- Brett's OWN GHL works (dev log showed `flo-ghl` / `flo-ghl-brett` MCP servers
  loading, 91 tools each). So the integration functions for a hand-configured setup.

**The likely blocker to investigate first (flagged in code, line ~78-79):**
> "GHL needs Python, which we don't bundle yet" (`unavailableOnWindows` note).
- Confirm whether a tester (clean install, no dev tooling) can actually connect:
  does `ghl-mcp` require a Python runtime that the packaged app doesn't ship?
- If yes → testers will fail to connect. Options to evaluate:
  1. Bundle a Python runtime / use a Python-free GHL MCP server, or
  2. Reuse the `flo-ghl` server path that's already working for Brett, exposed
     through the Connect Tools card with the tester's own token + location.
- Verify the **two-field connect flow** end-to-end on a clean machine: paste token
  + location → card flips to "Connected" → GHL tools become available to the agent.

**Files to look at:** `src/main/ipc/connect-tools-ipc.ts` (the `ghl` entry +
`resolveGhlMainPath`), `src/mcp/bundled-paths.ts` (what's bundled vs. needs a
runtime), and the Connect Tools panel UI (`ui/chat/connect-tools-panel.js`).

## 🔎 RECOMMENDED before telling testers to update (not blocking)
- **Smoke-test the NOTARIZED beta.15 build** (not just `npm run dev`): download the
  DMG from the release page on a clean machine, install, enable Voice mode, do a
  "what's 2+2?" call. Same code as dev, but confirms the packaged/signed build is fine.

## Parked / known (non-blocking, documented in NOTES.md)
- Voice: history cap (latency lever); VAD `eagerness` re-eval in a quiet room;
  add `setPermissionRequestHandler` (defense-in-depth).
- Windows voice: code is platform-clean (`docs/voice-windows-audit.md`); needs a
  live pass on a Windows box — Brett has no Windows machine, so deferred.
- Pre-existing (not voice): scheduler `job_type` log spam; agent workspace resolves
  to `~/Documents/AI Chief of Staff`.
- Brett's local DB has `voice.enabled = true` from testing — his machine only;
  new users correctly get the `false` default.

## Repos
- **ZEUS** `~/dev/zeus` — isolated voice spike, no remote. Done; mirror of shipped code.
- **AICOS** `~/dev/ai-chief-of-staff` — the real product. On `main`, beta.15 shipped.
