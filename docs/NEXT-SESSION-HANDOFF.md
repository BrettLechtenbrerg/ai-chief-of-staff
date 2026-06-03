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

## ✅ ADDRESSED: testers can connect THEIR GoHighLevel (GHL) accounts
**Brett's explicit ask — tester GHL connect — is now implemented (code-complete,
dev-verified; live tester pass + signed-build smoke still pending a build).**

What shipped (this session):
- The GHL Connect Tools card now spawns a **vendored Node MCP server**
  (`vendor/ghl-mcp-node/index.js`) via Electron's bundled Node
  (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`) — the **same model as the Flo
  servers**. **No Python runtime required.** The Python `vendor/ghl-mcp/main.py`
  is retired in favor of the Node port (kept on disk as reference only this round).
- The Node port reproduces **all 91 tools** with identical names, args, REST
  endpoints, bodies, headers, and error/truncation behavior (parity-gated by
  `tests/unit/ghl-node-server.test.ts`; boot verified to serve 91 tools over MCP
  stdio). Auth unchanged: two fields — **Private Integration Token** (`pit-...`)
  + **Location ID** — written under the canonical `ghl-mcp` entry.
- GHL is **no longer hidden on Windows** (`unavailableOnWindows` removed; the
  Python dependency that motivated it is gone). Windows: code-clean, needs a
  live pass on a Windows box (deferred with voice — no Windows hardware).
- Brett's hand-managed `flo-ghl` / `flo-ghl-brett` venv entries still resolve to
  "Connected" (aliases preserved); zero forced change to his workflow.

Still to do before telling testers:
- Live dev connect with a real `pit-…` + Location ID → card flips Connected,
  91 tools, one live read + one live write (do in `npm run dev`).
- Signed-build smoke at ship time: confirm
  `Contents/Resources/vendor/ghl-mcp-node/index.js` + its
  `node_modules/@modelcontextprotocol` are inside the notarized `.app` and a
  connect succeeds from the installed build.

**Files:** `vendor/ghl-mcp-node/` (server + `refresh.sh`),
`src/mcp/bundled-paths.ts` (`resolveGhlNodePath`),
`src/main/ipc/connect-tools-ipc.ts` (the `ghl` Node-spawn entry),
`vendor/VENDORED.md`, and the Connect Tools panel UI
(`ui/chat/connect-tools-panel.js`).

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
