/**
 * trim_video_silence — remove filler words + dead air from a video/audio file.
 *
 * Shells out to the bundled `assets/skills/video-silence-trimmer/trimmer.py`
 * (see that skill's SKILL.md), mirroring how the Video Studio tools drive an
 * external process rather than bundling heavy deps into the signed app. The
 * Python deps (ffmpeg, faster-whisper) live on the user's machine — the script
 * self-reports clear install guidance when something is missing.
 *
 * The trimmed file lands next to a Desktop folder (~/Desktop/Trimmed/) by
 * default, consistent with Video Studio / Content Writer output conventions,
 * and the tool refuses to write inside an installed .app bundle.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveBundledAsset,
  runInWorkspace,
  isInsideAppBundle,
  tailLog,
  slugify,
  todayStamp,
} from './video-shared';

export type TrimEngine = 'faster-whisper' | 'openai' | 'elevenlabs';

export interface TrimVideoSilenceInput {
  /** Absolute path to the input video or audio file. */
  inputPath: string;
  /** Optional output path. Defaults to ~/Desktop/Trimmed/<date>-<name>.trimmed<ext>. */
  outputPath?: string;
  /** Pause length (seconds) before silence is removed. Default 0.8. */
  silenceThreshold?: number;
  /** Comma-separated filler words. Default "um,uh,ah,hmm". */
  fillerWords?: string;
  /** Seconds kept around each cut so it isn't abrupt. Default 0.05. */
  padding?: number;
  /** Transcription engine. Default 'faster-whisper' (on-device, no key). */
  engine?: TrimEngine;
}

export interface TrimVideoSilenceResult {
  success: boolean;
  outputPath?: string;
  originalDurationSec?: number;
  trimmedDurationSec?: number;
  removedSec?: number;
  fillerWordsRemoved?: number;
  silencesRemoved?: number;
  hasVideo?: boolean;
  engine?: string;
  error?: string;
}

const VALID_ENGINES: TrimEngine[] = ['faster-whisper', 'openai', 'elevenlabs'];

/** Single-quote-safe shell argument. */
function shq(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function validate(input: TrimVideoSilenceInput): string | null {
  if (!input || typeof input !== 'object') return 'input is required';
  if (typeof input.inputPath !== 'string' || !input.inputPath.trim())
    return 'inputPath is required';
  if (input.silenceThreshold !== undefined && !(input.silenceThreshold > 0))
    return 'silenceThreshold must be greater than 0';
  if (input.padding !== undefined && input.padding < 0)
    return 'padding cannot be negative';
  if (input.engine !== undefined && !VALID_ENGINES.includes(input.engine))
    return `engine must be one of ${VALID_ENGINES.join(', ')}`;
  return null;
}

/** Parse the trimmer's final stdout line (a single JSON object). */
function parseScriptResult(stdout: string): Record<string, unknown> | null {
  const lines = String(stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        /* keep scanning upward */
      }
    }
  }
  return null;
}

export async function trimVideoSilence(
  input: TrimVideoSilenceInput,
): Promise<TrimVideoSilenceResult> {
  const err = validate(input);
  if (err) return { success: false, error: err };

  const inPath = path.resolve(input.inputPath.replace(/^~(?=\/)/, os.homedir()));
  if (!fs.existsSync(inPath)) {
    return { success: false, error: `Input file does not exist: ${inPath}` };
  }

  const ext = path.extname(inPath) || '.mp4';
  const baseStem = slugify(path.basename(inPath, ext)) || 'clip';

  // Default output: ~/Desktop/Trimmed/<date>-<name>.trimmed<ext>
  const outPath = input.outputPath
    ? path.resolve(input.outputPath.replace(/^~(?=\/)/, os.homedir()))
    : path.join(
        os.homedir(),
        'Desktop',
        'Trimmed',
        `${todayStamp()}-${baseStem}.trimmed${ext}`,
      );

  if (isInsideAppBundle(outPath) || isInsideAppBundle(inPath)) {
    return { success: false, error: 'Refusing to read/write a trim inside an .app bundle.' };
  }

  const script = resolveBundledAsset('skills', 'video-silence-trimmer', 'trimmer.py');
  if (!fs.existsSync(script)) {
    return {
      success: false,
      error: `Bundled trimmer.py not found at ${script}. The app bundle may be corrupted — reinstall AI Chief of Staff.`,
    };
  }

  // Ensure the output directory exists so the script's move succeeds.
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
  } catch (e) {
    return { success: false, error: `Could not create output folder: ${(e as Error).message}` };
  }

  const parts = [
    'python3',
    shq(script),
    '--input',
    shq(inPath),
    '--output',
    shq(outPath),
    '--silence-threshold',
    String(input.silenceThreshold ?? 0.8),
    '--filler-words',
    shq(input.fillerWords ?? 'um,uh,ah,hmm'),
    '--padding',
    String(input.padding ?? 0.05),
    '--engine',
    input.engine ?? 'faster-whisper',
  ];
  const cmd = parts.join(' ');

  // Transcription on CPU can be slow for longer clips — allow generous time.
  const result = await runInWorkspace(cmd, {
    cwd: os.homedir(),
    timeoutMs: 30 * 60 * 1000,
  });

  const parsed = parseScriptResult(result.stdout);

  if (parsed && parsed.success === true) {
    return {
      success: true,
      outputPath: String(parsed.outputPath ?? outPath),
      originalDurationSec: parsed.originalDurationSec as number | undefined,
      trimmedDurationSec: parsed.trimmedDurationSec as number | undefined,
      removedSec: parsed.removedSec as number | undefined,
      fillerWordsRemoved: parsed.fillerWordsRemoved as number | undefined,
      silencesRemoved: parsed.silencesRemoved as number | undefined,
      hasVideo: parsed.hasVideo as boolean | undefined,
      engine: parsed.engine as string | undefined,
    };
  }

  // Prefer the script's own error message (it carries install guidance).
  if (parsed && typeof parsed.error === 'string') {
    return { success: false, error: parsed.error };
  }

  if (result.timedOut) {
    return { success: false, error: 'Silence trimming timed out. Try a shorter clip or a smaller WHISPER_MODEL.' };
  }
  if (/python3: command not found|No such file or directory.*python3/i.test(result.stderr)) {
    return { success: false, error: 'python3 was not found on PATH. Install Python 3 and try again.' };
  }
  return {
    success: false,
    error: 'Silence trimming failed.\n' + tailLog(`${result.stdout}\n${result.stderr}`, 30),
  };
}

export function getTrimVideoSilenceToolDefinition() {
  return {
    name: 'trim_video_silence',
    description:
      "Remove filler words ('um','uh','ah','hmm') and silences/pauses longer than a threshold from a video OR audio file, then export a clean, in-sync file. Runs the bundled video-silence-trimmer skill (faster-whisper on-device by default; optional openai/elevenlabs engines if API keys are set). Requires ffmpeg + the engine's Python package on the user's machine — the tool returns clear install guidance if a dependency is missing. Output defaults to ~/Desktop/Trimmed/. Never overwrites the input unless outputPath equals it. Great for tightening talking-head videos, podcasts, voiceovers, or Video Studio renders.",
    input_schema: {
      type: 'object' as const,
      properties: {
        inputPath: {
          type: 'string',
          description: 'Absolute path to the input video or audio file.',
        },
        outputPath: {
          type: 'string',
          description: 'Optional output path. Defaults to ~/Desktop/Trimmed/<date>-<name>.trimmed<ext>.',
        },
        silenceThreshold: {
          type: 'number',
          description: 'Pause length in seconds before silence is removed. Default 0.8. Raise to keep more natural pauses; lower to cut tighter.',
        },
        fillerWords: {
          type: 'string',
          description: 'Comma-separated filler words to remove. Default "um,uh,ah,hmm".',
        },
        padding: {
          type: 'number',
          description: "Seconds of audio/video kept around each cut so it isn't abrupt. Default 0.05.",
        },
        engine: {
          type: 'string',
          enum: VALID_ENGINES,
          description: "Transcription engine. 'faster-whisper' (default, on-device, no API key), 'openai' (needs OPENAI_API_KEY), or 'elevenlabs' (needs ELEVENLABS_API_KEY).",
        },
      },
      required: ['inputPath'],
    },
  };
}

export async function handleTrimVideoSilenceTool(input: unknown): Promise<string> {
  const result = await trimVideoSilence(input as TrimVideoSilenceInput);
  return JSON.stringify(result);
}
