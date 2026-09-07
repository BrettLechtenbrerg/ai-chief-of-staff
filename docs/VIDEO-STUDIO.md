# Video Studio — programmatic video for ACOS (Remotion)

Video Studio is the video capability alongside Content Writer / Ad Creator. A
sidebar button opens a setup panel; the user picks a **brand** and an **aspect
ratio**, clicks **Plan a Video**, and reviews a storyboard and rendered previews
before requesting the final local MP4. Finished videos land in unique private
folders under `~/Desktop/Videos/`. Publication remains separately approval-gated.

## The key architectural decision: Remotion is EXTERNAL

**Remotion dependencies stay in the external workspace; an argv-launched owned
Node worker renders through the installed APIs, not shell strings or npx.**

- The workspace lives at `~/dev/_video-studio/` — a real Remotion v4 project,
  scaffolded once on first use. Custom compositions stay there. The bundled
  `ACOS-Storyboard` preset creates per-job files without changing existing sources.
- The signed `.app` gains **zero** heavy native deps. We do **not** add
  `@remotion/renderer`, a headless Chromium, or ffmpeg to the bundle.
- **Why:** `@remotion/renderer` pulls a Chrome Headless Shell (~150 MB) +
  ffmpeg. Bundling that into a notarized DMG is exactly the build-size / signing
  pain `RECOVERY.md` warns about (asset timeouts, stapling fragility). Keeping
  Remotion in `~/dev/` keeps the DMG lean and notarization untouched.
- **This personal build:** uses already-installed Chrome and pinned Remotion
  4.0.484; rendering never installs dependencies or browsers. Missing requirements
  produce an error, not a download. Individual operation is recorded in COMPLIANCE.md.

Rejected alternative — bundling `@remotion/renderer` into the app: heavier DMG,
a new notarization surface, against the lean-build ethos. Not now.

> **Gotcha for future sessions:** Remotion is external. Never add the renderer
> or a headless Chromium to `build.files` / `extraResources`. The small skill,
> owned-job helpers and local storyboard template ship through existing asset globs.

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
├── out/acos-jobs/<uuid>/    # private inputs, previews, bundle, MP4 and recovery notes
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

Both are registered in `src/tools/index.ts` `getCustomTools()`. They use the
external workspace, never the app's SQLite connection. Arbitrary workspace
execution remains desktop-approval-gated; a model marker is not consent.

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

Inputs `{ compositionId, propsJson?, slug, aspect, previewJobId? }`, where aspect
is `9:16 | 16:9 | 1:1`. Without `previewJobId`, return three verified PNGs and
`status: preview_ready`. After explicit review, repeat the exact inputs plus the
preview job ID. Normalized inputs and bundle digest must still match.

The owned worker validates composition metadata, renders with real frame progress,
then parses the encoded MP4 to check dimensions, FPS, frame count and duration.
Only then are exclusive copies and `video.md` placed in a unique output folder.
The silent typography preset also exports deterministic SRT derived from verbal
text; post captions are not substituted for speech. Arbitrary projects may supply
their own media, but no automatic narration or fabricated visual/audio asset is implied.

Abort propagates to the owned process tree, with bounded escalation. Failures
retain artifacts and a recovery path. Limits include two jobs, 100 retained jobs,
180 seconds, 64 KiB props, bounded bundles/outputs and disk reserves. No automatic
purge, overwrite or `.app` output is permitted.

## The recipe (panel → agent)

The panel boots a **"Video Studio"** session (kind `automation`, like Content
Writer — the agent's tool mode is global, not set by the session kind), sets the
brand, and drops a verbatim kickoff recipe with the chosen aspect interpolated
in. Steps:

1. Read the Remotion skill; confirm the hard rules.
2. Confirm the brief (objective, message/CTA, duration, assets, brand). The
   aspect is already chosen in the panel.
3. Propose a scene-by-scene plan → `[[VS_STATE:ready_for_approval]]`, stop.
4. On `__VS_APPROVE__`: `scaffold_video_project`, write the composition under
   `src/remotion/`, register it in `src/Root.tsx` with the chosen dimensions.
5. Generate any still images via `generate_blog_image` into `public/`.
6. Call `render_video` without `previewJobId`; show returned frames, safe-area,
   caption and verified-metadata checks; stop at `[[VS_STATE:preview_ready]]`.
7. On `__VS_RENDER_PREVIEW__`, call with the exact reviewed inputs and job ID.
8. Only after verified success report the local MP4/captions/recovery paths and
   posting notes; emit `[[VS_STATE:done]]`. Neither review grants publication consent.

**Hard rules baked into the prompt:** frame-based animation only (no CSS
transitions/animations, no Tailwind `animate-*`); determinism (no `Math.random`
/ `Date.now`); files under `src/remotion/`; never write into the installed
`.app`; never auto-publish — draft only.

The `[[VS_STATE:…]]` markers are parsed in `ui/chat/video-studio-panel.js`
(`_vsHandleAssistantMessage`, hooked from `ui/chat/messaging.js`) to render the
Approve / Request-changes inline buttons, and stripped from the displayed
bubble.

## First-render note

Rendering does not download anything. Existing installations are preserved;
scaffolding, when genuinely needed, is a separate approved execution that may run
npm. Current personal-build timings and native failure/cancellation evidence are
in `LOCAL-IMPROVEMENT-REVIEW.md`; no universal speed claim is implied.

## The bundled skill asset

`assets/skills/remotion/SKILL.md` is the canonical Remotion best-practices guide
(frame-based animation, individual transform keys, determinism / `random()`,
`staticFile()`, `spring()` vs `interpolate()`, named exports, `src/remotion/`
layout). It ships via the existing `assets/**` build globs (`build.files` +
`extraResources` → `Resources/assets/`) and is copied into the workspace on
scaffold. `resolveBundledSkill()` in `video-shared.ts` resolves it under
`process.resourcesPath/assets/...` when packaged, else the repo root.

## Hook Lab local selection review (step 9)

Hook Lab can explicitly hand off a user-pasted/edited five-element draft via
`hl-video-draft-v1` localStorage, separate from `hl-combinations-v1` saved choices.
Video Studio validates and displays exact text/context/brand on each open, even
in a new chat session. No model re-creation, publishing approval, automatic
context retrieval, storyboard or render occurs on handoff. Plan a Video includes
the exact five selected fields as data and explicitly sets or clears the session
brand. The draft is retained. Invalid storage or failed branding blocks kickoff
without losing the draft; corrections remain in Hook Lab. The preset treats the
visual/audio directions as review data, not evidence those assets were created.
