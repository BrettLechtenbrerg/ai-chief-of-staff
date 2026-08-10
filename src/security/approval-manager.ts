import { randomUUID } from 'crypto';
import type { ToolCapability } from '../agent/tool-policy.js';

export type ApprovalDecision = 'approve' | 'deny';
export type ApprovalSource = 'ui' | 'voice';

export interface ApprovalRequest {
  id: string;
  toolName: string;
  capability: ToolCapability;
  summary: string;
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

  setNotifier(notifier: ((request: ApprovalRequest) => boolean) | null): void {
    this.notifier = notifier;
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
    if (!this.notifier || options.signal?.aborted) return false;

    const request: ApprovalRequest = {
      id: randomUUID(),
      toolName: options.toolName,
      capability: options.capability,
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
      if (!this.notifier?.(request)) finish(false);
    });
  }

  resolve(id: string, decision: ApprovalDecision, source: ApprovalSource): boolean {
    if (source !== 'ui' && source !== 'voice') return false;
    const pending = this.pending.get(id);
    if (!pending || pending.request.expiresAt < Date.now()) return false;
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
