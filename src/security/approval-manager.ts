import { randomUUID } from 'crypto';
import type { ToolCapability } from '../agent/tool-policy.js';

export type ApprovalDecision = 'approve' | 'deny';
export type ApprovalSource = 'ui' | 'voice';

export interface ApprovalRequest {
  id: string;
  toolName: string;
  capability: ToolCapability;
  summary: string;
  details: string;
  sessionId: string;
  channel: string;
  expiresAt: number;
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (approved: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
  abortCleanup?: () => void;
}

const APPROVAL_TIMEOUT_MS = 2 * 60 * 1000;

class ApprovalManagerImpl {
  private pending = new Map<string, PendingApproval>();
  private notifier: ((request: ApprovalRequest) => boolean) | null = null;
  private telegramDeliveries = new Map<AbortController, string>();

  setNotifier(notifier: ((request: ApprovalRequest) => boolean) | null): void {
    this.notifier = notifier;
    if (!notifier) {
      for (const controller of this.telegramDeliveries.keys()) controller.abort();
      for (const pending of this.pending.values()) pending.resolve(false);
    }
  }

  async request(options: {
    toolName: string;
    capability: ToolCapability;
    args: unknown;
    sessionId: string;
    channel: string;
    signal?: AbortSignal;
  }): Promise<boolean> {
    // Scheduled and remote channels cannot present a user-originated confirmation.
    if (options.channel !== 'desktop') return false;
    return this.present(options);
  }

  /** Only Telegram delivery may ask the desktop from a remote/scheduled origin.
   * This does not grant remote tools permission to execute arbitrary actions. */
  async requestTelegramDelivery<T>(options: {
    method: string;
    payload: unknown;
    sessionId: string;
    signal?: AbortSignal;
    prepare?: (signal: AbortSignal) => Promise<void>;
  }, executeOnce: (signal: AbortSignal) => Promise<T>): Promise<{ approved: false } | { approved: true; result: T }> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    this.telegramDeliveries.set(controller, options.sessionId);
    try {
      if (options.signal?.aborted) controller.abort();
      if (!this.notifier || controller.signal.aborted) return { approved: false };
      // Track session/UI cancellation during file capture as well as approval.
      if (options.prepare) await options.prepare(controller.signal);
      const approved = await this.present({
        toolName: `telegram.api.${options.method}`,
        capability: 'external-write',
        args: { method: options.method, payload: options.payload },
        sessionId: options.sessionId,
        channel: 'desktop',
        signal: controller.signal,
      }, true);
      if (!approved || controller.signal.aborted) return { approved: false };
      // No reusable grant leaves the manager. Session cancellation still reaches
      // this execution even if it follows approval in the same event-loop turn.
      return { approved: true, result: await executeOnce(controller.signal) };
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      this.telegramDeliveries.delete(controller);
    }
  }

  private async present(options: {
    toolName: string;
    capability: ToolCapability;
    args: unknown;
    sessionId: string;
    channel: string;
    signal?: AbortSignal;
  }, exactDelivery = false): Promise<boolean> {
    if (!this.notifier || options.signal?.aborted || this.pending.size >= 20) return false;

    let details: string;
    try {
      details = JSON.stringify(options.args, (key, value: unknown) =>
        !exactDelivery && /password|secret|token|authorization|api.?key/i.test(key) ? '[redacted credential]' : value, 2);
      if (typeof details !== 'string' || details.length > 100_000) return false;
    } catch {
      return false;
    }
    const request: ApprovalRequest = {
      id: randomUUID(),
      toolName: options.toolName,
      capability: options.capability,
      details,
      summary:
        options.toolName === 'fetch_aeo_visibility'
          ? `Paid batch: up to 75 provider requests; provider charges apply. ${summarizeArguments(options.args)}`
          : summarizeArguments(options.args),
      sessionId: options.sessionId,
      channel: options.channel,
      expiresAt: Date.now() + APPROVAL_TIMEOUT_MS,
    };

    return new Promise<boolean>((resolve) => {
      const finish = (approved: boolean) => {
        const pending = this.pending.get(request.id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        pending.abortCleanup?.();
        this.pending.delete(request.id);
        resolve(approved);
      };
      const timeout = setTimeout(() => finish(false), APPROVAL_TIMEOUT_MS);
      const onAbort = () => finish(false);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(request.id, {
        request,
        resolve: finish,
        timeout,
        ...(options.signal
          ? { abortCleanup: () => options.signal?.removeEventListener('abort', onAbort) }
          : {}),
      });
      try {
        if (!this.notifier?.({ ...request }) || options.signal?.aborted) finish(false);
      } catch {
        finish(false);
      }
    });
  }

  resolve(id: string, decision: ApprovalDecision, source: ApprovalSource): boolean {
    if (source !== 'ui' && source !== 'voice') return false;
    const pending = this.pending.get(id);
    if (!pending) return false;
    if (pending.request.expiresAt <= Date.now()) {
      pending.resolve(false);
      return false;
    }
    pending.resolve(decision === 'approve');
    return true;
  }

  resolveNewest(decision: ApprovalDecision, source: ApprovalSource, sessionId?: string): boolean {
    const pending = [...this.pending.values()]
      .filter((item) => !sessionId || item.request.sessionId === sessionId)
      .sort((a, b) => b.request.expiresAt - a.request.expiresAt)[0];
    return pending ? this.resolve(pending.request.id, decision, source) : false;
  }

  cancelSession(sessionId: string): void {
    for (const [controller, deliverySession] of this.telegramDeliveries) {
      if (deliverySession === sessionId) controller.abort();
    }
    for (const pending of this.pending.values()) {
      if (pending.request.sessionId === sessionId) pending.resolve(false);
    }
  }

  getPending(): ApprovalRequest[] {
    return [...this.pending.values()].map((item) => ({ ...item.request }));
  }
}

function summarizeArguments(args: unknown): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'No named arguments';
  const fields = Object.entries(args as Record<string, unknown>)
    .slice(0, 12)
    .map(([key, value]) => {
      if (typeof value === 'string') return `${key}: text (${value.length} chars)`;
      if (Array.isArray(value)) return `${key}: list (${value.length} items)`;
      if (value && typeof value === 'object') return `${key}: object`;
      return `${key}: ${typeof value}`;
    });
  return fields.length ? fields.join(', ') : 'No named arguments';
}

export const ApprovalManager = new ApprovalManagerImpl();
