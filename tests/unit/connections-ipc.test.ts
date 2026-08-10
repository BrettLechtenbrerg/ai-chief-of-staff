/**
 * Unit tests for the Settings → Connections IPC layer.
 *
 * The handler is a thin layer over `loadMCPConfig` / `saveMCPConfig` and
 * the MCPServerManager. We mock the manager so we can assert add / stop /
 * replace calls without spawning real child processes, but the file I/O
 * runs against a real temp directory so we exercise the atomic-write path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ── Mocks ──────────────────────────────────────────────────────────────────

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
const openPathMock = vi.fn(async (_p: string) => '');

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(channel, handler);
    },
  },
  shell: {
    openPath: (p: string) => openPathMock(p),
  },
}));

vi.mock('../../src/main/ipc/trusted-ipc', () => ({
  trustedHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    registeredHandlers.set(channel, handler);
  },
}));
// Manager mock — we track every method call.
const mockMgr = {
  addClient: vi.fn(async (_name: string, _cfg: unknown) => undefined),
  stopClient: vi.fn(async (_name: string) => undefined),
  replaceClient: vi.fn(async (_name: string, _cfg: unknown) => undefined),
  getServerStatuses: vi.fn(() => [] as Array<Record<string, unknown>>),
};

vi.mock('../../src/mcp/manager', async () => {
  const actual = await vi.importActual<typeof import('../../src/mcp/manager')>(
    '../../src/mcp/manager',
  );
  return {
    ...actual,
    getMCPManager: () => mockMgr,
  };
});

// MCPClient mock for testConnection — we drive start() / tools / stop()
// directly in each test where it matters.
const mockClientInstances: Array<{
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  tools: Array<{ toolName: string }>;
}> = [];

/**
 * Test knob — controls how the next MCPClient mock's start() behaves.
 * Each test sets this before triggering testConnection so we don't have
 * to monkey-patch prototypes (which doesn't survive class-based vi.mock).
 */
let nextStartBehavior: 'resolve' | 'reject' | 'hang' = 'resolve';
let nextStartError = 'boom';

vi.mock('../../src/mcp/client', () => {
  return {
    MCPClient: class {
      tools: Array<{ toolName: string }> = [];
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      constructor(_name: string, _cfg: unknown) {
        const behavior = nextStartBehavior;
        const errMsg = nextStartError;
        this.start = vi.fn(() => {
          if (behavior === 'reject') return Promise.reject(new Error(errMsg));
          if (behavior === 'hang') return new Promise<void>(() => undefined);
          return Promise.resolve();
        });
        this.stop = vi.fn(async () => undefined);
        mockClientInstances.push(this);
      }
    },
    prefixToolName: (s: string, t: string) => `mcp__${s}__${t}`,
  };
});

import { registerConnectionsIPC } from '../../src/main/ipc/connections-ipc';
import { loadMCPConfig, resolveMCPConfigPath } from '../../src/mcp/config';

// ── Helpers ────────────────────────────────────────────────────────────────

function getHandler(channel: string) {
  const handler = registeredHandlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler;
}

function call(channel: string, ...payload: unknown[]) {
  return getHandler(channel)({}, ...payload);
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'acos-conn-ipc-'));
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('connections-ipc', () => {
  let dir: string;

  beforeEach(() => {
    registeredHandlers.clear();
    mockMgr.addClient.mockClear();
    mockMgr.stopClient.mockClear();
    mockMgr.replaceClient.mockClear();
    mockMgr.getServerStatuses.mockReset();
    mockMgr.getServerStatuses.mockReturnValue([]);
    mockClientInstances.length = 0;
    openPathMock.mockClear();
    nextStartBehavior = 'resolve';
    nextStartError = 'boom';

    dir = makeTempDir();
    registerConnectionsIPC(() => dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('connections:list', () => {
    it('merges file-truth with live status from the manager', async () => {
      // Seed the file with two servers.
      fs.writeFileSync(
        resolveMCPConfigPath(dir),
        JSON.stringify({
          mcpServers: {
            'flo-gmail': { command: 'node', args: ['flo.js'] },
            'disabled-one': { command: 'echo', disabled: true },
          },
        }),
      );

      mockMgr.getServerStatuses.mockReturnValue([
        { serverName: 'flo-gmail', status: 'ready', toolCount: 12, lastError: null },
      ]);

      const result = (await call('connections:list')) as {
        servers: Array<Record<string, unknown>>;
      };

      expect(result.servers).toHaveLength(2);
      const flo = result.servers.find((s) => s.name === 'flo-gmail');
      const dis = result.servers.find((s) => s.name === 'disabled-one');
      expect(flo).toMatchObject({
        command: 'node',
        args: ['flo.js'],
        status: 'ready',
        toolCount: 12,
        disabled: false,
      });
      expect(dis).toMatchObject({
        command: 'echo',
        status: 'disabled',
        disabled: true,
        toolCount: 0,
      });
    });

    it('returns an empty list when no file exists', async () => {
      const result = (await call('connections:list')) as { servers: unknown[] };
      expect(result.servers).toEqual([]);
    });
  });

  describe('connections:add', () => {
    it('writes a new entry, starts the client, and rebuilds tool index', async () => {
      await call('connections:add', 'flo', { command: 'node', args: ['s.js'] });

      const file = loadMCPConfig(dir);
      expect(file.mcpServers.flo).toMatchObject({ command: 'node', args: ['s.js'] });
      expect(mockMgr.addClient).toHaveBeenCalledWith('flo', expect.objectContaining({ command: 'node' }));
    });

    it('rejects a duplicate name', async () => {
      await call('connections:add', 'flo', { command: 'node' });
      await expect(call('connections:add', 'flo', { command: 'node' })).rejects.toThrow(/already exists/);
    });

    it('rejects an empty command', async () => {
      await expect(call('connections:add', 'bad', { command: '' })).rejects.toThrow(/Command is required/);
    });

    it('rejects a name with invalid characters', async () => {
      await expect(
        call('connections:add', 'has spaces', { command: 'echo' }),
      ).rejects.toThrow(/letters, numbers/);
    });

    it('rejects malformed args (not an array)', async () => {
      await expect(
        call('connections:add', 'x', { command: 'echo', args: 'not-an-array' as unknown }),
      ).rejects.toThrow(/args must be an array/);
    });
  });

  describe('connections:update', () => {
    it('replaces the running client when the name is unchanged', async () => {
      // Seed.
      fs.writeFileSync(
        resolveMCPConfigPath(dir),
        JSON.stringify({ mcpServers: { x: { command: 'old' } } }),
      );

      await call('connections:update', 'x', 'x', { command: 'new', args: ['--v'] });

      const file = loadMCPConfig(dir);
      expect(file.mcpServers.x.command).toBe('new');
      expect(file.mcpServers.x.args).toEqual(['--v']);
      expect(mockMgr.replaceClient).toHaveBeenCalledWith('x', expect.objectContaining({ command: 'new' }));
      expect(mockMgr.addClient).not.toHaveBeenCalled();
    });

    it('stops + adds on rename', async () => {
      fs.writeFileSync(
        resolveMCPConfigPath(dir),
        JSON.stringify({ mcpServers: { oldname: { command: 'echo' } } }),
      );

      await call('connections:update', 'oldname', 'newname', { command: 'echo' });

      const file = loadMCPConfig(dir);
      expect(file.mcpServers.oldname).toBeUndefined();
      expect(file.mcpServers.newname.command).toBe('echo');
      expect(mockMgr.stopClient).toHaveBeenCalledWith('oldname');
      expect(mockMgr.addClient).toHaveBeenCalledWith('newname', expect.any(Object));
    });

    it('rejects a rename collision', async () => {
      fs.writeFileSync(
        resolveMCPConfigPath(dir),
        JSON.stringify({
          mcpServers: { a: { command: 'x' }, b: { command: 'y' } },
        }),
      );
      await expect(call('connections:update', 'a', 'b', { command: 'x' })).rejects.toThrow(/already exists/);
    });
  });

  describe('connections:delete', () => {
    it('removes the entry and stops the client', async () => {
      fs.writeFileSync(
        resolveMCPConfigPath(dir),
        JSON.stringify({ mcpServers: { x: { command: 'echo' } } }),
      );

      await call('connections:delete', 'x');

      const file = loadMCPConfig(dir);
      expect(file.mcpServers.x).toBeUndefined();
      expect(mockMgr.stopClient).toHaveBeenCalledWith('x');
    });

    it('is a no-op when the name does not exist', async () => {
      const result = (await call('connections:delete', 'nope')) as { success: boolean };
      expect(result.success).toBe(true);
    });
  });

  describe('connections:toggle', () => {
    it('disables a running server: writes disabled=true and stops it', async () => {
      fs.writeFileSync(
        resolveMCPConfigPath(dir),
        JSON.stringify({ mcpServers: { x: { command: 'echo' } } }),
      );

      await call('connections:toggle', 'x', false);

      const file = loadMCPConfig(dir);
      expect(file.mcpServers.x.disabled).toBe(true);
      expect(mockMgr.stopClient).toHaveBeenCalledWith('x');
      expect(mockMgr.addClient).not.toHaveBeenCalled();
    });

    it('re-enables a disabled server: clears disabled and starts it', async () => {
      fs.writeFileSync(
        resolveMCPConfigPath(dir),
        JSON.stringify({ mcpServers: { x: { command: 'echo', disabled: true } } }),
      );

      await call('connections:toggle', 'x', true);

      const file = loadMCPConfig(dir);
      expect(file.mcpServers.x.disabled).toBeUndefined();
      expect(mockMgr.stopClient).toHaveBeenCalledWith('x');
      expect(mockMgr.addClient).toHaveBeenCalledWith('x', expect.objectContaining({ command: 'echo' }));
    });
  });

  describe('connections:testConnection', () => {
    it('returns ok with tool list when start succeeds', async () => {
      // The mock MCPClient.start resolves immediately; we set .tools afterwards.
      const result = await call('connections:testConnection', { command: 'echo' }) as {
        ok: boolean;
        toolCount?: number;
        error?: string;
      };
      expect(result.ok).toBe(true);
      expect(result.toolCount).toBe(0);
      // Always stops the test client.
      expect(mockClientInstances[0].stop).toHaveBeenCalled();
    });

    it('returns ok=false when start throws', async () => {
      nextStartBehavior = 'reject';
      nextStartError = 'boom';
      const result = (await call('connections:testConnection', { command: 'echo' })) as {
        ok: boolean;
        error?: string;
      };
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/boom/);
      // Always stops the test client, even on failure.
      expect(mockClientInstances[0].stop).toHaveBeenCalled();
    });

    it('rejects validation errors before spawning', async () => {
      const result = (await call('connections:testConnection', { command: '' })) as {
        ok: boolean;
        error?: string;
      };
      expect(result.ok).toBe(false);
      expect(mockClientInstances).toHaveLength(0);
    });

    it('times out if start hangs', async () => {
      nextStartBehavior = 'hang';
      vi.useFakeTimers();
      try {
        const promise = call('connections:testConnection', { command: 'echo' }) as Promise<{
          ok: boolean;
          error?: string;
        }>;
        // Advance past the 10s timeout.
        await vi.advanceTimersByTimeAsync(10_500);
        const result = await promise;
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/Timed out/);
      } finally {
        vi.useRealTimers();
      }
    }, 15_000);
  });

  describe('connections:openConfigFile', () => {
    it('opens the resolved mcp-servers.json path', async () => {
      const result = (await call('connections:openConfigFile')) as { path: string };
      expect(result.path).toBe(resolveMCPConfigPath(dir));
      expect(openPathMock).toHaveBeenCalledWith(resolveMCPConfigPath(dir));
    });
  });
});
