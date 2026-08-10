/**
 * Unit tests for the audio transcription IPC.
 *
 * The handler is a thin validation layer in front of `transcribeAudio()`
 * (already covered by tests/unit/transcribe.test.ts). The point of these
 * tests is to lock the renderer-facing validation in: format allow-list,
 * empty payload, oversize, and the wiring back to the underlying util.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture trusted registrations so these tests can invoke the validated handler body directly.
const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('../../src/main/ipc/trusted-ipc.js', () => ({
  trustedHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    registeredHandlers.set(channel, handler);
  },
}));

const mockTranscribeAudio = vi.fn();
const mockIsTranscriptionAvailable = vi.fn(() => true);

vi.mock('../../src/utils/transcribe', () => ({
  transcribeAudio: (...args: unknown[]) => mockTranscribeAudio(...args),
  isTranscriptionAvailable: () => mockIsTranscriptionAvailable(),
}));

import { registerAudioIPC } from '../../src/main/ipc/audio-ipc';

function getHandler(channel: string) {
  const handler = registeredHandlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler;
}

function call(channel: string, payload: unknown) {
  // The IPC handler signature is (event, ...args), so we pass a stub event.
  return getHandler(channel)({}, payload);
}

describe('audio-ipc', () => {
  beforeEach(() => {
    registeredHandlers.clear();
    mockTranscribeAudio.mockReset();
    mockIsTranscriptionAvailable.mockReset();
    mockIsTranscriptionAvailable.mockReturnValue(true);
    registerAudioIPC();
  });

  describe('audio:isAvailable', () => {
    it('returns true when transcription is configured', async () => {
      mockIsTranscriptionAvailable.mockReturnValue(true);
      const result = await call('audio:isAvailable', undefined);
      expect(result).toEqual({ available: true });
    });

    it('returns false when transcription is not configured', async () => {
      mockIsTranscriptionAvailable.mockReturnValue(false);
      const result = await call('audio:isAvailable', undefined);
      expect(result).toEqual({ available: false });
    });
  });

  describe('audio:transcribe', () => {
    function payload(overrides: Record<string, unknown> = {}) {
      return {
        data: new Uint8Array([1, 2, 3, 4]),
        format: 'webm',
        ...overrides,
      };
    }

    it('rejects missing payload', async () => {
      const result = (await call('audio:transcribe', undefined)) as { success: boolean; error?: string };
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/missing/i);
    });

    it('rejects missing data', async () => {
      const result = (await call('audio:transcribe', { format: 'webm' })) as { success: boolean; error?: string };
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/missing/i);
    });

    it('rejects empty audio', async () => {
      const result = (await call('audio:transcribe', payload({ data: new Uint8Array(0) }))) as { success: boolean; error?: string };
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/empty/i);
      expect(mockTranscribeAudio).not.toHaveBeenCalled();
    });

    it('rejects unsupported format', async () => {
      const result = (await call('audio:transcribe', payload({ format: 'aiff' }))) as { success: boolean; error?: string };
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/unsupported/i);
      expect(mockTranscribeAudio).not.toHaveBeenCalled();
    });

    it('normalizes uppercase format before checking the allow-list', async () => {
      mockTranscribeAudio.mockResolvedValue({ success: true, text: 'hi', duration: 0.5 });
      const result = (await call('audio:transcribe', payload({ format: 'WEBM' }))) as { success: boolean };
      expect(result.success).toBe(true);
      expect(mockTranscribeAudio).toHaveBeenCalledWith(expect.any(Buffer), 'webm', undefined);
    });

    it('rejects oversized recordings before calling Whisper', async () => {
      // 26 MB \u2014 just over the 25 MB Whisper cap.
      const big = new Uint8Array(26 * 1024 * 1024);
      const result = (await call('audio:transcribe', payload({ data: big }))) as { success: boolean; error?: string };
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/too long/i);
      expect(mockTranscribeAudio).not.toHaveBeenCalled();
    });

    it('passes language through to transcribeAudio', async () => {
      mockTranscribeAudio.mockResolvedValue({ success: true, text: 'bonjour', duration: 0.4 });
      await call('audio:transcribe', payload({ language: 'fr' }));
      expect(mockTranscribeAudio).toHaveBeenCalledWith(expect.any(Buffer), 'webm', 'fr');
    });

    it('returns success + text + duration on a happy path', async () => {
      mockTranscribeAudio.mockResolvedValue({ success: true, text: 'hello world', duration: 1.23 });
      const result = (await call('audio:transcribe', payload())) as {
        success: boolean;
        text?: string;
        duration?: number;
      };
      expect(result.success).toBe(true);
      expect(result.text).toBe('hello world');
      expect(result.duration).toBe(1.23);
    });

    it('forwards the underlying error message when transcription fails', async () => {
      mockTranscribeAudio.mockResolvedValue({ success: false, error: 'Invalid OpenAI API key.' });
      const result = (await call('audio:transcribe', payload())) as { success: boolean; error?: string };
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid OpenAI API key.');
    });

    it('catches thrown errors and returns a structured failure', async () => {
      mockTranscribeAudio.mockRejectedValue(new Error('boom'));
      const result = (await call('audio:transcribe', payload())) as { success: boolean; error?: string };
      expect(result.success).toBe(false);
      expect(result.error).toBe('boom');
    });

    it('converts the Uint8Array payload to a Node Buffer for the util', async () => {
      mockTranscribeAudio.mockResolvedValue({ success: true, text: '' });
      await call('audio:transcribe', payload({ data: new Uint8Array([10, 20, 30]) }));
      const [bufArg] = mockTranscribeAudio.mock.calls[0];
      expect(Buffer.isBuffer(bufArg)).toBe(true);
      expect((bufArg as Buffer).length).toBe(3);
      expect((bufArg as Buffer)[0]).toBe(10);
    });
  });
});
