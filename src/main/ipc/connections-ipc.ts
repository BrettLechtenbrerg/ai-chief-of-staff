/**
 * IPC for the Settings \u2192 Connections UI.
 *
 * Manages every entry in `<userData>/mcp-servers.json`:
 *   - connections:list           \u2192 merge file truth with live MCPManager state
 *   - connections:add            \u2192 validate, append, start
 *   - connections:update         \u2192 validate, replace (possibly rename), restart
 *   - connections:delete         \u2192 stop the client + remove the entry
 *   - connections:toggle         \u2192 flip `disabled` and start/stop accordingly
 *   - connections:testConnection \u2192 spawn an ephemeral MCP client, list tools, return
 *   - connections:openConfigFile \u2192 reveal mcp-servers.json in the OS default editor
 *
 * File access goes through `loadMCPConfig` / `saveMCPConfig` so the
 * atomic-write contract is honored.
 *
 * Security note: the user owns the file these handlers mutate, so we don't
 * sandbox the commands they enter \u2014 same trust model as hand-editing
 * `mcp-servers.json`. We DO validate that the command is a non-empty string
 * so the renderer can't accidentally write garbage.
 */

import { ipcMain, shell } from 'electron';
import { loadMCPConfig, saveMCPConfig, resolveMCPConfigPath } from '../../mcp/config';
import { getMCPManager, type MCPServerStatus } from '../../mcp/manager';
import { MCPClient } from '../../mcp/client';
import type { ExternalMCPServerConfig } from '../../mcp/types';

export interface ConnectionSummary {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
  disabled: boolean;
  /** Live status from the running MCPManager, falls back to 'idle' / 'disabled'. */
  status: MCPServerStatus['status'];
  toolCount: number;
  lastError: string | null;
}

export interface ConnectionInput {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  disabled?: boolean;
}

/** Match the safety guarantees of `mcp-servers.json` hand-editing. */
function validateInput(name: string, input: ConnectionInput): ExternalMCPServerConfig {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Connection name is required');
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error(
      'Connection name can only contain letters, numbers, dot, underscore, and dash',
    );
  }
  if (!input || typeof input !== 'object') {
    throw new Error('Connection config is required');
  }
  if (typeof input.command !== 'string' || input.command.trim().length === 0) {
    throw new Error('Command is required');
  }
  const cfg: ExternalMCPServerConfig = { command: input.command.trim() };
  if (input.args !== undefined) {
    if (!Array.isArray(input.args)) throw new Error('args must be an array');
    cfg.args = input.args.map((a) => String(a));
  }
  if (input.env !== undefined) {
    if (typeof input.env !== 'object' || input.env === null || Array.isArray(input.env)) {
      throw new Error('env must be an object');
    }
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.env)) {
      if (typeof k !== 'string' || k.length === 0) {
        throw new Error('env keys must be non-empty strings');
      }
      env[k] = String(v);
    }
    cfg.env = env;
  }
  if (input.cwd !== undefined && input.cwd !== '') {
    if (typeof input.cwd !== 'string') throw new Error('cwd must be a string');
    cfg.cwd = input.cwd;
  }
  if (input.disabled === true) {
    cfg.disabled = true;
  }
  return cfg;
}

function makeSummary(
  name: string,
  cfg: ExternalMCPServerConfig,
  statuses: Map<string, MCPServerStatus>,
): ConnectionSummary {
  const live = statuses.get(name);
  return {
    name,
    command: cfg.command,
    args: cfg.args ?? [],
    env: cfg.env ?? {},
    cwd: cfg.cwd ?? null,
    disabled: !!cfg.disabled,
    status: cfg.disabled ? 'disabled' : (live?.status ?? 'idle'),
    toolCount: live?.toolCount ?? 0,
    lastError: live?.lastError ?? null,
  };
}

export function registerConnectionsIPC(getUserDataDir: () => string): void {
  ipcMain.handle('connections:list', async (): Promise<{ servers: ConnectionSummary[] }> => {
    const file = loadMCPConfig(getUserDataDir());
    const statuses = new Map<string, MCPServerStatus>();
    for (const s of getMCPManager().getServerStatuses()) statuses.set(s.serverName, s);

    const servers: ConnectionSummary[] = [];
    for (const [name, cfg] of Object.entries(file.mcpServers)) {
      servers.push(makeSummary(name, cfg, statuses));
    }
    return { servers };
  });

  ipcMain.handle(
    'connections:add',
    async (_, name: string, input: ConnectionInput): Promise<{ success: boolean }> => {
      const cfg = validateInput(name, input);
      const dir = getUserDataDir();
      const file = loadMCPConfig(dir);
      if (file.mcpServers[name]) {
        throw new Error(`Connection "${name}" already exists`);
      }
      file.mcpServers[name] = cfg;
      saveMCPConfig(dir, file);
      await getMCPManager().addClient(name, cfg);
      return { success: true };
    },
  );

  ipcMain.handle(
    'connections:update',
    async (
      _,
      oldName: string,
      newName: string,
      input: ConnectionInput,
    ): Promise<{ success: boolean }> => {
      const cfg = validateInput(newName, input);
      const dir = getUserDataDir();
      const file = loadMCPConfig(dir);
      if (!file.mcpServers[oldName]) {
        throw new Error(`Connection "${oldName}" does not exist`);
      }
      if (newName !== oldName && file.mcpServers[newName]) {
        throw new Error(`Connection "${newName}" already exists`);
      }
      // Rename: drop the old entry, add the new.
      delete file.mcpServers[oldName];
      file.mcpServers[newName] = cfg;
      saveMCPConfig(dir, file);

      const mgr = getMCPManager();
      if (newName !== oldName) {
        await mgr.stopClient(oldName);
        await mgr.addClient(newName, cfg);
      } else {
        await mgr.replaceClient(newName, cfg);
      }
      return { success: true };
    },
  );

  ipcMain.handle(
    'connections:delete',
    async (_, name: string): Promise<{ success: boolean }> => {
      const dir = getUserDataDir();
      const file = loadMCPConfig(dir);
      if (!file.mcpServers[name]) {
        // Nothing to do, but treat as success so the UI can re-render.
        return { success: true };
      }
      delete file.mcpServers[name];
      saveMCPConfig(dir, file);
      await getMCPManager().stopClient(name);
      return { success: true };
    },
  );

  ipcMain.handle(
    'connections:toggle',
    async (_, name: string, enabled: boolean): Promise<{ success: boolean }> => {
      const dir = getUserDataDir();
      const file = loadMCPConfig(dir);
      const entry = file.mcpServers[name];
      if (!entry) throw new Error(`Connection "${name}" does not exist`);

      const updated: ExternalMCPServerConfig = { ...entry };
      if (enabled) {
        delete updated.disabled;
      } else {
        updated.disabled = true;
      }
      file.mcpServers[name] = updated;
      saveMCPConfig(dir, file);

      const mgr = getMCPManager();
      if (enabled) {
        // Enable \u2014 stop any stale entry then start fresh.
        await mgr.stopClient(name);
        await mgr.addClient(name, updated);
      } else {
        await mgr.stopClient(name);
      }
      return { success: true };
    },
  );

  ipcMain.handle(
    'connections:testConnection',
    async (
      _,
      input: ConnectionInput,
    ): Promise<{ ok: boolean; toolCount?: number; tools?: string[]; error?: string }> => {
      let cfg: ExternalMCPServerConfig;
      try {
        cfg = validateInput('__test__', input);
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }

      const client = new MCPClient('__test__', cfg);
      // Hard 10s timeout so a misconfigured server doesn't hang the UI.
      const TIMEOUT_MS = 10_000;
      let timedOut = false;
      const timeout = new Promise<never>((_resolve, reject) => {
        setTimeout(() => {
          timedOut = true;
          reject(new Error(`Timed out after ${TIMEOUT_MS / 1000}s`));
        }, TIMEOUT_MS);
      });
      try {
        await Promise.race([client.start(), timeout]);
        const tools = client.tools.map((t) => t.toolName);
        return { ok: true, toolCount: tools.length, tools };
      } catch (err) {
        const message = (err as Error).message || 'Unknown error';
        return {
          ok: false,
          error: timedOut ? message : message.slice(0, 500),
        };
      } finally {
        // Always reap the child \u2014 we don't want test spawns lingering.
        await client.stop().catch(() => undefined);
      }
    },
  );

  ipcMain.handle('connections:openConfigFile', async (): Promise<{ success: boolean; path: string }> => {
    const dir = getUserDataDir();
    const file = resolveMCPConfigPath(dir);
    // shell.openPath opens with the OS default app (text editor for .json).
    await shell.openPath(file);
    return { success: true, path: file };
  });
}
