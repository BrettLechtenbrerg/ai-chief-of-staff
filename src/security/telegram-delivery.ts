import { InputFile, type Transformer } from 'grammy';
import { constants } from 'fs';
import { open } from 'fs/promises';
import { createHash } from 'crypto';
import { ApprovalManager } from './approval-manager';

// Exact, reviewed API names, not a get*/send* heuristic. All other methods ask.
const READ_METHODS = new Set(['getMe', 'getUpdates', 'getFile', 'getChat',
  'getChatMember', 'getChatAdministrators', 'getChatMemberCount', 'getWebhookInfo']);
// Telegram's standard Bot API document/audio/video upload limit (50 MiB).
// Also cap the aggregate of an album/request, not merely each individual file.
export const MAX_TELEGRAM_CAPTURE_BYTES = 50 * 1024 * 1024;

export class TelegramDeliveryDenied extends Error {
  constructor() { super('Telegram delivery requires exact desktop approval; delivery denied.'); }
}

/** Copy structure and byte sources synchronously, then capture local files with
 * bounded asynchronous reads. No supplier/stream/remote InputFile is evaluated.
 * The preview identifies binary content by filename, length and SHA-256; only
 * the private captured bytes (never the path again) reach grammY after approval.
 */
function snapshot(value: unknown, capture: {
  bytes: number;
  jobs: (() => Promise<void>)[];
  aborted: () => boolean;
}, ancestors = new Set<object>()): { wire: () => unknown; preview: unknown } {
  if (value instanceof InputFile) {
    const source: unknown = Object.getOwnPropertyDescriptor(value, 'fileData')?.value;
    const filename = value.filename;
    if (filename !== undefined && typeof filename !== 'string') throw new TelegramDeliveryDenied();
    let file: InputFile;
    const preview = { filename, bytes: 0, sha256: '' };
    const reserve = (size: number) => {
      if (size > MAX_TELEGRAM_CAPTURE_BYTES - capture.bytes) throw new TelegramDeliveryDenied();
      capture.bytes += size;
    };
    const finish = (bytes: Buffer) => {
      file = new InputFile(bytes, filename);
      preview.bytes = bytes.length;
      preview.sha256 = createHash('sha256').update(bytes).digest('hex');
    };
    if (typeof source === 'string') {
      capture.jobs.push(async () => {
        if (capture.aborted()) throw new TelegramDeliveryDenied();
        // Nonblocking open prevents special files (e.g. FIFOs) hanging capture.
        const handle = await open(source, constants.O_RDONLY | constants.O_NONBLOCK);
        try {
          const stat = await handle.stat();
          if (!stat.isFile()) throw new TelegramDeliveryDenied();
          reserve(stat.size);
          const bytes = Buffer.alloc(stat.size);
          let offset = 0;
          while (offset < bytes.length) {
            if (capture.aborted()) throw new TelegramDeliveryDenied();
            const { bytesRead } = await handle.read(bytes, offset, Math.min(1024 * 1024, bytes.length - offset), offset);
            if (!bytesRead) throw new TelegramDeliveryDenied();
            offset += bytesRead;
          }
          const extra = await handle.read(Buffer.alloc(1), 0, 1, offset);
          const after = await handle.stat();
          if (extra.bytesRead || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || capture.aborted()) {
            throw new TelegramDeliveryDenied();
          }
          finish(bytes);
        } finally {
          await handle.close();
        }
      });
    } else if (source instanceof Uint8Array) {
      reserve(source.byteLength);
      finish(Buffer.from(source));
    } else {
      throw new TelegramDeliveryDenied();
    }
    return { wire: () => file, preview };
  }
  if (value && typeof value === 'object') {
    if (ancestors.has(value) || ancestors.size >= 100) throw new TelegramDeliveryDenied();
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        const items = value.map((item) => snapshot(item, capture, ancestors));
        return { wire: () => items.map((item) => item.wire()), preview: items.map((item) => item.preview) };
      }
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        throw new TelegramDeliveryDenied();
      }
      const entries = Object.entries(value).map(([key, item]) => [key, snapshot(item, capture, ancestors)] as const);
      return {
        wire: () => Object.fromEntries(entries.map(([key, item]) => [key, item.wire()])),
        preview: Object.fromEntries(entries.map(([key, item]) => [key, item.preview])),
      };
    } finally {
      ancestors.delete(value);
    }
  }
  if (value !== undefined && value !== null && typeof value !== 'string' &&
      typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))) {
    throw new TelegramDeliveryDenied();
  }
  return { wire: () => value, preview: value };
}

/** Install FIRST so all subsequent transformers still pass through this boundary.
 * grammY copies installed transformers to ctx.api, including direct ctx.reply.
 * No cached grants or ambient bypass: each invocation consumes its own approval.
 */
export function telegramDeliveryApproval(): Transformer {
  return async (prev, method, payload, signal) => {
    if (signal?.aborted) throw new TelegramDeliveryDenied();
    if (READ_METHODS.has(method)) return prev(method, payload, signal);
    const capture = { bytes: 0, jobs: [] as (() => Promise<void>)[], aborted: () => !!signal?.aborted };
    const captured = snapshot(payload, capture);
    const chatId = (captured.preview as Record<string, unknown>).chat_id;
    // grammY's Node build types its signal as abort-controller's older signal.
    // Bridge rather than asserting it implements modern native AbortSignal.
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      if (signal?.aborted) controller.abort();
      const delivery = await ApprovalManager.requestTelegramDelivery({
        method,
        payload: captured.preview,
        sessionId: `telegram-delivery:${String(chatId ?? 'bot')}`,
        signal: controller.signal,
        ...(capture.jobs.length ? { prepare: async (captureSignal: AbortSignal) => {
          capture.aborted = () => captureSignal.aborted;
          try {
            for (const job of capture.jobs) await job();
          } catch {
            throw new TelegramDeliveryDenied();
          }
        } } : {}),
      }, (executionSignal) => {
        if (executionSignal.aborted) throw new TelegramDeliveryDenied();
        // Verified grammY 1.42.0 client uses only aborted/addEventListener/
        // removeEventListener, all implemented by this native signal. Its
        // declaration instead names the older abort-controller signal type.
        return prev(method, captured.wire() as typeof payload,
          executionSignal as unknown as NonNullable<typeof signal>);
      });
      if (!delivery.approved) throw new TelegramDeliveryDenied();
      return delivery.result;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  };
}
