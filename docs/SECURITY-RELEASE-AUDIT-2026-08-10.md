# Security and Release Audit — 2026-08-10

## Release decision

**Implementation gates are complete on `main`; publication is still blocked on production signing credentials and real tester acceptance.** The historical findings below describe the original `58e0425` baseline. Beta.23 remains a trust-and-voice release, and the gg-agent 4 → 5 migration remains deferred.

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

## Confirmed security findings (baseline; remediated on current `main`)

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

The isolated local Docker path, native Windows x64 CI package, PE machine validation, full tests/native SQLite probe, afterPack verification, checksums, updater metadata, and PowerShell rescue collector now pass (run `31432214558`). Publication remains blocked until a production Windows Authenticode certificate is configured and a tester completes the installed startup/chat/voice/AEO acceptance pass. SmartScreen reputation cannot be solved by website changes.

## beta.23 release gates

- [x] No remote renderer scripts; renderer IPC cannot read secret values.
- [x] Exact trusted sender policy on every IPC handler.
- [x] Tool snapshots prove per-mode allowlists; indirect content cannot cross approval boundaries.
- [x] Scheduled/Telegram runs fail closed for confirmation-required actions.
- [x] AEO paid requests, encrypted credentials, timeouts/retries/progress, and citation matching are tested.
- [x] Realtime and forced-failure fallback voice flows can run/cancel/approve/deny safely.
- [x] Production and nested Flo runtime audits report zero advisories.
- [x] Typecheck, lint, 1,315 tests, Node ABI sequence, Electron ABI restoration, and native-module verification pass.
- [x] Local packaged x64 Mac startup and native Windows x64 package/checksum/updater gates pass.
- [ ] Configure GitHub macOS certificate/notary and Windows production Authenticode secrets.
- [ ] Create the tag before builds, then complete real Mac + Windows tester acceptance before publication/website promotion.
