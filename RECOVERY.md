# AI Chief of Staff — Recovery & Resume

This is the canonical session-kickoff document. If you're a fresh Claude session, start here.

---

## Standard kickoff prompt

> Let's resume work on **AI Chief of Staff** (Total Success AI's rebranded desktop agent).
>
> **Working directory**: `/Users/brettlechtenberg/dev/ai-chief-of-staff`
> **GitHub**: https://github.com/BrettLechtenbrerg/ai-chief-of-staff
> **Landing page**: https://www.totalsuccessai.com/hidden/ai-chief-of-staff-app
> **Upstream**: https://github.com/KenKaiii/pocket-agent (MIT, fork point `v6.4.3` / commit `a534c63`)
>
> Before starting, please:
> 1. `cd /Users/brettlechtenberg/dev/ai-chief-of-staff`
> 2. Read `CLAUDE.md` and `RECOVERY.md` (this file) for full context.
> 3. `git status` and `git log --oneline -10` to see latest state.
> 4. Before any push, confirm GitHub auth:
>    ```bash
>    gh auth status
>    gh auth switch --user BrettLechtenbrerg   # if not already active
>    ```
>
> **Important rules:**
> - NEVER work in any Google-Drive-synced path. Project home is `~/dev/ai-chief-of-staff`.
> - This is an MIT rebrand of `KenKaiii/pocket-agent`. The `LICENSE` file MUST keep Ken's copyright line. `README.md` MUST credit the upstream.
> - No telemetry. The upstream shipped with `@kenkaiiii/gg-pixel` analytics; we removed it. If you see `gg-pixel` or `buzzbeamaustralia` re-appear anywhere, that is a regression — flag it.
> - Tech stack: Electron + Claude Agent SDK + TypeScript + SQLite + Puppeteer. Builds via `electron-builder` (Mac DMG + Windows NSIS).
> - Brand identity: bundle ID `com.totalsuccessai.ai-chief-of-staff`, npm name `ai-chief-of-staff`, DB folder `ai-chief-of-staff`.

---

## Rollback tags

| Tag | Date | Description |
|-----|------|-------------|
| `v0.1-upstream-import` | May 15, 2026 | Unmodified snapshot of `KenKaiii/pocket-agent` v6.4.3 (commit `a534c63`). Pure reference point. |

To roll back:

```bash
git checkout v0.1-upstream-import   # detached HEAD — branch off if you intend to work
```

---

## Backups

Pattern matches the TSAI-Site convention. All three locations should be refreshed before any major release.

```bash
# Quick source-only zip (excludes node_modules, dist, release)
DATE=$(date +%Y%m%d-%H%M)
ZIP="ai-chief-of-staff-source-${DATE}.zip"
cd /Users/brettlechtenberg/dev
zip -r "_backups/${ZIP}" ai-chief-of-staff \
  -x 'ai-chief-of-staff/node_modules/*' \
  -x 'ai-chief-of-staff/dist/*' \
  -x 'ai-chief-of-staff/release/*' \
  -x 'ai-chief-of-staff/.git/objects/pack/*'

# Mirror to iCloud + external drive
cp "_backups/${ZIP}" "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Backups/AI-Chief-of-Staff/"
cp "_backups/${ZIP}" "/Volumes/Brett's 8 TB/Backups/AI-Chief-of-Staff/" 2>/dev/null || echo "External drive not mounted — skip"
```

| Destination | Path |
|-------------|------|
| Local | `~/dev/_backups/ai-chief-of-staff-source-*.zip` |
| iCloud | `~/Library/Mobile Documents/com~apple~CloudDocs/Backups/AI-Chief-of-Staff/` |
| External drive | `/Volumes/Brett's 8 TB/Backups/AI-Chief-of-Staff/` |
| GitHub | `BrettLechtenbrerg/ai-chief-of-staff` (`origin/main` is source of truth) |

---

## Syncing upstream (when Ken releases a new version)

The repo has no `upstream` remote because we stripped history on import. To pull a future Ken release:

```bash
# 1. Add upstream as a remote (one-time)
git remote add upstream https://github.com/KenKaiii/pocket-agent.git

# 2. Fetch the new tag
git fetch upstream --tags

# 3. Inspect what changed
git log --oneline v6.4.3..upstream/main    # commits since our fork point

# 4. Cherry-pick or manually port the changes we want.
#    DO NOT `git merge upstream/main` — it would re-introduce upstream branding
#    and the gg-pixel telemetry we removed.
```

When in doubt, treat upstream as a reference, not a merge source. Read the diff, apply by hand, re-run our rebrand sweep (see "Rebrand checklist" below) before tagging a release.

---

## Rebrand checklist (run after every upstream sync)

```bash
# 1. No "Pocket Agent" / "pocket-agent" / "pocket_agent" left in user-facing files
grep -rIn "pocket.agent\|pocketagent\|pocket_agent" \
  --include='*.ts' --include='*.tsx' --include='*.js' \
  --include='*.html' --include='*.css' --include='*.json' \
  --include='*.md' --include='*.plist' --include='*.yml' \
  --exclude-dir=node_modules --exclude-dir=.git \
  --exclude=UPSTREAM_CLAUDE.md --exclude=LICENSE .

# 2. No telemetry
grep -rIn "gg-pixel\|buzzbeamaustralia" \
  --exclude-dir=node_modules --exclude-dir=.git .

# 3. Updater points at OUR repo
grep -A2 '"publish"' package.json    # owner must be BrettLechtenbrerg, repo ai-chief-of-staff

# 4. DB path uses our folder name
grep -n "ai-chief-of-staff" src/utils/db-path.ts

# 5. Build still passes
npm run typecheck && npm run lint && npm test
```

---

## Active workstreams

### Now
- **Initial rebrand** — package metadata, DB path, updater target, user-visible strings, README, icons, then smoke test on Mac and push.

### Next
- **Mac signed/notarized build** — needs Apple Developer ID + notarization credentials in env vars. Until then, ship unsigned with "right-click → Open" instructions on the landing page (matches current page copy).
- **Windows build** — `npm run dist:win` from Mac should work with `electron-builder` cross-build, but verify on actual Windows hardware (Brett's son's PC already confirmed runtime works).
- **Landing page wiring** — once first DMG + EXE exist, wire the download buttons on `/hidden/ai-chief-of-staff-app` to the GitHub Release assets.

### Later (new feature work — not in upstream)
The landing page promises features the upstream doesn't ship:
- **SMS reminders** — likely Twilio integration as a new scheduler delivery channel.
- **GHL reminders** — webhook into Brett's GHL workflow.
- **Email reminders** — SMTP delivery channel.
- **Gmail "save draft" flow** — verify upstream's Google Workspace skill actually saves drafts; if not, build it.

These are new code paths, not part of the rebrand. Scope them after the rebrand is shipping cleanly.

---

## Past sessions

### May 15, 2026 — Bootstrap
- Cloned `KenKaiii/pocket-agent` @ v6.4.3 into `~/dev/ai-chief-of-staff`.
- Stripped git history; tagged unmodified snapshot as `v0.1-upstream-import`.
- Wrote `CLAUDE.md` + `RECOVERY.md` (this file). Renamed upstream's `CLAUDE.md` → `UPSTREAM_CLAUDE.md`.
- Began rebrand sweep.
