/**
 * Shared helpers for the Video Studio tools (scaffold + render).
 *
 * Architectural decision (see docs/VIDEO-STUDIO.md): Remotion renders in an
 * EXTERNAL workspace project under ~/dev/, driven by the agent's shell — it is
 * never bundled into the signed .app. `@remotion/renderer` pulls a headless
 * Chrome shell (~150 MB) + ffmpeg; bundling that into a notarized DMG is the
 * exact build-size / signing pain we avoid. So these tools shell out to a real
 * Remotion project at ~/dev/_video-studio and copy finished MP4s to the
 * Desktop, mirroring how Content Writer drops blogs.
 *
 * Only the Remotion best-practices SKILL.md ships as an app asset (assets/**),
 * and gets copied into the workspace on scaffold.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec } from 'child_process';
import { app } from 'electron';

/**
 * Aspect-ratio presets surfaced in the Video Studio panel. The panel passes one
 * of these keys; the render tool resolves it to pixel dimensions so the agent
 * can't desync the composition size from what the user picked.
 */
export type AspectKey = '9:16' | '16:9' | '1:1';

export interface AspectSpec {
  /** Pixel width. */
  w: number;
  /** Pixel height. */
  h: number;
  /** Human label for the summary doc. */
  label: string;
  /** Where this aspect is typically posted. */
  platforms: string;
}

export const ASPECTS: Record<AspectKey, AspectSpec> = {
  '9:16': { w: 1080, h: 1920, label: 'Vertical (9:16)', platforms: 'Reels, TikTok, Shorts' },
  '16:9': { w: 1920, h: 1080, label: 'Landscape (16:9)', platforms: 'YouTube, landscape web' },
  '1:1': { w: 1080, h: 1080, label: 'Square (1:1)', platforms: 'Feed posts' },
};

/** Default frame rate for rendered videos. */
export const DEFAULT_FPS = 30;

/** True when `aspect` is one of the supported keys. */
export function isAspectKey(aspect: unknown): aspect is AspectKey {
  return aspect === '9:16' || aspect === '16:9' || aspect === '1:1';
}

/**
 * Resolve the Remotion workspace directory. Always under the real local home
 * (`~/dev/_video-studio`) — never an iCloud/Drive-synced path, which would
 * corrupt node_modules and the Chrome shell. We deliberately do NOT honor an
 * env override here so the location is predictable for the panel + docs.
 */
export function resolveVideoWorkspace(): string {
  return path.join(os.homedir(), 'dev', '_video-studio');
}

/**
 * Resolve the bundled Remotion SKILL.md path. In a packaged Electron app,
 * `electron-builder` extraResources copies `assets/` into
 * `Contents/Resources/assets/`, and `process.resourcesPath` points at that
 * `Resources` dir. In dev, the compiled tool lives at `dist/tools/`, so the
 * repo's `assets/` is two levels up. Mirrors src/mcp/bundled-paths.ts.
 */
export function resolveBundledSkill(): string {
  // `app` may be undefined in non-Electron contexts (e.g. isolated unit tests).
  const isPackaged = Boolean(app?.isPackaged);
  const resourcesPath = process.resourcesPath || '';

  const rel = path.join('assets', 'skills', 'remotion', 'SKILL.md');
  if (isPackaged && resourcesPath) {
    return path.join(resourcesPath, rel);
  }
  // dist/tools/video-shared.js -> repo root is two levels up.
  return path.join(__dirname, '..', '..', rel);
}

/** Slug-safe component — lowercase, alphanumeric + dash only, max 80 chars. */
export function slugify(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'video';
}

/** Today's date as YYYY-MM-DD in local time. */
export function todayStamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Dated output directory for a finished video, mirroring Content Writer's
 * ~/Desktop/Blogs/<date>-<slug>/ layout:
 *   ~/Desktop/Videos/YYYY-MM-DD-<slug>/
 */
export function videoOutputDir(slug: string): string {
  return path.join(os.homedir(), 'Desktop', 'Videos', `${todayStamp()}-${slugify(slug)}`);
}

/**
 * Hard rule: refuse any output path inside an installed .app bundle. Renders
 * must land in the user's Desktop folder, never inside the signed app (which is
 * read-only and would break notarization assumptions).
 */
export function isInsideAppBundle(p: string): boolean {
  return /\.app(\/|$)/i.test(path.resolve(p));
}

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Run a shell command inside the workspace with a timeout and captured output.
 * Long-running by design (renders + npm install can take minutes), so callers
 * pass a generous timeout. Never throws on non-zero exit — returns ok:false so
 * callers can surface a clean error + log tail to the user.
 */
export function runInWorkspace(
  cmd: string,
  opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string | undefined> } = {},
): Promise<RunResult> {
  const cwd = opts.cwd || resolveVideoWorkspace();
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000; // 10 min default
  return new Promise((resolve) => {
    exec(
      cmd,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, ...(opts.env || {}) },
      },
      (error, stdout, stderr) => {
        const timedOut = Boolean(error && (error as { killed?: boolean }).killed);
        resolve({
          ok: !error,
          code: error && typeof (error as { code?: number }).code === 'number'
            ? ((error as { code?: number }).code as number)
            : error
              ? 1
              : 0,
          stdout: stdout || '',
          stderr: stderr || '',
          timedOut,
        });
      },
    );
  });
}

/** Last N lines of a log blob — for surfacing render failures concisely. */
export function tailLog(s: string, lines = 40): string {
  const arr = String(s || '').split('\n');
  return arr.slice(Math.max(0, arr.length - lines)).join('\n');
}

/** True if the workspace looks like an initialized Remotion project. */
export function workspaceExists(workspace = resolveVideoWorkspace()): boolean {
  try {
    return (
      fs.existsSync(path.join(workspace, 'package.json')) &&
      fs.existsSync(path.join(workspace, 'node_modules'))
    );
  } catch {
    return false;
  }
}
