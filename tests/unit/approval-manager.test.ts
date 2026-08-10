import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentTool } from '@kenkaiiii/gg-agent';
import { attachToolPolicy, guardToolWithApproval } from '../../src/agent/tool-policy.js';
import { ApprovalManager, type ApprovalRequest } from '../../src/security/approval-manager.js';

afterEach(() => {
  ApprovalManager.setNotifier(null);
  for (const request of ApprovalManager.getPending()) ApprovalManager.cancelSession(request.sessionId);
  vi.useRealTimers();
});

describe('interactive approval manager', () => {
  it('denies scheduler and remote channels without prompting', async () => {
    const notifier = vi.fn();
    ApprovalManager.setNotifier(notifier);
    const base = {
      toolName: 'shell_command',
      capability: 'local-execute' as const,
      args: { command: 'echo safe' },
      sessionId: 'unattended',
    };

    await expect(ApprovalManager.request({ ...base, channel: 'cron:daily' })).resolves.toBe(false);
    await expect(ApprovalManager.request({ ...base, channel: 'telegram' })).resolves.toBe(false);
    expect(notifier).not.toHaveBeenCalled();
  });

  it('executes only after a direct UI approval', async () => {
    let request: ApprovalRequest | undefined;
    ApprovalManager.setNotifier((next) => {
      request = next;
      return true;
    });
    const pending = ApprovalManager.request({
      toolName: 'write',
      capability: 'local-write',
      args: { file_path: '/private/example', content: 'private content' },
      sessionId: 'desktop-session',
      channel: 'desktop',
    });

    expect(request).toBeDefined();
    expect(request?.summary).not.toContain('/private/example');
    expect(request?.summary).not.toContain('private content');
    expect(ApprovalManager.resolve(request!.id, 'approve', 'ui')).toBe(true);
    await expect(pending).resolves.toBe(true);
    expect(ApprovalManager.resolve(request!.id, 'approve', 'ui')).toBe(false);
  });

  it('shows an enforced paid-request preview for AEO batches', async () => {
    let request: ApprovalRequest | undefined;
    ApprovalManager.setNotifier((next) => {
      request = next;
      return true;
    });
    const pending = ApprovalManager.request({
      toolName: 'fetch_aeo_visibility',
      capability: 'paid-action',
      args: { brandSlug: 'tsai' },
      sessionId: 'aeo-paid-preview',
      channel: 'desktop',
    });
    expect(request?.summary).toContain('up to 75 provider requests');
    ApprovalManager.resolve(request!.id, 'deny', 'ui');
    await expect(pending).resolves.toBe(false);
  });

  it('denies aborted and expired approvals', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    ApprovalManager.setNotifier(() => true);
    const aborted = ApprovalManager.request({
      toolName: 'read',
      capability: 'local-read',
      args: {},
      sessionId: 'abort-session',
      channel: 'desktop',
      signal: controller.signal,
    });
    controller.abort();
    await expect(aborted).resolves.toBe(false);

    const expired = ApprovalManager.request({
      toolName: 'read',
      capability: 'local-read',
      args: {},
      sessionId: 'expiry-session',
      channel: 'desktop',
    });
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    await expect(expired).resolves.toBe(false);
  });
});

describe('approval tool guard', () => {
  const context = {
    signal: new AbortController().signal,
    toolCallId: 'call-1',
  };

  it('blocks unattended side effects and never reaches the handler', async () => {
    const execute = vi.fn(async () => 'executed');
    const tool = attachToolPolicy(
      { name: 'shell_command', description: 'shell', parameters: z.object({}), execute } as AgentTool,
      'native'
    );
    guardToolWithApproval(tool, {
      sessionId: 'cron-session',
      channel: 'cron:daily',
      cwd: '/workspace',
      approvedRoots: ['/workspace'],
    });

    await expect(tool.execute({}, context)).resolves.toMatch(/requires user approval/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it('runs an interactive tool once approved', async () => {
    const execute = vi.fn(async () => 'executed');
    const tool = attachToolPolicy(
      { name: 'write', description: 'write', parameters: z.object({}), execute } as AgentTool,
      'native'
    );
    let request: ApprovalRequest | undefined;
    ApprovalManager.setNotifier((next) => {
      request = next;
      return true;
    });
    guardToolWithApproval(tool, {
      sessionId: 'desktop-session',
      channel: 'desktop',
      cwd: '/workspace',
      approvedRoots: ['/workspace'],
    });

    const result = tool.execute({}, context);
    ApprovalManager.resolve(request!.id, 'approve', 'ui');
    await expect(result).resolves.toBe('executed');
    expect(execute).toHaveBeenCalledOnce();
  });
});
