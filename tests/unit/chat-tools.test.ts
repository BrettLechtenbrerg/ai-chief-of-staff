/**
 * Unit tests for chat-tools.ts — shell_command safety gate
 *
 * Verifies that buildShellCommandTool's execute() blocks dangerous commands
 * before reaching execAsync, and passes safe commands through.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoist mock references so they are available inside vi.mock factories ───
const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn(),
}));

// ── Mock child_process + util BEFORE importing the module under test ───────
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>();
  return {
    ...actual,
    promisify: (_fn: unknown) => mockExecAsync,
  };
});

// Hoisted spies for the gg-coder write/edit tools so we can verify they are
// (or are not) invoked when the safety wrapper engages.
const { mockWriteExecute, mockEditExecute } = vi.hoisted(() => ({
  mockWriteExecute: vi.fn(),
  mockEditExecute: vi.fn(),
}));

// Mock heavy deps that chat-tools imports but are irrelevant here
vi.mock('@kenkaiiii/ggcoder', () => ({
  createTools: () => ({
    tools: [
      {
        name: 'write',
        description: 'write file',
        parameters: {} as unknown,
        execute: mockWriteExecute,
      },
      {
        name: 'edit',
        description: 'edit file',
        parameters: {} as unknown,
        execute: mockEditExecute,
      },
    ],
  }),
}));

vi.mock('../../src/tools', () => ({
  getCustomTools: () => [],
}));

vi.mock('../../src/tools/diagnostics', () => ({
  wrapToolHandler: (_name: string, handler: unknown) => handler,
}));

vi.mock('../../src/tools/subagent', () => ({
  createSubAgentTool: () => ({
    name: 'sub_agent',
    description: '',
    parameters: {},
    execute: vi.fn(),
  }),
}));

vi.mock('../../src/agent/chat-providers', () => ({
  getStreamConfig: vi.fn(),
}));

// ── Now import the module ──────────────────────────────────────────────────
import { getChatAgentTools, getCoderAgentTools } from '../../src/agent/chat-tools';
import type { AgentTool, ToolContext } from '@kenkaiiii/gg-agent';

// Helper: extract the shell_command tool from a fresh call each time
function getShellTool(): AgentTool {
  const tools = getChatAgentTools({} as Parameters<typeof getChatAgentTools>[0], '/tmp');
  const tool = tools.find((t) => t.name === 'shell_command');
  if (!tool) throw new Error('shell_command tool not found');
  return tool;
}

// Stub ToolContext (shell_command ignores it)
const ctx = {} as ToolContext;

// ── Dangerous commands ─────────────────────────────────────────────────────
describe('shell_command tool — dangerous commands are blocked', () => {
  beforeEach(() => {
    mockExecAsync.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const dangerousCases: Array<[string, string]> = [
    ['rm -rf /', 'rm -rf /'],
    ['fork bomb', ':(){ :|:& };:'],
    ['dd to disk device', 'dd if=/dev/zero of=/dev/sda'],
    ['mkfs format', 'mkfs.ext4 /dev/sda1'],
    ['overwrite /etc/passwd', '> /etc/passwd'],
  ];

  for (const [label, command] of dangerousCases) {
    it(`blocks: ${label}`, async () => {
      const tool = getShellTool();
      const result = await tool.execute({ command }, ctx);

      // Must return a blocked-error string
      expect(typeof result).toBe('string');
      expect((result as string).toLowerCase()).toMatch(/blocked/);

      // execAsync must NEVER be called
      expect(mockExecAsync).not.toHaveBeenCalled();
    });
  }
});

// ── Safe commands ──────────────────────────────────────────────────────────
describe('shell_command tool — safe commands pass through', () => {
  beforeEach(() => {
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: 'ok', stderr: '' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const safeCases: string[] = ['ls', 'pwd', 'echo hi'];

  for (const command of safeCases) {
    it(`allows: ${command}`, async () => {
      const tool = getShellTool();
      const result = await tool.execute({ command }, ctx);

      // execAsync MUST have been called (command was not blocked)
      expect(mockExecAsync).toHaveBeenCalledOnce();
      expect(result).toBe('ok');
    });
  }
});

// ── Write/Edit path safety ─────────────────────────────────────────────────
describe('write/edit tools — dangerous paths are blocked before delegating', () => {
  beforeEach(() => {
    mockWriteExecute.mockReset();
    mockEditExecute.mockReset();
    mockWriteExecute.mockResolvedValue('wrote ok');
    mockEditExecute.mockResolvedValue('edited ok');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function getTool(name: 'write' | 'edit', mode: 'chat' | 'coder'): AgentTool {
    const tools =
      mode === 'chat'
        ? getChatAgentTools({} as Parameters<typeof getChatAgentTools>[0], '/tmp')
        : getCoderAgentTools({} as Parameters<typeof getCoderAgentTools>[0], '/tmp');
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`${name} tool not found`);
    return tool;
  }

  const dangerousPaths: string[] = [
    '/etc/passwd',
    '/usr/bin/node',
    '/System/Library/Extensions/test.kext',
  ];

  for (const mode of ['chat', 'coder'] as const) {
    for (const filePath of dangerousPaths) {
      it(`[${mode}] write: blocks dangerous path ${filePath}`, async () => {
        const tool = getTool('write', mode);
        const result = await tool.execute({ file_path: filePath, content: 'x' }, ctx);

        expect(typeof result).toBe('string');
        expect((result as string).toLowerCase()).toMatch(/blocked/);
        expect(mockWriteExecute).not.toHaveBeenCalled();
      });

      it(`[${mode}] edit: blocks dangerous path ${filePath}`, async () => {
        const tool = getTool('edit', mode);
        const result = await tool.execute(
          { file_path: filePath, edits: [{ old_text: 'a', new_text: 'b' }] },
          ctx
        );

        expect(typeof result).toBe('string');
        expect((result as string).toLowerCase()).toMatch(/blocked/);
        expect(mockEditExecute).not.toHaveBeenCalled();
      });
    }
  }

  it('allows safe write paths to delegate to the underlying tool', async () => {
    const tool = getTool('write', 'coder');
    const result = await tool.execute(
      { file_path: '/Users/user/projects/myapp/src/index.ts', content: 'x' },
      ctx
    );

    expect(mockWriteExecute).toHaveBeenCalledOnce();
    expect(result).toBe('wrote ok');
  });
});
