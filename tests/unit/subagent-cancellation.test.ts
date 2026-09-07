import { expect, it, vi, afterEach } from 'vitest';
import type { ToolContext } from '@kenkaiiii/gg-agent';
const { loop } = vi.hoisted(() => ({ loop: vi.fn() }));
vi.mock('@kenkaiiii/gg-agent', () => ({ agentLoop: loop }));
vi.mock('../../src/settings', () => ({ SettingsManager: { get: () => 'fixture' } }));
vi.mock('../../src/tools/subagent-registry', () => ({
  registerSubAgent: vi.fn(), updateSubAgent: vi.fn(), removeSubAgent: vi.fn(),
}));
import { createSubAgentTool } from '../../src/tools/subagent';
import { z } from 'zod';
import { attachToolPolicy, guardToolWithApproval } from '../../src/agent/tool-policy';
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it('aborts the actual child on its deadline and removes the parent listener', async () => {
  vi.useFakeTimers();
  let childSignal: AbortSignal | undefined;
  loop.mockImplementation(async function* (_messages, options) {
    childSignal = options.signal;
    await new Promise<void>((resolve) => options.signal.addEventListener('abort', () => resolve(), { once: true }));
  });
  const parent = new AbortController();
  const remove = vi.spyOn(parent.signal, 'removeEventListener');
  const tool = createSubAgentTool([], async () => ({ provider: 'fixture' }) as never);
  const result = tool.execute({ task: 'inert fixture' }, { signal: parent.signal } as ToolContext);
  await vi.advanceTimersByTimeAsync(300_000);
  expect(childSignal?.aborted).toBe(true);
  expect(await result).toMatch(/stopped/);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});

it('inherits guarded parent tools and preserves local draft operations', async () => {
  const shell = vi.fn(async () => 'shell executed');
  const write = vi.fn(async () => 'draft saved');
  const scope = { sessionId: 'delegation-fixture', channel: 'cron:fixture', cwd: '/workspace', approvedRoots: ['/workspace'] };
  const parentTools = [
    guardToolWithApproval(attachToolPolicy({ name: 'shell_command', description: '', parameters: z.object({}), execute: shell }, 'native'), scope),
    guardToolWithApproval(attachToolPolicy({ name: 'write', description: '', parameters: z.object({}), execute: write }, 'native'), scope),
  ];
  loop.mockImplementation(async function* (_messages, options) {
    expect(options.tools).toEqual(parentTools);
    const context = { signal: options.signal, toolCallId: 'child-fixture' };
    expect(await options.tools[0].execute({}, context)).toMatch(/requires user approval/);
    expect(await options.tools[1].execute({}, context)).toBe('draft saved');
  });
  const tool = createSubAgentTool(parentTools, async () => ({ provider: 'fixture' }) as never);
  await tool.execute({ task: 'synthetic delegated draft' }, { signal: new AbortController().signal } as ToolContext);
  expect(shell).not.toHaveBeenCalled();
  expect(write).toHaveBeenCalledOnce();
});
