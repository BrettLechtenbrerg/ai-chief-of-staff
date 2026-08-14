# Security and Release Audit — 2026-08-10

## Release decision

**Mac beta.25 is a public GitHub prerelease after immutable tag-build provenance, artifact verification, protected private-draft review, and exact run-artifact Intel acceptance.** Protected draft run `31849210095` and publish run `31850297453` produced release `370865321`. The public scope excludes every beta.23/beta.25 Windows candidate and keeps Windows updater clients pinned to the verified beta.20 x64 fallback. Apple Silicon has build-gate verification but no real-device acceptance. The historical findings below describe the original `58e0425` baseline, and the private beta.23 draft remains unchanged.

## Reproducible baseline

Recorded on 2026-08-10 before implementation:

- Repository: `BrettLechtenbrerg/ai-chief-of-staff`
- Branch/commit: clean `main` at `58e0425`, matching `origin/main`
- Latest tag: `v1.0.0-beta.22`
- beta.22 published: 2026-07-08 as a prerelease
- beta.22 Mac assets use beta.22; its Windows assets mirror beta.20
- Website repository: clean `main` at `738a3d7` before the x64-link hotfix
- Active GitHub account: `BrettLechtenbrerg`
- Tester page: `https://www.totalsuccessai.com/hidden/ai-chief-of-staff-app`
- Repository URLs and release assets are served directly by GitHub Releases; the website does not proxy installer bytes

## beta.25 filtered release assessment

- **Provenance:** immutable tag `v1.0.0-beta.25`, commit `94a61cb579ef6b86c6755aa07475de42c2f37250`, and successful `.github/workflows/build.yml` run `31603383781`. The publication workflow requires the current tag commit, source-run SHA, tag branch, successful conclusion, build-workflow path, and exact unexpired Mac artifact to agree before download.
- **Mac artifact integrity:** `SHA256SUMS-macos.txt` and rebuilt `latest-mac.yml` match the clean workflow download. The Intel DMG SHA-256 is `66e51d13006bbcae595d8af8d86d53ab4a0f56febf3a50d3357388f741497514`; Apple Silicon is `3407655c7c3d743f8e6f4327a3d0dd650d67687043a29ac3e0045fdb9153e7d3`. Both app bundles pass native-module architecture, strict Developer ID/team, Gatekeeper, and notarization-staple checks.
- **Accepted Mac scope:** the Intel iMac installed the exact run-`31603383781` x64 DMG, preserved history/facts, completed Claude and GPT typed chat, dictation, two interactive Voice turns, database backup, and restart persistence on beta.25. SQLite integrity remained `ok`. The user separately confirmed manual input and Voice behavior.
- **Remaining Apple Silicon limitation:** the arm64 artifact passed architecture/signature/Gatekeeper/notarization build gates, but no real Apple Silicon device completed startup or feature acceptance. The release copy must state that limitation rather than imply real-device coverage.
- **Deferred Windows scope:** the beta.25 Windows artifact is not downloaded, checked, uploaded, or referenced by either updater manifest. Its separate Voice/API-key and model-discovery acceptance remains open. No beta.23 Windows artifact is eligible either.
- **Pinned Windows fallback:** only `AI-Chief-of-Staff-1.0.0-beta.20-x64-setup.exe` from public release `v1.0.0-beta.22` is mirrored. GitHub's published size/digest and downloaded bytes must equal 324,192,956 bytes and SHA-256 `7464181a0dbb60bdce8aa3b9948ba164898b326aff84703c94468cf919c46d6e`; its blockmap is separately pinned to SHA-256 `a05235bed923ada2f4313bd3455389521726dc249d427e39fba0db060e273134`. `latest.yml` reports beta.20 and contains exactly one x64 installer entry.
- **Promotion control:** `.github/workflows/publish-mac-only-release.yml` runs from `main` in the protected `release` environment. Draft mode refuses a public overwrite and verifies the resulting exact asset inventory. Publish mode requires a second explicit confirmation and compares every private-draft asset size/SHA-256 to freshly reconstructed verified local assets before changing `draft` to `false`.

## Confirmed security findings (baseline; remediated or explicitly dispositioned on current `main`)

| Severity | Boundary | Confirmed risk | Required release gate |
| --- | --- | --- | --- |
| Critical | Renderer dependencies and secrets | Six privileged local pages execute jsDelivr scripts allowed by CSP, while shared preload/settings IPC can return decrypted provider and OAuth data. | Bundle exact renderer dependencies locally, remove remote executable sources, keep secret values main-process-only, and test the boundary. |
| Critical | Agent tool authorization | Mode `allowedTools` are not enforced; non-Coder modes receive shell/file/subagent/custom/MCP tools, and Coder receives custom/MCP tools too. | Capability registry, enforced mode policy, user-originated approvals, and fail-closed unattended execution. |
| High | IPC authorization | Most `ipcMain.handle` registrations do not validate exact sender frame/window/page/channel. | Central trusted registration helper and complete handler migration. |
| High | Files and network input | Prefix-based containment permits sibling escapes; main process fetches arbitrary remote images; attachment/media payloads are unbounded. | Canonical containment plus symlink tests, no main-process remote image download, and strict payload/type/time limits. |
| High | Local private data | Renderers receive decrypted secrets; AEO uses plaintext credentials; SQLite/private history lacks a uniform `0600` and backup policy. | Encrypted main-only credentials, permission gate, and rotating SQLite-safe backups. |
| High | MCP and automation | One-click connectors use mutable `npx -y`; MCP annotations are not an authorization boundary; scheduler gets broad tools. | Pin packages, preserve annotations, require confirmation for unknown/external tools, and default scheduled runs to safe capabilities only. |
| Medium | Logging | Tool wrappers log the first 200 input characters, exposing private content in logs. | Log only redacted structural metadata, status, and duration. |
| Medium | Electron hardening | Electron 41, implicit permission behavior, sandbox ambiguity, ASAR off, and unhardened fuses increase attack surface. | Electron 43, explicit sandbox, deny-by-default permissions, then ASAR/fuses only after packaged compatibility tests. |
| Medium | CI/release | Broad write permissions, mutable action tags, `npm install`, stale artifact names, and no native/checksum/manual gate undermine provenance. | Least privilege, immutable SHAs, `npm ci`, native checks, checksums, current names, and manual publish approval. |

### Explicit platform-hardening disposition

Electron 43, explicit renderer sandboxing, deny-by-default permissions, and chat-only microphone access are implemented. ASAR/integrity fuses remain deferred to beta.24 because beta.23 still relies on unpacked bundled MCP/native resources and `RunAsNode`; they must not be enabled until packaged MCP, ffmpeg, browser automation, native-module, and updater compatibility is proven under that layout. This is a documented deferral from the approved plan, not a bypassed beta.23 gate.

Runtime `npx` connectors now use exact pinned package versions (`dataforseo-mcp-server@2.9.11`, `firecrawl-mcp@3.23.8`, and `mcp-remote@0.1.38`) rather than mutable latest tags. Version updates require a reviewed ACOS release.

## Dependency audit

Commands run against the committed lockfile state:

```sh
npm audit --omit=dev --json
npm audit --json
npm outdated --json
npm audit fix
```

### Before safe fixes

- Production: 18 advisories — 1 critical, 13 high, 3 moderate, 1 low.
- All dependencies: 32 advisories — 1 critical, 27 high, 3 moderate, 1 low.
- The critical `tar` chain and all low/moderate advisories had non-breaking lockfile fixes.

### After release-gate remediation

- Production: **0 high, 0 critical, 0 moderate, 0 low** (`npm audit --omit=dev`, August 10, 2026).
- All dependencies: **0 advisories** (`npm audit`, August 10, 2026).
- `npm audit fix` first updated patched packages within declared ranges, including `tar`, electron-builder/updater chains, MCP SDK, `ws`, `vite`, `undici`, and `hono`.
- Electron then moved to 43.3.0 and the native SQLite dependency moved to better-sqlite3 13.0.3.
- PDF.js moved to 6.2.108 and officeparser to 7.5.1. ACOS uses officeparser's current AST `toText()` API and PDF.js's current loading-task lifecycle.
- sharp/libvips moved to 0.35.3. An npm override keeps the gg-core and Hugging Face transitive paths on that patched version; image encode/decode smoke tests pass.
- `@kenkaiiii/ggcoder` remains pinned exactly to compatible 4.3.151. Its deferred 5.x migration is not needed to clear the advisory chain and remains isolated from beta.23.
- Full tests pass after the breaking dependency remediation; no non-reachability exception is requested or accepted.

## AEO release assessment

`fetch_aeo_visibility` now uses encrypted main-process provider settings, strict 25-prompt schema validation, an explicit preview/approval for up to 75 paid requests, 30-second aborts with bounded retries, cancellation/progress heartbeats, normalized exact-host citation matching, atomic `0600` reports, and regression tests.

## Voice release assessment

Voice now preserves OpenAI Realtime as ears/mouth and the normal ACOS agent as the reasoning/tool brain. The main process pins `gpt-realtime-2.1`, exposes bounded compatibility diagnostics, and falls back to transcription → normal agent → local speech. Only exact recognized user speech can resolve a pending approval; model tool arguments cannot. The microphone remains explicit-toggle only.

## Windows release assessment

The prior website linked the 641,626,761-byte universal installer despite stating x64 requirements. The live hotfix now links the 324,192,956-byte beta.20 x64 installer mirrored under beta.22 and displays SHA-256 `7464181a0dbb60bdce8aa3b9948ba164898b326aff84703c94468cf919c46d6e`.

The isolated local Docker path, native Windows x64 CI package, PE machine validation, full tests/native SQLite probe, afterPack verification, checksums, PowerShell rescue collector, and production Azure Authenticode signature pass. Tag run `31497949376` produced installer SHA-256 `676aad7d359b47cf7afd4fb683c955f01623f67c399f96ab96be09bd04b91df1`; independent extraction verified 24 native modules as x64. Download verification caught the generated `latest.yml` referencing unpublished universal/ARM64 installers, so the publication gate now atomically rebuilds and verifies an x64-only manifest from the final signed installer. Publication remains blocked until a tester completes the installed Windows startup/chat/voice/AEO acceptance pass. SmartScreen reputation cannot be solved by website changes.

## beta.23 release gates

- [x] No remote renderer scripts; renderer IPC cannot read secret values.
- [x] Exact trusted sender policy on every IPC handler.
- [x] Tool snapshots prove per-mode allowlists; indirect content cannot cross approval boundaries.
- [x] Scheduled/Telegram runs fail closed for confirmation-required actions.
- [x] AEO paid requests, encrypted credentials, timeouts/retries/progress, and citation matching are tested.
- [x] Realtime and forced-failure fallback voice flows can run/cancel/approve/deny safely.
- [x] Production and nested Flo runtime audits report zero advisories.
- [x] Typecheck, lint, 1,321 tests, Node ABI sequence, Electron ABI restoration, and native-module verification pass.
- [x] Signed/notarized Mac and native Authenticode-signed Windows x64 package/checksum gates pass; updater manifests are atomically rebuilt from the final signed/stapled bytes before publication.
- [x] Mutable runtime connector package tags are replaced with exact pinned versions.
- [x] ASAR/integrity fuse work is explicitly deferred to beta.24 pending packaged compatibility proof; `RunAsNode` remains required for bundled MCP servers.
- [x] GitHub macOS certificate/notary secrets and Azure Artifact Signing OIDC/profile are configured and proven in native preflight builds.
- [x] GitHub `release` environment requires Brett's approval before publication.
- [x] Immutable `v1.0.0-beta.23` tag was created before native signed builds; tag run artifacts and checksums were independently downloaded and verified.
- [x] Real Intel Mac acceptance passed: startup/history, healthy GPT chat, multi-question voice, private backup, and AEO paid-action denial.
- [ ] Complete real Windows x64 tester acceptance before publication/website promotion.
