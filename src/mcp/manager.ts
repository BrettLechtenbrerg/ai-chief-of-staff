/**
 * Owns the lifecycle of every external MCP server configured for this app.
 *
 * Singleton (per main-process). One instance is created at app startup
 * in `src/main/index.ts`, given the user data dir, and asked to `start()`.
 * `getAllTools()` returns a flat list of `MCPToolDescriptor`s for the
 * agent-tools layer to wrap. `callTool()` dispatches by server name.
 *
 * Failure model: if one server fails to start the others still load.
 * Failed servers are remembered (via MCPClient.status === 'failed') so
 * future UI can show why.
 */

import { loadMCPConfig } from './config';
import { MCPClient } from './client';
import type { ExternalMCPServerConfig, MCPToolDescriptor } from './types';
import { prefixToolName } from './client';

export interface MCPServerStatus {
  serverName: string;
  status: 'idle' | 'starting' | 'ready' | 'failed' | 'stopped' | 'disabled';
  toolCount: number;
  lastError: string | null;
}

export class MCPServerManager {
  private clients = new Map<string, MCPClient>();
  /** Cache of every agentToolName -> {serverName, toolName} pair, for fast dispatch. */
  private toolIndex = new Map<string, { serverName: string; toolName: string }>();
  /** Servers we never connected (disabled, missing config, etc.) for status reporting. */
  private disabledServers = new Set<string>();
  private started = false;

  /**
   * Read mcp-servers.json from userDataDir and start every non-disabled
   * server in parallel. Returns after all servers finish their startup
   * (success or failure) so the agent doesn't start a turn with a half-
   * connected toolset.
   */
  async start(userDataDir: string): Promise<void> {
    if (this.started) return;
    this.started = true;

    const file = loadMCPConfig(userDataDir);
    const entries = Object.entries(file.mcpServers);
    if (entries.length === 0) return;

    const startups: Promise<void>[] = [];
    for (const [name, cfg] of entries) {
      if (cfg.disabled) {
        this.disabledServers.add(name);
        console.log(`[MCP Manager] '${name}' is disabled, skipping`);
        continue;
      }
      const client = new MCPClient(name, cfg);
      this.clients.set(name, client);
      // start() rejects on failure; catch here so one bad config doesn't
      // bubble up and break the entire startup sequence.
      startups.push(
        client.start().catch((err) => {
          console.error(`[MCP Manager] '${name}' did not start:`, (err as Error).message);
        }),
      );
    }

    await Promise.all(startups);
    this.rebuildToolIndex();

    const readyCount = Array.from(this.clients.values()).filter((c) => c.status === 'ready').length;
    console.log(
      `[MCP Manager] startup complete: ${readyCount}/${entries.length} server${entries.length === 1 ? '' : 's'} ready, ${this.toolIndex.size} tool${this.toolIndex.size === 1 ? '' : 's'} available`,
    );
  }

  /** Re-walk every ready client and rebuild the agent-tool-name index. */
  private rebuildToolIndex(): void {
    this.toolIndex.clear();
    for (const [serverName, client] of this.clients) {
      if (client.status !== 'ready') continue;
      for (const tool of client.tools) {
        this.toolIndex.set(tool.agentToolName, { serverName, toolName: tool.toolName });
      }
    }
  }

  /** Flat list of every tool from every connected server. Used by the proxy layer. */
  getAllTools(): MCPToolDescriptor[] {
    const out: MCPToolDescriptor[] = [];
    for (const client of this.clients.values()) {
      if (client.status !== 'ready') continue;
      for (const tool of client.tools) out.push(tool);
    }
    return out;
  }

  /**
   * Dispatch a tool call. Accepts the agent-facing tool name
   * (`mcp__<server>__<tool>`) and routes to the right client.
   */
  async callTool(agentToolName: string, args: Record<string, unknown>): Promise<string> {
    const entry = this.toolIndex.get(agentToolName);
    if (!entry) throw new Error(`Unknown MCP tool: ${agentToolName}`);
    const client = this.clients.get(entry.serverName);
    if (!client) throw new Error(`MCP server '${entry.serverName}' not registered`);
    return await client.callTool(entry.toolName, args);
  }

  /** Snapshot of every configured server's current state, for diagnostics + UI. */
  getServerStatuses(): MCPServerStatus[] {
    const statuses: MCPServerStatus[] = [];
    for (const [name, client] of this.clients) {
      statuses.push({
        serverName: name,
        status: client.status,
        toolCount: client.tools.length,
        lastError: client.lastError,
      });
    }
    for (const name of this.disabledServers) {
      statuses.push({ serverName: name, status: 'disabled', toolCount: 0, lastError: null });
    }
    return statuses;
  }

  /**
   * Add a new MCP server at runtime (Settings UI "Add connection" flow).
   * Instantiates an MCPClient, starts it, and rebuilds the tool index so
   * the agent sees the new tools immediately. Errors propagate so the UI
   * can surface a clean failure (the client's own `lastError` will also
   * carry the message).
   *
   * If a client with the same name already exists, this throws — callers
   * should use `replaceClient` to swap an existing entry.
   */
  async addClient(name: string, cfg: ExternalMCPServerConfig): Promise<void> {
    if (this.clients.has(name)) {
      throw new Error(`MCP server '${name}' is already registered`);
    }
    if (cfg.disabled) {
      this.disabledServers.add(name);
      return;
    }
    // If we previously had it as disabled, clear that bookkeeping.
    this.disabledServers.delete(name);

    const client = new MCPClient(name, cfg);
    this.clients.set(name, client);
    try {
      await client.start();
    } catch (err) {
      // Keep the client in the map so its `lastError` is visible via
      // getServerStatuses(); the UI uses that to render the failed badge.
      console.error(`[MCP Manager] addClient '${name}' failed:`, (err as Error).message);
    }
    this.rebuildToolIndex();
  }

  /**
   * Stop and remove a named client. Safe to call for names that aren't
   * registered (no-op). Used by Settings UI delete + toggle-off flows.
   */
  async stopClient(name: string): Promise<void> {
    this.disabledServers.delete(name);
    const client = this.clients.get(name);
    if (!client) return;
    try {
      await client.stop();
    } catch (err) {
      console.warn(`[MCP Manager] error stopping '${name}':`, (err as Error).message);
    }
    this.clients.delete(name);
    this.rebuildToolIndex();
  }

  /**
   * Stop the named client (if any), then start a new one with the given
   * config. Used by Settings UI edit + toggle-on flows.
   *
   * Drain check: if the existing client has in-flight tool calls we wait
   * up to ~1.5s (3 × 500ms) before forcing the stop, to avoid yanking the
   * transport out from under an active request.
   */
  async replaceClient(name: string, cfg: ExternalMCPServerConfig): Promise<void> {
    const existing = this.clients.get(name);
    if (existing) {
      // Wait briefly for in-flight calls to settle before stopping.
      for (let attempt = 0; attempt < 3 && existing.inFlightCount > 0; attempt++) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    await this.stopClient(name);
    await this.addClient(name, cfg);
  }

  /** Reap every child process. Called on app quit. */
  async stop(): Promise<void> {
    const stops: Promise<void>[] = [];
    for (const client of this.clients.values()) {
      stops.push(client.stop().catch((err) => {
        console.warn(`[MCP Manager] error stopping '${client.serverName}':`, (err as Error).message);
      }));
    }
    await Promise.all(stops);
    this.clients.clear();
    this.toolIndex.clear();
    this.started = false;
  }
}

// Module-level singleton. The app only ever needs one of these.
let _instance: MCPServerManager | null = null;

export function getMCPManager(): MCPServerManager {
  if (!_instance) _instance = new MCPServerManager();
  return _instance;
}

// Re-export so callers don't need to know about client.ts directly.
export { prefixToolName };
export type { ExternalMCPServerConfig, MCPToolDescriptor };
