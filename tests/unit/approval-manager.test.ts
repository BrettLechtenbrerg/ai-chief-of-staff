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
    expect(request?.details).toContain('/private/example');
    expect(request?.details).toContain('private content');
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

  it('denies failed or disconnected approval UI and cleans pending requests', async () => {
    const options = { toolName: 'shell_command', capability: 'local-execute' as const,
      args: { command: 'echo fixture' }, sessionId: 'ui-fixture', channel: 'desktop' };
    ApprovalManager.setNotifier(() => { throw new Error('synthetic UI failure'); });
    await expect(ApprovalManager.request(options)).resolves.toBe(false);
    expect(ApprovalManager.getPending()).toEqual([]);
    ApprovalManager.setNotifier(() => true);
    const pending = ApprovalManager.request(options);
    ApprovalManager.setNotifier(null);
    await expect(pending).resolves.toBe(false);
    expect(ApprovalManager.getPending()).toEqual([]);
  });

  it('cancels only the requested session and redacts credential fields in previews', async () => {
    const requests: ApprovalRequest[] = [];
    ApprovalManager.setNotifier(request => { requests.push(request); return true; });
    const options = { toolName: 'shell_command', capability: 'local-execute' as const,
      args: { command: 'echo fixture', apiKey: 'synthetic-not-a-secret' }, channel: 'desktop' };
    const first = ApprovalManager.request({ ...options, sessionId: 'first' });
    const second = ApprovalManager.request({ ...options, sessionId: 'second' });
    expect(requests[0].details).toContain('echo fixture');
    expect(requests[0].details).not.toContain('synthetic-not-a-secret');
    ApprovalManager.cancelSession('first');
    await expect(first).resolves.toBe(false);
    expect(ApprovalManager.resolve(requests[0].id, 'approve', 'ui')).toBe(false);
    expect(ApprovalManager.resolve(requests[1].id, 'approve', 'ui')).toBe(true);
    await expect(second).resolves.toBe(true);
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
      { name: 'mcp__flo-gmail__gmail_send', description: 'send', parameters: z.object({}), execute } as AgentTool,
      'mcp'
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

  it.each(['shell_command', 'bash', 'mcp__unreviewed__lookup', 'unreviewed_tool', 'render_video', 'scaffold_video_project', 'set_project'])(
    'blocks unreviewed execution of %s without a user', async (name) => {
      const execute = vi.fn(async () => 'executed');
      const tool = guardToolWithApproval(attachToolPolicy(
        { name, description: '', parameters: z.object({}), execute } as AgentTool,
        name.startsWith('mcp__') ? 'mcp' : 'native'
      ), { sessionId: 'background', channel: 'cron:daily', cwd: '/workspace', approvedRoots: ['/workspace'] });
      await expect(tool.execute({}, context)).resolves.toMatch(/requires user approval/i);
      expect(execute).not.toHaveBeenCalled();
    }
  );

  it.each(['evaluate', 'upload', 'unknown-action', undefined])('denies unreviewed browser action %s', async (action) => {
    const execute = vi.fn(async () => 'executed');
    const tool = guardToolWithApproval(attachToolPolicy(
      { name: 'browser', description: '', parameters: z.object({}), execute } as AgentTool, 'custom'
    ), { sessionId: 'background', channel: 'cron:daily', cwd: '/workspace', approvedRoots: ['/workspace'] });
    await expect(tool.execute({ action }, context)).resolves.toMatch(/requires user approval/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it('binds approval to immutable arguments and destination', async () => {
    const execute = vi.fn(async () => 'executed');
    const tool = guardToolWithApproval(attachToolPolicy(
      { name: 'send_telegram_message', description: '', parameters: z.object({}), execute } as AgentTool, 'custom'
    ), { sessionId: 'desktop', channel: 'desktop', cwd: '/workspace', approvedRoots: ['/workspace'] });
    let request: ApprovalRequest | undefined;
    ApprovalManager.setNotifier(next => { request = next; return true; });
    const args = { chat_id: 'synthetic-destination', message: 'reviewed draft' };
    const result = tool.execute(args, context);
    args.chat_id = 'changed-destination';
    args.message = 'changed draft';
    ApprovalManager.resolve(request!.id, 'approve', 'ui');
    await expect(result).resolves.toBe('executed');
    expect(execute).toHaveBeenCalledWith({ chat_id: 'synthetic-destination', message: 'reviewed draft' }, context);
  });

  it('does not execute when canceled immediately after approval', async () => {
    const execute = vi.fn(async () => 'executed');
    const controller = new AbortController();
    const tool = guardToolWithApproval(attachToolPolicy(
      { name: 'send_telegram_message', description: '', parameters: z.object({}), execute } as AgentTool, 'custom'
    ), { sessionId: 'desktop', channel: 'desktop', cwd: '/workspace', approvedRoots: ['/workspace'] });
    let request: ApprovalRequest | undefined;
    ApprovalManager.setNotifier(next => { request = next; return true; });
    const result = tool.execute({}, { ...context, signal: controller.signal });
    ApprovalManager.resolve(request!.id, 'approve', 'ui');
    controller.abort();
    await result;
    expect(execute).not.toHaveBeenCalled();
  });

  it('runs an interactive tool once approved', async () => {
    const execute = vi.fn(async () => 'executed');
    const tool = attachToolPolicy(
      { name: 'send_telegram_message', description: 'send', parameters: z.object({}), execute } as AgentTool,
      'custom'
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
