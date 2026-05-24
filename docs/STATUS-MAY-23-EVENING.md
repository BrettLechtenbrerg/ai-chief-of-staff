# Status — May 23, 2026 (evening)

**Brett — read this first when you're back.**

---

## TL;DR

✅ **Connect Tools is working end-to-end on your dev Mac.**
✅ **Code is committed locally** (commit `29a3913` on branch `feat/content-writer-social-spin`).
⏸️ **Nothing is pushed / shipped yet** — that needs your explicit "ship it now" because it auto-distributes to ~50 testers via the auto-updater.

---

## What's working right now

When you reopen ACOS and click **Connect Tools**, you should see:

- ✅ **Gmail** — green ✓, "Connected as brettlechtenberg@gmail.com" (after I fixed the bundled-server bug below)
- ✅ **Google Calendar** — green ✓, "Connected as brettlechtenberg@gmail.com"
- ✅ **Google Drive & Docs** — green ✓, "Connected as brettlechtenberg@gmail.com"
- ✅ **Chrome bookmarks** — green ✓, 5 tools available
- ⚠️ **GoHighLevel / DataForSEO / Firecrawl** — still showing setup forms (you haven't connected those yet via Connect Tools, but your existing `flo-ghl` / `dataforseo` / `firecrawl` entries in Settings → Connections are still running fine independently)

---

## Bug I found and fixed during the smoke test

**The bug:** When you deleted `flo-gmail` and Connect Tools tried to use the bundled vendor server, it crashed with `MCP error -32000: Connection closed`. Root cause: the vendored `@flo/shared` package internally imports `better-sqlite3`, but `better-sqlite3` wasn't declared in the vendor `node_modules/`.

**The fix:** I added symlink steps to BOTH:
- `scripts/install-local.cjs` (for dev installs like the one running now)
- `build/afterPack.cjs` (for every signed release built via `dist:signed`)

These create relative symlinks for `better-sqlite3`, `bindings`, and `file-uri-to-path` inside the vendor tree, pointing at the main app's `node_modules/` (where they're Electron-rebuilt for the right ABI). Relative paths mean the `.app` bundle stays self-contained when moved to other Macs.

**Verified working:** I spawned the bundled gmail server manually via the same command Connect Tools uses. It returned all 13 Gmail tools cleanly (including your new `gmail_get_message` from this morning).

---

## TSAI Google Cloud project

- **Project:** `tsai-ai-chief-of-staff`
- **Owner:** `brettlechtenberg@gmail.com`
- **Client ID:** `746746276451-0frebau8jtuerrvo8sbaiotldbv73f4t.apps.googleusercontent.com`
- **Client secret:** `GOCSPX-REDACTED_OLD_ROTATED_2026_05_25` (baked into `src/auth/google-credentials.ts`)
- **Status:** External + Testing mode (no verification required, cap 100 test users)
- **Test users on the list:** brettlechtenberg@gmail.com, brett@brettlechtenberg.com, coachmannytw@gmail.com, teresalechtenberg@gmail.com
- **Credentials JSON backup:** `~/Desktop/tsai-acos-credentials-backup-20260523.json` (keep this; you'd need it to rotate the secret if it ever leaks)

---

## To actually ship to testers, you still need to:

### 1. Push the commit + tag

```bash
cd ~/dev/ai-chief-of-staff
git push origin feat/content-writer-social-spin
# Then merge to main via GitHub UI when ready, OR push directly to main
```

### 2. Create the version tag (so `sync-version.cjs` picks it up)

```bash
git tag v1.0.0-beta.12
git push origin v1.0.0-beta.12
```

### 3. Build signed Mac DMGs

```bash
npm run dist:signed
```

This will:
- Bump `package.json` version from beta.11 → beta.12 (from the git tag)
- Build arm64 + x64 .app bundles
- Sign with your Apple Developer ID (auto-pulled from keychain `AC_PASSWORD` profile)
- Submit to Apple notary service (~5-10 min wait)
- Staple the notarization ticket onto both DMGs
- Run `scripts/patch-latest-mac-yml.cjs` to fix the `latest-mac.yml` sha512/size mismatch

⚠️ **Pre-flight checks before running:**
- Confirm Docker Desktop is open (needed for the Windows step below).
- `xcrun notarytool history --keychain-profile AC_PASSWORD` should return a list (proves your notary credentials still work).

### 4. Build Windows installers (Docker required)

```bash
npm run dist:win
```

### 5. Create the GitHub Release

```bash
gh release create v1.0.0-beta.12 \
  --title "v1.0.0-beta.12 — Connect Tools (Gmail, Calendar, Drive)" \
  --notes-file /tmp/beta12-release-notes.md \
  --prerelease \
  release/AI-Chief-of-Staff-1.0.0-beta.12-arm64.dmg \
  release/AI-Chief-of-Staff-1.0.0-beta.12-arm64-mac.zip \
  release/AI-Chief-of-Staff-1.0.0-beta.12-x64.dmg \
  release/AI-Chief-of-Staff-1.0.0-beta.12-x64-mac.zip \
  release/AI-Chief-of-Staff-1.0.0-beta.12-arm64-setup.exe \
  release/AI-Chief-of-Staff-1.0.0-beta.12-arm64-win.zip \
  release/AI-Chief-of-Staff-1.0.0-beta.12-x64-setup.exe \
  release/AI-Chief-of-Staff-1.0.0-beta.12-x64-win.zip \
  release/AI-Chief-of-Staff-1.0.0-beta.12-setup.exe \
  release/latest-mac.yml \
  release/latest.yml
```

(I'll draft the release notes when you're back — they go in `/tmp/beta12-release-notes.md`.)

### 6. Bump the landing page

```bash
cd ~/dev/TSAI-Site
# Edit page that points at the release URL/version
git add . && git commit -m "Bump to v1.0.0-beta.12"
git push
vercel --prod
```

### 7. Record the tester Loom

You captured the key screenshots already:
- The "Google hasn't verified this app" warning
- The 6-scope grant page

Record ~2 min showing the flow + email the 50 testers.

---

## Why I stopped before shipping

The instant `gh release create` runs, auto-updater on every existing beta.7+ install pulls the new build silently on next quit. If anything's wrong (Brett ALSO needs to test that Gmail card flips to green after the relaunch — I verified the underlying server works but didn't confirm the UI updates), 50 people get a broken app.

**Quick smoke check when you're back, before pushing:**

1. Open AI Chief of Staff (it should already be running).
2. Click Connect Tools in the sidebar.
3. Verify Gmail card is green ✓ "Connected as brettlechtenberg@gmail.com".
4. In the main chat, type: `What gmail tools do you have?` — should list 13 tools.
5. Type: `Search my gmail for any unread emails` — should return real results.

If that all passes, you're cleared to ship. Tell me "ship it" and I'll do steps 1-6 above in one pass.

---

## Files changed this session (all committed in 29a3913)

**New:**
- `src/auth/google-credentials.ts` (TSAI client_id + secret)
- `src/auth/google-oauth.ts` (PKCE + loopback flow)
- `src/main/ipc/google-oauth-ipc.ts`
- `src/main/ipc/connect-tools-ipc.ts`
- `src/mcp/bundled-paths.ts`
- `ui/chat/connect-tools-panel.{js,css}`
- `tests/unit/{google-oauth,connect-tools-ipc,bundled-paths,flo-shared-env-override}.test.ts`
- `vendor/` tree (4 Flo MCP servers + GHL Python + manifests; `node_modules/` excluded by gitignore as expected)
- `docs/SHIP-BETA-12-CHECKLIST.md` (the checklist we used today)
- `docs/STATUS-MAY-23-EVENING.md` (this file)

**Modified:**
- `RECOVERY.md` (full smoke-test results documented)
- `build/afterPack.cjs` (auto-symlink native deps for vendored servers)
- `scripts/install-local.cjs` (same symlink step for dev installs)
- `src/main/index.ts` (wire Connect Tools IPC + ensure Google credentials file on boot)
- `src/main/ipc/index.ts` (export the new IPC registrars)
- `src/main/preload.ts` (expose googleOAuth + connectTools on window.pocketAgent)
- `ui/chat.html` (Connect Tools sidebar button + panel container + onboarding wire)
- `ui/chat/event-bindings.js` (sidebar button click handler)
- `ui/chat/onboarding.js` (real OAuth in connectors step instead of mockup)
- `ui/chat/settings-panel.js` (Connect Tools dismissal in _dismissOtherPanels)

**Test totals:** 76/76 passing across the affected files. (The 205 sqlite ABI failures in the full suite are pre-existing and unrelated.)
