# Video Studio — programmatic video for ACOS (Remotion)

Video Studio is the video capability alongside Content Writer / Ad Creator. A
sidebar button opens a setup panel; the user picks a **brand** and an **aspect
ratio**, clicks **Create a Video**, and the agent designs → builds → renders a
branded MP4 with [Remotion](https://www.remotion.dev/) (React-based programmatic
video). Finished videos land in `~/Desktop/Videos/YYYY-MM-DD-<slug>/`, mirroring
how Content Writer drops blogs.

## The key architectural decision: Remotion is EXTERNAL

**Remotion renders in an external workspace project, driven by the agent's
shell — it is NEVER bundled into the signed app.**

- The workspace lives at `~/dev/_video-studio/` — a real Remotion v4 project,
  scaffolded once on first use. The agent writes compositions there and renders
  with `npx remotion render`.
- The signed `.app` gains **zero** heavy native deps. We do **not** add
  `@remotion/renderer`, a headless Chromium, or ffmpeg to the bundle.
- **Why:** `@remotion/renderer` pulls a Chrome Headless Shell (~150 MB) +
  ffmpeg. Bundling that into a notarized DMG is exactly the build-size / signing
  pain `RECOVERY.md` warns about (asset timeouts, stapling fragility). Keeping
  Remotion in `~/dev/` keeps the DMG lean and notarization untouched.
- **Cost:** the first render downloads a Chrome Headless Shell into the
  workspace (one-time, on the user's machine, ~150 MB). Invisible after the
  first run. The panel surfaces a "prepared on first run" state.

Rejected alternative — bundling `@remotion/renderer` into the app: heavier DMG,
a new notarization surface, against the lean-build ethos. Not now.

> **Gotcha for future sessions:** Remotion is external. Never add the renderer
> or a headless Chromium to `build.files` / `extraResources`. Only the
> `SKILL.md` ships as an app asset.

## Workspace layout

```
~/dev/_video-studio/
├── package.json            # Remotion v4 + React 18 (deps installed here, not in the app)
├── tsconfig.json
├── remotion.config.ts
├── src/
│   ├── index.ts            # registerRoot(RemotionRoot)
│   ├── Root.tsx            # <Composition> registrations (agent edits this)
│   ├── brand.json          # name/slug/site_url/business from the session brand
│   └── remotion/
│       └── compositions/   # the agent writes compositions here
├── public/                 # staticFile() assets (generated images, etc.)
├── out/                    # raw render target (out/<slug>.mp4)
└── .agents/skills/remotion/SKILL.md   # the bundled best-practices skill, copied in
```

## Aspect ratios

The panel offers three, persisted to `localStorage` (`vs-aspect`, default
`9:16`) and stamped into the kickoff recipe so the agent sets the composition
dimensions correctly:

| Aspect | Pixels      | Where it posts            |
| ------ | ----------- | ------------------------- |
| 9:16   | 1080 × 1920 | Reels / TikTok / Shorts   |
| 16:9   | 1920 × 1080 | YouTube / landscape web   |
| 1:1    | 1080 × 1080 | Feed posts                |

`fps` defaults to 30. The mapping lives in `src/tools/video-shared.ts`
(`ASPECTS`).

## The two tools

Both are registered in `src/tools/index.ts` `getCustomTools()` and shell out to
the workspace — they never touch the app's `better-sqlite3` or other native
deps.

### `scaffold_video_project` (`src/tools/video-scaffold.ts`)

Idempotent. Ensures `~/dev/_video-studio` exists as a Remotion project: writes a
minimal deterministic template on first run and `npm install`s it; on every run
copies the bundled `SKILL.md` into `.agents/skills/remotion/SKILL.md` and
refreshes `src/brand.json` from the session's brand. Returns
`{ ready, workspacePath, skillPath, remotionVersion, didScaffold }`.

We deliberately write the template directly rather than invoking the interactive
`create-video` scaffolder (which prompts for a template and would hang a
non-interactive tool).

### `render_video` (`src/tools/video-render.ts`)

Inputs `{ compositionId, propsJson?, slug, aspect }` where `aspect` ∈
`9:16 | 16:9 | 1:1`. Runs `npx remotion render <compositionId> out/<slug>.mp4`
in the workspace, copies the MP4 to `~/Desktop/Videos/<date>-<slug>/<slug>.mp4`,
and writes a `video.md` summary (composition, aspect + dimensions/fps,
per-platform posting notes). Returns `{ success, videoPath, folderPath, error? }`.
Hard rule: refuses any output path inside an `.app` bundle.

## The recipe (panel → agent)

The panel boots a **"Video Studio"** session in **coder** mode (best for TSX +
running renders), sets the brand, and drops a verbatim kickoff recipe with the
chosen aspect interpolated in. Steps:

1. Read the Remotion skill; confirm the hard rules.
2. Confirm the brief (objective, message/CTA, duration, assets, brand). The
   aspect is already chosen in the panel.
3. Propose a scene-by-scene plan → `[[VS_STATE:ready_for_approval]]`, stop.
4. On `__VS_APPROVE__`: `scaffold_video_project`, write the composition under
   `src/remotion/`, register it in `src/Root.tsx` with the chosen dimensions.
5. Generate any still images via `generate_blog_image` into `public/`.
6. Sanity-check one frame with `npx remotion still`; show it.
7. `render_video` → MP4 on the Desktop.
8. Report path + posting notes → `[[VS_STATE:done]]`.

**Hard rules baked into the prompt:** frame-based animation only (no CSS
transitions/animations, no Tailwind `animate-*`); determinism (no `Math.random`
/ `Date.now`); files under `src/remotion/`; never write into the installed
`.app`; never auto-publish — draft only.

The `[[VS_STATE:…]]` markers are parsed in `ui/chat/video-studio-panel.js`
(`_vsHandleAssistantMessage`, hooked from `ui/chat/messaging.js`) to render the
Approve / Request-changes inline buttons, and stripped from the displayed
bubble.

## First-render note

The first `render_video` lazily downloads a Chrome Headless Shell (~150 MB) into
the workspace and can take several minutes. Subsequent renders are fast. The
first `scaffold_video_project` also runs `npm install` (a few minutes, one
time).

## The bundled skill asset

`assets/skills/remotion/SKILL.md` is the canonical Remotion best-practices guide
(frame-based animation, individual transform keys, determinism / `random()`,
`staticFile()`, `spring()` vs `interpolate()`, named exports, `src/remotion/`
layout). It ships via the existing `assets/**` build globs (`build.files` +
`extraResources` → `Resources/assets/`) and is copied into the workspace on
scaffold. `resolveBundledSkill()` in `video-shared.ts` resolves it under
`process.resourcesPath/assets/...` when packaged, else the repo root.
