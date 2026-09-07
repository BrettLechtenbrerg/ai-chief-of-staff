/** Preview a local composition, then render its reviewed bundle without replacing earlier jobs. */
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ASPECTS, AspectKey, isAspectKey, isInsideAppBundle, resolveBundledSkill, resolveVideoWorkspace, slugify, videoOutputDir } from './video-shared';
import { runVideoJobProcess } from './video-job-process';

export interface RenderVideoInput {
  compositionId: string;
  propsJson?: string;
  slug: string;
  aspect: AspectKey;
  /** Omit to create a preview; supply its job ID only after the user reviews it. */
  previewJobId?: string;
}
export interface RenderVideoResult {
  success: boolean;
  status?: 'preview_ready' | 'rendered';
  jobId?: string;
  videoPath?: string;
  previewPaths?: string[];
  captionsPath?: string;
  notes?: string[];
  folderPath?: string;
  recoveryPath?: string;
  error?: string;
}
interface VideoMetadata { width: number; height: number; fps: number; durationInFrames: number; durationInSeconds: number; containerDurationInSeconds?: number }
let activeJobs = 0;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function validate(input: RenderVideoInput): string | null {
  if (!input || typeof input !== 'object') return 'input is required';
  if (typeof input.compositionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.compositionId)) return 'compositionId must be 1–128 letters, digits, underscores or dashes';
  if (typeof input.slug !== 'string' || !input.slug.trim() || input.slug.length > 200) return 'slug must be 1–200 characters';
  if (!isAspectKey(input.aspect)) return "aspect must be one of '9:16', '16:9', '1:1'";
  if (input.previewJobId !== undefined && (typeof input.previewJobId !== 'string' || !JOB_ID.test(input.previewJobId))) return 'Invalid preview job ID';
  if (input.propsJson !== undefined) {
    if (typeof input.propsJson !== 'string' || Buffer.byteLength(input.propsJson, 'utf8') > 64 * 1024) return 'propsJson must be a JSON object string of at most 64 KiB';
    try {
      const props: unknown = JSON.parse(input.propsJson);
      if (!props || typeof props !== 'object' || Array.isArray(props)) return 'propsJson must contain an object';
    } catch { return 'propsJson is not valid JSON'; }
  }
  return null;
}

async function safeDirectory(dir: string): Promise<string> {
  let resolved: string;
  try { resolved = await fs.realpath(dir); }
  catch (error) {
    if ((error as { code?: string })?.code !== 'ENOENT') throw error;
    const parent = await safeDirectory(path.dirname(dir));
    resolved = path.join(parent, path.basename(dir));
    if (isInsideAppBundle(resolved)) throw new Error('Refusing an app-bundle output', { cause: error });
    await fs.mkdir(resolved, { mode: 0o700 }).catch((error: unknown) => { if ((error as { code?: string })?.code !== 'EEXIST') throw error; });
    resolved = await fs.realpath(resolved);
  }
  if (isInsideAppBundle(resolved)) throw new Error('Refusing an app-bundle output');
  if (!(await fs.stat(resolved)).isDirectory()) throw new Error('Output parent is not a directory');
  return resolved;
}

async function readMetadata(job: string, aspect: AspectKey): Promise<VideoMetadata> {
  const file = path.join(job, 'result.json');
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.size > 4096) throw new Error('Invalid video metadata file');
  const data: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!data || typeof data !== 'object') throw new Error('Invalid video metadata');
  const m = data as VideoMetadata;
  const spec = ASPECTS[aspect];
  if (m.containerDurationInSeconds !== undefined && (!Number.isFinite(m.containerDurationInSeconds) || Math.abs(m.containerDurationInSeconds - m.durationInSeconds) > 0.1)) throw new Error('Container duration failed validation');
  if (m.width !== spec.w || m.height !== spec.h || !Number.isFinite(m.fps) || m.fps < 1 || m.fps > 60 || !Number.isSafeInteger(m.durationInFrames) || m.durationInFrames < 1 || !Number.isFinite(m.durationInSeconds) || m.durationInSeconds <= 0 || m.durationInSeconds > 180 || Math.abs(m.durationInSeconds - m.durationInFrames / m.fps) > 1 / m.fps + 0.01) throw new Error('Video metadata failed validation');
  return m;
}

export async function renderVideo(input: RenderVideoInput, onProgress?: (message: string) => void, signal?: AbortSignal): Promise<RenderVideoResult> {
  const invalid = validate(input);
  if (invalid) return { success: false, error: invalid };
  if (activeJobs >= 2) return { success: false, error: 'Two video jobs are already running; retry when one finishes.' };
  activeJobs++;
  let job: string | undefined;
  let destination: string | undefined;
  try {
    signal?.throwIfAborted();
    const workspace = await fs.realpath(resolveVideoWorkspace());
    if (isInsideAppBundle(workspace)) throw new Error('Refusing an app-bundle workspace');
    // No npx, setup scripts, browser downloads or automatic dependency installs.
    await fs.access(path.join(workspace, 'node_modules', '@remotion', 'renderer', 'package.json'));
    await fs.access('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', constants.X_OK);
    const jobs = await safeDirectory(path.join(workspace, 'out', 'acos-jobs'));
    // simplification: 100 retained jobs; add an explicit archive UI before raising this cap.
    if ((await fs.readdir(jobs)).length + activeJobs > 100) throw new Error('Local job limit reached. Archive reviewed jobs before creating more; nothing was deleted.');
    const disk = await fs.statfs(jobs);
    if (disk.bavail * disk.bsize < 5 * activeJobs * 1024 ** 3) throw new Error(`Keep at least ${5 * activeJobs} GiB free for these recoverable video jobs.`);
    const jobId = randomUUID();
    job = path.join(jobs, jobId);
    await fs.mkdir(job, { mode: 0o700 });
    const normalized = { compositionId: input.compositionId, slug: slugify(input.slug), aspect: input.aspect, ...(input.propsJson !== undefined ? { propsJson: input.propsJson } : {}) };
    let previewJob: string | undefined;
    if (input.previewJobId) {
      previewJob = await fs.realpath(path.join(jobs, input.previewJobId));
      if (previewJob !== path.join(jobs, input.previewJobId)) throw new Error('Preview job must not be a symlink');
      const marker = await fs.lstat(path.join(previewJob, 'preview.json'));
      if (!marker.isFile() || marker.size > 512 * 1024) throw new Error('Invalid preview manifest');
    }
    const spec = ASPECTS[input.aspect];
    await fs.writeFile(path.join(job, 'request.json'), JSON.stringify({ input: normalized, width: spec.w, height: spec.h, previewJob }), { flag: 'wx', mode: 0o600 });
    const assets = path.dirname(resolveBundledSkill());
    await fs.copyFile(path.join(assets, 'browser-launcher.sh'), path.join(job, 'browser-launcher.sh'), constants.COPYFILE_EXCL);
    await fs.chmod(path.join(job, 'browser-launcher.sh'), 0o700);
    signal?.throwIfAborted();
    const run = await runVideoJobProcess(path.join(assets, 'video-job.cjs'), workspace, job, { signal, onProgress });
    if (!run.ok) throw new Error(run.cancelled ? 'Video job cancelled or timed out; partial artifacts retained.' : 'Video job failed; inspect the private error.txt in the recovery folder.');
    signal?.throwIfAborted();
    const metadata = await readMetadata(job, input.aspect);
    const preset = input.compositionId === 'ACOS-Storyboard';
    const notes = preset ? ['Silent typography draft: visual/audio directions and caption (post copy) remain original review data.', 'Video subtitles use verbal with presentation-only whitespace and line wrapping; 10% margins still require platform-specific preview review.'] : ['Review captions, evidence, sound and platform safe areas in the returned frames.'];
    if (!previewJob) {
      const previewPaths = [1, 2, 3].map((n) => path.join(job!, `preview-${n}.png`));
      for (const file of previewPaths) {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.size < 8 || stat.size > 32 * 1024 * 1024) throw new Error('Preview frame missing or invalid');
      }
      return { success: true, status: 'preview_ready', jobId, previewPaths, folderPath: job, captionsPath: preset ? path.join(job, 'captions.srt') : undefined, notes };
    }
    if (metadata.containerDurationInSeconds === undefined) throw new Error('Encoded container measurement missing');
    const source = path.join(job, 'video.mp4');
    const stat = await fs.lstat(source);
    if (!stat.isFile() || stat.size < 32 || stat.size > 2 * 1024 * 1024 * 1024) throw new Error('Video output missing or outside size limits');
    const parent = await safeDirectory(path.dirname(videoOutputDir(normalized.slug)));
    const folderPath = await fs.mkdtemp(path.join(parent, `${path.basename(videoOutputDir(normalized.slug))}-`));
    destination = folderPath;
    const videoPath = path.join(folderPath, `${normalized.slug}.mp4`);
    signal?.throwIfAborted();
    await fs.copyFile(source, videoPath, constants.COPYFILE_EXCL);
    const captionsPath = preset ? path.join(folderPath, 'captions.srt') : undefined;
    if (captionsPath) await fs.copyFile(path.join(job, 'captions.srt'), captionsPath, constants.COPYFILE_EXCL);
    signal?.throwIfAborted();
    await fs.writeFile(path.join(folderPath, 'video.md'), `# Local video draft — ${normalized.slug}\n\nComposition: ${normalized.compositionId}\n\nVerified dimensions: ${metadata.width}×${metadata.height}\n\nVerified FPS: ${metadata.fps}\n\nVerified video duration: ${metadata.durationInSeconds}s\n\nContainer duration (including codec padding): ${metadata.containerDurationInSeconds}s\n\nPreview job: ${input.previewJobId}\n\nReview captions, safe areas, evidence and platform requirements before posting. Preview approval is not publication approval. Nothing was published or shared.\n`, { flag: 'wx', mode: 0o600 });
    return { success: true, status: 'rendered', jobId, videoPath, captionsPath, notes, folderPath, recoveryPath: job };
  } catch (error) {
    return { success: false, recoveryPath: job, folderPath: destination, error: error instanceof Error ? error.message : 'Video job failed' };
  } finally { activeJobs--; }
}

export function getRenderVideoToolDefinition() {
  return {
    name: 'render_video',
    description: 'Create three local preview frames from a registered Remotion composition. Omit previewJobId first; show the frames and wait for user review. After review, call with that previewJobId and identical compositionId/slug/aspect/propsJson to render the snapshotted bundle. Each call still needs exact tool approval. Metadata is checked before exporting a uniquely named MP4 folder. No automatic installs, downloads or publication. Requires the existing macOS workspace, Remotion 4.0.484 and installed Chrome.',
    input_schema: {
      type: 'object' as const,
      properties: {
        compositionId: { type: 'string', description: 'Registered composition ID, or ACOS-Storyboard for the bundled brand-aware silent typography preset without workspace edits.' },
        propsJson: { type: 'string', description: 'JSON object, at most 64 KiB. ACOS-Storyboard requires elements {verbal,text,visual,audio,caption}, matching saved Hook Lab fields (caption means post copy); optional durationSeconds (1–180), brandName, cta and six-digit hex background/foreground/accent. Preserve the selected fields exactly. Long text, fast speech and low contrast require review rather than silent shortening.' },
        slug: { type: 'string', description: 'Short title for the local draft.' },
        aspect: { type: 'string', enum: ['9:16', '16:9', '1:1'] },
        previewJobId: { type: 'string', description: 'ID returned by the reviewed preview. Omit to create a new preview.' },
      },
      required: ['compositionId', 'slug', 'aspect'],
    },
  };
}
export async function handleRenderVideoTool(input: unknown, context?: { onProgress?: (message: string) => void; signal?: AbortSignal }): Promise<string> {
  return JSON.stringify(await renderVideo(input as RenderVideoInput, context?.onProgress, context?.signal));
}
