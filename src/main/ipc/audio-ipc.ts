/**
 * Audio transcription IPC for the chat composer's voice-input button.
 *
 * Flow:
 *   1. Renderer captures audio with MediaRecorder (webm/opus).
 *   2. Renderer reads the Blob as Uint8Array, sends here via `audio:transcribe`.
 *   3. We hand it to the existing `transcribeAudio()` Whisper wrapper
 *      (already used by the Telegram voice-note handler), and return the text.
 *
 * Notes:
 *  - Requires an OpenAI API key in Settings (`openai.apiKey`). We surface this
 *    via the `audio:isAvailable` check so the renderer can hide/disable the
 *    mic button when no key is configured, instead of letting the user record
 *    a clip and only THEN learn they can't transcribe it.
 *  - 25 MB hard cap matches OpenAI's Whisper API limit. A reasonably chatty
 *    minute of audio is ~1 MB at opus, so this is roughly a 25-minute clip
 *    \u2014 well past anything we expect from a chat-composer button, but it
 *    gives us a fail-fast guard against runaway recordings.
 *  - macOS microphone access requires the
 *    `com.apple.security.device.audio-input` entitlement (see
 *    `build/entitlements.mac.plist`). Without it the OS denies
 *    getUserMedia({ audio: true }) and the renderer surfaces the OS prompt
 *    pointing the user at System Settings.
 */
import { trustedHandle } from './trusted-ipc.js';
import { transcribeAudio, isTranscriptionAvailable } from '../../utils/transcribe';

export interface TranscribeAudioResult {
  success: boolean;
  text?: string;
  /** Round-trip seconds spent inside the Whisper API call (not including upload). */
  duration?: number;
  error?: string;
}

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB \u2014 matches Whisper's per-file limit.

// Formats accepted by OpenAI's Whisper endpoint. Renderer always sends webm
// from MediaRecorder, but we keep the allow-list aligned with the upstream
// API so future format additions just work.
const SUPPORTED_FORMATS = new Set([
  'mp3',
  'mp4',
  'mpeg',
  'mpga',
  'm4a',
  'wav',
  'webm',
  'ogg',
  'oga',
  'opus',
]);

export function registerAudioIPC(): void {
  trustedHandle('audio:isAvailable', async (): Promise<{ available: boolean }> => {
    return { available: isTranscriptionAvailable() };
  });

  trustedHandle(
    'audio:transcribe',
    async (
      _,
      payload: { data: Uint8Array; format: string; language?: string },
    ): Promise<TranscribeAudioResult> => {
      try {
        if (!payload || !payload.data || typeof payload.format !== 'string') {
          return { success: false, error: 'Missing audio data or format.' };
        }

        const format = payload.format.toLowerCase().trim();
        if (!SUPPORTED_FORMATS.has(format)) {
          return {
            success: false,
            error: `Unsupported audio format: ${format}. Supported: ${[...SUPPORTED_FORMATS].join(', ')}.`,
          };
        }

        // Renderer hands us a Uint8Array; convert to Node Buffer for the
        // OpenAI SDK's toFile() helper without copying the underlying bytes.
        const buffer = Buffer.from(payload.data.buffer, payload.data.byteOffset, payload.data.byteLength);

        if (buffer.length === 0) {
          return { success: false, error: 'Empty audio recording.' };
        }
        if (buffer.length > MAX_AUDIO_BYTES) {
          const mb = (buffer.length / 1024 / 1024).toFixed(1);
          return {
            success: false,
            error: `Recording too long (${mb} MB). Max 25 MB. Try a shorter clip.`,
          };
        }

        const result = await transcribeAudio(buffer, format, payload.language);
        if (!result.success) {
          return { success: false, error: result.error || 'Transcription failed.' };
        }

        return { success: true, text: result.text, duration: result.duration };
      } catch (err) {
        console.error('[Audio IPC] transcribe failed:', err);
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown transcription error.',
        };
      }
    },
  );
}
