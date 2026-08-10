# Security and Release Audit — 2026-08-10

## Release decision

**Do not release commit `58e0425` or the current worktree as beta.23 until the release gates below pass.** Beta.23 is a trust-and-voice release. The gg-agent 4 → 5 migration is explicitly deferred to a separate compatibility branch.

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

## Confirmed security findings

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

### After safe fixes

- Production: 5 high, 0 critical, 0 moderate, 0 low.
- All dependencies: 5 high, 0 critical, 0 moderate, 0 low.
- `npm audit fix` updated the lockfile within declared ranges, including the patched `tar`, Electron 41.10.4, electron-builder/updater chains, MCP SDK, `ws`, `vite`, `undici`, `hono`, and related transitive packages.
- npm initially selected `@kenkaiiii/ggcoder` 4.15.0 under the prior caret range, but that release changed `createTools()` to async and broke current callers. The dependency is now pinned exactly to the known-compatible 4.3.151; typecheck passes.

### Blocked breaking upgrades

These remaining advisories are release blockers, not accepted risk:

1. **PDF.js (`GHSA-hq66-cqwq-w95j`)** — direct `pdfjs-dist` 5.7.284 and `officeparser` 6.1.1 depend on affected PDF.js. The fix requires PDF.js 6.2.108 and likely officeparser 7.x compatibility work. Until migrated and malicious-PDF regression tests pass, document/PDF parsing must be treated as unsafe for release.
2. **sharp/libvips (`GHSA-f88m-g3jw-g9cj`)** — direct sharp 0.34.5 and the gg-core → Hugging Face chain depend on affected sharp. The fix requires sharp 0.35.3, which npm classifies as breaking. Upgrade and image/model smoke tests are required.
3. **ggcoder transitive chain** — npm proposes downgrading `@kenkaiiii/ggcoder` to 4.2.22 to evade the affected dependency range. That is not a valid remediation for current functionality. The planned gg-agent/gg-ai/ggcoder 5.x migration remains deferred, but the sharp override/compatible 4.x resolution must remove this advisory before beta.23.

No production high or critical advisory may remain when beta.23 is tagged unless a non-reachable path is demonstrated with executable test evidence and explicitly approved.

## AEO release assessment

`fetch_aeo_visibility` is useful but blocked from release until it uses encrypted main-process credentials, schema validation, an explicit paid-query preview/approval, per-request aborts and bounded retry/backoff, progress heartbeats, exact normalized-host citation matching, atomic reports, and regression tests.

## Voice release assessment

Preserve OpenAI Realtime as ears/mouth and the normal ACOS agent as the reasoning/tool brain. Use a centralized `gpt-realtime-2.1` primary model with diagnostics and a durable half-duplex transcription → normal agent → local speech fallback. Voice may resolve a pending approval only from recognized user speech; the model may never approve itself. No always-on microphone ships in beta.23.

## Windows release assessment

The prior website linked the 641,626,761-byte universal installer despite stating x64 requirements. The live hotfix now links the 324,192,956-byte beta.20 x64 installer mirrored under beta.22 and displays SHA-256 `7464181a0dbb60bdce8aa3b9948ba164898b326aff84703c94468cf919c46d6e`.

A fresh beta.23 Windows x64 installer remains blocked on isolated reproducible builds, PE machine validation for native modules, native Windows install/startup/chat smoke evidence, checksums/updater verification, and a PowerShell rescue collector. SmartScreen reputation warnings require a production Windows code-signing certificate; they cannot be solved by website changes.

## beta.23 release gates

- No remote renderer scripts; renderer IPC cannot read secret values.
- Exact trusted sender policy on every IPC handler.
- Tool snapshots prove per-mode allowlists; indirect prompt injection cannot cross approval boundaries.
- Scheduled/Telegram runs fail closed for confirmation-required actions.
- AEO paid requests, encrypted credentials, timeouts/retries/progress, and citation matching are tested.
- Realtime and forced-failure fallback voice flows can run/cancel/approve/deny safely.
- Production high/critical audit count is zero or has approved non-reachability evidence.
- Typecheck, lint, full targeted tests, Node ABI sequence, Electron ABI restoration, and native-module verification pass.
- Packaged Mac and native Windows x64 smoke tests pass with checksums and correct updater manifests.
- Tag/manifests precede builds; verified assets precede publication; website copy exactly matches shipped versions.
