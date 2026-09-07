---
name: remotion-best-practices
description: Best practices for writing programmatic video components using Remotion in React. Use this skill when writing animations, handling audio/video assets, or using Remotion hooks like useCurrentFrame and interpolate.
---

# Remotion Best Practices Skill

Use this skill when creating, modifying, or debugging Remotion compositions and components.

## Personal Mac Video Studio workflow

These local integration rules take precedence over generic CLI examples below.

1. Preserve the existing workspace, compositions and assets. Do not repeatedly
   scaffold or reinstall packages. The adapter uses installed Remotion 4.0.484;
   another version needs compatibility review, not an automatic download.
2. Review the storyboard first. Keep all five selected Hook Lab fields verbatim
   as input data; never recreate, silently shorten, or fabricate supporting evidence.
3. Use `render_video` without `previewJobId` to create three preview frames. Inspect
   actual composition dimensions/duration, captions, 10% safe margins, long text,
   brand colors and missing visual/audio assets. Show the returned frames and notes.
4. Stop for explicit preview review. Only then call `render_video` with the returned
   `previewJobId` and identical composition ID, props, slug and aspect. The bundle
   hash and exact inputs must still match. Every execution remains approval-gated.
5. Never bypass this checkpoint with shell rendering. Cancellation belongs to the
   current job; never use broad process kills or remove recoverable artifacts.
6. MP4, captions and summaries are local drafts, never publication permission.
   Requests to post, send, upload or share still require separate exact approval.

`ACOS-Storyboard` is a bundled silent typography preset: pass `elements`
(`verbal`, `text`, `visual`, `audio`, `caption` — the existing Hook Lab fields), `durationSeconds` (1–180),
optional `brandName`, `cta`, and six-digit hex `background`/`foreground`/`accent` in
`propsJson`. Subtitles/SRT derive from `verbal`; the Hook Lab `caption` is post copy,
not a video subtitle, and remains original review data alongside visual/audio notes.
It does **not** pretend to realize visual or sonic directions automatically; these
remain original review notes. Use a custom composition when typography is not an
honest fit. Overlong text, excessive estimated speech rate and low contrast must
be reviewed instead of automatically rewritten. Brand-aware colors must keep
text contrast at least 4.5:1. Platform overlays still need human preview review.

Browser requests are limited to local HTTP asset reads by a job-owned proxy;
place approved assets locally first. The Mac launcher preserves native Chrome
sandbox/site-isolation protections that the installed renderer disables by
standard flags. This is **not** an OS sandbox for arbitrary workspace code; do not
label custom composition execution local-only or exempt it from tool approval.

Limits: two active jobs, at most 100 retained jobs, 20-minute job deadlines,
1 GiB/10,000-entry bundles, 2 GiB encoded files, 180-second compositions and disk
reserve checks. No automatic cleanup: archive reviewed artifacts deliberately.
The summary distinguishes counted video duration from AAC-padded container time.

## Core Rules & Constraints

### 1. Frame-Based Animation Is Mandatory

**Rule:** Always animate using frame-based hooks and functions by mapping the current frame to styles.

**Why:** Remotion renders videos frame-by-frame by taking snapshots of components at specific frame numbers. Time-based APIs will not work reliably.

**Forbidden:**

- CSS transitions, such as `transition: all 0.3s`
- CSS animations, such as `animation: spin 2s linear infinite`
- Tailwind animation classes, such as `animate-bounce`, `animate-pulse`, etc.

**Correct Pattern:**

```tsx
import { useCurrentFrame, interpolate } from 'remotion';

export const MyComponent = () => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: 'clamp',
  });

  return <div style={{ opacity }} />;
};
```

### 2. Style Transform Syntax

**Rule:** Prefer specifying transform-related properties individually as distinct keys in the React style object whenever possible.

**Why:** This keeps code cleaner, prevents string parsing errors, and allows Remotion Studio to better parse individual properties.

**Avoid:** Combining multiple transforms into one complex string unless needed as a fallback.

**Less Preferred:**

```tsx
style={{
  transform: `scale(${scale}) rotate(${rotate}deg)`,
}}
```

**Preferred Pattern:**

```tsx
const scale = interpolate(frame, [0, 20], [0, 1]);
const rotate = interpolate(frame, [0, 20], [0, 45]);

return (
  <div
    style={{
      scale,
      rotate: `${rotate}deg`,
    }}
  />
);
```

### 3. Determinism

**Rule:** Every frame must render identically when given the same frame number.

**Forbidden:**

- `Math.random()`
- `Date.now()`
- `new Date()`
- `uuid()` or other non-deterministic ID generators

**Correct Pattern:**

Use Remotion's deterministic `random()` helper.

```tsx
import { random } from 'remotion';

const noise = random('my-seed-value');
```

### 4. Static Assets

**Rule:** Reference assets inside the `public/` directory using Remotion's `staticFile()` helper.

**Why:** This ensures path resolution works correctly across development servers, rendering pipelines, and built sidecars.

**Correct Pattern:**

```tsx
import { staticFile, Video } from 'remotion';

export const IntroVideo = () => {
  return <Video src={staticFile('videos/intro.mp4')} />;
};
```

### 5. Physics and Springs

**Rule:** Use Remotion's `spring()` helper only when a natural physics-based or elastic animation is needed.

For simple linear, eased, fade, scale, or movement animations, use `interpolate()` with `Easing`.

**Correct Spring Pattern:**

```tsx
import { useCurrentFrame, useVideoConfig, spring } from 'remotion';

export const SpringScale = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({
    frame,
    fps,
    config: {
      damping: 12,
    },
  });

  return <div style={{ scale }} />;
};
```

### 6. Named Exports

**Rule:** Export Remotion compositions and components as named exports rather than default exports.

**Correct Pattern:**

```tsx
export const MyComposition = () => {
  return <div>Hello Remotion</div>;
};
```

**Avoid:**

```tsx
export default MyComposition;
```

### 7. File Location

**Rule:** When creating or saving Remotion components, compositions, or assets, save them inside the dedicated Remotion directory for the project.

Use a structure similar to:

```text
src/remotion/
  compositions/
  components/
  assets/
```

Avoid scattering Remotion-specific files throughout unrelated application folders.

## Installation Steps on a New Computer

1. Locate or create a customizations root folder on the new computer. This may be a global customization folder or a local project folder such as `.agents/`.
2. Inside that root folder, create the following subfolders: `skills/remotion/`.
3. Save this markdown content to `<root-path>/skills/remotion/SKILL.md`.
4. If the custom path is not automatically scanned, register the skill in the root `skills.json` file.

Once installed, this skill should be automatically discovered and used whenever working with Remotion components, animations, compositions, video assets, audio assets, or Remotion hooks such as `useCurrentFrame`, `useVideoConfig`, `interpolate`, `spring`, and `staticFile`.

After creating the file, verify that the final path looks like this:

```text
<your-customization-root>/skills/remotion/SKILL.md
```
