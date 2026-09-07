import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
const state = vi.hoisted(() => ({ root: '', run: vi.fn(), worker: vi.fn(), validMetadata: false, failCopy: false, freeBytes: 20 * 1024 ** 3 }));
vi.mock('electron', () => ({ app: { isPackaged: false } }));
vi.mock('../../src/tools/video-shared', async (original) => ({
  ...await original<typeof import('../../src/tools/video-shared')>(),
  resolveVideoWorkspace: () => path.join(state.root, 'workspace'),
  videoOutputDir: () => path.join(state.root, 'destination'),
  runInWorkspace: state.run,
}));
vi.mock('../../src/tools/video-job-process', () => ({ runVideoJobProcess: state.worker }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual,
    access: (file: fs.PathLike, mode?: number) => String(file) === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' ? Promise.resolve() : actual.access(file, mode),
    statfs: async (file: fs.PathLike) => ({ ...await actual.statfs(file), bsize: 1, bavail: state.freeBytes }),
    copyFile: (from: fs.PathLike, to: fs.PathLike, flags?: number) => {
      if (state.failCopy && path.basename(String(from)) === 'video.mp4') return Promise.reject(new Error('inert copy failure'));
      return actual.copyFile(from, to, flags);
    },
  };
});
import { renderVideo } from '../../src/tools/video-render';
const input = { compositionId: 'Example', slug: 'draft', aspect: '9:16' as const };
beforeEach(() => {
  state.root = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-video-test-'));
  state.validMetadata = false; state.failCopy = false; state.freeBytes = 20 * 1024 ** 3;
  fs.mkdirSync(path.join(state.root, 'workspace', 'node_modules', '@remotion', 'renderer'), { recursive: true });
  fs.mkdirSync(path.join(state.root, 'workspace', 'out'));
  fs.writeFileSync(path.join(state.root, 'workspace', 'node_modules', '@remotion', 'renderer', 'package.json'), '{}');
  fs.writeFileSync(path.join(state.root, 'workspace', 'package.json'), '{}');
  // Original reproduction stays intact: the old shell tool accepted a fake MP4.
  state.run.mockImplementation(async () => {
    fs.writeFileSync(path.join(state.root, 'workspace', 'out', 'draft.mp4'), 'not a video');
    return { ok: true, stdout: '', stderr: '', code: 0, timedOut: false };
  });
  // Orchestration fixture, not proof of encoding. Native codec evidence is separate.
  state.worker.mockImplementation(async (_script: string, _workspace: string, job: string) => {
    const request = JSON.parse(fs.readFileSync(path.join(job, 'request.json'), 'utf8'));
    fs.writeFileSync(path.join(job, 'result.json'), JSON.stringify({ width: state.validMetadata ? 1080 : 999, height: 1920, fps: 30, durationInFrames: 90, durationInSeconds: 3, ...(request.previewJob ? { containerDurationInSeconds: 3.051 } : {}) }));
    fs.writeFileSync(path.join(job, 'preview.json'), '{}');
    for (const n of [1, 2, 3]) fs.writeFileSync(path.join(job, `preview-${n}.png`), Buffer.alloc(16));
    fs.writeFileSync(path.join(job, 'video.mp4'), Buffer.alloc(64));
    return { ok: true, cancelled: false };
  });
});
afterEach(() => { fs.rmSync(state.root, { recursive: true, force: true }); vi.clearAllMocks(); });

describe('Video job preflight and orchestration', () => {
  it.each(['null', '[]', '42'])('rejects non-object props before executing: %s', async (propsJson) => {
    const result = await renderVideo({ ...input, propsJson });
    expect(result.success).toBe(false);
    expect(state.run).not.toHaveBeenCalled(); expect(state.worker).not.toHaveBeenCalled();
  });
  it('does not report an unverified output as a successful video', async () => {
    const result = await renderVideo(input);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Video metadata failed validation');
    expect(state.worker).toHaveBeenCalledOnce();
    expect(fs.existsSync(path.join(state.root, 'destination', 'draft.mp4'))).toBe(false);
  });
  it.each(['bad;command', '../outside', 'a'.repeat(129)])('rejects invalid composition ID %s', async (compositionId) => {
    expect((await renderVideo({ ...input, compositionId })).success).toBe(false);
    expect(state.worker).not.toHaveBeenCalled();
  });
  it('requires a real preview and rejects traversal IDs', async () => {
    expect((await renderVideo({ ...input, previewJobId: '../outside' })).success).toBe(false);
    expect(state.worker).not.toHaveBeenCalled();
  });
  it('does not launch after cancellation or when disk reserve is unavailable', async () => {
    const controller = new AbortController(); controller.abort();
    expect((await renderVideo(input, undefined, controller.signal)).success).toBe(false);
    state.freeBytes = 1;
    expect((await renderVideo(input)).success).toBe(false);
    expect(state.worker).not.toHaveBeenCalled();
  });
  it('returns preview frames without exporting a video', async () => {
    state.validMetadata = true;
    const result = await renderVideo(input);
    expect(result.status).toBe('preview_ready'); expect(result.videoPath).toBeUndefined();
    expect(result.previewPaths).toHaveLength(3);
    expect(fs.readdirSync(state.root).filter(name => name.startsWith('destination'))).toEqual([]);
  });
  it('isolates concurrent jobs and rejects a third active job', async () => {
    state.validMetadata = true;
    const a = renderVideo(input); const b = renderVideo(input);
    expect((await renderVideo(input)).error).toContain('Two video jobs');
    const results = await Promise.all([a, b]);
    expect(results.every(r => r.success)).toBe(true);
    expect(results[0].jobId).not.toBe(results[1].jobId);
  });
  it('exports repeated names without overwriting and reports measured metadata', async () => {
    state.validMetadata = true;
    const preview = await renderVideo(input);
    const a = await renderVideo({ ...input, previewJobId: preview.jobId });
    const b = await renderVideo({ ...input, previewJobId: preview.jobId });
    expect(a.success).toBe(true); expect(b.success).toBe(true);
    expect(a.videoPath).not.toBe(b.videoPath);
    expect(fs.readFileSync(path.join(a.folderPath!, 'video.md'), 'utf8')).toContain('3.051s');
    expect(fs.readFileSync(a.videoPath!)).toEqual(fs.readFileSync(b.videoPath!));
  });
  it('preserves the workspace artifact and reports the partial destination on copy failure', async () => {
    state.validMetadata = true;
    const preview = await renderVideo(input); state.failCopy = true;
    const result = await renderVideo({ ...input, previewJobId: preview.jobId });
    expect(result.success).toBe(false); expect(result.error).toBe('inert copy failure');
    expect(result.folderPath).toBeTruthy();
    expect(fs.statSync(path.join(result.recoveryPath!, 'video.mp4')).size).toBe(64);
  });
});
